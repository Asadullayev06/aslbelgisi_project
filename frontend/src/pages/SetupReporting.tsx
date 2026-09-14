import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Play, Layers } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHead } from "@/components/ui/Card";
import { Field, Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Toaster, useFlashes } from "@/components/ui/Toast";
import { api } from "@/api";
import type { ProjectSummary } from "@/types";

interface Props {
  onCreated: (projectId: number) => void;
  onCancel: () => void;
  presetName?: string;
  presetProduct?: string;
  pickFromExisting?: boolean;
}

/** Create one reporting series (= one project). No mode, no codes upfront —
 *  the scan page is where codes come in. Grouped by (name, product) like
 *  aggregation and inventory. */
export function SetupReporting({ onCreated, onCancel, presetName, presetProduct, pickFromExisting }: Props) {
  const isAdditional = !!(presetName || presetProduct);
  const [name, setName]               = useState(presetName || "");
  const [productName, setProductName] = useState(presetProduct || "");
  const [seriesName, setSeriesName]   = useState("");
  const [busy, setBusy]               = useState(false);
  const { flashes, push, dismiss }    = useFlashes();

  const [existing, setExisting] = useState<
    { name: string; product_name: string; series: string[] }[] | null>(null);
  const [pickedKey, setPickedKey] = useState("");

  useEffect(() => {
    if (!pickFromExisting || isAdditional) return;
    let cancelled = false;
    api.listProjects({ mode: "reporting" }).then((rows: ProjectSummary[]) => {
      if (cancelled) return;
      const groups = new Map<string, { name: string; product_name: string; series: string[] }>();
      for (const p of rows) {
        const key = `${p.name}::${p.product_name}`;
        let g = groups.get(key);
        if (!g) { g = { name: p.name, product_name: p.product_name, series: [] }; groups.set(key, g); }
        if (p.series) g.series.push(p.series);
      }
      setExisting(Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name)));
    }).catch(() => setExisting([]));
    return () => { cancelled = true; };
  }, [pickFromExisting, isAdditional]);

  const pickedGroup = useMemo(() => {
    if (!pickFromExisting || !pickedKey || !existing) return null;
    return existing.find(g => `${g.name}::${g.product_name}` === pickedKey) || null;
  }, [existing, pickedKey, pickFromExisting]);
  const seriesClash = !!(pickedGroup && seriesName.trim()
                         && pickedGroup.series.includes(seriesName.trim()));

  function onPickExisting(key: string) {
    setPickedKey(key);
    const g = existing?.find(x => `${x.name}::${x.product_name}` === key);
    if (g) { setName(g.name); setProductName(g.product_name); }
    else   { setName(""); setProductName(""); }
  }
  const dropdownLocked = pickFromExisting && !!pickedKey;

  async function submit() {
    if (pickFromExisting && !pickedKey) {
      push("err", "Mavjud mahsulotni tanlang yoki 'Yangi hisobot' bosing"); return;
    }
    if (!name.trim() || !productName.trim()) {
      push("err", "Loyiha nomi va mahsulot nomi to'ldirilishi kerak"); return;
    }
    if (!seriesName.trim()) { push("err", "Seriya nomi kiriting"); return; }
    if (seriesClash) { push("err", `Bu mahsulotda '${seriesName.trim()}' seriyasi allaqachon mavjud`); return; }
    setBusy(true);
    try {
      const p = await api.reportingCreate({
        name: name.trim(), product_name: productName.trim(),
        series_name: seriesName.trim(),
      });
      onCreated(p.id);
    } catch (e: any) {
      push("err", String(e.message || e));
    } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Toaster flashes={flashes} onDismiss={dismiss} />

      <div className="mb-6 flex items-center justify-between gap-4">
        <button onClick={onCancel} className="text-muted hover:text-text inline-flex items-center gap-1">
          <ArrowLeft className="size-4" /> Ortga
        </button>
        <div className="text-right">
          <div className="text-3xl font-extrabold tracking-tight text-accent">
            {isAdditional || pickFromExisting ? "Yangi seriya" : "Yangi hisobot"}
          </div>
          <div className="text-muted text-sm">
            {isAdditional
              ? <>Mahsulot: <b className="text-text">{presetName}</b> — yangi seriyani sozlang</>
              : pickFromExisting
                ? (dropdownLocked
                    ? <>Mahsulot: <b className="text-text">{name}</b> — yangi seriyani sozlang</>
                    : "Mavjud mahsulotni tanlang, so'ng yangi seriyani sozlang")
                : "Mahsulot va seriya nomini kiriting"}
          </div>
        </div>
      </div>

      <Card className="mb-4">
        <CardHead title="Loyiha ma'lumotlari"
                  right={<Badge tone="accent"><Layers className="size-3" /> Hisobot</Badge>} />

        {pickFromExisting && !isAdditional ? (
          <div className="grid grid-cols-1 gap-4">
            <Field label="Mavjud mahsulotni tanlang *"
                   hint="Xato yozib qo'yish oldini olish uchun ro'yxatdan tanlang">
              <select value={pickedKey} onChange={e => onPickExisting(e.target.value)}
                      className="h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm
                                 focus:border-accent focus:ring-2 focus:ring-accent/30 outline-none">
                <option value="">— tanlang —</option>
                {existing === null && <option disabled>Yuklanmoqda…</option>}
                {existing && existing.length === 0 && <option disabled>Hali mahsulot yo'q</option>}
                {existing?.map(g => (
                  <option key={`${g.name}::${g.product_name}`} value={`${g.name}::${g.product_name}`}>
                    {g.name} — {g.product_name} ({g.series.length} seriya)
                  </option>
                ))}
              </select>
            </Field>
            {dropdownLocked && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Loyiha nomi (mahsulotdan olindi)"><Input value={name} disabled /></Field>
                <Field label="Mahsulot nomi (mahsulotdan olindi)"><Input value={productName} disabled /></Field>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label={isAdditional ? "Loyiha nomi (mahsulotdan olindi)" : "Loyiha nomi"}>
              <Input value={name} onChange={e => setName(e.target.value)}
                     placeholder="masalan: 2026-Q3 hisobot" disabled={isAdditional} />
            </Field>
            <Field label={isAdditional ? "Mahsulot nomi (mahsulotdan olindi)" : "Mahsulot nomi"}>
              <Input value={productName} onChange={e => setProductName(e.target.value)}
                     placeholder="masalan: Salbukort 250mg" disabled={isAdditional} />
            </Field>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <Field label="Seriya (batch) *"
                 hint={seriesClash ? "Bu seriya bu mahsulotda allaqachon mavjud" : "ishlab chiqarish partiyasi"}>
            <Input value={seriesName} onChange={e => setSeriesName(e.target.value)}
                   placeholder="masalan: L2026-05-A"
                   className={seriesClash ? "border-danger focus:border-danger focus:ring-danger/30" : ""} />
          </Field>
        </div>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Bekor</Button>
        <Button variant="primary" size="lg" onClick={submit} disabled={busy}>
          <Play className="size-4" /> {busy ? "Yaratilmoqda…" : "Ishni boshlash"}
        </Button>
      </div>
    </div>
  );
}
