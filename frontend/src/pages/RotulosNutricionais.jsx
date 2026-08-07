import React, { useDeferredValue, useEffect, useState } from "react";
import NutriLayout from "@/components/evonut/NutriLayout";
import { api, formatApiError } from "@/lib/evo-api";
import { Download, FileText, Search, ShieldCheck } from "lucide-react";

const highlightNutrients = [
  ["energia_kcal_100g", "Energia (kcal)"],
  ["carboidratos_g", "Carboidratos (g)"],
  ["proteinas_g", "Proteinas (g)"],
  ["lipidios_g", "Gorduras Totais (g)"],
  ["acidos_graxos_saturados_g", "Gorduras Saturadas (g)"],
  ["fibras_g", "Fibra Alimentar (g)"],
  ["sodio_mg", "Sodio (mg)"],
  ["acucar_total_g", "Acucar Total (g)"],
];

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function getValue(food, key) {
  if (!food) return "0";
  const direct = food?.[key];
  if (direct != null && direct !== "") return direct;
  return food?.por_100g?.[key] ?? "0";
}

export default function RotulosNutricionais() {
  const [foods, setFoods] = useState([]);
  const [query, setQuery] = useState("");
  const [selectedName, setSelectedName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
        const rows = data.items || [];
        setFoods(rows);
        setSelectedName((current) => current || rows[0]?.nome || "");
      } catch (err) {
        if (!active) return;
        setError(formatApiError(err.response?.data?.detail) || "Nao foi possivel carregar os rotulos nutricionais.");
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
  const filteredFoods = foods.filter((food) =>
    normalizeText(food.nome).includes(normalizeText(deferredQuery))
  );
  const selectedFood = foods.find((food) => food.nome === selectedName) || filteredFoods[0] || null;

  useEffect(() => {
    if (!selectedFood) return;
    if (selectedFood.nome !== selectedName) {
      setSelectedName(selectedFood.nome);
    }
  }, [selectedFood, selectedName]);

  return (
    <NutriLayout>
      <div className="space-y-6">
        <section className="rc-card p-6 relative overflow-hidden">
          <div className="absolute inset-y-0 right-0 w-1/3 bg-[radial-gradient(circle_at_top_right,rgba(0,129,253,0.28),transparent_60%)] pointer-events-none" />
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="max-w-2xl">
              <div className="text-xs uppercase tracking-[0.32em] text-rc-blue font-bold">Base interna</div>
              <h1 className="rc-h2 mt-2">Rotulos nutricionais</h1>
              <p className="text-sm text-gray-300 mt-3">
                Visualizacao tecnica do rotulo alimentar a partir da base nutricional real do sistema.
              </p>
            </div>
            <div className="rc-btn-secondary opacity-70 cursor-default" data-testid="download-rotulos">
              <Download className="w-4 h-4" />
              Fonte: API
            </div>
          </div>
        </section>

        <section className="grid xl:grid-cols-[360px,1fr] gap-6">
          <div className="rc-card p-5 space-y-4">
            <div className="flex items-center gap-2 text-rc-blue text-sm uppercase tracking-[0.2em] font-bold">
              <ShieldCheck className="w-4 h-4" />
              Acesso nutricionista
            </div>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="rc-input pl-11"
                placeholder="Buscar alimento..."
                data-testid="search-rotulos"
              />
            </div>

            <div className="max-h-[65vh] overflow-auto space-y-2 pr-1">
              {loading && <div className="text-sm text-gray-400 py-6">Carregando alimentos...</div>}
              {!loading && error && <div className="text-sm text-red-400 py-6">{error}</div>}
              {!loading && !error && filteredFoods.map((food, index) => {
                const name = food.nome;
                const active = selectedFood?.nome === name;
                return (
                  <button
                    key={`${name}-${index}`}
                    onClick={() => setSelectedName(name)}
                    className={`w-full text-left rounded-xl border px-4 py-3 transition ${
                      active
                        ? "border-rc-blue bg-rc-blue/10 shadow-[0_10px_30px_-12px_rgba(0,129,253,0.75)]"
                        : "border-white/[0.08] bg-white/[0.02] hover:border-white/[0.16]"
                    }`}
                    data-testid={`rotulo-item-${index}`}
                  >
                    <div className="font-semibold text-white">{name}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {food.grupo_display || food.categoria || "-"}
                      {food.porcao_padrao_g ? ` · porcao base ${food.porcao_padrao_g} g` : ""}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rc-card p-6">
            {!selectedFood && !loading && !error && (
              <div className="text-sm text-gray-500">Nenhum alimento disponivel.</div>
            )}

            {selectedFood && (
              <div className="space-y-6">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-xs uppercase tracking-[0.24em] text-gray-400">Rotulo tecnico</div>
                    <h2 className="rc-h3 mt-2">{selectedFood.nome}</h2>
                    <p className="text-sm text-gray-400 mt-2">Valores referentes a 100 g, com porcao base operacional de {selectedFood.porcao_padrao_g || selectedFood.quantidade_referencia_g || "-"} g.</p>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-rc-blue/30 bg-rc-blue/10 px-3 py-1.5 text-xs uppercase tracking-wider text-rc-blue font-bold">
                    <FileText className="w-4 h-4" />
                    Visual privado
                  </div>
                </div>

                <div className="max-w-md rounded-[28px] border-2 border-white bg-white text-black p-6 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)]">
                  <div className="border-b-4 border-black pb-3">
                    <div className="text-2xl font-black uppercase tracking-tight">Informacao nutricional</div>
                    <div className="text-sm mt-2">Porcao de referencia: 100 g</div>
                  </div>

                  <div className="py-3 border-b-2 border-black">
                    <div className="text-xs uppercase">Valor energetico</div>
                    <div className="text-3xl font-black">{getValue(selectedFood, "energia_kcal_100g")} kcal</div>
                  </div>

                  <div className="divide-y divide-black">
                    {highlightNutrients.slice(1).map(([key, label]) => (
                      <div key={key} className="flex items-center justify-between py-2 text-sm">
                        <span>{label}</span>
                        <span className="font-bold">{getValue(selectedFood, key)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid lg:grid-cols-2 gap-4">
                  {Object.entries(selectedFood)
                    .filter(([key, value]) => !["_id"].includes(key) && value !== "")
                    .map(([key, value]) => (
                      <div key={key} className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
                        <div className="text-[11px] uppercase tracking-[0.2em] text-gray-500">{key}</div>
                        <div className="text-lg font-semibold text-white mt-2">{value}</div>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </NutriLayout>
  );
}
