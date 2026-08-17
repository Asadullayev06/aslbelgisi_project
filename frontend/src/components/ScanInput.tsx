import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface ScanInputHandle {
  focus: () => void;
}

export interface ScanInputProps {
  placeholder: string;
  tone?: "accent" | "warning";
  disabled?: boolean;
  onScan: (value: string) => void;
}

/** Gap that separates one scan from the next. A keyboard-wedge scanner emits
 *  characters ~1-20ms apart; a human types far slower than this. */
const SCAN_CHAR_GAP_MS = 150;
/** Shortest thing we'll treat as a scanned code. */
const MIN_SCAN_LEN = 8;

/** True for anything the operator might legitimately be typing into. */
function isTextEntry(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const t = (el as HTMLInputElement).type.toLowerCase();
    return !["button", "submit", "checkbox", "radio", "file", "reset"].includes(t);
  }
  return (el as HTMLElement).isContentEditable === true;
}

/** Big scanner-first input.
 *
 *  Losing a barcode to focus is the failure this component exists to prevent,
 *  so it defends on two fronts:
 *
 *   1. Focus is sticky. Clicking a BUTTON used to leave focus on that button —
 *      the next scan then typed into the button and was thrown away, and the
 *      scanner's trailing Enter re-activated it. Focus now returns here after
 *      any click except one into a real text field.
 *   2. A document-level capture catches scans anyway. Even with focus
 *      somewhere unexpected, a burst of machine-speed keystrokes ending in
 *      Enter is recognised and delivered, so a scan is never silently
 *      swallowed by whatever happened to be focused.
 */
export const ScanInput = forwardRef<ScanInputHandle, ScanInputProps>(function ScanInput(
  { placeholder, tone = "accent", disabled, onScan }, ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(true);

  // Keep the latest onScan without re-binding the document listener.
  const onScanRef = useRef(onScan);
  useEffect(() => { onScanRef.current = onScan; }, [onScan]);
  const disabledRef = useRef(disabled);
  useEffect(() => { disabledRef.current = disabled; }, [disabled]);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
  }));

  // ── 1. sticky focus ──────────────────────────────────────
  useEffect(() => {
    const refocus = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target === inputRef.current) return;
      // Only a genuine text field is allowed to keep focus.
      if (isTextEntry(target)) return;
      // Buttons included: hand focus back once their own handler has run.
      setTimeout(() => {
        if (!disabledRef.current) inputRef.current?.focus();
      }, 0);
    };
    window.addEventListener("click", refocus);
    return () => window.removeEventListener("click", refocus);
  }, []);

  // ── 2. document-level scanner capture ────────────────────
  useEffect(() => {
    let buf = "";
    let last = 0;

    const onKeyDown = (e: KeyboardEvent) => {
      if (disabledRef.current) return;
      const active = document.activeElement;
      // The visible input handles its own Enter; don't process twice.
      if (active === inputRef.current) return;
      // The operator is typing into a real field (API key, INN, …).
      if (isTextEntry(active)) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      const now = Date.now();
      if (e.key === "Enter") {
        const code = buf;
        buf = "";
        if (code.length >= MIN_SCAN_LEN) {
          // Stop the Enter from re-activating whatever button holds focus.
          e.preventDefault();
          e.stopPropagation();
          onScanRef.current(code);
          inputRef.current?.focus();
        }
        return;
      }
      if (e.key.length !== 1) return;          // Shift, Tab, arrows, …
      if (now - last > SCAN_CHAR_GAP_MS) buf = "";
      last = now;
      buf += e.key;
      // Keep stray characters (notably Space) from activating a focused button.
      e.preventDefault();
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return (
    <div className="relative">
      <input
        ref={inputRef}
        data-scan-input=""
        autoFocus
        spellCheck={false}
        autoComplete="off"
        disabled={disabled}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={e => {
          if (e.key === "Enter") {
            const v = (e.currentTarget.value || "").trim();
            if (v) {
              onScan(v);
              e.currentTarget.value = "";
            }
            e.preventDefault();
          }
        }}
        className={cn(
          "w-full h-14 rounded-xl bg-surface2/60 border-2 px-4 font-mono text-base",
          "text-text placeholder:text-muted",
          "focus-visible:outline-none",
          tone === "warning"
            ? "border-warning/70 focus:border-warning focus:shadow-[0_0_0_4px_hsl(var(--warning)/0.25)]"
            : "border-accent/60  focus:border-accent  focus:shadow-[0_0_0_4px_hsl(var(--accent)/0.25)]",
          "transition-all",
        )}
      />
      {!focused && !disabled && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px]
                        uppercase tracking-wide text-warning bg-warning/10
                        border border-warning/30 rounded px-1.5 py-0.5">
          fokus tashqarida — skaner baribir ishlaydi
        </div>
      )}
    </div>
  );
});
