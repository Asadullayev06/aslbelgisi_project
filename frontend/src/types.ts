// Mirrors backend/schemas.py

export type FlashLevel = "hit" | "err" | "warn";

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
  created_at: string;
}

export interface ClosedBox {
  id: number;
  sscc: string;
  codes_count: number;
  capacity: number;
  is_loose: boolean;
  closed_at: string;
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
