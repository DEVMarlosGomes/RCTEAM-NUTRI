import React, { useDeferredValue, useEffect, useState } from "react";
import NutriLayout from "@/components/evonut/NutriLayout";
import { api, formatApiError } from "@/lib/evo-api";
import { Database, Download, Pencil, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";

const spotlightFields = [
  { key: "energia_kcal_100g", label: "Energia (kcal)" },
  { key: "proteinas_g", label: "Proteinas (g)" },
  { key: "carboidratos_g", label: "Carboidratos (g)" },
  { key: "lipidios_g", label: "Gorduras Totais (g)" },
  { key: "fibras_g", label: "Fibra Alimentar (g)" },
  { key: "sodio_mg", label: "Sodio (mg)" },
];

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const nutrientFields = ["energia_kcal", "proteinas_g", "carboidratos_g", "lipidios_g", "fibras_g", "sodio_mg", "calcio_mg", "ferro_mg", "potassio_mg", "magnesio_mg"];

function FoodModal({ food, onClose, onSaved }) {
  const source = food?.por_100g || {};
  const [form, setForm] = useState({
    nome: food?.nome || "", categoria: food?.categoria || "Outros",
    porcao_padrao_g: food?.porcao_padrao_g || 100, medida_caseira: food?.medida_caseira || "100 g",
    por_100g: Object.fromEntries(nutrientFields.map((key) => [key, source[key] ?? food?.[key] ?? ""])),
  });
  const [saving, setSaving] = useState(false);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const setNutrient = (key, value) => setForm((current) => ({ ...current, por_100g: { ...current.por_100g, [key]: value } }));
  const save = async (event) => {
    event.preventDefault(); setSaving(true);
    const payload = { ...form, porcao_padrao_g: Number(form.porcao_padrao_g), por_100g: Object.fromEntries(Object.entries(form.por_100g).map(([key, value]) => [key, Number(value || 0)])) };
    try {
      if (food) await api.put(`/alimentos/${food.id}`, payload); else await api.post("/alimentos", payload);
      toast.success(food ? "Alimento atualizado." : "Alimento adicionado."); onSaved();
    } catch (error) { toast.error(formatApiError(error.response?.data?.detail)); }
    finally { setSaving(false); }
  };
  return <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"><form onSubmit={save} className="rc-card p-6 w-full max-w-4xl max-h-[92vh] overflow-y-auto">
    <div className="flex justify-between items-center mb-5"><div><div className="text-xs uppercase tracking-widest text-rc-blue font-semibold">Base customizada</div><h2 className="rc-h3 mt-1">{food ? "Editar alimento" : "Novo alimento"}</h2></div><button type="button" onClick={onClose} className="rc-btn-secondary p-2"><X className="w-4 h-4" /></button></div>
    <div className="grid md:grid-cols-2 gap-4"><label><span className="rc-label">Nome *</span><input required className="rc-input" value={form.nome} onChange={(e) => set("nome", e.target.value)} /></label><label><span className="rc-label">Categoria</span><input className="rc-input" value={form.categoria} onChange={(e) => set("categoria", e.target.value)} /></label><label><span className="rc-label">Porção padrão (g)</span><input min="0.1" step="0.1" type="number" className="rc-input" value={form.porcao_padrao_g} onChange={(e) => set("porcao_padrao_g", e.target.value)} /></label><label><span className="rc-label">Medida caseira</span><input className="rc-input" value={form.medida_caseira} onChange={(e) => set("medida_caseira", e.target.value)} /></label></div>
    <div className="mt-5"><div className="rc-label mb-2">Composição por 100 g</div><div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">{nutrientFields.map((key) => <label key={key}><span className="text-xs text-gray-400">{key.replaceAll("_", " ")}</span><input min="0" step="0.01" type="number" className="rc-input" value={form.por_100g[key]} onChange={(e) => setNutrient(key, e.target.value)} /></label>)}</div></div>
    <div className="flex justify-end gap-3 mt-6"><button type="button" onClick={onClose} className="rc-btn-secondary">Cancelar</button><button disabled={saving} className="rc-btn-primary">{saving ? "Salvando..." : "Salvar alimento"}</button></div>
  </form></div>;
}

export default function CadastroAlimentos() {
  const [foods, setFoods] = useState([]);
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
        const params = new URLSearchParams({ limit: "120" });
        if (query.trim().length >= 2) params.set("q", query.trim());
        const { data } = await api.get(`/alimentos?${params.toString()}`, { signal: controller.signal });
        if (!active) return;
        setFoods(data.items || []);
        setTotal(data.total || 0);
      } catch (err) {
        if (!active) return;
        setError(formatApiError(err.response?.data?.detail) || "Nao foi possivel carregar o cadastro de alimentos.");
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

  const remove = async (food) => {
    if (!window.confirm(`Excluir o alimento customizado “${food.nome}”?`)) return;
    try { await api.delete(`/alimentos/${food.id}`); toast.success("Alimento excluído."); setRefreshKey((value) => value + 1); }
    catch (error) { toast.error(formatApiError(error.response?.data?.detail)); }
  };

  const deferredQuery = useDeferredValue(query);
  const filteredFoods = foods.filter((food) => normalizeText(food.nome).includes(normalizeText(deferredQuery)));

  return (
    <NutriLayout>
      {modal && <FoodModal food={modal === "new" ? null : modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); setRefreshKey((value) => value + 1); }} />}
      <div className="space-y-6">
        <section className="rc-card p-6 relative overflow-hidden">
          <div className="absolute inset-y-0 right-0 w-1/3 bg-[radial-gradient(circle_at_top_right,rgba(0,129,253,0.28),transparent_60%)] pointer-events-none" />
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="max-w-2xl">
              <div className="text-xs uppercase tracking-[0.32em] text-rc-blue font-bold">Base interna</div>
              <h1 className="rc-h2 mt-2">Cadastro de alimentos</h1>
              <p className="text-sm text-gray-300 mt-3">
                Base alimentar real do sistema, combinando banco padrao e alimentos customizados do nutricionista.
              </p>
            </div>
            <div className="flex gap-2"><div className="rc-btn-secondary opacity-70 cursor-default" data-testid="download-cadastro-alimentos"><Download className="w-4 h-4" />Fonte: API</div><button onClick={() => setModal("new")} className="rc-btn-primary"><Plus className="w-4 h-4" /> Novo alimento</button></div>
          </div>
        </section>

        <section className="grid md:grid-cols-4 gap-4">
          <div className="rc-card p-5">
            <Database className="w-5 h-5 text-rc-blue" />
            <div className="text-3xl font-display font-bold mt-4">{total}</div>
            <div className="text-xs uppercase tracking-wider text-gray-400 mt-1">Alimentos no banco</div>
          </div>
          <div className="rc-card p-5">
            <Sparkles className="w-5 h-5 text-rc-blue" />
            <div className="text-3xl font-display font-bold mt-4">
              {foods.filter((food) => Number(food.energia_kcal_100g || 0) > 0).length}
            </div>
            <div className="text-xs uppercase tracking-wider text-gray-400 mt-1">Com valor energetico</div>
          </div>
          <div className="rc-card p-5 md:col-span-2">
            <label className="rc-label">Buscar alimento</label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="rc-input pl-11"
                placeholder="Ex: whey, kefir, semente..."
                data-testid="search-cadastro-alimentos"
              />
            </div>
          </div>
        </section>

        <section className="rc-card p-0 overflow-hidden">
          <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="rc-h3">Tabela de composicao</h2>
              <p className="text-xs text-gray-400 mt-1">Acesso restrito ao nutricionista.</p>
            </div>
            <div className="text-xs text-gray-500">{filteredFoods.length} resultados carregados</div>
          </div>

          {loading && <div className="px-6 py-10 text-sm text-gray-400">Carregando cadastro...</div>}
          {!loading && error && <div className="px-6 py-10 text-sm text-red-400">{error}</div>}
          {!loading && !error && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left">
                <thead>
                  <tr className="text-[11px] uppercase tracking-[0.24em] text-gray-400">
                    <th className="px-4 py-3 font-semibold">Alimento</th>
                    {spotlightFields.map((field) => (
                      <th key={field.key} className="px-4 py-3 font-semibold">{field.label}</th>
                    ))}
                    <th className="px-4 py-3 font-semibold text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFoods.length === 0 && (
                    <tr>
                      <td colSpan={spotlightFields.length + 2} className="px-4 py-8 text-sm text-gray-500 text-center">
                        Nenhum alimento encontrado.
                      </td>
                    </tr>
                  )}
                  {filteredFoods.map((food, index) => (
                    <tr
                      key={`${food.id}-${index}`}
                      className="border-t border-white/[0.05] odd:bg-white/[0.015]"
                      data-testid={`food-row-${index}`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-semibold text-white">{food.nome}</div>
                        <div className="text-xs text-gray-500 mt-1">
                          {food.grupo_display || food.categoria || "-"}
                          {food.fonte ? ` · ${food.fonte}` : ""}
                          {food.porcao_padrao_g ? ` · porcao base ${food.porcao_padrao_g} g` : ""}
                        </div>
                      </td>
                      {spotlightFields.map((field) => (
                        <td key={field.key} className="px-4 py-3 text-sm text-gray-300">
                          {food[field.key] ?? food.por_100g?.[field.key] ?? "-"}
                        </td>
                      ))}
                      <td className="px-4 py-3"><div className="flex justify-end gap-1">{food.fonte === "CUSTOM" ? <><button onClick={() => setModal(food)} className="rc-btn-secondary p-2" title="Editar"><Pencil className="w-4 h-4" /></button><button onClick={() => remove(food)} className="rc-btn-secondary p-2 text-red-400" title="Excluir"><Trash2 className="w-4 h-4" /></button></> : <span className="text-[10px] uppercase text-gray-600">Base protegida</span>}</div></td>
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
