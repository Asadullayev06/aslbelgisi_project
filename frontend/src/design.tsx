import { createContext, useCallback, useContext, useEffect, useState } from "react";

/** Two UI shells the user can switch between:
 *  - "classic" — the original tile-picker home + floating user chip.
 *  - "sidebar" — the new left-nav workspace shell.
 *  Persisted per browser so a choice sticks across sessions. */
export type DesignVariant = "classic" | "sidebar";

const STORAGE_KEY = "mav2.design";

interface DesignCtx {
  variant: DesignVariant;
  setVariant: (v: DesignVariant) => void;
}

const DesignContext = createContext<DesignCtx | null>(null);

function readInitial(): DesignVariant {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "classic" || v === "sidebar") return v;
  } catch { /* ignore */ }
  return "sidebar";   // present the new design by default
}

export function DesignProvider({ children }: { children: React.ReactNode }) {
  const [variant, setVariantState] = useState<DesignVariant>(readInitial);

  const setVariant = useCallback((v: DesignVariant) => {
    setVariantState(v);
    try { localStorage.setItem(STORAGE_KEY, v); } catch { /* ignore */ }
  }, []);

  // Tag the root so CSS could branch on the variant if ever needed.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-design", variant);
  }, [variant]);

  return (
    <DesignContext.Provider value={{ variant, setVariant }}>
      {children}
    </DesignContext.Provider>
  );
}

export function useDesign(): DesignCtx {
  const v = useContext(DesignContext);
  if (!v) throw new Error("DesignProvider missing");
  return v;
}

/** The Klassik | Yangi segmented switch used in both shells' top bars. */
export function DesignSwitch({ compact = false }: { compact?: boolean }) {
  const { variant, setVariant } = useDesign();
  const pad = compact ? "px-2.5 py-1 text-[11px]" : "px-3.5 py-1.5 text-xs";
  return (
    <div className="inline-flex items-center rounded-[10px] border border-border bg-surface2 p-[3px]"
         role="group" aria-label="Dizayn tanlash">
      <button
        onClick={() => setVariant("classic")}
        aria-pressed={variant === "classic"}
        className={
          "rounded-[7px] font-semibold transition-colors " + pad + " " +
          (variant === "classic"
            ? "bg-accent text-[hsl(var(--accent-fg))]"
            : "text-muted hover:text-text")
        }
      >
        Klassik
      </button>
      <button
        onClick={() => setVariant("sidebar")}
        aria-pressed={variant === "sidebar"}
        className={
          "rounded-[7px] font-semibold transition-colors " + pad + " " +
          (variant === "sidebar"
            ? "bg-accent text-[hsl(var(--accent-fg))]"
            : "text-muted hover:text-text")
        }
      >
        Yangi
      </button>
    </div>
  );
}
