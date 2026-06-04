import { useCallback, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { AppShell, fetchServiceRegistry, Icon, serviceLinksFromRegistry } from '@turkuaz/ui';
import type { ServiceRegistryItem } from '@turkuaz/ui';
import {
  clearToken,
  createSource,
  DEV_ADMIN_EMAIL,
  DEV_ADMIN_PASSWORD,
  downloadFile,
  fetchCategories,
  fetchCategoryStats,
  fetchMe,
  fetchRun,
  fetchProductSnapshots,
  fetchProductStats,
  fetchProducts,
  fetchRuns,
  fetchSources,
  getToken,
  login,
  loginAsDevAdmin,
  setCategoryEnabled,
  startRun,
  syncCategories,
} from './lib/api';
import type {
  CategoryStats,
  CurrentUser,
  MarketProduct,
  ParserCategory,
  ParserRun,
  ParserSource,
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
  hasDiscount: boolean;
  isAvailable: boolean;
  from: string;
  to: string;
};

const initialProductFilters: ProductFilters = {
  name: '',
  sku: '',
  categoryId: '',
  hasDiscount: false,
  isAvailable: false,
  from: '',
  to: '',
};

export function App() {
  const [view, setView] = useState<ViewMode>('categories');
  const [sources, setSources] = useState<ParserSource[]>([]);
  const [categories, setCategories] = useState<ParserCategory[]>([]);
  const [runs, setRuns] = useState<ParserRun[]>([]);
  const [products, setProducts] = useState<MarketProduct[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<number | null>(null);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [productStats, setProductStats] = useState<ProductStats | null>(null);
  const [categoryStats, setCategoryStats] = useState<CategoryStats | null>(null);
  const [snapshots, setSnapshots] = useState<ProductSnapshot[]>([]);
  const [state, setState] = useState<LoadState>({ loading: false, error: null });
  const [actionState, setActionState] = useState<LoadState>({ loading: false, error: null });
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<ProductFilters>(initialProductFilters);
  const [parseAllEnabled, setParseAllEnabled] = useState(true);
  const [showSourceForm, setShowSourceForm] = useState(false);
  const [sourceForm, setSourceForm] = useState({
    name: 'Globus Online',
    code: 'globus',
    base_url: 'https://globus-online.kg/ru-kg',
    type: 'html',
  });
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [serviceApps, setServiceApps] = useState<ServiceRegistryItem[]>([]);
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(getToken()));

  const selectedSource = sources.find((source) => source.id === selectedSourceId) ?? sources[0] ?? null;
  const selectedProduct = products.find((product) => product.id === selectedProductId) ?? products[0] ?? null;
  const parentCategoryIds = new Set(categories.map((category) => category.parent_id).filter(Boolean));
  const enabledCategories = categories.filter((category) => category.is_enabled && !parentCategoryIds.has(category.id));
  const latestRun = runs[0] ?? null;

  const loadData = useCallback(async () => {
    if (!getToken()) {
      setIsAuthenticated(false);
      setState({ loading: false, error: null });
      return;
    }
    setState({ loading: true, error: null });
    try {
      const [me, serviceRows] = await Promise.all([
        fetchMe(),
        fetchServiceRegistry({ identityApiBaseUrl: IDENTITY_API_BASE_URL }).catch(() => [] as ServiceRegistryItem[]),
      ]);
      const sourceRows = await fetchSources();
      const sourceId = selectedSourceId ?? sourceRows[0]?.id ?? null;
      const [categoryRows, runRows, productRows] = await Promise.all([
        sourceId ? fetchCategories(sourceId) : Promise.resolve([]),
        sourceId ? fetchRuns(sourceId) : Promise.resolve([]),
        fetchProducts({ source_id: sourceId ?? undefined }),
      ]);
      setCurrentUser(me);
      setServiceApps(serviceRows);
      setIsAuthenticated(true);
      setSources(sourceRows);
      setSelectedSourceId(sourceId);
      setCategories(categoryRows);
      setRuns(runRows);
      setProducts(productRows);
      setSelectedCategoryId((current) =>
        current && categoryRows.some((category) => category.id === current)
          ? current
          : categoryRows[0]?.id ?? null,
      );
      setSelectedProductId((current) =>
        current && productRows.some((product) => product.id === current)
          ? current
          : productRows[0]?.id ?? null,
      );
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
            void loadProducts();
          }
        })
        .catch((error) =>
          setActionState({ loading: false, error: error instanceof Error ? error.message : String(error) }),
        );
    }, 1500);

    return () => window.clearInterval(timer);
  }, [activeRunId, runs]);

  async function handleCreateSource() {
    setActionState({ loading: true, error: null });
    try {
      const source = await createSource({ ...sourceForm, is_active: true });
      setShowSourceForm(false);
      setSelectedSourceId(source.id);
      await loadData();
      setActionState({ loading: false, error: null });
    } catch (error) {
      setActionState({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

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

  async function loadProducts() {
    setActionState({ loading: true, error: null });
    try {
      const rows = await fetchProducts({
        source_id: selectedSource?.id,
        category_id: filters.categoryId ? Number(filters.categoryId) : undefined,
        name: filters.name || undefined,
        sku: filters.sku || undefined,
        has_discount: filters.hasDiscount || undefined,
        is_available: filters.isAvailable || undefined,
      });
      setProducts(rows);
      setSelectedProductId((current) =>
        current && rows.some((product) => product.id === current) ? current : rows[0]?.id ?? null,
      );
      setActionState({ loading: false, error: null });
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
    setSelectedCategoryIds([]);
    setActiveRunId(null);
    setSelectedProductId(null);
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
    { label: 'Товары', value: products.length, icon: 'qr' as const },
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
        { key: 'source', label: 'Источник', icon: 'plus', onClick: () => setShowSourceForm((value) => !value) },
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
      {state.error || actionState.error ? (
        <div className="notice">{errorMessage(state.error || actionState.error)}</div>
      ) : null}

      <section className="metrics-grid" aria-label="Market parser metrics">
        {metrics.map((metric) => (
          <div className="metric" key={metric.label}>
            <Icon name={metric.icon} size={20} />
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </div>
        ))}
      </section>

      {showSourceForm ? (
        <section className="panel source-form">
          <div className="panel-header compact">
            <div>
              <h2>Источник данных</h2>
              <p>Быстрое подключение Globus Online или будущего конкурента.</p>
            </div>
          </div>
          <div className="form-row four">
            <label>
              <span>Название</span>
              <input value={sourceForm.name} onChange={(event) => setSourceForm({ ...sourceForm, name: event.target.value })} />
            </label>
            <label>
              <span>Код</span>
              <input value={sourceForm.code} onChange={(event) => setSourceForm({ ...sourceForm, code: event.target.value })} />
            </label>
            <label>
              <span>URL</span>
              <input value={sourceForm.base_url} onChange={(event) => setSourceForm({ ...sourceForm, base_url: event.target.value })} />
            </label>
            <label>
              <span>Тип</span>
              <select value={sourceForm.type} onChange={(event) => setSourceForm({ ...sourceForm, type: event.target.value })}>
                <option value="html">html</option>
                <option value="api">api</option>
              </select>
            </label>
          </div>
          <div className="panel-actions">
            <button className="primary-button" type="button" disabled={actionState.loading} onClick={() => void handleCreateSource()}>
              <Icon name="plus" size={16} />
              Добавить источник
            </button>
          </div>
        </section>
      ) : null}

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
          onToggleParseAll={setParseAllEnabled}
          onToggleCategory={(category, enabled) => void handleToggleCategory(category, enabled)}
        />
      ) : null}

      {view === 'runs' ? <RunsView runs={runs} /> : null}

      {view === 'products' ? (
        <ProductsView
          categories={categories}
          products={products}
          selectedProduct={selectedProduct}
          snapshots={snapshots}
          stats={productStats}
          filters={filters}
          loading={actionState.loading}
          onFilterChange={setFilters}
          onApplyFilters={() => void loadProducts()}
          onSelectProduct={setSelectedProductId}
        />
      ) : null}

      {view === 'reports' ? (
        <ReportsView
          categories={categories}
          products={products}
          selectedCategoryId={selectedCategoryId}
          selectedProduct={selectedProduct}
          productStats={productStats}
          categoryStats={categoryStats}
          filters={filters}
          onSelectCategory={setSelectedCategoryId}
          onSelectProduct={setSelectedProductId}
          onFilterChange={setFilters}
        />
      ) : null}

      {view === 'export' ? (
        <ExportView selectedCategoryId={selectedCategoryId} from={filters.from} to={filters.to} />
      ) : null}
    </AppShell>
  );
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
          <p>Войдите через Identity или временный локальный admin-доступ парсера.</p>
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
          <button
            className="secondary-button"
            type="button"
            disabled={submitState.loading}
            onClick={() => void handleDevAdminLogin()}
          >
            <Icon name="key" size={16} />
            Войти как админ
          </button>
        </form>
      </section>
    </main>
  );
}

function backendUrl(port: number, path = ''): string {
  if (typeof window === 'undefined') return `http://localhost:${port}${path}`;
  return `${window.location.protocol}//${window.location.hostname}:${port}${path}`;
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

  function toggleSelected(id: number) {
    onSelectCategories(
      selectedCategoryIds.includes(id)
        ? selectedCategoryIds.filter((item) => item !== id)
        : [...selectedCategoryIds, id],
    );
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
    return (
      <tr className={level === 'parent' ? 'category-group-row' : 'category-child-row'} key={category.id}>
        <td>
          <input
            type="checkbox"
            disabled={parseAllEnabled || (hasChildren && childRows.length === 0)}
            checked={selectedCategoryIds.includes(category.id)}
            onChange={() => toggleSelected(category.id)}
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
            </div>
          ) : (
            <div className="empty-state">После первого запуска здесь появится короткая сводка.</div>
          )}
        </div>
      </aside>
    </section>
  );
}

function RunsView({ runs }: { runs: ParserRun[] }) {
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
        <span>{run.status === 'running' ? 'Идет сбор' : run.status}</span>
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
  loading,
  onFilterChange,
  onApplyFilters,
  onSelectProduct,
}: {
  categories: ParserCategory[];
  products: MarketProduct[];
  selectedProduct: MarketProduct | null;
  snapshots: ProductSnapshot[];
  stats: ProductStats | null;
  filters: ProductFilters;
  loading: boolean;
  onFilterChange: (filters: ProductFilters) => void;
  onApplyFilters: () => void;
  onSelectProduct: (id: number) => void;
}) {
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const totalPages = Math.max(1, Math.ceil(products.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = products.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const pageEnd = Math.min(currentPage * pageSize, products.length);
  const pageProducts = products.slice(pageStart ? pageStart - 1 : 0, pageEnd);

  useEffect(() => {
    setPage(1);
  }, [products, pageSize]);

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
        <ProductFilters categories={categories} filters={filters} onChange={onFilterChange} />
        <PaginationBar
          totalItems={products.length}
          pageStart={pageStart}
          pageEnd={pageEnd}
          page={currentPage}
          totalPages={totalPages}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Товар</th>
                <th>Категория</th>
                <th>Unit</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {pageProducts.map((product) => (
                <tr
                  className={selectedProduct?.id === product.id ? 'selected-row' : ''}
                  key={product.id}
                  onClick={() => onSelectProduct(product.id)}
                >
                  <td><code>{product.sku || product.external_sku}</code></td>
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
          totalItems={products.length}
          pageStart={pageStart}
          pageEnd={pageEnd}
          page={currentPage}
          totalPages={totalPages}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
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
  onChange,
}: {
  categories: ParserCategory[];
  filters: ProductFilters;
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
      <label>
        <span>С</span>
        <input type="date" value={filters.from} onChange={(event) => onChange({ ...filters, from: event.target.value })} />
      </label>
      <label>
        <span>По</span>
        <input type="date" value={filters.to} onChange={(event) => onChange({ ...filters, to: event.target.value })} />
      </label>
      <label className="check-row inline-check">
        <input type="checkbox" checked={filters.hasDiscount} onChange={(event) => onChange({ ...filters, hasDiscount: event.target.checked })} />
        <span>Скидка</span>
      </label>
      <label className="check-row inline-check">
        <input type="checkbox" checked={filters.isAvailable} onChange={(event) => onChange({ ...filters, isAvailable: event.target.checked })} />
        <span>В наличии</span>
      </label>
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
  selectedCategoryId,
  selectedProduct,
  productStats,
  categoryStats,
  filters,
  onSelectCategory,
  onSelectProduct,
  onFilterChange,
}: {
  categories: ParserCategory[];
  products: MarketProduct[];
  selectedCategoryId: number | null;
  selectedProduct: MarketProduct | null;
  productStats: ProductStats | null;
  categoryStats: CategoryStats | null;
  filters: ProductFilters;
  onSelectCategory: (id: number) => void;
  onSelectProduct: (id: number) => void;
  onFilterChange: (filters: ProductFilters) => void;
}) {
  const topDiscounts = categoryStats?.top_discounted_products ?? [];
  return (
    <section className="reports-layout">
      <div className="panel report-controls">
        <div className="form-row four">
          <label>
            <span>Категория</span>
            <select value={selectedCategoryId ?? ''} onChange={(event) => onSelectCategory(Number(event.target.value))}>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </label>
          <label>
            <span>Товар</span>
            <select value={selectedProduct?.id ?? ''} onChange={(event) => onSelectProduct(Number(event.target.value))}>
              {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
            </select>
          </label>
          <label>
            <span>С</span>
            <input type="date" value={filters.from} onChange={(event) => onFilterChange({ ...filters, from: event.target.value })} />
          </label>
          <label>
            <span>По</span>
            <input type="date" value={filters.to} onChange={(event) => onFilterChange({ ...filters, to: event.target.value })} />
          </label>
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
              <p>По выбранной категории и периоду.</p>
            </div>
          </div>
          <div className="discount-list">
            {topDiscounts.map((item) => (
              <div className="discount-row" key={item.product_id}>
                <strong>{item.name}</strong>
                <span>{money(item.discount_price)}</span>
                <b>{percent(item.discount_percent)}</b>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function ExportView({ selectedCategoryId, from, to }: { selectedCategoryId: number | null; from: string; to: string }) {
  const [state, setState] = useState<LoadState>({ loading: false, error: null });
  const period = new URLSearchParams();
  if (from) period.set('from', from);
  if (to) period.set('to', to);
  const suffix = period.toString() ? `?${period.toString()}` : '';
  const items = [
    {
      title: 'Все товары',
      text: 'Совместимая выгрузка с sku, name, title, price, discount_price, media.',
      path: '/api/v1/market-parser/export/products.xlsx',
      filename: 'market_products.xlsx',
    },
    {
      title: 'Статистика',
      text: 'Листы Товары, Цены, Скидки, Изменения и Свод за период.',
      path: `/api/v1/market-parser/export/stats.xlsx${suffix}`,
      filename: 'market_stats.xlsx',
    },
    {
      title: 'Категория',
      text: 'Отдельный Excel по выбранной категории.',
      path: `/api/v1/market-parser/export/category/${selectedCategoryId ?? 0}.xlsx${suffix}`,
      filename: `market_category_${selectedCategoryId ?? 0}.xlsx`,
      disabled: !selectedCategoryId,
    },
  ];

  async function handleDownload(path: string, filename: string) {
    setState({ loading: true, error: null });
    try {
      await downloadFile(path, filename);
      setState({ loading: false, error: null });
    } catch (error) {
      setState({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <>
      {state.error ? <div className="notice">{state.error}</div> : null}
      <section className="export-grid">
        {items.map((item) => (
          <button
            className={item.disabled ? 'export-card disabled' : 'export-card'}
            disabled={item.disabled || state.loading}
            key={item.title}
            type="button"
            onClick={() => void handleDownload(item.path, item.filename)}
          >
            <Icon name="file" size={22} />
            <strong>{item.title}</strong>
            <span>{item.text}</span>
          </button>
        ))}
      </section>
    </>
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
  return <span className={`status ${tone}`}>{value}</span>;
}

function statusTone(value: string): string {
  switch (value) {
    case 'success':
    case 'enabled':
      return 'good';
    case 'partial':
    case 'running':
    case 'pending':
      return 'wait';
    case 'failed':
    case 'disabled':
      return 'bad';
    default:
      return 'muted';
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

function isRunActive(run: ParserRun): boolean {
  return run.status === 'pending' || run.status === 'running';
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
