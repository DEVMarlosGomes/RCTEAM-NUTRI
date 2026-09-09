import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Bot, CheckCircle2, Download, Edit2, Plus, Save, Search, Trash2, Utensils, X } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/evo-api";

const EMPTY_PLANS = [];
const STRATEGIES = [
  ["carbo_alto", "Carbo alto", "PLANO ALIMENTAR - CARBO ALTO"],
  ["carbo_medio", "Carbo médio", "PLANO ALIMENTAR - CARBO MÉDIO"],
  ["carbo_baixo", "Carbo baixo", "PLANO ALIMENTAR - CARBO BAIXO"],
];
const MEAL_NAMES = Array.from({ length: 10 }, (_, index) => `Refeição ${index + 1}`);
const FOOD_COLUMNS = [
  ["preferencia", "Alimentos de preferência"],
  ["sub1", "Alimentos substitutos 1"],
  ["sub2", "Alimentos substitutos 2"],
];
const MACROS = [
  ["energia_kcal", "Kcal", "kcal"],
  ["proteinas_g", "Prot", "g"],
  ["carboidratos_g", "Carb", "g"],
  ["lipidios_g", "Lip", "g"],
];
const numberFmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

const patientAge = (patient) => {
  const birth = patient?.data_nascimento ? new Date(`${patient.data_nascimento}T12:00:00`) : null;
  if (!birth || Number.isNaN(birth.getTime())) return "";
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  if (now < new Date(now.getFullYear(), birth.getMonth(), birth.getDate())) age -= 1;
  return Math.max(age, 0);
};

const lastEvaluation = (data) => {
  const rows = data.evaluations || [];
  return [...rows].sort((a, b) => String(b.data_avaliacao || b.created_at || "").localeCompare(String(a.data_avaliacao || a.created_at || "")))[0];
};

const toNumber = (value) => {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
};

const round = (value) => Math.round((Number(value || 0)) * 100) / 100;

const fmt = (value, unit = "") => {
  if (value === null || value === undefined || value === "") return "-";
  return `${numberFmt.format(Number(value) || 0)}${unit ? ` ${unit}` : ""}`;
};

const strategyTitle = (strategy) => STRATEGIES.find(([key]) => key === strategy)?.[2] || STRATEGIES[0][2];

const getItemName = (item) => item?.alimento_nome || item?._nome || item?.nome || "";

const getItemMacro = (item, key) => {
  const n = item?.nutrientes || {};
  if (n[key] != null) return Number(n[key]) || 0;
  if (key === "energia_kcal" && item?._kcal100g) return round((item._kcal100g / 100) * toNumber(item.quantidade_g));
  return 0;
};

const sumMeal = (meal) => {
  const totals = { energia_kcal: 0, proteinas_g: 0, carboidratos_g: 0, lipidios_g: 0 };
  for (const item of meal.alimentos || []) {
    for (const [key] of MACROS) totals[key] = round(totals[key] + getItemMacro(item, key));
  }
  return totals;
};

const sumDay = (meals) => {
  const totals = { energia_kcal: 0, proteinas_g: 0, carboidratos_g: 0, lipidios_g: 0 };
  for (const meal of meals || []) {
    const mealTotals = meal.totais || sumMeal(meal);
    for (const [key] of MACROS) totals[key] = round(totals[key] + (Number(mealTotals[key]) || 0));
  }
  return totals;
};

const defaultDraft = (d) => {
  const patient = d.patient || {};
  const evaluation = lastEvaluation(d);
  const peso = patient.peso || evaluation?.peso || "";
  const altura = patient.altura || evaluation?.altura || "";
  const get = evaluation?.composicao?.get_kcal || "";
  return {
    titulo: "Plano Alimentar",
    objetivo: patient.objetivo || "",
    estrategia: "carbo_alto",
    nome: patient.nome || "",
    peso,
    altura,
    idade: patientAge(patient) || evaluation?.idade || "",
    get,
    agua_max_ml: peso ? Math.round(Number(peso) * 50) : "",
    agua_min_ml: peso ? Math.round(Number(peso) * 35) : "",
    kcal_kg: peso && get ? round(Number(get) / Number(peso)) : "",
    meta_kcal: get || "",
    meta_proteina_g: "",
    meta_carboidrato_g: "",
    meta_lipidio_g: "",
    observacoes: "",
    refeicoes: MEAL_NAMES.map((nome) => ({
      nome,
      horario: "",
      meta_kcal: "",
      alimentos: [],
      observacao: "",
    })),
  };
};

const draftFromPlan = (plan, d) => {
  const base = defaultDraft(d);
  const meta = plan.prescricao_dietetica || {};
  return {
    ...base,
    ...meta,
    titulo: plan.titulo || base.titulo,
    objetivo: plan.objetivo || meta.objetivo || base.objetivo,
    estrategia: plan.estrategia || meta.estrategia || base.estrategia,
    meta_kcal: plan.meta_kcal ?? meta.meta_kcal ?? base.meta_kcal,
    meta_proteina_g: plan.meta_proteina_g ?? "",
    meta_carboidrato_g: plan.meta_carboidrato_g ?? "",
    meta_lipidio_g: plan.meta_lipidio_g ?? "",
    observacoes: plan.observacoes || "",
    refeicoes: MEAL_NAMES.map((name, index) => ({
      ...base.refeicoes[index],
      ...(plan.refeicoes?.[index] || {}),
      alimentos: plan.refeicoes?.[index]?.alimentos || [],
    })),
  };
};

const sanitize = (draft) => ({
  titulo: draft.titulo || "Plano Alimentar",
  objetivo: draft.objetivo || null,
  estrategia: draft.estrategia,
  meta_kcal: draft.meta_kcal || null,
  meta_proteina_g: draft.meta_proteina_g || null,
  meta_carboidrato_g: draft.meta_carboidrato_g || null,
  meta_lipidio_g: draft.meta_lipidio_g || null,
  prescricao_dietetica: {
    nome: draft.nome,
    peso: draft.peso,
    altura: draft.altura,
    idade: draft.idade,
    get: draft.get,
    agua_max_ml: draft.agua_max_ml,
    agua_min_ml: draft.agua_min_ml,
    kcal_kg: draft.kcal_kg,
    estrategia: draft.estrategia,
  },
  observacoes: draft.observacoes || "",
  refeicoes: (draft.refeicoes || []).map((meal) => ({
    nome: meal.nome,
    horario: meal.horario || "",
    meta_kcal: meal.meta_kcal || null,
    observacao: meal.observacao || "",
    alimentos: (meal.alimentos || []).filter((item) => item.alimento_id).map((item) => ({
      alimento_id: item.alimento_id,
      medida_nome: item.medida_nome || "Gramas",
      quantidade: Number(item.quantidade || item.quantidade_g || 0),
      quantidade_g: Number(item.quantidade_g || item.quantidade || 0),
      substituivel: item.substituivel !== false,
      substitutos: (item.substitutos || []).filter((sub) => sub.alimento_id).map((sub) => ({
        alimento_id: sub.alimento_id,
        nome: sub.nome || sub.alimento_nome,
        medida_nome: sub.medida_nome || "Gramas",
        quantidade: Number(sub.quantidade || sub.quantidade_g || 0),
        quantidade_g: Number(sub.quantidade_g || sub.quantidade || 0),
      })),
      observacao: item.observacao || "",
    })),
  })),
});

function FoodSearchModal({ title, onSelect, onClose }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 50); }, []);
  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return undefined;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await api.get(`/alimentos?q=${encodeURIComponent(q)}&limit=30`);
        setResults(data.items || []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[86vh] w-full flex-col rounded-t-2xl border border-white/[0.1] bg-[#0C1018] shadow-2xl sm:max-w-xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <div>
            <div className="text-sm font-bold text-white">{title}</div>
            <div className="text-[11px] text-gray-500">Buscar alimento do cadastro</div>
          </div>
          <button type="button" onClick={onClose} className="evo-btn-ghost p-2"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-4">
          <div className="flex items-center gap-3 rounded-lg border border-white/[0.08] bg-white/[0.05] px-3 py-2">
            <Search className="h-4 w-4 text-gray-500" />
            <input ref={inputRef} value={q} onChange={(event) => setQ(event.target.value)} className="flex-1 bg-transparent text-sm text-white outline-none" placeholder="Digite ao menos 2 letras" />
          </div>
        </div>
        <div className="min-h-[260px] flex-1 overflow-y-auto">
          {!loading && results.length === 0 && <div className="px-5 py-10 text-center text-sm text-gray-500">Nenhum alimento selecionado.</div>}
          {results.map((food) => (
            <button
              key={food.id}
              type="button"
              onClick={() => onSelect(food)}
              className="flex w-full items-center justify-between gap-3 border-b border-white/[0.04] px-5 py-3 text-left hover:bg-white/[0.04]"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-white">{food.nome}</div>
                <div className="mt-0.5 truncate text-[11px] text-gray-500">{food.grupo_display || food.grupo || food.categoria || "-"}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-bold text-white">{Math.round(food.energia_kcal_100g || 0)}</div>
                <div className="text-[10px] text-gray-600">kcal/100g</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Input({ label, value, onChange, type = "text", unit }) {
  return (
    <label className="block">
      <span className="evo-label">{label}</span>
      <div className="relative">
        <input type={type} className={`evo-input h-10 ${unit ? "pr-16" : ""}`} value={value ?? ""} onChange={(event) => onChange(event.target.value)} />
        {unit && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-gray-500">{unit}</span>}
      </div>
    </label>
  );
}

function MacroBox({ label, grams, kcal, pct, gkg }) {
  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.035] p-3">
      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{label}</div>
      <div className="mt-2 grid grid-cols-4 gap-2 text-center text-xs">
        <div><div className="text-gray-500">g</div><div className="font-semibold text-white">{fmt(grams)}</div></div>
        <div><div className="text-gray-500">%</div><div className="font-semibold text-white">{fmt(pct)}</div></div>
        <div><div className="text-gray-500">Kcal</div><div className="font-semibold text-white">{fmt(kcal)}</div></div>
        <div><div className="text-gray-500">g/kg</div><div className="font-semibold text-white">{fmt(gkg)}</div></div>
      </div>
    </div>
  );
}

function FoodCell({ item, label, onPick, onQty, onMeasure }) {
  return (
    <div className="min-w-[220px]">
      <button type="button" onClick={onPick} className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-left hover:border-rc-blue/40">
        <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{label}</div>
        <div className="mt-1 min-h-[20px] truncate text-sm font-semibold text-white">{getItemName(item) || "Selecionar alimento"}</div>
      </button>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <input className="evo-input h-9" type="number" value={item?.quantidade || ""} onChange={(event) => onQty(event.target.value)} placeholder="Qtd" />
        <input className="evo-input h-9" value={item?.medida_nome || "Gramas"} onChange={(event) => onMeasure(event.target.value)} placeholder="Medida" />
      </div>
    </div>
  );
}

function PlanSelector({ plans, selectedId, onSelect, onNew, onEdit, onDelete, onPdf }) {
  return (
    <div className="evo-card flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="flex min-w-[260px] flex-1 gap-2 overflow-x-auto">
        {plans.map((plan) => (
          <button
            key={plan.id}
            type="button"
            onClick={() => onSelect(plan)}
            className={`shrink-0 rounded-lg border px-3 py-2 text-left text-xs ${selectedId === plan.id ? "border-rc-blue/50 bg-rc-blue/10 text-white" : "border-white/[0.08] text-gray-400 hover:text-white"}`}
          >
            <div className="font-semibold">{plan.titulo || "Plano Alimentar"}</div>
            <div className="mt-0.5 text-[10px] text-gray-500">v{plan.versao || 1} · {plan.estrategia || "sem estratégia"}</div>
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={onNew} className="evo-btn-primary"><Plus className="h-4 w-4" />Novo</button>
        {selectedId && <button type="button" onClick={onEdit} className="evo-btn-secondary"><Edit2 className="h-4 w-4" />Editar</button>}
        {selectedId && <button type="button" onClick={onPdf} className="evo-btn-secondary"><Download className="h-4 w-4" />PDF</button>}
        {selectedId && <button type="button" onClick={onDelete} className="evo-btn-ghost p-2 text-red-400"><Trash2 className="h-4 w-4" /></button>}
      </div>
    </div>
  );
}

function DonatoSummaryMetric({ label, value, suffix }) {
  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.035] p-3">
      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{label}</div>
      <div className="mt-1 text-lg font-black text-white">{value ?? "-"}{value != null && suffix ? ` ${suffix}` : ""}</div>
    </div>
  );
}

function DonatoDraftView({ generation, onApprove, onReject, approving, rejecting }) {
  if (!generation?.draft) return null;
  const draft = generation.draft;
  const resumo = draft.resumo_nutricional || {};
  const errors = draft.validacao?.erros || [];
  const warnings = draft.validacao?.avisos || [];
  const pending = draft.dados_pendentes || [];
  const canApprove = draft.status !== "needs_data" && generation.approval_status !== "approved";

  return (
    <div className="rounded-xl border border-rc-blue/25 bg-rc-blue/[0.04] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-rc-blue/30 bg-rc-blue/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-rc-blue">
              <Bot className="h-3.5 w-3.5" /> Rascunho gerado por IA
            </span>
            <span className="rounded-full border border-white/[0.08] px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-gray-400">
              {generation.approval_status === "approved" ? "Aprovado" : draft.status}
            </span>
          </div>
          <h3 className="mt-3 text-lg font-black text-white">DONATO · Prescrição estruturada</h3>
          <p className="mt-1 text-xs text-gray-500">Schema {draft.versao_schema || generation.schema_version} · revisão humana obrigatória</p>
        </div>
        <div className="flex gap-2">
          {generation.approval_status !== "approved" && (
            <button type="button" onClick={onReject} disabled={rejecting} className="evo-btn-ghost text-red-300">
              <X className="h-4 w-4" />{rejecting ? "Rejeitando..." : "Rejeitar"}
            </button>
          )}
          <button type="button" onClick={onApprove} disabled={!canApprove || approving} className="evo-btn-primary">
            <CheckCircle2 className="h-4 w-4" />{approving ? "Aprovando..." : "Aprovar e salvar"}
          </button>
        </div>
      </div>

      {(pending.length > 0 || errors.length > 0 || warnings.length > 0) && (
        <div className="mt-4 rounded-lg border border-yellow-400/20 bg-yellow-400/[0.06] p-3 text-xs text-yellow-100">
          <div className="mb-2 flex items-center gap-2 font-bold uppercase tracking-wider">
            <AlertTriangle className="h-4 w-4" /> Validação
          </div>
          {[...pending.map((item) => `Dado pendente: ${item}`), ...errors, ...warnings].map((item, index) => (
            <div key={`${item}-${index}`} className="py-0.5">- {item}</div>
          ))}
        </div>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-5">
        <DonatoSummaryMetric label="Energia" value={resumo.valor_energetico_total_kcal} suffix="kcal" />
        <DonatoSummaryMetric label="Proteína" value={resumo.proteinas?.quantidade_g} suffix="g" />
        <DonatoSummaryMetric label="Carboidrato" value={resumo.carboidratos?.quantidade_g} suffix="g" />
        <DonatoSummaryMetric label="Gorduras" value={resumo.gorduras?.quantidade_g} suffix="g" />
        <DonatoSummaryMetric label="Água" value={resumo.agua_recomendada_ml} suffix="ml" />
      </div>

      {!!draft.protocolos_aplicados?.length && (
        <div className="mt-4 flex flex-wrap gap-2">
          {draft.protocolos_aplicados.map((p) => (
            <span key={`${p.codigo}-${p.source_document_id}`} className="rounded-full border border-white/[0.08] px-2.5 py-1 text-[11px] text-gray-300">
              {p.titulo} · {p.source_document_id}
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 space-y-3">
        {(draft.refeicoes || []).map((meal) => (
          <section key={`${meal.ordem}-${meal.nome}`} className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-bold text-white">{meal.nome}</div>
              <div className="text-xs text-gray-500">{meal.resumo_refeicao?.energia_kcal ?? 0} kcal</div>
            </div>
            <div className="mt-3 grid gap-2 lg:grid-cols-2">
              {(meal.alimentos || []).map((food) => (
                <div key={`${meal.ordem}-${food.alimento_id}`} className="rounded-lg border border-white/[0.06] bg-black/10 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">{food.nome}</div>
                      <div className="text-xs text-gray-500">{food.quantidade?.medida_caseira || "-"} · {food.quantidade?.peso_g ?? "-"} g</div>
                    </div>
                    <div className="text-right text-xs text-gray-400">{food.nutrientes?.energia_kcal ?? 0} kcal</div>
                  </div>
                  {!!food.alternativas?.length && (
                    <div className="mt-2 border-t border-white/[0.06] pt-2">
                      <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-gray-500">Alternativas correspondentes</div>
                      {food.alternativas.map((alt) => (
                        <div key={`${food.alimento_id}-${alt.alimento_id}`} className="text-xs text-gray-300">
                          {alt.nome} · {alt.quantidade?.medida_caseira || "-"} · {alt.quantidade?.peso_g ?? "-"} g
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {draft.justificativa_tecnica?.texto && (
        <div className="mt-4 rounded-lg border border-white/[0.08] bg-black/10 p-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Justificativa técnica</div>
          <p className="mt-1 text-sm leading-relaxed text-gray-300">{draft.justificativa_tecnica.texto}</p>
        </div>
      )}
    </div>
  );
}

function DonatoPanel({ d, onApproved }) {
  const pid = d.patient.id;
  const [knowledge, setKnowledge] = useState(null);
  const [drafts, setDrafts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  const reload = useCallback(async () => {
    const [knowledgeResponse, draftsResponse] = await Promise.all([
      api.get("/agents/donato/knowledge"),
      api.get(`/patients/${pid}/donato/plans`),
    ]);
    setKnowledge(knowledgeResponse.data);
    setDrafts(draftsResponse.data || []);
    setSelected((current) => current || draftsResponse.data?.[0] || null);
  }, [pid]);

  useEffect(() => { reload().catch(() => {}); }, [reload]);

  const generate = async () => {
    setGenerating(true);
    try {
      const { data } = await api.post(`/patients/${pid}/donato/plan/draft`, {
        objetivo: d.patient?.objetivo || null,
        numero_refeicoes: 6,
      });
      setSelected(data);
      await reload();
      toast.success("Rascunho DONATO gerado.");
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail));
    } finally {
      setGenerating(false);
    }
  };

  const approve = async () => {
    if (!selected) return;
    setApproving(true);
    try {
      await api.post(`/patients/${pid}/donato/plans/${selected.id}/approve`);
      toast.success("Rascunho aprovado e salvo como prescrição.");
      await reload();
      onApproved?.();
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail));
    } finally {
      setApproving(false);
    }
  };

  const reject = async () => {
    if (!selected) return;
    setRejecting(true);
    try {
      await api.post(`/patients/${pid}/donato/plans/${selected.id}/reject`);
      toast.success("Rascunho DONATO rejeitado.");
      setSelected(null);
      await reload();
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail));
    } finally {
      setRejecting(false);
    }
  };

  return (
    <div className="evo-card space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-rc-blue" />
            <h2 className="font-display text-lg font-black text-white">DONATO</h2>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Plano alimentar · Protocolos · Motor nutricional · {knowledge?.schema_version ? `Schema ${knowledge.schema_version}` : "Base de conhecimento"}
          </p>
        </div>
        <button type="button" onClick={generate} disabled={generating || knowledge?.enabled === false} className="evo-btn-primary">
          <Bot className="h-4 w-4" />{generating ? "Gerando..." : "Gerar com DONATO"}
        </button>
      </div>

      {knowledge && (
        <div className="grid gap-2 text-xs md:grid-cols-4">
          <div className="rounded-lg bg-white/[0.035] p-3 text-gray-400">OpenAI: <span className={knowledge.openai_configured ? "text-emerald-300" : "text-yellow-300"}>{knowledge.openai_configured ? "configurado" : "pendente"}</span></div>
          <div className="rounded-lg bg-white/[0.035] p-3 text-gray-400">Docs aprovados: <span className="text-white">{knowledge.approved_documents}</span></div>
          <div className="rounded-lg bg-white/[0.035] p-3 text-gray-400">Aguardando revisão: <span className="text-white">{knowledge.waiting_review_documents}</span></div>
          <div className="rounded-lg bg-white/[0.035] p-3 text-gray-400">Source gate: <span className={knowledge.strict_source_gate ? "text-yellow-300" : "text-emerald-300"}>{knowledge.strict_source_gate ? "ativo" : "aberto"}</span></div>
        </div>
      )}

      {knowledge?.missing_required_sources?.length > 0 && (
        <div className="rounded-lg border border-yellow-400/20 bg-yellow-400/[0.06] p-3 text-xs text-yellow-100">
          Pendências da base: {knowledge.missing_required_sources.join(", ")}.
        </div>
      )}

      {drafts.length > 0 && (
        <div className="flex gap-2 overflow-x-auto">
          {drafts.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelected(item)}
              className={`shrink-0 rounded-lg border px-3 py-2 text-left text-xs ${selected?.id === item.id ? "border-rc-blue/50 bg-rc-blue/10 text-white" : "border-white/[0.08] text-gray-400 hover:text-white"}`}
            >
              <div className="font-semibold">{item.approval_status === "approved" ? "Aprovado" : "Rascunho"}</div>
              <div className="mt-0.5 text-[10px] text-gray-500">{new Date(item.created_at).toLocaleDateString("pt-BR")} · {item.status}</div>
            </button>
          ))}
        </div>
      )}

      <DonatoDraftView generation={selected} onApprove={approve} onReject={reject} approving={approving} rejecting={rejecting} />
    </div>
  );
}

export default function PrescricaoDietetica({ d }) {
  const pid = d.patient.id;
  const [plans, setPlans] = useState(EMPTY_PLANS);
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState(() => defaultDraft(d));
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState(null);

  const loadPlans = useCallback(async () => {
    const { data } = await api.get(`/patients/${pid}/planos-manuais`);
    setPlans(data || []);
    setSelected((current) => current || data?.[0] || null);
    if (!editingId && data?.[0]) setDraft(draftFromPlan(data[0], d));
  }, [d, editingId, pid]);

  useEffect(() => { loadPlans().catch(() => {}); }, [loadPlans]);

  const display = draft;
  const dayTotals = sumDay(display.refeicoes);
  const peso = toNumber(display.peso);
  const kcal = toNumber(dayTotals.energia_kcal || display.meta_kcal);
  const macroPct = (value, factor) => kcal ? round((toNumber(value) * factor / kcal) * 100) : 0;

  const setDraftValue = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const updateMeal = (mealIndex, updater) => setDraft((current) => {
    const meals = [...current.refeicoes];
    meals[mealIndex] = updater(meals[mealIndex]);
    return { ...current, refeicoes: meals };
  });

  const upsertFood = (mealIndex, itemIndex, slot, food) => {
    const quantity = food.porcao_padrao_g || food.quantidade_referencia_g || 100;
    const nextFood = {
      alimento_id: food.id,
      alimento_nome: food.nome,
      nome: food.nome,
      medida_nome: food.medida_caseira || "Gramas",
      quantidade: quantity,
      quantidade_g: quantity,
      _nome: food.nome,
      _kcal100g: food.energia_kcal_100g || 0,
      _grupo: food.grupo_display || food.grupo || food.categoria,
    };

    updateMeal(mealIndex, (meal) => {
      const foods = [...(meal.alimentos || [])];
      const base = foods[itemIndex] || { quantidade: quantity, quantidade_g: quantity, medida_nome: "Gramas", substitutos: [] };
      if (slot === "preferencia") foods[itemIndex] = { ...base, ...nextFood, substitutos: base.substitutos || [] };
      if (slot === "sub1" || slot === "sub2") {
        const subIndex = slot === "sub1" ? 0 : 1;
        const subs = [...(base.substitutos || [])];
        subs[subIndex] = nextFood;
        foods[itemIndex] = { ...base, substitutos: subs };
      }
      return { ...meal, alimentos: foods };
    });
    setPicker(null);
  };

  const updateFood = (mealIndex, itemIndex, slot, patch) => updateMeal(mealIndex, (meal) => {
    const foods = [...(meal.alimentos || [])];
    const item = foods[itemIndex] || { substitutos: [] };
    if (slot === "preferencia") foods[itemIndex] = { ...item, ...patch };
    else {
      const subIndex = slot === "sub1" ? 0 : 1;
      const subs = [...(item.substitutos || [])];
      subs[subIndex] = { ...(subs[subIndex] || {}), ...patch };
      foods[itemIndex] = { ...item, substitutos: subs };
    }
    return { ...meal, alimentos: foods };
  });

  const save = async () => {
    setSaving(true);
    try {
      const payload = sanitize(draft);
      const targetId = editingId || selected?.id;
      const response = targetId
        ? await api.put(`/patients/${pid}/planos-manuais/${targetId}`, payload)
        : await api.post(`/patients/${pid}/planos-manuais`, payload);
      toast.success("Prescrição dietética salva.");
      setEditingId(null);
      await loadPlans();
      setSelected(response.data);
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!selected || !window.confirm("Excluir esta prescrição dietética?")) return;
    await api.delete(`/patients/${pid}/planos-manuais/${selected.id}`);
    toast.success("Prescrição excluída.");
    setSelected(null);
    setDraft(defaultDraft(d));
    await loadPlans();
  };

  const downloadPdf = async () => {
    if (!selected) return;
    const response = await api.get(`/patients/${pid}/relatorios/plano-alimentar/${selected.id}`, { responseType: "blob" });
    const url = window.URL.createObjectURL(new Blob([response.data], { type: "application/pdf" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `prescricao-${(selected.titulo || "plano").replace(/\s+/g, "-")}.pdf`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
  };

  const startNew = () => {
    setSelected(null);
    setEditingId(null);
    setDraft(defaultDraft(d));
  };

  const startEdit = () => {
    if (!selected) return;
    setEditingId(selected.id);
    setDraft(draftFromPlan(selected, d));
  };

  return (
    <div className="space-y-4" data-testid="prescricao-dietetica-workspace">
      {picker && (
        <FoodSearchModal
          title={`${display.refeicoes[picker.mealIndex]?.nome || "Refeição"} · ${FOOD_COLUMNS.find(([key]) => key === picker.slot)?.[1]}`}
          onSelect={(food) => upsertFood(picker.mealIndex, picker.itemIndex, picker.slot, food)}
          onClose={() => setPicker(null)}
        />
      )}

      <PlanSelector
        plans={plans}
        selectedId={selected?.id}
        onSelect={(plan) => { setSelected(plan); setEditingId(null); setDraft(draftFromPlan(plan, d)); }}
        onNew={startNew}
        onEdit={startEdit}
        onDelete={remove}
        onPdf={downloadPdf}
      />

      <DonatoPanel d={d} onApproved={loadPlans} />

      <div className="evo-card overflow-hidden">
        <div className="grid gap-4 border-b border-white/[0.08] bg-white/[0.035] p-5 xl:grid-cols-[1fr_520px]">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              {STRATEGIES.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setDraftValue("estrategia", key)}
                  className={`rounded-lg border px-3 py-2 text-xs font-bold ${display.estrategia === key ? "border-rc-blue bg-rc-blue text-black" : "border-white/[0.08] text-gray-400 hover:text-white"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <h2 className="mt-5 font-display text-xl font-black uppercase text-white">{strategyTitle(display.estrategia)}</h2>
            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Input label="Nome" value={display.nome} onChange={(value) => setDraftValue("nome", value)} />
              <Input label="Objetivo" value={display.objetivo} onChange={(value) => setDraftValue("objetivo", value)} />
              <Input label="Peso" type="number" unit="kg" value={display.peso} onChange={(value) => setDraftValue("peso", value)} />
              <Input label="GET" type="number" unit="kcal" value={display.get} onChange={(value) => setDraftValue("get", value)} />
              <Input label="Altura" type="number" unit="cm" value={display.altura} onChange={(value) => setDraftValue("altura", value)} />
              <Input label="Idade" type="number" unit="anos" value={display.idade} onChange={(value) => setDraftValue("idade", value)} />
              <Input label="Ingestão máxima de água" type="number" unit="ml" value={display.agua_max_ml} onChange={(value) => setDraftValue("agua_max_ml", value)} />
              <Input label="Ingestão mínima de água" type="number" unit="ml" value={display.agua_min_ml} onChange={(value) => setDraftValue("agua_min_ml", value)} />
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Macros</div>
              <div className="text-xs text-gray-500">Total: <span className="font-semibold text-white">{fmt(dayTotals.energia_kcal, "kcal")}</span></div>
            </div>
            <div className="grid gap-2">
              <MacroBox label="Proteína total" grams={dayTotals.proteinas_g} kcal={round(dayTotals.proteinas_g * 4)} pct={macroPct(dayTotals.proteinas_g, 4)} gkg={peso ? round(dayTotals.proteinas_g / peso) : 0} />
              <MacroBox label="Carboidratos" grams={dayTotals.carboidratos_g} kcal={round(dayTotals.carboidratos_g * 4)} pct={macroPct(dayTotals.carboidratos_g, 4)} gkg={peso ? round(dayTotals.carboidratos_g / peso) : 0} />
              <MacroBox label="Lipídios" grams={dayTotals.lipidios_g} kcal={round(dayTotals.lipidios_g * 9)} pct={macroPct(dayTotals.lipidios_g, 9)} gkg={peso ? round(dayTotals.lipidios_g / peso) : 0} />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto p-5">
          <div className="min-w-[1180px] space-y-5">
            <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-4 py-3">
              <div className="text-sm font-bold text-white">TOTAL: {fmt(dayTotals.energia_kcal, "kcal")} · PTN {fmt(dayTotals.proteinas_g, "g")} · CHO {fmt(dayTotals.carboidratos_g, "g")} · LIP {fmt(dayTotals.lipidios_g, "g")}</div>
            </div>

            {display.refeicoes.map((meal, mealIndex) => {
              const totals = meal.totais || sumMeal(meal);
              const rows = [...(meal.alimentos || [])];
              rows.push({ substitutos: [] });
              return (
                <section key={`${meal.nome}-${mealIndex}`} className="rounded-lg border border-white/[0.08]">
                  <div className="grid grid-cols-[140px_1fr_96px_96px_96px_96px_110px_110px] items-center gap-3 border-b border-white/[0.08] bg-white/[0.05] px-3 py-3 text-xs">
                    <div className="font-bold text-rc-blue">{meal.nome}</div>
                    <div className="grid grid-cols-3 gap-3 text-center text-[11px] font-bold uppercase tracking-wider text-gray-500">
                      {FOOD_COLUMNS.map(([, label]) => <div key={label}>{label}</div>)}
                    </div>
                    {MACROS.map(([key, label]) => <div key={key} className="text-center font-bold text-gray-500">{label}</div>)}
                    <div className="text-center font-bold text-gray-500">Prot (A)</div>
                    <div className="text-center font-bold text-gray-500">Prot (V)</div>
                  </div>
                  {rows.map((item, itemIndex) => (
                    <div key={`${mealIndex}-${itemIndex}`} className="grid grid-cols-[140px_1fr_96px_96px_96px_96px_110px_110px] items-start gap-3 border-b border-white/[0.04] px-3 py-3 last:border-b-0">
                      <div className="pt-2 text-xs text-gray-500">Linha {itemIndex + 1}</div>
                      <div className="grid grid-cols-3 gap-3">
                        <FoodCell
                          item={item}
                          label="Qtd (g/ml)"
                          onPick={() => setPicker({ mealIndex, itemIndex, slot: "preferencia" })}
                          onQty={(value) => updateFood(mealIndex, itemIndex, "preferencia", { quantidade: value, quantidade_g: value })}
                          onMeasure={(value) => updateFood(mealIndex, itemIndex, "preferencia", { medida_nome: value })}
                        />
                        <FoodCell
                          item={item.substitutos?.[0]}
                          label="Qtd (g/ml)"
                          onPick={() => setPicker({ mealIndex, itemIndex, slot: "sub1" })}
                          onQty={(value) => updateFood(mealIndex, itemIndex, "sub1", { quantidade: value, quantidade_g: value })}
                          onMeasure={(value) => updateFood(mealIndex, itemIndex, "sub1", { medida_nome: value })}
                        />
                        <FoodCell
                          item={item.substitutos?.[1]}
                          label="Qtd (g/ml)"
                          onPick={() => setPicker({ mealIndex, itemIndex, slot: "sub2" })}
                          onQty={(value) => updateFood(mealIndex, itemIndex, "sub2", { quantidade: value, quantidade_g: value })}
                          onMeasure={(value) => updateFood(mealIndex, itemIndex, "sub2", { medida_nome: value })}
                        />
                      </div>
                      {MACROS.map(([key, , unit]) => (
                        <div key={key} className="pt-8 text-center text-xs font-semibold tabular-nums text-white">{fmt(getItemMacro(item, key), unit)}</div>
                      ))}
                      <div className="pt-8 text-center text-xs text-gray-400">-</div>
                      <div className="pt-8 text-center text-xs text-gray-400">-</div>
                    </div>
                  ))}
                  <div className="grid grid-cols-[140px_1fr_96px_96px_96px_96px_110px_110px] gap-3 bg-white/[0.025] px-3 py-3 text-xs">
                    <div className="font-bold text-white">Metas da refeição:</div>
                    <div className="grid grid-cols-4 gap-2">
                      <Input label="Kcal" type="number" value={meal.meta_kcal || ""} onChange={(value) => updateMeal(mealIndex, (current) => ({ ...current, meta_kcal: value }))} />
                      <Input label="Observações da refeição" value={meal.observacao || ""} onChange={(value) => updateMeal(mealIndex, (current) => ({ ...current, observacao: value }))} />
                    </div>
                    {MACROS.map(([key, label, unit]) => <div key={key} className="pt-7 text-center font-semibold text-rc-blue">{label}: {fmt(totals[key], unit)}</div>)}
                    <div />
                    <div />
                  </div>
                </section>
              );
            })}
          </div>
        </div>

        <div className="border-t border-white/[0.08] p-5">
          <label className="block">
            <span className="evo-label">Orientações</span>
            <textarea className="evo-input min-h-[130px]" value={display.observacoes || ""} onChange={(event) => setDraftValue("observacoes", event.target.value)} placeholder="Orientações complementares da prescrição" />
          </label>
          <button type="button" onClick={save} disabled={saving} className="evo-btn-primary mt-4 w-full">
            <Utensils className="h-4 w-4" />{saving ? "Salvando..." : (editingId || selected?.id) ? "Atualizar prescrição" : "Salvar prescrição dietética"}
          </button>
        </div>
      </div>
    </div>
  );
}
