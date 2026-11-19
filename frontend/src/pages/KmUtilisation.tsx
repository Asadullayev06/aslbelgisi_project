import { useState } from "react";
import { api } from "@/api";
import { CompanyPicker } from "@/components/CompanyPicker";
import { Field, Input } from "@/components/ui/Input";

export function KmUtilisation({ onExit }: { onExit: () => void }) {
  const [inn, setInn] = useState(""); const [key, setKey] = useState("");
  const [group, setGroup] = useState("pharma"); const [mod, setMod] = useState("");
  const [country, setCountry] = useState(""); const [release, setRelease] = useState("IMPORT");
  const [production, setProduction] = useState(""); const [expiry, setExpiry] = useState("");
  const [series, setSeries] = useState(""); const [po, setPo] = useState("");
  const [codes, setCodes] = useState<string[]>([]); const [scan, setScan] = useState("");
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const [reportId, setReportId] = useState(""); const [result, setResult] = useState<unknown>(null);
  const [submitted, setSubmitted] = useState(false); const [uncertain, setUncertain] = useState(false);
  const credentials = { inn: inn.trim(), api_key: key.trim() };
  const locked = busy || submitted || uncertain;
  function changeCompany(i: string, k: string) {
    setInn(i); setKey(k); setMod(""); setMessage(""); setResult(null);
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await action(); } catch (e: any) { setMessage(e.message || String(e)); }
    finally { setBusy(false); }
  }
  function addCodes(values: string[]) {
    const incoming = values.filter(c => c !== "");
    const all = [...codes, ...incoming];
    if (all.length > 30000) throw Error("Bir hisobotda maksimum 30 000 KM");
    if (new Set(all).size !== all.length) throw Error("Takroriy KM aniqlandi. Kodlar qo'shilmadi.");
    if (incoming.some(c => !c.startsWith("01") || c.length < 20 || !c.includes("\u001d")))
      throw Error("To'liq KM va GS ajratgich kerak. ASLdan olingan CSV faylidan foydalaning.");
    setCodes(all); setMessage(`${incoming.length} ta KM qo'shildi`);
  }
  async function importFile(file: File) {
    if (file.size > 20 * 1024 * 1024) throw Error("Fayl 20 MB dan katta");
    const rows = (await file.text()).replace(/^\uFEFF/, "").split(/\r?\n/);
    if (rows[0] === "KM" || rows[0] === '"KM"') rows.shift();
    // Single-column CSV exported by KM purchasing. Preserve GS and punctuation.
    addCodes(rows.map(row => row.startsWith('"') && row.endsWith('"') ? row.slice(1, -1).replaceAll('""', '"') : row));
  }
  const send = () => run(async () => {
    if (!/^\d{9}$/.test(credentials.inn) || !credentials.api_key) throw Error("Firma INN va API kalitini kiriting");
    if (!/^\d+$/.test(mod) || Number(mod) < 1) throw Error("MOD ID majburiy");
    if (!/^[A-Z]{2}$/.test(country)) throw Error("Davlatning 2 harfli kodini kiriting (UZ, UA va hokazo)");
    if (!codes.length) throw Error("KM kodlarni kiriting");
    if (group === "pharma" && !series.trim()) throw Error("Dori uchun seriya majburiy");
    if (group !== "appliances" && (!production || !expiry)) throw Error("Sanalarni kiriting");
    if (!confirm(`${codes.length} ta KM mahsulotga amalda qo'llanganini ASLga tasdiqlaysizmi?`)) return;
    try {
      const response = await api.kmUtilisationSubmit({ ...credentials, product_group: group,
        business_place_id: Number(mod), release_type: release, manufacturer_country: country,
        production_date: production ? new Date(production).toISOString() : undefined,
        expiration_date: expiry ? new Date(expiry).toISOString() : undefined,
        series_number: series, production_order_id: po, codes });
      setReportId(response.reportId); setSubmitted(true);
      setMessage("Hisobot qabul qilindi. Yakuniy natijani Holatni tekshirish orqali ko'ring. IDni saqlang.");
    } catch (e: any) {
      if (!e.status || e.status >= 500) {
        setUncertain(true);
        throw Error(`Natija noma'lum; takror yubormang. ASL kabinetida tekshiring. ${e.message}`);
      }
      throw e;
    }
  });
  const box = "rounded-xl border border-border bg-surface p-5 space-y-4";
  const select = "w-full h-11 rounded-lg border border-border bg-surface2 px-3";
  const button = "rounded-lg border border-border px-4 py-2 disabled:opacity-50";
  return <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
    <button onClick={onExit} className={button}>Bosh sahifa</button>
    <div><h1 className="text-2xl font-extrabold">KM qo'llash</h1><p className="text-muted">Нанесение КМ — mahsulotga qo'llangan kodlar haqida ASL hisoboti</p></div>
    <section className={box}><h2 className="font-bold">1. Firma</h2>
      <CompanyPicker currentInn={inn} currentKey={key} onPick={changeCompany} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="INN"><Input value={inn} onChange={e => changeCompany(e.target.value, key)} /></Field>
        <Field label="ASL API kalit"><Input type="password" autoComplete="new-password" value={key} onChange={e => changeCompany(inn, e.target.value)} /></Field>
      </div>
    </section>
    <fieldset disabled={locked} className={box}><legend className="font-bold">2. Qo'llash ma'lumotlari</legend>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Mahsulot guruhi"><select className={select} value={group} onChange={e => setGroup(e.target.value)}>{["pharma", "medicals", "water", "vegetableoil", "bio", "tobacco", "alcohol", "beer", "appliances", "antiseptic", "fertilizers"].map(g => <option key={g}>{g}</option>)}</select></Field>
        <Field label="MOD / businessPlaceId"><Input inputMode="numeric" value={mod} onChange={e => setMod(e.target.value)} /></Field>
        <Field label="Muomalaga chiqarish usuli"><select className={select} value={release} onChange={e => setRelease(e.target.value)}><option value="IMPORT">IMPORT — Import</option><option value="PRODUCTION">PRODUCTION — Ishlab chiqarish</option><option value="CIRCULATION">CIRCULATION — Kelib chiqish davlatisiz</option></select></Field>
        <Field label="Ishlab chiqarilgan davlat" hint="Mahsulot kartasiga mos 2 harfli kod"><Input maxLength={2} placeholder="UZ" value={country} onChange={e => setCountry(e.target.value.toUpperCase())} /></Field>
        <Field label="Ishlab chiqarish vaqti" hint="Mahalliy vaqt. KM buyurtmasi yaratilgan sanadan keyin bo'lishi kerak."><Input type="datetime-local" value={production} onChange={e => setProduction(e.target.value)} /></Field>
        <Field label="Yaroqlilik muddati" hint="Mahalliy vaqt"><Input type="datetime-local" value={expiry} onChange={e => setExpiry(e.target.value)} /></Field>
        <Field label="Seriya / partiya" hint="Dori vositalari uchun majburiy; 20 belgigacha"><Input maxLength={20} value={series} onChange={e => setSeries(e.target.value)} /></Field>
        <Field label="Ishlab chiqarish buyurtma ID (ixtiyoriy)"><Input value={po} onChange={e => setPo(e.target.value)} /></Field>
      </div>
    </fieldset>
    <fieldset disabled={locked} className={box}><legend className="font-bold">3. KM kodlar ({codes.length} / 30 000)</legend>
      <p className="text-sm text-muted">Bir mahsulot guruhi uchun to'liq KM kodlar. GS ajratgichlar saqlanadi. Faqat amalda qo'llangan kodlarni yuboring.</p>
      <Field label="CSV yoki TXT import"><Input type="file" accept=".csv,.txt" onChange={e => { const f = e.target.files?.[0]; if (f) void run(() => importFile(f)); e.target.value = ""; }} /></Field>
      <Field label="KM skanerlash (Enter)"><Input value={scan} onChange={e => setScan(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); try { addCodes([scan]); setScan(""); } catch (err: any) { setMessage(err.message); } } }} /></Field>
      <button className={button} onClick={() => { if (confirm("Kiritilgan KM ro'yxati tozalansinmi?")) setCodes([]); }}>Kodlarni tozalash</button>
    </fieldset>
    <section className={box}>
      <button disabled={locked || !codes.length} onClick={send} className="rounded-lg bg-accent px-5 py-3 text-white disabled:opacity-50">{busy ? "Kutilmoqda…" : "ASLga qo'llash hisobotini yuborish"}</button>
      {message && <p role="status" className="rounded-lg bg-surface2 p-3 whitespace-pre-wrap">{message}</p>}
      <Field label="Hisobot ID (reportId)"><Input value={reportId} onChange={e => { setReportId(e.target.value); setResult(null); }} /></Field>
      <button disabled={busy || !reportId} className={button} onClick={() => run(async () => { setResult(await api.kmUtilisationStatus({ ...credentials, report_id: reportId.trim() })); })}>Holatni tekshirish</button>
      {result !== null && <pre className="overflow-auto rounded-lg bg-surface2 p-3 text-xs">{JSON.stringify(result, null, 2)}</pre>}
    </section>
  </div>;
}
