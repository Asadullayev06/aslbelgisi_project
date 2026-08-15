import { useMemo, useState } from "react";
import {
  ArrowLeft, Key, Building2, CheckCircle2, XCircle, Loader2,
  Download, Sparkles, ScanLine, ChevronRight, X,
  Package, Truck, Factory, FileText, History,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHead } from "@/components/ui/Card";
import { Field, Input, Textarea } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Toaster, useFlashes } from "@/components/ui/Toast";
import { api } from "@/api";
import type { InspectorResult, InspectorLookupResp } from "@/types";
import { cn } from "@/lib/utils";

const MAX_CODES = 100;

export function Inspector({ onExit }: { onExit: () => void }) {
  // company auth
  const [inn, setInn] = useState("");
  const [aslKey, setAslKey] = useState("");
  const [verified, setVerified] = useState<{ inn: string } | null>(null);
  const [verifying, setVerifying] = useState(false);

  // codes
  const [codesText, setCodesText] = useState("");
  const [running, setRunning] = useState(false);
  const [response, setResponse] = useState<InspectorLookupResp | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  const { flashes, push, dismiss } = useFlashes();

  // Reuse the /gtin-stock/verify endpoint — same underlying ASL check.
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
    setVerified(null); setAslKey(""); setResponse(null); setSelected(null);
  }

  const codeCount = useMemo(
    () => codesText.split(/\r?\n/).filter(l => l.trim()).length,
    [codesText],
  );

  async function runLookup() {
    if (!verified) { push("err", "Avval INN + API kalitni tekshiring"); return; }
    const codes = codesText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (codes.length === 0) { push("err", "Kamida bitta kod kiriting"); return; }
    if (codes.length > MAX_CODES) {
      push("err", `Bir so'rovda maksimum ${MAX_CODES} ta kod (${codes.length} yubordingiz)`);
      return;
    }
    setRunning(true); setResponse(null); setSelected(null);
    try {
      const r = await api.inspectorLookup(inn.trim(), aslKey.trim(), codes);
      setResponse(r);
      push(r.failed === 0 ? "hit" : "warn",
        r.failed === 0
          ? `Barcha ${r.successful} ta kod topildi`
          : `${r.successful} ta muvaffaqiyatli, ${r.failed} ta xato`);
    } catch (e: any) {
      push("err", String(e.message || e));
    }
    setRunning(false);
  }

  function downloadCsv() {
    if (!response) return;
    const rows = response.results;
    const cols = [
      ["kod", (r: InspectorResult) => r.basic.code],
      ["status", (r: InspectorResult) => r.basic.status],
      ["gtin", (r: InspectorResult) => r.basic.gtin],
      ["mahsulot", (r: InspectorResult) => r.basic.product_name],
      ["seriya", (r: InspectorResult) => r.basic.batch],
      ["ishlab_chiqarilgan", (r: InspectorResult) => r.basic.production_date],
      ["yaroqlilik", (r: InspectorResult) => r.basic.expiration_date],
      ["egasi", (r: InspectorResult) => r.summary_owner],
      ["emitent_inn", (r: InspectorResult) => r.owner.emitter_inn],
      ["ota_kod", (r: InspectorResult) => r.aggregation.parent_code],
      ["xato", (r: InspectorResult) => r.error],
    ] as const;
    const esc = (v: any) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = cols.map(([n]) => n).join(",");
    const body = rows.map(r => cols.map(([, f]) => esc(f(r))).join(",")).join("\n");
    const blob = new Blob(["﻿" + header + "\n" + body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `marka_kod_tekshiruvi_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto max-w-[1500px] px-6 py-6">
      <Toaster flashes={flashes} onDismiss={dismiss} />

      {/* Top bar */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <button onClick={onExit} className="text-muted hover:text-text inline-flex items-center gap-1">
          <ArrowLeft className="size-4" /> Bosh sahifa
        </button>
        <div className="text-right">
          <div className="text-3xl font-extrabold tracking-tight text-accent flex items-center gap-2 justify-end">
            <ScanLine className="size-7" /> Marka Kod Tekshiruvi
          </div>
          <div className="text-muted text-sm">Batafsil KM ma'lumotlari: egasi, mahsulot, agregatsiya, tarix</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.6fr] gap-4">
        {/* LEFT — auth + codes */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardHead
              title="Kompaniya autentifikatsiyasi"
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
                <Button variant="outline" size="sm" onClick={resetAuth}>Boshqa hisob</Button>
              </div>
            )}
          </Card>

          <Card>
            <CardHead title="Kodlarni kiriting"
                      right={
                        <Badge tone={codeCount > MAX_CODES ? "danger"
                                    : codeCount ? "accent" : "neutral"}>
                          {codeCount} / {MAX_CODES}
                        </Badge>
                      } />
            <Textarea rows={10}
                      value={codesText}
                      onChange={e => setCodesText(e.target.value)}
                      placeholder={"Har bir qatorga bitta KM kod:\n010843521441620021…\n010843521441620021…"} />
            <div className="text-xs text-muted mt-2">
              Bo'sh joylar va yangi qatorlar avtomatik tozalanadi.
            </div>
            <Button variant="primary" size="lg" className="w-full mt-3"
                    onClick={runLookup} disabled={!verified || running || codeCount === 0}>
              {running ? <><Loader2 className="size-4 animate-spin" /> Tekshirilmoqda…</>
                       : <><Sparkles className="size-4" /> Kod(lar)ni tekshirish</>}
            </Button>
          </Card>
        </div>

        {/* RIGHT — results */}
        <div className="flex flex-col gap-4">
          {!response && !running && (
            <Card>
              <CardHead title="Natijalar" right={<Badge tone="neutral">bo'sh</Badge>} />
              <div className="text-muted text-sm py-10 text-center italic">
                Kodlarni yuklab, tekshirish tugmasini bosing
              </div>
            </Card>
          )}

          {running && (
            <Card>
              <CardHead title="Natijalar" right={<Badge tone="warning">so'rov ketmoqda</Badge>} />
              <div className="flex items-center gap-3 py-6">
                <Loader2 className="size-6 animate-spin text-accent" />
                <div className="text-sm">
                  ASL Belgisi ga so'rov yuborilmoqda. Har bir kod uchun ~1 soniya.
                </div>
              </div>
            </Card>
          )}

          {response && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <SummaryTile label="Jami"           value={response.total}      tone="text" />
                <SummaryTile label="Muvaffaqiyatli" value={response.successful} tone="success" />
                <SummaryTile label="Xatolik"        value={response.failed}     tone="danger" />
              </div>

              <Card>
                <CardHead
                  title="Natijalar"
                  right={
                    <Button variant="outline" size="sm" onClick={downloadCsv}>
                      <Download className="size-3" /> CSV
                    </Button>
                  }
                />
                <div className="overflow-x-auto rounded-lg border border-border max-h-[560px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-surface2/60 sticky top-0 z-10">
                      <tr>
                        <Th>#</Th>
                        <Th>Marka kod</Th>
                        <Th>Status</Th>
                        <Th>Egasi</Th>
                        <Th>Mahsulot</Th>
                        <Th>Emissiya</Th>
                        <Th className="text-right">Batafsil</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {response.results.map((r, i) => (
                        <tr key={i}
                            className={cn("border-t border-border transition-colors",
                              r.success ? "hover:bg-surface2/30" : "bg-danger/5 hover:bg-danger/10",
                              selected === i && "bg-accent/10")}
                        >
                          <Td className="text-muted">{i + 1}</Td>
                          <Td className="font-mono max-w-[280px] break-all">
                            {r.basic.code || "-"}
                          </Td>
                          <Td>
                            {r.success
                              ? <StatusPill status={r.basic.status} />
                              : <Badge tone="danger" title={r.error}>xato</Badge>}
                          </Td>
                          <Td className="max-w-[220px] truncate" title={r.summary_owner}>
                            {r.success ? r.summary_owner : r.error}
                          </Td>
                          <Td className="max-w-[240px] truncate" title={r.summary_product}>
                            {r.success ? r.summary_product : "-"}
                          </Td>
                          <Td>{r.emission_date || "-"}</Td>
                          <Td className="text-right">
                            <button className="inline-flex items-center gap-1 text-accent hover:underline"
                                    onClick={() => setSelected(i)}>
                              Ochish <ChevronRight className="size-3" />
                            </button>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
        </div>
      </div>

      {selected !== null && response && (
        <DetailDrawer
          result={response.results[selected]}
          index={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

// ═════════ sub-components ═════════
function StatusPill({ status }: { status: string }) {
  const s = (status || "").toUpperCase();
  const green = ["IN_CIRCULATION","INTRODUCED","APPLIED","EMITTED","AGGREGATED"].includes(s);
  const red   = ["WITHDRAWN","RETIRED","DISAGGREGATED"].includes(s);
  const tone: any = green ? "success" : red ? "danger" : "warning";
  return <Badge tone={tone}>{status || "UNKNOWN"}</Badge>;
}

function SummaryTile({ label, value, tone }: {
  label: string; value: string | number;
  tone: "text" | "accent" | "success" | "danger" | "warning";
}) {
  const cls = tone === "accent"  ? "text-accent"
            : tone === "success" ? "text-success"
            : tone === "warning" ? "text-warning"
            : tone === "danger"  ? "text-danger"
            : "text-text";
  return (
    <div className="rounded-lg border border-border bg-surface2/40 p-3">
      <div className={`text-3xl font-extrabold ${cls}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-muted mt-0.5">{label}</div>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={cn("px-2 py-2 text-left font-semibold text-muted", className)}>{children}</th>;
}
function Td({ children, className = "", title }: { children: React.ReactNode; className?: string; title?: string }) {
  return <td className={cn("px-2 py-1.5 align-top", className)} title={title}>{children}</td>;
}

// Full-height side drawer with all sections + raw JSON.
function DetailDrawer({ result, index, onClose }: {
  result: InspectorResult; index: number; onClose: () => void;
}) {
  const [rawOpen, setRawOpen] = useState(false);
  const b = result.basic, o = result.owner, a = result.aggregation, c = result.customs;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="w-full max-w-[720px] h-full overflow-y-auto bg-surface border-l border-border shadow-2xl">
        <div className="sticky top-0 z-10 bg-surface/95 backdrop-blur border-b border-border px-5 py-3 flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-muted">Kod #{index + 1}</div>
            <div className="text-sm font-mono break-all mt-0.5">{b.code || "-"}</div>
          </div>
          <button onClick={onClose} className="text-muted hover:text-danger p-1 rounded hover:bg-danger/10">
            <X className="size-5" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          {!result.success && (
            <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
              <XCircle className="inline size-4 mr-1" /> {result.error}
            </div>
          )}

          <Section title="Egasi va emitent" icon={<Building2 className="size-4" />}>
            <Row k="Joriy egasi" v={o.owner_name} />
            <Row k="Egasi INN" v={o.owner_inn} highlight />
            <Row k="Egasi manzili" v={o.owner_address} />
            <Row k="Emitent" v={o.emitter_name} />
            <Row k="Emitent INN" v={o.emitter_inn} highlight />
            <Row k="Emitent manzili" v={o.emitter_address} />
          </Section>

          <Section title="Mahsulot" icon={<Package className="size-4" />}>
            <Row k="Status" v={<StatusPill status={b.status} />} />
            {b.status_label && <Row k="" v={<span className="text-muted">{b.status_label}</span>} />}
            <Row k="GTIN" v={b.gtin} highlight />
            <Row k="Mahsulot nomi" v={b.product_name} />
            <Row k="Mahsulot guruhi" v={joinLine(b.product_group, b.product_group_name)} />
            <Row k="TN VED" v={joinLine(b.tnved_code, b.tnved_name)} />
            <Row k="Seriya raqami" v={b.serial_number} />
            <Row k="Partiya / LOT" v={b.batch} />
            <Row k="Ishlab chiqarilgan" v={b.production_date} />
            <Row k="Yaroqlilik" v={b.expiration_date} />
            <Row k="MRP" v={b.mrp} />
          </Section>

          <Section title="Qadoqlash va agregatsiya" icon={<Truck className="size-4" />}>
            <Row k="Package Type" v={b.package_type || a.hierarchy_level} />
            <Row k="Ota kod" v={a.parent_code} highlight />
            <Row k="Ota turi" v={a.parent_type} />
            <Row k="Agregatsiya sanasi" v={a.aggregation_date} />
            <Row k="Agregatsiya hujjati" v={a.aggregation_document_id} />
            <Row k="Bolalar soni" v={a.child_codes?.length ? String(a.child_codes.length) : ""} />
          </Section>

          <Section title="Ishlab chiqarish / Bojxona" icon={<Factory className="size-4" />}>
            <Row k="Ishlab chiqaruvchi" v={o.manufacturer_name} />
            <Row k="Ishlab chiqaruvchi INN" v={o.manufacturer_inn} />
            <Row k="Ishlab chiqaruvchi mamlakat" v={o.manufacturer_country} />
            <Row k="Import qiluvchi" v={o.importer_name} />
            <Row k="Import qiluvchi INN" v={o.importer_inn} />
            <Row k="AIC kod" v={c.aic_code} />
            <Row k="Bojxona deklaratsiyasi" v={c.customs_declaration} />
            <Row k="Bojxona sanasi" v={c.customs_date} />
            <Row k="Kelib chiqish davlati" v={c.country_of_origin} />
            <Row k="Bojxona statusi" v={c.customs_status} />
          </Section>

          {result.documents.length > 0 && (
            <Section title={`Tarix (${result.documents.length})`}
                     icon={<History className="size-4" />}>
              {result.documents.map((d, i) => (
                <div key={i} className="rounded-lg border border-border bg-surface2/40 p-3 mb-2">
                  <div className="text-[11px] uppercase tracking-widest text-accent font-bold mb-1.5">
                    {d.document_type || `Hodisa ${i + 1}`}
                  </div>
                  <Row k="Sana" v={d.document_date} />
                  <Row k="Hujjat ID" v={d.document_id} highlight />
                  <Row k="Status" v={d.document_status} />
                  <Row k="Yuboruvchi"
                       v={d.sender_inn ? `${d.sender_name} (${d.sender_inn})` : d.sender_name} />
                  <Row k="Qabul qiluvchi"
                       v={d.receiver_inn ? `${d.receiver_name} (${d.receiver_inn})` : d.receiver_name} />
                  <Row k="Izoh" v={d.description} />
                </div>
              ))}
            </Section>
          )}

          <Section title="Xom JSON" icon={<FileText className="size-4" />}>
            <button onClick={() => setRawOpen(o => !o)}
                    className="text-sm text-accent hover:underline">
              {rawOpen ? "Yashirish" : "Ko'rsatish"}
            </button>
            {rawOpen && (
              <pre className="mt-2 max-h-[400px] overflow-auto rounded-lg border border-border bg-surface2/40 p-3 text-[11px] font-mono">
                {JSON.stringify(result.raw_response, null, 2)}
              </pre>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, icon, children }: {
  title: string; icon: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2 text-accent font-semibold text-sm">
        {icon} {title}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Row({ k, v, highlight }: {
  k: string; v: React.ReactNode; highlight?: boolean;
}) {
  const empty = v == null || v === "" || (typeof v === "string" && !v.trim());
  if (empty && k !== "") return null;
  return (
    <div className="flex items-start justify-between gap-3 py-1 border-b border-border/50 last:border-b-0 text-sm">
      <span className="text-muted text-xs w-[45%]">{k}</span>
      <span className={cn("text-right break-all", highlight && "text-accent font-semibold")}>
        {empty ? "-" : v}
      </span>
    </div>
  );
}

function joinLine(a: string, b: string): string {
  if (!a && !b) return "";
  if (a && b) return `${a} — ${b}`;
  return a || b;
}
