import type {
  CategoryStats,
  CurrentUser,
  MarketProduct,
  ParserCategory,
  ParserRun,
  ParserSource,
  ProductSnapshot,
  ProductStats,
} from './types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const IDENTITY_API_BASE_URL = import.meta.env.VITE_IDENTITY_API_BASE_URL || '/identity-api';
const IDENTITY_API_FALLBACK_BASE_URL =
  import.meta.env.VITE_IDENTITY_API_FALLBACK_BASE_URL || `${localApiUrl(7500)}/api/v1`;
const TOKEN_KEY = 'identity_access_token';
const FALLBACK_TOKEN_KEY = 'access_token';
export const DEV_ADMIN_EMAIL = import.meta.env.VITE_DEV_ADMIN_EMAIL || 'admin@example.com';
export const DEV_ADMIN_PASSWORD = import.meta.env.VITE_DEV_ADMIN_PASSWORD || 'admin123';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY) || localStorage.getItem(FALLBACK_TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(FALLBACK_TOKEN_KEY);
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) clearToken();
    throw new Error(data?.detail || data?.message || `HTTP ${response.status}`);
  }
  return data as T;
}

async function requestIdentityJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const bases = uniqueBaseUrls([IDENTITY_API_BASE_URL, IDENTITY_API_FALLBACK_BASE_URL]);
  let lastError: Error | null = null;

  for (const baseUrl of bases) {
    try {
      return await requestIdentityJsonFromBase<T>(baseUrl, path, init);
    } catch (error) {
      if (!shouldRetryIdentityRequest(error) || baseUrl === bases[bases.length - 1]) {
        throw error;
      }
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error('Identity API request failed');
}

async function requestIdentityJsonFromBase<T>(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) clearToken();
    throw new HttpError(response.status, data?.detail || data?.message || `HTTP ${response.status}`);
  }
  if (!isJsonObject(data)) {
    throw new InvalidIdentityResponseError(`Identity returned non-JSON response from ${baseUrl}`);
  }
  return data as T;
}

function uniqueBaseUrls(values: string[]): string[] {
  return values.filter((value, index) => value && values.indexOf(value) === index);
}

function shouldRetryIdentityRequest(error: unknown): boolean {
  return !(error instanceof HttpError) || error.status === 404 || error.status === 405;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

class InvalidIdentityResponseError extends Error {}

function localApiUrl(port: number): string {
  if (typeof window === 'undefined') return `http://localhost:${port}`;
  return `${window.location.protocol}//${window.location.hostname}:${port}`;
}

function params(values: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export function fetchSources(): Promise<ParserSource[]> {
  return requestJson<ParserSource[]>('/api/v1/market-parser/sources');
}

export function createSource(payload: {
  name: string;
  code: string;
  base_url: string;
  type: string;
  is_active: boolean;
}): Promise<ParserSource> {
  return requestJson<ParserSource>('/api/v1/market-parser/sources', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function fetchCategories(sourceId?: number): Promise<ParserCategory[]> {
  return requestJson<ParserCategory[]>(
    `/api/v1/market-parser/categories${params({ source_id: sourceId })}`,
  );
}

export function syncCategories(sourceId: number): Promise<ParserCategory[]> {
  return requestJson<ParserCategory[]>('/api/v1/market-parser/categories/sync', {
    method: 'POST',
    body: JSON.stringify({ source_id: sourceId }),
  });
}

export function setCategoryEnabled(categoryId: number, enabled: boolean): Promise<ParserCategory> {
  return requestJson<ParserCategory>(
    `/api/v1/market-parser/categories/${categoryId}/${enabled ? 'enable' : 'disable'}`,
    { method: 'PATCH' },
  );
}

export function startRun(payload: {
  source_id: number;
  category_ids: number[];
  parse_all_enabled: boolean;
  created_by?: string;
}): Promise<ParserRun> {
  return requestJson<ParserRun>('/api/v1/market-parser/runs', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function fetchRuns(sourceId?: number): Promise<ParserRun[]> {
  return requestJson<ParserRun[]>(`/api/v1/market-parser/runs${params({ source_id: sourceId })}`);
}

export function fetchRun(runId: number): Promise<ParserRun> {
  return requestJson<ParserRun>(`/api/v1/market-parser/runs/${runId}`);
}

export function fetchProducts(filters: {
  source_id?: number;
  category_id?: number;
  name?: string;
  sku?: string;
  has_discount?: boolean;
  is_available?: boolean;
}): Promise<MarketProduct[]> {
  return requestJson<MarketProduct[]>(`/api/v1/market-parser/products${params(filters)}`);
}

export function fetchProductSnapshots(
  productId: number,
  filters: { from?: string; to?: string } = {},
): Promise<ProductSnapshot[]> {
  return requestJson<ProductSnapshot[]>(
    `/api/v1/market-parser/products/${productId}/snapshots${params(filters)}`,
  );
}

export function fetchProductStats(
  productId: number,
  filters: { from?: string; to?: string } = {},
): Promise<ProductStats> {
  return requestJson<ProductStats>(
    `/api/v1/market-parser/products/${productId}/stats${params(filters)}`,
  );
}

export function fetchCategoryStats(
  categoryId: number,
  filters: { from?: string; to?: string } = {},
): Promise<CategoryStats> {
  return requestJson<CategoryStats>(
    `/api/v1/market-parser/categories/${categoryId}/stats${params(filters)}`,
  );
}

export async function login(email: string, password: string): Promise<void> {
  const data = await loginViaIdentity(email, password).catch((error) => {
    if (!shouldUseDevAdminLogin(error, email, password)) throw error;
    return loginViaDevAdmin(email, password);
  });
  setToken(data.access_token);
}

export function fetchMe(): Promise<CurrentUser> {
  return requestJson<CurrentUser>('/api/v1/auth/me');
}

export async function loginAsDevAdmin(): Promise<void> {
  const data = await loginViaDevAdmin(DEV_ADMIN_EMAIL, DEV_ADMIN_PASSWORD);
  setToken(data.access_token);
}

function loginViaIdentity(email: string, password: string): Promise<{ access_token: string }> {
  return requestIdentityJson<{ access_token: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

function loginViaDevAdmin(email: string, password: string): Promise<{ access_token: string }> {
  return requestJson<{ access_token: string }>('/api/v1/auth/dev-admin-login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

function shouldUseDevAdminLogin(error: unknown, email: string, password: string): boolean {
  return (
    shouldRetryIdentityRequest(error) &&
    email.trim().toLowerCase() === DEV_ADMIN_EMAIL.toLowerCase() &&
    password === DEV_ADMIN_PASSWORD
  );
}

export async function downloadFile(path: string, fallbackFilename: string): Promise<void> {
  const token = getToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) {
    if (response.status === 401) clearToken();
    const data = await response.json().catch(() => null);
    throw new Error(data?.detail || data?.message || `HTTP ${response.status}`);
  }

  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition') || '';
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] || fallbackFilename;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
