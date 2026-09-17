import { useState } from "react";
import {
  Package, ClipboardList, Layers, Boxes, ScanBarcode, ScanLine, Search,
  Barcode, Printer, Settings, LogOut, Sun, Moon, LayoutDashboard, Shield, HardHat,
} from "lucide-react";
import { useAuth, isAdmin } from "@/auth";
import { DesignSwitch } from "@/design";
import { cn } from "@/lib/utils";

export type NavDest =
  | "home" | "aggregation" | "inventory" | "reporting" | "boxcheck"
  | "stock" | "inspector" | "custom" | "search" | "sscc" | "bartender" | "admin";

interface Props {
  activeKey: NavDest | null;
  title: React.ReactNode;
  onNavigate: (dest: NavDest) => void;
  children: React.ReactNode;
}

interface NavItem { key: NavDest; label: string; icon: React.ReactNode; adminOnly?: boolean; }

const MAIN: NavItem[] = [
  { key: "aggregation", label: "Agregatsiya",     icon: <Package className="size-[18px]" /> },
  { key: "inventory",   label: "Inventarizatsiya", icon: <ClipboardList className="size-[18px]" /> },
  { key: "reporting",   label: "Hisobot",          icon: <Layers className="size-[18px]" /> },
  { key: "boxcheck",    label: "Quti tekshiruvi",  icon: <Boxes className="size-[18px]" /> },
];
const TOOLS: NavItem[] = [
  { key: "stock",     label: "GTIN Ostatok",        icon: <Barcode className="size-[18px]" /> },
  { key: "inspector", label: "Marka Kod Tekshiruvi", icon: <ScanLine className="size-[18px]" /> },
  { key: "custom",    label: "Custom Aggregation",   icon: <Layers className="size-[18px]" /> },
  { key: "search",    label: "Kod Qidiruv",          icon: <Search className="size-[18px]" /> },
  { key: "sscc",      label: "SSCC",                 icon: <ScanBarcode className="size-[18px]" /> },
  { key: "bartender", label: "BarTender CSV",        icon: <Printer className="size-[18px]" /> },
];
const SYSTEM: NavItem[] = [
  { key: "admin", label: "Admin sozlamalari", icon: <Settings className="size-[18px]" />, adminOnly: true },
];

function useThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    (typeof document !== "undefined" && document.documentElement.classList.contains("light"))
      ? "light" : "dark");
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    const root = document.documentElement;
    root.classList.remove("dark", "light");
    root.classList.add(next);
    try { localStorage.setItem("mav2.theme", next); } catch { /* ignore */ }
    setTheme(next);
  };
  return { theme, toggle };
}

export function AppShell({ activeKey, title, onNavigate, children }: Props) {
  const { user, logout } = useAuth();
  const admin = isAdmin(user);
  const { theme, toggle } = useThemeToggle();

  const renderSection = (label: string, items: NavItem[]) => {
    const visible = items.filter(i => !i.adminOnly || admin);
    if (visible.length === 0) return null;
    return (
      <div className="flex flex-col gap-1">
        <div className="px-3 pt-4 pb-1 text-[10.5px] font-bold tracking-[1px] text-muted/70">
          {label}
        </div>
        {visible.map(item => {
          const active = item.key === activeKey;
          return (
            <button
              key={item.key}
              onClick={() => onNavigate(item.key)}
              className={cn(
                "flex items-center gap-3 rounded-[9px] px-3 py-2.5 text-left text-sm transition-colors",
                active
                  ? "bg-accent/12 font-semibold text-accent"
                  : "text-text/80 hover:bg-surface2",
              )}
            >
              {item.icon}
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-bg text-text">
      {/* ── SIDEBAR ── */}
      <aside className="flex h-full w-[264px] shrink-0 flex-col border-r border-border bg-surface">
        {/* brand */}
        <button onClick={() => onNavigate("home")}
                className="flex h-[76px] items-center gap-3 border-b border-border px-5 text-left">
          <div className="relative grid size-[38px] place-items-center rounded-[11px] bg-accent text-[hsl(var(--accent-fg))]">
            <Package className="size-[21px]" />
            <span className="absolute -right-1 -top-1 size-[11px] rounded-full border-2 border-surface bg-brand2" />
          </div>
          <div>
            <div className="text-[15px] font-extrabold tracking-tight">Asl Belgisi</div>
            <div className="text-[11px] text-muted">Ish maydoni</div>
          </div>
        </button>

        {/* nav */}
        <nav className="flex flex-1 flex-col gap-1 overflow-auto px-3 py-3">
          <button
            onClick={() => onNavigate("home")}
            className={cn(
              "flex items-center gap-3 rounded-[9px] px-3 py-2.5 text-left text-sm transition-colors",
              activeKey === "home"
                ? "bg-accent/12 font-semibold text-accent"
                : "text-text/80 hover:bg-surface2",
            )}
          >
            <LayoutDashboard className="size-[18px]" />
            <span>Boshqaruv paneli</span>
          </button>
          {renderSection("ASOSIY", MAIN)}
          {renderSection("VOSITALAR", TOOLS)}
          {renderSection("TIZIM", SYSTEM)}
        </nav>

        {/* user */}
        <div className="flex items-center gap-2.5 border-t border-border p-3">
          <div className="grid size-[34px] place-items-center rounded-[10px] bg-accent font-bold text-[hsl(var(--accent-fg))]">
            {(user?.username || "?").slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold">{user?.username}</div>
            <div className="flex items-center gap-1 text-[11px] font-semibold text-accent">
              {admin ? <Shield className="size-3" /> : <HardHat className="size-3 text-warning" />}
              <span className={admin ? "" : "text-warning"}>{admin ? "Administrator" : "Operator"}</span>
            </div>
          </div>
          <button onClick={logout} title="Chiqish" aria-label="Chiqish"
                  className="rounded-lg p-1.5 text-muted hover:bg-danger/10 hover:text-danger">
            <LogOut className="size-[18px]" />
          </button>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="h-[3px] shrink-0 bg-gradient-to-r from-accent via-accent to-brand2" />
        <header className="flex h-[63px] shrink-0 items-center gap-4 border-b border-border bg-surface px-6">
          <div className="min-w-0 flex-1 truncate text-[16px] font-bold tracking-tight">{title}</div>
          <DesignSwitch />
          <button onClick={toggle}
                  title={theme === "dark" ? "Yorug' rejim" : "Qorong'u rejim"}
                  aria-label="Rejimni almashtirish"
                  className="grid size-[38px] place-items-center rounded-[10px] border border-border bg-surface2 text-muted hover:text-accent">
            {theme === "dark" ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
          </button>
        </header>

        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
