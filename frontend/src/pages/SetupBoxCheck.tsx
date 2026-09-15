import { useState } from "react";
import { ArrowLeft, ShieldCheck, ShieldAlert, Save } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHead } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { CompanyPicker } from "@/components/CompanyPicker";
import { api } from "@/api";

interface Props {
  presetName?: string;
  presetProduct?: string;
  onCreated: (projectId: number) => void;
  onCancel: () => void;
}

/** Create-a-Quti-tekshiruvi-series form.
 *
 *  Same shape as SetupInventory: name / product / series, then the ASL
 *  company creds (INN + API key). "Tekshirish" runs the same
 *  api-keys/check the backend also runs before it stores the pair. */
export function SetupBoxCheck({ presetName, presetProduct, onCreated, onCancel }: Props) {
  const [name, setName] = useState(presetName || "");
  const [productName, setProductName] = useState(presetProduct || "");
  const [seriesName, setSeriesName] = useState("");
  const [inn, setInn] = useState("");
  const [apiKey, setApiKey] = useState("");

  type VerifyState =
    | { kind: "idle" }
    | { kind: "checking" }
    | { kind: "ok"; expiresOn?: string }
    | { kind: "bad"; reason: string };
  const [verify, setVerify] = useState<VerifyState>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function verifyCreds() {
    if (!inn.trim() || !apiKey.trim()) {
      setVerify({ kind: "bad", reason: "INN va API kalitni to'ldiring" });
      return;
    }
    setVerify({ kind: "checking" });
    try {
      const r = await api.stockVerify(inn.trim(), apiKey.trim());
      if (!r.ok) { setVerify({ kind: "bad", reason: r.error || "kalit qabul qilinmadi" }); return; }
      if (r.tin_correct === false) {
        setVerify({ kind: "bad", reason: "API kalit bu INN ga tegishli emas" }); return;
      }
      setVerify({ kind: "ok", expiresOn: r.expires_on });
    } catch (e: any) {
      setVerify({ kind: "bad", reason: String(e.message || e) });
    }
  }

  async function submit() {
    if (!name.trim() || !productName.trim() || !seriesName.trim()) {
      setErr("Loyiha nomi, mahsulot va seriya to'ldirilishi shart"); return;
    }
    if (!inn.trim() || !apiKey.trim()) {
      setErr("INN va API kalit to'ldirilishi shart"); return;
    }
    setBusy(true); setErr(null);
    try {
      const p = await api.boxCheckCreateProject({
        name: name.trim(), product_name: productName.trim(),
        series_name: seriesName.trim(),
        inn: inn.trim(), api_key: apiKey.trim(),
      });
      onCreated(p.id);
    } catch (e: any) {
      setErr(String(e.message || e));
    } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <button onClick={onCancel}
              className="text-muted hover:text-text inline-flex items-center gap-1 mb-4">
        <ArrowLeft className="size-4" /> Ortga
      </button>

      <div className="mb-6">
        <div className="text-3xl font-extrabold tracking-tight text-accent2">
          Yangi Quti tekshiruvi seriyasi
        </div>
        <div className="text-muted text-sm mt-1">
          Bir seriya = bitta loyiha. Kompaniya kaliti loyihaga bog'lanadi, keyingi
          skanerlashlarda uni qayta kiritish shart emas.
        </div>
      </div>

      <Card className="mb-4">
        <CardHead title="1. Loyiha ma'lumoti" right={<Badge tone="neutral">majburiy</Badge>} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-widest text-muted">Loyiha nomi</span>
            <Input value={name} onChange={e => setName(e.target.value)}
                   placeholder="Salbukort 001,002" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-widest text-muted">Mahsulot</span>
            <Input value={productName} onChange={e => setProductName(e.target.value)}
                   placeholder="Salbukort" />
          </label>
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="text-xs uppercase tracking-widest text-muted">Seriya</span>
            <Input value={seriesName} onChange={e => setSeriesName(e.target.value)}
                   placeholder="532045" />
          </label>
        </div>
      </Card>

      <Card className="mb-4">
        <CardHead title="2. Kompaniya (ASL kalit)"
                  right={<Badge tone="accent">ASL egalik</Badge>} />
        <CompanyPicker
          onPick={(pickedInn, pickedKey) => { setInn(pickedInn); setApiKey(pickedKey); }}
          currentInn={inn} currentKey={apiKey}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-widest text-muted">INN</span>
            <Input value={inn} onChange={e => { setInn(e.target.value); setVerify({ kind: "idle" }); }}
                   placeholder="STIR / INN" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-widest text-muted">API kalit</span>
            <Input value={apiKey} onChange={e => { setApiKey(e.target.value); setVerify({ kind: "idle" }); }}
                   placeholder="Business User API key" />
          </label>
        </div>
        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <Button variant="outline" size="sm" onClick={verifyCreds}
                  disabled={verify.kind === "checking" || !inn.trim() || !apiKey.trim()}>
            <ShieldCheck className="size-3" />
            {verify.kind === "checking" ? "Tekshirilmoqda…" : "INN va kalitni tekshirish"}
          </Button>
          {verify.kind === "ok" && (
            <div className="inline-flex items-center gap-1.5 text-sm text-success">
              <ShieldCheck className="size-4" />
              <span>Tasdiqlandi{verify.expiresOn ? ` · kalit ${verify.expiresOn} gacha` : ""}</span>
            </div>
          )}
          {verify.kind === "bad" && (
            <div className="inline-flex items-center gap-1.5 text-sm text-danger">
              <ShieldAlert className="size-4" />
              <span>{verify.reason}</span>
            </div>
          )}
        </div>
      </Card>

      {err && (
        <div className="mb-4 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {err}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={busy}>Bekor</Button>
        <Button variant="primary" size="lg" onClick={submit}
                disabled={busy || !name.trim() || !productName.trim() || !seriesName.trim() || !inn.trim() || !apiKey.trim()}>
          <Save className="size-4" /> {busy ? "Saqlanmoqda…" : "Loyihani yaratish"}
        </Button>
      </div>
    </div>
  );
}
