import { useEffect, useMemo, useState, useRef } from "react";
import {
  ArrowLeft, Play, Upload, ClipboardList, ShieldCheck, PackageCheck,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHead } from "@/components/ui/Card";
import { Field, Input, Textarea } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Toaster, useFlashes } from "@/components/ui/Toast";
import { api } from "@/api";
import type { ProjectSummary } from "@/types";

interface Props {
  onCreated: (projectId: number) => void;
  onCancel: () => void;
  /** Locked name+product when adding a series to an existing product. */
  presetName?: string;
  presetProduct?: string;
  /** Pick the existing (name, product) from a dropdown instead of typing. */
  pickFromExisting?: boolean;
}

type Mode = "manual" | "asl";

/** Create ONE inventory series (= one project), grouped by product like
 *  aggregation. Each series chooses its own mode: manual manifest or ASL
 *  ownership check. */
export function SetupInventory({ onCreated, onCancel, presetName, presetProduct, pickFromExisting }: Props) {
  const isAdditional = !!(presetName || presetProduct);
  const [name, setName]             = useState(presetName || "");
  const [productName, setProductName] = useState(presetProduct || "");
  const [seriesName, setSeriesName] = useState("");
  const [mode, setMode]             = useState<Mode>("manual");
  const [codes, setCodes]           = useState("");
  const [aslInn, setAslInn]         = useState("");
  const [aslKey, setAslKey]         = useState("");
  const [busy, setBusy]             = useState(false);
  const { flashes, push, dismiss }  = useFlashes();
  const fileRef = useRef<HTMLInputElement>(null);

  // Dropdown mode: existing (name, product) pairs + the series each already has.
  const [existing, setExisting] = useState<
    { name: string; product_name: string; series: string[] }[] | null>(null);
  const [pickedKey, setPickedKey] = useState("");

  useEffect(() => {
    if (!pickFromExisting || isAdditional) return;
    let cancelled = false;
    api.listProjects({ mode: "inventory" }).then((rows: ProjectSummary[]) => {
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

  const codeCount = useMemo(
    () => codes.split(/\r?\n/).filter(l => l.trim().length >= 20).length, [codes]);

  async function loadFile(file: File) {
    try {
      const res = await api.parseFile("km", file);
      setCodes(prev => (prev ? prev + "\n" : "") + res.codes.join("\n"));
      push("hit", `${res.count} KM fayldan qo'shildi`);
    } catch (e: any) { push("err", String(e.message || e)); }
  }

  async function submit() {
    if (pickFromExisting && !pickedKey) {
      push("err", "Mavjud mahsulotni tanlang yoki 'Yangi inventarizatsiya' bosing"); return;
    }
    if (!name.trim() || !productName.trim()) {
      push("err", "Loyiha nomi va mahsulot nomi to'ldirilishi kerak"); return;
    }
    if (!seriesName.trim()) { push("err", "Seriya nomi kiriting"); return; }
    if (seriesClash) { push("err", `Bu mahsulotda '${seriesName.trim()}' seriyasi allaqachon mavjud`); return; }
    if (mode === "manual" && codeCount === 0) {
      push("err", "Qo'lda rejimda KM ro'yxati kerak"); return;
    }
    if (mode === "asl" && (!aslInn.trim() || !aslKey.trim())) {
      push("err", "ASL rejimida INN va API kalit kerak"); return;
    }
    setBusy(true);
    try {
      const state = await api.createInventoryProject({
        name: name.trim(),
        product_name: productName.trim(),
        series_name: seriesName.trim(),
        km_codes_text: mode === "manual" ? codes : "",
        asl_check_enabled: mode === "asl",
        asl_check_inn: mode === "asl" ? aslInn.trim() : "",
        asl_check_api_key: mode === "asl" ? aslKey.trim() : "",
      });
      onCreated(state.project.id);
    } catch (e: any) {
      push("err", String(e.message || e));
    } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <Toaster flashes={flashes} onDismiss={dismiss} />

      <div className="mb-6 flex items-center justify-between gap-4">
        <button onClick={onCancel} className="text-muted hover:text-text inline-flex items-center gap-1">
          <ArrowLeft className="size-4" /> Ortga
        </button>
        <div className="text-right">
          <div className="text-3xl font-extrabold tracking-tight text-warning">
            {isAdditional || pickFromExisting ? "Yangi seriya" : "Yangi inventarizatsiya"}
          </div>
          <div className="text-muted text-sm">
            {isAdditional
              ? <>Mahsulot: <b className="text-text">{presetName}</b> — yangi seriyani sozlang</>
              : pickFromExisting
                ? (dropdownLocked
                    ? <>Mahsulot: <b className="text-text">{name}</b> — yangi seriyani sozlang</>
                    : "Mavjud mahsulotni tanlang, so'ng yangi seriyani sozlang")
                : "Bitta seriya — mahsulot va seriya nomi"}
          </div>
        </div>
      </div>

      <Card className="mb-4">
        <CardHead title="Loyiha ma'lumotlari"
                  right={<Badge tone="warning"><ClipboardList className="size-3" /> Inventarizatsiya</Badge>} />

        {pickFromExisting && !isAdditional ? (
          <div className="grid grid-cols-1 gap-4">
            <Field label="Mavjud mahsulotni tanlang *"
                   hint="Xato yozib qo'yish oldini olish uchun ro'yxatdan tanlang">
              <select value={pickedKey} onChange={e => onPickExisting(e.target.value)}
                      className="h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm
                                 focus:border-warning focus:ring-2 focus:ring-warning/30 outline-none">
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
                     placeholder="masalan: 2026-Q3 inventar" disabled={isAdditional} />
            </Field>
            <Field label={isAdditional ? "Mahsulot nomi (mahsulotdan olindi)" : "Mahsulot nomi"}>
              <Input value={productName} onChange={e => setProductName(e.target.value)}
                     placeholder="masalan: Colhitina 500mg" disabled={isAdditional} />
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

      {/* Per-series mode: manual manifest vs ASL ownership check */}
      <Card className="mb-4">
        <CardHead title="Seriya usuli"
                  right={<Badge tone={mode === "asl" ? "accent" : "warning"}>
                    <ShieldCheck className="size-3" /> {mode === "asl" ? "ASL" : "Qo'lda"}
                  </Badge>} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <button type="button" onClick={() => setMode("manual")}
                  className={"text-left rounded-xl border p-3 transition-colors " +
                    (mode === "manual" ? "border-warning bg-warning/10" : "border-border bg-surface2/40 hover:border-warning/50")}>
            <div className="flex items-center gap-2 mb-1">
              <div className={"size-4 rounded-full border-2 " + (mode === "manual" ? "border-warning bg-warning" : "border-border")} />
              <div className="font-semibold text-sm">Qo'lda kod yuklash</div>
            </div>
            <div className="text-xs text-muted leading-snug">
              KM ro'yxatini yuklang · skanerlangan kod ro'yxatga solishtiriladi
            </div>
          </button>
          <button type="button" onClick={() => setMode("asl")}
                  className={"text-left rounded-xl border p-3 transition-colors " +
                    (mode === "asl" ? "border-accent bg-accent/10" : "border-border bg-surface2/40 hover:border-accent/50")}>
            <div className="flex items-center gap-2 mb-1">
              <div className={"size-4 rounded-full border-2 " + (mode === "asl" ? "border-accent bg-accent" : "border-border")} />
              <div className="font-semibold text-sm">ASL egalik tekshiruvi</div>
            </div>
            <div className="text-xs text-muted leading-snug">
              Ro'yxat kerak emas · har bir kod ASL orqali INN ga tegishliligi tekshiriladi
            </div>
          </button>
        </div>

        {mode === "manual" ? (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-1">
              <div className="text-sm">KM kodlar <span className="text-muted">({codeCount})</span></div>
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                <Upload className="size-3" /> Fayl
              </Button>
              <input type="file" hidden ref={fileRef} accept=".csv,.tsv,.txt,.xlsx,.xlsm,.xls"
                     onChange={e => { const f = e.target.files?.[0]; if (f) loadFile(f); e.currentTarget.value = ""; }} />
            </div>
            <Textarea rows={7} value={codes} onChange={e => setCodes(e.target.value)}
                      placeholder="Har bir qatorga bitta KM kod." />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <Field label="INN">
              <Input value={aslInn} onChange={e => setAslInn(e.target.value)} placeholder="masalan: 307173509" />
            </Field>
            <Field label="ASL API kalit">
              <Input value={aslKey} onChange={e => setAslKey(e.target.value)} placeholder="Business User API key" />
            </Field>
          </div>
        )}
      </Card>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-muted flex items-center gap-3">
          {mode === "manual"
            ? <><PackageCheck className="size-4" /> {codeCount} ta KM yuklandi</>
            : <><ShieldCheck className="size-4" /> ASL egalik tekshiruvi</>}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Bekor</Button>
          <Button variant="warning" size="lg" onClick={submit} disabled={busy}>
            <Play className="size-4" /> {busy ? "Yaratilmoqda…" : "Ishni boshlash"}
          </Button>
        </div>
      </div>
    </div>
  );
}
