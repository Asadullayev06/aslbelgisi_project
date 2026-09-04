import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, Search, Key, Building2, CheckCircle2, XCircle, Loader2,
  Download, FileArchive, Sparkles, ScanBarcode, Filter, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHead } from "@/components/ui/Card";
import { Field, Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { ChipGroup } from "@/components/ui/ChipGroup";
import { Toaster, useFlashes } from "@/components/ui/Toast";
import { api } from "@/api";
import type { StockRow, StockResultResp } from "@/types";

const PACKAGE_TYPES  = ["UNIT", "GROUP", "SET", "BOX_LV_1", "BOX_LV_2"];
const STATUSES       = ["EMITTED", "APPLIED", "INTRODUCED", "WITHDRAWN", "WRITTEN_OFF"];
const EMISSION_TYPES = ["PRIMARY", "REMAINS", "COMISSION", "REMARK", "EXTERNAL"];
const RELEASE_METHODS = ["IMPORT", "PRODUCTION", "CIRCULATION"];

type OutputMode = "full" | "km_only";

type KmOnlyResult = {
  ok: boolean; export_id: string; km_codes: string[];
  row_count: number; transport_count: number;
  warnings: string[]; fetched_at: string; error: string;
};

type Phase =
  | { kind: "idle" }
  | { kind: "registering" }
  | { kind: "polling"; exportId: string; status: string; startedAt: number; mode: OutputMode }
  | { kind: "done"; result: StockResultResp }
  | { kind: "done_km"; result: KmOnlyResult }
  | { kind: "error"; message: string; recoverableExportId?: string };

// ── emission-date window ─────────────────────────────────
// ASL's export has a hard 10MB cap, no pagination (limit/page/offset/size are
// silently accepted and ignored), and codeHistory — which dominates the
// payload — cannot be disabled. Confirmed by ASL support. Narrowing the
// filters is therefore the ONLY lever, so the date range is offered as a
// manual filter. Note it cannot help when the codes were all registered by a
// single document: bulk customs registration gives them a near-identical
// emission timestamp, so no date window separates them.
type Win = { from: string; to: string };   // inclusive, "YYYY-MM-DD"

const DAY_MS = 86400000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function GtinStock({ onExit }: { onExit: () => void }) {
  // auth (per-company — not our app's login; ASL's business-user credentials)
  const [inn, setInn] = useState("");
  const [aslKey, setAslKey] = useState("");
  const [verified, setVerified] = useState<{ inn: string } | null>(null);
  const [verifying, setVerifying] = useState(false);

  // filters
  const [gtin, setGtin] = useState("");
  const [packageTypes,  setPackageTypes]  = useState<string[]>(["UNIT"]);
  const [statuses,      setStatuses]      = useState<string[]>(["INTRODUCED"]);
  const [emissionTypes, setEmissionTypes] = useState<string[]>(["PRIMARY"]);
  const [releaseMethods, setReleaseMethods] = useState<string[]>(["IMPORT"]);
  const [productSeries, setProductSeries] = useState("");
  const [mode, setMode] = useState<OutputMode>("full");
  // Bounds for the auto-bisect. Narrower = far fewer ASL round-trips, so the
  // default is a 3-year look-back rather than "all time".
  const [dateFrom, setDateFrom] = useState(
    isoDay(Date.now() - 3 * 365 * DAY_MS));
  const [dateTo, setDateTo] = useState(isoDay(Date.now()));
  const cancelRef = useRef(false);

  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const { flashes, push, dismiss } = useFlashes();

  const pollTimer = useRef<number | null>(null);
  useEffect(() => () => { if (pollTimer.current) clearInterval(pollTimer.current); }, []);

  // ── auth ─────────────────────────────────────────────
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
    setVerified(null); setAslKey(""); setPhase({ kind: "idle" });
  }

  // ── run / poll ───────────────────────────────────────
  function startPolling(exportId: string, outputMode: OutputMode = mode) {
    if (pollTimer.current) clearInterval(pollTimer.current);
    setPhase({ kind: "polling", exportId, status: "CREATED",
               startedAt: Date.now(), mode: outputMode });
    const tick = async () => {
      try {
        const s = await api.stockStatus(exportId, aslKey.trim());
        if (!s.ok) {
          if (pollTimer.current) clearInterval(pollTimer.current);
          setPhase({ kind: "error", message: s.error || "status failed", recoverableExportId: exportId });
          return;
        }
        if (s.status === "SUCCESS" || s.ready) {
          if (pollTimer.current) clearInterval(pollTimer.current);
          if (outputMode === "km_only") {
            // 9.3 flow — unpack transports to KMs. Takes longer, so show
            // a distinct "unpacking" phase.
            setPhase({ kind: "polling", exportId,
                       status: "UNPACKING (9.3)", startedAt: Date.now(),
                       mode: outputMode });
            const r = await api.stockKmOnly(
              exportId, aslKey.trim(), inn.trim(), productSeries.trim());
            if (r.ok) {
              setPhase({ kind: "done_km", result: r });
              push("hit", `Tayyor: ${r.row_count} ta KM kod`);
            } else {
              setPhase({ kind: "error",
                         message: r.error || "km-only fetch failed" });
            }
            return;
          }
          const r = await api.stockResult(exportId, aslKey.trim(), productSeries.trim());
          if (r.ok) {
            setPhase({ kind: "done", result: r });
            push("hit", `Tayyor: ${r.row_count} ta kod`);
          } else {
            setPhase({ kind: "error", message: r.error || "result fetch failed" });
          }
          return;
        }
        if (s.status === "ERROR") {
          if (pollTimer.current) clearInterval(pollTimer.current);
          setPhase({ kind: "error",
            message: "ASL export ERROR bilan tugadi — filtrni toraytiring." });
          return;
        }
        if (s.status === "EXPIRED") {
          if (pollTimer.current) clearInterval(pollTimer.current);
          setPhase({ kind: "error", message: "ASL export muddati o'tdi. Qayta urinib ko'ring." });
          return;
        }
        // still processing
        setPhase(p => p.kind === "polling"
          ? { ...p, status: s.status || "PROCESSING" } : p);
      } catch (e: any) {
        if (pollTimer.current) clearInterval(pollTimer.current);
        setPhase({ kind: "error", message: String(e.message || e), recoverableExportId: exportId });
      }
    };
    // fire immediately, then every 3s
    tick();
    pollTimer.current = window.setInterval(tick, 3000);
  }

  // ── windowed fetch primitives ────────────────────────
  /** Register one export (optionally date-windowed) and wait for a terminal
   *  status. Returns the export id plus the final ASL status. */
  async function fetchWindow(w: Win | null): Promise<{ status: string; exportId: string }> {
    const r = await api.stockRegister({
      inn: inn.trim(), api_key: aslKey.trim(), gtin: gtin.trim(),
      package_types: packageTypes, statuses,
      emission_types: emissionTypes, release_methods: releaseMethods,
      product_series: productSeries.trim(),
      emission_date_from: w?.from ?? "",
      emission_date_to:   w?.to   ?? "",
    });
    if (!r.ok) throw new Error(r.error || "register failed");
    for (;;) {
      if (cancelRef.current) throw new Error("bekor qilindi");
      const s = await api.stockStatus(r.export_id, aslKey.trim());
      if (!s.ok) throw new Error(s.error || "status failed");
      if (s.status === "SUCCESS" || s.ready) return { status: "SUCCESS", exportId: r.export_id };
      if (["ERROR", "EXPIRED", "FAILED"].includes(s.status))
        return { status: s.status, exportId: r.export_id };
      setPhase(p => p.kind === "polling"
        ? { ...p, status: s.status || "PROCESSING" } : p);
      await sleep(3000);
    }
  }

  /** Pull the payload for a finished export, honouring the output mode. */
  async function collect(exportId: string) {
    if (mode === "km_only") {
      const r = await api.stockKmOnly(exportId, aslKey.trim(), inn.trim(),
                                      productSeries.trim());
      if (!r.ok) throw new Error(r.error || "km-only fetch failed");
      return { km: r as KmOnlyResult, full: null as StockResultResp | null };
    }
    const r = await api.stockResult(exportId, aslKey.trim(), productSeries.trim());
    if (!r.ok) throw new Error(r.error || "result fetch failed");
    return { km: null as KmOnlyResult | null, full: r as StockResultResp };
  }

  async function runSearch() {
    if (!verified) { push("err", "Avval INN + API kalitni tekshiring"); return; }
    if (!gtin.trim() || !gtin.trim().match(/^\d+$/)) {
      push("err", "GTIN faqat raqamlardan iborat bo'lishi kerak");
      return;
    }
    if (pollTimer.current) clearInterval(pollTimer.current);
    cancelRef.current = false;
    setPhase({ kind: "registering" });

    try {
      // 1. Fast path — try the whole GTIN with no date window.
      setPhase({ kind: "polling", exportId: "—", status: "CREATED",
                 startedAt: Date.now(), mode });
      const first = await fetchWindow(null);
      if (first.status === "SUCCESS") {
        const got = await collect(first.exportId);
        if (got.km) {
          setPhase({ kind: "done_km", result: got.km });
          push("hit", `Tayyor: ${got.km.row_count} ta KM kod`);
        } else {
          setPhase({ kind: "done", result: got.full! });
          push("hit", `Tayyor: ${got.full!.row_count} ta kod`);
        }
        return;
      }
      if (first.status === "EXPIRED") {
        setPhase({ kind: "error", message: "ASL export muddati o'tdi. Qayta urinib ko'ring." });
        return;
      }
      if (first.status !== "ERROR") {
        setPhase({ kind: "error", message: `ASL export holati: ${first.status}` });
        return;
      }

      // 2. ERROR == the result is over ASL's hard 10MB export cap.
      //
      // There is NO API-side way around this, confirmed by ASL support:
      //   * no pagination — limit/page/offset/size/pageSize/maxSize are all
      //     silently accepted and ignored (unknown fields aren't validated);
      //   * codeHistory (which dominates the payload) cannot be turned off;
      //   * the 10MB cap is fixed.
      // Narrowing the filters is the only lever, and even that fails when the
      // codes were all registered by one document (bulk customs registration
      // gives them a near-identical emission timestamp, so no date window can
      // separate them). In that case the operator must request the code list
      // from ASL by official letter.
      //
      // We deliberately do NOT return a partial result here — a half-filled
      // stock list that looks complete is worse than an honest failure.
      setPhase({ kind: "error", message:
        "Natija ASL ning 10 MB limitidan katta — ASL eksportni ERROR bilan qaytardi.\n\n"
        + "ASL API da sahifalash (pagination) yo'q va javob hajmini kamaytirib "
        + "bo'lmaydi, shuning uchun bu kodlarni API orqali bo'lib yuklashning "
        + "iloji yo'q.\n\n"
        + "Nima qilish mumkin:\n"
        + "• Filtrni toraytiring — LOT/seriya, emissiya sanasi oralig'i, "
        + "packageType yoki status bo'yicha.\n"
        + "• Agar kodlar bitta hujjat bilan ro'yxatdan o'tgan bo'lsa "
        + "(masalan bojxona registratsiyasi), sana bo'yicha bo'lish yordam "
        + "bermaydi — bu holda ASL Belgisi ga rasmiy xat yozib, kodlar "
        + "ro'yxatini so'rash kerak." });
      return;
    } catch (e: any) {
      setPhase({ kind: "error", message: String(e.message || e) });
    }
  }

  function cancelRun() {
    cancelRef.current = true;
    if (pollTimer.current) clearInterval(pollTimer.current);
  }

  function recheck() {
    if (phase.kind === "error" && phase.recoverableExportId) {
      startPolling(phase.recoverableExportId);
    }
  }

  // ── downloads ────────────────────────────────────────
  function downloadCsv() {
    if (phase.kind !== "done") return;
    const rows = phase.result.rows;
    const cols: (keyof StockRow)[] = [
      "code","gtin","product_name","product_series","status","extended_status",
      "package_type","expiration_date","parent_code","owner_tin","owner_business_place_id",
    ];
    const esc = (v: any) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = cols.join(",");
    const body = rows.map(r => cols.map(c => esc(r[c])).join(",")).join("\n");
    const blob = new Blob(["﻿" + header + "\n" + body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const ts = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 15);
    a.href = url; a.download = `gtin_stock_${gtin.trim()}_${ts}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function downloadZip() {
    if (phase.kind !== "done" || !phase.result.zip_b64) return;
    const bin = atob(phase.result.zip_b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const blob = new Blob([arr], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `asl_stock_export_${phase.result.export_id}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── summaries (derived) ───────────────────────────────
  const rows = phase.kind === "done" ? phase.result.rows : [];
  const bySeries      = useMemo(() => summarize(rows, "product_series"), [rows]);
  const byStatus      = useMemo(() => summarize(rows, "status"),         [rows]);
  const byPackageType = useMemo(() => summarize(rows, "package_type"),   [rows]);
  const byExpiration  = useMemo(() => summarize(rows, "expiration_date"),[rows]);

  const first = rows[0];
  const productName = first?.product_name || "-";
  const ownerName   = first?.owner_name   || "-";
  const ownerTin    = first?.owner_tin    || "-";

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-6">
      <Toaster flashes={flashes} onDismiss={dismiss} />

      {/* Top bar */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <button onClick={onExit} className="text-muted hover:text-text inline-flex items-center gap-1">
          <ArrowLeft className="size-4" /> Bosh sahifa
        </button>
        <div className="text-right">
          <div className="text-3xl font-extrabold tracking-tight text-accent flex items-center gap-2 justify-end">
            <ScanBarcode className="size-7" /> GTIN Ostatok
          </div>
          <div className="text-muted text-sm">Asl Belgisi da real vaqtdagi kompaniya qoldiqlari</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-4">
        {/* LEFT — auth + filters */}
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
                <div className="text-sm">
                  INN <b>{verified.inn}</b> tasdiqlangan
                </div>
                <Button variant="outline" size="sm" onClick={resetAuth}>
                  <RefreshCw className="size-3" /> Boshqa hisob
                </Button>
              </div>
            )}
          </Card>

          <Card>
            <CardHead title="Qidiruv filtrlari"
                      right={<Badge tone="accent"><Filter className="size-3" /> filtr</Badge>} />

            <div className="grid grid-cols-1 gap-3">
              <Field label="GTIN">
                <div className="relative">
                  <Search className="absolute left-3 top-3 size-4 text-muted" />
                  <Input className="pl-9" value={gtin} onChange={e => setGtin(e.target.value)}
                         placeholder="masalan 08806495083113" />
                </div>
              </Field>

              <Field label="Package Type" hint="UNIT = bittalik, GROUP = guruh">
                <ChipGroup options={PACKAGE_TYPES} selected={packageTypes} onChange={setPackageTypes} />
              </Field>

              <Field label="Status" hint="INTRODUCED = aylanmadagi qoldiq">
                <ChipGroup options={STATUSES} selected={statuses} onChange={setStatuses} />
              </Field>

              <Field label="Emission Type">
                <ChipGroup options={EMISSION_TYPES} selected={emissionTypes} onChange={setEmissionTypes} />
              </Field>

              <Field label="Release Method">
                <ChipGroup options={RELEASE_METHODS} selected={releaseMethods} onChange={setReleaseMethods} />
              </Field>

              <Field label="LOT / Series (ixtiyoriy)">
                <Input value={productSeries} onChange={e => setProductSeries(e.target.value)}
                       placeholder="masalan 5133010" />
              </Field>
            </div>

            {/* ASL caps an export at 10MB with no pagination and no way to
                shrink the payload, so narrowing the filters is the only lever
                the operator has when an export comes back ERROR. */}
            <div className="mt-4">
              <div className="text-xs uppercase tracking-widest text-muted mb-2">
                Emissiya sanasi oralig'i (ixtiyoriy)
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Dan">
                  <Input type="date" value={dateFrom}
                         onChange={e => setDateFrom(e.target.value)} />
                </Field>
                <Field label="Gacha">
                  <Input type="date" value={dateTo}
                         onChange={e => setDateTo(e.target.value)} />
                </Field>
              </div>
              <div className="text-xs text-muted mt-1.5">
                ASL eksporti eng ko'pi bilan 10&nbsp;MB qaytaradi va sahifalash
                (pagination) yo'q. Kodlar ko'p bo'lsa eksport ERROR bilan
                tugaydi — bunda oraliqni toraytiring yoki LOT/seriya bo'yicha
                filtrlang. Bo'sh qoldirsangiz butun davr olinadi.
              </div>
            </div>

            {/* Output mode — FULL = 9.1 export (KM + SSCC + series);
                 KM ONLY = 9.1 export followed by 9.3 nested-codes/owner-check
                 to unpack each transport code into its child KMs. */}
            <div className="mt-4">
              <div className="text-xs uppercase tracking-widest text-muted mb-2">
                Natija turi
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <button type="button"
                        onClick={() => setMode("full")}
                        className={"text-left rounded-xl border p-3 transition-colors " +
                          (mode === "full"
                            ? "border-accent bg-accent/10"
                            : "border-border bg-surface2/40 hover:border-accent/50")}>
                  <div className="flex items-center gap-2 mb-1">
                    <div className={"size-4 rounded-full border-2 " +
                      (mode === "full" ? "border-accent bg-accent" : "border-border")} />
                    <div className="font-semibold text-sm">To'liq (joriy)</div>
                  </div>
                  <div className="text-xs text-muted leading-snug">
                    KM + SSCC + seriya · barcha ustunlar bilan · 9.1 metod
                  </div>
                </button>
                <button type="button"
                        onClick={() => setMode("km_only")}
                        className={"text-left rounded-xl border p-3 transition-colors " +
                          (mode === "km_only"
                            ? "border-accent bg-accent/10"
                            : "border-border bg-surface2/40 hover:border-accent/50")}>
                  <div className="flex items-center gap-2 mb-1">
                    <div className={"size-4 rounded-full border-2 " +
                      (mode === "km_only" ? "border-accent bg-accent" : "border-border")} />
                    <div className="font-semibold text-sm">Faqat KM kodlar</div>
                  </div>
                  <div className="text-xs text-muted leading-snug">
                    Transport kodlar ichini ochib · 9.3 metod · sekinroq
                  </div>
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-2">
              <Button variant="primary" size="lg" onClick={runSearch}
                      disabled={!verified || phase.kind === "registering"
                                || phase.kind === "polling"}>
                {phase.kind === "registering" && <><Loader2 className="size-4 animate-spin" /> Yuborilmoqda…</>}
                {phase.kind === "polling"     && <><Loader2 className="size-4 animate-spin" /> Kutilmoqda…</>}
                {!(phase.kind === "registering" || phase.kind === "polling") &&
                  <><Sparkles className="size-4" /> Ostatokni yuklash</>}
              </Button>
              <Button variant="secondary" onClick={() => {
                setPackageTypes(["UNIT"]); setStatuses(["INTRODUCED"]);
                setEmissionTypes([]); setReleaseMethods([]); setProductSeries("");
                push("hit", "Kengaytirilgan qidiruv sozlandi");
              }}>
                Tavsiya etilgan keng qidiruv (faqat GTIN + INTRODUCED)
              </Button>
            </div>
          </Card>
        </div>

        {/* RIGHT — status + results */}
        <div className="flex flex-col gap-4">
          <StatusPanel phase={phase} onRecheck={recheck} onCancel={cancelRun} />

          {phase.kind === "done_km" && (
            <KmOnlyResult result={phase.result} gtin={gtin.trim()} />
          )}

          {phase.kind === "done" && (
            <>
              {/* Summary tiles */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <SummaryTile label="Egalikdagi KM" value={phase.result.row_count.toLocaleString()} tone="accent" />
                <SummaryTile label="ASL dan qaytgan"    value={phase.result.raw_result_count.toLocaleString()} />
                <SummaryTile label="LOT / seriyalar"    value={new Set(rows.map(r => r.product_series).filter(Boolean)).size.toLocaleString()} />
                <SummaryTile label="Statuslar"          value={new Set(rows.map(r => r.status).filter(Boolean)).size.toLocaleString()} />
              </div>

              <Card>
                <CardHead
                  title="Mahsulot"
                  right={<Badge tone="neutral">Export {phase.result.export_id}</Badge>}
                />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                  <Line label="Mahsulot nomi" value={productName} />
                  <Line label="Egasi" value={`${ownerName} (${ownerTin})`} />
                  <Line label="Yuklab olindi" value={phase.result.fetched_at.replace("T", " ")} />
                </div>
                <div className="mt-3 flex gap-2 flex-wrap">
                  <Button variant="primary" onClick={downloadCsv}>
                    <Download className="size-4" /> CSV yuklab olish
                  </Button>
                  <Button variant="outline" onClick={downloadZip}
                          disabled={!phase.result.zip_b64}>
                    <FileArchive className="size-4" /> Xom ZIP (ASL)
                  </Button>
                </div>
              </Card>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <SummaryTable title="LOT / Series bo'yicha" data={bySeries} />
                <SummaryTable title="Status bo'yicha"       data={byStatus} />
                <SummaryTable title="Package Type bo'yicha" data={byPackageType} />
              </div>

              {byExpiration.length > 0 && (
                <Card>
                  <CardHead title="Yaroqlilik muddati bo'yicha" />
                  <TableView data={byExpiration} />
                </Card>
              )}

              <Card>
                <CardHead title="Batafsil kodlar"
                          right={<Badge tone="accent">{rows.length.toLocaleString()}</Badge>} />
                {rows.length === 0 ? (
                  <EmptyResult result={phase.result} />
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-border max-h-[520px]">
                    <table className="w-full text-xs">
                      <thead className="bg-surface2/60 sticky top-0">
                        <tr>
                          {["code","gtin","name","series","status","package","exp","parent","owner INN","owner MOD"]
                            .map(h => <th key={h} className="px-2 py-1.5 text-left font-semibold text-muted">{h}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.slice(0, 500).map((r, i) => (
                          <tr key={r.code + i} className="border-t border-border hover:bg-surface2/30">
                            <Td className="font-mono break-all">{r.code}</Td>
                            <Td className="font-mono">{r.gtin}</Td>
                            <Td>{r.product_name}</Td>
                            <Td>{r.product_series}</Td>
                            <Td>{r.status}</Td>
                            <Td>{r.package_type}</Td>
                            <Td>{r.expiration_date}</Td>
                            <Td className="font-mono">{r.parent_code}</Td>
                            <Td>{r.owner_tin}</Td>
                            <Td>{r.owner_business_place_id}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {rows.length > 500 && (
                      <div className="text-xs text-muted p-2 text-center">
                        Birinchi 500 ta ko'rsatilmoqda. To'liq ro'yxat uchun CSV yuklab oling.
                      </div>
                    )}
                  </div>
                )}
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ═════════ helpers / sub-components ═════════
function StatusPanel({ phase, onRecheck, onCancel }: {
  phase: Phase; onRecheck: () => void; onCancel: () => void;
}) {
  if (phase.kind === "idle") {
    return (
      <Card>
        <CardHead title="Holat" right={<Badge tone="neutral">tayyor</Badge>} />
        <div className="text-muted text-sm py-8 text-center italic">
          GTIN kiriting va "Ostatokni yuklash" tugmasini bosing
        </div>
      </Card>
    );
  }
  if (phase.kind === "registering") {
    return (
      <Card>
        <CardHead title="Holat" right={<Badge tone="warning">ro'yxatga olinmoqda</Badge>} />
        <div className="flex items-center gap-3 py-4">
          <Loader2 className="size-5 animate-spin text-accent" />
          <div className="text-sm">ASL ga so'rov yuborilmoqda…</div>
        </div>
      </Card>
    );
  }
  if (phase.kind === "polling") {
    const secs = Math.max(0, Math.round((Date.now() - phase.startedAt) / 1000));
    return (
      <Card>
        <CardHead title="Holat"
                  right={<Badge tone="warning">{phase.status}</Badge>} />
        <div className="flex items-center gap-3 py-4">
          <Loader2 className="size-5 animate-spin text-warning" />
          <div className="flex-1">
            <div className="text-sm">ASL faylni tayyorlamoqda…</div>
            <div className="text-xs text-muted mt-0.5">Export ID: <span className="font-mono">{phase.exportId}</span> · {secs}s</div>
          </div>
          <Button variant="outline" size="sm" onClick={onCancel}>
            <XCircle className="size-4" /> To'xtatish
          </Button>
        </div>
      </Card>
    );
  }
  if (phase.kind === "error") {
    return (
      <Card>
        <CardHead title="Holat" right={<Badge tone="danger"><XCircle className="size-3" /> xato</Badge>} />
        <div className="text-danger text-sm whitespace-pre-line break-words">{phase.message}</div>
        {phase.recoverableExportId && (
          <Button variant="outline" className="mt-3" onClick={onRecheck}>
            <RefreshCw className="size-4" /> Qayta tekshirish
          </Button>
        )}
      </Card>
    );
  }
  if (phase.kind === "done_km") {
    return (
      <Card>
        <CardHead title="Holat"
                  right={<Badge tone="success"><CheckCircle2 className="size-3" /> tayyor</Badge>} />
        <div className="text-sm">
          Export <span className="font-mono">{phase.result.export_id}</span> yuklandi —{" "}
          <b>{phase.result.row_count.toLocaleString()} ta KM kod</b>
          {phase.result.transport_count > 0 && (
            <> · {phase.result.transport_count} transport kodidan ochildi</>
          )}
        </div>
      </Card>
    );
  }
  return (
    <Card>
      <CardHead title="Holat"
                right={<Badge tone="success"><CheckCircle2 className="size-3" /> tayyor</Badge>} />
      <div className="text-sm">
        Export <span className="font-mono">{phase.result.export_id}</span> yuklandi — {phase.result.row_count.toLocaleString()} ta kod.
      </div>
    </Card>
  );
}

function EmptyResult({ result }: { result: StockResultResp }) {
  if (result.available_series.length > 0) {
    return (
      <div className="text-warning text-sm">
        Bu GTIN uchun kodlar bor, lekin kiritilgan LOT / Series ga mos kelmadi. <br />
        Mavjud seriyalar: <b className="font-mono">{result.available_series.join(", ")}</b>
      </div>
    );
  }
  if (result.raw_result_count === 0) {
    return <div className="text-muted text-sm italic">Bu filtrlar bo'yicha hech nima topilmadi.</div>;
  }
  return (
    <div className="text-warning text-sm">
      ASL javob berdi, lekin kodlar formati kutilgan shaklda emas. Xom ZIP ni yuklab tekshiring.
    </div>
  );
}

function summarize(rows: StockRow[], col: keyof StockRow): { key: string; count: number }[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const k = (r[col] ?? "").toString().trim() || "-";
    map.set(k, (map.get(k) || 0) + 1);
  }
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
}

function SummaryTile({ label, value, tone = "text" }:
  { label: string; value: string; tone?: "text" | "accent" }) {
  return (
    <div className="rounded-lg border border-border bg-surface2/40 p-3">
      <div className={"text-2xl font-extrabold " + (tone === "accent" ? "text-accent" : "text-text")}>
        {value}
      </div>
      <div className="text-[11px] uppercase tracking-wide text-muted mt-0.5">{label}</div>
    </div>
  );
}

function SummaryTable({ title, data }: { title: string; data: { key: string; count: number }[] }) {
  return (
    <Card>
      <CardHead title={title} right={<Badge tone="neutral">{data.length}</Badge>} />
      {data.length === 0 ? (
        <div className="text-muted text-sm italic">-</div>
      ) : (
        <TableView data={data} />
      )}
    </Card>
  );
}

function TableView({ data }: { data: { key: string; count: number }[] }) {
  return (
    <div className="overflow-hidden rounded border border-border max-h-64 overflow-y-auto">
      <table className="w-full text-xs">
        <thead className="bg-surface2/60 sticky top-0">
          <tr>
            <th className="px-2 py-1.5 text-left font-semibold text-muted">Qiymat</th>
            <th className="px-2 py-1.5 text-right font-semibold text-muted">Soni</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.key} className="border-t border-border">
              <Td>{d.key}</Td>
              <Td className="text-right font-mono">{d.count.toLocaleString()}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-2 py-1.5 ${className}`}>{children}</td>;
}
function Line({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className="text-sm mt-0.5 break-all">{value}</div>
    </div>
  );
}


function KmOnlyResult({ result, gtin }: { result: KmOnlyResult; gtin: string }) {
  function download(kind: "txt" | "csv") {
    const body = result.km_codes.join("\n") + "\n";
    const blob = new Blob(
      kind === "csv" ? ["﻿" + body] : [body],
      { type: kind === "csv" ? "text/csv;charset=utf-8" : "text/plain;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.download = `KM_only_${gtin || "export"}_${ts}.${kind}`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <SummaryTile label="KM kodlar" value={result.row_count.toLocaleString()} tone="accent" />
        <SummaryTile label="Transport kodi ochildi" value={result.transport_count.toLocaleString()} />
        <SummaryTile label="Ogohlantirishlar" value={result.warnings.length.toLocaleString()} />
      </div>

      <Card>
        <CardHead
          title="KM kodlar (9.3)"
          right={<>
            <Badge tone="accent">{result.row_count.toLocaleString()}</Badge>
            <Button variant="outline" size="sm" onClick={() => download("csv")}>
              <Download className="size-3" /> CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => download("txt")}>
              <Download className="size-3" /> TXT
            </Button>
          </>}
        />
        {result.km_codes.length === 0 ? (
          <div className="text-muted text-sm italic py-6 text-center">
            Transport kodlarni ochib bo'lmadi. Filtrni tekshiring yoki 9.1 metodga o'ting.
          </div>
        ) : (
          <div className="rounded-lg border border-border max-h-[520px] overflow-auto">
            <ul className="divide-y divide-border">
              {result.km_codes.slice(0, 500).map((c, i) => (
                <li key={c} className="px-3 py-1.5 flex items-center gap-3">
                  <span className="text-xs text-muted w-10 shrink-0 text-right">{i + 1}</span>
                  <span className="font-mono text-xs break-all">{c}</span>
                </li>
              ))}
            </ul>
            {result.km_codes.length > 500 && (
              <div className="p-3 text-xs text-muted text-center border-t border-border">
                Faqat birinchi 500 ta ko'rsatildi. To'liq ro'yxatni CSV yoki TXT dan oling.
              </div>
            )}
          </div>
        )}

        {result.warnings.length > 0 && (
          <div className="mt-3 rounded-lg border border-warning/40 bg-warning/5 p-3">
            <div className="text-xs font-semibold text-warning mb-1">
              {result.warnings.length} ta transport kodi ochilmadi
            </div>
            <div className="text-xs text-muted max-h-32 overflow-auto font-mono">
              {result.warnings.slice(0, 30).map((w, i) => (
                <div key={i} className="break-all">{w}</div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
