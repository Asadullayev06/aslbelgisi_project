import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/auth";
import "./login.css";

/**
 * Animated login: four SVG characters watch the caret and react to
 * success/failure. State machine and coordinate math are documented in
 * the top of the effect callback below.
 */
export function Login() {
  const { login } = useAuth();
  const [username, setUsername]   = useState("");
  const [password, setPassword]   = useState("");
  const [showPass, setShowPass]   = useState(false);
  const [busy, setBusy]           = useState(false);
  const [err, setErr]             = useState<string | null>(null);
  const [nameInvalid, setNameBad] = useState(false);
  const [passInvalid, setPassBad] = useState(false);
  const [ok, setOk]               = useState(false);

  // References the animation effect needs to reach into
  const stageRef  = useRef<HTMLDivElement>(null);
  const passRef   = useRef<HTMLInputElement>(null);
  const nameRef   = useRef<HTMLInputElement>(null);
  const cardRef   = useRef<HTMLDivElement>(null);
  const shakeFn   = useRef<() => void>(() => {});
  const joyFn     = useRef<() => void>(() => {});
  const focusFn   = useRef<(x: number, y: number) => void>(() => {});
  const privFn    = useRef<(on: boolean) => void>(() => {});

  // Mount the animation once. The whole thing lives in one effect so
  // there's a single tear-down path for listeners + RAF.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const svg = stage.querySelector("svg") as SVGSVGElement | null;
    if (!svg) return;

    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;

    // ── spring model — each channel keeps position + velocity and
    //    tweens toward `target` under `k` stiffness and `d` damping.
    type Spring = { pos: number; vel: number; target: number; k: number; d: number };
    const spring = (k = 0.14, d = 0.72): Spring => ({ pos: 0, vel: 0, target: 0, k, d });
    const step = (s: Spring) => {
      const f = (s.target - s.pos) * s.k;
      s.vel = (s.vel + f) * s.d;
      s.pos += s.vel;
      return s.pos;
    };

    type Eye = {
      g: SVGGElement; cx: number; cy: number;
      pupil: SVGGElement | null; sx: Spring; sy: Spring;
    };
    type Char = {
      name: string; group: SVGGElement; eyes: Eye[];
      tx: Spring; ty: Spring; rz: Spring;
      bobPhase: number; blinkAt: number; blinking: boolean;
    };

    const makeChar = (name: string): Char | null => {
      const group = svg.querySelector<SVGGElement>(`#char-${name}`);
      if (!group) return null;
      const eyes: Eye[] = Array.from(group.querySelectorAll<SVGGElement>(".eye"))
        .map(g => ({
          g,
          cx: parseFloat(g.dataset.eyeCx || "0"),
          cy: parseFloat(g.dataset.eyeCy || "0"),
          pupil: g.querySelector<SVGGElement>(".eye-pupil"),
          sx: spring(0.22, 0.68), sy: spring(0.22, 0.68),
        }));
      return {
        name, group, eyes,
        tx: spring(0.10, 0.80), ty: spring(0.10, 0.80), rz: spring(0.10, 0.78),
        bobPhase: Math.random() * Math.PI * 2,
        blinkAt: performance.now() + 2500 + Math.random() * 3000,
        blinking: false,
      };
    };

    const cast: Char[] = ["orange", "purple", "dark", "yellow"]
      .map(makeChar)
      .filter((c): c is Char => c !== null);
    const purple = cast.find(c => c.name === "purple");

    const STAGE_CX = 230;
    const target = { x: 230, y: 140 };
    let mode: "track" | "shake" | "joy" = "track";
    let lastActivity = performance.now();
    let raf = 0;

    const svgPoint = (cx: number, cy: number) => {
      const r = svg.getBoundingClientRect();
      const vb = svg.viewBox.baseVal;
      return {
        x: (cx - r.left) / r.width  * vb.width  + vb.x,
        y: (cy - r.top ) / r.height * vb.height + vb.y,
      };
    };
    const setTarget = (x: number, y: number) => {
      target.x = x; target.y = y; lastActivity = performance.now();
    };

    const setPrivacy = (on: boolean) => {
      if (!purple) return;
      for (const eye of purple.eyes) {
        if (eye.g.classList.contains("bar-eye"))
          eye.g.classList.toggle("closed", on);
      }
    };

    const setBlink = (c: Char, on: boolean) => {
      for (const eye of c.eyes) {
        if (eye.g.classList.contains("bar-eye") && eye.g.classList.contains("closed"))
          continue;
        eye.g.classList.toggle("closed", on);
      }
    };

    const tickChar = (c: Char, now: number, idle: boolean) => {
      for (const eye of c.eyes) {
        const x = step(eye.sx), y = step(eye.sy);
        eye.pupil?.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
      }
      const bx = step(c.tx), by = step(c.ty), br = step(c.rz);
      const bob = idle ? Math.sin(now * 0.0018 + c.bobPhase) * 1.6 : 0;
      c.group.style.transform =
        `translate(${bx.toFixed(2)}px, ${(by + bob).toFixed(2)}px) rotate(${br.toFixed(2)}deg)`;
      if (now > c.blinkAt) {
        if (!c.blinking) {
          c.blinking = true; setBlink(c, true); c.blinkAt = now + 120;
        } else {
          c.blinking = false; setBlink(c, false);
          c.blinkAt = now + 2600 + Math.random() * 3500;
        }
      }
    };

    const frame = (now: number) => {
      const stillFor = now - lastActivity;
      const idle = stillFor > 4000;
      if (idle && !reducedMotion) {
        const t = now * 0.0004;
        target.x = 230 + Math.cos(t) * 90;
        target.y = 130 + Math.sin(t * 1.3) * 40;
      }
      const dxN = Math.max(-1, Math.min(1, (target.x - STAGE_CX) / 230));
      const dyN = Math.max(-1, Math.min(1, (target.y - 120) / 320));
      for (const c of cast) {
        for (const eye of c.eyes) {
          const dx = target.x - eye.cx, dy = target.y - eye.cy;
          const dist = Math.min(4.2, Math.hypot(dx, dy) / 42);
          const ang = Math.atan2(dy, dx);
          eye.sx.target = Math.cos(ang) * dist;
          eye.sy.target = Math.sin(ang) * dist;
        }
        if (mode === "track") {
          c.tx.target = dxN * 6;
          c.ty.target = Math.max(0, dyN) * 3;
          c.rz.target = dxN * 4.2;
        }
        tickChar(c, now, idle);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    // Cursor tracking (skip on touch — coarse pointer).
    const onMove = (e: MouseEvent) => {
      const p = svgPoint(e.clientX, e.clientY);
      setTarget(p.x, p.y);
    };
    if (!coarsePointer) document.addEventListener("mousemove", onMove, { passive: true });

    // Scroll-driven fallback on touch.
    let lastScrollY = window.scrollY;
    const onScroll = () => {
      const dy = window.scrollY - lastScrollY; lastScrollY = window.scrollY;
      setTarget(230, Math.max(20, Math.min(400, target.y + dy * 0.4)));
    };
    if (coarsePointer) window.addEventListener("scroll", onScroll, { passive: true });

    // Expose actions to the component via refs
    focusFn.current = (x, y) => setTarget(x, y);
    privFn.current  = (on)   => setPrivacy(on);
    shakeFn.current = () => {
      mode = "shake";
      for (const c of cast) {
        c.group.style.transform = "";
        c.group.classList.remove("shake");
        void c.group.getBBox();          // restart animation
        c.group.classList.add("shake");
      }
      setTimeout(() => {
        for (const c of cast) c.group.classList.remove("shake");
        mode = "track";
      }, 560);
    };
    joyFn.current = () => {
      mode = "joy";
      setPrivacy(false);
      for (const c of cast) {
        c.group.classList.remove("joy");
        void c.group.getBBox();
        c.group.classList.add("joy");
        for (const eye of c.eyes) { eye.sx.target = 0; eye.sy.target = -4; }
      }
    };

    // Nice default gaze on first paint
    setTarget(230, 60);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("mousemove", onMove);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setNameBad(false); setPassBad(false);
    if (!username.trim() || !password) {
      setNameBad(!username.trim()); setPassBad(!password);
      setErr("Login va parol talab qilinadi");
      shakeFn.current();
      return;
    }
    setBusy(true);
    try {
      await login(username.trim(), password);
      setOk(true); joyFn.current();
      // small delay for the celebrate before the shell swaps to the app
      await new Promise(r => setTimeout(r, 500));
    } catch (e: any) {
      setErr(String(e.message || e));
      setPassBad(true);
      shakeFn.current();
      setBusy(false);
    }
  }

  return (
    <div className="lp-body">
      <div className={"lp-card" + (ok ? " dismiss" : "")} ref={cardRef}>
        {/* Character stage */}
        <div className="lp-stage" ref={stageRef}>
          <span className="lp-stage-label">Asl Belgisi · cast</span>
          <svg className="lp-cast" viewBox="0 0 460 460" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
            <defs>
              <linearGradient id="lpGradOrange" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#FF986A" /><stop offset=".55" stopColor="#FF7A45" /><stop offset="1" stopColor="#D25324" />
              </linearGradient>
              <linearGradient id="lpGradPurple" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#9985E4" /><stop offset=".55" stopColor="#7A62D6" /><stop offset="1" stopColor="#4D399A" />
              </linearGradient>
              <linearGradient id="lpGradYellow" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#FFD870" /><stop offset=".55" stopColor="#F5C34D" /><stop offset="1" stopColor="#B48212" />
              </linearGradient>
              <linearGradient id="lpGradChar" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#3a352f" /><stop offset="1" stopColor="#1a1613" />
              </linearGradient>
              <radialGradient id="lpGloss" cx=".35" cy=".18" r=".7">
                <stop offset="0" stopColor="#fff" stopOpacity=".38" /><stop offset=".55" stopColor="#fff" stopOpacity="0" />
              </radialGradient>
              <radialGradient id="lpGround" cx=".5" cy=".5" r=".5">
                <stop offset="0" stopColor="#c9bea2" stopOpacity=".55" /><stop offset="1" stopColor="#c9bea2" stopOpacity="0" />
              </radialGradient>
              <circle id="lpGlint" r="1.6" fill="#fff" opacity=".9" />
            </defs>

            <g>
              <ellipse cx="148" cy="452" rx="118" ry="10" fill="url(#lpGround)" />
              <ellipse cx="220" cy="454" rx="90"  ry="8"  fill="url(#lpGround)" />
              <ellipse cx="272" cy="454" rx="70"  ry="7"  fill="url(#lpGround)" />
              <ellipse cx="368" cy="454" rx="70"  ry="7"  fill="url(#lpGround)" />
            </g>

            {/* PURPLE */}
            <g id="char-purple" className="char-group" data-char="purple" style={{ transformOrigin: "210px 448px" }}>
              <line x1="216" y1="82" x2="216" y2="66" stroke="#4D399A" strokeWidth={3} strokeLinecap="round" />
              <circle cx="216" cy="60" r="5" fill="#4D399A" />
              <path d="M162 448 V152 C162 118 187 90 218 90 L246 90 C272 90 288 112 282 138 L258 300 V448 Z" fill="url(#lpGradPurple)" />
              <path d="M162 448 V152 C162 118 187 90 218 90 L246 90 C272 90 288 112 282 138 L258 300 V448 Z" fill="url(#lpGloss)" />
              <path d="M258 300 L282 138 C288 112 272 90 246 90 L242 90 C264 94 274 114 268 138 L246 300 Z" fill="rgba(0,0,0,0.10)" />
              <g className="eye eye-l bar-eye" data-eye-cx="200" data-eye-cy="168">
                <ellipse cx="200" cy="168" rx={13} ry={13} fill="#fff" />
                <g className="eye-pupil"><circle cx="200" cy="168" r="6" fill="#161311" /><use href="#lpGlint" x="202" y="165" /></g>
              </g>
              <g className="eye eye-r bar-eye" data-eye-cx="244" data-eye-cy="165">
                <ellipse cx="244" cy="165" rx={13} ry={13} fill="#fff" />
                <g className="eye-pupil"><circle cx="244" cy="165" r="6" fill="#161311" /><use href="#lpGlint" x="246" y="162" /></g>
              </g>
              <path d="M210 202 Q222 194 234 200" stroke="#2c1f5c" strokeWidth={4} fill="none" strokeLinecap="round" />
            </g>

            {/* DARK */}
            <g id="char-dark" className="char-group" data-char="dark" style={{ transformOrigin: "272px 448px" }}>
              <ellipse cx="250" cy="446" rx="10" ry="5" fill="#0f0d0b" />
              <ellipse cx="294" cy="446" rx="10" ry="5" fill="#0f0d0b" />
              <rect x="234" y="222" width="76" height="222" rx="22" fill="url(#lpGradChar)" />
              <rect x="234" y="222" width="76" height="222" rx="22" fill="url(#lpGloss)" />
              <rect x="304" y="222" width="6" height="222" rx="3" fill="rgba(0,0,0,0.28)" />
              <g className="eye eye-l" data-eye-cx="259" data-eye-cy="262">
                <circle cx="259" cy="262" r="12" fill="#fff" />
                <g className="eye-pupil"><circle cx="259" cy="262" r="5.2" fill="#161311" /><use href="#lpGlint" x="261" y="259" /></g>
              </g>
              <g className="eye eye-r" data-eye-cx="293" data-eye-cy="262">
                <circle cx="293" cy="262" r="12" fill="#fff" />
                <g className="eye-pupil"><circle cx="293" cy="262" r="5.2" fill="#161311" /><use href="#lpGlint" x="295" y="259" /></g>
              </g>
              <path d="M263 296 H289" stroke="rgba(255,255,255,0.18)" strokeWidth={3} strokeLinecap="round" />
            </g>

            {/* YELLOW */}
            <g id="char-yellow" className="char-group" data-char="yellow" style={{ transformOrigin: "368px 448px" }}>
              <path d="M318 448 V300 C318 262 340 232 368 232 C396 232 418 262 418 300 V448 Z" fill="url(#lpGradYellow)" stroke="#B48212" strokeWidth={1.5} />
              <path d="M318 448 V300 C318 262 340 232 368 232 C396 232 418 262 418 300 V448 Z" fill="url(#lpGloss)" />
              <ellipse cx="336" cy="312" rx="8" ry="4" fill="#E38A18" opacity=".28" />
              <ellipse cx="402" cy="312" rx="8" ry="4" fill="#E38A18" opacity=".28" />
              <g className="eye eye-l" data-eye-cx="352" data-eye-cy="292">
                <circle cx="352" cy="292" r="12.5" fill="#fff" />
                <g className="eye-pupil"><circle cx="352" cy="292" r="5.4" fill="#161311" /><use href="#lpGlint" x="354" y="289" /></g>
              </g>
              <g className="eye eye-r" data-eye-cx="386" data-eye-cy="292">
                <circle cx="386" cy="292" r="12.5" fill="#fff" />
                <g className="eye-pupil"><circle cx="386" cy="292" r="5.4" fill="#161311" /><use href="#lpGlint" x="388" y="289" /></g>
              </g>
              <path d="M356 328 Q369 336 382 328" stroke="#7A5A0F" strokeWidth={4} fill="none" strokeLinecap="round" />
            </g>

            {/* ORANGE */}
            <g id="char-orange" className="char-group" data-char="orange" style={{ transformOrigin: "148px 448px" }}>
              <path d="M50 448 V344 C50 282 92 240 148 240 C204 240 246 282 246 344 V448 Z" fill="url(#lpGradOrange)" />
              <path d="M50 448 V344 C50 282 92 240 148 240 C204 240 246 282 246 344 V448 Z" fill="url(#lpGloss)" />
              <path d="M220 320 Q210 380 220 440" stroke="rgba(0,0,0,0.10)" strokeWidth={5} fill="none" strokeLinecap="round" />
              <g className="eye eye-l" data-eye-cx="118" data-eye-cy="318">
                <circle cx="118" cy="318" r="14" fill="#fff" />
                <g className="eye-pupil"><circle cx="118" cy="318" r="6.2" fill="#161311" /><use href="#lpGlint" x="120" y="314" /></g>
              </g>
              <g className="eye eye-r" data-eye-cx="172" data-eye-cy="318">
                <circle cx="172" cy="318" r="14" fill="#fff" />
                <g className="eye-pupil"><circle cx="172" cy="318" r="6.2" fill="#161311" /><use href="#lpGlint" x="174" y="314" /></g>
              </g>
              <path d="M132 354 Q145 346 158 354" stroke="#6E2E12" strokeWidth={4} fill="none" strokeLinecap="round" />
            </g>
          </svg>
        </div>

        {/* Form panel */}
        <div className="lp-panel">
          {ok ? (
            <div className="lp-success show">
              <svg width={48} height={48} viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="11" stroke="#2F6E5A" strokeWidth="1.6" />
                <path d="M7 12.5l3 3 7-7" stroke="#2F6E5A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <h1 className="lp-display" style={{ fontSize: 22 }}>Kirdingiz</h1>
              <p className="lp-sub">Ish maydoni yuklanmoqda…</p>
            </div>
          ) : (
            <>
              <div className="lp-brand">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 2 L14 10 L22 12 L14 14 L12 22 L10 14 L2 12 L10 10 Z" fill="currentColor" />
                </svg>
                <span>Asl Belgisi</span>
              </div>
              <h1 className="lp-display">Xush kelibsiz</h1>
              <p className="lp-sub">Tizimga kirish uchun login va parolingizni kiriting.</p>

              <form onSubmit={submit} noValidate>
                <div className={"lp-field" + (nameInvalid ? " invalid" : "")}>
                  <label htmlFor="lp-user">Login</label>
                  <div className="lp-inputWrap">
                    <input id="lp-user" ref={nameRef} type="text" autoComplete="username" required
                           placeholder="loginingiz"
                           value={username}
                           onChange={e => setUsername(e.target.value)}
                           onFocus={() => focusFn.current(210, 50)}
                           onInput={e => focusFn.current(Math.min(210 + (e.currentTarget.value.length * 3), 400), 50)} />
                  </div>
                </div>

                <div className={"lp-field" + (passInvalid ? " invalid" : "")}>
                  <label htmlFor="lp-pass">Parol</label>
                  <div className="lp-inputWrap">
                    <input id="lp-pass" ref={passRef} type={showPass ? "text" : "password"} autoComplete="current-password" required
                           placeholder="parolingiz"
                           value={password}
                           onChange={e => { setPassword(e.target.value); privFn.current(!showPass && e.target.value.length > 0); }}
                           onFocus={() => { focusFn.current(260, 235); privFn.current(!showPass && password.length > 0); }}
                           onBlur={() => privFn.current(false)} />
                    <button type="button" className="lp-toggle" aria-label={showPass ? "Parolni yashirish" : "Parolni ko'rsatish"}
                            aria-pressed={showPass}
                            onClick={() => { const on = !showPass; setShowPass(on); privFn.current(!on && password.length > 0); if (on) focusFn.current(300, 235); }}>
                      {showPass ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                          <path d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.24 4.24M6.5 6.7C4 8.3 2 12 2 12s4 7 11 7c1.7 0 3.2-.35 4.5-.94M17.3 17.3C19 15.9 22 12 22 12s-1.3-2.3-3.5-4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                          <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" stroke="currentColor" strokeWidth="1.8" />
                          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
                        </svg>
                      )}
                    </button>
                  </div>
                  <p className={"lp-err" + (err ? " show" : "")} role="alert">{err || " "}</p>
                </div>

                <button type="submit" className={"lp-primary" + (busy ? " loading" : "")} disabled={busy}>
                  {busy ? "Kirilmoqda…" : "Kirish"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
