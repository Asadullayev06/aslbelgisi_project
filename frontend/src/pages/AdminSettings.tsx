import { useEffect, useState } from "react";
import {
  ArrowLeft, Plus, Trash2, Pencil, Shield, HardHat, Save, X,
  Check, KeyRound, UserPlus, Activity, RefreshCw, Monitor,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHead } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Field, Input } from "@/components/ui/Input";
import { Toaster, useFlashes } from "@/components/ui/Toast";
import { api } from "@/api";
import { useAuth } from "@/auth";
import type { AdminUser, LoginEventRow } from "@/types";

interface Props { onExit: () => void; }

export function AdminSettings({ onExit }: Props) {
  const { user } = useAuth();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const { flashes, push, dismiss } = useFlashes();

  async function load() {
    try { setUsers(await api.listUsers()); }
    catch (e: any) { push("err", String(e.message || e)); }
  }
  useEffect(() => { load(); }, []);

  async function doDelete(u: AdminUser) {
    if (!confirm(`"${u.username}" foydalanuvchisini o'chirasizmi? Bu amal ortga qaytmaydi.`)) return;
    setBusy(true);
    try {
      await api.deleteUser(u.id);
      push("hit", `"${u.username}" o'chirildi`);
      await load();
    } catch (e: any) { push("err", String(e.message || e)); }
    setBusy(false);
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <Toaster flashes={flashes} onDismiss={dismiss} />

      <div className="mb-6 flex items-center justify-between gap-4">
        <button onClick={onExit}
                className="text-muted hover:text-text inline-flex items-center gap-1">
          <ArrowLeft className="size-4" /> Bosh sahifa
        </button>
        <div className="text-right">
          <div className="text-3xl font-extrabold tracking-tight text-accent">
            Admin sozlamalari
          </div>
          <div className="text-muted text-sm">
            Foydalanuvchilarni boshqarish
          </div>
        </div>
      </div>

      <Card>
        <CardHead
          title="Foydalanuvchilar"
          right={
            <>
              <Badge tone="accent">{users?.length ?? 0}</Badge>
              <Button variant="primary" size="sm" onClick={() => setNewOpen(v => !v)}>
                {newOpen ? <><X className="size-3" /> Bekor</>
                         : <><UserPlus className="size-3" /> Yangi</>}
              </Button>
            </>
          }
        />

        {newOpen && (
          <CreateUserForm
            onCreated={async () => { setNewOpen(false); await load(); push("hit", "Yaratildi"); }}
            onError={(m) => push("err", m)}
          />
        )}

        {users === null && <div className="text-muted text-sm py-4">Yuklanmoqda…</div>}

        {users && users.length > 0 && (
          <div className="rounded-lg border border-border overflow-hidden mt-3">
            <table className="w-full text-sm">
              <thead className="bg-surface2/60">
                <tr>
                  <Th>Login</Th>
                  <Th>Rol</Th>
                  <Th>Holat</Th>
                  <Th className="text-right">Amallar</Th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <UserRow key={u.id} u={u} isMe={user?.id === u.id}
                           editing={editingId === u.id}
                           onEdit={() => setEditingId(u.id)}
                           onCancel={() => setEditingId(null)}
                           onSaved={async () => {
                             setEditingId(null); await load(); push("hit", "Saqlandi");
                           }}
                           onError={(m) => push("err", m)}
                           onDelete={() => doDelete(u)}
                           busy={busy} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="text-xs text-muted mt-4 mb-6">
        Eslatma: kamida bitta faol admin qolishi shart. O'zingizni o'chira olmaysiz.
      </div>

      <ActivityCard />
    </div>
  );
}


function ActivityCard() {
  const [rows, setRows] = useState<LoginEventRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [onlySuccess, setOnlySuccess] = useState<boolean | null>(null);
  const { flashes, push, dismiss } = useFlashes();

  async function load() {
    setBusy(true);
    try {
      const r = await api.loginEvents({
        limit: 200,
        ...(onlySuccess === null ? {} : { only_success: onlySuccess }),
      });
      setRows(r);
    } catch (e: any) { push("err", String(e.message || e)); }
    setBusy(false);
  }
  useEffect(() => { load(); /* refetch when filter changes */ }, [onlySuccess]);

  return (
    <>
      <Toaster flashes={flashes} onDismiss={dismiss} />
      <Card>
        <CardHead
          title="Faoliyat — kim qachon kirdi"
          right={
            <>
              <Badge tone="accent"><Activity className="size-3" /> {rows?.length ?? 0}</Badge>
              <FilterChip active={onlySuccess === null}
                          onClick={() => setOnlySuccess(null)}>Hammasi</FilterChip>
              <FilterChip active={onlySuccess === true}
                          onClick={() => setOnlySuccess(true)}>Muvaffaqiyatli</FilterChip>
              <FilterChip active={onlySuccess === false}
                          onClick={() => setOnlySuccess(false)}>Xato</FilterChip>
              <Button variant="outline" size="sm" onClick={load} disabled={busy}>
                <RefreshCw className={"size-3 " + (busy ? "animate-spin" : "")} />
              </Button>
            </>
          }
        />
        {rows === null && <div className="text-muted text-sm py-3">Yuklanmoqda…</div>}
        {rows && rows.length === 0 && (
          <div className="text-muted text-sm py-6 text-center italic">
            Hozircha kirish yozuvlari yo'q.
          </div>
        )}
        {rows && rows.length > 0 && (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-surface2/60">
                <tr>
                  <Th>Vaqt</Th>
                  <Th>Foydalanuvchi</Th>
                  <Th>IP</Th>
                  <Th>Qurilma / Brauzer</Th>
                  <Th>Natija</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-t border-border">
                    <Td className="whitespace-nowrap">
                      {new Date(r.created_at).toLocaleString()}
                    </Td>
                    <Td>
                      <div className="font-mono">{r.username}</div>
                    </Td>
                    <Td><span className="font-mono text-[11px]">{r.ip || "—"}</span></Td>
                    <Td>
                      <div className="flex items-start gap-1.5">
                        <Monitor className="size-3 mt-0.5 text-muted shrink-0" />
                        <div className="min-w-0">
                          <div className="text-[11px] text-muted truncate max-w-[260px]" title={r.user_agent}>
                            {shortUA(r.user_agent)}
                          </div>
                          <div className="font-mono text-[10px] text-muted/60 truncate max-w-[260px]" title={r.device_id}>
                            {r.device_id ? r.device_id.slice(0, 12) + "…" : "—"}
                          </div>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      {r.success ? (
                        <Badge tone="success">✓ ok</Badge>
                      ) : (
                        <Badge tone="danger">{reasonLabel(r.reason)}</Badge>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="text-[11px] text-muted mt-2">
          Oxirgi 200 ta yozuv ko'rsatildi.
        </div>
      </Card>
    </>
  );
}


function FilterChip({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick}
            className={"text-xs px-2 py-1 rounded-md border transition-colors " +
              (active
                ? "bg-accent/15 border-accent/50 text-accent"
                : "border-border text-muted hover:text-text hover:border-accent/30")}>
      {children}
    </button>
  );
}

function reasonLabel(reason: string): string {
  switch (reason) {
    case "bad_password":  return "noto'g'ri parol";
    case "unknown_user":  return "noma'lum login";
    case "user_disabled": return "faolsizlantirilgan";
    default:              return reason || "xato";
  }
}

/** Compact user-agent — just the browser and OS chunk. */
function shortUA(ua: string): string {
  if (!ua) return "—";
  const m = ua.match(/(Chrome|Firefox|Safari|Edg|OPR|Opera)\/([\d.]+)/);
  const os = /Windows NT [\d.]+/.exec(ua)?.[0]
          || /Mac OS X [\d_.]+/.exec(ua)?.[0]?.replace(/_/g, ".")
          || /Android [\d.]+/.exec(ua)?.[0]
          || /iPhone OS [\d_]+/.exec(ua)?.[0]?.replace(/_/g, ".")
          || /Linux/.exec(ua)?.[0]
          || "";
  return m ? `${m[1]} ${m[2].split(".")[0]} · ${os}` : ua.slice(0, 60);
}


function CreateUserForm({ onCreated, onError }: {
  onCreated: () => void; onError: (m: string) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "operator">("operator");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!username.trim()) { onError("login kiriting"); return; }
    if (password.length < 4) { onError("parol kamida 4 belgi"); return; }
    setBusy(true);
    try {
      await api.createUser({ username: username.trim(), password, role });
      setUsername(""); setPassword(""); setRole("operator");
      onCreated();
    } catch (e: any) { onError(String(e.message || e)); }
    setBusy(false);
  }

  return (
    <div className="mt-2 rounded-lg border border-accent/40 bg-accent/5 p-3">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
        <Field label="Login">
          <Input value={username} onChange={e => setUsername(e.target.value)}
                 placeholder="worker3" autoComplete="off" />
        </Field>
        <Field label="Parol">
          <Input type="password" value={password}
                 onChange={e => setPassword(e.target.value)}
                 placeholder="kamida 4 belgi" autoComplete="new-password" />
        </Field>
        <Field label="Rol">
          <select value={role}
                  onChange={e => setRole(e.target.value as "admin" | "operator")}
                  className="h-11 rounded-lg bg-surface2 border border-border px-3 text-sm">
            <option value="operator">operator</option>
            <option value="admin">admin</option>
          </select>
        </Field>
        <Button variant="primary" onClick={submit} disabled={busy}>
          <Plus className="size-4" /> {busy ? "…" : "Yaratish"}
        </Button>
      </div>
    </div>
  );
}


function UserRow({ u, isMe, editing, onEdit, onCancel, onSaved, onError, onDelete, busy }: {
  u: AdminUser; isMe: boolean; editing: boolean; busy: boolean;
  onEdit: () => void; onCancel: () => void;
  onSaved: () => Promise<void>; onError: (m: string) => void;
  onDelete: () => void;
}) {
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "operator">(u.role);
  const [active, setActive] = useState(u.is_active);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) {
      setPassword(""); setRole(u.role); setActive(u.is_active);
    }
  }, [editing, u.role, u.is_active]);

  async function save() {
    setSaving(true);
    try {
      const patch: Parameters<typeof api.updateUser>[1] = {};
      if (password) patch.password = password;
      if (role !== u.role) patch.role = role;
      if (active !== u.is_active) patch.is_active = active;
      if (Object.keys(patch).length === 0) { onCancel(); return; }
      await api.updateUser(u.id, patch);
      await onSaved();
    } catch (e: any) { onError(String(e.message || e)); }
    setSaving(false);
  }

  if (editing) {
    return (
      <tr className="border-t border-border bg-surface2/30">
        <Td className="font-mono">{u.username}</Td>
        <Td>
          <select value={role}
                  disabled={isMe}
                  onChange={e => setRole(e.target.value as "admin" | "operator")}
                  className="h-8 rounded bg-surface border border-border px-2 text-xs">
            <option value="operator">operator</option>
            <option value="admin">admin</option>
          </select>
        </Td>
        <Td>
          <label className="inline-flex items-center gap-1.5">
            <input type="checkbox" checked={active}
                   disabled={isMe}
                   onChange={e => setActive(e.target.checked)}
                   className="accent-[hsl(var(--accent))]" />
            <span className="text-xs">faol</span>
          </label>
        </Td>
        <Td className="text-right">
          <div className="flex justify-end gap-2 items-center">
            <div className="relative">
              <KeyRound className="absolute left-2 top-1.5 size-3 text-muted" />
              <input type="password" value={password}
                     onChange={e => setPassword(e.target.value)}
                     placeholder="yangi parol"
                     className="h-8 pl-7 pr-2 rounded bg-surface border border-border text-xs w-36" />
            </div>
            <Button variant="primary" size="sm" onClick={save} disabled={saving}>
              <Save className="size-3" /> {saving ? "…" : "Saqlash"}
            </Button>
            <Button variant="outline" size="sm" onClick={onCancel}>
              <X className="size-3" />
            </Button>
          </div>
        </Td>
      </tr>
    );
  }

  return (
    <tr className="border-t border-border">
      <Td className="font-mono">
        <div className="flex items-center gap-2">
          {u.role === "admin"
            ? <Shield className="size-4 text-accent" />
            : <HardHat className="size-4 text-warning" />}
          <span>{u.username}</span>
          {isMe && <Badge tone="neutral">siz</Badge>}
        </div>
      </Td>
      <Td>
        <Badge tone={u.role === "admin" ? "accent" : "warning"}>{u.role}</Badge>
      </Td>
      <Td>
        {u.is_active
          ? <span className="inline-flex items-center gap-1 text-success text-xs">
              <Check className="size-3" /> faol
            </span>
          : <span className="text-muted text-xs">o'chirilgan</span>}
      </Td>
      <Td className="text-right">
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil className="size-3" /> Tahrirlash
          </Button>
          <Button variant="danger" size="sm" onClick={onDelete}
                  disabled={isMe || busy}
                  title={isMe ? "O'zingizni o'chira olmaysiz" : ""}>
            <Trash2 className="size-3" />
          </Button>
        </div>
      </Td>
    </tr>
  );
}


function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-semibold text-muted text-xs uppercase tracking-wide ${className}`}>{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}
