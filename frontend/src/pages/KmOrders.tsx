import { useState } from "react";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { CompanyPicker } from "@/components/CompanyPicker";
import { Field, Input } from "@/components/ui/Input";
import { api } from "@/api";
import type { ModItem } from "@/types";

type Product = { gtin: string; quantity: number; cis_type: string };
const GROUPS = ["vegetableoil", "bio", "tobacco", "alcohol", "beer", "pharma", "water", "medicals", "appliances", "antiseptic", "fertilizers"];
const PACKAGES = ["UNIT", "GROUP", "SET", "BOX_LV_1", "BOX_LV_2"];
const PURPOSES = ["PRIMARY", "REMAINS", "COMISSION", "REMARK"];

export function KmOrders({ onExit }: { onExit: () => void }) {
  const [inn, setInn] = useState("");
  const [key, setKey] = useState("");
  const [verified, setVerified] = useState(false);
  const [group, setGroup] = useState("water");
  const [purpose, setPurpose] = useState("PRIMARY");
  const [place, setPlace] = useState("");
  const [mods, setMods] = useState<ModItem[]>([]);
  const [modError, setModError] = useState("");
  const [po, setPo] = useState("");
  const [products, setProducts] = useState<Product[]>([{ gtin: "", quantity: 1, cis_type: "UNIT" }]);
  const [orderId, setOrderId] = useState("");
  const [searchPo, setSearchPo] = useState("");
  const [searchGroup, setSearchGroup] = useState("");
  const [searchMessage, setSearchMessage] = useState("");
  const [foundOrders, setFoundOrders] = useState<{ orderId: string; orderStatus: string; poNumber?: string; createDate?: string }[] | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [status, setStatus] = useState<{ orders: any; suborders: any } | null>(null);
  const [pack, setPack] = useState<{ packId: string; codes: string[] } | null>(null);
  const [lastPacks, setLastPacks] = useState<Record<string, string>>({});
  const [receiveCount, setReceiveCount] = useState(1000);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const credentials = { inn: inn.trim(), api_key: key.trim() };
  function changeCredentials(i: string, k: string) {
    setInn(i); setKey(k); setVerified(false); setMods([]); setPlace(""); setModError("");
  }
  const updateProduct = (index: number, patch: Partial<Product>) => setProducts(rows => rows.map((r, i) => i === index ? { ...r, ...patch } : r));
  async function run(action: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await action(); } catch (e: any) { setMessage(e?.message || String(e)); }
    finally { setBusy(false); }
  }
  const check = () => run(async () => {
    if (!/^\d{9}$/.test(credentials.inn) || !credentials.api_key) throw Error("9 raqamli INN va API kalitni kiriting");
    await api.kmOrderVerify(credentials); setVerified(true); setMessage("Firma API kaliti tasdiqlandi");
    try {
      const result = await api.customModList(credentials.inn, credentials.api_key);
      if (result.ok) { setMods(result.mods); if (result.mods.length === 1 && /^\d+$/.test(result.mods[0].id)) setPlace(result.mods[0].id); }
      else setModError(result.error || "MOD ro'yxatini olish imkoni bo'lmadi");
    } catch (e: any) { setModError(e?.message || String(e)); }
  });
  const loadMods = () => run(async () => {
    if (!verified) throw Error("Avval firma kalitini tekshiring");
    const result = await api.customModList(credentials.inn, credentials.api_key);
    if (!result.ok) { setModError(result.error || "MOD ro'yxatini olish imkoni bo'lmadi"); return; }
    setMods(result.mods); setModError("");
    if (result.mods.length === 1 && /^\d+$/.test(result.mods[0].id)) setPlace(result.mods[0].id);
  });
  const create = () => run(async () => {
    if (!/^\d{9}$/.test(credentials.inn) || !credentials.api_key) throw Error("1-bo'limda firma INN va API kalitini kiriting");
    if (place.trim() && (!/^\d+$/.test(place) || Number(place) < 1)) throw Error("MOD ID musbat raqam bo'lishi kerak yoki bo'sh qoldiring");
    if (products.some(p => !/^\d{14}$/.test(p.gtin) || !Number.isInteger(p.quantity) || p.quantity < 1 || p.quantity > 150000))
      throw Error("Har bir GTIN 14 raqam, miqdor 1–150000 bo'lishi kerak");
    if (!window.confirm(`${uncertain ? "Oldingi urinish natijasi noma'lum. Qayta yuborish takroriy pullik buyurtma yaratishi mumkin. Avval buyurtmalarni qidirganingizga ishonch hosil qiling.\n\n" : ""}${products.reduce((n, p) => n + p.quantity, 0)} ta KM kod uchun ASL buyurtmasini yuborasizmi?${place.trim() ? "" : " MOD kiritilmagan; ASL bu buyurtmani rad etishi mumkin."} To'lov ASL tarifiga ko'ra hisoblanishi mumkin.`)) return;
    try {
      const result = await api.kmOrderCreate({ ...credentials, product_group: group, release_method_type: purpose,
        ...(place.trim() ? { business_place_id: Number(place) } : {}), po_number: po.trim(), products });
      setOrderId(result.order_id); setStatus(null); setPack(null); setLastPacks({}); setUncertain(false);
      setMessage(`Buyurtma yaratildi: ${result.order_id}`);
    } catch (e: any) {
      if (!e?.status || e.status >= 500) {
        setUncertain(true);
        throw Error("Serverdan javob olinmadi (502). Buyurtma ASLda yaratilgan bo'lishi mumkin. Qayta yuborishdan oldin pastdagi 'Buyurtmalarni qidirish' tugmasini bosing.");
      }
      throw e;
    }
  });
  const searchOrders = async () => {
    setSearchMessage(""); setFoundOrders(null); setBusy(true);
    try {
      if (!/^\d{9}$/.test(credentials.inn) || !credentials.api_key) throw Error("1-bo'limda firmadan INN va API kalitini tanlang");
      if (!searchPo.trim() || !searchGroup) throw Error("Ishlab chiqarish buyurtma raqami va mahsulot guruhini kiriting");
      const result = await api.kmOrderSearch({ ...credentials, po_number: searchPo.trim(), product_group: searchGroup });
      setFoundOrders(result.orderInfos || []);
      setSearchMessage(result.orderInfos?.length ? "Topilgan buyurtmani tanlang, keyin holatini yangilang." : "Buyurtma topilmadi. ASL javobi kechikishi mumkin; takroriy buyurtma yuborishdan oldin yana tekshiring.");
    } catch (e: any) {
      setSearchMessage(e?.status === 502 ? "Qidiruv ham 502 bilan tugadi. ASLda buyurtma bor-yo'qligi hali noma'lum; qayta buyurtma yubormang." : e?.message || String(e));
    } finally { setBusy(false); }
  };
  const refresh = () => run(async () => {
    if (!/^[0-9a-fA-F-]{36}$/.test(orderId.trim())) throw Error("ASL buyurtma ID UUID formatida bo'lishi kerak; ishlab chiqarish raqami bu maydonga kiritilmaydi");
    setStatus(await api.kmOrderStatus({ ...credentials, order_id: orderId.trim() }));
  });
  const receive = (gtin: string, quantity: number) => run(async () => {
    if (pack?.codes?.length && !window.confirm("Joriy KM paketini CSV qilib saqladingizmi? Keyingi paket ekranda uning o'rnini egallaydi.")) return;
    const result = await api.kmOrderReceive({ ...credentials, order_id: orderId, gtin, quantity, last_pack_id: lastPacks[gtin] || "" });
    setPack(result); setLastPacks(p => ({ ...p, [gtin]: result.packId || "" })); setMessage(`${result.codes?.length || 0} ta kod olindi. CSV faylni saqlang.`);
  });
  function download() {
    if (!pack?.codes?.length) return;
    const blob = new Blob(["KM\r\n", ...pack.codes.map(c => `"${c.replaceAll('"', '""')}"\r\n`)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `KM_${orderId}_${pack.packId || "pack"}.csv`; a.click(); URL.revokeObjectURL(url);
  }
  const suborders: any[] = status?.suborders?.subOrderInfos || [];
  return <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
    <button onClick={onExit} className="inline-flex items-center gap-1 text-muted hover:text-text"><ArrowLeft className="size-4" /> Bosh sahifa</button>
    <div><h1 className="text-2xl font-extrabold">KM kod sotib olish</h1><p className="text-sm text-muted mt-1">Firma API kaliti orqali ASL Belgisi da KM chiqarish buyurtmasi</p></div>
    <section className="rounded-xl border border-border bg-surface p-5 space-y-4">
      <h2 className="font-bold">1. Firma</h2>
      <CompanyPicker currentInn={inn} currentKey={key} onPick={(i, k) => changeCredentials(i, k)} />
      <div className="grid gap-4 md:grid-cols-2"><Field label="INN"><Input value={inn} onChange={e => changeCredentials(e.target.value, key)} inputMode="numeric" /></Field>
      <Field label="ASL API kalit"><Input type="password" value={key} onChange={e => changeCredentials(inn, e.target.value)} autoComplete="off" /></Field></div>
      <button disabled={busy} onClick={check} className="rounded-lg bg-accent px-4 py-2 text-white disabled:opacity-50">{verified ? "✓ Tasdiqlangan" : "Kalitni tekshirish"}</button>
    </section>
    <section className="rounded-xl border border-border bg-surface p-5 space-y-4">
      <h2 className="font-bold">2. Buyurtma</h2>
      <div className="grid gap-4 md:grid-cols-2"><Field label="Mahsulot guruhi"><select className="w-full h-11 rounded-lg border border-border bg-surface2 px-3" value={group} onChange={e => setGroup(e.target.value)}>{GROUPS.map(x => <option key={x}>{x}</option>)}</select></Field>
      <Field label="Markirovka maqsadi"><select className="w-full h-11 rounded-lg border border-border bg-surface2 px-3" value={purpose} onChange={e => setPurpose(e.target.value)}>{PURPOSES.map(x => <option key={x}>{x}</option>)}</select></Field>
      <div className="space-y-2"><Field label="MOD / businessPlaceId (ixtiyoriy API maydoni)" hint="Firma mustaqil buyurtma berganda ASL buni talab qilishi mumkin"><Input value={place} onChange={e => setPlace(e.target.value)} inputMode="numeric" /></Field>
        <button disabled={busy || !verified} onClick={loadMods} className="text-sm text-accent disabled:opacity-50">API kalit orqali MODlarni olish</button>
        {mods.length > 0 && <select aria-label="MOD tanlash" className="w-full h-11 rounded-lg border border-border bg-surface2 px-3" value={mods.some(m => m.id === place) ? place : ""} onChange={e => setPlace(e.target.value)}><option value="">MODni tanlang</option>{mods.filter(m => /^\d+$/.test(m.id)).map(m => <option key={m.id} value={m.id}>{m.name || "MOD"} · ID {m.id}</option>)}</select>}
        {modError && <p className="text-xs text-danger">MODlarni olish imkoni bo'lmadi: {modError}. Firma administratoridan biznes joyi ID sini so'rang.</p>}
        {verified && !modError && mods.length === 0 && <p className="text-xs text-muted">MOD ro'yxati bo'sh. Firma administratoridan biznes joyi ID sini so'rang.</p>}
      </div>
      <Field label="Ishlab chiqarish buyurtma raqami (ixtiyoriy)"><Input value={po} onChange={e => setPo(e.target.value)} /></Field></div>
      {products.map((p, i) => <div key={i} className="grid gap-3 md:grid-cols-[1fr_140px_160px_40px] items-end"><Field label={`GTIN ${i + 1}`}><Input value={p.gtin} onChange={e => updateProduct(i, { gtin: e.target.value })} inputMode="numeric" maxLength={14} /></Field>
        <Field label="KM soni"><Input type="number" min={1} max={150000} value={p.quantity} onChange={e => updateProduct(i, { quantity: Number(e.target.value) })} /></Field>
        <Field label="Qadoq turi"><select className="w-full h-11 rounded-lg border border-border bg-surface2 px-3" value={p.cis_type} onChange={e => updateProduct(i, { cis_type: e.target.value })}>{PACKAGES.map(x => <option key={x}>{x}</option>)}</select></Field>
        <button aria-label="GTINni o'chirish" disabled={products.length === 1} onClick={() => setProducts(rows => rows.filter((_, n) => n !== i))} className="h-11 disabled:opacity-30"><Trash2 className="size-4" /></button></div>)}
      <button disabled={products.length >= 10} onClick={() => setProducts(rows => [...rows, { gtin: "", quantity: 1, cis_type: "UNIT" }])} className="inline-flex gap-2 items-center text-accent disabled:opacity-40"><Plus className="size-4" /> GTIN qo'shish</button>
      <div className="space-y-2"><button disabled={busy} onClick={create} className="rounded-lg bg-accent px-5 py-2.5 text-white disabled:opacity-50">{busy ? "Yuborilmoqda…" : "ASL ga buyurtma yuborish"}</button>
        <p className="text-xs text-muted">Kalit egaligi yuborish vaqtida ham tekshiriladi. MOD bo'sh bo'lsa, ASL javobi uning zarurligini ko'rsatadi.</p>
        {message && <p role="status" className="rounded-lg border border-border bg-surface2 p-3 text-sm">{message}</p>}</div>
    </section>
    <section className="rounded-xl border border-border bg-surface p-5 space-y-4">
      <h2 className="font-bold">3. Holat va kodlarni olish</h2>
      <p className="text-sm text-muted">Agar yuborishdan keyin 502 chiqqan bo'lsa, buyurtma takrorlanmasligi uchun avval shu yerda qidiring.</p>
      <div className="grid gap-4 md:grid-cols-2"><Field label="Qidiruv: ishlab chiqarish buyurtma raqami (poNumber)"><Input value={searchPo} onChange={e => setSearchPo(e.target.value)} placeholder="Masalan: 20866 svecha" /></Field>
        <Field label="Qidiruv: mahsulot guruhi"><select className="w-full h-11 rounded-lg border border-border bg-surface2 px-3" value={searchGroup} onChange={e => setSearchGroup(e.target.value)}><option value="">Tanlang</option>{GROUPS.map(x => <option key={x}>{x}</option>)}</select></Field></div>
      <button disabled={busy} onClick={searchOrders} className="rounded-lg border border-border px-4 py-2 disabled:opacity-50">Buyurtmalarni qidirish</button>
      {searchMessage && <p role="status" className="rounded-lg border border-border bg-surface2 p-3 text-sm">{searchMessage}</p>}
      {foundOrders && <div className="space-y-2">{foundOrders.length === 0 && <p className="text-sm text-muted">Hozircha buyurtma topilmadi.</p>}{foundOrders.map(o => <button key={o.orderId} onClick={() => { setOrderId(o.orderId); setStatus(null); }} className="block w-full rounded-lg border border-border p-3 text-left text-sm hover:border-accent"><strong>{o.orderStatus}</strong> · {o.poNumber || "raqamsiz"} · {o.createDate || ""}<br /><span className="font-mono text-xs">{o.orderId}</span></button>)}</div>}
      <Field label="ASL buyurtma ID (UUID)" hint="Faqat ASL qaytargan buyurtma ID; poNumber emas"><Input value={orderId} onChange={e => { setOrderId(e.target.value); setStatus(null); setPack(null); setLastPacks({}); }} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" /></Field>
      <Field label="Bir marta olinadigan KM soni" hint="Paketlar ketma-ket olinadi; har birini CSV qilib saqlang"><Input type="number" min={1} max={1000} value={receiveCount} onChange={e => setReceiveCount(Number(e.target.value))} /></Field>
      <button disabled={busy || !orderId || !verified} onClick={refresh} className="rounded-lg border border-border px-4 py-2 disabled:opacity-50">Holatni yangilash</button>
      {status && <div className="space-y-3"><pre className="overflow-auto rounded-lg bg-surface2 p-3 text-xs">{JSON.stringify(status.orders, null, 2)}</pre>
        {suborders.map((s, i) => <div key={i} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3 text-sm"><strong>{s.gtin}</strong><span>{s.bufferStatus}</span><span>Mavjud: {s.leftInBuffer ?? s.availableCodes ?? "—"}</span>
          <button disabled={busy || !Number.isInteger(receiveCount) || receiveCount < 1 || receiveCount > 1000 || (!s.leftInBuffer && !s.availableCodes)} onClick={() => receive(s.gtin, Math.min(Number(s.leftInBuffer) || Number(s.availableCodes), receiveCount))} className="rounded-lg bg-accent px-3 py-1.5 text-white disabled:opacity-40">Kodlarni olish</button></div>)}</div>}
      {pack && <div className="space-y-2"><p>{pack.codes?.length || 0} ta KM · paket ID: {pack.packId}</p><button onClick={download} className="rounded-lg border border-border px-4 py-2">CSV yuklab olish</button></div>}
    </section>
  </div>;
}
