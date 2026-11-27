import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, CheckCircle2, Loader2, Pencil, RefreshCw, Sparkles, Target, X } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/evo-api";
import { escalarSubstitutos, nf0, num, totaisBloco } from "./calculos";
import { seloPreferencia } from "./PreferenciasGaveta";

/**
 * Dr. Donatto dentro da Prescrição (ajuste don1).
 * O app monta a entrada (com a aba de origem de cada dado), o agente devolve JSON e o plano entra na tabela
 * como RASCUNHO. As conferências abaixo são feitas pelo código do app, não pela IA.
 */
const ETAPAS = ["Lendo os dados do paciente", "Definindo metas", "Escolhendo alimentos da base", "Montando equivalentes",
  "Conferindo preferências e alergias", "Recalculando pela base"];

/** Meta de kcal de cada refeição: % da refeição × calorias da dieta. */
export const metaDaRefeicao = (r, kcal) => (num(r.meta_pct) && kcal ? (num(r.meta_pct) / 100) * kcal : null);

/** Ajusta a refeição à meta escalando as gramas (arredonda em 5 g) e os OU junto. */
export function ajustarRefeicaoAMeta(r, kcal) {
  const meta = metaDaRefeicao(r, kcal);
  const atual = totaisBloco(r).kcal;
  if (!meta || !atual) return r;
  const fator = meta / atual;
  return {
    ...r,
    alimentos: r.alimentos.map((it) => {
      if (!num(it.quantidade_g)) return it;
      const g = Math.max(5, Math.round((num(it.quantidade_g) * fator) / 5) * 5);
      const f = g / num(it.quantidade_g);
      const emGramas = !it.medida_nome || String(it.medida_nome).toLowerCase() === "gramas";
      return { ...it, quantidade_g: g, quantidade: emGramas ? g : Math.round(num(it.quantidade) * f * 2) / 2, substitutos: escalarSubstitutos(it.substitutos, f) };
    }),
  };
}

export function conferenciasDoRascunho(draft, kcal, pref) {
  const itens = (draft?.refeicoes || []).flatMap((r) => (r.alimentos || []).filter((a) => a.alimento_id || (a.nome || "").trim()));
  const externos = itens.filter((a) => !a.alimento_id);
  const evitados = [];
  itens.forEach((a) => {
    if (seloPreferencia(a.nome || a.alimento_nome, pref) === "evita") evitados.push(a.nome || a.alimento_nome);
    (a.substitutos || []).forEach((s) => { if (seloPreferencia(s.nome, pref) === "evita") evitados.push(`${s.nome} (OU)`); });
  });
  const foraMeta = (draft?.refeicoes || []).map((r, i) => {
    const meta = metaDaRefeicao(r, kcal);
    const atual = totaisBloco(r).kcal;
    return meta && Math.abs(atual - meta) / meta > 0.05 ? i : null;
  }).filter((i) => i != null);
  const semOu = itens.filter((a) => a.alimento_id && !(a.substitutos || []).length);
  return [
    { ok: externos.length === 0, texto: externos.length ? `${externos.length} alimento(s) de fonte externa` : `Todos os ${itens.length} alimentos são da base` },
    { ok: evitados.length === 0, texto: evitados.length ? `Tem o que o paciente evita: ${[...new Set(evitados)].join(", ")}` : "Nada do que o paciente evita" },
    { ok: foraMeta.length === 0, texto: foraMeta.length ? `${foraMeta.length} refeição(ões) fora da meta (±5%)` : "Metas por refeição dentro de 5%", foraMeta },
    { ok: semOu.length === 0, texto: semOu.length ? `${semOu.length} alimento(s) sem substituição` : "Substituições em todos os alimentos" },
  ];
}

export default function DonatoGaveta({ pid, draft, kcalMeta, preferencias, rascunho, onFechar, onRascunho, onRegenerada, onAjustar, onAplicar, onDescartar }) {
  const [entrada, setEntrada] = useState(null);
  const [gerando, setGerando] = useState(false);
  const [etapa, setEtapa] = useState(0);
  const [regerando, setRegerando] = useState(null);
  const [aceitas, setAceitas] = useState(() => new Set());
  const [aplicando, setAplicando] = useState(false);

  useEffect(() => { api.get(`/patients/${pid}/donato/entrada`).then((r) => setEntrada(r.data)).catch(() => setEntrada({ itens: [] })); }, [pid]);
  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onFechar]);
  useEffect(() => {
    if (!gerando) return undefined;
    setEtapa(0);
    const t = setInterval(() => setEtapa((e) => Math.min(e + 1, ETAPAS.length - 1)), 9000);
    return () => clearInterval(t);
  }, [gerando]);
  useEffect(() => { setAceitas(new Set()); }, [rascunho?.generationId]);

  const kcal = num(kcalMeta) || num(entrada?.kcal_meta);
  const refeicoesApp = (draft?.refeicoes || []).map((r) => ({ nome: r.nome, horario: r.horario, pct: r.meta_pct ?? null }));
  const confs = useMemo(() => (rascunho ? conferenciasDoRascunho(draft, kcal, preferencias) : []), [rascunho, draft, kcal, preferencias]);

  const gerar = async () => {
    setGerando(true);
    try {
      const { data: g } = await api.post(`/patients/${pid}/donato/plan/draft`, { kcal_meta: kcal, numero_refeicoes: Math.max(1, refeicoesApp.length), refeicoes: refeicoesApp });
      const { data: previa } = await api.get(`/patients/${pid}/donato/plans/${g.id}/plano`);
      onRascunho(previa, g.id);
      toast.success("Plano do Dr. Donatto na tabela, como rascunho.");
    } catch (e) {
      const det = e.response?.data?.detail;
      toast.error(typeof det === "object" ? det.message : formatApiError(det));
    } finally { setGerando(false); }
  };
  const regenerar = async (i) => {
    setRegerando(i);
    try {
      const { data } = await api.post(`/patients/${pid}/donato/plans/${rascunho.generationId}/refeicoes/${i}/regenerar`, { kcal_meta: kcal, refeicoes: refeicoesApp });
      onRegenerada(i, data);
      setAceitas((s) => { const n = new Set(s); n.delete(i); return n; });
      toast.success(`${draft.refeicoes[i]?.nome || "Refeição"} refeita, mantendo a meta.`);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); } finally { setRegerando(null); }
  };
  const aplicar = async () => {
    const faltam = (draft.refeicoes || []).length - aceitas.size;
    const aviso = faltam > 0 ? `\n\n${faltam} refeição(ões) ainda não marcada(s) como aceita(s).` : "";
    if (!window.confirm(`Salvar este plano como nova versão? O plano anterior continua guardado.${aviso}`)) return;
    setAplicando(true);
    try { await onAplicar(); } finally { setAplicando(false); }
  };

  const faltaKcal = !kcal;
  const conteudo = (
    <aside role="dialog" aria-label="Dr. Donatto" data-testid="gaveta-donatto"
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[440px] flex-col border-l border-white/[0.08] bg-[#0B0D10] shadow-[-20px_0_60px_rgba(0,0,0,0.5)]">
      <header className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
        <div>
          <div className="flex items-center gap-2 text-[15px] font-semibold text-white"><Sparkles className="h-4 w-4 text-rc-blue" /> Dr. Donatto</div>
          <div className="text-[12px] text-gray-400">Gera um rascunho; você revisa e aplica.</div>
        </div>
        <button type="button" onClick={onFechar} className="rc-btn-ghost p-2" aria-label="Fechar"><X className="h-5 w-5" /></button>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {!rascunho && (
          <>
            <section>
              <h3 className="mb-2 text-[11px] uppercase tracking-[0.14em] text-gray-500">O app envia ao agente</h3>
              {!entrada && <div className="text-sm text-gray-500"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Lendo a ficha…</div>}
              <ul className="space-y-1.5" data-testid="donatto-entrada">
                {(entrada?.itens || []).map((it) => (
                  <li key={it.campo} className="flex items-start gap-2 text-[13px]">
                    {it.valor ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#3DDC84]" /> : <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-gray-600" />}
                    <div className="min-w-0 flex-1">
                      <span className="text-gray-200">{it.campo}</span> <span className="text-[11px] text-gray-500">· {it.origem}</span>
                      <div className={`truncate text-[12px] ${it.valor ? "text-gray-400" : "text-gray-600"}`} title={it.valor || ""}>{it.valor || "não preenchido"}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
            <section className="border-t border-white/[0.06] pt-4">
              <h3 className="mb-2 text-[11px] uppercase tracking-[0.14em] text-gray-500">Parâmetros do plano</h3>
              <div className="flex items-center justify-between text-[13.5px]"><span className="text-gray-300">Calorias da dieta <span className="text-rc-coral">*</span></span>
                <span className={`tabular font-semibold ${faltaKcal ? "text-rc-coral" : "text-white"}`} data-testid="donatto-kcal">{faltaKcal ? "faltando" : `${nf0.format(kcal)} kcal`}</span></div>
              <div className="mt-1 flex items-center justify-between text-[13.5px]"><span className="text-gray-300">Refeições</span><span className="tabular text-white">{refeicoesApp.length}</span></div>
              <p className="mt-2 text-[12px] text-gray-500">Macros, água, fibras, horários, alimentos, quantidades e substituições ficam a cargo do Dr. Donatto.</p>
              {faltaKcal && <p className="mt-2 text-[12px] text-rc-coral">Defina as calorias em Gasto Energético ou Previsão de Macros para liberar.</p>}
            </section>
            {gerando ? (
              <section className="rc-card p-4" data-testid="donatto-progresso">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white"><Loader2 className="h-4 w-4 animate-spin text-rc-blue" /> Montando o plano…</div>
                <ol className="space-y-1 text-[12.5px]">
                  {ETAPAS.map((e, i) => <li key={e} className={i < etapa ? "text-gray-500 line-through" : i === etapa ? "text-white" : "text-gray-600"}>{i < etapa ? "✓" : i === etapa ? "›" : "·"} {e}</li>)}
                </ol>
                <p className="mt-2 text-[11.5px] text-gray-500">Leva de 1 a 3 minutos.</p>
              </section>
            ) : (
              <button type="button" onClick={gerar} disabled={faltaKcal} className="rc-btn-primary h-11 w-full justify-center" data-testid="donatto-gerar"><Sparkles className="h-4 w-4" /> Gerar plano</button>
            )}
          </>
        )}

        {rascunho && (
          <>
            <div className="border-l-2 border-rc-amber bg-rc-amber/[0.06] px-3 py-2 text-[12.5px] text-rc-amber">Rascunho na tabela · nada foi salvo ainda.</div>
            <section>
              <h3 className="mb-2 text-[11px] uppercase tracking-[0.14em] text-gray-500">Refeições</h3>
              <ul className="space-y-2" data-testid="donatto-refeicoes">
                {(draft.refeicoes || []).map((r, i) => {
                  const meta = metaDaRefeicao(r, kcal);
                  const atual = totaisBloco(r).kcal;
                  const fora = meta && Math.abs(atual - meta) / meta > 0.05;
                  const aceita = aceitas.has(i);
                  return (
                    <li key={i} className={`border px-3 py-2 ${aceita ? "border-[#3DDC84]/40 bg-[#3DDC84]/[0.05]" : "border-white/[0.08]"}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13.5px] font-medium text-white">{r.horario ? `${r.horario} · ` : ""}{r.nome || `Refeição ${i + 1}`}</span>
                        <span className={`shrink-0 tabular text-[12px] ${fora ? "text-rc-amber" : "text-gray-400"}`}>{nf0.format(atual)}{meta ? ` / ${nf0.format(meta)}` : ""} kcal</span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        <button type="button" onClick={() => setAceitas((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })}
                          className={`h-8 border px-2 text-[12px] ${aceita ? "border-[#3DDC84]/50 text-[#3DDC84]" : "border-white/[0.1] text-gray-300"}`} data-testid={`donatto-aceitar-${i}`}><Check className="-mt-0.5 mr-1 inline h-3.5 w-3.5" />{aceita ? "Aceita" : "Aceitar"}</button>
                        <button type="button" onClick={() => regenerar(i)} disabled={regerando != null} className="h-8 border border-white/[0.1] px-2 text-[12px] text-gray-300 disabled:opacity-40">
                          {regerando === i ? <Loader2 className="-mt-0.5 mr-1 inline h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="-mt-0.5 mr-1 inline h-3.5 w-3.5" />}Regenerar</button>
                        <button type="button" onClick={() => { const el = document.getElementById(`r${i}-nome`); el?.scrollIntoView({ behavior: "smooth", block: "center" }); el?.focus(); }}
                          className="h-8 border border-white/[0.1] px-2 text-[12px] text-gray-300"><Pencil className="-mt-0.5 mr-1 inline h-3.5 w-3.5" />Editar</button>
                        {fora && <button type="button" onClick={() => onAjustar(i)} className="h-8 border border-rc-blue/50 px-2 text-[12px] text-rc-blueLight" data-testid={`donatto-ajustar-${i}`}><Target className="-mt-0.5 mr-1 inline h-3.5 w-3.5" />Ajustar à meta</button>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
            <section>
              <h3 className="mb-2 text-[11px] uppercase tracking-[0.14em] text-gray-500">Conferência do app</h3>
              <ul className="space-y-1.5" data-testid="donatto-conferencia">
                {confs.map((c) => (
                  <li key={c.texto} className="flex items-start gap-2 text-[13px]">
                    {c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#3DDC84]" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rc-amber" />}
                    <span className={c.ok ? "text-gray-300" : "text-rc-amber"}>{c.texto}</span>
                  </li>
                ))}
              </ul>
              {(rascunho.validacao?.erros || []).filter((e) => !/Aprovacao humana/.test(e)).length > 0 && (
                <details className="mt-2 text-[12px] text-gray-400"><summary className="cursor-pointer">Avisos do recálculo ({rascunho.validacao.erros.length})</summary>
                  <ul className="mt-1 list-disc pl-5">{rascunho.validacao.erros.map((e) => <li key={e}>{e}</li>)}</ul></details>
              )}
            </section>
            {rascunho.justificativa && (
              <details className="text-[12.5px] text-gray-300"><summary className="cursor-pointer text-[11px] uppercase tracking-[0.14em] text-gray-500">Por que este plano</summary><p className="mt-1 whitespace-pre-wrap">{rascunho.justificativa}</p></details>
            )}
          </>
        )}
      </div>

      {rascunho && (
        <footer className="flex gap-2 border-t border-white/[0.06] p-4">
          <button type="button" onClick={onDescartar} className="rc-btn-ghost h-11 flex-1 justify-center" data-testid="donatto-descartar">Descartar</button>
          <button type="button" onClick={aplicar} disabled={aplicando} className="rc-btn-primary h-11 flex-[2] justify-center" data-testid="donatto-aplicar">{aplicando ? "Salvando…" : "Aplicar plano"}</button>
        </footer>
      )}
    </aside>
  );
  return createPortal(conteudo, document.body);
}
