import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Bot, CheckCircle2, Download, Edit2, Plus, Trash2, Utensils, X } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/evo-api";
import EditorDieta, { PainelTotais, REFEICOES_PADRAO, m100DoItemSalvo } from "./dieta/EditorDieta";

const EMPTY_PLANS = [];
const STRATEGIES = [
  ["carbo_alto", "Carbo alto", "PLANO ALIMENTAR - CARBO ALTO"],
  ["carbo_medio", "Carbo médio", "PLANO ALIMENTAR - CARBO MÉDIO"],
  ["carbo_baixo", "Carbo baixo", "PLANO ALIMENTAR - CARBO BAIXO"],
];

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

const round = (value) => Math.round((Number(value || 0)) * 100) / 100;

const refeicoesPadrao = () => REFEICOES_PADRAO.map((r) => ({ ...r, alimentos: [{ substitutos: [] }] }));

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
    get: get ? Math.round(get) : "",
    agua_max_ml: peso ? Math.round(Number(peso) * 50) : "",
    agua_min_ml: peso ? Math.round(Number(peso) * 35) : "",
    kcal_kg: peso && get ? round(Number(get) / Number(peso)) : "",
    meta_kcal: get ? Math.round(get) : "",
    meta_proteina_g: "",
    meta_carboidrato_g: "",
    meta_lipidio_g: "",
    observacoes: "",
    refeicoes: refeicoesPadrao(),
  };
};

// Planos antigos tinham 10 refeicoes fixas ("Refeicao 1..10"); as vazias sem nome proprio sao descartadas.
const draftFromPlan = (plan, d) => {
  const base = defaultDraft(d);
  const meta = plan.prescricao_dietetica || {};
  const refeicoes = (plan.refeicoes || [])
    .filter((r) => (r.alimentos || []).length > 0 || !/^Refeição \d+$/.test(r.nome || ""))
    .map((r) => ({
      nome: r.nome,
      horario: r.horario || "",
      meta_kcal: r.meta_kcal || "",
      observacao: r.observacao || "",
      alimentos: (r.alimentos || []).map((item) => ({
        ...item,
        alimento_nome: item.alimento_nome || item.nome,
        _m100: m100DoItemSalvo(item),
        _medidas: item.medidas || [],
        substitutos: item.substitutos || [],
      })),
    }));
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
    refeicoes: refeicoes.length ? refeicoes : base.refeicoes,
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

function Input({ label, value, onChange, type = "text", unit }) {
  return (
    <label className="block">
      <span className="evo-label">{label}</span>
      <div className="relative">
        <input type={type} className={`evo-input h-10 ${unit ? "pr-14" : ""}`} value={value ?? ""} onChange={(event) => onChange(event.target.value)} />
        {unit && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-gray-500">{unit}</span>}
      </div>
    </label>
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

  const loadPlans = useCallback(async () => {
    const { data } = await api.get(`/patients/${pid}/planos-manuais`);
    setPlans(data || []);
    setSelected((current) => current || data?.[0] || null);
    if (!editingId && data?.[0]) setDraft(draftFromPlan(data[0], d));
  }, [d, editingId, pid]);

  useEffect(() => { loadPlans().catch(() => {}); }, [loadPlans]);

  const setDraftValue = (key, value) => setDraft((current) => ({ ...current, [key]: value }));

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

      {/* Dados do plano */}
      <section className="rc-card p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="grid gap-3 sm:grid-cols-2 flex-1 min-w-[280px]">
            <Input label="Título" value={draft.titulo} onChange={(value) => setDraftValue("titulo", value)} />
            <Input label="Objetivo" value={draft.objetivo} onChange={(value) => setDraftValue("objetivo", value)} />
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Estratégia">
            {STRATEGIES.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setDraftValue("estrategia", key)}
                className={`rounded-lg px-3 h-9 text-[13px] transition-colors ${draft.estrategia === key ? "bg-rc-lime text-rc-ink font-medium" : "bg-white/[0.04] text-gray-400 hover:text-white"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          <Input label="Peso" type="number" unit="kg" value={draft.peso} onChange={(value) => setDraftValue("peso", value)} />
          <Input label="Altura" type="number" unit="cm" value={draft.altura} onChange={(value) => setDraftValue("altura", value)} />
          <Input label="Idade" type="number" unit="anos" value={draft.idade} onChange={(value) => setDraftValue("idade", value)} />
          <Input label="GET" type="number" unit="kcal" value={draft.get} onChange={(value) => setDraftValue("get", value)} />
          <Input label="Meta" type="number" unit="kcal" value={draft.meta_kcal} onChange={(value) => setDraftValue("meta_kcal", value)} />
          <Input label="Água mín." type="number" unit="ml" value={draft.agua_min_ml} onChange={(value) => setDraftValue("agua_min_ml", value)} />
          <Input label="Água máx." type="number" unit="ml" value={draft.agua_max_ml} onChange={(value) => setDraftValue("agua_max_ml", value)} />
        </div>
      </section>

      {/* Editor de refeicoes + total da dieta */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_272px] items-start">
        <EditorDieta refeicoes={draft.refeicoes} onChange={(refeicoes) => setDraftValue("refeicoes", refeicoes)} />
        <PainelTotais refeicoes={draft.refeicoes} peso={draft.peso} metaKcal={draft.meta_kcal} />
      </div>

      <section className="rc-card p-5">
        <label className="block">
          <span className="evo-label">Orientações</span>
          <textarea className="evo-input min-h-[120px]" value={draft.observacoes || ""} onChange={(event) => setDraftValue("observacoes", event.target.value)} placeholder="Orientações complementares da prescrição" />
        </label>
        <button type="button" onClick={save} disabled={saving} className="evo-btn-primary mt-4 w-full h-11">
          <Utensils className="h-4 w-4" />{saving ? "Salvando..." : (editingId || selected?.id) ? "Atualizar prescrição" : "Salvar prescrição dietética"}
        </button>
      </section>
    </div>
  );
}
