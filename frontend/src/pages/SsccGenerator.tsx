import { useMemo, useState } from "react";
import {
  ArrowLeft, Download, Barcode, Sparkles, CheckCircle2, Info,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHead } from "@/components/ui/Card";
import { Field, Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Toaster, useFlashes } from "@/components/ui/Toast";
import { api } from "@/api";
import { cn } from "@/lib/utils";

interface Props { onExit: () => void; }

const MAX_BOXES = 999;

export function SsccGenerator({ onExit }: Props) {
  const [productName, setProductName] = useState("");
  const [companyInn, setCompanyInn]   = useState("");
  const [lotSeries, setLotSeries]     = useState("");
  const [numBoxes, setNumBoxes]       = useState<number>(100);

  const [previewing, setPreviewing]   = useState(false);
  const [downloading20, setDl20]      = useState(false);
  const [downloading7, setDl7]        = useState(false);
  const [preview, setPreview]         =
    useState<{ codes_20: string[]; codes_7: string[]; count: number } | null>(null);

  const { flashes, push, dismiss }    = useFlashes();

  const innInvalid = companyInn.length > 0 && (companyInn.length !== 9 || !/^\d+$/.test(companyInn));
  const lotDigitCount = useMemo(
    () => (lotSeries.match(/\d/g) || []).length,
    [lotSeries],
  );
  const canSubmit =
    productName.trim().length > 0 &&
    companyInn.length === 9 && /^\d{9}$/.test(companyInn) &&
    lotDigitCount >= 2 &&
    numBoxes > 0 && numBoxes <= MAX_BOXES;

  function body() {
    return {
      product_name: productName.trim(),
      company_inn:  companyInn.trim(),
      lot_series:   lotSeries.trim(),
      num_boxes:    numBoxes,
    };
  }

  async function doPreview() {
    if (!canSubmit) { push("err", "Formalarni to'g'ri to'ldiring"); return; }
    setPreviewing(true);
    try {
      const p = await api.ssccPreview(body());
      setPreview(p);
      push("hit", `${p.count} ta kod tayyor`);
    } catch (e: any) { push("err", String(e.message || e)); }
    setPreviewing(false);
  }

  async function download(kind: "20" | "7") {
    if (!canSubmit) { push("err", "Formalarni to'g'ri to'ldiring"); return; }
    const setBusy = kind === "20" ? setDl20 : setDl7;
    setBusy(true);
    try {
      const blob = kind === "20"
        ? await api.ssccXlsx20(body())
        : await api.ssccXlsx7(body());
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ts = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const safe = productName.trim().replace(/[^A-Za-z0-9._-]+/g, "_") || "SSCC";
      a.download = `SSCC_${kind}digit_${safe}_${ts}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      push("hit", `Excel (${kind}-digit) yuklab olindi`);
    } catch (e: any) { push("err", String(e.message || e)); }
    setBusy(false);
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <Toaster flashes={flashes} onDismiss={dismiss} />

      <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <button onClick={onExit}
                className="text-muted hover:text-text inline-flex items-center gap-1">
          <ArrowLeft className="size-4" /> Bosh sahifa
        </button>
        <div className="text-right">
          <div className="text-3xl font-extrabold tracking-tight text-accent">
            SSCC generator
          </div>
          <div className="text-muted text-sm">
            20 raqamli ichki quti kodlari · GS1 Mod-10 tekshiruv raqami bilan
          </div>
        </div>
      </div>

      <Card className="mb-4">
        <CardHead
          title="Kod ma'lumotlari"
          right={<Badge tone="accent"><Barcode className="size-3" /> internal box labeling</Badge>}
        />

        <div className="text-sm text-muted mb-4">
          Quyidagi formani to'ldiring — tizim <b className="text-text">000</b> +
          INN(9) + LOT ning oxirgi 2 raqami + bugungi kun(2) + tartib(3) + GS1 Mod-10
          tekshiruv raqami(1) formatida 20 raqamli kodlar hosil qiladi.
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Mahsulot nomi *">
            <Input value={productName}
                   onChange={e => setProductName(e.target.value)}
                   placeholder="masalan: Andikan" />
          </Field>
          <Field label="LOT / Seriya *"
                 hint={lotDigitCount > 0 && lotDigitCount < 2
                        ? "kamida 2 raqam kerak"
                        : "masalan: 25030 (raqamli qism ishlatiladi)"}>
            <Input value={lotSeries}
                   onChange={e => setLotSeries(e.target.value)}
                   placeholder="masalan: 25030" />
          </Field>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <Field label="Kompaniya INN (9 raqam) *"
                 hint={innInvalid ? "aynan 9 raqam bo'lishi kerak" : undefined}>
            <Input value={companyInn}
                   onChange={e => setCompanyInn(e.target.value.replace(/\D/g, "").slice(0, 9))}
                   inputMode="numeric" maxLength={9}
                   placeholder="masalan: 123456789"
                   className={cn(innInvalid && "border-danger focus:border-danger")} />
          </Field>
          <Field label={`Qutilar soni * (1–${MAX_BOXES})`}>
            <Input type="number" min={1} max={MAX_BOXES}
                   value={numBoxes}
                   onChange={e => {
                     const n = parseInt(e.target.value || "0", 10);
                     if (Number.isFinite(n)) setNumBoxes(Math.max(1, Math.min(MAX_BOXES, n)));
                   }} />
          </Field>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="primary" onClick={doPreview} disabled={previewing || !canSubmit}>
            <Sparkles className="size-4" />
            {previewing ? "Hisoblanmoqda…" : "Ko'rib chiqish"}
          </Button>
          <Button variant="outline" onClick={() => download("20")}
                  disabled={downloading20 || !canSubmit}>
            <Download className="size-4" />
            {downloading20 ? "Tayyorlanmoqda…" : "20-raqamli Excel"}
          </Button>
          <Button variant="outline" onClick={() => download("7")}
                  disabled={downloading7 || !canSubmit}>
            <Download className="size-4" />
            {downloading7 ? "Tayyorlanmoqda…" : "7-raqamli Excel"}
          </Button>
        </div>

        {!canSubmit && (
          <div className="mt-4 rounded-lg border border-border bg-surface2/40 p-3 text-xs text-muted flex items-start gap-2">
            <Info className="size-4 mt-0.5 text-muted shrink-0" />
            <div>
              Kod hosil qilish uchun mahsulot nomi, 9-raqamli INN, kamida 2 raqamli
              LOT/Seriya va qutilar soni to'ldirilishi kerak.
            </div>
          </div>
        )}
      </Card>

      {preview && (
        <>
          <Card className="mb-4">
            <CardHead
              title="20-raqamli kodlar"
              right={<>
                <Badge tone="success"><CheckCircle2 className="size-3" /> {preview.count} ta</Badge>
                <Button variant="outline" size="sm" onClick={() => download("20")}
                        disabled={downloading20}>
                  <Download className="size-3" />
                  {downloading20 ? "…" : "Excel"}
                </Button>
              </>}
            />
            <PreviewList codes={preview.codes_20} total={preview.count} />
          </Card>

          <Card>
            <CardHead
              title="7-raqamli qisqa kodlar"
              right={<>
                <Badge tone="accent">{preview.count} ta</Badge>
                <Button variant="outline" size="sm" onClick={() => download("7")}
                        disabled={downloading7}>
                  <Download className="size-3" />
                  {downloading7 ? "…" : "Excel"}
                </Button>
              </>}
            />
            <PreviewList codes={preview.codes_7} total={preview.count} />
          </Card>
        </>
      )}
    </div>
  );
}


/** Compact preview panel: first ~60 codes in a grid, count if more. */
function PreviewList({ codes, total }: { codes: string[]; total: number }) {
  const shown = codes.slice(0, 60);
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
        {shown.map((c, i) => (
          <div key={i}
               className="font-mono text-xs px-2 py-1.5 rounded border border-border bg-surface2/40 break-all">
            <span className="text-muted mr-2">{i + 1}.</span>{c}
          </div>
        ))}
      </div>
      {total > shown.length && (
        <div className="text-xs text-muted mt-3 text-center">
          + yana {total - shown.length} ta kod (to'liq ro'yxat Excel'da)
        </div>
      )}
    </>
  );
}
