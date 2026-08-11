import React, { useDeferredValue, useEffect, useState } from "react";
import NutriLayout from "@/components/evonut/NutriLayout";
import { api, formatApiError } from "@/lib/evo-api";
import { Database, Download, Pencil, Plus, Ruler, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function MeasureModal({ food, onClose, onSaved }) {
  const [form, setForm] = useState({ nome: food?.nome || "", categoria: food?.categoria || "Outros", medida_caseira: food?.medida_caseira || "", porcao_padrao_g: food?.porcao_padrao_g || 100 });
  const [saving, setSaving] = useState(false);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const save = async (event) => {
    event.preventDefault(); setSaving(true);
    const payload = { ...form, porcao_padrao_g: Number(form.porcao_padrao_g), por_100g: food?.por_100g || {} };
    try { if (food) await api.put(`/alimentos/${food.id}`, payload); else await api.post("/alimentos", payload); toast.success(food ? "Medida atualizada." : "Medida adicionada."); onSaved(); }
    catch (error) { toast.error(formatApiError(error.response?.data?.detail)); }
    finally { setSaving(false); }
  };
  return <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"><form onSubmit={save} className="rc-card p-6 w-full max-w-2xl"><div className="flex justify-between items-center mb-5"><div><div className="text-xs uppercase tracking-widest text-rc-blue font-semibold">Medida caseira</div><h2 className="rc-h3 mt-1">{food ? "Editar medida" : "Nova medida"}</h2></div><button type="button" onClick={onClose} className="rc-btn-secondary p-2"><X className="w-4 h-4" /></button></div><div className="grid md:grid-cols-2 gap-4"><label className="md:col-span-2"><span className="rc-label">Alimento *</span><input required className="rc-input" value={form.nome} onChange={(e) => set("nome", e.target.value)} /></label><label><span className="rc-label">Categoria</span><input className="rc-input" value={form.categoria} onChange={(e) => set("categoria", e.target.value)} /></label><label><span className="rc-label">Medida *</span><input required className="rc-input" value={form.medida_caseira} onChange={(e) => set("medida_caseira", e.target.value)} placeholder="Ex.: 1 colher de sopa" /></label><label><span className="rc-label">Equivalência em gramas *</span><input required min="0.1" step="0.1" type="number" className="rc-input" value={form.porcao_padrao_g} onChange={(e) => set("porcao_padrao_g", e.target.value)} /></label></div><div className="flex justify-end gap-3 mt-6"><button type="button" onClick={onClose} className="rc-btn-secondary">Cancelar</button><button disabled={saving} className="rc-btn-primary">{saving ? "Salvando..." : "Salvar medida"}</button></div></form></div>;
}

export default function CadastroMedidas() {
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [total, setTotal] = useState(0);
  const [modal, setModal] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ limit: "160" });
        if (query.trim().length >= 2) params.set("q", query.trim());
        const { data } = await api.get(`/alimentos?${params.toString()}`, { signal: controller.signal });
        if (!active) return;
        const items = (data.items || [])
          .filter((item) => item.medida_caseira || item.porcao_padrao_g)
          .map((item) => ({
            id: item.id,
            nome: item.nome,
            grupo: item.grupo_display || item.categoria || "",
            medida_caseira: item.medida_caseira || "Porcao padrao",
            gramas: item.porcao_padrao_g || item.quantidade_referencia_g || "",
            food: item,
          }));
        setRows(items);
        setTotal(data.total || 0);
      } catch (err) {
        if (!active) return;
        setError(formatApiError(err.response?.data?.detail) || "Nao foi possivel carregar o cadastro de medidas.");
      } finally {
        if (active) setLoading(false);
      }
    };
    const timeout = setTimeout(load, query.trim().length >= 2 ? 250 : 0);

    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [query, refreshKey]);

  const remove = async (row) => {
    if (!window.confirm(`Excluir a medida e o alimento customizado “${row.nome}”?`)) return;
    try { await api.delete(`/alimentos/${row.id}`); toast.success("Medida excluída."); setRefreshKey((value) => value + 1); }
    catch (error) { toast.error(formatApiError(error.response?.data?.detail)); }
  };

  const deferredQuery = useDeferredValue(query);
  const filteredRows = rows.filter((row) => {
    const haystack = `${row.nome} ${row.grupo} ${row.medida_caseira}`;
    return normalizeText(haystack).includes(normalizeText(deferredQuery));
  });

  const distinctFoods = new Set(rows.map((row) => row.nome).filter(Boolean)).size;
  const distinctMeasures = new Set(rows.map((row) => row.medida_caseira).filter(Boolean)).size;

  return (
    <NutriLayout>
      {modal && <MeasureModal food={modal === "new" ? null : modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); setRefreshKey((value) => value + 1); }} />}
      <div className="space-y-6">
        <section className="rc-card p-6 relative overflow-hidden">
          <div className="absolute inset-y-0 right-0 w-1/3 bg-[radial-gradient(circle_at_top_right,rgba(0,129,253,0.28),transparent_60%)] pointer-events-none" />
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="max-w-2xl">
              <div className="text-xs uppercase tracking-[0.32em] text-rc-blue font-bold">Base interna</div>
              <h1 className="rc-h2 mt-2">Cadastro de medidas caseiras</h1>
              <p className="text-sm text-gray-300 mt-3">
                Medidas operacionais ligadas a base alimentar real. Cada alimento exposto aqui ja pode ser usado no consultorio e na prescricao.
              </p>
            </div>
            <div className="flex gap-2"><div className="rc-btn-secondary opacity-70 cursor-default" data-testid="download-cadastro-medidas"><Download className="w-4 h-4" />Fonte: API</div><button onClick={() => setModal("new")} className="rc-btn-primary"><Plus className="w-4 h-4" /> Nova medida</button></div>
          </div>
        </section>

        <section className="grid md:grid-cols-4 gap-4">
          <div className="rc-card p-5">
            <Ruler className="w-5 h-5 text-rc-blue" />
            <div className="text-3xl font-display font-bold mt-4">{total}</div>
            <div className="text-xs uppercase tracking-wider text-gray-400 mt-1">Alimentos no banco</div>
          </div>
          <div className="rc-card p-5">
            <Database className="w-5 h-5 text-rc-blue" />
            <div className="text-3xl font-display font-bold mt-4">{distinctFoods}</div>
            <div className="text-xs uppercase tracking-wider text-gray-400 mt-1">Alimentos com medida</div>
          </div>
          <div className="rc-card p-5">
            <Database className="w-5 h-5 text-rc-blue" />
            <div className="text-3xl font-display font-bold mt-4">{distinctMeasures}</div>
            <div className="text-xs uppercase tracking-wider text-gray-400 mt-1">Tipos de medida</div>
          </div>
          <div className="rc-card p-5">
            <label className="rc-label">Buscar por alimento, grupo ou medida</label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="rc-input pl-11"
                placeholder="Ex: colher, arroz, carne..."
                data-testid="search-cadastro-medidas"
              />
            </div>
          </div>
        </section>

        <section className="rc-card p-0 overflow-hidden">
          <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="rc-h3">Tabela de medidas</h2>
              <p className="text-xs text-gray-400 mt-1">Cada linha representa a medida operacional disponivel hoje para um alimento.</p>
            </div>
            <div className="text-xs text-gray-500">{filteredRows.length} resultados</div>
          </div>

          {loading && <div className="px-6 py-10 text-sm text-gray-400">Carregando medidas...</div>}
          {!loading && error && <div className="px-6 py-10 text-sm text-red-400">{error}</div>}
          {!loading && !error && (
            <div className="overflow-x-auto max-h-[68vh]">
              <table className="w-full min-w-[880px] text-left">
                <thead className="sticky top-0 bg-[#0D131D] z-10">
                  <tr className="text-[11px] uppercase tracking-[0.24em] text-gray-400">
                    <th className="px-4 py-3 font-semibold">Alimento</th>
                    <th className="px-4 py-3 font-semibold">Grupo</th>
                    <th className="px-4 py-3 font-semibold">Medida caseira</th>
                    <th className="px-4 py-3 font-semibold">Gramas</th>
                    <th className="px-4 py-3 font-semibold text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-sm text-gray-500 text-center">
                        Nenhuma medida encontrada.
                      </td>
                    </tr>
                  )}
                  {filteredRows.map((row, index) => (
                    <tr
                      key={`${row.id}-${row.medida_caseira}-${index}`}
                      className="border-t border-white/[0.05] odd:bg-white/[0.015]"
                      data-testid={`measure-row-${index}`}
                    >
                      <td className="px-4 py-3 font-medium text-white">{row.nome}</td>
                      <td className="px-4 py-3 text-sm text-gray-300">{row.grupo || "-"}</td>
                      <td className="px-4 py-3 text-sm text-gray-300">{row.medida_caseira}</td>
                      <td className="px-4 py-3 text-sm text-gray-300">{row.gramas || "-"}</td>
                      <td className="px-4 py-3"><div className="flex justify-end gap-1">{row.food?.fonte === "CUSTOM" ? <><button onClick={() => setModal(row.food)} className="rc-btn-secondary p-2" title="Editar"><Pencil className="w-4 h-4" /></button><button onClick={() => remove(row)} className="rc-btn-secondary p-2 text-red-400" title="Excluir"><Trash2 className="w-4 h-4" /></button></> : <span className="text-[10px] uppercase text-gray-600">Base protegida</span>}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </NutriLayout>
  );
}
