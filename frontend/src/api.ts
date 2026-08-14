import type {
  ProjectSummary, ScanResponse, ScanState, SubmitResponse, ValidateResult,
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

  validate: (projectId: number) =>
    req<ValidateResult>(`/api/projects/${projectId}/validate`, { method: "POST" }),
  submit: (projectId: number, api_key?: string) =>
    req<SubmitResponse>(`/api/projects/${projectId}/submit`,
                        { method: "POST", body: JSON.stringify({ api_key: api_key || null }) }),
};
