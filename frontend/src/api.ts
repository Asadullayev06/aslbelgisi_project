import type {
  ProjectSummary, ScanResponse, ScanState, SubmitResponse, ValidateResult,
  StockRegisterResp, StockStatusResp, StockResultResp, StockVerifyResp,
  InspectorLookupResp,
  KmParseResp, SsccParseResp, ModListResp, CustomAggRunResp, CustomAggRunBody,
  AnalysisResult,
} from "./types";

// Called when any request comes back 401 so the shell can bounce to login.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) { onUnauthorized = fn; }

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",   // send/receive the auth cookie
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    ...init,
  });
  if (res.status === 401 && !path.startsWith("/api/auth/")) {
    onUnauthorized?.();
  }
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      if (j.detail) msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch { /* ignore */ }
    throw new Error(msg);
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
      { method: "POST", body: JSON.stringify({ username, password }) },
    ),
  logout: () => req<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),

  // projects
  listProjects: (status?: string) =>
    req<ProjectSummary[]>("/api/projects" + (status ? `?status=${status}` : "")),

  getProject: (id: number) => req<ScanState>(`/api/projects/${id}`),

  createProject: (body: {
    name: string; product_name: string; total_boxes: number; per_box: number;
    has_loose: boolean; loose_qty: number; business_place_id: string;
    production_order_id: string; km_codes_text: string; box_codes_text: string;
  }) => req<ScanState>("/api/projects", { method: "POST", body: JSON.stringify(body) }),

  parseFile: async (kind: "km" | "box", file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch(`/api/projects/parse-file?kind=${kind}`,
                          { method: "POST", body: fd });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return (await r.json()) as { kind: string; codes: string[]; warnings: string[]; count: number };
  },

  scan: (projectId: number, code: string) =>
    req<ScanResponse>(`/api/projects/${projectId}/scan`,
                      { method: "POST", body: JSON.stringify({ code }) }),
  undo: (projectId: number) =>
    req<ScanResponse>(`/api/projects/${projectId}/undo`, { method: "POST" }),
  discard: (projectId: number) =>
    req<ScanResponse>(`/api/projects/${projectId}/discard`, { method: "POST" }),
  setLooseMode: (projectId: number, on: boolean) =>
    req<ScanResponse>(`/api/projects/${projectId}/loose-mode`,
                      { method: "POST", body: JSON.stringify({ on }) }),
  deleteBox: (projectId: number, boxId: number) =>
    req<ScanResponse>(`/api/projects/${projectId}/boxes/${boxId}`, { method: "DELETE" }),
  analyzeProject: (projectId: number) =>
    req<AnalysisResult>(`/api/projects/${projectId}/analyze`, { method: "POST" }),

  validate: (projectId: number) =>
    req<ValidateResult>(`/api/projects/${projectId}/validate`, { method: "POST" }),
  submit: (projectId: number, api_key?: string) =>
    req<SubmitResponse>(`/api/projects/${projectId}/submit`,
                        { method: "POST", body: JSON.stringify({ api_key: api_key || null }) }),

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
};
