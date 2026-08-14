import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
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

/** Big scanner-first input.
 *
 *  Focus behaviour that Streamlit couldn't do:
 *   * autofocus on mount
 *   * re-focus on every window click (so operator can't accidentally lose it)
 *   * clears itself on submit (Enter) via native input, no key remounts
 *   * ref exposes .focus() so parent can pull focus after button clicks
 */
export const ScanInput = forwardRef<ScanInputHandle, ScanInputProps>(function ScanInput(
  { placeholder, tone = "accent", disabled, onScan }, ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
  }));

  // Auto-refocus on any window click that isn't on an interactive control.
  useEffect(() => {
    const refocus = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("button, a, input, textarea, select, [role='button']")) return;
      inputRef.current?.focus();
    };
    window.addEventListener("click", refocus);
    return () => window.removeEventListener("click", refocus);
  }, []);

  return (
    <input
      ref={inputRef}
      autoFocus
      spellCheck={false}
      autoComplete="off"
      disabled={disabled}
      placeholder={placeholder}
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
  );
});
