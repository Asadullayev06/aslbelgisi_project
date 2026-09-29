import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { Package, ClipboardList, Layers, Boxes, ShieldCheck, User, LockKeyhole, Eye, EyeOff, ArrowRight, Globe, Landmark, Check, ChevronDown } from "lucide-react";
import { useAuth } from "@/auth";
import { LoginLiquidGlass } from "@/components/LoginLiquidGlass";
import "./login.css";

const REMEMBER_KEY = "tp.login.remember";
function Brand() {
  return <div className="tp-brand"><span className="tp-logo" aria-hidden="true"><img src="/login-reference.png" alt="" /></span><span className="tp-word">Trace<span>Pro</span></span></div>;
}
export function Login() {
  const pageRef = useRef<HTMLDivElement>(null);
  const { login } = useAuth();
  const [username, setUsername] = useState(() => { try { return localStorage.getItem(REMEMBER_KEY) || ""; } catch { return ""; } });
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr(null); setNote(null);
    if (!username.trim() || !password) { setErr("Login va parol talab qilinadi"); return; }
    setBusy(true);
    try {
      await login(username.trim(), password);
      try { if (remember) localStorage.setItem(REMEMBER_KEY, username.trim()); else localStorage.removeItem(REMEMBER_KEY); } catch { /* Storage may be unavailable. */ }
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }
  return <div className="tp-login" ref={pageRef}>
    <div className="tp-stripes" aria-hidden="true" />
    <header className="tp-header"><Brand /></header>
    <div className="tp-lang" aria-label="Til: O'zbekcha"><Globe /><span>O'zbekcha</span><ChevronDown /></div>
    <section className="tp-hero" aria-labelledby="tp-heading">
      <p className="tp-eyebrow">Integratsiyalashgan platforma</p>
      <h1 id="tp-heading">TracePro<br /><span>Integrated Platform</span></h1>
      <p className="tp-description">Agregatsiya, inventarizatsiya, hisobotlar va<br /> mahsulotlar kuzatuvini bitta joyda boshqaring.</p>
      <div className="tp-features">
        <Feature icon={<Package />} title="Agregatsiya">Karobkalarga joylash<br />va ommaviy agregatsiya</Feature>
        <Feature icon={<ClipboardList />} title="Inventarizatsiya">Omborni sanash va<br />skanerlash</Feature>
        <Feature icon={<Layers />} title="Hisobotlar">KM va SSCC bo‘yicha<br />tahlil va Excel</Feature>
        <Feature icon={<Boxes />} title="Mahsulot kuzatuvi">SSCC va KM<br />ro‘yxatini solishtirish</Feature>
      </div>
    </section>
    <div className="tp-art" role="img" aria-label="TracePro qutilari konveyerda. Mahsulot skanerlash, real vaqtdagi hisobotlar va to‘liq izlanuvchanlik."><img src="/login-reference.png" alt="" draggable={false} /></div>
    <main className="tp-card" aria-labelledby="tp-signin-heading">
      <div className="tp-card-heading"><Brand /><h2 id="tp-signin-heading">Tizimga kirish</h2><p>TracePro platformasiga xush kelibsiz.<br />Iltimos, davom etish uchun tizimga kiring.</p></div>
      <form onSubmit={submit} noValidate aria-busy={busy}>
        <div className="tp-field"><label htmlFor="tp-username">Login</label><div className="tp-input"><User aria-hidden="true" /><input id="tp-username" autoComplete="username" placeholder="Login kiriting" value={username} onChange={e => setUsername(e.target.value)} disabled={busy} required aria-describedby={err ? "tp-login-error" : undefined} /></div></div>
        <div className="tp-field"><label htmlFor="tp-password">Parol</label><div className="tp-input"><LockKeyhole aria-hidden="true" /><input id="tp-password" type={showPass ? "text" : "password"} autoComplete="current-password" placeholder="Parol kiriting" value={password} onChange={e => setPassword(e.target.value)} disabled={busy} required aria-describedby={err ? "tp-login-error" : undefined} /><button type="button" className="tp-eye" aria-label={showPass ? "Parolni yashirish" : "Parolni ko‘rsatish"} aria-pressed={showPass} onClick={() => setShowPass(s => !s)}>{showPass ? <EyeOff /> : <Eye />}</button></div></div>
        <div className="tp-options"><label className="tp-check"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} /><span className="tp-check-box" aria-hidden="true"><Check /></span><span>Meni eslab qol</span></label><button type="button" className="tp-forgot" onClick={() => setNote("Parolni tiklash uchun administrator bilan bog‘laning.")}>Parolni unutdingizmi?</button></div>
        {err && <div id="tp-login-error" className="tp-message tp-error" role="alert">{err}</div>}
        {note && !err && <div className="tp-message" role="status">{note}</div>}
        <button type="submit" className="tp-primary" disabled={busy}>{busy ? "Kirilmoqda…" : <>Kirish <ArrowRight /></>}</button>
        <div className="tp-or"><span>yoki</span></div>
        <button type="button" className="tp-secondary" onClick={() => setNote("SSO orqali kirish hozircha mavjud emas.")}><Landmark />SSO orqali kirish</button>
      </form>
      <div className="tp-secure"><ShieldCheck aria-hidden="true" /><p>Sizning ma’lumotlaringiz himoyalangan<br />va xavfsiz saqlanadi.</p></div>
    </main>
    <LoginLiquidGlass pageRef={pageRef} />
  </div>;
}
function Feature({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return <div className="tp-feature"><div className="tp-feature-icon" aria-hidden="true">{icon}</div><h3>{title}</h3><p>{children}</p></div>;
}
