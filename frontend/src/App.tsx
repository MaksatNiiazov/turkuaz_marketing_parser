import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  AppShell,
  fetchCurrentIdentityUser,
  fetchServiceRegistry,
  Icon,
  serviceLinksFromRegistry,
} from '@turkuaz/ui';
import type { CurrentIdentityUser, ServiceRegistryItem } from '@turkuaz/ui';
import {
  clearToken,
  DEV_ADMIN_LOGIN_ENABLED,
  DEV_ADMIN_EMAIL,
  DEV_ADMIN_PASSWORD,
  downloadFile,
  fetchCategories,
  fetchCategoryStats,
  fetchProductCategorySegments,
  fetchRun,
  fetchProductSnapshots,
  fetchProductStats,
  fetchProductPage,
  fetchProductSummary,
  fetchPriceChanges,
  fetchProducts,
  fetchRuns,
  fetchSources,
  fetchTopDiscounts,
  getToken,
  login,
  loginAsDevAdmin,
  setCategoryEnabled,
  startRun,
  stopRun,
  syncCategories,
} from './lib/api';
import type {
  CategoryStats,
  MarketProduct,
  ParserCategory,
  ParserRun,
  ParserSource,
  PriceChangeItem,
  ProductCategorySegment,
  ProductDiscountItem,
  ProductSnapshot,
  ProductStats,
} from './lib/types';

const IDENTITY_API_BASE_URL = import.meta.env.VITE_IDENTITY_API_BASE_URL || '/identity-api';
const API_DOCS_URL = backendUrl(8503, '/docs');

type ViewMode = 'categories' | 'runs' | 'products' | 'reports' | 'export';

type LoadState = {
  loading: boolean;
  error: string | null;
};

type ProductFilters = {
  name: string;
  sku: string;
  categoryId: string;
  discountMode: 'all' | 'with' | 'without';
  availabilityMode: 'all' | 'available' | 'unavailable';
  from: string;
  to: string;
};

const initialProductFilters: ProductFilters = {
  name: '',
  sku: '',
  categoryId: '',
  discountMode: 'all',
  availabilityMode: 'all',
  from: '',
  to: '',
};

export function App() {
  const [view, setView] = useState<ViewMode>('categories');
  const [sources, setSources] = useState<ParserSource[]>([]);
  const [categories, setCategories] = useState<ParserCategory[]>([]);
  const [runs, setRuns] = useState<ParserRun[]>([]);
  const [products, setProducts] = useState<MarketProduct[]>([]);
  const [productCount, setProductCount] = useState(0);
  const [productSegments, setProductSegments] = useState<ProductCategorySegment[]>([]);
  const [productTotal, setProductTotal] = useState(0);
  const [productPage, setProductPage] = useState(1);
  const [productPageSize, setProductPageSize] = useState(50);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productLoadVersion, setProductLoadVersion] = useState(0);
  const [selectedSourceId, setSelectedSourceId] = useState<number | null>(null);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [selectedProductRecord, setSelectedProductRecord] = useState<MarketProduct | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [productStats, setProductStats] = useState<ProductStats | null>(null);
  const [categoryStats, setCategoryStats] = useState<CategoryStats | null>(null);
  const [snapshots, setSnapshots] = useState<ProductSnapshot[]>([]);
  const [state, setState] = useState<LoadState>({ loading: false, error: null });
  const [actionState, setActionState] = useState<LoadState>({ loading: false, error: null });
  const [exportState, setExportState] = useState<LoadState>({ loading: false, error: null });
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<ProductFilters>(initialProductFilters);
  const [parseAllEnabled, setParseAllEnabled] = useState(true);
  const [currentUser, setCurrentUser] = useState<CurrentIdentityUser | null>(null);
  const [serviceApps, setServiceApps] = useState<ServiceRegistryItem[]>([]);
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(getToken()));

  const selectedSource = sources.find((source) => source.id === selectedSourceId) ?? sources[0] ?? null;
  const selectedProduct =
    selectedProductRecord && selectedProductRecord.id === selectedProductId
      ? selectedProductRecord
      : products.find((product) => product.id === selectedProductId) ?? products[0] ?? null;
  const parentCategoryIds = new Set(categories.map((category) => category.parent_id).filter(Boolean));
  const enabledCategories = categories.filter((category) => category.is_enabled && !parentCategoryIds.has(category.id));
  const latestRun = runs[0] ?? null;
  const parsedDateKeys = parserRunDateKeys(runs);

  const loadData = useCallback(async () => {
    if (!getToken()) {
      setIsAuthenticated(false);
      setState({ loading: false, error: null });
      return;
    }
    setState({ loading: true, error: null });
    try {
      const [me, serviceRows] = await Promise.all([
        fetchCurrentIdentityUser({
          identityApiBaseUrl: IDENTITY_API_BASE_URL,
          tokenStorageKeys: ['identity_access_token', 'access_token'],
        }),
        fetchServiceRegistry({ identityApiBaseUrl: IDENTITY_API_BASE_URL }).catch(() => [] as ServiceRegistryItem[]),
      ]);
      const sourceRows = await fetchSources();
      const sourceId = selectedSourceId ?? sourceRows[0]?.id ?? null;
      const [categoryRows, runRows, productSummary, segmentSummary] = await Promise.all([
        sourceId ? fetchCategories(sourceId) : Promise.resolve([]),
        sourceId ? fetchRuns(sourceId) : Promise.resolve([]),
        fetchProductSummary(sourceId ?? undefined),
        fetchProductCategorySegments(sourceId ?? undefined),
      ]);
      setCurrentUser(me);
      setServiceApps(serviceRows);
      setIsAuthenticated(true);
      setSources(sourceRows);
      setSelectedSourceId(sourceId);
      setCategories(categoryRows);
      setRuns(runRows);
      setProducts([]);
      setProductCount(productSummary.count);
      setProductSegments(segmentSummary.items);
      setProductTotal(productSummary.count);
      setProductPage(1);
      setProductLoadVersion((version) => version + 1);
      setSelectedCategoryId((current) =>
        current && categoryRows.some((category) => category.id === current)
          ? current
          : categoryRows[0]?.id ?? null,
      );
      setSelectedProductId(null);
      setSelectedProductRecord(null);
      setState({ loading: false, error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isAuthError(message)) {
        setIsAuthenticated(false);
        setCurrentUser(null);
      }
      setState({ loading: false, error: message });
    }
  }, [selectedSourceId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if ((view === 'products' || view === 'reports') && selectedSource) {
      void loadProducts(productPage, productPageSize);
    }
  }, [view, selectedSource?.id, productLoadVersion, productPage, productPageSize]);

  useEffect(() => {
    if (!selectedProduct) {
      setProductStats(null);
      setSnapshots([]);
      return;
    }
    const period = { from: filters.from || undefined, to: filters.to || undefined };
    void Promise.all([
      fetchProductStats(selectedProduct.id, period),
      fetchProductSnapshots(selectedProduct.id, period),
    ])
      .then(([stats, rows]) => {
        setProductStats(stats);
        setSnapshots(rows);
      })
      .catch((error) =>
        setActionState({ loading: false, error: error instanceof Error ? error.message : String(error) }),
      );
  }, [selectedProduct, filters.from, filters.to]);

  useEffect(() => {
    if (!selectedCategoryId) {
      setCategoryStats(null);
      return;
    }
    void fetchCategoryStats(selectedCategoryId, {
      from: filters.from || undefined,
      to: filters.to || undefined,
    })
      .then(setCategoryStats)
      .catch((error) =>
        setActionState({ loading: false, error: error instanceof Error ? error.message : String(error) }),
      );
  }, [selectedCategoryId, filters.from, filters.to]);

  useEffect(() => {
    const trackedRunId = activeRunId ?? runs.find((run) => isRunActive(run))?.id ?? null;
    if (!trackedRunId) return undefined;

    const timer = window.setInterval(() => {
      void fetchRun(trackedRunId)
        .then((run) => {
          setRuns((rows) => [run, ...rows.filter((item) => item.id !== run.id)]);
          if (!isRunActive(run)) {
            setActiveRunId(null);
            void refreshProductSummary();
            if (view === 'products' || view === 'reports') void loadProducts(productPage, productPageSize);
          }
        })
        .catch((error) =>
          setActionState({ loading: false, error: error instanceof Error ? error.message : String(error) }),
        );
    }, 1500);

    return () => window.clearInterval(timer);
  }, [activeRunId, runs, selectedSource?.id, view]);

  async function handleSyncCategories() {
    if (!selectedSource) return;
    setActionState({ loading: true, error: null });
    try {
      const rows = await syncCategories(selectedSource.id);
      setCategories(rows);
      setSelectedCategoryIds([]);
      setActionState({ loading: false, error: null });
    } catch (error) {
      setActionState({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  async function handleToggleCategory(category: ParserCategory, enabled: boolean) {
    setActionState({ loading: true, error: null });
    try {
      const updated = await setCategoryEnabled(category.id, enabled);
      setCategories((rows) => rows.map((item) => (item.id === updated.id ? updated : item)));
      setActionState({ loading: false, error: null });
    } catch (error) {
      setActionState({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  async function handleStartRun() {
    if (!selectedSource) return;
    setActionState({ loading: true, error: null });
    try {
      const run = await startRun({
        source_id: selectedSource.id,
        category_ids: selectedCategoryIds,
        parse_all_enabled: parseAllEnabled,
        created_by: currentUser?.email || 'market-parser-ui',
      });
      setRuns((rows) => [run, ...rows.filter((item) => item.id !== run.id)]);
      setActiveRunId(run.id);
      setActionState({ loading: false, error: null });
      setView('categories');
    } catch (error) {
      setActionState({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  async function handleStopRun(runId: number) {
    setActionState({ loading: true, error: null });
    try {
      const run = await stopRun(runId);
      setRuns((rows) => [run, ...rows.filter((item) => item.id !== run.id)]);
      setActiveRunId(run.id);
      setActionState({ loading: false, error: null });
    } catch (error) {
      setActionState({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  async function handleExportRun(runId: number) {
    await handleDownloadExcel(
      `/api/v1/market-parser/export/products.xlsx?run_id=${runId}`,
      `market_run_${runId}.xlsx`,
    );
  }

  async function handleDownloadExcel(path: string, filename: string) {
    setExportState({ loading: true, error: null });
    try {
      await downloadFile(path, filename);
      setExportState({ loading: false, error: null });
    } catch (error) {
      setExportState({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  async function loadProducts(page = productPage, pageSize = productPageSize) {
    setActionState({ loading: true, error: null });
    setProductsLoading(true);
    try {
      const offset = (page - 1) * pageSize;
      const pageData = await fetchProductPage({
        source_id: selectedSource?.id,
        category_id: filters.categoryId ? Number(filters.categoryId) : undefined,
        name: filters.name || undefined,
        sku: filters.sku || undefined,
        has_discount: discountFilterValue(filters.discountMode),
        is_available: availabilityFilterValue(filters.availabilityMode),
        from: filters.from || undefined,
        to: filters.to || undefined,
        limit: pageSize,
        offset,
      });
      const rows = pageData.items;
      setProducts(rows);
      setProductTotal(pageData.total);
      setSelectedProductId((current) => {
        const selected = current ? rows.find((product) => product.id === current) : null;
        const next = selected ?? rows[0] ?? null;
        setSelectedProductRecord(next);
        return next?.id ?? null;
      });
      setActionState({ loading: false, error: null });
      setProductsLoading(false);
    } catch (error) {
      setActionState({ loading: false, error: error instanceof Error ? error.message : String(error) });
      setProductsLoading(false);
    }
  }

  async function refreshProductSummary() {
    try {
      const [summary, segmentSummary] = await Promise.all([
        fetchProductSummary(selectedSource?.id),
        fetchProductCategorySegments(selectedSource?.id),
      ]);
      setProductCount(summary.count);
      setProductSegments(segmentSummary.items);
    } catch (error) {
      setActionState({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  function handleLogout() {
    clearToken();
    setIsAuthenticated(false);
    setCurrentUser(null);
    setServiceApps([]);
    setSources([]);
    setSelectedSourceId(null);
    setCategories([]);
    setRuns([]);
    setProducts([]);
    setProductCount(0);
    setProductSegments([]);
    setProductTotal(0);
    setProductPage(1);
    setProductPageSize(50);
    setProductsLoading(false);
    setProductLoadVersion(0);
    setSelectedCategoryIds([]);
    setActiveRunId(null);
    setSelectedProductId(null);
    setSelectedProductRecord(null);
    setSelectedCategoryId(null);
    setProductStats(null);
    setCategoryStats(null);
    setSnapshots([]);
    setState({ loading: false, error: null });
    setActionState({ loading: false, error: null });
  }

  const visibleCategories = filterCategoryTree(categories, query);

  const metrics = [
    { label: 'Источники', value: sources.length, icon: 'database' as const },
    { label: 'Категории', value: categories.length, icon: 'sliders' as const },
    { label: 'Включены', value: enabledCategories.length, icon: 'shield' as const },
    { label: 'Товары', value: productCount, icon: 'qr' as const },
  ];

  const navItems = [
    { key: 'categories', label: 'Категории', icon: 'sliders' as const, active: view === 'categories', onClick: () => setView('categories') },
    { key: 'runs', label: 'Запуски', icon: 'activity' as const, active: view === 'runs', onClick: () => setView('runs') },
    { key: 'products', label: 'Товары', icon: 'database' as const, active: view === 'products', onClick: () => setView('products') },
    { key: 'reports', label: 'Отчеты', icon: 'dashboard' as const, active: view === 'reports', onClick: () => setView('reports') },
    { key: 'export', label: 'Экспорт', icon: 'file' as const, active: view === 'export', onClick: () => setView('export') },
  ];

  const pageTitle = {
    categories: 'Market Parser',
    runs: 'История запусков',
    products: 'Товары и цены',
    reports: 'Аналитика',
    export: 'Экспорт Excel',
  }[view];

  const pageDescription = {
    categories: 'Источники, категории Globus и ручной запуск парсинга.',
    runs: 'Статусы запусков, найденные товары и ошибки по категориям.',
    products: 'Каталог товаров, snapshots и история цены.',
    reports: 'Статистика по товару и категории за выбранный период.',
    export: 'Готовые Excel выгрузки для маркетинга.',
  }[view];

  if (!isAuthenticated) {
    return (
      <LoginScreen
        error={state.error}
        onLoggedIn={() => {
          setIsAuthenticated(true);
          void loadData();
        }}
      />
    );
  }

  return (
    <AppShell
      brand={{
        href: '/',
        mark: 'T',
        title: 'Turkuaz Markets',
        subtitle: currentUser?.email || selectedSource?.name || 'Market Parser',
      }}
      navItems={navItems}
      sideLinks={[
        ...serviceLinksFromRegistry(serviceApps, { currentServiceCode: 'market_parser' }),
        { href: API_DOCS_URL, label: 'Swagger', icon: 'file', permissions: ['market_parser.products.read'] },
      ]}
      accessClaims={currentUser}
      tokenStorageKeys={['identity_access_token', 'access_token']}
      serviceName="Market Parser"
      pageTitle={pageTitle}
      pageDescription={pageDescription}
      breadcrumbs={[{ label: 'Marketing' }, { label: pageTitle }]}
      search={{
        value: query,
        placeholder: view === 'products' ? 'Поиск товара' : 'Поиск категории',
        onChange: setQuery,
      }}
      branchSelector={{
        label: 'Источник',
        value: selectedSourceId ? String(selectedSourceId) : '',
        options: sources.map((source) => ({ value: String(source.id), label: source.name })),
        onChange: (value) => setSelectedSourceId(Number(value)),
      }}
      headerActions={[
        { key: 'refresh', label: 'Обновить', icon: 'refresh', onClick: () => void loadData() },
      ]}
      user={
        currentUser
          ? {
              name: currentUser.full_name || currentUser.email,
              email: currentUser.email,
              role: currentUser.roles[0],
              actions: [{ key: 'logout', label: 'Выйти', icon: 'logout', onClick: handleLogout }],
            }
          : undefined
      }
      environment="local"
      version="v0.1.0"
      apiStatus={isConnectivityError(state.error || actionState.error) ? 'offline' : 'online'}
      footerLinks={[{ href: API_DOCS_URL, label: 'Swagger' }]}
    >
      {state.error || actionState.error || exportState.error ? (
        <div className="notice">{errorMessage(state.error || actionState.error || exportState.error)}</div>
      ) : null}
      <GlobalExportIndicator active={exportState.loading} />

      <section className="metrics-grid" aria-label="Market parser metrics">
        {metrics.map((metric) => (
          <div className="metric" key={metric.label}>
            <Icon name={metric.icon} size={20} />
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </div>
        ))}
      </section>

      {view === 'categories' ? (
        <CategoriesView
          categories={visibleCategories}
          allCategories={categories}
          selectedCategoryIds={selectedCategoryIds}
          parseAllEnabled={parseAllEnabled}
          loading={state.loading || actionState.loading}
          latestRun={latestRun}
          onSelectCategories={setSelectedCategoryIds}
          onSync={() => void handleSyncCategories()}
          onRun={() => void handleStartRun()}
          onStopRun={(runId) => void handleStopRun(runId)}
          onToggleParseAll={setParseAllEnabled}
          onToggleCategory={(category, enabled) => void handleToggleCategory(category, enabled)}
        />
      ) : null}

      {view === 'runs' ? (
        <RunsView
          runs={runs}
          loading={actionState.loading}
          onExportRun={(runId) => void handleExportRun(runId)}
          onStopRun={(runId) => void handleStopRun(runId)}
        />
      ) : null}

      {view === 'products' ? (
        <ProductsView
          categories={categories}
          products={products}
          selectedProduct={selectedProduct}
          snapshots={snapshots}
          stats={productStats}
          filters={filters}
          markedDateKeys={parsedDateKeys}
          loading={actionState.loading || productsLoading}
          productsLoading={productsLoading}
          totalItems={productTotal}
          page={productPage}
          pageSize={productPageSize}
          onFilterChange={setFilters}
          onApplyFilters={() => {
            setProductPage(1);
            void loadProducts(1, productPageSize);
          }}
          onPageChange={setProductPage}
          onPageSizeChange={(pageSize) => {
            setProductPageSize(pageSize);
            setProductPage(1);
          }}
          onSelectProduct={handleSelectProduct}
        />
      ) : null}

      {view === 'reports' ? (
        <ReportsView
          categories={categories}
          products={products}
          runs={runs}
          productCount={productCount}
          productSegments={productSegments}
          selectedCategoryId={selectedCategoryId}
          selectedProduct={selectedProduct}
          productStats={productStats}
          categoryStats={categoryStats}
          latestRun={latestRun}
          productsLoading={productsLoading}
          filters={filters}
          markedDateKeys={parsedDateKeys}
          onSelectCategory={setSelectedCategoryId}
          onSelectProduct={handleSelectProduct}
          onFilterChange={setFilters}
        />
      ) : null}

      {view === 'export' ? (
        <ExportView
          categories={categories}
          filters={filters}
          markedDateKeys={parsedDateKeys}
          selectedSourceId={selectedSourceId}
          exportState={exportState}
          onFilterChange={setFilters}
          onDownload={handleDownloadExcel}
        />
      ) : null}
    </AppShell>
  );

  function handleSelectProduct(product: MarketProduct | null) {
    setSelectedProductId(product?.id ?? null);
    setSelectedProductRecord(product);
  }
}

function LoginScreen({
  error,
  onLoggedIn,
}: {
  error: string | null;
  onLoggedIn: () => void;
}) {
  const [email, setEmail] = useState(DEV_ADMIN_EMAIL);
  const [password, setPassword] = useState(DEV_ADMIN_PASSWORD);
  const [submitState, setSubmitState] = useState<LoadState>({ loading: false, error: null });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitState({ loading: true, error: null });
    try {
      await login(email, password);
      setSubmitState({ loading: false, error: null });
      onLoggedIn();
    } catch (submitError) {
      setSubmitState({
        loading: false,
        error: submitError instanceof Error ? submitError.message : String(submitError),
      });
    }
  }

  async function handleDevAdminLogin() {
    setSubmitState({ loading: true, error: null });
    try {
      await loginAsDevAdmin();
      setSubmitState({ loading: false, error: null });
      onLoggedIn();
    } catch (submitError) {
      setSubmitState({
        loading: false,
        error: submitError instanceof Error ? submitError.message : String(submitError),
      });
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="login-mark">T</div>
        <div>
          <p className="login-kicker">Turkuaz Ecosystem</p>
          <h1>Market Parser</h1>
          <p>Войдите через центральный сервис Identity.</p>
        </div>
        {error || submitState.error ? <div className="notice">{submitState.error || error}</div> : null}
        <form className="login-form" onSubmit={(event) => void handleSubmit(event)}>
          <label>
            <span>Email</span>
            <input
              autoComplete="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            <span>Пароль</span>
            <input
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <button className="primary-button" type="submit" disabled={submitState.loading}>
            <Icon name="shield" size={16} />
            Войти
          </button>
          {DEV_ADMIN_LOGIN_ENABLED ? (
            <button
              className="secondary-button"
              type="button"
              disabled={submitState.loading}
              onClick={() => void handleDevAdminLogin()}
            >
              <Icon name="key" size={16} />
              Войти как локальный админ
            </button>
          ) : null}
        </form>
      </section>
    </main>
  );
}

function backendUrl(port: number, path = ''): string {
  if (typeof window === 'undefined') return `http://localhost:${port}${path}`;
  return `${window.location.protocol}//${window.location.hostname}:${port}${path}`;
}

function CategoryCheckbox({
  checked,
  disabled,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  indeterminate: boolean;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return <input ref={ref} type="checkbox" disabled={disabled} checked={checked} onChange={onChange} />;
}

function MarketingDashboard({
  categories,
  productCount,
  productSegments,
  selectedCategory,
  categoryStats,
  latestRun,
}: {
  categories: ParserCategory[];
  productCount: number;
  productSegments: ProductCategorySegment[];
  selectedCategory: ParserCategory | null;
  categoryStats: CategoryStats | null;
  latestRun: ParserRun | null;
}) {
  const leafCategoryIds = leafCategories(categories);
  const enabledLeafCount = categories.filter((category) => leafCategoryIds.has(category.id) && category.is_enabled).length;
  const enabledPercent = leafCategoryIds.size ? Math.round((enabledLeafCount / leafCategoryIds.size) * 100) : 0;
  const latestSavedRatio = latestRun?.total_products
    ? Math.round((latestRun.saved_products / latestRun.total_products) * 100)
    : 0;
  const discountedPercent = categoryStats?.products_count
    ? Math.round((categoryStats.discounted_products_count / categoryStats.products_count) * 100)
    : 0;
  const availablePercent = categoryStats?.products_count
    ? Math.round((categoryStats.available_products_count / categoryStats.products_count) * 100)
    : 0;
  const moversTotal = (categoryStats?.price_increased_products ?? 0) + (categoryStats?.price_decreased_products ?? 0);
  const increasedPercent = moversTotal
    ? Math.round(((categoryStats?.price_increased_products ?? 0) / moversTotal) * 100)
    : 0;
  const focusName = selectedCategory?.name ?? 'Выбранная категория';
  const focusProducts = categoryStats?.products_count ?? 0;
  const discountedCount = categoryStats?.discounted_products_count ?? 0;
  const availableCount = categoryStats?.available_products_count ?? 0;
  const regularCount = Math.max(0, focusProducts - discountedCount);
  const unavailableCount = Math.max(0, focusProducts - availableCount);
  const focusSignals = [
    { label: 'Со скидкой', value: discountedCount, total: focusProducts, tone: 'discount' },
    { label: 'Без скидки', value: regularCount, total: focusProducts, tone: 'regular' },
    { label: 'В наличии', value: availableCount, total: focusProducts, tone: 'available' },
    { label: 'Нет в наличии', value: unavailableCount, total: focusProducts, tone: 'attention' },
  ];

  return (
    <section className="marketing-dashboard">
      <div className="panel dashboard-panel dashboard-hero">
        <div className="dashboard-title">
          <div>
            <h2>Маркетинговый обзор</h2>
            <p>Ассортимент, активность парсинга и скидочные сигналы в одном месте.</p>
          </div>
          <span>{latestRun ? `Обновлено: ${formatDate(latestRun.finished_at || latestRun.created_at)}` : 'Данных пока мало'}</span>
        </div>
        <div className="dashboard-kpis">
          <DashboardKpi label="Ассортимент" value={productCount.toLocaleString('ru-RU')} hint="товаров в каталоге" />
          <DashboardKpi label="Активные разделы" value={`${enabledPercent}%`} hint={`${enabledLeafCount}/${leafCategoryIds.size || 0} включены`} />
          <DashboardKpi label="Сохранено в запуске" value={`${latestSavedRatio}%`} hint={latestRun ? `${latestRun.saved_products}/${latestRun.total_products}` : '-'} />
          <DashboardKpi label="Скидки в фокусе" value={`${discountedPercent}%`} hint={focusName} />
        </div>
      </div>

      <div className="panel dashboard-panel signal-panel">
        <div className="mini-panel-head">
          <h3>Сигналы категории</h3>
          <span>{focusName}</span>
        </div>
        <div className="signal-grid">
          {focusSignals.map((item) => {
            const width = item.total ? Math.round((item.value / item.total) * 100) : 0;
            return (
              <div className={`signal-card ${item.tone}`} key={item.label}>
                <div>
                  <span>{item.label}</span>
                  <strong>{item.value.toLocaleString('ru-RU')}</strong>
                </div>
                <div className="signal-track">
                  <span style={{ width: `${width}%` }} />
                </div>
                <small>{width}% от выбранной категории</small>
              </div>
            );
          })}
        </div>
      </div>

      <div className="panel dashboard-panel">
        <div className="mini-panel-head">
          <h3>Ассортимент по разделам</h3>
          <span>топ категорий</span>
        </div>
        <div className="bar-list">
          {productSegments.length ? productSegments.map((item) => (
            <div className="bar-row" key={item.label}>
              <div>
                <strong>{item.label}</strong>
                <span>{item.count.toLocaleString('ru-RU')} товаров</span>
              </div>
              <div className="bar-track">
                <span style={{ width: `${item.percent}%` }} />
              </div>
              <b>{item.percent}%</b>
            </div>
          )) : <div className="empty-state">Категории появятся после синхронизации и парсинга.</div>}
        </div>
      </div>

      <div className="panel dashboard-panel">
        <div className="mini-panel-head">
          <h3>{focusName}</h3>
          <span>скидки и наличие</span>
        </div>
        <div className="focus-grid">
          <GaugeCard label="Со скидкой" value={discountedPercent} detail={`${categoryStats?.discounted_products_count ?? 0} товаров`} />
          <GaugeCard label="В наличии" value={availablePercent} detail={`${categoryStats?.available_products_count ?? 0} товаров`} />
          <div className="price-movers">
            <div className="mover-head">
              <span>Изменение цены</span>
              <strong>{moversTotal ? `${moversTotal} товаров` : '-'}</strong>
            </div>
            <div className="split-bar">
              <span className="up" style={{ width: `${increasedPercent}%` }} />
              <span className="down" style={{ width: `${100 - increasedPercent}%` }} />
            </div>
            <div className="mover-legend">
              <span>↑ {categoryStats?.price_increased_products ?? 0}</span>
              <span>↓ {categoryStats?.price_decreased_products ?? 0}</span>
            </div>
          </div>
        </div>
        {categoryStats?.top_discounted_products?.length ? (
          <div className="top-discount-strip">
            {categoryStats.top_discounted_products.slice(0, 3).map((item) => (
              <div key={item.product_id}>
                <strong>{percent(item.discount_percent)}</strong>
                <span>{item.name}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function DashboardKpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="dashboard-kpi">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}

function GaugeCard({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="gauge-card">
      <div className="gauge" style={{ background: `conic-gradient(var(--teal) ${value * 3.6}deg, var(--surface-muted) 0deg)` }}>
        <span>{value}%</span>
      </div>
      <strong>{label}</strong>
      <small>{detail}</small>
    </div>
  );
}

function CategoriesView({
  categories,
  allCategories,
  selectedCategoryIds,
  parseAllEnabled,
  loading,
  latestRun,
  onSelectCategories,
  onSync,
  onRun,
  onStopRun,
  onToggleParseAll,
  onToggleCategory,
}: {
  categories: ParserCategory[];
  allCategories: ParserCategory[];
  selectedCategoryIds: number[];
  parseAllEnabled: boolean;
  loading: boolean;
  latestRun: ParserRun | null;
  onSelectCategories: (ids: number[]) => void;
  onSync: () => void;
  onRun: () => void;
  onStopRun: (runId: number) => void;
  onToggleParseAll: (value: boolean) => void;
  onToggleCategory: (category: ParserCategory, enabled: boolean) => void;
}) {
  const categoryById = new Map(allCategories.map((category) => [category.id, category]));
  const childrenByParent = new Map<number, ParserCategory[]>();
  for (const category of categories) {
    if (!category.parent_id) continue;
    const rows = childrenByParent.get(category.parent_id) ?? [];
    rows.push(category);
    childrenByParent.set(category.parent_id, rows);
  }
  const roots = categories.filter((category) => !category.parent_id || !categoryById.has(category.parent_id));
  const expandableRootIds = roots
    .filter((category) => (childrenByParent.get(category.id)?.length ?? 0) > 0)
    .map((category) => category.id);
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<number[]>([]);

  useEffect(() => {
    setExpandedCategoryIds((current) => {
      const currentSet = new Set(current);
      const next = expandableRootIds.filter((id) => currentSet.has(id));
      return next.length ? next : expandableRootIds;
    });
  }, [categories.length]);

  function collectSelectableCategoryIds(category: ParserCategory): number[] {
    const childRows = childrenByParent.get(category.id) ?? [];
    if (!childRows.length) {
      return [category.id];
    }
    return childRows.flatMap((child) => collectSelectableCategoryIds(child));
  }

  function toggleSelected(category: ParserCategory) {
    const targetIds = collectSelectableCategoryIds(category);
    const nextIds = new Set(selectedCategoryIds);
    const allSelected = targetIds.every((id) => nextIds.has(id));

    for (const id of targetIds) {
      if (allSelected) {
        nextIds.delete(id);
      } else {
        nextIds.add(id);
      }
    }

    onSelectCategories([...nextIds]);
  }

  function toggleExpanded(id: number) {
    setExpandedCategoryIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  function renderCategoryRow(category: ParserCategory, level: 'parent' | 'child') {
    const childRows = childrenByParent.get(category.id) ?? [];
    const hasChildren = childRows.length > 0;
    const isExpanded = expandedCategoryIds.includes(category.id);
    const status = hasChildren ? 'group' : category.is_enabled ? 'enabled' : 'disabled';
    const selectableIds = collectSelectableCategoryIds(category);
    const selectedCount = selectableIds.filter((id) => selectedCategoryIds.includes(id)).length;
    const isSelected = selectedCount > 0 && selectedCount === selectableIds.length;
    const isPartiallySelected = selectedCount > 0 && selectedCount < selectableIds.length;
    return (
      <tr className={level === 'parent' ? 'category-group-row' : 'category-child-row'} key={category.id}>
        <td>
          <CategoryCheckbox
            disabled={parseAllEnabled || selectableIds.length === 0}
            checked={isSelected}
            indeterminate={isPartiallySelected}
            onChange={() => toggleSelected(category)}
          />
        </td>
        <td>
          <div className={level === 'parent' ? 'category-tree-cell root' : 'category-tree-cell child'}>
            {hasChildren ? (
              <button
                className="tree-toggle"
                type="button"
                aria-label={isExpanded ? 'Свернуть категорию' : 'Развернуть категорию'}
                onClick={() => toggleExpanded(category.id)}
              >
                <span aria-hidden="true">{isExpanded ? '−' : '+'}</span>
              </button>
            ) : (
              <span className="tree-spacer" />
            )}
            <div>
              <strong>{category.name}</strong>
              <small>
                {hasChildren
                  ? `${childRows.length} подкатегорий`
                  : category.parent_id
                    ? categoryById.get(category.parent_id)?.name ?? 'Подкатегория'
                    : 'Раздел'}
              </small>
            </div>
          </div>
        </td>
        <td><code>{category.external_id || '-'}</code></td>
        <td><StatusBadge value={status} /></td>
        <td>
          {hasChildren ? (
            <span className="muted-action">Группа</span>
          ) : (
            <button className="text-button compact-button" type="button" onClick={() => onToggleCategory(category, !category.is_enabled)}>
              {category.is_enabled ? 'Выключить' : 'Включить'}
            </button>
          )}
        </td>
      </tr>
    );
  }

  return (
    <section className="content-grid parser-grid">
      <div className="panel table-panel">
        <div className="panel-header">
          <div>
            <h2>Категории Globus</h2>
            <p>{categories.length ? 'Включайте разделы и запускайте сбор.' : 'Синхронизируйте разделы с сайта.'}</p>
          </div>
          <div className="button-row">
            <button className="text-button" type="button" disabled={loading} onClick={onSync}>
              <Icon name="refresh" size={15} />
              Синхронизировать
            </button>
            <button className="primary-button" type="button" disabled={loading || (!parseAllEnabled && selectedCategoryIds.length === 0)} onClick={onRun}>
              <Icon name="activity" size={15} />
              Запустить парсинг
            </button>
            {latestRun && isRunActive(latestRun) ? (
              <button className="text-button danger-button" type="button" disabled={loading} onClick={() => onStopRun(latestRun.id)}>
                Остановить
              </button>
            ) : null}
          </div>
        </div>

        <div className="run-mode">
          <label className="check-row">
            <input type="checkbox" checked={parseAllEnabled} onChange={(event) => onToggleParseAll(event.target.checked)} />
            <span>Парсить все включенные категории</span>
          </label>
          <span>{parseAllEnabled ? 'Будут обработаны все активные разделы.' : `Выбрано: ${selectedCategoryIds.length}`}</span>
        </div>
        {latestRun ? <RunProgress run={latestRun} /> : null}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th />
                <th>Раздел</th>
                <th>External ID</th>
                <th>Статус</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {roots.map((category) => {
                const childRows = childrenByParent.get(category.id) ?? [];
                const visibleChildren = expandedCategoryIds.includes(category.id) ? childRows : [];
                return [renderCategoryRow(category, 'parent'), ...visibleChildren.map((child) => renderCategoryRow(child, 'child'))];
              })}
            </tbody>
          </table>
        </div>
      </div>

      <aside className="side-stack">
        <div className="panel detail-panel">
          <div className="panel-header compact">
            <div>
              <h2>Последний запуск</h2>
              <p>{latestRun ? formatDate(latestRun.created_at) : 'Запусков пока нет.'}</p>
            </div>
          </div>
          {latestRun ? (
            <div className="detail-list">
              <Detail label="Статус" value={<StatusBadge value={latestRun.status} />} />
              <Detail label="Категории" value={`${latestRun.processed_categories}/${latestRun.total_categories}`} />
              <Detail label="Товары" value={latestRun.saved_products} />
              <Detail label="Ошибки" value={<RunErrorSummary message={latestRun.error_message} compact />} />
              {isRunActive(latestRun) ? (
                <button className="text-button danger-button" type="button" disabled={loading} onClick={() => onStopRun(latestRun.id)}>
                  Остановить парсинг
                </button>
              ) : null}
            </div>
          ) : (
            <div className="empty-state">После первого запуска здесь появится короткая сводка.</div>
          )}
        </div>
      </aside>
    </section>
  );
}

function RunsView({
  runs,
  loading,
  onExportRun,
  onStopRun,
}: {
  runs: ParserRun[];
  loading: boolean;
  onExportRun: (runId: number) => void;
  onStopRun: (runId: number) => void;
}) {
  return (
    <section className="panel table-panel">
      <div className="panel-header">
        <div>
          <h2>История запусков</h2>
          <p>Каждый запуск сохраняет отдельные snapshots цен.</p>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Статус</th>
              <th>Старт</th>
              <th>Финиш</th>
              <th>Категории</th>
              <th>Прогресс</th>
              <th>Товары</th>
              <th>Ошибка</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td><code>#{run.id}</code></td>
                <td><StatusBadge value={run.status} /></td>
                <td>{formatDate(run.started_at)}</td>
                <td>{formatDate(run.finished_at)}</td>
                <td>{run.processed_categories}/{run.total_categories}</td>
                <td><RunProgress run={run} compact /></td>
                <td>{run.saved_products}/{run.total_products}</td>
                <td className="error-cell"><RunErrorSummary message={run.error_message} /></td>
                <td>
                  <div className="row-actions">
                    <button className="text-button compact-button" type="button" disabled={loading} onClick={() => onExportRun(run.id)}>
                      <Icon name="file" size={14} />
                      Скачать
                    </button>
                    {isRunActive(run) ? (
                      <button className="text-button danger-button compact-button" type="button" disabled={loading} onClick={() => onStopRun(run.id)}>
                        Остановить
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RunProgress({ run, compact = false }: { run: ParserRun; compact?: boolean }) {
  const value = progressPercent(run);
  return (
    <div className={compact ? 'run-progress compact' : 'run-progress'}>
      <div className="progress-meta">
        <span>{statusLabel(run.status)}</span>
        <strong>{value}%</strong>
      </div>
      <div className="progress-track" aria-label="Прогресс парсинга">
        <span style={{ width: `${value}%` }} />
      </div>
      {!compact ? (
        <small>
          Категории: {run.processed_categories}/{run.total_categories || 0}.
          {' '}Сохранено товаров: {run.saved_products.toLocaleString('ru-RU')}.
        </small>
      ) : null}
    </div>
  );
}

type RunErrorItem = {
  category: string;
  message: string;
  url: string | null;
};

function RunErrorSummary({ message, compact = false }: { message: string | null; compact?: boolean }) {
  const items = parseRunErrors(message);
  if (!items.length) return <span className="muted-text">-</span>;

  const first = items[0];
  const hiddenCount = items.length - 1;
  return (
    <div className={compact ? 'run-errors compact' : 'run-errors'}>
      <div className="run-error-head">
        <span className="error-pill">{items.length === 1 ? '1 ошибка' : `${items.length} ошибок`}</span>
        <span className="run-error-preview">
          {first.category}: {first.message}
          {hiddenCount > 0 ? ` + еще ${hiddenCount}` : ''}
        </span>
      </div>
      {!compact ? (
        <details className="run-error-details">
          <summary>Детали</summary>
          <ul className="run-error-list">
            {items.slice(0, 20).map((item, index) => (
              <li key={`${item.category}-${index}`}>
                <strong>{item.category}</strong>
                <span>{item.message}</span>
                {item.url ? <a href={item.url} target="_blank" rel="noreferrer">URL</a> : null}
              </li>
            ))}
          </ul>
          {items.length > 20 ? <small>Показаны первые 20 из {items.length}.</small> : null}
        </details>
      ) : null}
    </div>
  );
}

function ProductsView({
  categories,
  products,
  selectedProduct,
  snapshots,
  stats,
  filters,
  markedDateKeys,
  loading,
  productsLoading,
  totalItems,
  page,
  pageSize,
  onFilterChange,
  onApplyFilters,
  onPageChange,
  onPageSizeChange,
  onSelectProduct,
}: {
  categories: ParserCategory[];
  products: MarketProduct[];
  selectedProduct: MarketProduct | null;
  snapshots: ProductSnapshot[];
  stats: ProductStats | null;
  filters: ProductFilters;
  markedDateKeys: string[];
  loading: boolean;
  productsLoading: boolean;
  totalItems: number;
  page: number;
  pageSize: number;
  onFilterChange: (filters: ProductFilters) => void;
  onApplyFilters: () => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onSelectProduct: (product: MarketProduct) => void;
}) {
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const pageEnd = Math.min((currentPage - 1) * pageSize + products.length, totalItems);

  return (
    <section className="content-grid product-grid">
      <div className="panel table-panel">
        <div className="panel-header">
          <div>
            <h2>Товары</h2>
            <p>Фильтры работают по сохраненным товарам и последнему snapshot.</p>
          </div>
          <button className="primary-button" type="button" disabled={loading} onClick={onApplyFilters}>
            <Icon name="search" size={15} />
            Применить
          </button>
        </div>
        <ProductFilters
          categories={categories}
          filters={filters}
          markedDateKeys={markedDateKeys}
          onChange={onFilterChange}
        />
        {productsLoading ? <LoadingStrip text="Загружаем каталог товаров..." /> : null}
        <PaginationBar
          totalItems={totalItems}
          pageStart={pageStart}
          pageEnd={pageEnd}
          page={currentPage}
          totalPages={totalPages}
          pageSize={pageSize}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>External ID</th>
                <th>Товар</th>
                <th>Категория</th>
                <th>Unit</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr
                  className={selectedProduct?.id === product.id ? 'selected-row' : ''}
                  key={product.id}
                  onClick={() => onSelectProduct(product)}
                >
                  <td><code>{product.sku || '-'}</code></td>
                  <td><code>{product.external_sku}</code></td>
                  <td>
                    <div className="product-cell">
                      {product.image_url ? <img src={product.image_url} alt="" /> : <span className="image-fallback" />}
                      <strong>{product.name}</strong>
                    </div>
                  </td>
                  <td>
                    {product.category_id ? (
                      <>
                        {categoryById.get(product.category_id)?.name ?? product.category_id}
                        <small>
                          {categoryById.get(categoryById.get(product.category_id)?.parent_id ?? 0)?.name ?? ''}
                        </small>
                      </>
                    ) : '-'}
                  </td>
                  <td>{product.unit || '-'}</td>
                  <td>{formatDate(product.last_seen_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <PaginationBar
          totalItems={totalItems}
          pageStart={pageStart}
          pageEnd={pageEnd}
          page={currentPage}
          totalPages={totalPages}
          pageSize={pageSize}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          compact
        />
      </div>
      <ProductDetail product={selectedProduct} stats={stats} snapshots={snapshots} />
    </section>
  );
}

function PaginationBar({
  totalItems,
  pageStart,
  pageEnd,
  page,
  totalPages,
  pageSize,
  compact = false,
  onPageChange,
  onPageSizeChange,
}: {
  totalItems: number;
  pageStart: number;
  pageEnd: number;
  page: number;
  totalPages: number;
  pageSize: number;
  compact?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  return (
    <div className={compact ? 'pagination-bar compact' : 'pagination-bar'}>
      <div className="pagination-summary">
        <strong>{totalItems.toLocaleString('ru-RU')}</strong>
        <span>{totalItems ? `${pageStart}-${pageEnd}` : '0'} на странице</span>
      </div>
      <div className="pagination-controls">
        <label>
          <span>Строк</span>
          <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={250}>250</option>
          </select>
        </label>
        <button className="icon-button" type="button" disabled={page <= 1} onClick={() => onPageChange(1)} aria-label="Первая страница">
          <span aria-hidden="true">«</span>
        </button>
        <button className="icon-button" type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Предыдущая страница">
          <span aria-hidden="true">‹</span>
        </button>
        <span className="page-indicator">{page} / {totalPages}</span>
        <button className="icon-button" type="button" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} aria-label="Следующая страница">
          <span aria-hidden="true">›</span>
        </button>
        <button className="icon-button" type="button" disabled={page >= totalPages} onClick={() => onPageChange(totalPages)} aria-label="Последняя страница">
          <span aria-hidden="true">»</span>
        </button>
      </div>
    </div>
  );
}

function ProductFilters({
  categories,
  filters,
  markedDateKeys,
  onChange,
}: {
  categories: ParserCategory[];
  filters: ProductFilters;
  markedDateKeys: string[];
  onChange: (filters: ProductFilters) => void;
}) {
  return (
    <div className="filters-bar">
      <label>
        <span>Название</span>
        <input value={filters.name} onChange={(event) => onChange({ ...filters, name: event.target.value })} />
      </label>
      <label>
        <span>SKU</span>
        <input value={filters.sku} onChange={(event) => onChange({ ...filters, sku: event.target.value })} />
      </label>
      <label>
        <span>Категория</span>
        <select value={filters.categoryId} onChange={(event) => onChange({ ...filters, categoryId: event.target.value })}>
          <option value="">Все</option>
          {categories.map((category) => (
            <option value={category.id} key={category.id}>{category.name}</option>
          ))}
        </select>
      </label>
      <DateRangePicker
        from={filters.from}
        to={filters.to}
        markedDateKeys={markedDateKeys}
        onChange={(from, to) => onChange({ ...filters, from, to })}
      />
      <label className="check-row inline-check">
        <span>Скидка</span>
        <select value={filters.discountMode} onChange={(event) => onChange({ ...filters, discountMode: event.target.value as ProductFilters['discountMode'] })}>
          <option value="all">Все</option>
          <option value="with">Со скидкой</option>
          <option value="without">Без скидки</option>
        </select>
      </label>
      <label className="check-row inline-check">
        <span>Наличие</span>
        <select value={filters.availabilityMode} onChange={(event) => onChange({ ...filters, availabilityMode: event.target.value as ProductFilters['availabilityMode'] })}>
          <option value="all">Все</option>
          <option value="available">В наличии</option>
          <option value="unavailable">Нет в наличии</option>
        </select>
      </label>
    </div>
  );
}

function DateRangePicker({
  from,
  to,
  markedDateKeys,
  onChange,
}: {
  from: string;
  to: string;
  markedDateKeys: string[];
  onChange: (from: string, to: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<'below' | 'above'>('below');
  const fieldRef = useRef<HTMLDivElement>(null);
  const [cursorDate, setCursorDate] = useState(
    () => monthStart(from || to || markedDateKeys[markedDateKeys.length - 1]),
  );
  const markedSet = new Set(markedDateKeys);
  const calendarDays = calendarMonthDays(cursorDate);

  useEffect(() => {
    if (from || to) {
      setCursorDate(monthStart(from || to));
    }
  }, [from, to]);

  useEffect(() => {
    if (!open) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const rect = fieldRef.current?.getBoundingClientRect();
      if (!rect) return;
      const estimatedPopoverHeight = 420;
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      setPlacement(spaceBelow >= estimatedPopoverHeight || spaceBelow >= spaceAbove ? 'below' : 'above');
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  function handleSelect(dayKey: string) {
    if (!from || (from && to)) {
      onChange(dayKey, '');
      return;
    }
    if (dayKey < from) {
      onChange(dayKey, from);
      return;
    }
    onChange(from, dayKey);
  }

  function shiftMonth(delta: number) {
    setCursorDate((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  }

  return (
    <div className="date-range-field" ref={fieldRef}>
      <span>Период</span>
      <button className="date-range-trigger" type="button" onClick={() => setOpen((value) => !value)}>
        <span>{dateRangeLabel(from, to)}</span>
        <Icon name="activity" size={15} />
      </button>
      {open ? (
        <div className={`date-range-popover ${placement}`}>
          <div className="calendar-head">
            <button className="icon-button" type="button" onClick={() => shiftMonth(-1)} aria-label="Предыдущий месяц">
              <span aria-hidden="true">‹</span>
            </button>
            <strong>{monthLabel(cursorDate)}</strong>
            <button className="icon-button" type="button" onClick={() => shiftMonth(1)} aria-label="Следующий месяц">
              <span aria-hidden="true">›</span>
            </button>
          </div>
          <div className="calendar-weekdays">
            {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="calendar-grid">
            {calendarDays.map((day) => {
              const inCurrentMonth = day.getMonth() === cursorDate.getMonth();
              const key = dateKey(day);
              const selected = key === from || key === to;
              const inRange = Boolean(from && to && key > from && key < to);
              const marked = markedSet.has(key);
              return (
                <button
                  className={[
                    'calendar-day',
                    inCurrentMonth ? '' : 'muted',
                    selected ? 'selected' : '',
                    inRange ? 'in-range' : '',
                    marked ? 'marked' : '',
                  ].filter(Boolean).join(' ')}
                  key={key}
                  type="button"
                  onClick={() => handleSelect(key)}
                >
                  <span>{day.getDate()}</span>
                </button>
              );
            })}
          </div>
          <div className="calendar-footer">
            <span>{markedDateKeys.length ? `Дней с парсингом: ${markedDateKeys.length}` : 'Дней с парсингом пока нет'}</span>
            <div className="calendar-actions">
              <button className="text-button compact-button" type="button" onClick={() => onChange('', '')}>
                Очистить
              </button>
              <button className="primary-button compact-button" type="button" onClick={() => setOpen(false)}>
                Применить
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ProductDetail({
  product,
  stats,
  snapshots,
}: {
  product: MarketProduct | null;
  stats: ProductStats | null;
  snapshots: ProductSnapshot[];
}) {
  return (
    <aside className="side-stack">
      <div className="panel detail-panel">
        <div className="panel-header compact">
          <div>
            <h2>Карточка товара</h2>
            <p>{product ? product.sku || product.external_sku : 'Выберите товар'}</p>
          </div>
        </div>
        {product ? (
          <>
            <div className="product-detail-head">
              {product.image_url ? <img src={product.image_url} alt="" /> : <span className="image-fallback large" />}
              <strong>{product.name}</strong>
            </div>
            <div className="detail-list">
              <Detail label="SKU" value={<code>{product.sku || '-'}</code>} />
              <Detail label="External ID" value={<code>{product.external_sku}</code>} />
              <Detail label="Текущая цена" value={money(stats?.current_price)} />
              <Detail label="Мин. цена" value={money(stats?.min_price)} />
              <Detail label="Макс. цена" value={money(stats?.max_price)} />
              <Detail label="Средняя" value={money(stats?.avg_price)} />
              <Detail label="Изменение" value={percent(stats?.price_change_percent)} />
              <Detail label="Дней скидки" value={stats?.discount_days_count ?? '-'} />
              <Detail label="Snapshots" value={stats?.snapshots_count ?? '-'} />
            </div>
          </>
        ) : (
          <div className="empty-state">Выберите товар в таблице, чтобы увидеть историю цены.</div>
        )}
      </div>
      <div className="panel detail-panel">
        <div className="panel-header compact">
          <div>
            <h2>История цены</h2>
            <p>Последние снимки товара.</p>
          </div>
        </div>
        <div className="snapshot-list">
          {snapshots.slice(-8).reverse().map((snapshot) => (
            <div className="snapshot-row" key={snapshot.id}>
              <span>{formatDate(snapshot.collected_at)}</span>
              <strong>{money(snapshot.discount_price ?? snapshot.price)}</strong>
              <small>{snapshot.discount_percent ? `${snapshot.discount_percent}%` : 'рег.'}</small>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

function ReportsView({
  categories,
  products,
  runs,
  productCount,
  productSegments,
  selectedCategoryId,
  selectedProduct,
  productStats,
  categoryStats,
  latestRun,
  productsLoading,
  filters,
  markedDateKeys,
  onSelectCategory,
  onSelectProduct,
  onFilterChange,
}: {
  categories: ParserCategory[];
  products: MarketProduct[];
  runs: ParserRun[];
  productCount: number;
  productSegments: ProductCategorySegment[];
  selectedCategoryId: number | null;
  selectedProduct: MarketProduct | null;
  productStats: ProductStats | null;
  categoryStats: CategoryStats | null;
  latestRun: ParserRun | null;
  productsLoading: boolean;
  filters: ProductFilters;
  markedDateKeys: string[];
  onSelectCategory: (id: number) => void;
  onSelectProduct: (product: MarketProduct | null) => void;
  onFilterChange: (filters: ProductFilters) => void;
}) {
  const selectedCategory = categories.find((category) => category.id === selectedCategoryId) ?? null;
  const [reportProducts, setReportProducts] = useState<MarketProduct[]>([]);
  const [reportProductsLoading, setReportProductsLoading] = useState(false);
  const [topDiscounts, setTopDiscounts] = useState<ProductDiscountItem[]>([]);
  const [topDiscountsTotal, setTopDiscountsTotal] = useState(0);
  const [topDiscountsPage, setTopDiscountsPage] = useState(1);
  const [topDiscountsPageSize, setTopDiscountsPageSize] = useState(25);
  const [topDiscountsLoading, setTopDiscountsLoading] = useState(false);
  const [priceChanges, setPriceChanges] = useState<PriceChangeItem[]>([]);
  const [priceChangesLoading, setPriceChangesLoading] = useState(false);
  const topDiscountsTotalPages = Math.max(1, Math.ceil(topDiscountsTotal / topDiscountsPageSize));
  const topDiscountsCurrentPage = Math.min(topDiscountsPage, topDiscountsTotalPages);
  const topDiscountsPageStart = topDiscountsTotal === 0 ? 0 : (topDiscountsCurrentPage - 1) * topDiscountsPageSize + 1;
  const topDiscountsPageEnd = Math.min((topDiscountsCurrentPage - 1) * topDiscountsPageSize + topDiscounts.length, topDiscountsTotal);
  const priceIncreases = priceChanges
    .filter((item) => Number(item.change_percent ?? 0) > 0)
    .sort((a, b) => Number(b.change_percent ?? 0) - Number(a.change_percent ?? 0));
  const priceDecreases = priceChanges
    .filter((item) => Number(item.change_percent ?? 0) < 0)
    .sort((a, b) => Number(a.change_percent ?? 0) - Number(b.change_percent ?? 0));

  useEffect(() => {
    setTopDiscountsPage(1);
  }, [selectedCategoryId, filters.from, filters.to]);

  useEffect(() => {
    if (!selectedCategoryId) {
      setTopDiscounts([]);
      setTopDiscountsTotal(0);
      return;
    }
    setTopDiscountsLoading(true);
    void fetchTopDiscounts({
      category_id: selectedCategoryId,
      from: filters.from || undefined,
      to: filters.to || undefined,
      limit: topDiscountsPageSize,
      offset: (topDiscountsCurrentPage - 1) * topDiscountsPageSize,
    })
      .then((page) => {
        setTopDiscounts(page.items);
        setTopDiscountsTotal(page.total);
      })
      .catch(() => {
        setTopDiscounts([]);
        setTopDiscountsTotal(0);
      })
      .finally(() => setTopDiscountsLoading(false));
  }, [selectedCategoryId, filters.from, filters.to, topDiscountsCurrentPage, topDiscountsPageSize]);

  useEffect(() => {
    if (!selectedCategoryId) {
      setPriceChanges([]);
      return;
    }
    setPriceChangesLoading(true);
    void fetchPriceChanges({
      category_id: selectedCategoryId,
      from: filters.from || undefined,
      to: filters.to || undefined,
    })
      .then(setPriceChanges)
      .catch(() => setPriceChanges([]))
      .finally(() => setPriceChangesLoading(false));
  }, [selectedCategoryId, filters.from, filters.to]);

  useEffect(() => {
    if (!selectedCategoryId) {
      setReportProducts([]);
      onSelectProduct(null);
      return;
    }
    setReportProductsLoading(true);
    void fetchProducts({ category_id: selectedCategoryId })
      .then((rows) => {
        setReportProducts(rows);
        const selected = rows.find((product) => product.id === selectedProduct?.id) ?? rows[0] ?? null;
        onSelectProduct(selected);
      })
      .catch(() => {
        setReportProducts([]);
        onSelectProduct(null);
      })
      .finally(() => setReportProductsLoading(false));
  }, [selectedCategoryId]);

  return (
    <section className="reports-layout">
      <MarketingDashboard
        categories={categories}
        productCount={productCount}
        productSegments={productSegments}
        selectedCategory={selectedCategory}
        categoryStats={categoryStats}
        latestRun={latestRun}
      />

      {productsLoading ? <LoadingStrip text="Загружаем товары для отчетов..." /> : null}

      <div className="panel report-controls">
        <div className="form-row report-filters">
          <label>
            <span>Категория</span>
            <select value={selectedCategoryId ?? ''} onChange={(event) => onSelectCategory(Number(event.target.value))}>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </label>
          <label>
            <span>Товар</span>
            <select
              value={reportProducts.some((product) => product.id === selectedProduct?.id) ? selectedProduct?.id : ''}
              onChange={(event) => {
                const product = reportProducts.find((item) => item.id === Number(event.target.value)) ?? null;
                onSelectProduct(product);
              }}
              disabled={reportProductsLoading}
            >
              {reportProductsLoading ? <option value="">Загрузка товаров...</option> : null}
              {!reportProductsLoading && !reportProducts.length ? <option value="">Нет товаров</option> : null}
              {reportProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
            </select>
          </label>
          <DateRangePicker
            from={filters.from}
            to={filters.to}
            markedDateKeys={markedDateKeys}
            onChange={(from, to) => onFilterChange({ ...filters, from, to })}
          />
        </div>
      </div>

      <div className="report-grid">
        <div className="panel detail-panel">
          <div className="panel-header compact"><h2>Товар</h2></div>
          <div className="detail-list">
            <Detail label="Current" value={money(productStats?.current_price)} />
            <Detail label="Min" value={money(productStats?.min_price)} />
            <Detail label="Max" value={money(productStats?.max_price)} />
            <Detail label="Avg" value={money(productStats?.avg_price)} />
            <Detail label="Change" value={percent(productStats?.price_change_percent)} />
            <Detail label="Max discount" value={percent(productStats?.max_discount_percent)} />
          </div>
        </div>
        <div className="panel detail-panel">
          <div className="panel-header compact"><h2>Категория</h2></div>
          <div className="detail-list">
            <Detail label="Товары" value={categoryStats?.products_count ?? '-'} />
            <Detail label="Средняя цена" value={money(categoryStats?.avg_price)} />
            <Detail label="Средняя скидка" value={percent(categoryStats?.avg_discount_percent)} />
            <Detail label="Со скидкой" value={categoryStats?.discounted_products_count ?? '-'} />
            <Detail label="Подорожали" value={categoryStats?.price_increased_products ?? '-'} />
            <Detail label="Подешевели" value={categoryStats?.price_decreased_products ?? '-'} />
          </div>
        </div>
        <div className="panel table-panel wide-report">
          <div className="panel-header compact">
            <div>
              <h2>Топ скидок</h2>
              <p>Все товары со скидками по выбранной категории и периоду.</p>
            </div>
          </div>
          {topDiscountsLoading ? <LoadingStrip text="Загружаем товары со скидками..." /> : null}
          <div className="discount-list">
            {topDiscounts.map((item) => (
              <div className="discount-row" key={item.product_id}>
                <strong>{item.name}</strong>
                <span>{money(item.discount_price)}</span>
                <b>{percent(item.discount_percent)}</b>
              </div>
            ))}
            {!topDiscountsLoading && !topDiscounts.length ? <div className="empty-state">Скидок за выбранный период нет.</div> : null}
          </div>
          <PaginationBar
            totalItems={topDiscountsTotal}
            pageStart={topDiscountsPageStart}
            pageEnd={topDiscountsPageEnd}
            page={topDiscountsCurrentPage}
            totalPages={topDiscountsTotalPages}
            pageSize={topDiscountsPageSize}
            onPageChange={setTopDiscountsPage}
            onPageSizeChange={(pageSize) => {
              setTopDiscountsPageSize(pageSize);
              setTopDiscountsPage(1);
            }}
            compact
          />
        </div>
        <div className="panel table-panel wide-report">
          <div className="panel-header compact">
            <div>
              <h2>Топ изменений цены</h2>
              <p>Рост и снижение по выбранной категории и периоду.</p>
            </div>
          </div>
          {priceChangesLoading ? <LoadingStrip text="Считаем изменения цены..." /> : null}
          <div className="price-change-grid">
            <PriceChangeColumn title="Повышение" tone="up" items={priceIncreases} />
            <PriceChangeColumn title="Снижение" tone="down" items={priceDecreases} />
          </div>
        </div>
      </div>
    </section>
  );
}

function ExportView({
  categories,
  filters,
  markedDateKeys,
  selectedSourceId,
  exportState,
  onFilterChange,
  onDownload,
}: {
  categories: ParserCategory[];
  filters: ProductFilters;
  markedDateKeys: string[];
  selectedSourceId: number | null;
  exportState: LoadState;
  onFilterChange: (filters: ProductFilters) => void;
  onDownload: (path: string, filename: string) => Promise<void>;
}) {
  const exportParams = new URLSearchParams();
  if (selectedSourceId) exportParams.set('source_id', String(selectedSourceId));
  if (filters.categoryId) exportParams.set('category_id', filters.categoryId);
  if (filters.name) exportParams.set('name', filters.name);
  if (filters.sku) exportParams.set('sku', filters.sku);
  if (filters.from) exportParams.set('from', filters.from);
  if (filters.to) exportParams.set('to', filters.to);
  const hasDiscount = discountFilterValue(filters.discountMode);
  const isAvailable = availabilityFilterValue(filters.availabilityMode);
  if (hasDiscount !== undefined) exportParams.set('has_discount', String(hasDiscount));
  if (isAvailable !== undefined) exportParams.set('is_available', String(isAvailable));
  const path = `/api/v1/market-parser/export/products.xlsx${exportParams.toString() ? `?${exportParams.toString()}` : ''}`;

  return (
    <>
      <section className="panel export-panel">
        <div className="panel-header">
          <div>
            <h2>Экспорт по параметрам</h2>
            <p>Excel формируется по выбранной дате парсинга, категории, скидке и наличию.</p>
          </div>
          <button className="primary-button" type="button" disabled={exportState.loading} onClick={() => void onDownload(path, 'market_products.xlsx')}>
            <Icon name="file" size={15} />
            {exportState.loading ? 'Готовим Excel...' : 'Скачать Excel'}
          </button>
        </div>
        <ProductFilters
          categories={categories}
          filters={filters}
          markedDateKeys={markedDateKeys}
          onChange={onFilterChange}
        />
        {exportState.loading ? (
          <div className="export-loading">
            <LoadingStrip text="Формируем Excel-файл по выбранным параметрам..." />
            <span>Можно подождать на этой странице, скачивание начнется автоматически.</span>
          </div>
        ) : null}
      </section>
    </>
  );
}

function discountFilterValue(mode: ProductFilters['discountMode']): boolean | undefined {
  if (mode === 'with') return true;
  if (mode === 'without') return false;
  return undefined;
}

function availabilityFilterValue(mode: ProductFilters['availabilityMode']): boolean | undefined {
  if (mode === 'available') return true;
  if (mode === 'unavailable') return false;
  return undefined;
}

function PriceChangeColumn({
  title,
  tone,
  items,
}: {
  title: string;
  tone: 'up' | 'down';
  items: PriceChangeItem[];
}) {
  return (
    <div className={`price-change-column ${tone}`}>
      <div className="price-change-title">
        <strong>{title}</strong>
        <span>{items.length ? `${items.length} товаров` : 'нет данных'}</span>
      </div>
      <div className="price-change-list">
        {items.length ? items.map((item) => (
          <div className="price-change-row" key={`${tone}-${item.product_id}`}>
            <span>{item.name}</span>
            <small>{money(item.first_price)} → {money(item.last_price)}</small>
            <b>{percent(item.change_percent)}</b>
          </div>
        )) : <div className="empty-state">За выбранный период изменений не найдено.</div>}
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function LoadingStrip({ text }: { text: string }) {
  return (
    <div className="loading-strip" role="status" aria-live="polite">
      <span />
      <strong>{text}</strong>
    </div>
  );
}

function GlobalExportIndicator({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div className="sidebar-export-indicator" role="status" aria-live="polite">
      <Icon name="file" size={16} />
      <div>
        <strong>Готовим Excel</strong>
        <span>Файл формируется, скачивание начнется автоматически.</span>
      </div>
    </div>
  );
}

function parseRunErrors(message: string | null): RunErrorItem[] {
  if (!message) return [];
  return message
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseRunErrorLine);
}

function parseRunErrorLine(line: string): RunErrorItem {
  const separatorIndex = line.indexOf(':');
  const category = separatorIndex > 0 ? line.slice(0, separatorIndex).trim() : 'Категория';
  const rawMessage = separatorIndex > 0 ? line.slice(separatorIndex + 1).trim() : line;
  const statusMatch = rawMessage.match(/Client error ['"]?(\d{3})(?:\s+([^'"]+))?/i);
  const url = rawMessage.match(/url ['"]([^'"]+)['"]/i)?.[1] ?? null;

  if (statusMatch) {
    return {
      category,
      message: humanHttpError(Number(statusMatch[1])),
      url,
    };
  }

  return {
    category,
    message: cleanupErrorText(rawMessage),
    url,
  };
}

function humanHttpError(statusCode: number): string {
  if (statusCode === 404) return 'Раздел не найден на Globus (404)';
  if (statusCode === 403) return 'Globus запретил доступ к разделу (403)';
  if (statusCode === 429) return 'Globus ограничил частоту запросов (429)';
  if (statusCode >= 500) return `Globus временно недоступен (HTTP ${statusCode})`;
  return `Globus вернул HTTP ${statusCode}`;
}

function cleanupErrorText(value: string): string {
  return value
    .replace(/For more information check:.*/i, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim() || 'Ошибка парсинга';
}

function StatusBadge({ value }: { value: string }) {
  const tone = statusTone(value);
  return <span className={`status ${tone}`}>{statusLabel(value)}</span>;
}

function statusTone(value: string): string {
  switch (value) {
    case 'success':
    case 'enabled':
      return 'good';
    case 'partial':
    case 'running':
    case 'stopping':
    case 'pending':
      return 'wait';
    case 'stopped':
      return 'muted';
    case 'failed':
    case 'disabled':
      return 'bad';
    default:
      return 'muted';
  }
}

function statusLabel(value: string): string {
  switch (value) {
    case 'running':
      return 'Идет сбор';
    case 'pending':
      return 'Ожидает';
    case 'stopping':
      return 'Останавливается';
    case 'stopped':
      return 'Остановлен';
    case 'success':
      return 'Готово';
    case 'partial':
      return 'Частично';
    case 'failed':
      return 'Ошибка';
    case 'enabled':
      return 'Включен';
    case 'disabled':
      return 'Выключен';
    case 'group':
      return 'Группа';
    default:
      return value;
  }
}

function filterCategoryTree(categories: ParserCategory[], query: string): ParserCategory[] {
  const text = query.trim().toLowerCase();
  if (!text) return categories;

  const visibleIds = new Set<number>();

  for (const category of categories) {
    const haystack = `${category.name} ${category.external_id ?? ''}`.toLowerCase();
    if (!haystack.includes(text)) continue;
    visibleIds.add(category.id);
    if (category.parent_id) visibleIds.add(category.parent_id);
    for (const child of categories) {
      if (child.parent_id === category.id) visibleIds.add(child.id);
    }
  }

  return categories.filter((category) => visibleIds.has(category.id));
}

function leafCategories(categories: ParserCategory[]): Set<number> {
  const parentIds = new Set(categories.map((category) => category.parent_id).filter((id): id is number => Boolean(id)));
  return new Set(categories.filter((category) => !parentIds.has(category.id)).map((category) => category.id));
}

function isRunActive(run: ParserRun): boolean {
  return run.status === 'pending' || run.status === 'running' || run.status === 'stopping';
}

function isAuthError(message: string): boolean {
  return message === 'Not authenticated' || message === 'Invalid token' || message.includes('HTTP 401');
}

function isConnectivityError(message: string | null): boolean {
  if (!message) return false;
  return /failed to fetch|networkerror|network request failed|load failed|econnrefused|timeout/i.test(message);
}

function errorMessage(message: string | null): string {
  if (!message) return '';
  if (message.startsWith('Missing permission:')) {
    return `Недостаточно прав доступа. ${message}. После изменения ролей выйдите и войдите заново.`;
  }
  return message;
}

function progressPercent(run: ParserRun): number {
  if (!run.total_categories) return isRunActive(run) ? 5 : 100;
  const value = Math.round((run.processed_categories / run.total_categories) * 100);
  return Math.min(100, Math.max(isRunActive(run) ? 3 : 0, value));
}

function money(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  const number = Number(value);
  if (Number.isNaN(number)) return String(value);
  return `${number.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} сом`;
}

function percent(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  const number = Number(value);
  if (Number.isNaN(number)) return `${value}%`;
  return `${number.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}%`;
}

function parserRunDateKeys(runs: ParserRun[]): string[] {
  const keys = new Set<string>();
  for (const run of runs) {
    const value = run.finished_at || run.started_at || run.created_at;
    if (!value) continue;
    keys.add(dateKey(new Date(value)));
  }
  return [...keys].sort();
}

function dateRangeLabel(from: string, to: string): string {
  if (from && to) return `${formatDateKey(from)} - ${formatDateKey(to)}`;
  if (from) return `${formatDateKey(from)} - ...`;
  return 'Все даты';
}

function monthStart(value?: string): Date {
  const date = value ? parseDateKey(value) : new Date();
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function calendarMonthDays(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

function parseDateKey(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
}

function dateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateKey(value: string): string {
  const date = parseDateKey(value);
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function monthLabel(value: Date): string {
  return value.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
}

function formatDate(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
