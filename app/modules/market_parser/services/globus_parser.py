from __future__ import annotations

import asyncio
import hashlib
import html
import json
import logging
import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any
from urllib.parse import urljoin

import httpx
from bs4 import BeautifulSoup

from app.core.config import settings
from app.modules.market_parser.models.entities import ParserCategory

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class ParsedCategory:
    source_code: str
    external_id: str | None
    name: str
    url: str
    parent_external_id: str | None = None
    is_group: bool = False


@dataclass(slots=True)
class ParsedProduct:
    source_code: str
    external_sku: str | None
    name: str
    unit: str | None
    category_name: str | None
    category_url: str | None
    price: Decimal | None
    discount_price: Decimal | None
    discount_percent: Decimal | None
    image_url: str | None
    product_url: str | None
    is_available: bool | None
    raw_data: dict[str, Any] = field(default_factory=dict)


class BaseMarketParser:
    async def fetch_categories(self) -> list[ParsedCategory]:
        raise NotImplementedError

    async def fetch_products_by_category(self, category: ParserCategory) -> list[ParsedProduct]:
        raise NotImplementedError


class GlobusParser(BaseMarketParser):
    source_code = "globus"

    def __init__(self, base_url: str = "https://globus-online.kg/ru-kg") -> None:
        self.base_url = base_url.rstrip("/")
        self.headers = {
            "User-Agent": settings.parser_user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "ru,en;q=0.8",
        }
        self._sku_by_product_id: dict[str, str] = {}

    async def fetch_categories(self) -> list[ParsedCategory]:
        text = await self._get_text(self.base_url)
        tree_categories = self._extract_category_tree(text)
        if tree_categories:
            return sorted(tree_categories, key=lambda item: (item.parent_external_id or item.external_id or "", item.name))

        categories_by_id = self._extract_categories_from_state(text)
        categories_by_url = self._extract_category_links(text)
        categories: dict[str, ParsedCategory] = {}

        for external_id, name in categories_by_id.items():
            url = urljoin(self.base_url, f"/ru-kg/catalog/grocery/category/{external_id}")
            categories[external_id] = ParsedCategory(
                source_code=self.source_code,
                external_id=external_id,
                name=name,
                url=url,
            )

        for url, name in categories_by_url.items():
            external_id = self._category_id_from_url(url)
            if not external_id:
                continue
            categories[external_id] = ParsedCategory(
                source_code=self.source_code,
                external_id=external_id,
                name=categories_by_id.get(external_id) or name or external_id,
                url=urljoin(self.base_url, url),
            )

        return sorted(categories.values(), key=lambda item: item.name)

    async def fetch_products_by_category(self, category: ParserCategory) -> list[ParsedProduct]:
        await asyncio.sleep(settings.parser_request_delay_ms / 1000)
        text = await self._get_text(category.url)
        data = self._extract_state(text)
        products = list(self._iter_product_dicts(data))
        await self._enrich_product_skus(products)
        parsed = [self.normalize_product(product, category) for product in products]
        return [product for product in parsed if product is not None]

    async def _get_text(self, url: str) -> str:
        async with httpx.AsyncClient(
            timeout=settings.parser_request_timeout,
            headers=self.headers,
            follow_redirects=True,
        ) as client:
            return await self._request_text(client, url)

    async def _request_text(self, client: httpx.AsyncClient, url: str) -> str:
        last_error: Exception | None = None
        for attempt in range(settings.parser_max_retries):
            try:
                response = await client.get(url)
                if response.status_code >= 500:
                    raise httpx.HTTPStatusError(
                        f"Server error {response.status_code}",
                        request=response.request,
                        response=response,
                    )
                response.raise_for_status()
                return response.text
            except (httpx.TimeoutException, httpx.HTTPStatusError, httpx.TransportError) as exc:
                last_error = exc
                logger.warning("globus request failed", extra={"url": url, "attempt": attempt + 1})
                await asyncio.sleep(0.4 * (attempt + 1))
        assert last_error is not None
        raise last_error

    def normalize_product(
        self, item: dict[str, Any], category: ParserCategory | None = None
    ) -> ParsedProduct | None:
        title = clean_text(item.get("longTitle") or item.get("title") or item.get("name"))
        if not title:
            logger.warning("globus product skipped: no title", extra={"item": item})
            return None

        product_id = clean_text(item.get("id")) or None
        product_url = (
            urljoin(self.base_url, f"/ru-kg/good/{product_id}") if product_id else None
        )
        external_sku = self._sku_from_item(item) or product_id or stable_product_hash(
            product_url, title, category.name if category else None
        )
        current_price = to_decimal(item.get("currentPrice") or item.get("price"))
        old_price = to_decimal(item.get("oldPrice"))
        discount_price = current_price if old_price and current_price and current_price < old_price else None
        price = old_price or current_price
        discount_percent = self.calculate_discount_percent(price, discount_price)
        image_url = normalize_image_url(deep_get(item, "snippetImage", "url") or item.get("imageUrl"))
        unit = parse_unit(item.get("amount"), item.get("options"))

        return ParsedProduct(
            source_code=self.source_code,
            external_sku=external_sku,
            name=title,
            unit=unit,
            category_name=category.name if category else None,
            category_url=category.url if category else None,
            price=price,
            discount_price=discount_price,
            discount_percent=discount_percent,
            image_url=image_url,
            product_url=product_url,
            is_available=item.get("available"),
            raw_data=item,
        )

    async def _enrich_product_skus(self, products: list[dict[str, Any]]) -> None:
        self._enrich_product_skus_from_cache(products)
        products_without_sku = [
            item
            for item in products
            if not self._sku_from_item(item) and clean_text(item.get("id"))
        ]
        if not products_without_sku:
            return

        detail_concurrency = max(settings.parser_product_detail_concurrency, 1)
        semaphore = asyncio.Semaphore(detail_concurrency)

        async def enrich(client: httpx.AsyncClient, item: dict[str, Any]) -> None:
            product_id = clean_text(item.get("id"))
            product_url = urljoin(self.base_url, f"/ru-kg/good/{product_id}")
            async with semaphore:
                if settings.parser_product_detail_request_delay_ms > 0:
                    await asyncio.sleep(settings.parser_product_detail_request_delay_ms / 1000)
                try:
                    detail = await self._fetch_product_detail(product_url, product_id, client)
                except Exception:
                    logger.warning(
                        "globus product sku enrichment failed",
                        extra={"url": product_url},
                    )
                    return

            sku = self._sku_from_item(detail)
            if sku:
                item["pigeonId"] = sku
                self._sku_by_product_id[product_id] = sku

        async with httpx.AsyncClient(
            timeout=settings.parser_request_timeout,
            headers=self.headers,
            follow_redirects=True,
        ) as client:
            await asyncio.gather(*(enrich(client, item) for item in products_without_sku))

    async def _fetch_product_detail(
        self, product_url: str, product_id: str, client: httpx.AsyncClient | None = None
    ) -> dict[str, Any]:
        if client:
            text = await self._request_text(client, product_url)
        else:
            text = await self._get_text(product_url)
        data = self._extract_state(text)
        for item in self._iter_product_dicts(data):
            if clean_text(item.get("id")) == product_id:
                return item
        return {}

    def _enrich_product_skus_from_cache(self, products: list[dict[str, Any]]) -> None:
        for item in products:
            product_id = clean_text(item.get("id"))
            sku = self._sku_from_item(item) or (
                self._sku_by_product_id.get(product_id) if product_id else None
            )
            if sku:
                item["pigeonId"] = sku
                if product_id:
                    self._sku_by_product_id[product_id] = sku

    @staticmethod
    def _sku_from_item(item: dict[str, Any]) -> str | None:
        for key in ("pigeonId", "sku", "externalSku", "productCode", "article", "barcode"):
            value = clean_text(item.get(key))
            if value:
                return value
        return None

    @staticmethod
    def calculate_discount_percent(
        price: Decimal | None, discount_price: Decimal | None
    ) -> Decimal | None:
        if price is None or discount_price is None or price <= 0 or discount_price >= price:
            return None
        value = (Decimal("100") * (price - discount_price) / price).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
        return value

    def _extract_state(self, text: str) -> dict[str, Any]:
        for script_id in ("storedehydratedstate-data", "__page_props__-data"):
            match = re.search(
                rf'<script[^>]+id="{re.escape(script_id)}"[^>]*>(.*?)</script>',
                text,
                re.S,
            )
            if match:
                try:
                    return json.loads(html.unescape(match.group(1)))
                except json.JSONDecodeError:
                    logger.exception("failed to decode Globus SSR state", extra={"script_id": script_id})
        return {}

    def _extract_categories_from_state(self, text: str) -> dict[str, str]:
        data = self._extract_state(text)
        categories: dict[str, str] = {}
        for item in walk_dicts(data):
            info = item.get("info") if isinstance(item.get("info"), dict) else item
            if info.get("type") == "category" and info.get("id"):
                name = clean_text(info.get("title"))
                if name:
                    categories[str(info["id"])] = name
        return categories

    def _extract_category_links(self, text: str) -> dict[str, str]:
        links: dict[str, str] = {}
        pattern = re.compile(r'<a[^>]+href="([^"]*?/catalog/grocery/category/[^"]+)"[^>]*>(.*?)</a>', re.S)
        for href, body in pattern.findall(text):
            external_id = self._category_id_from_url(href)
            if not external_id:
                continue
            name = clean_text(re.sub(r"<[^>]+>", " ", body))
            if name:
                links[href] = name
        return links

    def _extract_category_tree(self, text: str) -> list[ParsedCategory]:
        soup = BeautifulSoup(text, "html.parser")
        categories: dict[str, ParsedCategory] = {}

        for block in soup.select('[data-testid="catalog-menu-item-collapse"][data-item-id]'):
            parent_id = block.get("data-item-id")
            parent_name = self._category_name_from_button(block)
            if not parent_id or not parent_name:
                continue

            children = self._extract_child_categories(block, parent_id)
            if children:
                if len(children) == 1 and children[0].external_id == parent_id:
                    categories[parent_id] = children[0]
                    continue
                categories[parent_id] = ParsedCategory(
                    source_code=self.source_code,
                    external_id=parent_id,
                    name=parent_name,
                    url=urljoin(self.base_url, f"/ru-kg/catalog/grocery/category/{parent_id}"),
                    is_group=True,
                )
                for child in children:
                    categories[child.external_id or child.url] = child
            else:
                categories[parent_id] = ParsedCategory(
                    source_code=self.source_code,
                    external_id=parent_id,
                    name=parent_name,
                    url=urljoin(self.base_url, f"/ru-kg/catalog/grocery/category/{parent_id}"),
                )

        return list(categories.values())

    def _extract_child_categories(self, block: Any, parent_id: str) -> list[ParsedCategory]:
        children: list[ParsedCategory] = []
        for item in block.select("ul li[data-item-id]"):
            link = item.find("a", href=True)
            child_id = item.get("data-item-id")
            if not link or not child_id:
                continue
            child_name = clean_text(link.get_text(" "))
            if not child_name:
                continue
            children.append(
                ParsedCategory(
                    source_code=self.source_code,
                    external_id=child_id,
                    name=child_name,
                    url=urljoin(self.base_url, link["href"]),
                    parent_external_id=None if child_id == parent_id else parent_id,
                )
            )
        return children

    @staticmethod
    def _category_name_from_button(block: Any) -> str:
        button = block.find("button")
        if button is None:
            return ""
        image = button.find("img", alt=True)
        if image is not None:
            name = clean_text(image.get("alt"))
            if name:
                return name
        span = button.find("span")
        return clean_text(span.get_text(" ") if span else "")

    def _iter_product_dicts(self, data: dict[str, Any]) -> list[dict[str, Any]]:
        direct = deep_get(data, "products", "regular")
        if isinstance(direct, list):
            return [item for item in direct if isinstance(item, dict) and item.get("type") == "good"]
        return [
            item
            for item in walk_dicts(data)
            if item.get("type") == "good" and (item.get("title") or item.get("longTitle"))
        ]

    @staticmethod
    def _category_id_from_url(url: str) -> str | None:
        match = re.search(r"/category/([^/?#]+)", url)
        return match.group(1) if match else None


def walk_dicts(value: Any) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    if isinstance(value, dict):
        found.append(value)
        for child in value.values():
            found.extend(walk_dicts(child))
    elif isinstance(value, list):
        for child in value:
            found.extend(walk_dicts(child))
    return found


def deep_get(value: dict[str, Any], *path: str) -> Any:
    current: Any = value
    for key in path:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def to_decimal(value: Any) -> Decimal | None:
    if value in (None, ""):
        return None
    try:
        return Decimal(str(value).replace(",", ".")).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        return None


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    text = html.unescape(str(value)).replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip()


def parse_unit(amount: Any, options: dict[str, Any] | None = None) -> str | None:
    text = clean_text(amount)
    if "кг" in text.lower():
        return "кг"
    if options and options.get("quantityType") == "weight":
        return "кг"
    if text.startswith("за 1"):
        return text.replace("за 1", "").strip() or None
    return "шт." if text else None


def normalize_image_url(value: Any) -> str | None:
    if not value:
        return None
    url = str(value)
    return url.replace("{w}x{h}", "800x800")


def stable_product_hash(product_url: str | None, name: str, category_name: str | None) -> str:
    raw = "|".join(part or "" for part in (product_url, name, category_name))
    return "hash_" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]
