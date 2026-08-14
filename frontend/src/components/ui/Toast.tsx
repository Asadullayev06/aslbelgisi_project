import * as React from "react";
import { CheckCircle2, AlertTriangle, XCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FlashLevel } from "@/types";

export interface Flash {
  id: number;
  level: FlashLevel;
  message: string;
}

const ICONS: Record<FlashLevel, React.ReactNode> = {
  hit:  <CheckCircle2 className="size-4" />,
  err:  <XCircle      className="size-4" />,
  warn: <AlertTriangle className="size-4" />,
};

const TONE: Record<FlashLevel, string> = {
  hit:  "border-success/50 bg-success/10 text-success",
  err:  "border-danger/50  bg-danger/10  text-danger",
  warn: "border-warning/50 bg-warning/10 text-warning",
};

export function Toaster({ flashes, onDismiss }: {
  flashes: Flash[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {flashes.map(f => (
        <div key={f.id}
             className={cn(
               "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg backdrop-blur",
               TONE[f.level],
             )}>
          <span className="mt-0.5">{ICONS[f.level]}</span>
          <div className="flex-1 font-mono text-[13px] leading-snug break-all">{f.message}</div>
          <button onClick={() => onDismiss(f.id)} className="opacity-60 hover:opacity-100">
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function useFlashes(autoDismissMs = 3500) {
  const [flashes, setFlashes] = React.useState<Flash[]>([]);
  const push = React.useCallback((level: FlashLevel, message: string) => {
    const id = Date.now() + Math.random();
    setFlashes(f => [...f.slice(-4), { id, level, message }]);
    if (autoDismissMs > 0 && level !== "err") {
      setTimeout(() => setFlashes(f => f.filter(x => x.id !== id)), autoDismissMs);
    }
  }, [autoDismissMs]);
  const dismiss = React.useCallback(
    (id: number) => setFlashes(f => f.filter(x => x.id !== id)),
    [],
  );
  return { flashes, push, dismiss };
}
