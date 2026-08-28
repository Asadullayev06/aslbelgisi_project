import type {
  AdminUser, BoxContents, LoginEventRow, ProjectSummary, ScanResponse, ScanBatchResponse, ScanEventOut,
  ScanState, SearchResponse, SubmitResponse, ValidateResult,
  StockRegisterResp, StockStatusResp, StockResultResp, StockVerifyResp,
  InspectorLookupResp,
  KmParseResp, SsccParseResp, ModListResp, CustomAggRunResp, CustomAggRunBody,
  AnalysisResult,
} from "./types";

// Called when any request comes back 401 so the shell can bounce to login.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) { onUnauthorized = fn; }

/** Stable per-browser UUID used to identify a device across logins.
 *  Persists in localStorage; falls back to session-scoped when storage
 *  is unavailable (private mode, permissions). */
const DEVICE_KEY = "mav2.device_id";
function makeUUID(): string {
  const c = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // fallback for older browsers
  return "dev-" + Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
}
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) { id = makeUUID(); localStorage.setItem(DEVICE_KEY, id); }
    return id;
  } catch {
    return "no-storage";
  }
}

/** `timeoutMs` is opt-in per call. Do NOT make it a global default: the ASL
 *  submit legitimately runs for minutes on a large project. */
async function req<T>(path: string, init: RequestInit = {},
                      timeoutMs?: number): Promise<T> {
  let ctl: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs) {
    ctl = new AbortController();
    timer = setTimeout(() => ctl!.abort(), timeoutMs);
  }
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: "include",   // send/receive the auth cookie
      headers: { "Content-Type": "application/json", ...(init.headers || {}) },
      ...init,
      ...(ctl ? { signal: ctl.signal } : {}),
    });
  } catch (e: any) {
    // An abort on a weak link is a transient fault — mark it retryable so the
    // scan queue treats it like any other network blip.
    if (e?.name === "AbortError") {
      throw Object.assign(new Error("javob kelmadi (timeout)"), { status: 0 });
    }
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (res.status === 401 && !path.startsWith("/api/auth/")) {
    onUnauthorized?.();
  }
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      if (j.detail) msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch { /* ignore */ }
    // Carry the status so callers can tell a retryable server/network fault
    // (5xx) from a decision the server actually made (4xx).
    throw Object.assign(new Error(msg), { status: res.status });
  }
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

export const api = {
  // auth
  me:     () => req<{ id: number; username: string; role: string }>("/api/auth/me"),
  login:  (username: string, password: string) =>
    req<{ id: number; username: string; role: string }>(
      "/api/auth/login",
      { method: "POST", body: JSON.stringify({
          username, password, device_id: getDeviceId(),
        }) },
    ),
  logout: () => req<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),

  // projects
  listProjects: (opts: { status?: string; mode?: "aggregation" | "inventory" } = {}) => {
    const p = new URLSearchParams();
    if (opts.status) p.set("status", opts.status);
    if (opts.mode)   p.set("mode",   opts.mode);
    const qs = p.toString();
    return req<ProjectSummary[]>("/api/projects" + (qs ? `?${qs}` : ""));
  },

  getProject: (id: number) => req<ScanState>(`/api/projects/${id}`),

  createProject: (body: {
    name: string; product_name: string; total_boxes: number; per_box: number;
    has_loose: boolean; loose_qty: number;
    series: string;
    km_codes_text: string; box_codes_text: string;
    business_place_id?: string; production_order_id?: string;
  }) => req<ScanState>("/api/projects", { method: "POST", body: JSON.stringify(body) }),

  createInventoryProject: (body: {
    name: string; product_name: string;
    series: { name: string; km_codes_text: string }[];
  }) => req<ScanState>("/api/projects/inventory",
                       { method: "POST", body: JSON.stringify(body) }),

  boxContents: (projectId: number, boxId: number) =>
    req<BoxContents>(`/api/projects/${projectId}/boxes/${boxId}/contents`),

  /** Inventory-only XLSX. Server sends a proper .xlsx binary; we hand the
   *  raw Blob to the caller which then triggers the browser download. */
  inventoryExport: async (projectId: number): Promise<Blob> => {
    const r = await fetch(`/api/projects/${projectId}/inventory-export`,
                          { credentials: "include" });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.blob();
  },

  // SSCC / internal box label generator
  ssccPreview: (body: { product_name: string; company_inn: string;
                        lot_series: string; num_boxes: number }) =>
    req<{ codes_20: string[]; codes_7: string[]; count: number }>(
      "/api/sscc/preview",
      { method: "POST", body: JSON.stringify(body) }),
  ssccXlsx20: async (body: { product_name: string; company_inn: string;
                             lot_series: string; num_boxes: number }): Promise<Blob> => {
    const r = await fetch("/api/sscc/xlsx-20", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      let msg = `${r.status} ${r.statusText}`;
      try { const j = await r.json(); if (j.detail) msg = String(j.detail); } catch {}
      throw new Error(msg);
    }
    return r.blob();
  },
  ssccXlsx7: async (body: { product_name: string; company_inn: string;
                            lot_series: string; num_boxes: number }): Promise<Blob> => {
    const r = await fetch("/api/sscc/xlsx-7", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      let msg = `${r.status} ${r.statusText}`;
      try { const j = await r.json(); if (j.detail) msg = String(j.detail); } catch {}
      throw new Error(msg);
    }
    return r.blob();
  },

  // BarTender CSV generator
  bartenderPreview: async (file: File) => {
    const fd = new FormData(); fd.append("file", file);
    const r = await fetch("/api/bartender/preview",
      { method: "POST", body: fd, credentials: "include" });
    if (!r.ok) {
      let msg = `${r.status} ${r.statusText}`;
      try { const j = await r.json(); if (j.detail) msg = String(j.detail); } catch {}
      throw new Error(msg);
    }
    return (await r.json()) as {
      total: number; first: string[];
      short_count: number; short_sample: [number, string][];
    };
  },
  bartenderGenerate: async (file: File): Promise<Blob> => {
    const fd = new FormData(); fd.append("file", file);
    const r = await fetch("/api/bartender/generate",
      { method: "POST", body: fd, credentials: "include" });
    if (!r.ok) {
      let msg = `${r.status} ${r.statusText}`;
      try { const j = await r.json(); if (j.detail) msg = String(j.detail); } catch {}
      throw new Error(msg);
    }
    return r.blob();
  },

  // Admin — project edit/delete
  updateProject: (id: number, patch: {
    name?: string; product_name?: string; series?: string;
    business_place_id?: string; production_order_id?: string;
  }) => req<ScanState>(`/api/projects/${id}`,
                       { method: "PATCH", body: JSON.stringify(patch) }),
  deleteProject: (id: number) =>
    req<void>(`/api/projects/${id}`, { method: "DELETE" }),

  // Admin — users
  listUsers: () => req<AdminUser[]>("/api/users"),
  createUser: (body: { username: string; password: string; role: "admin" | "operator" }) =>
    req<AdminUser>("/api/users", { method: "POST", body: JSON.stringify(body) }),
  updateUser: (id: number, patch: {
    username?: string; password?: string;
    role?: "admin" | "operator"; is_active?: boolean;
  }) => req<AdminUser>(`/api/users/${id}`,
                       { method: "PATCH", body: JSON.stringify(patch) }),
  deleteUser: (id: number) =>
    req<void>(`/api/users/${id}`, { method: "DELETE" }),
  loginEvents: (opts: { limit?: number; only_success?: boolean } = {}) => {
    const p = new URLSearchParams();
    if (opts.limit != null) p.set("limit", String(opts.limit));
    if (opts.only_success != null) p.set("only_success", String(opts.only_success));
    const qs = p.toString();
    return req<LoginEventRow[]>("/api/users/login-events" + (qs ? "?" + qs : ""));
  },

  parseFile: async (kind: "km" | "box", file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch(`/api/projects/parse-file?kind=${kind}`,
                          { method: "POST", body: fd });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return (await r.json()) as { kind: string; codes: string[]; warnings: string[]; count: number };
  },

  scan: (projectId: number, code: string, attempt = 1) =>
    req<ScanResponse>(`/api/projects/${projectId}/scan`,
                      { method: "POST", body: JSON.stringify({ code, attempt }) }),
  /** Whole burst in one round-trip — see the queue in Scan.tsx.
   *  Timed out so a half-open connection fails fast and gets retried instead
   *  of hanging the queue; re-delivery is safe because of `attempt`. */
  scanBatch: (projectId: number, codes: string[], attempt = 1, timeoutMs = 20000) =>
    req<ScanBatchResponse>(`/api/projects/${projectId}/scan-batch`,
                           { method: "POST", body: JSON.stringify({ codes, attempt }) },
                           timeoutMs),
  scanEvents: (projectId: number, level?: string, limit = 200) =>
    req<ScanEventOut[]>(`/api/projects/${projectId}/scan-events`
      + `?limit=${limit}` + (level ? `&level=${level}` : "")),
  undo: (projectId: number) =>
    req<ScanResponse>(`/api/projects/${projectId}/undo`, { method: "POST" }),
  discard: (projectId: number) =>
    req<ScanResponse>(`/api/projects/${projectId}/discard`, { method: "POST" }),
  setLooseMode: (projectId: number, on: boolean) =>
    req<ScanResponse>(`/api/projects/${projectId}/loose-mode`,
                      { method: "POST", body: JSON.stringify({ on }) }),
  deleteBox: (projectId: number, boxId: number) =>
    req<ScanResponse>(`/api/projects/${projectId}/boxes/${boxId}`, { method: "DELETE" }),
  /** Admin surgical fix: pluck one KM out of a closed box; it returns to
   *  pending in the pool. Refused when the project is submitting/submitted. */
  removeCodeFromBox: (projectId: number, boxId: number, kmCode: string) =>
    req<ScanResponse>(`/api/projects/${projectId}/boxes/${boxId}/remove-code`,
      { method: "POST", body: JSON.stringify({ km_code: kmCode }) }),
  /** Admin: delete a KM pool row that was uploaded but never scanned.
   *  Concurrency-safe — a scanner claiming the same code wins the race. */
  deletePendingKm: (projectId: number, kmCode: string) =>
    req<ScanResponse>(`/api/projects/${projectId}/pending-km/delete`,
      { method: "POST", body: JSON.stringify({ km_code: kmCode }) }),
  analyzeProject: (projectId: number) =>
    req<AnalysisResult>(`/api/projects/${projectId}/analyze`, { method: "POST" }),

  validate: (projectId: number) =>
    req<ValidateResult>(`/api/projects/${projectId}/validate`, { method: "POST" }),
  submit: (projectId: number, body: {
    api_key?: string; inn?: string;
    business_place_id?: string; production_order_id?: string;
  }) =>
    req<SubmitResponse>(`/api/projects/${projectId}/submit`,
                        { method: "POST", body: JSON.stringify({
                            api_key: body.api_key || null,
                            inn: body.inn || "",
                            business_place_id: body.business_place_id || "",
                            production_order_id: body.production_order_id || "",
                          }) }),
  /** Re-send a project that's already in 'submitted' state, e.g. after the
   *  first send used the wrong company's credentials. Server-side guard
   *  refuses anything not currently 'submitted'. */
  resubmit: (projectId: number, body: {
    api_key?: string; inn?: string;
    business_place_id?: string; production_order_id?: string;
  }) =>
    req<SubmitResponse>(`/api/projects/${projectId}/resubmit`,
                        { method: "POST", body: JSON.stringify({
                            api_key: body.api_key || null,
                            inn: body.inn || "",
                            business_place_id: body.business_place_id || "",
                            production_order_id: body.production_order_id || "",
                          }) }),

  // GTIN stock (Ostatok)
  stockVerify: (inn: string, api_key: string) =>
    req<StockVerifyResp>("/api/gtin-stock/verify",
      { method: "POST", body: JSON.stringify({ inn, api_key }) }),
  stockRegister: (body: {
    inn: string; api_key: string; gtin: string;
    package_types: string[]; statuses: string[];
    emission_types: string[]; release_methods: string[];
    product_series: string;
  }) =>
    req<StockRegisterResp>("/api/gtin-stock/register",
      { method: "POST", body: JSON.stringify(body) }),
  stockStatus: (export_id: string, api_key: string) =>
    req<StockStatusResp>(
      `/api/gtin-stock/exports/${export_id}/status?api_key=${encodeURIComponent(api_key)}`),
  stockResult: (export_id: string, api_key: string, product_series: string) =>
    req<StockResultResp>(`/api/gtin-stock/exports/${export_id}/result`,
      { method: "POST", body: JSON.stringify({ api_key, product_series }) }),
  /** 9.3 method — unpack every transport code from the export into its
   *  consumption KMs. Returns only a flat KM code list. */
  stockKmOnly: (export_id: string, api_key: string, inn: string, product_series: string) =>
    req<{ ok: boolean; export_id: string; km_codes: string[];
          row_count: number; transport_count: number;
          warnings: string[]; fetched_at: string; error: string }>(
      `/api/gtin-stock/exports/${export_id}/km-only`,
      { method: "POST", body: JSON.stringify({ api_key, inn, product_series }) }),

  // Inspector
  inspectorLookup: (inn: string, api_key: string, codes: string[]) =>
    req<InspectorLookupResp>("/api/inspector/lookup",
      { method: "POST", body: JSON.stringify({ inn, api_key, codes }) }),

  // Custom aggregation
  customParseKm: async (file: File, validate_medicine: boolean) => {
    const fd = new FormData(); fd.append("file", file);
    const r = await fetch(`/api/custom-agg/parse-km?validate_medicine=${validate_medicine}`,
      { method: "POST", body: fd, credentials: "include" });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return (await r.json()) as KmParseResp;
  },
  customParseSscc: async (file: File) => {
    const fd = new FormData(); fd.append("file", file);
    const r = await fetch("/api/custom-agg/parse-sscc",
      { method: "POST", body: fd, credentials: "include" });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return (await r.json()) as SsccParseResp;
  },
  customModList: (inn: string, api_key: string) =>
    req<ModListResp>("/api/custom-agg/mod-list",
      { method: "POST", body: JSON.stringify({ inn, api_key }) }),
  customRun: (body: CustomAggRunBody) =>
    req<CustomAggRunResp>("/api/custom-agg/run",
      { method: "POST", body: JSON.stringify(body) }),

  // Kod qidiruv — searches submitted projects only.
  searchCodes: (codes: string[]) =>
    req<SearchResponse>("/api/search",
      { method: "POST", body: JSON.stringify({ codes }) }),
  /** Same query, delivered as an .xlsx blob. Uses fetch directly because req
   *  parses JSON and this response is a spreadsheet. */
  searchExport: async (codes: string[]): Promise<Blob> => {
    const r = await fetch("/api/search/export", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codes }),
    });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.blob();
  },
};
