import { useMemo, useState, useRef } from "react";
import {
  ArrowLeft, Play, Upload, Plus, Trash2, ClipboardList, PackageCheck,
} from "lucide-react";
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

interface SeriesDraft {
  key: number;
  name: string;
  codes: string;
}

export function SetupInventory({ onCreated, onCancel }: Props) {
  const [name, setName] = useState("");
  const [productName, setProductName] = useState("");
  const [seriesList, setSeriesList] = useState<SeriesDraft[]>([
    { key: 1, name: "", codes: "" },
  ]);
  const nextKey = useRef(2);
  const [busy, setBusy] = useState(false);
  const { flashes, push, dismiss } = useFlashes();

  const totals = useMemo(() => {
    let total = 0;
    for (const s of seriesList) {
      total += s.codes.split(/\r?\n/).filter(l => l.trim().length >= 20).length;
    }
    return total;
  }, [seriesList]);

  function addSeries() {
    setSeriesList(list => [...list, { key: nextKey.current++, name: "", codes: "" }]);
  }
  function removeSeries(key: number) {
    if (seriesList.length === 1) return;
    setSeriesList(list => list.filter(s => s.key !== key));
  }
  function updateSeries(key: number, patch: Partial<SeriesDraft>) {
    setSeriesList(list => list.map(s => s.key === key ? { ...s, ...patch } : s));
  }

  async function loadFile(key: number, file: File) {
    try {
      // Reuse the aggregation KM parser — same format.
      const res = await api.parseFile("km", file);
      updateSeries(key, {
        codes: (findSeries(key)?.codes ?? "") + (findSeries(key)?.codes ? "\n" : "")
             + res.codes.join("\n"),
      });
      push("hit", `${res.count} KM fayldan qo'shildi`);
    } catch (e: any) {
      push("err", String(e.message || e));
    }
  }
  function findSeries(k: number) { return seriesList.find(s => s.key === k); }

  async function submit() {
    if (!name.trim() || !productName.trim()) {
      push("err", "Loyiha nomi va mahsulot nomi to'ldirilishi kerak");
      return;
    }
    const namesSeen = new Set<string>();
    for (const s of seriesList) {
      if (!s.name.trim()) { push("err", "Har bir seriya uchun nom yozing"); return; }
      const n = s.name.trim();
      if (namesSeen.has(n)) { push("err", `Seriya nomi takroriy: ${n}`); return; }
      namesSeen.add(n);
      const codeCount = s.codes.split(/\r?\n/).filter(l => l.trim().length >= 20).length;
      if (codeCount === 0) {
        push("err", `Seriya "${n}" uchun KM kod kiritilmagan`); return;
      }
    }

    setBusy(true);
    try {
      const state = await api.createInventoryProject({
        name: name.trim(),
        product_name: productName.trim(),
        series: seriesList.map(s => ({
          name: s.name.trim(),
          km_codes_text: s.codes,
        })),
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
        <button onClick={onCancel}
                className="text-muted hover:text-text inline-flex items-center gap-1">
          <ArrowLeft className="size-4" /> Ortga
        </button>
        <div className="text-right">
          <div className="text-3xl font-extrabold tracking-tight text-warning">
            Yangi inventarizatsiya
          </div>
          <div className="text-muted text-sm">
            Sozlash — bir yoki bir nechta seriya
          </div>
        </div>
      </div>

      <Card className="mb-4">
        <CardHead title="Loyiha ma'lumotlari"
                  right={<Badge tone="warning"><ClipboardList className="size-3" /> Inventarizatsiya</Badge>} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Loyiha nomi">
            <Input value={name} onChange={e => setName(e.target.value)}
                   placeholder="masalan: 2026-Q3 inventar" />
          </Field>
          <Field label="Mahsulot nomi">
            <Input value={productName} onChange={e => setProductName(e.target.value)}
                   placeholder="masalan: Colhitina 500mg" />
          </Field>
        </div>
        <div className="mt-3 text-xs text-muted">
          Karobka o'lchami, MOD, API kalit — inventarizatsiya uchun kerak emas.
          Ombordagi qadoq to'lgach, uning SSCC barkodini skanerlab, keyingi
          karobkaga o'tasiz.
        </div>
      </Card>

      <div className="mb-4 flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xl font-bold">Seriyalar</div>
          <div className="text-sm text-muted">
            Har bir seriya uchun uning KM kodlari ro'yxatini yuklang. Bir kod
            bir nechta seriyada bo'lishi mumkin — skanerlanganda ikkalasi ham
            ko'rsatiladi.
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={addSeries}>
          <Plus className="size-4" /> Yana seriya qo'shish
        </Button>
      </div>

      <div className="flex flex-col gap-3 mb-6">
        {seriesList.map((s, i) => (
          <SeriesCard key={s.key} idx={i + 1} draft={s}
                      canRemove={seriesList.length > 1}
                      onChange={patch => updateSeries(s.key, patch)}
                      onRemove={() => removeSeries(s.key)}
                      onFile={f => loadFile(s.key, f)} />
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-muted flex items-center gap-3">
          <ClipboardList className="size-4" /> {seriesList.length} ta seriya
          <PackageCheck className="size-4 ml-3" /> {totals} ta KM jami yuklangan
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


function SeriesCard({ idx, draft, canRemove, onChange, onRemove, onFile }: {
  idx: number; draft: SeriesDraft; canRemove: boolean;
  onChange: (patch: Partial<SeriesDraft>) => void;
  onRemove: () => void;
  onFile: (file: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const count = draft.codes.split(/\r?\n/).filter(l => l.trim().length >= 20).length;

  return (
    <Card>
      <CardHead
        title={`Seriya ${idx}`}
        right={
          <>
            <Badge tone={count ? "warning" : "neutral"}>{count} KM</Badge>
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <Upload className="size-3" /> Fayl
            </Button>
            <input type="file" hidden ref={fileRef}
                   accept=".csv,.tsv,.txt,.xlsx,.xlsm,.xls"
                   onChange={e => {
                     const f = e.target.files?.[0];
                     if (f) onFile(f);
                     e.currentTarget.value = "";
                   }} />
            {canRemove && (
              <Button variant="danger" size="sm" onClick={onRemove}>
                <Trash2 className="size-3" /> O'chirish
              </Button>
            )}
          </>
        }
      />
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Field label="Seriya nomi">
          <Input value={draft.name}
                 onChange={e => onChange({ name: e.target.value })}
                 placeholder="masalan: L2026-05-A" />
        </Field>
        <div className="md:col-span-3">
          <div className="text-sm mb-1">KM kodlar</div>
          <Textarea rows={5} value={draft.codes}
                    onChange={e => onChange({ codes: e.target.value })}
                    placeholder="Har bir qatorga bitta KM kod." />
        </div>
      </div>
    </Card>
  );
}
