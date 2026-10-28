import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Bot, CheckCircle2, X } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/evo-api";

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

export default function DonatoPanel({ d, onApproved }) {
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

