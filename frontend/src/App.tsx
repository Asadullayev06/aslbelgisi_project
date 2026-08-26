import { useCallback, useEffect, useState } from "react";
import { Boxes, Plus, LogOut, Shield, HardHat, ScanBarcode, Package, ArrowRight, ScanLine, Layers, Search, ClipboardList, ArrowLeft, Settings, Trash2, Pencil, Check, X, Sun, Moon, Barcode, Printer } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHead } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Setup } from "@/pages/Setup";
import { SetupInventory } from "@/pages/SetupInventory";
import { Scan } from "@/pages/Scan";
import { ScanInventory } from "@/pages/ScanInventory";
import { Login } from "@/pages/Login";
import { GtinStock } from "@/pages/GtinStock";
import { Inspector } from "@/pages/Inspector";
import { CustomAggregation } from "@/pages/CustomAggregation";
import { CodeSearch } from "@/pages/CodeSearch";
import { AdminSettings } from "@/pages/AdminSettings";
import { SsccGenerator } from "@/pages/SsccGenerator";
import { BarTenderCsv } from "@/pages/BarTenderCsv";
import { api, setUnauthorizedHandler } from "@/api";
import { AuthContext, isAdmin, useAuth, type User } from "@/auth";
import type { ProjectSummary } from "@/types";

type Route =
  | { kind: "home" }
  | { kind: "modeChooser" }                 // NEW: agg vs inventory
  | { kind: "picker" }                       // aggregation projects
  | { kind: "setup"; presetName?: string; presetProduct?: string; pickFromExisting?: boolean }
  | { kind: "scan"; projectId: number }
  | { kind: "invPicker" }                    // NEW: inventory projects
  | { kind: "invSetup" }                     // NEW
  | { kind: "invScan"; projectId: number }   // NEW
  | { kind: "stock" }
  | { kind: "inspector" }
  | { kind: "custom" }
  | { kind: "search" }
  | { kind: "sscc" }
  | { kind: "bartender" }
  | { kind: "admin" };

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [route, setRoute] = useState<Route>({ kind: "home" });

  // Bootstrap: is there already a valid cookie?
  useEffect(() => {
    api.me()
      .then(u => setUser(u as User))
      .catch(() => setUser(null))
      .finally(() => setAuthLoading(false));
  }, []);

  // Any 401 anywhere kicks us back to login.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setRoute({ kind: "home" });
    });
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const u = await api.login(username, password);
    setUser(u as User);
    setRoute({ kind: "home" });
  }, []);

  const logout = useCallback(async () => {
    try { await api.logout(); } catch { /* ignore */ }
    setUser(null);
    setRoute({ kind: "home" });
  }, []);

  if (authLoading) {
    return <div className="min-h-screen grid place-items-center text-muted">Yuklanmoqda…</div>;
  }

  return (
    <AuthContext.Provider value={{ user, loading: false, login, logout }}>
      {user ? (
        <Shell route={route} setRoute={setRoute} />
      ) : (
        <Login />
      )}
    </AuthContext.Provider>
  );
}


function Shell({ route, setRoute }: {
  route: Route;
  setRoute: (r: Route) => void;
}) {
  if (route.kind === "setup") {
    return <Setup onCreated={id => setRoute({ kind: "scan", projectId: id })}
                  onCancel={() => setRoute({ kind: "picker" })}
                  presetName={route.presetName}
                  presetProduct={route.presetProduct}
                  pickFromExisting={route.pickFromExisting} />;
  }
  if (route.kind === "scan") {
    return <Scan projectId={route.projectId} onExit={() => setRoute({ kind: "picker" })} />;
  }
  if (route.kind === "stock") {
    return <GtinStock onExit={() => setRoute({ kind: "home" })} />;
  }
  if (route.kind === "inspector") {
    return <Inspector onExit={() => setRoute({ kind: "home" })} />;
  }
  if (route.kind === "custom") {
    return <CustomAggregation onExit={() => setRoute({ kind: "home" })} />;
  }
  if (route.kind === "search") {
    return <CodeSearch onExit={() => setRoute({ kind: "home" })} />;
  }
  if (route.kind === "picker") {
    return <Picker onOpen={id => setRoute({ kind: "scan", projectId: id })}
                   onNew={() => setRoute({ kind: "setup" })}
                   onNewSeriesPick={() => setRoute({ kind: "setup", pickFromExisting: true })}
                   onNewSeries={(name, productName) =>
                     setRoute({ kind: "setup",
                                presetName: name,
                                presetProduct: productName })}
                   onHome={() => setRoute({ kind: "modeChooser" })} />;
  }
  if (route.kind === "modeChooser") {
    return <ModeChooser onAggregation={() => setRoute({ kind: "picker" })}
                        onInventory={() => setRoute({ kind: "invPicker" })}
                        onHome={() => setRoute({ kind: "home" })} />;
  }
  if (route.kind === "invPicker") {
    return <InvPicker onOpen={id => setRoute({ kind: "invScan", projectId: id })}
                      onNew={() => setRoute({ kind: "invSetup" })}
                      onHome={() => setRoute({ kind: "modeChooser" })} />;
  }
  if (route.kind === "invSetup") {
    return <SetupInventory onCreated={id => setRoute({ kind: "invScan", projectId: id })}
                           onCancel={() => setRoute({ kind: "invPicker" })} />;
  }
  if (route.kind === "invScan") {
    return <ScanInventory projectId={route.projectId}
                          onExit={() => setRoute({ kind: "invPicker" })} />;
  }
  if (route.kind === "admin") {
    return <AdminSettings onExit={() => setRoute({ kind: "home" })} />;
  }
  if (route.kind === "sscc") {
    return <SsccGenerator onExit={() => setRoute({ kind: "home" })} />;
  }
  if (route.kind === "bartender") {
    return <BarTenderCsv onExit={() => setRoute({ kind: "home" })} />;
  }
  return <Home onAggregation={() => setRoute({ kind: "modeChooser" })}
               onStock={() => setRoute({ kind: "stock" })}
               onInspector={() => setRoute({ kind: "inspector" })}
               onCustom={() => setRoute({ kind: "custom" })}
               onSearch={() => setRoute({ kind: "search" })}
               onSscc={() => setRoute({ kind: "sscc" })}
               onBartender={() => setRoute({ kind: "bartender" })}
               onAdmin={() => setRoute({ kind: "admin" })} />;
}


/** Two-card chooser shown after clicking "Agregatsiya" on Home. */
function ModeChooser({ onAggregation, onInventory, onHome }: {
  onAggregation: () => void; onInventory: () => void; onHome: () => void;
}) {
  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <TopBar />
      <button onClick={onHome}
              className="text-muted hover:text-text inline-flex items-center gap-1 mb-4">
        <ArrowLeft className="size-4" /> Bosh sahifa
      </button>
      <div className="mb-8">
        <div className="text-3xl font-extrabold tracking-tight text-accent">
          Agregatsiya turini tanlang
        </div>
        <div className="text-muted text-sm mt-1">
          Ikkalasida ham skanerlash bir xil, farqi loyihaning maqsadida
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ToolCard
          icon={<Package className="size-8 text-accent" />}
          title="Haqiqiy Agregatsiya"
          subtitle="Karobkalarga joylash → Asl Belgisi ga rasmiy ommaviy agregatsiya so'rovi"
          onClick={onAggregation}
        />
        <ToolCard
          icon={<ClipboardList className="size-8 text-warning" />}
          title="Inventarizatsiya"
          subtitle="Omborni sanash — bir necha seriya, cheklangan miqdorsiz skanerlash, ASL ga yuborilmaydi"
          onClick={onInventory}
        />
      </div>
    </div>
  );
}


/** Same visual as the aggregation Picker but reads mode='inventory'. */
function InvPicker({ onOpen, onNew, onHome }: {
  onOpen: (id: number) => void; onNew: () => void; onHome: () => void;
}) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => {
    setErr(null);
    api.listProjects({ mode: "inventory" })
      .then(setProjects).catch(e => setErr(String(e)));
  };
  useEffect(load, []);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <TopBar />
      <button onClick={onHome}
              className="text-muted hover:text-text inline-flex items-center gap-1 mb-4">
        <ArrowLeft className="size-4" /> Ortga
      </button>
      <div className="mb-6 flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <div className="text-3xl font-extrabold tracking-tight text-warning">
            Inventarizatsiya loyihalari
          </div>
          <div className="text-muted text-sm mt-1">
            Ombordagi mahsulotlarni sanash uchun
          </div>
        </div>
        <NewInvProjectButton onClick={onNew} />
      </div>

      <Card>
        <CardHead title="Faol inventarizatsiya loyihalari"
                  right={<Badge tone="warning">{projects?.length ?? 0}</Badge>} />
        {err && (
          <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
            {err}
          </div>
        )}
        {!projects && !err && <div className="text-muted text-sm">Yuklanmoqda…</div>}
        {projects && projects.length === 0 && (
          <div className="text-muted text-sm py-6 text-center italic">
            Hali birorta inventarizatsiya loyihasi yaratilmagan.
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {projects?.map(p => (
            <ProjectRow key={p.id} p={p} tone="warning"
                        icon={<ClipboardList className="size-4 text-warning" />}
                        onOpen={onOpen} onChanged={load} />
          ))}
        </div>
      </Card>
    </div>
  );
}

function NewInvProjectButton({ onClick }: { onClick: () => void }) {
  const { user } = useAuth();
  if (!isAdmin(user)) return null;
  return (
    <Button variant="warning" size="lg" onClick={onClick}>
      <Plus className="size-4" /> Yangi inventarizatsiya
    </Button>
  );
}


function Home({ onAggregation, onStock, onInspector, onCustom, onSearch, onSscc, onBartender, onAdmin }: {
  onAggregation: () => void;
  onStock: () => void;
  onInspector: () => void;
  onCustom: () => void;
  onSearch: () => void;
  onSscc: () => void;
  onBartender: () => void;
  onAdmin: () => void;
}) {
  const { user } = useAuth();
  const admin = isAdmin(user);
  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <TopBar />
      <div className="mb-8">
        <div className="text-3xl font-extrabold tracking-tight text-accent">Asl Belgisi Ish maydoni</div>
        <div className="text-muted text-sm mt-1">Vositalar</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <ToolCard
          icon={<Package className="size-8 text-accent" />}
          title="Agregatsiya"
          subtitle="Mahsulotlarni karobkalarga joylash va ommaviy agregatsiya"
          onClick={onAggregation}
        />
        <ToolCard
          icon={<ScanBarcode className="size-8 text-accent" />}
          title="GTIN Ostatok"
          subtitle="GTIN bo'yicha real vaqtdagi kompaniya qoldiqlarini ko'rish"
          onClick={onStock}
        />
        <ToolCard
          icon={<ScanLine className="size-8 text-accent" />}
          title="Marka Kod Tekshiruvi"
          subtitle="Bitta yoki bir nechta KM kod bo'yicha batafsil ma'lumot"
          onClick={onInspector}
        />
        <ToolCard
          icon={<Layers className="size-8 text-accent" />}
          title="Custom Aggregation"
          subtitle="CSV yuklab, guruhlarga bo'lib, bir bosishda ASL ga yuborish"
          onClick={onCustom}
        />
        <ToolCard
          icon={<Search className="size-8 text-accent" />}
          title="Kod Qidiruv"
          subtitle="Ichki bazadan KM/quti kodini qidirish · Excel yuklab olish"
          onClick={onSearch}
        />
        <ToolCard
          icon={<Barcode className="size-8 text-accent" />}
          title="SSCC"
          subtitle="20 raqamli ichki quti kodlarini yaratish · GS1 Mod-10 · Excel"
          onClick={onSscc}
        />
        <ToolCard
          icon={<Printer className="size-8 text-accent" />}
          title="BarTender CSV"
          subtitle="KM kodlarni printerga tayyor 5 ustunli CSV formatga aylantirish"
          onClick={onBartender}
        />
        {admin && (
          <ToolCard
            icon={<Settings className="size-8 text-accent" />}
            title="Admin sozlamalari"
            subtitle="Foydalanuvchilarni yaratish, tahrirlash va o'chirish"
            onClick={onAdmin}
          />
        )}
      </div>
    </div>
  );
}

function ToolCard({ icon, title, subtitle, onClick }: {
  icon: React.ReactNode; title: string; subtitle: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="text-left rounded-2xl border border-border bg-surface/70 backdrop-blur-sm p-6
                 hover:border-accent/50 hover:bg-surface2/70 transition-all group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="p-3 rounded-xl bg-accent/10">{icon}</div>
        <ArrowRight className="size-5 text-muted group-hover:text-accent transition-colors" />
      </div>
      <div className="mt-4">
        <div className="text-xl font-bold">{title}</div>
        <div className="text-sm text-muted mt-1">{subtitle}</div>
      </div>
    </button>
  );
}


/** One project row with admin-only rename/delete controls. Reused by both
 *  the aggregation Picker and the inventory Picker. */
function ProjectRow({ p, tone, icon, onOpen, onChanged }: {
  p: ProjectSummary;
  tone: "accent" | "warning";
  icon: React.ReactNode;
  onOpen: (id: number) => void;
  onChanged: () => void;   // parent reloads after edit/delete
}) {
  const { user } = useAuth();
  const admin = isAdmin(user);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(p.name);
  const [productName, setProductName] = useState(p.product_name);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null); setBusy(true);
    try {
      await api.updateProject(p.id, { name, product_name: productName });
      setEditing(false);
      onChanged();
    } catch (e: any) { setErr(String(e.message || e)); }
    setBusy(false);
  }

  async function doDelete(e: React.MouseEvent) {
    e.stopPropagation();
    const status = p.status;
    const warn = status === "submitted"
      ? `"${p.name}" ASL ga yuborilgan loyiha. Uni butunlay o'chiramizmi? Bu amal ortga qaytmaydi.`
      : `"${p.name}" loyihasini butunlay o'chiramizmi? Bu amal ortga qaytmaydi.`;
    if (!confirm(warn)) return;
    setBusy(true);
    try {
      await api.deleteProject(p.id);
      onChanged();
    } catch (e: any) { setErr(String(e.message || e)); alert(err || String(e.message || e)); }
    setBusy(false);
  }

  if (editing) {
    return (
      <div className={"rounded-xl border p-4 " + (tone === "warning" ? "border-warning/50 bg-warning/5" : "border-accent/50 bg-accent/5")}>
        <div className="flex flex-col gap-2">
          <Input value={name} onChange={e => setName(e.target.value)}
                 placeholder="Loyiha nomi" />
          <Input value={productName} onChange={e => setProductName(e.target.value)}
                 placeholder="Mahsulot nomi" />
          {err && <div className="text-xs text-danger">{err}</div>}
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => { setEditing(false); setName(p.name); setProductName(p.product_name); }}>
              <X className="size-3" /> Bekor
            </Button>
            <Button variant="primary" size="sm" onClick={save} disabled={busy || !name.trim() || !productName.trim()}>
              <Check className="size-3" /> {busy ? "…" : "Saqlash"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={
      "group relative rounded-xl border border-border bg-surface2/40 p-4 " +
      "hover:bg-surface2/70 transition-all " +
      (tone === "warning" ? "hover:border-warning/50" : "hover:border-accent/50")
    }>
      <button onClick={() => onOpen(p.id)} className="w-full text-left">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-2 min-w-0">
            {icon}
            <span className="font-semibold truncate">{p.name}</span>
          </div>
          {p.mode === "inventory" ? (
            <Badge tone="warning">inventarizatsiya</Badge>
          ) : (
            <Badge tone={p.status === "submitted" ? "success"
                        : p.status === "submitting" ? "warning" : "accent"}>
              {p.status}
            </Badge>
          )}
        </div>
        <div className="text-sm text-muted">{p.product_name}</div>
        {p.mode !== "inventory" && (
          <div className="text-xs text-muted mt-2 flex gap-4">
            <span>Qutilar: <b className="text-text">{p.total_boxes}</b></span>
            <span>Har birida: <b className="text-text">{p.per_box}</b></span>
            {p.has_loose && <span>Loose: <b className="text-text">{p.loose_qty}</b></span>}
          </div>
        )}
      </button>

      {admin && (
        <div className="absolute top-2 right-2 flex gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
          <button onClick={e => { e.stopPropagation(); setEditing(true); }}
                  title="Tahrirlash"
                  className="p-1.5 rounded-md bg-surface/80 border border-border hover:border-accent/60 hover:text-accent">
            <Pencil className="size-3.5" />
          </button>
          <button onClick={doDelete} disabled={busy}
                  title="O'chirish"
                  className="p-1.5 rounded-md bg-surface/80 border border-border hover:border-danger/60 hover:text-danger">
            <Trash2 className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}


/** One product's card in the picker: header shows the product + series
 *  count, click expands to show each series (project) inside, plus a
 *  "+ Yangi seriya" button that opens Setup with the product name locked. */
function ProductGroupRow({ group, isOpen, submittedCount, onToggle, onOpen,
                            onAddSeries, onChanged }: {
  group: { name: string; productName: string; projects: ProjectSummary[] };
  isOpen: boolean;
  submittedCount: number;
  onToggle: () => void;
  onOpen: (id: number) => void;
  onAddSeries: () => void;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const admin = isAdmin(user);
  return (
    <div className="rounded-xl border border-border bg-surface2/40 overflow-hidden hover:border-accent/40 transition-colors">
      <button
        onClick={onToggle}
        className="w-full text-left p-4 hover:bg-surface2/70 transition-colors"
      >
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-2 min-w-0">
            <Boxes className="size-4 text-accent shrink-0" />
            <span className="font-semibold truncate">{group.name}</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Badge tone="accent">{group.projects.length} seriya</Badge>
            {submittedCount > 0 && (
              <Badge tone="success">{submittedCount} yuborilgan</Badge>
            )}
          </div>
        </div>
        <div className="text-sm text-muted truncate">{group.productName}</div>
        <div className="text-xs text-muted/80 mt-1">
          {isOpen ? "Yopish" : "Seriyalarni ochish"}
        </div>
      </button>

      {isOpen && (
        <div className="border-t border-border bg-surface/40 p-3 flex flex-col gap-2">
          {group.projects.map(p => (
            <SeriesRow key={p.id} p={p} onOpen={onOpen} onChanged={onChanged} />
          ))}
          {admin && (
            <button
              onClick={(e) => { e.stopPropagation(); onAddSeries(); }}
              className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-accent/40
                         text-accent px-3 py-2 text-sm font-semibold hover:bg-accent/10 transition-colors"
            >
              <Plus className="size-4" /> Yangi seriya qo'shish
            </button>
          )}
        </div>
      )}
    </div>
  );
}


/** Compact row for one series inside a product group. Reuses the existing
 *  admin controls (rename / delete) via ProjectRow, but rendered inline. */
function SeriesRow({ p, onOpen, onChanged }: {
  p: ProjectSummary;
  onOpen: (id: number) => void;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const admin = isAdmin(user);
  return (
    <div className="group relative rounded-lg border border-border bg-surface2/40 hover:bg-surface2/70 hover:border-accent/40 transition-colors">
      <button onClick={() => onOpen(p.id)}
              className="w-full text-left px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 text-sm">
            <span className="font-mono text-muted shrink-0">seriya:</span>
            <span className="font-semibold truncate">{p.series || "—"}</span>
          </div>
          <Badge tone={p.status === "submitted" ? "success"
                        : p.status === "submitting" ? "warning" : "accent"}>
            {p.status}
          </Badge>
        </div>
        <div className="mt-1 text-[11px] text-muted flex gap-3">
          <span>Qutilar: <b className="text-text">{p.total_boxes}</b></span>
          <span>Har birida: <b className="text-text">{p.per_box}</b></span>
          {p.has_loose && <span>Loose: <b className="text-text">{p.loose_qty}</b></span>}
        </div>
      </button>
      {admin && (
        <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <ProjectAdminActions p={p} onChanged={onChanged} />
        </div>
      )}
    </div>
  );
}


/** Admin pencil + trash split out from ProjectRow so SeriesRow can reuse it. */
function ProjectAdminActions({ p, onChanged }: {
  p: ProjectSummary; onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(p.name);
  const [productName, setProductName] = useState(p.product_name);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api.updateProject(p.id, { name: name.trim(), product_name: productName.trim() });
      setEditing(false);
      onChanged();
    } catch (e: any) { alert(String(e.message || e)); }
    setBusy(false);
  }
  async function del(e: React.MouseEvent) {
    e.stopPropagation();
    const warn = p.status === "submitted"
      ? `Bu seriya (${p.series || p.name}) ASL ga yuborilgan. Butunlay o'chiramizmi?`
      : `Bu seriyani (${p.series || p.name}) butunlay o'chiramizmi? Bu amal ortga qaytmaydi.`;
    if (!confirm(warn)) return;
    setBusy(true);
    try { await api.deleteProject(p.id); onChanged(); }
    catch (e: any) { alert(String(e.message || e)); }
    setBusy(false);
  }
  if (editing) {
    return (
      <div className="absolute right-1.5 top-1.5 z-10 flex flex-col gap-1 rounded-lg border border-accent/50 bg-surface p-2 shadow-lg w-64">
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="Loyiha nomi" />
        <Input value={productName} onChange={e => setProductName(e.target.value)} placeholder="Mahsulot nomi" />
        <div className="flex gap-1 justify-end">
          <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); setEditing(false); setName(p.name); setProductName(p.product_name); }}>
            <X className="size-3" />
          </Button>
          <Button variant="primary" size="sm" onClick={(e) => { e.stopPropagation(); save(); }} disabled={busy || !name.trim() || !productName.trim()}>
            <Check className="size-3" />
          </Button>
        </div>
      </div>
    );
  }
  return (
    <>
      <button onClick={(e) => { e.stopPropagation(); setEditing(true); }}
              title="Tahrirlash"
              className="p-1.5 rounded-md bg-surface/80 border border-border hover:border-accent/60 hover:text-accent">
        <Pencil className="size-3.5" />
      </button>
      <button onClick={del} disabled={busy}
              title="O'chirish"
              className="p-1.5 rounded-md bg-surface/80 border border-border hover:border-danger/60 hover:text-danger">
        <Trash2 className="size-3.5" />
      </button>
    </>
  );
}


/** Group projects that share (name, product_name). Each group is one
 *  "product" the operator picks first; series live inside as siblings. */
function groupByProduct(projects: ProjectSummary[]) {
  const groups = new Map<string, { name: string; productName: string;
                                    projects: ProjectSummary[] }>();
  for (const p of projects) {
    const key = `${p.name}::${p.product_name}`;
    let g = groups.get(key);
    if (!g) {
      g = { name: p.name, productName: p.product_name, projects: [] };
      groups.set(key, g);
    }
    g.projects.push(p);
  }
  // stable order — newest project in each group first, groups by newest
  // project overall
  for (const g of groups.values()) {
    g.projects.sort((a, b) => b.id - a.id);
  }
  return Array.from(groups.values()).sort(
    (a, b) => b.projects[0].id - a.projects[0].id
  );
}


function Picker({ onOpen, onNew, onNewSeriesPick, onNewSeries, onHome }: {
  onOpen: (id: number) => void;
  onNew: () => void;
  onNewSeriesPick: () => void;
  onNewSeries: (name: string, productName: string) => void;
  onHome: () => void;
}) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Which product group is currently expanded to show its series list.
  const [openKey, setOpenKey] = useState<string | null>(null);

  const load = () => {
    setErr(null);
    api.listProjects().then(setProjects).catch(e => setErr(String(e)));
  };
  useEffect(load, []);

  const groups = projects ? groupByProduct(projects) : [];

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <TopBar />
      <button onClick={onHome} className="text-muted hover:text-text inline-flex items-center gap-1 mb-4">
        <ArrowRight className="size-4 rotate-180" /> Bosh sahifa
      </button>
      <div className="mb-6 flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <div className="text-3xl font-extrabold tracking-tight text-accent">Agregatsiya loyihalari</div>
          <div className="text-muted text-sm mt-1">
            Mahsulotni tanlang → seriyani tanlang → skanerlashni boshlang
          </div>
        </div>
        <div className="flex items-center gap-2">
          <NewSeriesTopButton onClick={onNewSeriesPick} disabled={(projects?.length ?? 0) === 0} />
          <NewProjectButton onClick={onNew} />
        </div>
      </div>

      <Card>
        <CardHead title="Mahsulotlar"
                  right={<Badge tone="neutral">{groups.length}</Badge>} />
        {err && (
          <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
            {err}
          </div>
        )}
        {!projects && !err && <div className="text-muted text-sm">Yuklanmoqda…</div>}
        {projects && projects.length === 0 && (
          <div className="text-muted text-sm py-6 text-center italic">
            Hali birorta loyiha yaratilmagan.
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {groups.map(g => {
            const key = `${g.name}::${g.productName}`;
            const isOpen = openKey === key;
            const submittedCount = g.projects.filter(p => p.status === "submitted").length;
            return (
              <ProductGroupRow key={key}
                               group={g}
                               isOpen={isOpen}
                               submittedCount={submittedCount}
                               onToggle={() => setOpenKey(isOpen ? null : key)}
                               onOpen={onOpen}
                               onAddSeries={() => onNewSeries(g.name, g.productName)}
                               onChanged={load} />
            );
          })}
        </div>
      </Card>
    </div>
  );
}


function TopBar() {
  return (
    <div className="fixed top-3 right-3 z-40">
      <UserChip />
    </div>
  );
}

function UserChip() {
  const { user, logout } = useAuth();
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    (typeof document !== "undefined" && document.documentElement.classList.contains("light"))
      ? "light" : "dark");
  if (!user) return null;
  const admin = isAdmin(user);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    const root = document.documentElement;
    root.classList.remove("dark", "light");
    root.classList.add(next);
    try { localStorage.setItem("mav2.theme", next); } catch { /* ignore */ }
    setTheme(next);
  };

  return (
    <div className="flex items-center gap-2 rounded-full border border-border bg-surface/80 backdrop-blur px-3 py-1.5 shadow-sm">
      {admin ? <Shield className="size-4 text-accent" /> : <HardHat className="size-4 text-warning" />}
      <div className="text-sm">
        <span className="font-semibold">{user.username}</span>
        <span className={"ml-2 text-xs px-1.5 py-0.5 rounded " +
          (admin ? "bg-accent/15 text-accent" : "bg-warning/15 text-warning")}>
          {admin ? "admin" : "operator"}
        </span>
      </div>
      <button onClick={toggleTheme}
              title={theme === "dark" ? "Yorug' rejim" : "Qorong'u rejim"}
              className="ml-1 text-muted hover:text-accent p-1 rounded hover:bg-accent/10">
        {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </button>
      <button onClick={logout} title="Chiqish"
              className="text-muted hover:text-danger p-1 rounded hover:bg-danger/10">
        <LogOut className="size-4" />
      </button>
    </div>
  );
}

function NewProjectButton({ onClick }: { onClick: () => void }) {
  const { user } = useAuth();
  if (!isAdmin(user)) return null;
  return (
    <Button variant="primary" size="lg" onClick={onClick}>
      <Plus className="size-4" /> Yangi loyiha
    </Button>
  );
}

/** Top-right "add a series to an existing product" button. Admin-only.
 *  Disabled when there is no existing loyiha yet — nothing to pick from. */
function NewSeriesTopButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  const { user } = useAuth();
  if (!isAdmin(user)) return null;
  return (
    <Button variant="outline" size="lg" onClick={onClick} disabled={disabled}
            title={disabled ? "Avval yangi loyiha yarating" : "Mavjud mahsulotga yangi seriya qo'shish"}>
      <Plus className="size-4" /> Yangi seriya qo'shish
    </Button>
  );
}

