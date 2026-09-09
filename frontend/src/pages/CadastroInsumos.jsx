import React, { useEffect, useRef, useState } from "react";
import NutriLayout from "@/components/evonut/NutriLayout";
import { api, formatApiError } from "@/lib/evo-api";
import { Beaker, FileSpreadsheet, PackagePlus, Plus, Search, Trash2, X, Save } from "lucide-react";
import { toast } from "sonner";

const tabs = [
  { key: "suplementos", label: "Suplementos", icon: PackagePlus },
  { key: "formulas", label: "Formulas", icon: Beaker },
  { key: "importar", label: "Importar CSV", icon: FileSpreadsheet },
];

const macroFields = ["energia_kcal", "proteinas_g", "carboidratos_g", "lipidios_g"];

function numberOrNull(value) {
  if (value === "" || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function SupplementModal({ item, onClose, onSaved }) {
  const [form, setForm] = useState({
    nome: item?.nome || "",
    marca: item?.marca || "",
    categoria: item?.categoria || "Suplementos",
    dose_padrao: item?.dose_padrao ?? "",
    unidade: item?.unidade || "g",
    objetivo: item?.objetivo || "",
    observacoes: item?.observacoes || "",
    composicao: Object.fromEntries(macroFields.map((key) => [key, item?.composicao?.[key] ?? ""])),
  });
  const set = (key, value) => setForm((s) => ({ ...s, [key]: value }));
  const setComp = (key, value) => setForm((s) => ({ ...s, composicao: { ...s.composicao, [key]: value } }));
  const submit = async (event) => {
    event.preventDefault();
    const payload = {
      ...form,
      dose_padrao: numberOrNull(form.dose_padrao),
      composicao: Object.fromEntries(Object.entries(form.composicao).map(([k, v]) => [k, Number(v || 0)])),
    };
    try {
      if (item) await api.put(`/suplementos/${item.id}`, payload);
      else await api.post("/suplementos", payload);
      toast.success(item ? "Suplemento atualizado" : "Suplemento cadastrado");
      onSaved();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <form onSubmit={submit} className="rc-card p-6 w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="text-xs uppercase tracking-widest text-rc-blue font-bold">Cadastro</div>
            <h2 className="rc-h3 mt-1">{item ? "Editar suplemento" : "Novo suplemento"}</h2>
          </div>
          <button type="button" onClick={onClose} className="rc-btn-secondary p-2"><X className="w-4 h-4" /></button>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <label><span className="rc-label">Nome *</span><input required className="rc-input" value={form.nome} onChange={(e) => set("nome", e.target.value)} /></label>
          <label><span className="rc-label">Marca</span><input className="rc-input" value={form.marca} onChange={(e) => set("marca", e.target.value)} /></label>
          <label><span className="rc-label">Categoria</span><input className="rc-input" value={form.categoria} onChange={(e) => set("categoria", e.target.value)} /></label>
          <label><span className="rc-label">Objetivo</span><input className="rc-input" value={form.objetivo} onChange={(e) => set("objetivo", e.target.value)} /></label>
          <label><span className="rc-label">Dose padrao</span><input type="number" step="0.01" className="rc-input" value={form.dose_padrao} onChange={(e) => set("dose_padrao", e.target.value)} /></label>
          <label><span className="rc-label">Unidade</span><input className="rc-input" value={form.unidade} onChange={(e) => set("unidade", e.target.value)} /></label>
        </div>
        <div className="mt-5 grid sm:grid-cols-4 gap-3">
          {macroFields.map((key) => (
            <label key={key}><span className="text-xs text-gray-400">{key.replaceAll("_", " ")}</span><input type="number" step="0.01" className="rc-input" value={form.composicao[key]} onChange={(e) => setComp(key, e.target.value)} /></label>
          ))}
        </div>
        <label className="block mt-4"><span className="rc-label">Observacoes</span><textarea className="rc-input min-h-[90px]" value={form.observacoes} onChange={(e) => set("observacoes", e.target.value)} /></label>
        <div className="flex justify-end gap-3 mt-6">
          <button type="button" onClick={onClose} className="rc-btn-secondary">Cancelar</button>
          <button className="rc-btn-primary"><Save className="w-4 h-4" /> Salvar</button>
        </div>
      </form>
    </div>
  );
}

function FormulaModal({ item, onClose, onSaved }) {
  const [form, setForm] = useState({
    nome: item?.nome || "",
    categoria: item?.categoria || "Formula",
    rendimento: item?.rendimento ?? "",
    unidade_rendimento: item?.unidade_rendimento || "porcao",
    modo_preparo: item?.modo_preparo || "",
    observacoes: item?.observacoes || "",
  });
  const set = (key, value) => setForm((s) => ({ ...s, [key]: value }));
  const submit = async (event) => {
    event.preventDefault();
    const payload = { ...form, rendimento: numberOrNull(form.rendimento), itens: item?.itens || [] };
    try {
      if (item) await api.put(`/formulas/${item.id}`, payload);
      else await api.post("/formulas", payload);
      toast.success(item ? "Formula atualizada" : "Formula cadastrada");
      onSaved();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <form onSubmit={submit} className="rc-card p-6 w-full max-w-2xl">
        <div className="flex items-center justify-between mb-5">
          <div><div className="text-xs uppercase tracking-widest text-rc-blue font-bold">Cadastro</div><h2 className="rc-h3 mt-1">{item ? "Editar formula" : "Nova formula"}</h2></div>
          <button type="button" onClick={onClose} className="rc-btn-secondary p-2"><X className="w-4 h-4" /></button>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <label className="md:col-span-2"><span className="rc-label">Nome *</span><input required className="rc-input" value={form.nome} onChange={(e) => set("nome", e.target.value)} /></label>
          <label><span className="rc-label">Categoria</span><input className="rc-input" value={form.categoria} onChange={(e) => set("categoria", e.target.value)} /></label>
          <label><span className="rc-label">Rendimento</span><input type="number" step="0.01" className="rc-input" value={form.rendimento} onChange={(e) => set("rendimento", e.target.value)} /></label>
          <label><span className="rc-label">Unidade rendimento</span><input className="rc-input" value={form.unidade_rendimento} onChange={(e) => set("unidade_rendimento", e.target.value)} /></label>
        </div>
        <label className="block mt-4"><span className="rc-label">Modo de preparo</span><textarea className="rc-input min-h-[90px]" value={form.modo_preparo} onChange={(e) => set("modo_preparo", e.target.value)} /></label>
        <label className="block mt-4"><span className="rc-label">Observacoes</span><textarea className="rc-input min-h-[80px]" value={form.observacoes} onChange={(e) => set("observacoes", e.target.value)} /></label>
        <div className="flex justify-end gap-3 mt-6">
          <button type="button" onClick={onClose} className="rc-btn-secondary">Cancelar</button>
          <button className="rc-btn-primary"><Save className="w-4 h-4" /> Salvar</button>
        </div>
      </form>
    </div>
  );
}

function ImportCsv({ onImported }) {
  const fileRef = useRef(null);
  const [tipo, setTipo] = useState("alimentos");
  const [loading, setLoading] = useState(false);
  const upload = async (file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    setLoading(true);
    try {
      const { data } = await api.post("/cadastros/importar-csv", fd, {
        params: { tipo },
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success(`Importado: ${data.created} novos, ${data.updated} atualizados`);
      onImported();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  return (
    <section className="rc-card p-5">
      <h2 className="rc-h3">Importar base autorizada</h2>
      <p className="text-sm text-gray-400 mt-2">Use CSV exportado/autorizado. Colunas aceitas: nome, categoria, kcal, proteina, carboidrato, gordura, fibra, sodio, dose, unidade, marca.</p>
      <div className="mt-5 flex flex-col sm:flex-row gap-3">
        <select className="rc-input sm:max-w-[220px]" value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="alimentos">Alimentos</option>
          <option value="suplementos">Suplementos</option>
        </select>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
        <button disabled={loading} onClick={() => fileRef.current?.click()} className="rc-btn-primary">
          <FileSpreadsheet className="w-4 h-4" /> {loading ? "Importando..." : "Selecionar CSV"}
        </button>
      </div>
    </section>
  );
}

function DataTable({ kind, rows, loading, onNew, onEdit, onDelete }) {
  const title = kind === "suplementos" ? "Suplementos" : "Formulas";
  return (
    <section className="rc-card p-0 overflow-hidden">
      <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between gap-3">
        <div><h2 className="rc-h3">{title}</h2><p className="text-xs text-gray-500 mt-1">Cadastro interno do nutricionista.</p></div>
        <button onClick={onNew} className="rc-btn-primary"><Plus className="w-4 h-4" /> Novo</button>
      </div>
      {loading ? <div className="p-8 text-sm text-gray-400">Carregando...</div> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[840px] text-left">
            <thead><tr className="text-[11px] uppercase tracking-[0.22em] text-gray-400"><th className="px-4 py-3">Nome</th><th className="px-4 py-3">Categoria</th><th className="px-4 py-3">Detalhe</th><th className="px-4 py-3 text-right">Acoes</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-500">Nenhum item cadastrado.</td></tr>}
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-white/[0.05] odd:bg-white/[0.015]">
                  <td className="px-4 py-3"><div className="font-semibold text-white">{row.nome}</div><div className="text-xs text-gray-500">{row.marca || row.fonte || "CUSTOM"}</div></td>
                  <td className="px-4 py-3 text-sm text-gray-300">{row.categoria || "-"}</td>
                  <td className="px-4 py-3 text-sm text-gray-300">{kind === "suplementos" ? `${row.dose_padrao || "-"} ${row.unidade || ""}` : `${row.rendimento || "-"} ${row.unidade_rendimento || ""}`}</td>
                  <td className="px-4 py-3"><div className="flex justify-end gap-2"><button onClick={() => onEdit(row)} className="rc-btn-secondary">Editar</button><button onClick={() => onDelete(row)} className="rc-btn-secondary text-red-400"><Trash2 className="w-4 h-4" /></button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function CadastroInsumos() {
  const [tab, setTab] = useState("suplementos");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (tab === "importar") return;
    let active = true;
    setLoading(true);
    const params = new URLSearchParams({ limit: "120" });
    if (query.trim()) params.set("q", query.trim());
    api.get(`/${tab}?${params.toString()}`)
      .then(({ data }) => {
        if (!active) return;
        setRows(data.items || []);
        setTotal(data.total || 0);
      })
      .catch((e) => toast.error(formatApiError(e.response?.data?.detail)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [tab, query, refresh]);

  const remove = async (row) => {
    if (!window.confirm(`Excluir ${row.nome}?`)) return;
    await api.delete(`/${tab}/${row.id}`);
    toast.success("Item excluido");
    setRefresh((v) => v + 1);
  };

  return (
    <NutriLayout>
      {modal?.kind === "suplementos" && <SupplementModal item={modal.item} onClose={() => setModal(null)} onSaved={() => { setModal(null); setRefresh((v) => v + 1); }} />}
      {modal?.kind === "formulas" && <FormulaModal item={modal.item} onClose={() => setModal(null)} onSaved={() => { setModal(null); setRefresh((v) => v + 1); }} />}
      <div className="space-y-6">
        <section className="rc-card p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="text-xs uppercase tracking-[0.32em] text-rc-blue font-bold">Cadastros</div>
              <h1 className="rc-h2 mt-2">Insumos nutricionais</h1>
              <p className="text-sm text-gray-300 mt-3 max-w-3xl">Base propria para alimentos importados, suplementos e formulas, integrada ao fluxo de dieta e prescricao sem copiar bancos privados.</p>
            </div>
            {tab !== "importar" && <div className="text-sm text-gray-400">{total} itens</div>}
          </div>
        </section>

        <div className="flex flex-wrap gap-2">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setTab(key)} className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-bold ${tab === key ? "bg-rc-blue/15 border-rc-blue/50 text-white" : "border-white/[0.08] text-gray-400 hover:text-white"}`}>
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </div>

        {tab !== "importar" && (
          <section className="rc-card p-5">
            <label className="rc-label">Buscar</label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
              <input className="rc-input pl-11" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nome, categoria, marca..." />
            </div>
          </section>
        )}

        {tab === "importar" ? (
          <ImportCsv onImported={() => setRefresh((v) => v + 1)} />
        ) : (
          <DataTable
            kind={tab}
            rows={rows}
            loading={loading}
            onNew={() => setModal({ kind: tab, item: null })}
            onEdit={(item) => setModal({ kind: tab, item })}
            onDelete={remove}
          />
        )}
      </div>
    </NutriLayout>
  );
}
