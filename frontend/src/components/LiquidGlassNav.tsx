import { useEffect, useLayoutEffect, useRef } from "react";
import "./LiquidGlassNav.css";

/** Does the browser support url() filters inside backdrop-filter? Only
 *  Chromium does today; Safari/Firefox fall back to plain blur+saturate. */
function supportsBackdropUrlFilter(): boolean {
  try {
    return (
      typeof CSS !== "undefined" &&
      !!CSS.supports &&
      (CSS.supports("backdrop-filter", 'blur(1px) url("#x")') ||
        CSS.supports("-webkit-backdrop-filter", 'blur(1px) url("#x")'))
    );
  } catch {
    return false;
  }
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** The shared glass lens that lives inside a `<nav>` and tracks the active /
 *  hovered / focused item. The nav must be `position: relative`, each nav
 *  entry must carry `data-nav-item` and the active one `data-active="true"`,
 *  and the items must sit above the lens (z-index ≥ 1). `dep` re-settles the
 *  lens onto the active item whenever it changes (e.g. route change). */
export function GlassLens({ navRef, dep }: {
  navRef: React.RefObject<HTMLElement | null>;
  dep: unknown;
}) {
  const lensRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const lens = lensRef.current;
    if (!nav || !lens) return;

    lens.classList.toggle("glass-lensing", supportsBackdropUrlFilter());
    const reduced = prefersReducedMotion();

    const place = (el: HTMLElement, animate: boolean) => {
      lens.style.width = el.offsetWidth + "px";
      lens.style.height = el.offsetHeight + "px";
      lens.style.translate = `${el.offsetLeft}px ${el.offsetTop}px`;
      lens.style.opacity = "1";
      if (animate && !reduced) {
        lens.classList.remove("is-moving");
        void lens.offsetWidth;              // restart the stretch keyframe
        lens.classList.add("is-moving");
      }
    };

    const activeEl = () =>
      nav.querySelector<HTMLElement>('[data-nav-item][data-active="true"]');
    const settle = () => { const a = activeEl(); if (a) place(a, false); };

    // Initial placement — after layout, and once more on the next frame in
    // case web fonts shift row heights.
    settle();
    const raf = requestAnimationFrame(settle);

    const onOver = (e: Event) => {
      const it = (e.target as Element)?.closest?.("[data-nav-item]") as HTMLElement | null;
      if (it && nav.contains(it)) place(it, true);
    };
    const onLeave = () => settle();
    const onFocus = (e: Event) => {
      const it = (e.target as Element)?.closest?.("[data-nav-item]") as HTMLElement | null;
      if (it && nav.contains(it)) place(it, true);
    };
    const onDown = () => lens.classList.add("is-pressed");
    const onUp = () => lens.classList.remove("is-pressed");

    nav.addEventListener("mouseover", onOver);
    nav.addEventListener("mouseleave", onLeave);
    nav.addEventListener("focusin", onFocus);
    nav.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("resize", settle);

    const ro = new ResizeObserver(settle);
    ro.observe(nav);

    return () => {
      cancelAnimationFrame(raf);
      nav.removeEventListener("mouseover", onOver);
      nav.removeEventListener("mouseleave", onLeave);
      nav.removeEventListener("focusin", onFocus);
      nav.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("resize", settle);
      ro.disconnect();
    };
  }, [navRef, dep]);

  // Re-settle onto the active item whenever the route changes.
  useEffect(() => {
    const nav = navRef.current, lens = lensRef.current;
    if (!nav || !lens) return;
    const a = nav.querySelector<HTMLElement>('[data-nav-item][data-active="true"]');
    if (a) {
      lens.style.width = a.offsetWidth + "px";
      lens.style.height = a.offsetHeight + "px";
      lens.style.translate = `${a.offsetLeft}px ${a.offsetTop}px`;
      lens.style.opacity = "1";
    }
  }, [dep, navRef]);

  return (
    <>
      <GlassFilterDefs />
      <div ref={lensRef} className="glass-lens" aria-hidden="true" />
    </>
  );
}

/** The displacement filter used for the lensing pass (Chromium only). */
function GlassFilterDefs() {
  return (
    <svg className="glass-filter-defs" aria-hidden="true" focusable="false">
      <defs>
        <filter id="asl-glass-displace" x="-25%" y="-25%" width="150%" height="150%"
                colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.011 0.014"
                        numOctaves="2" seed="7" result="noise" />
          <feGaussianBlur in="noise" stdDeviation="1.1" result="softNoise" />
          <feDisplacementMap in="SourceGraphic" in2="softNoise" scale="9"
                             xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
  );
}
