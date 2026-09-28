import { useState } from "react";
import {
  Package, ClipboardList, Layers, Boxes, ScanLine, BarChart3,
  ShieldCheck, User, Lock, Eye, EyeOff, ArrowRight, Globe, Building2, Check,
} from "lucide-react";
import { useAuth } from "@/auth";
import "./login.css";

const REMEMBER_KEY = "tp.login.remember";

/** Word-mark: "Trace" ink + "Pro" green, next to the logo. */
function Wordmark({ size = 28 }: { size?: number }) {
  return (
    <span className="tp-word" style={{ fontSize: size }}>
      <span className="tp-word-ink">Trace</span><span className="tp-word-accent">Pro</span>
    </span>
  );
}

export function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState(() => {
    try { return localStorage.getItem(REMEMBER_KEY) || ""; } catch { return ""; }
  });
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [remember, setRemember] = useState(() => {
    try { return !!localStorage.getItem(REMEMBER_KEY); } catch { return true; }
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setNote(null);
    if (!username.trim() || !password) {
      setErr("Login va parol talab qilinadi");
      return;
    }
    setBusy(true);
    try {
      await login(username.trim(), password);
      try {
        if (remember) localStorage.setItem(REMEMBER_KEY, username.trim());
        else localStorage.removeItem(REMEMBER_KEY);
      } catch { /* ignore */ }
      // App swaps to the shell on success.
    } catch (e: any) {
      setErr(String(e.message || e));
      setBusy(false);
    }
  }

  return (
    <div className="tp-login grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
      {/* ── LEFT HERO ── */}
      <aside className="tp-hero relative hidden flex-col overflow-hidden px-14 py-12 lg:flex">
        <div className="relative z-10 flex items-center gap-3">
          <img src="/logo.webp" alt="TracePro" className="size-11 rounded-xl object-contain" />
          <Wordmark size={30} />
        </div>

        <div className="relative z-10 mt-16 max-w-xl">
          <div className="text-[12px] font-bold uppercase tracking-[0.2em] text-neutral-400">
            Integratsiyalashgan platforma
          </div>
          <h1 className="mt-4 text-[44px] font-extrabold leading-[1.05] tracking-tight text-neutral-900">
            TracePro<br />
            <span className="text-[#1f9d57]">Integrated Platform</span>
          </h1>
          <p className="mt-5 max-w-md text-[17px] leading-relaxed text-neutral-500">
            Agregatsiya, inventarizatsiya, hisobotlar va mahsulotlar kuzatuvini
            bitta joyda boshqaring.
          </p>

          <div className="mt-9 grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-4">
            <Feature icon={<Package className="size-6" />} title="Agregatsiya"
                     desc="Karobkalarga joylash va ommaviy agregatsiya" />
            <Feature icon={<ClipboardList className="size-6" />} title="Inventarizatsiya"
                     desc="Omborni sanash va skanerlash" />
            <Feature icon={<Layers className="size-6" />} title="Hisobotlar"
                     desc="KM va SSCC bo'yicha tahlil va Excel" />
            <Feature icon={<Boxes className="size-6" />} title="Mahsulot kuzatuvi"
                     desc="SSCC va KM ro'yxatini solishtirish" />
          </div>
        </div>

        {/* capability chips + soft decor instead of a stock photo */}
        <div className="relative z-10 mt-auto flex flex-wrap gap-3 pt-12">
          <Chip icon={<ScanLine className="size-4" />} label="Mahsulot skanerlash" />
          <Chip icon={<BarChart3 className="size-4" />} label="Real vaqtdagi hisobotlar" />
          <Chip icon={<Layers className="size-4" />} label="To'liq izlanuvchanlik" />
        </div>

        <div className="tp-blob tp-blob-a" />
        <div className="tp-blob tp-blob-b" />
      </aside>

      {/* ── RIGHT FORM ── */}
      <main className="relative flex items-center justify-center bg-white px-6 py-10">
        <button type="button" className="tp-lang absolute right-6 top-6" onClick={() => {}}>
          <Globe className="size-4" /> O'zbekcha
        </button>

        <div className="w-full max-w-[420px]">
          <div className="flex flex-col items-center text-center">
            <div className="flex items-center gap-2.5">
              <img src="/logo.webp" alt="" className="size-10 rounded-lg object-contain" />
              <Wordmark size={26} />
            </div>
            <h2 className="mt-6 text-[22px] font-bold tracking-tight text-neutral-900">Tizimga kirish</h2>
            <p className="mt-1.5 text-[14px] leading-relaxed text-neutral-500">
              TracePro platformasiga xush kelibsiz.<br />
              Iltimos, davom etish uchun tizimga kiring.
            </p>
          </div>

          <form onSubmit={submit} noValidate className="mt-8 flex flex-col gap-4">
            <label className="tp-field">
              <span className="tp-label">Login</span>
              <div className="tp-input">
                <User className="tp-input-icon size-[18px]" />
                <input type="text" autoComplete="username" placeholder="Login kiriting"
                       value={username} onChange={e => setUsername(e.target.value)} />
              </div>
            </label>

            <label className="tp-field">
              <span className="tp-label">Parol</span>
              <div className="tp-input">
                <Lock className="tp-input-icon size-[18px]" />
                <input type={showPass ? "text" : "password"} autoComplete="current-password"
                       placeholder="Parol kiriting"
                       value={password} onChange={e => setPassword(e.target.value)} />
                <button type="button" className="tp-eye"
                        aria-label={showPass ? "Parolni yashirish" : "Parolni ko'rsatish"}
                        onClick={() => setShowPass(s => !s)}>
                  {showPass ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
                </button>
              </div>
            </label>

            <div className="flex items-center justify-between gap-3 text-[13px]">
              <label className="tp-check">
                <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
                <span className="tp-check-box"><Check className="size-3" /></span>
                <span className="text-neutral-600">Meni eslab qol</span>
              </label>
              <button type="button" className="font-semibold text-[#1f9d57] hover:underline"
                      onClick={() => setNote("Parolni tiklash uchun administrator bilan bog'laning.")}>
                Parolni unutdingizmi?
              </button>
            </div>

            {err && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-600">
                {err}
              </div>
            )}
            {note && !err && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-700">
                {note}
              </div>
            )}

            <button type="submit" className="tp-primary" disabled={busy}>
              {busy ? "Kirilmoqda…" : <>Kirish <ArrowRight className="size-[18px]" /></>}
            </button>

            <div className="tp-or"><span>yoki</span></div>

            <button type="button" className="tp-secondary"
                    onClick={() => setNote("SSO orqali kirish hozircha mavjud emas.")}>
              <Building2 className="size-[18px]" /> SSO orqali kirish
            </button>
          </form>

          <div className="mt-8 flex items-center justify-center gap-2 text-center text-[12.5px] text-neutral-400">
            <ShieldCheck className="size-4 text-[#1f9d57]" />
            <span>Sizning ma'lumotlaringiz himoyalangan va xavfsiz saqlanadi.</span>
          </div>
        </div>
      </main>
    </div>
  );
}

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div>
      <div className="grid size-11 place-items-center rounded-xl bg-[#1f9d57]/10 text-[#1f9d57]">
        {icon}
      </div>
      <div className="mt-3 text-[15px] font-bold text-neutral-900">{title}</div>
      <div className="mt-1 text-[12.5px] leading-snug text-neutral-500">{desc}</div>
    </div>
  );
}

function Chip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="tp-chip">
      <span className="tp-chip-icon">{icon}</span>
      <span className="font-semibold text-neutral-700">{label}</span>
      <span className="tp-chip-ok"><Check className="size-3" /></span>
    </div>
  );
}
