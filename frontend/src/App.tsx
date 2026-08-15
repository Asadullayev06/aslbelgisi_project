import { useCallback, useEffect, useState } from "react";
import { Boxes, Plus, LogOut, Shield, HardHat, ScanBarcode, Package, ArrowRight, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHead } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Setup } from "@/pages/Setup";
import { Scan } from "@/pages/Scan";
import { Login } from "@/pages/Login";
import { GtinStock } from "@/pages/GtinStock";
import { Inspector } from "@/pages/Inspector";
import { api, setUnauthorizedHandler } from "@/api";
import { AuthContext, isAdmin, useAuth, type User } from "@/auth";
import type { ProjectSummary } from "@/types";

type Route =
  | { kind: "home" }
  | { kind: "picker" }
  | { kind: "setup" }
  | { kind: "scan"; projectId: number }
  | { kind: "stock" }
  | { kind: "inspector" };

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
                  onCancel={() => setRoute({ kind: "picker" })} />;
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
  if (route.kind === "picker") {
    return <Picker onOpen={id => setRoute({ kind: "scan", projectId: id })}
                   onNew={() => setRoute({ kind: "setup" })}
                   onHome={() => setRoute({ kind: "home" })} />;
  }
  return <Home onAggregation={() => setRoute({ kind: "picker" })}
               onStock={() => setRoute({ kind: "stock" })}
               onInspector={() => setRoute({ kind: "inspector" })} />;
}


function Home({ onAggregation, onStock, onInspector }: {
  onAggregation: () => void;
  onStock: () => void;
  onInspector: () => void;
}) {
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


function Picker({ onOpen, onNew, onHome }: {
  onOpen: (id: number) => void; onNew: () => void; onHome: () => void;
}) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setErr(null);
    api.listProjects().then(setProjects).catch(e => setErr(String(e)));
  }, []);

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
            Skanerlashni boshlash uchun loyihani tanlang
          </div>
        </div>
        <NewProjectButton onClick={onNew} />
      </div>

      <Card>
        <CardHead title="Faol loyihalar" right={<Badge tone="neutral">{projects?.length ?? 0}</Badge>} />
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
          {projects?.map(p => (
            <button key={p.id}
                    onClick={() => onOpen(p.id)}
                    className="text-left rounded-xl border border-border bg-surface2/40 p-4
                               hover:border-accent/50 hover:bg-surface2/70 transition-all">
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-2">
                  <Boxes className="size-4 text-accent" />
                  <span className="font-semibold">{p.name}</span>
                </div>
                <Badge tone={p.status === "submitted" ? "success"
                              : p.status === "submitting" ? "warning"
                              : "accent"}>
                  {p.status}
                </Badge>
              </div>
              <div className="text-sm text-muted">{p.product_name}</div>
              <div className="text-xs text-muted mt-2 flex gap-4">
                <span>Qutilar: <b className="text-text">{p.total_boxes}</b></span>
                <span>Har birida: <b className="text-text">{p.per_box}</b></span>
                {p.has_loose && (
                  <span>Loose: <b className="text-text">{p.loose_qty}</b></span>
                )}
              </div>
            </button>
          ))}
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
  if (!user) return null;
  const admin = isAdmin(user);
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
      <button onClick={logout} title="Chiqish"
              className="ml-1 text-muted hover:text-danger p-1 rounded hover:bg-danger/10">
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

