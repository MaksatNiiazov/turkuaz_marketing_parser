from __future__ import annotations

from datetime import date
from io import BytesIO
import re

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from sqlalchemy.orm import Session

from app.modules.market_parser.repositories.product_repo import ProductRepository
from app.modules.market_parser.repositories.snapshot_repo import SnapshotRepository
from app.modules.market_parser.services.stats_service import StatsService, effective_price


class ExportService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.products = ProductRepository(db)
        self.snapshots = SnapshotRepository(db)
        self.stats = StatsService(db)

    def products_xlsx(self) -> BytesIO:
        products = self.products.list()
        latest = {
            snapshot.product_id: snapshot
            for snapshot in self.snapshots.latest_by_product_ids([product.id for product in products])
        }
        wb = self._base_workbook()
        ws = wb["Товары"]
        product_rows = []
        self._write_header(
            ws,
            [
                "source",
                "sku",
                "name",
                "title",
                "parent_category",
                "category",
                "price",
                "discount_price",
                "media",
                "product_url",
                "is_available",
                "collected_at",
            ],
        )
        for product in products:
            snapshot = latest.get(product.id)
            row = self._product_export_row(product, snapshot)
            product_rows.append(row)
            ws.append(row)
        self._category_sheets(wb, product_rows)
        self._summary_sheet(wb)
        return save_workbook(wb)

    def stats_xlsx(
        self, from_date: date | None = None, to_date: date | None = None, category_id: int | None = None
    ) -> BytesIO:
        wb = self._base_workbook()
        products = self.products.list(category_id=category_id)
        product_ids = [product.id for product in products]
        latest = {s.product_id: s for s in self.snapshots.latest_by_product_ids(product_ids)}

        ws_products = wb["Товары"]
        product_rows = []
        self._write_header(
            ws_products,
            ["sku", "name", "title", "parent_category", "category", "current_price", "discount_price", "media"],
        )
        for product in products:
            snapshot = latest.get(product.id)
            product_sku = export_sku(product)
            parent_name, category_name = category_names(product)
            row = [
                product_sku,
                product.name,
                product.unit,
                parent_name,
                category_name,
                effective_price(snapshot) if snapshot else None,
                snapshot.discount_price if snapshot else None,
                product.image_url,
            ]
            product_rows.append(row)
            ws_products.append(row)

        ws_prices = wb["Цены"]
        self._write_header(ws_prices, ["date", "sku", "name", "price", "discount_price", "effective_price"])
        ws_discounts = wb["Скидки"]
        self._write_header(ws_discounts, ["date", "sku", "name", "price", "discount_price", "discount_percent"])
        for product in products:
            for snapshot in self.snapshots.list_for_product(product.id, from_date, to_date):
                ws_prices.append(
                    [
                        snapshot.collected_at,
                        export_sku(product),
                        product.name,
                        snapshot.price,
                        snapshot.discount_price,
                        effective_price(snapshot),
                    ]
                )
                if snapshot.discount_price is not None or snapshot.discount_percent is not None:
                    ws_discounts.append(
                        [
                            snapshot.collected_at,
                            export_sku(product),
                            product.name,
                            snapshot.price,
                            snapshot.discount_price,
                            snapshot.discount_percent,
                        ]
                    )

        ws_changes = wb["Изменения"]
        self._write_header(ws_changes, ["product_id", "name", "first_price", "last_price", "change_percent"])
        if category_id is not None:
            for item in self.stats.price_changes(from_date, to_date, category_id=category_id):
                ws_changes.append(
                    [item.product_id, item.name, item.first_price, item.last_price, item.change_percent]
                )

        self._category_sheets(
            wb,
            product_rows,
            headers=["sku", "name", "title", "parent_category", "category", "current_price", "discount_price", "media"],
            parent_index=3,
        )
        self._summary_sheet(wb)
        return save_workbook(wb)

    def _product_export_row(self, product, snapshot) -> list:
        parent_name, category_name = category_names(product)
        return [
            product.source.code,
            export_sku(product),
            product.name,
            product.unit,
            parent_name,
            category_name,
            snapshot.price if snapshot else None,
            snapshot.discount_price if snapshot else None,
            product.image_url,
            product.product_url,
            snapshot.is_available if snapshot else None,
            snapshot.collected_at if snapshot else None,
        ]

    def _category_sheets(
        self,
        wb: Workbook,
        rows: list[list],
        headers: list[str] | None = None,
        parent_index: int = 4,
    ) -> None:
        if headers is None:
            headers = [
                "source",
                "sku",
                "name",
                "title",
                "parent_category",
                "category",
                "price",
                "discount_price",
                "media",
                "product_url",
                "is_available",
                "collected_at",
            ]
        grouped: dict[str, list[list]] = {}
        for row in rows:
            parent_name = row[parent_index] or "Без категории"
            grouped.setdefault(str(parent_name), []).append(row)
        for parent_name, parent_rows in sorted(grouped.items()):
            title = unique_sheet_title(wb, parent_name)
            ws = wb.create_sheet(title)
            self._write_header(ws, headers)
            for row in parent_rows:
                ws.append(row)

    def _base_workbook(self) -> Workbook:
        wb = Workbook()
        wb.active.title = "Товары"
        for title in ["Цены", "Скидки", "Изменения", "Свод"]:
            wb.create_sheet(title)
        return wb

    def _summary_sheet(self, wb: Workbook) -> None:
        ws = wb["Свод"]
        self._write_header(ws, ["Метрика", "Значение"])
        ws.append(["Источник", "Globus Online"])
        ws.append(["Совместимые поля", "sku, name, title, price, discount_price, media"])

    @staticmethod
    def _write_header(ws, values: list[str]) -> None:
        ws.append(values)
        fill = PatternFill("solid", fgColor="D9EAF7")
        for cell in ws[1]:
            cell.font = Font(bold=True)
            cell.fill = fill
        ws.freeze_panes = "A2"


def save_workbook(wb: Workbook) -> BytesIO:
    for ws in wb.worksheets:
        for column_cells in ws.columns:
            max_len = max(len(str(cell.value or "")) for cell in column_cells)
            ws.column_dimensions[column_cells[0].column_letter].width = min(max(max_len + 2, 10), 48)
    output = BytesIO()
    wb.save(output)
    output.seek(0)
    return output


def category_names(product) -> tuple[str | None, str | None]:
    category = product.category
    if category is None:
        return None, None
    if category.parent is not None:
        return category.parent.name, category.name
    return category.name, category.name


def export_sku(product) -> str:
    return product.sku or product.external_sku


def unique_sheet_title(wb: Workbook, value: str) -> str:
    title = re.sub(r"[\[\]:*?/\\]", " ", value).strip() or "Категория"
    title = title[:31]
    if title not in wb.sheetnames:
        return title
    base = title[:28]
    index = 2
    while f"{base} {index}" in wb.sheetnames:
        index += 1
    return f"{base} {index}"
