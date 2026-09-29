import { useEffect, useId, useRef, type RefObject } from "react";
import "./LoginLiquidGlass.css";

/** Local flowing waves feather to neutral at the edges, without concentric rings. */
function waterMap() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 192;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const data = ctx.createImageData(192, 192);
  for (let y = 0; y < 192; y++) for (let x = 0; x < 192; x++) {
    const dx = (x - 95.5) / 96, dy = (y - 95.5) / 96;
    const envelope = Math.pow(Math.max(0, 1 - dx * dx), 3)
      * Math.pow(Math.max(0, 1 - dy * dy), 3);
    const flowX = Math.sin(dy * 3 + Math.sin(dx * 2) * .6);
    const flowY = Math.sin(dx * 3 - Math.sin(dy * 2) * .6);
    const index = (y * 192 + x) * 4;
    data.data[index] = Math.round(128 + flowX * envelope * 100);
    data.data[index + 1] = Math.round(128 + flowY * envelope * 100);
    data.data[index + 2] = 128;
    data.data[index + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return canvas.toDataURL();
}

/** Decorative overlay only: never intercepts clicks, focus, or form input. */
export function LoginLiquidGlass({ pageRef }: { pageRef: RefObject<HTMLDivElement> }) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const lensRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<SVGFEImageElement>(null);
  const displacementRef = useRef<SVGFEDisplacementMapElement>(null);
  const id = "login-water-" + useId().replace(/:/g, "");

  useEffect(() => {
    const page = pageRef.current, overlay = overlayRef.current, lens = lensRef.current;
    if (!page || !overlay || !lens) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const fine = matchMedia("(hover: hover) and (pointer: fine)");
    let enabled = fine.matches && !reduced.matches;
    const supports = /Chrome|Chromium|Edg\//.test(navigator.userAgent) &&
      !/CriOS|EdgiOS/.test(navigator.userAgent) && CSS.supports("backdrop-filter", "url(#water)");
    lens.classList.toggle("has-refraction", supports);
    lens.style.setProperty("--water-filter", "url(#" + id + ")");
    imageRef.current?.setAttribute("href", waterMap());
    let bounds = page.getBoundingClientRect();
    let x = 0, y = 0, tx = 0, ty = 0, vx = 0, vy = 0;
    let frame = 0, last = 0, lastMove = -10000, lastRipple = 0, slot = 0;
    let inside = false, initialized = false, editing = false, alpha = 0;
    const rings = Array.from(overlay.querySelectorAll<HTMLElement>(".tp-water-ring"));
    const animations = new Map<HTMLElement, Animation>();
    const cancel = () => {
      cancelAnimationFrame(frame); frame = 0;
      animations.forEach(animation => animation.cancel()); animations.clear();
      overlay.style.opacity = "0"; lens.style.opacity = "0"; alpha = 0;
    };
    const draw = (now: number) => {
      frame = 0;
      if (!enabled) return;
      const dt = Math.min((now - last) / 1000 || 1 / 60, .032);
      last = now;
      const substeps = Math.max(1, Math.ceil(dt * 120));
      for (let i = 0; i < substeps; i++) {
        const step = dt / substeps;
        vx += (380 * (tx - x) - 34 * vx) * step;
        vy += (380 * (ty - y) - 34 * vy) * step;
        x += vx * step; y += vy * step;
      }
      const speed = Math.min(Math.hypot(vx, vy) / 1600, 1);
      const freshness = inside ? Math.max(0, 1 - (now - lastMove) / 1400) : 0;
      const targetAlpha = freshness * (editing ? .14 : .85);
      alpha += (targetAlpha - alpha) * (1 - Math.exp(-dt * 9));
      lens.style.transform = "translate3d(" + (x - 210) + "px," + (y - 210) + "px,0) scale(" + (1 + speed * .04) + "," + (1 - speed * .02) + ")";
      // Fade displacement itself: blending a displaced copy over the original
      // with opacity/masking produces doubled glyphs rather than clear refraction.
      lens.style.opacity = "1";
      lens.style.setProperty("--water-sheen", String(alpha * .075));
      displacementRef.current?.setAttribute("scale", String(editing ? 0 : alpha * (3 + speed * 3)));
      overlay.style.opacity = "1";
      overlay.style.setProperty("--water-x", x + "px");
      overlay.style.setProperty("--water-y", y + "px");
      overlay.style.setProperty("--water-light", String(alpha * .025));
      if (freshness > 0 || alpha > .002 || Math.hypot(tx - x, ty - y) > .1) frame = requestAnimationFrame(draw);
      else { lens.style.opacity = "0"; overlay.style.setProperty("--water-light", "0"); }
    };
    const start = () => { if (!frame) { last = performance.now(); frame = requestAnimationFrame(draw); } };
    const ripple = (now: number, click = false) => {
      if (editing || (!click && now - lastRipple < 180)) return;
      lastRipple = now;
      const ring = rings[slot++ % rings.length];
      animations.get(ring)?.cancel();
      ring.style.left = tx + "px"; ring.style.top = ty + "px";
      const animation = ring.animate([
        { transform: "translate(-50%, -50%) scale(.35)", opacity: click ? .65 : .38 },
        { opacity: .22, offset: .32 },
        { transform: "translate(-50%, -50%) scale(" + (click ? 1.75 : 1.35) + ")", opacity: 0 },
      ], { duration: click ? 1350 : 1050, easing: "cubic-bezier(.16, 1, .3, 1)" });
      animations.set(ring, animation);
      animation.onfinish = () => { if (animations.get(ring) === animation) animations.delete(ring); };
    };
    const move = (event: PointerEvent) => {
      if (!enabled || event.pointerType === "touch") return;
      tx = event.clientX - bounds.left; ty = event.clientY - bounds.top;
      editing = event.target instanceof Element && !!event.target.closest("input, button, label, .tp-input");
      inside = true;
      if (!initialized) { x = tx; y = ty; initialized = true; }
      lastMove = performance.now();
      ripple(lastMove); start();
    };
    const leave = () => { inside = false; if (enabled) start(); };
    const down = (event: PointerEvent) => { if (event.button === 0) { move(event); if (enabled) ripple(performance.now(), true); } };
    const resize = () => { bounds = page.getBoundingClientRect(); };
    const preferences = () => { enabled = fine.matches && !reduced.matches; if (!enabled) cancel(); };
    const visibility = () => { if (document.hidden) { inside = false; cancel(); } };
    const observer = new ResizeObserver(resize); observer.observe(page);
    page.addEventListener("pointermove", move);
    page.addEventListener("pointerleave", leave);
    page.addEventListener("pointerdown", down);
    window.addEventListener("blur", leave);
    window.addEventListener("scroll", resize, true);
    window.addEventListener("resize", resize);
    reduced.addEventListener("change", preferences); fine.addEventListener("change", preferences);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      cancel(); observer.disconnect();
      page.removeEventListener("pointermove", move); page.removeEventListener("pointerleave", leave); page.removeEventListener("pointerdown", down);
      window.removeEventListener("blur", leave); window.removeEventListener("scroll", resize, true); window.removeEventListener("resize", resize);
      reduced.removeEventListener("change", preferences); fine.removeEventListener("change", preferences);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [pageRef, id]);

  return <div ref={overlayRef} className="tp-water" aria-hidden="true">
    <svg className="tp-water-defs" focusable="false"><defs>
      <filter id={id} x="0" y="0" width="420" height="420" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
        <feImage ref={imageRef} x="0" y="0" width="420" height="420" preserveAspectRatio="none" result="water-map" />
        <feDisplacementMap ref={displacementRef} in="SourceGraphic" in2="water-map" scale="0" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </defs></svg>
    <div ref={lensRef} className="tp-water-lens" />
    {[0, 1, 2, 3, 4, 5].map(key => <span key={key} className="tp-water-ring" />)}
  </div>;
}
