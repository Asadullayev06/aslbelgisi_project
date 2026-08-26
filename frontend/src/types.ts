// Mirrors backend/schemas.py

export type FlashLevel = "hit" | "err" | "warn";

export type ProjectMode = "aggregation" | "inventory";

export interface AdminUser {
  id: number;
  username: string;
  role: "admin" | "operator";
  is_active: boolean;
  created_at: string;
}

export interface LoginEventRow {
  id: number;
  user_id: number | null;
  username: string;
  device_id: string;
  ip: string;
  user_agent: string;
  success: boolean;
  reason: string;
  created_at: string;
}

export interface ProjectPlan {
  id: number;
  name: string;
  product_name: string;
  total_boxes: number;
  per_box: number;
  has_loose: boolean;
  loose_qty: number;
  full_boxes: number;
  planned_km: number;
  business_place_id: string;
  production_order_id: string;
  series?: string;
  inventory_series?: string[];       // inventory only
  mode?: ProjectMode;
  status: "active" | "submitting" | "submitted" | "archived";
  created_at: string;
}

export interface ProjectSummary {
  id: number;
  name: string;
  product_name: string;
  total_boxes: number;
  per_box: number;
  has_loose: boolean;
  loose_qty: number;
  status: string;
  mode?: ProjectMode;
  series?: string;
  created_at: string;
}

export interface ClosedBox {
  id: number;
  sscc: string;
  codes_count: number;
  capacity: number;
  is_loose: boolean;
  closed_at: string;
  matched_count?: number;     // inventory only
  extra_count?: number;       // inventory only
}

export interface BoxCode {
  km_code: string;
  matched_series: string[];   // empty = extra
}

export interface BoxContents {
  box_id: number;
  sscc: string;
  is_loose: boolean;
  codes_count: number;
  matched: BoxCode[];
  extras: BoxCode[];
}

export interface MissingPreview {
  count: number;
  preview: string[];
}

export interface ScanState {
  project: ProjectPlan;
  total_km: number;
  scanned_km: number;
  aggregated_km: number;
  pending_km: number;
  full_closed: number;
  loose_closed: boolean;
  closed_boxes: ClosedBox[];
  current_codes: string[];
  current_capacity: number;
  current_is_loose: boolean;
  missing_km: MissingPreview;
  missing_box: MissingPreview;
}

export interface ScanResponse {
  level: FlashLevel;
  message: string;
  kind?: string;
  code?: string;
  state: ScanState;
}

/** One code's verdict inside a batch. */
export interface ScanResult {
  code: string;
  level: FlashLevel;
  message: string;
  kind?: string | null;
}

export interface ScanBatchResponse {
  results: ScanResult[];
  accepted: number;
  rejected: number;
  state: ScanState;
}

/** Local code search — submitted projects only. */
export interface SearchProjectRef {
  id: number;
  name: string;
  product_name: string;
  series: string;
}
export interface SearchBox {
  sscc: string;
  is_loose: boolean;
  closed_at: string;
}
export interface SearchRow {
  raw: string;
  kind: "km" | "sscc" | "unknown";
  canonical: string;
  found: boolean;
  project: SearchProjectRef | null;
  box: SearchBox | null;
  km_status: string | null;
  km_codes: string[];
  km_count: number;
}
export interface SearchResponse {
  results: SearchRow[];
  total: number;
  found: number;
}

/** A row of the server-side scan audit log. */
export interface ScanEventOut {
  id: number;
  raw_code: string;
  km_code: string;
  level: string;
  reason: string;
  username: string;
  created_at: string;
}

export interface ValidateResult {
  ok: boolean;
  reasons: string[];
}

export interface ReportOut {
  report_index: number;
  ok: boolean;
  http_status?: number | null;
  document_id?: string | null;
  error: string;
  unit_count: number;
  code_count: number;
  sscc_list: string[];
  skipped: boolean;
}

export interface SubmitResponse {
  ok: boolean;
  reports: ReportOut[];
  error?: string | null;
  total_reports: number;
}

// GTIN Ostatok
export interface StockRow {
  code: string;
  status: string;
  extended_status: string;
  package_type: string;
  gtin: string;
  product_id: string;
  product_name: string;
  product_series: string;
  production_date: string;
  expiration_date: string;
  emission_date: string;
  emission_type: string;
  original_release_method: string;
  owner_tin: string;
  owner_name: string;
  owner_business_place_id: string;
  parent_code: string;
  empty_package: boolean;
}
export interface StockRegisterResp { ok: boolean; export_id: string; error: string; }
export interface StockStatusResp   { ok: boolean; export_id: string; status: string; ready: boolean; error: string; }
export interface StockResultResp {
  ok: boolean; export_id: string; row_count: number; raw_result_count: number;
  rows: StockRow[]; available_series: string[];
  zip_b64: string; zip_filename: string; fetched_at: string; error: string;
}
export interface StockVerifyResp { ok: boolean; inn: string; error?: string | null; detail?: any; }

// Marking-code inspector
export interface InspectorBasic {
  code: string; status: string; status_label: string;
  gtin: string; product_name: string;
  product_group: string; product_group_name: string;
  tnved_code: string; tnved_name: string;
  serial_number: string; batch: string;
  production_date: string; expiration_date: string;
  mrp: string; package_type: string;
}
export interface InspectorOwner {
  owner_inn: string; owner_name: string; owner_address: string;
  emitter_inn: string; emitter_name: string; emitter_address: string;
  manufacturer_inn: string; manufacturer_name: string; manufacturer_country: string;
  importer_inn: string; importer_name: string;
}
export interface InspectorAggregation {
  parent_code: string; parent_type: string;
  child_codes: any[];
  aggregation_date: string; aggregation_document_id: string;
  hierarchy_level: string; is_aggregated: boolean;
}
export interface InspectorDocument {
  document_id: string; document_type: string; document_status: string;
  document_date: string;
  sender_inn: string; sender_name: string;
  receiver_inn: string; receiver_name: string;
  description: string;
}
export interface InspectorCustoms {
  aic_code: string; customs_declaration: string; customs_date: string;
  country_of_origin: string; customs_status: string;
}
export interface InspectorResult {
  success: boolean; error: string; http_status: number; is_html: boolean;
  basic: InspectorBasic;
  owner: InspectorOwner;
  aggregation: InspectorAggregation;
  documents: InspectorDocument[];
  customs: InspectorCustoms;
  raw_response: any;
  emission_date: string;
  summary_owner: string;
  summary_product: string;
}
export interface InspectorLookupResp {
  ok: boolean;
  total: number;
  successful: number;
  failed: number;
  results: InspectorResult[];
}

// Custom aggregation
export interface KmParseResp { codes: string[]; invalid: any[][]; warnings: string[]; total_raw: number; }
export interface SsccParseResp {
  codes: string[];
  total: number;
  invalid: any[][];      // [line_num, code, reason]
  warnings: string[];
  total_raw: number;
}
export interface ModItem { id: string; name: string; raw?: any; }
export interface ModListResp { ok: boolean; mods: ModItem[]; error: string; }

export interface CustomAggGroup { index: number; sscc: string; codes_count: number; }
export interface CodeError {
  code: string;
  error_code: string;
  index: number | null;
  property: string;
  tags: Record<string, any>;
}
export interface CustomAggReport {
  report_index: number;
  unit_count: number;
  code_count: number;
  sscc_list: string[];
  group_indices: number[];
  ok: boolean;
  http_status: number;
  document_id: string;
  error: string;
  verification_status: string;
  code_errors: CodeError[];
  timed_out: boolean;
}
export interface CustomAggRunResp {
  ok: boolean;
  mode: "dry_run" | "submit";
  errors: string[];
  groups: CustomAggGroup[];
  reports: CustomAggReport[];
  total_reports: number;
}
// AI Tahlil (project quality analysis)
export interface AnalysisCheck {
  level: "ok" | "warn" | "blocker";
  title: string;
  detail: string;
  sample?: string[];
}
export interface AnalysisResult {
  health: "healthy" | "warnings" | "blockers";
  summary: {
    km_total: number; km_aggregated: number; km_claimed: number; km_pending: number;
    sscc_total: number; sscc_used: number;
    closed_full: number; closed_loose: number;
    full_planned: number; planned_km: number;
  };
  checks: AnalysisCheck[];
  recommendations: string[];
  generated_at: string;
}

export interface CustomAggRunBody {
  api_key?: string;
  codes: string[];
  group_size: number;
  business_place_id?: string;
  production_order_id?: string;
  sscc_source: "auto" | "upload";
  sscc_inn?: string;
  sscc_use_gcp?: boolean;
  sscc_gcp_prefix?: string;
  sscc_start?: number;
  sscc_uploaded?: string[];
  mode: "dry_run" | "submit";
}
