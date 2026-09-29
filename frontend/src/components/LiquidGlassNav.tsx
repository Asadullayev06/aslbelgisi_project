import { useEffect, useId, useRef } from "react";
import "./LiquidGlassNav.css";

type Geometry = { x: number; y: number; w: number; h: number };
type State = Geometry & { sx: number; sy: number; lift: number };
const channels = ["x", "y", "w", "h", "sx", "sy", "lift"] as const;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** A neutral centre with a narrow rounded-edge refraction band. All colours
 * share one displacement, so lettering never splits into RGB outlines. */
function edgeMap(width: number, height: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const pixels = ctx.createImageData(canvas.width, canvas.height);
  const radius = Math.min(14, height / 2);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const px = x + .5 - width / 2, py = y + .5 - height / 2;
      const qx = Math.abs(px) - width / 2 + radius;
      const qy = Math.abs(py) - height / 2 + radius;
      const vx = Math.max(qx, 0), vy = Math.max(qy, 0);
      const length = Math.hypot(vx, vy);
      const distance = length + Math.min(Math.max(qx, qy), 0) - radius;
      const t = clamp(1 + distance / 6, 0, 1);
      const weight = t * t * (3 - 2 * t);
      const nx = length ? vx / length : qx > qy ? 1 : 0;
      const ny = length ? vy / length : qy >= qx ? 1 : 0;
      const i = (y * canvas.width + x) * 4;
      pixels.data[i] = Math.round(128 + Math.sign(px) * nx * 90 * weight);
      pixels.data[i + 1] = Math.round(128 + Math.sign(py) * ny * 90 * weight);
      pixels.data[i + 2] = 128;
      pixels.data[i + 3] = 255;
    }
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas.toDataURL();
}

function supportsLensing() {
  // CSS.supports alone only checks syntax, not SVG backdrop rendering.
  return /Chrome|Chromium|Edg\//.test(navigator.userAgent) &&
    !/CriOS|EdgiOS/.test(navigator.userAgent) &&
    CSS.supports("backdrop-filter", "url(#lens)");
}

export function GlassLens({ navRef, dep }: {
  navRef: React.RefObject<HTMLElement | null>; dep: unknown;
}) {
  const id = useId().replace(/:/g, "");
  const lensRef = useRef<HTMLDivElement>(null);
  const filtersRef = useRef<SVGSVGElement>(null);
  const apiRef = useRef<{ retarget: () => void } | null>(null);

  // Passive setup runs once the ancestor nav ref is attached.
  useEffect(() => {
    const nav = navRef.current, lens = lensRef.current;
    if (!nav || !lens) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = motion.matches;
    const refracts = supportsLensing();
    lens.classList.toggle("lensing", refracts);
    lens.style.setProperty("--lens-filter", "url(#" + id + "-lens)");
    lens.style.setProperty("--lens-filter-soft", "url(#" + id + "-soft)");
    let mapSize = "";
    let current: State | null = null, target: State | null = null;
    const velocity: State = { x: 0, y: 0, w: 0, h: 0, sx: 0, sy: 0, lift: 0 };
    let hover: HTMLElement | null = null, focus: HTMLElement | null = null;
    let pressed = false, pointerId: number | null = null, frame = 0, last = 0;
    const active = () => nav.querySelector<HTMLElement>('[data-nav-item][data-active="true"]');
    const itemFrom = (node: EventTarget | null) => {
      const item = node instanceof Element ? node.closest<HTMLElement>("[data-nav-item]") : null;
      return item && nav.contains(item) ? item : null;
    };
    const preferred = () => focus || hover || active();
    const measure = (item: HTMLElement): Geometry => {
      const bounds = item.getBoundingClientRect();
      const origin = lens.offsetParent?.getBoundingClientRect();
      return {
        x: bounds.left - (origin?.left ?? 0) - 5,
        y: bounds.top - (origin?.top ?? 0) - 3,
        w: bounds.width + 10, h: bounds.height + 6,
      };
    };
    const updateMap = (geometry: Geometry) => {
      if (!refracts) return;
      const key = Math.round(geometry.w) + ":" + Math.round(geometry.h);
      if (key === mapSize) return;
      mapSize = key;
      const uri = edgeMap(geometry.w, geometry.h);
      filtersRef.current?.querySelectorAll("filter").forEach(filter => {
        filter.setAttribute("width", String(geometry.w));
        filter.setAttribute("height", String(geometry.h));
        const image = filter.querySelector("feImage");
        image?.setAttribute("href", uri);
        image?.setAttribute("width", String(geometry.w));
        image?.setAttribute("height", String(geometry.h));
      });
    };
    const render = () => {
      if (!current) return;
      lens.style.width = current.w + "px";
      lens.style.height = current.h + "px";
      const lift = 1 + current.lift * .045;
      lens.style.transform = "translate3d(" + current.x + "px," + current.y + "px,0) scale(" + current.sx * lift + "," + current.sy * lift + ")";
      lens.style.setProperty("--lens-lift", String(current.lift));
      lens.style.opacity = "1";
    };
    const stop = () => { cancelAnimationFrame(frame); frame = 0; };
    const snap = () => {
      if (!target) return;
      stop();
      current = { ...target, sx: 1, sy: 1, lift: 0 };
      channels.forEach(key => { velocity[key] = 0; });
      render();
    };
    const tick = (now: number) => {
      frame = 0;
      if (!current || !target || reduced) return;
      // Fixed substeps make the spring stable on low/high refresh-rate screens.
      const elapsed = Math.min((now - last) / 1000, .032);
      last = now;
      const steps = Math.max(1, Math.ceil(elapsed / (1 / 120)));
      const dt = elapsed / steps;
      for (let step = 0; step < steps; step++) {
        target.sx = 1 + clamp(Math.abs(velocity.x) * .00010, 0, .05) - clamp(Math.abs(velocity.y) * .00006, 0, .035);
        target.sy = 1 + clamp(Math.abs(velocity.y) * .00010, 0, .065) - clamp(Math.abs(velocity.x) * .00006, 0, .035);
        target.lift = pressed ? 1 : 0;
        for (const key of channels) {
          const shape = key === "sx" || key === "sy" || key === "lift";
          const stiffness = shape ? 320 : 300, damping = shape ? 30 : 29;
          velocity[key] += (stiffness * (target[key] - current[key]) - damping * velocity[key]) * dt;
          current[key] += velocity[key] * dt;
        }
      }
      render();
      const moving = channels.some(key => {
        const threshold = key === "sx" || key === "sy" || key === "lift" ? .0005 : .05;
        return Math.abs(velocity[key]) > threshold || Math.abs(current![key] - target![key]) > threshold;
      });
      if (moving) frame = requestAnimationFrame(tick);
      else {
        current = { ...target, sx: 1, sy: 1, lift: pressed ? 1 : 0 };
        channels.forEach(key => { velocity[key] = 0; });
        render();
      }
    };
    const start = () => {
      if (reduced || frame) return;
      last = performance.now();
      frame = requestAnimationFrame(tick);
    };
    const aim = (item: HTMLElement | null, immediate = false) => {
      if (!item) { lens.style.opacity = "0"; stop(); return; }
      const geometry = measure(item); // Reads only on interaction/resize, never each frame.
      updateMap(geometry);
      target = { ...geometry, sx: 1, sy: 1, lift: pressed ? 1 : 0 };
      if (!current || immediate || reduced) {
        const fade = reduced && !!current && !immediate;
        snap();
        if (fade) lens.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: "ease-out" });
      } else start();
    };
    const onOver = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const item = itemFrom(event.target);
      if (item === hover) return;
      hover = item;
      if (!focus) aim(preferred());
    };
    const onLeave = () => { hover = null; aim(preferred()); };
    const onFocus = (event: FocusEvent) => {
      const item = itemFrom(event.target);
      // Pointer clicks leave DOM focus behind; only keyboard focus takes priority.
      focus = item?.matches(":focus-visible") ? item : null;
      aim(preferred());
    };
    const onBlur = (event: FocusEvent) => {
      const next = itemFrom(event.relatedTarget);
      focus = next?.matches(":focus-visible") ? next : null;
      aim(preferred());
    };
    const onDown = (event: PointerEvent) => {
      const item = itemFrom(event.target);
      if (!item || event.button !== 0) return;
      focus = null; pointerId = event.pointerId; pressed = true;
      aim(item);
      if (!reduced) start();
    };
    const release = () => {
      if (!pressed) return;
      pressed = false; pointerId = null;
      if (target) target.lift = 0;
      if (reduced) snap(); else start();
    };
    const onUp = (event: PointerEvent) => { if (pointerId === event.pointerId) release(); };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== " " && event.key !== "Enter") return;
      const item = itemFrom(event.target);
      if (!item) return;
      focus = item; pressed = true; aim(item); start();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === " " || event.key === "Enter") release();
    };
    const onResize = () => aim(preferred(), true);
    const onMotion = () => {
      reduced = motion.matches;
      if (reduced) snap(); else aim(preferred());
    };
    const onWindowBlur = () => { hover = null; release(); aim(preferred()); };
    const observer = new ResizeObserver(onResize);
    observer.observe(nav);
    nav.querySelectorAll<HTMLElement>("[data-nav-item]").forEach(item => observer.observe(item));
    nav.addEventListener("pointerover", onOver);
    nav.addEventListener("pointerleave", onLeave);
    nav.addEventListener("focusin", onFocus);
    nav.addEventListener("focusout", onBlur);
    nav.addEventListener("pointerdown", onDown);
    nav.addEventListener("keydown", onKeyDown);
    nav.addEventListener("keyup", onKeyUp);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("resize", onResize);
    motion.addEventListener("change", onMotion);
    apiRef.current = { retarget: () => aim(focus || active() || hover) };
    aim(active(), true);
    return () => {
      stop(); observer.disconnect(); apiRef.current = null;
      nav.removeEventListener("pointerover", onOver);
      nav.removeEventListener("pointerleave", onLeave);
      nav.removeEventListener("focusin", onFocus);
      nav.removeEventListener("focusout", onBlur);
      nav.removeEventListener("pointerdown", onDown);
      nav.removeEventListener("keydown", onKeyDown);
      nav.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("resize", onResize);
      motion.removeEventListener("change", onMotion);
    };
  }, [navRef, id]);

  useEffect(() => { apiRef.current?.retarget(); }, [dep]);
  return <>
    <svg ref={filtersRef} className="glass-filter-defs" aria-hidden="true" focusable="false">
      <defs>{[{ suffix: "lens", scale: 8 }, { suffix: "soft", scale: 4 }].map(({ suffix, scale }) =>
        <filter key={suffix} id={id + "-" + suffix} x="0" y="0" width="1" height="1"
          filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feImage x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="edge-map" />
          <feDisplacementMap in="SourceGraphic" in2="edge-map" scale={scale} xChannelSelector="R" yChannelSelector="G" />
        </filter>)}</defs>
    </svg>
    <div ref={lensRef} className="glass-lens" aria-hidden="true" />
  </>;
}
