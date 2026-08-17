import { useMemo, useState, useRef } from "react";
import { ArrowLeft, Play, Upload, Sparkles, PackageOpen, PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHead } from "@/components/ui/Card";
import { Field, Input, Textarea } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Toaster, useFlashes } from "@/components/ui/Toast";
import { api } from "@/api";

interface Props {
  onCreated: (projectId: number) => void;
  onCancel: () => void;
}

export function Setup({ onCreated, onCancel }: Props) {
  const [name, setName]                     = useState("");
  const [productName, setProductName]       = useState("");
  const [totalBoxes, setTotalBoxes]         = useState<number>(42);
  const [perBox, setPerBox]                 = useState<number>(240);
  const [hasLoose, setHasLoose]             = useState<boolean>(true);
  const [looseQty, setLooseQty]             = useState<number>(160);
  const [series, setSeries]                 = useState("");
  const [kmText, setKmText]                 = useState("");
  const [boxText, setBoxText]               = useState("");
  const [busy, setBusy]                     = useState(false);
  const { flashes, push, dismiss }          = useFlashes();

  const kmFileRef  = useRef<HTMLInputElement>(null);
  const boxFileRef = useRef<HTMLInputElement>(null);

  const fullBoxes  = Math.max(0, totalBoxes - (hasLoose ? 1 : 0));
  const plannedKm  = fullBoxes * perBox + (hasLoose ? looseQty : 0);

  const kmLoaded   = useMemo(
    () => kmText.split(/\r?\n/).filter(l => l.trim().length >= 20).length,
    [kmText],
  );
  const boxLoaded  = useMemo(
    () => boxText.split(/\r?\n/).filter(l => l.trim().length >= 18).length,
    [boxText],
  );

  async function mergeFile(kind: "km" | "box", file: File) {
    try {
      const res = await api.parseFile(kind, file);
      if (kind === "km") {
        const existing = new Set(kmText.split(/\r?\n/).map(x => x.trim()).filter(Boolean));
        const merged = [...existing];
        for (const c of res.codes) if (!existing.has(c)) merged.push(c);
        setKmText(merged.join("\n"));
        push("hit", `${res.count} KM fayldan qo'shildi (${res.warnings.length} ogohlantirish)`);
      } else {
        const existing = new Set(boxText.split(/\r?\n/).map(x => x.trim()).filter(Boolean));
        const merged = [...existing];
        for (const c of res.codes) if (!existing.has(c)) merged.push(c);
        setBoxText(merged.join("\n"));
        push("hit", `${res.count} SSCC fayldan qo'shildi (${res.warnings.length} ogohlantirish)`);
      }
    } catch (e: any) {
      push("err", String(e.message || e));
    }
  }

  async function submit() {
    if (!name.trim() || !productName.trim()) {
      push("err", "Loyiha nomi va mahsulot to'ldirilishi kerak");
      return;
    }
    if (!series.trim()) {
      push("err", "Seriya (batch) kiritilishi shart");
      return;
    }
    setBusy(true);
    try {
      const state = await api.createProject({
        name, product_name: productName,
        total_boxes: totalBoxes, per_box: perBox,
        has_loose: hasLoose, loose_qty: hasLoose ? looseQty : 0,
        series: series.trim(),
        km_codes_text: kmText, box_codes_text: boxText,
      });
      onCreated(state.project.id);
    } catch (e: any) {
      push("err", String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <Toaster flashes={flashes} onDismiss={dismiss} />

      <div className="mb-6 flex items-center justify-between gap-4">
        <button onClick={onCancel} className="text-muted hover:text-text inline-flex items-center gap-1">
          <ArrowLeft className="size-4" /> Ortga
        </button>
        <div className="text-right">
          <div className="text-3xl font-extrabold tracking-tight text-accent">Yangi loyiha</div>
          <div className="text-muted text-sm">Sozlash — barcha ma'lumotlarni bir marta kiriting</div>
        </div>
      </div>

      <Card className="mb-4">
        <CardHead title="Loyiha ma'lumotlari" right={<Badge tone="warning"><Sparkles className="size-3" /> Sozlash</Badge>} />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Loyiha nomi">
            <Input value={name} onChange={e => setName(e.target.value)}
                   placeholder="masalan: Salbucort 2026-Q3" />
          </Field>
          <Field label="Mahsulot nomi">
            <Input value={productName} onChange={e => setProductName(e.target.value)}
                   placeholder="masalan: Salbucort 250mg" />
          </Field>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <Field label="Seriya (batch) *"
                 hint="ishlab chiqarish partiyasi — Kod Qidiruv sahifasida ko'rinadi">
            <Input value={series} onChange={e => setSeries(e.target.value)}
                   placeholder="masalan: L2026-05-A" />
          </Field>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <Field label="Umumiy qutilar soni (loose bilan birga)"
                 hint="masalan 42 — shundan 41 to'liq + 1 loose">
            <Input type="number" min={1} value={totalBoxes}
                   onChange={e => setTotalBoxes(+e.target.value || 0)} />
          </Field>
          <Field label="Karobkadagi dona soni (to'liq quti)">
            <Input type="number" min={1} value={perBox}
                   onChange={e => setPerBox(+e.target.value || 0)} />
          </Field>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 items-end">
          <label className="flex items-center gap-3 h-11">
            <input type="checkbox" className="size-4 accent-[hsl(var(--accent))]"
                   checked={hasLoose} onChange={e => setHasLoose(e.target.checked)} />
            <span className="text-sm">Loose pack bor (oxirgi quti kam to'ldirilgan)</span>
          </label>
          {hasLoose && (
            <Field label="Loose paketdagi dona soni">
              <Input type="number" min={1} value={looseQty}
                     onChange={e => setLooseQty(+e.target.value || 0)} />
            </Field>
          )}
        </div>

        <div className="mt-3 text-xs text-muted">
          MOD (businessPlaceId), productionOrderId, INN va API kalit — ish
          tugagach, ASL Belgisi ga yuborish oynasida so'raladi.
        </div>

        <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-3">
          <Stat label="Umumiy qutilar" value={totalBoxes} tone="text" />
          <Stat label="To'liq qutilar" value={fullBoxes}  tone="text" />
          <Stat label="Har birida"      value={perBox}     tone="text" />
          <Stat label="Loose paket"     value={hasLoose ? `bor · ${looseQty}` : "yo'q"} tone="text" />
          <Stat label={`Jami reja (${fullBoxes}×${perBox}${hasLoose ? ` + ${looseQty}` : ""})`}
                value={plannedKm} tone="accent" />
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHead
            title="KM kodlar ro'yxati"
            right={
              <>
                <Badge tone={kmLoaded >= plannedKm ? "success" : kmLoaded ? "warning" : "neutral"}>
                  {kmLoaded} / {plannedKm}
                </Badge>
                <Button variant="outline" size="sm"
                        onClick={() => kmFileRef.current?.click()}>
                  <Upload className="size-3" /> Fayl
                </Button>
                <input type="file" hidden ref={kmFileRef}
                       accept=".csv,.tsv,.txt,.xlsx,.xlsm,.xls"
                       onChange={e => {
                         const f = e.target.files?.[0];
                         if (f) mergeFile("km", f);
                         e.currentTarget.value = "";
                       }} />
              </>
            }
          />
          <Textarea rows={10} value={kmText} onChange={e => setKmText(e.target.value)}
                    placeholder="Har bir qatorga bitta KM kod. Skaner bilan ham kiritsa bo'ladi." />
        </Card>

        <Card>
          <CardHead
            title="Quti (SSCC) kodlari"
            right={
              <>
                <Badge tone={boxLoaded >= totalBoxes ? "success" : boxLoaded ? "warning" : "neutral"}>
                  {boxLoaded} / {totalBoxes}
                </Badge>
                <Button variant="outline" size="sm"
                        onClick={() => boxFileRef.current?.click()}>
                  <Upload className="size-3" /> Fayl
                </Button>
                <input type="file" hidden ref={boxFileRef}
                       accept=".csv,.tsv,.txt,.xlsx,.xlsm,.xls"
                       onChange={e => {
                         const f = e.target.files?.[0];
                         if (f) mergeFile("box", f);
                         e.currentTarget.value = "";
                       }} />
              </>
            }
          />
          <Textarea rows={10} value={boxText} onChange={e => setBoxText(e.target.value)}
                    placeholder="Har bir qatorga bitta SSCC (18 raqam yoki 00 bilan boshlangan 20)." />
        </Card>
      </div>

      <div className="mt-6 flex items-center justify-between gap-3">
        <div className="text-sm text-muted flex items-center gap-3">
          <PackageOpen className="size-4" /> {totalBoxes} quti
          <PackageCheck className="size-4 ml-3" /> {plannedKm} KM rejalashtirilgan
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Bekor</Button>
          <Button variant="primary" size="lg" onClick={submit} disabled={busy}>
            <Play className="size-4" /> {busy ? "Yaratilmoqda…" : "Ishni boshlash"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone: "text" | "accent" }) {
  return (
    <div className="rounded-lg border border-border bg-surface2/40 p-3">
      <div className={"text-lg font-bold " + (tone === "accent" ? "text-accent" : "text-text")}>
        {value}
      </div>
      <div className="text-[11px] uppercase tracking-wide text-muted mt-0.5">{label}</div>
    </div>
  );
}
