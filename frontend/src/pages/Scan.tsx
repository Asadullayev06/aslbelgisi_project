import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft, Undo2, PackageMinus, Package, Send, CheckCircle2, AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHead } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Field, Input } from "@/components/ui/Input";
import { Progress } from "@/components/ui/Progress";
import { Toaster, useFlashes } from "@/components/ui/Toast";
import { BoxSlotGrid } from "@/components/BoxSlotGrid";
import { KmSlotGrid } from "@/components/KmSlotGrid";
import { ClosedBoxes } from "@/components/ClosedBoxes";
import { MissingPanel } from "@/components/MissingPanel";
import { ScanInput, type ScanInputHandle } from "@/components/ScanInput";
import { api } from "@/api";
import { useAuth, isAdmin } from "@/auth";
import { AiAnalysisButton } from "@/components/AiAnalysisButton";
import type { ScanEventOut, ScanState, SubmitResponse, ValidateResult } from "@/types";

interface Props {
  projectId: number;
  onExit: () => void;
}

/** Must not exceed the server's MAX_BATCH. */
const MAX_BATCH = 200;

export function Scan({ projectId, onExit }: Props) {
  const { user } = useAuth();
  const admin = isAdmin(user);
  const [state, setState] = useState<ScanState | null>(null);
  const [loadingErr, setLoadingErr] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<ValidateResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<SubmitResponse | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [inn, setInn] = useState("");
  const [businessPlaceId, setBusinessPlaceId] = useState("");
  const [productionOrderId, setProductionOrderId] = useState("");
  const [modList, setModList] = useState<{ id: string; name: string }[] | null>(null);
  const [modLoading, setModLoading] = useState(false);
  const { flashes, push, dismiss } = useFlashes();
  const scannerRef = useRef<ScanInputHandle>(null);

  // ── scan queue ────────────────────────────────────────────
  // A barcode gun fires faster than the round-trip to Neon. Previously each
  // Enter started its own fetch: responses raced, the last one to land won,
  // and any request that failed took its barcode with it. Now every scan goes
  // into a FIFO that is drained strictly one at a time, with retries, and a
  // code is only dropped from the queue once the server has ruled on it.
  const queueRef    = useRef<string[]>([]);
  const drainingRef = useRef(false);
  const lastAppliedRef = useRef(0);          // when we last applied scan state
  const [queued, setQueued]   = useState(0);
  const [rejects, setRejects] = useState<{ code: string; reason: string }[]>([]);
  // Server-side audit log: survives reload and covers BOTH operators, so a
  // "I scanned 150 but it says 148" question always has an answer.
  const [history, setHistory] = useState<ScanEventOut[] | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);

  /** Apply state that came from a write. Stamps the clock so an in-flight
   *  poll started earlier can't land afterwards and undo it. */
  const applyState = useCallback((s: ScanState) => {
    setState(s);
    lastAppliedRef.current = Date.now();
  }, []);

  // Initial load + live polling. Polling refreshes counters, closed-box list,
  // and other operators' work without touching the scan input's DOM element
  // (React reconciles by key; the input keeps its focus).
  useEffect(() => {
    let alive = true;
    const load = (force = false) => {
      // While the queue is draining, scan replies are the freshest truth and
      // a poll would only add contention — and could land with a stale count.
      if (!force && drainingRef.current) return;
      const startedAt = Date.now();
      api.getProject(projectId)
        .then(s => {
          if (!alive) return;
          // Discard a poll that a scan overtook while it was in flight.
          if (!force && lastAppliedRef.current > startedAt) return;
          setState(s);
          // Prefill submit credentials from whatever was saved to the project
          // (e.g. a prior submit attempt). Only fill if the field is empty
          // so we never clobber what the operator is typing.
          setBusinessPlaceId(v => v || s.project.business_place_id || "");
          setProductionOrderId(v => v || s.project.production_order_id || "");
        })
        .catch(e => { if (alive) setLoadingErr(String(e)); });
    };
    load(true);
    const t = setInterval(() => load(), 2000);
    return () => { alive = false; clearInterval(t); };
  }, [projectId]);

  const boxFull = !!state && state.current_codes.length >= state.current_capacity;
  const looseMode = !!state && state.current_is_loose;

  // Explicit type: the body references `drain` at the end, and without an
  // annotation TS can't infer a self-referential initializer.
  const drain = useCallback<() => Promise<void>>(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    try {
      while (queueRef.current.length) {
        // Take everything waiting, not one code. A round-trip to Neon costs
        // ~80ms whether it carries 1 code or 100, so the faster the operator
        // scans the bigger the batch gets and the queue self-levels.
        const batch = queueRef.current.slice(0, MAX_BATCH);
        let settled = false;

        // `attempt` tells the server that a code already sitting in our own
        // open box is a redelivery, not a duplicate — so retrying after a
        // dropped response can't produce a false error.
        for (let attempt = 1; attempt <= 4 && !settled; attempt++) {
          try {
            const res = await api.scanBatch(projectId, batch, attempt);
            applyState(res.state);
            const bad = res.results.filter(r => r.level !== "hit");
            if (bad.length) {
              setRejects(r => [
                ...bad.map(b => ({ code: b.code, reason: b.message })), ...r,
              ].slice(0, 500));
            }
            // One toast for the batch, plus the last rejection reason — a
            // toast per code would be unreadable at this speed.
            const last = res.results[res.results.length - 1];
            if (bad.length === 0) {
              if (last) push("hit", last.message);
            } else {
              push("err", `${bad.length} ta rad etildi · ${bad[bad.length - 1].message}`);
            }
            settled = true;
          } catch (e: any) {
            const status = e?.status as number | undefined;
            // 4xx is the server's verdict — retrying won't change it.
            if (status && status >= 400 && status < 500) {
              const reason = String(e.message || e);
              push("err", reason);
              setRejects(r => [...batch.map(c => ({ code: c, reason })), ...r].slice(0, 500));
              settled = true;
            } else if (attempt === 4) {
              const reason = `ulanish xatosi: ${String(e?.message || e)}`;
              push("err", reason);
              setRejects(r => [...batch.map(c => ({ code: c, reason })), ...r].slice(0, 500));
              settled = true;
            } else {
              await new Promise(r => setTimeout(r, 250 * attempt));
            }
          }
        }

        queueRef.current.splice(0, batch.length);
        setQueued(queueRef.current.length);
      }
    } finally {
      drainingRef.current = false;
      scannerRef.current?.focus();
    }
    // Belt and braces: if anything slipped in as we were closing down, keep
    // going. Nothing may be left sitting in the queue unsent.
    if (queueRef.current.length) void drain();
  }, [projectId, push, applyState]);

  // Called synchronously on every Enter — never awaits, so the gun can keep
  // firing while earlier codes are still in flight.
  const handleScan = useCallback((raw: string) => {
    queueRef.current.push(raw);
    setQueued(queueRef.current.length);
    void drain();
  }, [drain]);

  async function loadHistory() {
    setHistoryBusy(true);
    try {
      setHistory(await api.scanEvents(projectId, "err", 300));
    } catch (e: any) {
      push("err", String(e.message || e));
    }
    setHistoryBusy(false);
  }

  async function doUndo() {
    try {
      const r = await api.undo(projectId);
      applyState(r.state); push(r.level, r.message);
    } catch (e: any) { push("err", String(e.message || e)); }
    scannerRef.current?.focus();
  }
  async function doDiscard() {
    if (!confirm("Joriy qutini tozalash — bunda kodlar ro'yxatga qaytadi. Davom etamizmi?")) return;
    try {
      const r = await api.discard(projectId);
      applyState(r.state); push(r.level, r.message);
    } catch (e: any) { push("err", String(e.message || e)); }
    scannerRef.current?.focus();
  }
  async function toggleLoose(on: boolean) {
    try {
      const r = await api.setLooseMode(projectId, on);
      applyState(r.state); push(r.level, r.message);
    } catch (e: any) { push("err", String(e.message || e)); }
    scannerRef.current?.focus();
  }
  async function deleteBox(id: number) {
    if (!confirm("Bu qutini bekor qilamizmi? Uning kodlari ro'yxatga qaytariladi.")) return;
    try {
      const r = await api.deleteBox(projectId, id);
      applyState(r.state); push(r.level, r.message);
    } catch (e: any) { push("err", String(e.message || e)); }
  }

  async function doValidate() {
    setValidating(true); setSubmitResult(null);
    try {
      const v = await api.validate(projectId);
      setValidation(v);
      if (v.ok) push("hit", "✓ Reja bajarildi. Mass agregatsiyaga tayyor.");
      else push("err", "❌ " + v.reasons.join("; "));
    } catch (e: any) { push("err", String(e.message || e)); }
    setValidating(false);
  }
  async function doSubmit() {
    if (!apiKey.trim()) {
      push("err", "Asl Belgisi API kalitini kiriting");
      return;
    }
    if (!businessPlaceId.trim()) {
      push("err", "MOD (businessPlaceId) kiritilishi shart");
      return;
    }
    if (!confirm("Barcha qutilar Asl Belgisi ga yuboriladi. Davom etamizmi?")) return;
    setSubmitting(true);
    try {
      const r = await api.submit(projectId, {
        api_key: apiKey,
        inn: inn.trim(),
        business_place_id: businessPlaceId.trim(),
        production_order_id: productionOrderId.trim(),
      });
      setSubmitResult(r);
      if (r.ok) push("hit", `✓ Yuborildi (${r.total_reports} ta so'rov)`);
      else push("err", "Yuborishda muammo: " + (r.error || "quyidagi jadvalga qarang"));
      const st = await api.getProject(projectId);
      setState(st);
    } catch (e: any) { push("err", String(e.message || e)); }
    setSubmitting(false);
  }

  async function fetchMods() {
    if (!inn.trim() || !apiKey.trim()) {
      push("err", "INN va API kalitini avval kiriting");
      return;
    }
    setModLoading(true);
    try {
      const r = await api.customModList(inn.trim(), apiKey.trim());
      if (!r.ok) { push("err", r.error || "MOD ro'yxatini yuklab bo'lmadi"); }
      else {
        setModList(r.mods.map(m => ({ id: m.id, name: m.name })));
        push("hit", `${r.mods.length} ta MOD topildi`);
      }
    } catch (e: any) { push("err", String(e.message || e)); }
    setModLoading(false);
  }

  if (loadingErr) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="rounded-lg border border-danger/40 bg-danger/10 p-4 text-danger">
          {loadingErr}
        </div>
        <Button className="mt-4" onClick={onExit}><ArrowLeft className="size-4" /> Ortga</Button>
      </div>
    );
  }
  if (!state) {
    return <div className="p-10 text-center text-muted">Yuklanmoqda…</div>;
  }

  const p = state.project;
  const scanPlaceholder = boxFull
    ? "Quti barkodini skanerlang"
    : looseMode
      ? `Loose quti uchun KM (${state.current_codes.length}/${state.current_capacity})`
      : `KM kodini skanerlang (${state.current_codes.length}/${state.current_capacity})`;
  const inputTone = boxFull || looseMode ? "warning" : "accent";

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-6">
      <Toaster flashes={flashes} onDismiss={dismiss} />

      {/* Top bar */}
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <button onClick={onExit} className="text-muted hover:text-text inline-flex items-center gap-1">
          <ArrowLeft className="size-4" /> Loyihalar
        </button>
        <div className="flex items-center gap-3">
          {/* Optional — runs a full quality analysis of KM/SSCC pools + boxes */}
          <AiAnalysisButton projectId={projectId} />
          <div className="text-right">
            <div className="text-2xl font-extrabold tracking-tight text-accent">{p.name}</div>
            <div className="text-muted text-sm">{p.product_name}</div>
          </div>
        </div>
      </div>

      {/* Top status card */}
      <Card className="mb-4">
        <CardHead
          title="Ish holati"
          right={
            <>
              <Badge tone={p.status === "submitted" ? "success"
                          : p.status === "submitting" ? "warning" : "accent"}>{p.status}</Badge>
              <Badge tone={state.full_closed === p.full_boxes ? "success" : "accent"}>
                {state.full_closed}/{p.full_boxes} to'liq
              </Badge>
              {p.has_loose && (
                <Badge tone={state.loose_closed ? "success" : "loose"}>
                  loose: {state.loose_closed ? "yopilgan" : "ochiq"}
                </Badge>
              )}
            </>
          }
        />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <Metric label="Jami yuklangan" value={state.total_km}     tone="text" />
          <Metric label="Skanerlangan"   value={state.scanned_km}   tone="success" />
          <Metric label="Qolgan"         value={state.pending_km}   tone="warning" />
          <Metric label="Yopilgan quti"  value={state.closed_boxes.length} tone="accent" />
        </div>

        <div className="mb-1 flex items-center justify-between">
          <div className="text-xs uppercase tracking-widest text-muted">Umumiy jarayon</div>
          <div className="text-xs text-muted">
            {state.aggregated_km}/{p.planned_km} KM
          </div>
        </div>
        <Progress value={state.aggregated_km} max={p.planned_km} className="mb-3" />
        <BoxSlotGrid
          fullPlanned={p.full_boxes}
          fullClosed={state.full_closed}
          hasLoose={p.has_loose}
          looseClosed={state.loose_closed}
          currentIsLoose={state.current_is_loose}
        />
        {p.has_loose && (
          <div className="text-xs text-muted mt-2">
            L = loose paket (dashed amber) — istalgan vaqtda skanerlash mumkin
          </div>
        )}
      </Card>

      {/* Main split */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-4">
        {/* LEFT — scanner + missing */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardHead
              title="Skanerlash"
              right={
                <>
                  {looseMode && <Badge tone="loose">LOOSE ({p.loose_qty})</Badge>}
                  <Badge tone={boxFull ? "warning" : "accent"}>
                    {boxFull ? "QUTI KOD" : "KM KOD"}
                  </Badge>
                </>
              }
            />

            <ScanInput
              ref={scannerRef}
              placeholder={scanPlaceholder}
              tone={inputTone}
              onScan={handleScan}
              disabled={p.status !== "active"}
            />
            <div className="text-xs text-muted mt-2">
              Har bir skanerdan keyin kod qabul qilinadi. Ro'yxatda yo'q, takroriy yoki boshqa qutiga tegishli kodlar rad etiladi.
            </div>

            {/* Big count */}
            <div className="flex items-baseline justify-between mt-4 mb-2">
              <div className={`text-3xl font-extrabold ${looseMode ? "text-warning" : ""}`}>
                <span className={looseMode ? "text-warning" : "text-accent"}>
                  {state.current_codes.length}
                </span>
                <span className="text-muted"> / {state.current_capacity}</span>
                {queued > 0 && (
                  <span className="ml-2 text-base font-semibold text-warning">
                    +{queued} navbatda…
                  </span>
                )}
              </div>
              <div className={`text-sm ${boxFull ? "text-warning font-semibold" : "text-muted"}`}>
                {boxFull ? "To'ldirildi — quti kodini skanerlang"
                         : looseMode ? "LOOSE — to'ldirilmoqda" : "To'ldirilmoqda"}
              </div>
            </div>

            <KmSlotGrid
              filled={state.current_codes.length}
              capacity={state.current_capacity}
              tone={looseMode || boxFull ? "warning" : "accent"}
            />

            {/* Action buttons */}
            <div className="grid grid-cols-3 gap-2 mt-4">
              <Button variant="outline" onClick={doUndo}
                      disabled={state.current_codes.length === 0}>
                <Undo2 className="size-3" /> Oxirgisini o'chirish
              </Button>
              {p.has_loose && !state.loose_closed && !looseMode && (
                <Button variant="warning" onClick={() => toggleLoose(true)}
                        disabled={state.current_codes.length > 0}>
                  <Package className="size-3" /> Loose rejim
                </Button>
              )}
              {looseMode && (
                <Button variant="outline" onClick={() => toggleLoose(false)}
                        disabled={state.current_codes.length > 0}>
                  <Package className="size-3" /> Loose bekor
                </Button>
              )}
              {(!p.has_loose || state.loose_closed || (!looseMode && state.current_codes.length > 0)) && (
                <div /> /* filler grid cell */
              )}
              <Button variant="danger" onClick={doDiscard}
                      disabled={state.current_codes.length === 0}>
                <PackageMinus className="size-3" /> Joriy qutini tozalash
              </Button>
            </div>
          </Card>

          {/* Rejected scans — persistent. A toast disappears in a couple of
              seconds and an operator working at speed will never see it; this
              list is the record of every barcode the system did NOT accept. */}
          <Card>
            <CardHead
              title="Qabul qilinmagan skanerlar"
              right={
                <>
                  {rejects.length > 0 && <Badge tone="danger">{rejects.length}</Badge>}
                  <Button variant="outline" size="sm"
                          onClick={loadHistory} disabled={historyBusy}>
                    {historyBusy ? "…" : "Tarix"}
                  </Button>
                  {rejects.length > 0 && (
                    <Button variant="outline" size="sm" onClick={() => setRejects([])}>
                      Tozalash
                    </Button>
                  )}
                </>
              }
            />
            {rejects.length === 0 && !history && (
              <div className="text-sm text-muted">
                Bu seansda hamma skaner qabul qilindi. Oldingi rad etishlarni
                ko'rish uchun <b className="text-text">Tarix</b> tugmasini bosing.
              </div>
            )}
            {rejects.length > 0 && (
              <>
                <div className="text-sm text-muted mb-2">
                  Bu kodlar bazaga tushmadi. Sababini ko'ring va kerak bo'lsa qayta skanerlang.
                </div>
                <div className="max-h-56 overflow-auto space-y-1">
                  {rejects.map((r, i) => (
                    <div key={`${r.code}-${i}`}
                         className="rounded-lg border border-danger/30 bg-danger/5 px-2 py-1.5">
                      <div className="font-mono text-xs break-all">{r.code}</div>
                      <div className="text-xs text-danger mt-0.5">{r.reason}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {history && (
              <div className="mt-3">
                <div className="text-xs uppercase tracking-widest text-muted mb-1">
                  Server tarixi — barcha operatorlar ({history.length})
                </div>
                {history.length === 0 ? (
                  <div className="text-sm text-muted italic">
                    Rad etilgan skaner yo'q.
                  </div>
                ) : (
                  <div className="max-h-56 overflow-auto space-y-1">
                    {history.map(h => (
                      <div key={h.id}
                           className="rounded-lg border border-border bg-surface2/40 px-2 py-1.5">
                        <div className="font-mono text-xs break-all">
                          {h.raw_code || h.km_code}
                        </div>
                        <div className="text-xs text-danger mt-0.5">{h.reason}</div>
                        <div className="text-[10px] text-muted mt-0.5">
                          {h.username || "—"} · {new Date(h.created_at).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>

          <MissingPanel
            title="Skanerlanmagan KM kodlar"
            count={state.missing_km.count}
            preview={state.missing_km.preview}
            emptyMessage="Barcha yuklangan KM lar qutilarga taqsimlangan"
          />
          <MissingPanel
            title="Skanerlanmagan quti kodlari"
            count={state.missing_box.count}
            preview={state.missing_box.preview}
            emptyMessage="Barcha yuklangan quti kodlari ishlatilgan"
          />
        </div>

        {/* RIGHT — closed boxes + finalize */}
        <div className="flex flex-col gap-4">
          <ClosedBoxes boxes={state.closed_boxes}
                       onDelete={admin ? deleteBox : undefined} />

          {admin ? (
          <Card>
            <CardHead title="Yakunlash" right={
              <Badge tone={validation?.ok ? "success" : "neutral"}>
                {validation?.ok ? "tayyor" : "tekshirilmadi"}
              </Badge>
            } />
            <div className="text-sm text-muted mb-3">
              Barcha reja bajarilganini tekshiring va Asl Belgisi ga ommaviy agregatsiya so'rovini yuboring.
            </div>

            <Button variant="primary" size="lg" className="w-full mb-2"
                    onClick={doValidate} disabled={validating || p.status !== "active"}>
              {validating ? "Tekshirilmoqda…" : "Tekshirish va yakunlash"}
            </Button>

            {validation && !validation.ok && (
              <ul className="text-danger text-sm space-y-1 mb-3 list-disc pl-5">
                {validation.reasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            )}

            {validation?.ok && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Field label="Kompaniya INN">
                    <Input value={inn} onChange={e => setInn(e.target.value)}
                           placeholder="masalan 300123456" />
                  </Field>
                  <Field label="Asl Belgisi API kaliti">
                    <Input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
                           placeholder="Bearer …" />
                  </Field>
                </div>

                <Field label="businessPlaceId (MOD)">
                  <div className="flex gap-2">
                    <Input value={businessPlaceId}
                           onChange={e => { setBusinessPlaceId(e.target.value); setModList(null); }}
                           placeholder="masalan 27" />
                    <Button variant="outline" size="sm" onClick={fetchMods}
                            disabled={modLoading || !inn.trim() || !apiKey.trim()}>
                      {modLoading ? "…" : "MOD ro'yxati"}
                    </Button>
                  </div>
                </Field>
                {modList && modList.length > 0 && (
                  <div className="rounded-lg border border-border bg-surface2/40 p-2 max-h-40 overflow-auto">
                    {modList.map(m => (
                      <button key={m.id} type="button"
                              onClick={() => setBusinessPlaceId(m.id)}
                              className={"w-full text-left px-2 py-1 rounded text-sm hover:bg-accent/10 "
                                + (businessPlaceId === m.id ? "bg-accent/15 text-accent" : "")}>
                        <span className="font-mono">{m.id}</span>
                        {m.name && <span className="text-muted ml-2">— {m.name}</span>}
                      </button>
                    ))}
                  </div>
                )}

                <Field label="productionOrderId (ixtiyoriy)">
                  <Input value={productionOrderId}
                         onChange={e => setProductionOrderId(e.target.value)}
                         placeholder="ixtiyoriy" />
                </Field>

                <Button variant="primary" size="lg" className="w-full"
                        onClick={doSubmit} disabled={submitting}>
                  <Send className="size-4" />
                  {submitting ? "Yuborilmoqda…" : "Mass agregatsiyani yuborish"}
                </Button>
              </div>
            )}

            {submitResult && (
              <div className="mt-4">
                <div className={`flex items-center gap-2 text-sm mb-2 ${submitResult.ok ? "text-success" : "text-danger"}`}>
                  {submitResult.ok
                    ? <CheckCircle2 className="size-4" />
                    : <AlertTriangle className="size-4" />}
                  {submitResult.ok
                    ? `Muvaffaqiyat — ${submitResult.total_reports} ta so'rov`
                    : submitResult.error || "Xatolik"}
                </div>
                <div className="rounded-lg border border-border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-surface2/60">
                      <tr>
                        <Th>#</Th><Th>Qutilar</Th><Th>Kodlar</Th>
                        <Th>HTTP</Th><Th>documentId</Th><Th>OK</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {submitResult.reports.map(r => (
                        <tr key={r.report_index} className="border-t border-border">
                          <Td>{r.report_index}</Td>
                          <Td>{r.unit_count}</Td>
                          <Td>{r.code_count}</Td>
                          <Td>{r.http_status ?? "-"}</Td>
                          <Td className="font-mono">{r.document_id || (r.skipped ? "(o'tkazildi)" : "-")}</Td>
                          <Td>{r.ok ? "✓" : "✗"}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Card>
          ) : (
            <Card>
              <CardHead title="Sizning rolingiz"
                        right={<Badge tone="warning">operator</Badge>} />
              <div className="text-sm text-muted">
                Skanerlashda davom eting. Barcha kodlar joyiga tushgandan keyin
                <b className="text-text"> admin</b> tekshirish va Asl Belgisi ga yuborishni bajaradi.
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: {
  label: string; value: number | string;
  tone: "text" | "accent" | "warning" | "success" | "danger";
}) {
  const cls = tone === "accent"  ? "text-accent"
            : tone === "warning" ? "text-warning"
            : tone === "success" ? "text-success"
            : tone === "danger"  ? "text-danger"
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
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-2 py-1.5 ${className}`}>{children}</td>;
}
