import { useEffect, useState } from "react";
import { Save, Pencil, Trash2, Check, X, Building2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { api } from "@/api";
import type { AslCompany } from "@/types";

/** Saved ASL company keeper: pick a saved (INN + API key) to fill the auth
 *  fields, save the current pair under a name, or edit/delete saved ones.
 *  `onPick` fills the parent's INN + key inputs. `currentInn`/`currentKey`
 *  are the values the parent currently holds, so "Saqlash" can store them. */
export function CompanyPicker({ onPick, currentInn, currentKey, tone = "accent" }: {
  onPick: (inn: string, apiKey: string, name?: string) => void;
  currentInn?: string;
  currentKey?: string;
  tone?: "accent" | "warning";
}) {
  const [companies, setCompanies] = useState<AslCompany[] | null>(null);
  const [selected, setSelected]   = useState<number | "">("");
  const [managing, setManaging]   = useState(false);
  const [err, setErr]             = useState<string | null>(null);
  const [busy, setBusy]           = useState(false);

  // add/edit form state
  const [editId, setEditId]   = useState<number | "new" | null>(null);
  const [fName, setFName]     = useState("");
  const [fInn, setFInn]       = useState("");
  const [fKey, setFKey]       = useState("");

  async function load() {
    setErr(null);
    try { setCompanies(await api.aslCompanies()); }
    catch (e: any) { setErr(String(e.message || e)); }
  }
  useEffect(() => { load(); }, []);

  function pick(id: number | "") {
    setSelected(id);
    if (id === "") return;
    const c = companies?.find(x => x.id === id);
    if (c) onPick(c.inn, c.api_key, c.name);
  }

  function startNew() {
    setEditId("new");
    setFName(""); setFInn(currentInn || ""); setFKey(currentKey || "");
    setManaging(true);
  }
  function startEdit(c: AslCompany) {
    setEditId(c.id); setFName(c.name); setFInn(c.inn); setFKey(c.api_key);
    setManaging(true);
  }
  function cancelForm() { setEditId(null); setFName(""); setFInn(""); setFKey(""); }

  async function saveForm() {
    if (!fName.trim()) { setErr("Kompaniya nomi kerak"); return; }
    setBusy(true); setErr(null);
    try {
      if (editId === "new") {
        const c = await api.aslCompanyCreate({ name: fName.trim(), inn: fInn.trim(), api_key: fKey.trim() });
        await load();
        setSelected(c.id); onPick(c.inn, c.api_key, c.name);
      } else if (typeof editId === "number") {
        const c = await api.aslCompanyUpdate(editId, { name: fName.trim(), inn: fInn.trim(), api_key: fKey.trim() });
        await load();
        if (selected === c.id) onPick(c.inn, c.api_key, c.name);
      }
      cancelForm();
    } catch (e: any) { setErr(String(e.message || e)); }
    finally { setBusy(false); }
  }

  async function remove(c: AslCompany) {
    if (!confirm(`"${c.name}" saqlangan kompaniyani o'chiramizmi?`)) return;
    setBusy(true); setErr(null);
    try {
      await api.aslCompanyDelete(c.id);
      if (selected === c.id) setSelected("");
      await load();
    } catch (e: any) { setErr(String(e.message || e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="rounded-lg border border-border bg-surface2/40 p-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Building2 className="size-4 text-accent" />
        <span className="text-xs uppercase tracking-widest text-muted">Saqlangan kompaniyalar</span>
        <div className="flex-1" />
        <select
          value={selected}
          onChange={e => pick(e.target.value === "" ? "" : Number(e.target.value))}
          className="h-9 min-w-[12rem] rounded-lg border border-border bg-surface px-3 text-sm
                     focus:border-accent focus:ring-2 focus:ring-accent/30 outline-none"
        >
          <option value="">— tanlang —</option>
          {companies?.map(c => (
            <option key={c.id} value={c.id}>{c.name} · INN {c.inn || "—"}</option>
          ))}
        </select>
        <Button variant="outline" size="sm" onClick={startNew}>
          <Save className="size-3" /> Yangi saqlash
        </Button>
        <Button variant="outline" size="sm" onClick={() => setManaging(m => !m)}>
          <Pencil className="size-3" /> Boshqarish
        </Button>
      </div>

      {err && <div className="text-xs text-danger mt-2">{err}</div>}

      {/* Add / edit form */}
      {editId !== null && (
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2 rounded-lg border border-border bg-surface p-2">
          <Input value={fName} onChange={e => setFName(e.target.value)} placeholder="Kompaniya nomi" />
          <Input value={fInn} onChange={e => setFInn(e.target.value)} placeholder="INN" />
          <Input value={fKey} onChange={e => setFKey(e.target.value)} placeholder="ASL API kalit" />
          <div className="md:col-span-3 flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={cancelForm} disabled={busy}>
              <X className="size-3" /> Bekor
            </Button>
            <Button variant={tone === "warning" ? "warning" : "primary"} size="sm"
                    onClick={saveForm} disabled={busy || !fName.trim()}>
              <Check className="size-3" /> {busy ? "…" : "Saqlash"}
            </Button>
          </div>
        </div>
      )}

      {/* Manage list */}
      {managing && editId === null && (
        <div className="mt-3 flex flex-col gap-1.5">
          {companies && companies.length === 0 && (
            <div className="text-xs text-muted italic">Hali saqlangan kompaniya yo'q.</div>
          )}
          {companies?.map(c => (
            <div key={c.id} className="flex items-center gap-2 rounded-lg border border-border bg-surface2/40 px-3 py-1.5">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold truncate">{c.name}</div>
                <div className="text-xs text-muted truncate">INN {c.inn || "—"} · kalit …{(c.api_key || "").slice(-4) || "—"}</div>
              </div>
              <button onClick={() => startEdit(c)} title="Tahrirlash"
                      className="p-1.5 rounded-md bg-surface/80 border border-border hover:border-accent/60 hover:text-accent">
                <Pencil className="size-3.5" />
              </button>
              <button onClick={() => remove(c)} disabled={busy} title="O'chirish"
                      className="p-1.5 rounded-md bg-surface/80 border border-border hover:border-danger/60 hover:text-danger">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
