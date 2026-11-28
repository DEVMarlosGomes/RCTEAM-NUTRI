import React, { useDeferredValue, useEffect, useState } from "react";
import NutriLayout from "@/components/evonut/NutriLayout";
import { api, formatApiError } from "@/lib/evo-api";
import { Database, Pencil, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useSearchParams } from "react-router-dom";
import AlimentosIA from "@/components/evonut/AlimentosIA";

// ali1: a lista mostra os macros por 100 g (antes vinha "–" em todos)
const spotlightFields = [
  { key: "energia_kcal_100g", label: "Energia (kcal)", get: (f) => f.energia_kcal_100g },
  { key: "ptn", label: "Proteínas (g)", get: (f) => f.macros_100g?.ptn },
  { key: "cho", label: "Carboidratos (g)", get: (f) => f.macros_100g?.cho },
  { key: "lip", label: "Gorduras (g)", get: (f) => f.macros_100g?.lip },
  { key: "fib", label: "Fibra (g)", get: (f) => f.macros_100g?.fib },
  { key: "sodio", label: "Sódio (mg)", get: (f) => f.sodio_mg_100g },
];
const numBR = (v) => (v == null || v === "" ? "–" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 }));

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

/** Medidas caseiras dentro de cada alimento (ajuste sb1: sai o menu separado de Medidas caseiras). */
function MedidasDoAlimento({ food }) {
  const [medidas, setMedidas] = useState(null);
  useEffect(() => { api.get(`/alimentos/${food.id}/medidas`).then((r) => setMedidas(r.data.medidas || [])).catch(() => setMedidas([])); }, [food.id]);
  if (!medidas) return <span className="text-[12px] text-gray-500">Carregando medidas…</span>;
  const lista = medidas.filter((m) => String(m.nome).toLowerCase() !== "gramas");
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid={`medidas-${food.id}`}>
      {lista.length ? lista.map((m) => (
        <span key={m.nome} className="rounded-lg bg-white/[0.05] px-2.5 py-1 text-[12px] text-gray-200">
          {m.nome}{m.ml ? "" : <span className="text-gray-500"> · {m.estimada ? "≈" : ""}{String(m.gramas).replace(".", ",")} g</span>}
        </span>
      )) : <span className="text-[12px] text-gray-500">Sem medidas caseiras: só gramas.</span>}
      <a href="/cadastro-medidas" className="ml-2 text-[12px] text-rc-blue hover:underline">Editar medidas</a>
    </div>
  );
}

/** Sólido (g) ou líquido (ml) + densidade em g/ml (ex.: leite desnatado 1,03). Ajuste ml1 do Rogério. */
function TipoLiquido({ food }) {
  const [liquido, setLiquido] = useState(Boolean(food.liquido));
  const [dens, setDens] = useState(food.densidade != null ? String(food.densidade).replace(".", ",") : "");
  const salvar = async (liq, d) => {
    const densidade = Number(String(d || "").replace(",", ".")) || null;
    try {
      await api.patch(`/alimentos/${food.id}/liquido`, { liquido: liq, densidade: liq ? densidade : null });
      toast.success(liq ? `${food.nome}: líquido (ml)${densidade ? ` · ${String(densidade).replace(".", ",")} g/ml` : ""}.` : `${food.nome}: sólido (g).`);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  return (
    <div className="flex items-center gap-1.5" data-testid={`tipo-${food.id}`}>
      <div className="inline-flex rounded-lg bg-white/[0.04] p-0.5 ring-1 ring-white/[0.06]">
        {[[false, "g"], [true, "ml"]].map(([v, l]) => (
          <button key={l} type="button" aria-pressed={liquido === v} onClick={() => { setLiquido(v); salvar(v, dens); }}
            className={`h-7 w-9 rounded-md text-[12px] font-semibold ${liquido === v ? "bg-rc-blue text-white" : "text-gray-400 hover:text-white"}`}>{l}</button>
        ))}
      </div>
      {liquido && (
        <input className="rc-input h-8 w-16 text-[12px] tabular" inputMode="decimal" placeholder="1,00" title="Densidade (g/ml)" aria-label={`Densidade de ${food.nome}`}
          value={dens} onChange={(e) => setDens(e.target.value)} onBlur={() => salvar(true, dens)} />
      )}
    </div>
  );
}

export default function CadastroAlimentos() {
  const [medidasAbertas, setMedidasAbertas] = useState({});
  const [foods, setFoods] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [total, setTotal] = useState(0);
  const [modal, setModal] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [ordem, setOrdem] = useState("alfabetica");
  const [categoria, setCategoria] = useState("");
  const [busca] = useSearchParams();
  const [ia, setIa] = useState(() => (busca.get("ia") != null ? busca.get("ia") : null));

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        // a base (TABELA ENXUTA) tem 262 alimentos: cabe inteira numa página, junto dos personalizados
        const params = new URLSearchParams({ limit: "300" });
        if (query.trim().length >= 2) params.set("q", query.trim());
        if (ordem === "planilha") params.set("ordenar", "planilha");
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
  }, [query, refreshKey, ordem]);

  const remove = async (food) => {
    if (!window.confirm(`Excluir o alimento customizado “${food.nome}”?`)) return;
    try { await api.delete(`/alimentos/${food.id}`); toast.success("Alimento excluído."); setRefreshKey((value) => value + 1); }
    catch (error) { toast.error(formatApiError(error.response?.data?.detail)); }
  };

  const deferredQuery = useDeferredValue(query);
  const categorias = [...new Set(foods.map((f) => f.categoria_app || "Outros"))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const filteredFoods = foods.filter((food) => normalizeText(food.nome).includes(normalizeText(deferredQuery)) && (!categoria || (food.categoria_app || "Outros") === categoria));

  return (
    <NutriLayout>
      {ia != null && <AlimentosIA inicial={ia} onClose={() => setIa(null)} onSalvo={() => setRefreshKey((v) => v + 1)} />}
      {modal && <FoodModal food={modal === "new" ? null : modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); setRefreshKey((value) => value + 1); }} />}
      <div className="space-y-6">
        <section className="rc-card p-6 relative overflow-hidden">
          <div className="absolute inset-y-0 right-0 w-1/3 bg-[radial-gradient(circle_at_top_right,rgba(0,129,253,0.28),transparent_60%)] pointer-events-none" />
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="max-w-2xl">
              <div className="rc-eyebrow">Base interna</div>
              <h1 className="rc-h2 mt-2">Cadastro de alimentos</h1>
              <p className="text-sm text-gray-300 mt-3">
                Base do sistema: TABELA ENXUTA (262 alimentos escolhidos pelo Rogério), mais os alimentos que você cadastrar.
              </p>
            </div>
            <div className="flex flex-wrap gap-2"><button onClick={() => setIa("")} className="rc-btn-primary" data-testid="cadastrar-ia"><Sparkles className="w-4 h-4" /> Cadastrar com IA</button><button onClick={() => setModal("new")} className="rc-btn-secondary"><Plus className="w-4 h-4" /> Novo alimento</button></div>
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
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-gray-400">
                Ordem
                <select value={ordem} onChange={(e) => setOrdem(e.target.value)} className="rc-input h-8 py-0 text-xs w-auto" data-testid="ordem-cadastro-alimentos">
                  <option value="alfabetica">Alfabética</option>
                  <option value="planilha">Da planilha</option>
                </select>
              </label>
              <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className="rc-input h-8 py-0 text-xs w-auto" aria-label="Categoria" data-testid="filtro-categoria">
                <option value="">Todas as categorias</option>
                {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <div className="text-xs text-gray-500">{filteredFoods.length} resultados carregados</div>
            </div>
          </div>

          {loading && <div className="px-6 py-10 text-sm text-gray-400">Carregando cadastro...</div>}
          {!loading && error && <div className="px-6 py-10 text-sm text-red-400">{error}</div>}
          {!loading && !error && (
            <div className="overflow-x-auto">
              <table className="tabela-responsiva w-full min-w-[720px] text-left">
                <thead>
                  <tr className="text-[11px] uppercase tracking-[0.24em] text-gray-400">
                    <th className="px-4 py-3 font-semibold">Alimento</th>
                    {spotlightFields.map((field) => (
                      <th key={field.key} className="px-4 py-3 font-semibold">{field.label}</th>
                    ))}
                    <th className="px-4 py-3 font-semibold">Tipo</th>
                    <th className="px-4 py-3 font-semibold text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFoods.length === 0 && (
                    <tr>
                      <td colSpan={spotlightFields.length + 3} className="px-4 py-8 text-sm text-gray-500 text-center">
                        Nenhum alimento encontrado.
                      </td>
                    </tr>
                  )}
                  {filteredFoods.map((food, index) => (
                    <React.Fragment key={`${food.id}-${index}`}>
                    <tr
                      className="border-t border-white/[0.05] odd:bg-white/[0.015]"
                      data-testid={`food-row-${index}`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-semibold text-white">{food.nome}</div>
                        <button type="button" onClick={() => setMedidasAbertas((s) => ({ ...s, [food.id]: !s[food.id] }))} className="mt-1 text-[11.5px] text-rc-blue hover:underline" data-testid={`ver-medidas-${food.id}`}>
                          {medidasAbertas[food.id] ? "Esconder medidas caseiras" : "Medidas caseiras"}
                        </button>
                        <div className="text-xs text-gray-500 mt-1">
                          {food.categoria_app || food.grupo_display || food.categoria || "-"}
                          {food.fonte ? ` · ${food.fonte}` : ""}
                          {food.porcao_padrao_g ? ` · porcao base ${food.porcao_padrao_g} g` : ""}
                        </div>
                      </td>
                      {spotlightFields.map((field) => (
                        <td key={field.key} data-rot={field.label} className="px-4 py-3 text-sm text-gray-300">
                          {numBR(field.get(food))}
                        </td>
                      ))}
                      <td data-rot="Tipo" className="px-4 py-3"><TipoLiquido food={food} /></td>
                      <td className="px-4 py-3"><div className="flex justify-end gap-1">{food.fonte === "CUSTOM" ? <><button onClick={() => setModal(food)} className="rc-btn-secondary p-2" title="Editar"><Pencil className="w-4 h-4" /></button><button onClick={() => remove(food)} className="rc-btn-secondary p-2 text-red-400" title="Excluir"><Trash2 className="w-4 h-4" /></button></> : <span className="text-[10px] uppercase text-gray-600">Base protegida</span>}</div></td>
                    </tr>
                    {medidasAbertas[food.id] && (
                      <tr className="bg-white/[0.02]"><td colSpan={spotlightFields.length + 3} className="px-4 pb-3"><MedidasDoAlimento food={food} /></td></tr>
                    )}
                    </React.Fragment>
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
