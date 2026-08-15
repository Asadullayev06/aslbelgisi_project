import { useRef, useState } from "react";
import {
  ArrowLeft, Key, Building2, CheckCircle2, XCircle, Loader2, Upload,
  Sparkles, Layers, FlaskConical, Send, Download, RefreshCw,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHead } from "@/components/ui/Card";
import { Field, Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Toaster, useFlashes } from "@/components/ui/Toast";
import { api } from "@/api";
import { useAuth, isAdmin } from "@/auth";
import type {
  CustomAggRunResp, ModItem, KmParseResp, CustomAggReport,
} from "@/types";
import { cn } from "@/lib/utils";

const GROUP_SIZE_DEFAULT = 1000;

export function CustomAggregation({ onExit }: { onExit: () => void }) {
  const { user } = useAuth();
  const admin = isAdmin(user);

  // Company auth
  const [inn, setInn] = useState("");
  const [aslKey, setAslKey] = useState("");
  const [verified, setVerified] = useState<{ inn: string } | null>(null);
  const [verifying, setVerifying] = useState(false);

  // MOD
  const [mods, setMods] = useState<ModItem[]>([]);
  const [modLoading, setModLoading] = useState(false);
  const [modManual, setModManual] = useState(false);
  const [modId, setModId] = useState("");
  const [productionOrderId, setProductionOrderId] = useState("");

  // KM upload
  const [isMedicine, setIsMedicine] = useState(true);
  const [kmResult, setKmResult] = useState<KmParseResp | null>(null);
  const [kmUploading, setKmUploading] = useState(false);
  const kmFileRef = useRef<HTMLInputElement>(null);

  // Grouping + SSCC config
  const [groupSize, setGroupSize] = useState(GROUP_SIZE_DEFAULT);
  const [ssccMode, setSsccMode] = useState<"auto" | "upload">("auto");
  const [useGcp, setUseGcp] = useState(false);
  const [gcpPrefix, setGcpPrefix] = useState("");
  const [ssccStart, setSsccStart] = useState(1);

  const [ssccUploaded, setSsccUploaded] = useState<string[]>([]);
  const [ssccUploading, setSsccUploading] = useState(false);
  const ssccFileRef = useRef<HTMLInputElement>(null);

  // Execution
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<CustomAggRunResp | null>(null);
  const { flashes, push, dismiss } = useFlashes();

  // Derived
  const kmCount    = kmResult?.codes.length ?? 0;
  const groups     = kmCount && groupSize > 0 ? Math.ceil(kmCount / groupSize) : 0;
  const canDryRun  = !!kmCount && groupSize > 0 &&
                     (ssccMode === "auto" || ssccUploaded.length >= groups);
  const canSubmit  = canDryRun && !!verified && !!modId.trim() && admin;

  // ── auth ──────────────────────────────────────────────
  async function verify() {
    if (!inn.trim() || !aslKey.trim()) {
      push("err", "INN va API kalit talab qilinadi");
      return;
    }
    setVerifying(true);
    try {
      const r = await api.stockVerify(inn.trim(), aslKey.trim());
      if (r.ok) {
        setVerified({ inn: r.inn });
        push("hit", `Tekshirildi — INN ${r.inn}`);
      } else {
        setVerified(null);
        push("err", r.error || "Tekshirish muvaffaqiyatsiz");
      }
    } catch (e: any) { push("err", String(e.message || e)); }
    setVerifying(false);
  }
  function resetAuth() {
    setVerified(null); setAslKey(""); setMods([]); setModId("");
  }

  // ── MOD ───────────────────────────────────────────────
  async function loadMods() {
    if (!verified) { push("err", "Avval INN + API kalitni tekshiring"); return; }
    setModLoading(true);
    try {
      const r = await api.customModList(inn.trim(), aslKey.trim());
      if (!r.ok) { push("err", r.error || "MOD yuklab bo'lmadi"); setMods([]); }
      else {
        setMods(r.mods);
        if (r.mods.length > 0 && !modId) setModId(r.mods[0].id);
        push("hit", `${r.mods.length} ta MOD yuklandi`);
      }
    } catch (e: any) { push("err", String(e.message || e)); }
    setModLoading(false);
  }

  // ── uploads ───────────────────────────────────────────
  async function uploadKm(file: File) {
    setKmUploading(true);
    try {
      const r = await api.customParseKm(file, isMedicine);
      setKmResult(r);
      if (r.codes.length === 0) push("err", "Hech qanday yaroqli KM topilmadi");
      else push("hit", `${r.codes.length} KM yuklandi (${r.invalid.length} noto'g'ri)`);
    } catch (e: any) { push("err", String(e.message || e)); }
    setKmUploading(false);
  }
  async function uploadSscc(file: File) {
    setSsccUploading(true);
    try {
      const r = await api.customParseSscc(file);
      setSsccUploaded(r.codes);
      push("hit", `${r.codes.length} ta yaroqli SSCC yuklandi`);
    } catch (e: any) { push("err", String(e.message || e)); }
    setSsccUploading(false);
  }

  // ── run ───────────────────────────────────────────────
  async function doRun(mode: "dry_run" | "submit") {
    if (!kmResult?.codes.length) { push("err", "Avval KM yuklang"); return; }
    if (mode === "submit" && !admin) {
      push("err", "Faqat admin submit qila oladi"); return;
    }
    if (mode === "submit" && (!verified || !modId.trim())) {
      push("err", "Submit uchun tekshirilgan hisob va MOD kerak"); return;
    }
    if (mode === "submit" &&
        !confirm(`Rostdan ham ${groups} ta guruh ASL Belgisi ga yuborilsinmi?`)) return;

    setRunning(true); setRunResult(null);
    try {
      const r = await api.customRun({
        api_key: aslKey.trim(),
        codes: kmResult.codes,
        group_size: groupSize,
        business_place_id: modId.trim(),
        production_order_id: productionOrderId.trim(),
        sscc_source: ssccMode,
        sscc_inn: inn.trim(),
        sscc_use_gcp: useGcp,
        sscc_gcp_prefix: gcpPrefix.trim(),
        sscc_start: ssccStart,
        sscc_uploaded: ssccMode === "upload" ? ssccUploaded : [],
        mode,
      });
      setRunResult(r);
      if (!r.ok) {
        push("err", r.errors.join("; ") || "Xatolik");
      } else if (mode === "dry_run") {
        push("hit", `Dry run OK — ${r.groups.length} ta guruh`);
      } else {
        const ok = r.reports.every(x => x.ok);
        push(ok ? "hit" : "warn",
          ok ? `Yuborildi: ${r.total_reports} ta so'rov`
             : "Yuborildi, lekin ba'zi so'rovlarda xato bor");
      }
    } catch (e: any) {
      push("err", String(e.message || e));
    }
    setRunning(false);
  }

  function downloadGroupsCsv() {
    if (!runResult?.groups.length) return;
    const rows = [["group", "sscc", "codes_count"],
                  ...runResult.groups.map(g => [g.index, g.sscc, g.codes_count])];
    const csv = "﻿" + rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `custom_aggregation_groups_${Date.now()}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-6">
      <Toaster flashes={flashes} onDismiss={dismiss} />

      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <button onClick={onExit} className="text-muted hover:text-text inline-flex items-center gap-1">
          <ArrowLeft className="size-4" /> Bosh sahifa
        </button>
        <div className="text-right">
          <div className="text-3xl font-extrabold tracking-tight text-accent flex items-center gap-2 justify-end">
            <Layers className="size-7" /> Custom Aggregation
          </div>
          <div className="text-muted text-sm">
            KM CSV → guruhlarga bo'lish → SSCC → bir bosishda ASL Belgisi ga yuborish
          </div>
        </div>
      </div>

      {/* Step tracker */}
      <StepStrip
        steps={[
          { n: 1, label: "Autentifikatsiya", done: !!verified },
          { n: 2, label: "MOD",              done: !!modId.trim() },
          { n: 3, label: "KM ro'yxati",      done: kmCount > 0 },
          { n: 4, label: "SSCC",             done: ssccMode === "auto" || ssccUploaded.length >= groups },
          { n: 5, label: "Yuborish",         done: !!runResult && runResult.mode === "submit" && runResult.ok },
        ]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        {/* LEFT */}
        <div className="flex flex-col gap-4">
          {/* 1 — auth */}
          <Card>
            <CardHead
              title="1. Kompaniya autentifikatsiyasi"
              right={verified
                ? <Badge tone="success"><CheckCircle2 className="size-3" /> tekshirildi</Badge>
                : <Badge tone="neutral">tekshirilmagan</Badge>}
            />
            {!verified ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Field label="INN (STIR)">
                    <div className="relative">
                      <Building2 className="absolute left-3 top-3 size-4 text-muted" />
                      <Input className="pl-9" value={inn}
                             onChange={e => setInn(e.target.value)}
                             placeholder="masalan 900053011" />
                    </div>
                  </Field>
                  <Field label="Business API kalit">
                    <div className="relative">
                      <Key className="absolute left-3 top-3 size-4 text-muted" />
                      <Input className="pl-9" type="password" value={aslKey}
                             onChange={e => setAslKey(e.target.value)}
                             placeholder="Bearer …" />
                    </div>
                  </Field>
                </div>
                <div className="text-xs text-muted mt-2">
                  API kalit brauzeringizdan ASL ga to'g'ridan-to'g'ri yuboriladi va serverda hech qachon saqlanmaydi.
                </div>
                <Button variant="primary" className="w-full mt-3" onClick={verify} disabled={verifying}>
                  {verifying ? <><Loader2 className="size-4 animate-spin" /> Tekshirilmoqda…</>
                             : <><CheckCircle2 className="size-4" /> Tekshirish</>}
                </Button>
              </>
            ) : (
              <div className="flex items-center justify-between">
                <div className="text-sm">INN <b>{verified.inn}</b> tasdiqlangan</div>
                <Button variant="outline" size="sm" onClick={resetAuth}>
                  <RefreshCw className="size-3" /> Boshqa hisob
                </Button>
              </div>
            )}
          </Card>

          {/* 2 — MOD */}
          <Card>
            <CardHead title="2. MOD (business place)"
                      right={<Badge tone={modId ? "accent" : "neutral"}>
                        {modId || "—"}
                      </Badge>} />
            <label className="flex items-center gap-2 text-sm mb-3">
              <input type="checkbox" className="accent-[hsl(var(--accent))]"
                     checked={modManual}
                     onChange={e => setModManual(e.target.checked)} />
              MOD ni qo'lda kiritaman
            </label>
            {modManual ? (
              <Field label="MOD ID">
                <Input value={modId} onChange={e => setModId(e.target.value)}
                       placeholder="masalan 27" />
              </Field>
            ) : (
              <>
                <div className="flex gap-2">
                  <Button variant="outline" size="md" onClick={loadMods}
                          disabled={!verified || modLoading}>
                    {modLoading
                      ? <><Loader2 className="size-4 animate-spin" /> Yuklanmoqda…</>
                      : <><Sparkles className="size-4" /> API dan yuklash</>}
                  </Button>
                  <div className="flex-1">
                    <select className="w-full h-11 rounded-lg border border-border bg-surface2/50 px-3 text-sm text-text"
                            value={modId} onChange={e => setModId(e.target.value)}>
                      <option value="">— tanlang —</option>
                      {mods.map(m => (
                        <option key={m.id} value={m.id}>
                          {m.id}{m.name ? ` — ${m.name}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </>
            )}
            <div className="mt-3">
              <Field label="productionOrderId (ixtiyoriy)">
                <Input value={productionOrderId}
                       onChange={e => setProductionOrderId(e.target.value)}
                       placeholder="ishlab chiqarish buyruqchi raqami" />
              </Field>
            </div>
          </Card>

          {/* 3 — KM upload */}
          <Card>
            <CardHead title="3. KM CSV / TXT"
                      right={<Badge tone={kmCount ? "accent" : "neutral"}>
                        {kmCount.toLocaleString()} ta KM
                      </Badge>} />
            <label className="flex items-center gap-2 text-sm mb-3">
              <input type="checkbox" className="accent-[hsl(var(--accent))]"
                     checked={isMedicine}
                     onChange={e => setIsMedicine(e.target.checked)} />
              Bu dori-darmon — to'liq GS1 KM strukturasi (AI 01) tekshiriladi
            </label>
            <Dropzone
              inputRef={kmFileRef}
              accept=".csv,.txt"
              busy={kmUploading}
              onFile={uploadKm}
              hint="CSV/TXT — har qatorga bitta kod"
            />
            {kmResult && (
              <div className="mt-3 space-y-1 text-sm">
                <StatRow k="Yaroqli KM" v={kmResult.codes.length.toLocaleString()} accent />
                <StatRow k="Noto'g'ri" v={kmResult.invalid.length.toLocaleString()}
                         tone={kmResult.invalid.length ? "danger" : undefined} />
                {kmResult.warnings.length > 0 && (
                  <div className="rounded border border-warning/40 bg-warning/10 p-2 text-warning text-xs mt-2">
                    {kmResult.warnings.join(" · ")}
                  </div>
                )}
                {kmResult.invalid.length > 0 && (
                  <details className="text-xs mt-1">
                    <summary className="cursor-pointer text-muted">
                      Noto'g'ri kodlar ({kmResult.invalid.length})
                    </summary>
                    <div className="mt-1 max-h-40 overflow-auto font-mono">
                      {kmResult.invalid.slice(0, 50).map((row: any, i: number) => (
                        <div key={i} className="text-danger">
                          {String(row[0])}: {String(row[1]).slice(0, 40)} — {String(row[2])}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </Card>
        </div>

        {/* RIGHT */}
        <div className="flex flex-col gap-4">
          {/* 4 — grouping + SSCC */}
          <Card>
            <CardHead title="4. Guruhlash va SSCC"
                      right={<Badge tone={groups ? "accent" : "neutral"}>
                        {groups.toLocaleString()} ta guruh
                      </Badge>} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Guruhdagi KM soni (max 1000)">
                <Input type="number" min={1} max={1000} value={groupSize}
                       onChange={e => setGroupSize(+e.target.value || 0)} />
              </Field>
              <Field label="Hisob-kitob">
                <div className="h-11 flex items-center rounded-lg border border-border bg-surface2/40 px-3 text-sm font-mono">
                  {kmCount.toLocaleString()} KM ÷ {groupSize} ={" "}
                  <b className="text-accent ml-1">{groups.toLocaleString()}</b>
                </div>
              </Field>
            </div>

            <div className="mt-4">
              <div className="text-[11px] uppercase tracking-widest text-muted mb-1.5 font-semibold">SSCC manbai</div>
              <SegmentedToggle
                value={ssccMode}
                onChange={setSsccMode as any}
                options={[
                  { value: "auto",   label: "Avtomatik generatsiya", icon: <Sparkles className="size-3" /> },
                  { value: "upload", label: "Fayldan yuklash",       icon: <Upload   className="size-3" /> },
                ]}
              />

              {ssccMode === "auto" ? (
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="flex items-center gap-2 text-sm md:col-span-2">
                    <input type="checkbox" className="accent-[hsl(var(--accent))]"
                           checked={useGcp}
                           onChange={e => setUseGcp(e.target.checked)} />
                    GCP prefiksdan foydalanish (dorilar uchun)
                  </label>
                  {useGcp && (
                    <Field label="GCP prefiksi">
                      <Input value={gcpPrefix}
                             onChange={e => setGcpPrefix(e.target.value)}
                             placeholder="masalan 4600001" />
                    </Field>
                  )}
                  <Field label="SSCC start seq">
                    <Input type="number" min={1} value={ssccStart}
                           onChange={e => setSsccStart(+e.target.value || 1)} />
                  </Field>
                  <div className="md:col-span-2 text-xs text-muted">
                    SSCC INN (<b className="text-text">{inn || "?"}</b>) dan avtomatik generatsiya qilinadi.
                    Har bir guruh o'z SSCC ga ega bo'ladi.
                  </div>
                </div>
              ) : (
                <div className="mt-3">
                  <Dropzone
                    inputRef={ssccFileRef}
                    accept=".csv,.txt"
                    busy={ssccUploading}
                    onFile={uploadSscc}
                    hint="CSV/TXT — har qatorga bitta SSCC-18"
                  />
                  {ssccUploaded.length > 0 && (
                    <div className="mt-2 text-sm">
                      <StatRow k="Yuklangan SSCC" v={ssccUploaded.length.toLocaleString()} accent />
                      {ssccUploaded.length < groups && (
                        <div className="text-danger text-xs mt-1">
                          Yetarli emas: {groups} kerak, {ssccUploaded.length} bor.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </Card>

          {/* 5 — run */}
          <Card>
            <CardHead
              title="5. Ishga tushirish"
              right={admin
                ? <Badge tone="accent">admin</Badge>
                : <Badge tone="warning">faqat dry-run</Badge>}
            />
            <div className="text-xs text-muted mb-3">
              Dry-run har kim uchun ochiq — u lokal validatsiya qiladi va SSCC ni preview qiladi.
              Submit ASL Belgisi ga yuboradi (faqat admin).
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => doRun("dry_run")}
                      disabled={!canDryRun || running}>
                {running && runResult?.mode !== "submit"
                  ? <><Loader2 className="size-4 animate-spin" /> Tekshirilmoqda…</>
                  : <><FlaskConical className="size-4" /> Dry run</>}
              </Button>
              <Button variant="primary" onClick={() => doRun("submit")}
                      disabled={!canSubmit || running}>
                {running && runResult?.mode === "submit"
                  ? <><Loader2 className="size-4 animate-spin" /> Yuborilmoqda…</>
                  : <><Send className="size-4" /> ASL ga yuborish</>}
              </Button>
            </div>
            {!canSubmit && admin && (
              <div className="text-xs text-warning mt-2">
                Submit tugmasi faol bo'lishi uchun: autentifikatsiya + MOD + KM + yetarli SSCC kerak.
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Results — full width below */}
      {runResult && (
        <div className="mt-4">
          <ResultPanel r={runResult}
                       onExportGroups={downloadGroupsCsv} />
        </div>
      )}
    </div>
  );
}


// ═════════ helpers / sub-components ═════════

function StepStrip({ steps }: {
  steps: { n: number; label: string; done: boolean }[];
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface/60 backdrop-blur px-4 py-3 flex items-center gap-2 flex-wrap">
      {steps.map((s, i) => (
        <div key={s.n} className="flex items-center gap-2">
          <div className={cn(
            "size-6 rounded-full flex items-center justify-center text-xs font-bold",
            s.done ? "bg-accent text-black" : "bg-surface2 text-muted border border-border"
          )}>
            {s.done ? "✓" : s.n}
          </div>
          <span className={cn("text-sm", s.done ? "text-text" : "text-muted")}>{s.label}</span>
          {i < steps.length - 1 && <ChevronRight className="size-4 text-muted" />}
        </div>
      ))}
    </div>
  );
}

function SegmentedToggle<T extends string>({
  value, onChange, options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: React.ReactNode }[];
}) {
  return (
    <div className="inline-flex p-1 rounded-lg border border-border bg-surface2/40">
      {options.map(o => (
        <button key={o.value}
                onClick={() => onChange(o.value)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 transition-all",
                  value === o.value
                    ? "bg-accent text-black shadow-glow"
                    : "text-muted hover:text-text"
                )}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}

function Dropzone({
  inputRef, accept, busy, onFile, hint,
}: {
  inputRef: React.RefObject<HTMLInputElement>;
  accept: string;
  busy: boolean;
  onFile: (f: File) => void;
  hint: string;
}) {
  return (
    <div
      onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={e => {
        e.preventDefault(); e.stopPropagation();
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      onClick={() => inputRef.current?.click()}
      className="rounded-xl border-2 border-dashed border-border hover:border-accent
                 hover:bg-accent/5 transition-all p-6 text-center cursor-pointer"
    >
      {busy
        ? <div className="flex items-center justify-center gap-2 text-accent">
            <Loader2 className="size-5 animate-spin" /> Yuklanmoqda…
          </div>
        : <div>
            <Upload className="size-6 mx-auto text-muted mb-2" />
            <div className="text-sm">Faylni bu yerga tashlang yoki bosing</div>
            <div className="text-xs text-muted mt-0.5">{hint}</div>
          </div>}
      <input type="file" hidden ref={inputRef} accept={accept}
             onChange={e => {
               const f = e.target.files?.[0];
               if (f) onFile(f);
               e.currentTarget.value = "";
             }} />
    </div>
  );
}

function StatRow({ k, v, accent, tone }: {
  k: string; v: string; accent?: boolean; tone?: "danger";
}) {
  const cls = tone === "danger" ? "text-danger"
            : accent ? "text-accent font-bold"
            : "text-text";
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted">{k}</span>
      <span className={cls}>{v}</span>
    </div>
  );
}

function ResultPanel({ r, onExportGroups }: {
  r: CustomAggRunResp;
  onExportGroups: () => void;
}) {
  const isDry = r.mode === "dry_run";
  return (
    <Card>
      <CardHead
        title={isDry ? "Dry-run natijasi" : "Yuborish natijasi"}
        right={
          <>
            {isDry
              ? <Badge tone="accent"><FlaskConical className="size-3" /> lokal</Badge>
              : r.ok
                ? <Badge tone="success"><CheckCircle2 className="size-3" /> muvaffaqiyat</Badge>
                : <Badge tone="danger"><XCircle className="size-3" /> qisman</Badge>}
            <Button variant="outline" size="sm" onClick={onExportGroups}>
              <Download className="size-3" /> Guruhlar CSV
            </Button>
          </>
        }
      />

      {r.errors.length > 0 && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger mb-3">
          {r.errors.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      )}

      {/* Groups */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <SummaryTile label="Guruhlar" value={r.groups.length.toLocaleString()} tone="accent" />
        <SummaryTile label="Jami KM"
                     value={r.groups.reduce((a, g) => a + g.codes_count, 0).toLocaleString()} />
        <SummaryTile label={isDry ? "Rejim" : "So'rovlar"}
                     value={isDry ? "DRY" : r.total_reports.toString()}
                     tone={isDry ? "warning" : "accent"} />
      </div>

      {/* Groups table */}
      <div className="overflow-hidden rounded-lg border border-border max-h-64 overflow-y-auto mb-4">
        <table className="w-full text-xs">
          <thead className="bg-surface2/60 sticky top-0">
            <tr>
              <Th>#</Th><Th>SSCC</Th><Th>KM</Th>
            </tr>
          </thead>
          <tbody>
            {r.groups.slice(0, 300).map(g => (
              <tr key={g.index} className="border-t border-border">
                <Td className="text-muted">{g.index}</Td>
                <Td className="font-mono">{g.sscc}</Td>
                <Td className="font-mono">{g.codes_count}</Td>
              </tr>
            ))}
          </tbody>
        </table>
        {r.groups.length > 300 && (
          <div className="text-xs text-muted p-2 text-center">
            Birinchi 300 ta ko'rsatilmoqda. To'liq ro'yxat uchun CSV yuklab oling.
          </div>
        )}
      </div>

      {/* Reports (submit only) */}
      {r.reports.length > 0 && (
        <>
          <div className="text-[11px] uppercase tracking-widest text-muted mb-2 font-semibold">
            ASL javoblari
          </div>
          <div className="overflow-hidden rounded-lg border border-border max-h-72 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-surface2/60 sticky top-0">
                <tr>
                  <Th>#</Th><Th>Qutilar</Th><Th>KM</Th>
                  <Th>HTTP</Th><Th>documentId</Th><Th>OK</Th><Th>Xato</Th>
                </tr>
              </thead>
              <tbody>
                {r.reports.map((x: CustomAggReport) => (
                  <tr key={x.report_index} className="border-t border-border">
                    <Td>{x.report_index}</Td>
                    <Td>{x.unit_count}</Td>
                    <Td>{x.code_count}</Td>
                    <Td>{x.http_status}</Td>
                    <Td className="font-mono">{x.document_id || "-"}</Td>
                    <Td>{x.ok ? "✓" : "✗"}</Td>
                    <Td className="max-w-[280px] truncate text-danger" title={x.error}>
                      {x.error.slice(0, 120)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

function SummaryTile({ label, value, tone = "text" }: {
  label: string; value: string; tone?: "text" | "accent" | "warning";
}) {
  const cls = tone === "accent"  ? "text-accent"
            : tone === "warning" ? "text-warning"
            : "text-text";
  return (
    <div className="rounded-lg border border-border bg-surface2/40 p-3">
      <div className={`text-2xl font-extrabold ${cls}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-muted mt-0.5">{label}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-2 py-1.5 text-left font-semibold text-muted">{children}</th>;
}
function Td({ children, className = "", title }: {
  children: React.ReactNode; className?: string; title?: string;
}) {
  return <td className={cn("px-2 py-1.5 align-top", className)} title={title}>{children}</td>;
}
