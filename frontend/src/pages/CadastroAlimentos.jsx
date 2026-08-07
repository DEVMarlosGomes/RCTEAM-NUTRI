import React, { useDeferredValue, useEffect, useState } from "react";
import NutriLayout from "@/components/evonut/NutriLayout";
import { api, formatApiError } from "@/lib/evo-api";
import { Database, Download, Search, Sparkles } from "lucide-react";

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

export default function CadastroAlimentos() {
  const [foods, setFoods] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [total, setTotal] = useState(0);

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
  }, [query]);

  const deferredQuery = useDeferredValue(query);
  const filteredFoods = foods.filter((food) => normalizeText(food.nome).includes(normalizeText(deferredQuery)));

  return (
    <NutriLayout>
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
            <div className="rc-btn-secondary opacity-70 cursor-default" data-testid="download-cadastro-alimentos">
              <Download className="w-4 h-4" />
              Fonte: API
            </div>
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
                  </tr>
                </thead>
                <tbody>
                  {filteredFoods.length === 0 && (
                    <tr>
                      <td colSpan={spotlightFields.length + 1} className="px-4 py-8 text-sm text-gray-500 text-center">
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
