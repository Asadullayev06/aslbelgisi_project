import { useCallback, useEffect, useState } from "react";
import { Boxes, Plus, LogOut, Shield, HardHat } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHead } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Setup } from "@/pages/Setup";
import { Scan } from "@/pages/Scan";
import { Login } from "@/pages/Login";
import { api, setUnauthorizedHandler } from "@/api";
import { AuthContext, isAdmin, useAuth, type User } from "@/auth";
import type { ProjectSummary } from "@/types";

type Route =
  | { kind: "picker" }
  | { kind: "setup" }
  | { kind: "scan"; projectId: number };

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [route, setRoute] = useState<Route>({ kind: "picker" });

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
      setRoute({ kind: "picker" });
    });
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const u = await api.login(username, password);
    setUser(u as User);
    setRoute({ kind: "picker" });
  }, []);

  const logout = useCallback(async () => {
    try { await api.logout(); } catch { /* ignore */ }
    setUser(null);
    setRoute({ kind: "picker" });
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
  return <Picker onOpen={id => setRoute({ kind: "scan", projectId: id })}
                 onNew={() => setRoute({ kind: "setup" })} />;
}


function Picker({ onOpen, onNew }: { onOpen: (id: number) => void; onNew: () => void }) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setErr(null);
    api.listProjects().then(setProjects).catch(e => setErr(String(e)));
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <TopBar />
      <div className="mb-6 flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <div className="text-3xl font-extrabold tracking-tight text-accent">Loyihalar</div>
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

