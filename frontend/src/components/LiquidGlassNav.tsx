import { useEffect, useLayoutEffect, useRef } from "react";
import "./LiquidGlassNav.css";

/** Chromium is the only engine that runs url() filters inside
 *  backdrop-filter; everyone else falls back to blur + saturate. */
function supportsUrlBackdrop(): boolean {
  try {
    return (
      typeof CSS !== "undefined" && !!CSS.supports &&
      (CSS.supports("backdrop-filter", "url(#x) blur(1px)") ||
        CSS.supports("-webkit-backdrop-filter", "url(#x) blur(1px)"))
    );
  } catch { return false; }
}
function reducedMotion(): boolean {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
  catch { return false; }
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Edge-weighted XY displacement map: red encodes horizontal, green vertical,
 *  each a 0→255 ramp so the centre is neutral (128) and the edges push hard.
 *  Built as a data-URI so feImage can stretch it across the lens. */
const MAP_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'>" +
  "<defs>" +
  "<linearGradient id='rx' x1='0' y1='0' x2='1' y2='0'>" +
  "<stop offset='0' stop-color='#000'/><stop offset='0.5' stop-color='#800000'/><stop offset='1' stop-color='#f00'/>" +
  "</linearGradient>" +
  "<linearGradient id='gy' x1='0' y1='0' x2='0' y2='1'>" +
  "<stop offset='0' stop-color='#000'/><stop offset='0.5' stop-color='#008000'/><stop offset='1' stop-color='#0f0'/>" +
  "</linearGradient>" +
  "</defs>" +
  "<rect width='80' height='80' fill='#000'/>" +
  "<rect width='80' height='80' fill='url(#rx)' style='mix-blend-mode:screen'/>" +
  "<rect width='80' height='80' fill='url(#gy)' style='mix-blend-mode:screen'/>" +
  "</svg>";
const MAP_URI = "data:image/svg+xml," + encodeURIComponent(MAP_SVG);

type Box = { cx: number; cy: number; w: number; h: number };

/** The glass lens: rides above the nav items and follows active / hover /
 *  focus with a spring. `dep` re-targets it onto the active item on route
 *  change. The nav must be `position: relative` and each entry must carry
 *  `data-nav-item` (+ `data-active="true"` on the current one). */
export function GlassLens({ navRef, dep }: {
  navRef: React.RefObject<HTMLElement | null>;
  dep: unknown;
}) {
  const lensRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<{ retarget: () => void } | null>(null);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const lens = lensRef.current;
    if (!nav || !lens) return;

    const reduced = reducedMotion();
    lens.classList.toggle("lensing", supportsUrlBackdrop());

    const PADX = 6, PADY = 4;
    const measure = (el: HTMLElement): Box => ({
      cx: el.offsetLeft + el.offsetWidth / 2,
      cy: el.offsetTop + el.offsetHeight / 2,
      w: el.offsetWidth + PADX * 2,
      h: el.offsetHeight + PADY * 2,
    });
    const activeEl = () =>
      nav.querySelector<HTMLElement>('[data-nav-item][data-active="true"]');

    // ── spring state ──
    let cur: Box | null = null;
    let target: Box | null = null;
    const vel = { cx: 0, cy: 0, w: 0, h: 0 };
    let pressed = false;
    let hovering = false;
    let raf = 0;
    let running = false;
    let last = 0;

    const STIFF = 230, DAMP = 24, MASS = 1;

    const render = (c: Box, sx: number, sy: number) => {
      lens.style.width = c.w + "px";
      lens.style.height = c.h + "px";
      lens.style.transform =
        `translate(${c.cx - c.w / 2}px, ${c.cy - c.h / 2}px) scale(${sx}, ${sy})`;
      lens.style.opacity = "1";
    };

    const tick = (now: number) => {
      if (!target) { running = false; return; }
      const dt = Math.min((now - last) / 1000 || 1 / 60, 1 / 30);
      last = now;
      if (!cur) cur = { ...target };

      let moving = false;
      (["cx", "cy", "w", "h"] as const).forEach(k => {
        const f = -STIFF * (cur![k] - target![k]) - DAMP * vel[k];
        vel[k] += (f / MASS) * dt;
        cur![k] += vel[k] * dt;
        if (Math.abs(vel[k]) > 0.03 || Math.abs(cur![k] - target![k]) > 0.03) moving = true;
      });

      // Squash & stretch from velocity (vertical nav → mostly Y).
      let sx = 1, sy = 1;
      const vx = vel.cx, vy = vel.cy;
      sy = 1 + clamp(Math.abs(vy) * 0.0016, 0, 0.16) - clamp(Math.abs(vx) * 0.0010, 0, 0.08);
      sx = 1 + clamp(Math.abs(vx) * 0.0016, 0, 0.14) - clamp(Math.abs(vy) * 0.0012, 0, 0.12);
      const press = pressed ? 1.06 : 1;
      render(cur, sx * press, sy * press);

      if (moving || pressed) { raf = requestAnimationFrame(tick); }
      else { running = false; render(cur, press, press); }
    };
    const start = () => {
      if (running) return;
      running = true; last = performance.now();
      raf = requestAnimationFrame(tick);
    };

    const setTarget = (el: HTMLElement | null, instant = false) => {
      if (!el) return;
      target = measure(el);
      if (reduced || instant) {
        cur = { ...target }; vel.cx = vel.cy = vel.w = vel.h = 0;
        render(cur, pressed ? 1.06 : 1, pressed ? 1.06 : 1);
      } else start();
    };

    // Initial placement onto the active item.
    const a0 = activeEl();
    if (a0) { cur = measure(a0); target = { ...cur }; render(cur, 1, 1); }
    const raf0 = requestAnimationFrame(() => setTarget(activeEl(), true));

    const onOver = (e: Event) => {
      const it = (e.target as Element)?.closest?.("[data-nav-item]") as HTMLElement | null;
      if (it && nav.contains(it)) { hovering = true; setTarget(it); }
    };
    const onLeave = () => { hovering = false; setTarget(activeEl()); };
    const onFocus = (e: Event) => {
      const it = (e.target as Element)?.closest?.("[data-nav-item]") as HTMLElement | null;
      if (it && nav.contains(it)) setTarget(it);
    };
    const onDown = () => { pressed = true; lens.classList.add("is-pressed"); start(); };
    const onUp = () => { pressed = false; lens.classList.remove("is-pressed"); start(); };
    const onResize = () => setTarget(hovering ? null : activeEl(), true);

    nav.addEventListener("mouseover", onOver);
    nav.addEventListener("mouseleave", onLeave);
    nav.addEventListener("focusin", onFocus);
    nav.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(() => setTarget(hovering ? null : activeEl(), true));
    ro.observe(nav);

    apiRef.current = {
      retarget: () => { if (!hovering) setTarget(activeEl()); },
    };

    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(raf0);
      nav.removeEventListener("mouseover", onOver);
      nav.removeEventListener("mouseleave", onLeave);
      nav.removeEventListener("focusin", onFocus);
      nav.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      apiRef.current = null;
    };
  }, [navRef]);

  // Re-target onto the (possibly new) active item when the route changes.
  useEffect(() => { apiRef.current?.retarget(); }, [dep]);

  return (
    <>
      <LensFilter />
      <div ref={lensRef} className="glass-lens" aria-hidden="true" />
    </>
  );
}

/** Displacement + per-channel chromatic split (Chromium only). */
function LensFilter() {
  return (
    <svg className="glass-filter-defs" aria-hidden="true" focusable="false">
      <defs>
        <filter id="asl-lens" x="-40%" y="-40%" width="180%" height="180%"
                colorInterpolationFilters="sRGB">
          <feImage href={MAP_URI} x="0" y="0" width="100%" height="100%"
                   preserveAspectRatio="none" result="map" />
          {/* Red channel — largest displacement. */}
          <feDisplacementMap in="SourceGraphic" in2="map" scale="46"
                             xChannelSelector="R" yChannelSelector="G" result="dR" />
          <feColorMatrix in="dR" type="matrix"
            values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="cR" />
          {/* Green channel — medium. */}
          <feDisplacementMap in="SourceGraphic" in2="map" scale="39"
                             xChannelSelector="R" yChannelSelector="G" result="dG" />
          <feColorMatrix in="dG" type="matrix"
            values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="cG" />
          {/* Blue channel — smallest. */}
          <feDisplacementMap in="SourceGraphic" in2="map" scale="32"
                             xChannelSelector="R" yChannelSelector="G" result="dB" />
          <feColorMatrix in="dB" type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="cB" />
          <feBlend in="cR" in2="cG" mode="screen" result="rg" />
          <feBlend in="rg" in2="cB" mode="screen" />
        </filter>
      </defs>
    </svg>
  );
}
