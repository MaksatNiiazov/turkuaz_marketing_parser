export type ParserSource = {
  id: number;
  name: string;
  code: string;
  base_url: string;
  type: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ParserCategory = {
  id: number;
  source_id: number;
  external_id: string | null;
  name: string;
  url: string;
  parent_id: number | null;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type ParserRun = {
  id: number;
  source_id: number;
  status: 'pending' | 'running' | 'success' | 'failed' | 'partial' | string;
  started_at: string | null;
  finished_at: string | null;
  total_categories: number;
  processed_categories: number;
  total_products: number;
  saved_products: number;
  error_message: string | null;
  created_by: string | null;
  created_at: string;
};

export type MarketProduct = {
  id: number;
  source_id: number;
  category_id: number | null;
  external_sku: string;
  name: string;
  unit: string | null;
  image_url: string | null;
  product_url: string | null;
  is_active: boolean;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
};

export type ProductSnapshot = {
  id: number;
  product_id: number;
  source_id: number;
  category_id: number | null;
  run_id: number | null;
  price: string | number | null;
  discount_price: string | number | null;
  discount_percent: string | number | null;
  is_available: boolean | null;
  raw_data: Record<string, unknown> | null;
  collected_at: string;
  created_at: string;
};

export type ProductStats = {
  product_id: number;
  current_price: string | number | null;
  min_price: string | number | null;
  max_price: string | number | null;
  avg_price: string | number | null;
  price_change_percent: string | number | null;
  min_discount_price: string | number | null;
  max_discount_percent: string | number | null;
  discount_days_count: number;
  snapshots_count: number;
  first_seen_at: string | null;
  last_seen_at: string | null;
};

export type ProductDiscountItem = {
  product_id: number;
  name: string;
  discount_percent: string | number | null;
  discount_price: string | number | null;
  price: string | number | null;
};

export type CategoryStats = {
  category_id: number;
  products_count: number;
  avg_price: string | number | null;
  avg_discount_percent: string | number | null;
  discounted_products_count: number;
  available_products_count: number;
  top_discounted_products: ProductDiscountItem[];
  price_increased_products: number;
  price_decreased_products: number;
};

export type CurrentUser = {
  id: number;
  active: boolean;
  email: string;
  full_name: string;
  branch_id: number | null;
  active_branch_id: number | null;
  branch_code: string | null;
  branch_name: string | null;
  branch: { id: number; code: string; name: string } | null;
  roles: string[];
  permissions: string[];
  branches: string[];
  branch_permissions: Record<string, string[]>;
  branch_permissions_by_id: Record<string, string[]>;
  department: string | null;
};
