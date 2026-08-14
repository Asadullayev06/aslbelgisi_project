import { useState } from "react";
import { LogIn, User, Lock, Shield, HardHat } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHead } from "@/components/ui/Card";
import { Field, Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { useAuth } from "@/auth";

export function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      await login(username.trim(), password);
    } catch (e: any) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="text-3xl font-extrabold tracking-tight text-accent">Agregatsiya</div>
          <div className="text-muted text-sm mt-1">Asl Belgisi — kirish</div>
        </div>

        <Card>
          <CardHead title="Tizimga kirish"
                    right={<Badge tone="accent"><LogIn className="size-3" /></Badge>} />

          <form onSubmit={submit} className="flex flex-col gap-3">
            <Field label="Login">
              <div className="relative">
                <User className="absolute left-3 top-3 size-4 text-muted" />
                <Input className="pl-9" autoFocus autoComplete="username"
                       value={username} onChange={e => setUsername(e.target.value)}
                       placeholder="admin / worker1 / worker2" />
              </div>
            </Field>
            <Field label="Parol">
              <div className="relative">
                <Lock className="absolute left-3 top-3 size-4 text-muted" />
                <Input className="pl-9" type="password" autoComplete="current-password"
                       value={password} onChange={e => setPassword(e.target.value)}
                       placeholder="parol" />
              </div>
            </Field>

            {err && (
              <div className="rounded-lg border border-danger/40 bg-danger/10 p-2 text-sm text-danger">
                {err}
              </div>
            )}

            <Button variant="primary" size="lg" type="submit" disabled={busy}>
              {busy ? "Kirilmoqda…" : "Kirish"}
            </Button>
          </form>
        </Card>

        <div className="mt-4 flex items-center justify-center gap-3 text-xs text-muted">
          <span className="inline-flex items-center gap-1">
            <Shield className="size-3 text-accent" /> admin / admin123
          </span>
          <span className="opacity-40">·</span>
          <span className="inline-flex items-center gap-1">
            <HardHat className="size-3 text-warning" /> worker1 / worker123
          </span>
          <span className="opacity-40">·</span>
          <span className="inline-flex items-center gap-1">
            <HardHat className="size-3 text-warning" /> worker2 / worker123
          </span>
        </div>
      </div>
    </div>
  );
}
