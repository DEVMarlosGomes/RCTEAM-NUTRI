import React, { useEffect, useMemo, useState } from "react";
import { ArrowRight, ClipboardList, Loader2, Lock, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/evo-api";
import EditorRefeicoes, { BarraTotal, LARGURA_EDITOR, carregarMedidas } from "./dieta/EditorRefeicoes";
import useDietaConfig from "./dieta/useDietaConfig";
import { nf, nf0, novaRefeicao, novoItem, num, totaisDia } from "./dieta/calculos";
import { payloadDoRecordatorio, pesoDoPaciente, planejamentoDaMeta } from "./dieta/plano";
import { Pizza } from "./PrevisaoMacros";
import PreferenciasGaveta, { PreferenciasContext, preferenciasDe, usePreferenciasGaveta } from "./dieta/PreferenciasGaveta";
import { carregarEstrutura } from "@/lib/anamnese";

/**
 * Recordatório 24 h com o mesmo editor da Prescrição (item 13 dos ajustes): "Consumo do dia" no topo com pizza,
 * kcal e macros (g, %, g/kg), comparação com a meta e "Usar como base da prescrição" (copia refeições e horários).
 */
const hoje = () => new Date().toISOString().split("T")[0];
const fmtData = (s) => (s ? new Date(`${String(s).slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "—");

/** Item salvo do recordatório (nutrientes da porção) -> item do editor (macros por 100 g). */
function itemDoRecordatorio(it) {
  const g = num(it.quantidade_g);
  const f = g ? 100 / g : 0;
  return {
    ...novoItem(),
    alimento_id: it.alimento_id || null,
    nome: it.alimento_nome || "",
    alimento_nome: it.alimento_nome || "",
    medida_nome: it.medida_nome || "Gramas",
    quantidade: it.quantidade ?? "",
    quantidade_g: it.quantidade_g ?? "",
    _m100: it.alimento_id && g ? { kcal: num(it.energia_kcal) * f, cho: num(it.carboidrato_g) * f, ptn: num(it.proteina_g) * f, lip: num(it.lipideos_g) * f, fib: num(it.fibra_g) * f } : null,
    _medidas: [],
  };
}

function draftDoRecordatorio(rec, config) {
  if (!rec) {
    const padrao = config.refeicoes_padrao || [];
    const n = Math.max(1, num(config.refeicoes_iniciais) || 5);
    return { id: null, data: hoje(), observacoes: "", finalizado: false, refeicoes: Array.from({ length: n }, (_, i) => novaRefeicao(padrao[i]?.nome || "", padrao[i]?.horario || "")) };
  }
  const refeicoes = (rec.refeicoes || []).map((r) => ({
    ...novaRefeicao(r.nome || "", r.horario || ""),
    observacao: r.observacao || "",
    alimentos: (r.itens || []).length ? r.itens.map(itemDoRecordatorio) : [novoItem()],
  }));
  return { id: rec.id, data: rec.data || hoje(), observacoes: rec.observacoes || "", finalizado: !!rec.finalizado, refeicoes: refeicoes.length ? refeicoes : [novaRefeicao()] };
}

function payloadDoDraft(draft, finalizar) {
  const refeicoes = draft.refeicoes
    .map((r, i) => ({
      numero: i + 1,
      nome: (r.nome || "").trim() || `Refeição ${i + 1}`,
      horario: r.horario || "",
      observacao: r.observacao || "",
      itens: (r.alimentos || []).filter((a) => a.alimento_id || (a.nome || "").trim()).map((a, k) => ({
        n: k + 1,
        alimento_id: a.alimento_id || null,
        alimento_nome: a.nome || a.alimento_nome || "",
        medida_nome: a.medida_nome || "Gramas",
        quantidade: num(a.quantidade),
        quantidade_g: num(a.quantidade_g),
      })),
    }));
  return { data: draft.data, observacoes: draft.observacoes || "", finalizado: !!finalizar, refeicoes };
}

function ResumoConsumo({ refeicoes, peso }) {
  const t = totaisDia(refeicoes);
  const kcalMacros = t.cho * 4 + t.ptn * 4 + t.lip * 9;
  const linhas = [
    ["CHO", "cho", t.cho, 4, "#C3F53C"],
    ["PTN", "ptn", t.ptn, 4, "#4DA6FF"],
    ["LIP", "lip", t.lip, 9, "#FFB547"],
  ];
  return (
    <div className="rc-card p-4 sm:p-5 flex flex-wrap items-center gap-6" data-testid="resumo-consumo">
      <Pizza tamanho={130} partes={linhas.map(([, key, g, f, cor]) => ({ key, valor: g * f, cor }))} />
      <div>
        <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Consumo do dia</div>
        <div className="rc-num text-[34px] leading-tight text-white">{nf0.format(t.kcal)} <span className="text-[14px] text-gray-400">kcal</span></div>
        {num(peso) > 0 && <div className="text-[12px] text-gray-500 tabular">{nf.format(t.kcal / num(peso))} kcal/kg</div>}
      </div>
      <table className="text-[13px] tabular">
        <thead><tr className="text-[10.5px] uppercase tracking-[0.12em] text-gray-500"><th className="text-left pr-5 pb-1 font-medium">Macro</th><th className="text-right px-3 pb-1 font-medium">g</th><th className="text-right px-3 pb-1 font-medium">%</th><th className="text-right pl-3 pb-1 font-medium">g/kg</th></tr></thead>
        <tbody>
          {linhas.map(([rot, key, g, f, cor]) => (
            <tr key={key}>
              <td className="pr-5 py-0.5 font-semibold" style={{ color: cor }}>{rot}</td>
              <td className="text-right px-3 text-white">{nf0.format(g)}</td>
              <td className="text-right px-3 font-bold text-white">{kcalMacros ? Math.round((g * f * 100) / kcalMacros) : 0}%</td>
              <td className="text-right pl-3 text-gray-300">{num(peso) > 0 ? nf.format(g / num(peso)) : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function RecordatorioDia({ d, reload, onIrPrescricao }) {
  const pid = d.patient.id;
  const { config } = useDietaConfig();
  const [recs, setRecs] = useState(d.recordatorios || []);
  const [draft, setDraft] = useState(null);
  const [sujo, setSujo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [usando, setUsando] = useState(false);
  const peso = pesoDoPaciente(d);
  const gaveta = usePreferenciasGaveta();
  const [estruturaForm, setEstruturaForm] = useState(null);
  useEffect(() => { carregarEstrutura().then(setEstruturaForm).catch(() => {}); }, []);
  const preferencias = useMemo(() => preferenciasDe(d.anamnese_v2), [d.anamnese_v2]);
  const planejamento = useMemo(() => planejamentoDaMeta(d.patient.meta_energetica, peso) || {}, [d.patient.meta_energetica, peso]);

  const abrir = async (rec) => {
    if (sujo && !window.confirm("Descartar as alterações não salvas deste recordatório?")) return;
    const novo = draftDoRecordatorio(rec, config);
    setDraft(novo); setSujo(false);
    // medidas caseiras dos alimentos salvos (para trocar a medida no editor)
    const ids = [...new Set(novo.refeicoes.flatMap((r) => r.alimentos.map((a) => a.alimento_id)).filter(Boolean))];
    if (!ids.length) return;
    const medidas = Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await carregarMedidas(id)])));
    setDraft((atual) => (atual && atual.id === novo.id ? {
      ...atual,
      refeicoes: atual.refeicoes.map((r) => ({ ...r, alimentos: r.alimentos.map((a) => (a.alimento_id && !a._medidas?.length ? { ...a, _medidas: medidas[a.alimento_id] || [] } : a)) })),
    } : atual));
  };

  useEffect(() => {
    if (draft) return;
    abrir(recs[0] || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  if (!draft) return <div className="rc-card p-10 flex items-center justify-center gap-2 text-gray-400"><Loader2 className="w-4 h-4 animate-spin" /> Carregando…</div>;

  const bloqueado = draft.finalizado;
  const set = (k, v) => { setDraft((s) => ({ ...s, [k]: v })); setSujo(true); };

  const salvar = async (finalizar = false) => {
    setSalvando(true);
    try {
      const body = payloadDoDraft(draft, finalizar);
      const { data } = draft.id ? await api.put(`/patients/${pid}/recordatorios/${draft.id}`, body) : await api.post(`/patients/${pid}/recordatorios`, body);
      setRecs((s) => (draft.id ? s.map((r) => (r.id === data.id ? data : r)) : [data, ...s]));
      setDraft((s) => ({ ...s, id: data.id, finalizado: !!data.finalizado }));
      setSujo(false);
      reload?.();
      toast.success(finalizar ? "Recordatório finalizado." : "Recordatório salvo.");
      return data;
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
      return null;
    } finally { setSalvando(false); }
  };

  const remover = async () => {
    if (!draft.id || !window.confirm("Remover este recordatório?")) return;
    try {
      await api.delete(`/patients/${pid}/recordatorios/${draft.id}`);
      const resto = recs.filter((r) => r.id !== draft.id);
      setRecs(resto); setSujo(false);
      setDraft(draftDoRecordatorio(resto[0] || null, config));
      toast.success("Recordatório removido.");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const usarComoBase = async () => {
    setUsando(true);
    try {
      const body = payloadDoRecordatorio(payloadDoDraft(draft, draft.finalizado));
      // começa da rotina do paciente (refeições e horários) com a meta atual da Previsão de Macros
      const { data } = await api.post(`/patients/${pid}/planos-manuais`, {
        ...body,
        titulo: `Base do recordatório ${fmtData(draft.data)}`,
        objetivo: d.patient.objetivo || "",
        planejamento,
        prescricao_dietetica: { peso },
      });
      toast.success("Dieta criada a partir do recordatório.");
      reload?.();
      onIrPrescricao?.(data?.id);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally { setUsando(false); }
  };

  return (
    <div className="space-y-4" data-testid="recordatorio-dia">
      <div className="rc-card px-3 py-2.5 flex flex-wrap items-center gap-2">
        <ClipboardList className="w-4 h-4 text-gray-500 ml-1" />
        <div role="tablist" aria-label="Recordatórios do paciente" className="flex flex-1 min-w-0 gap-1.5 overflow-x-auto [scrollbar-width:none]">
          {recs.map((r) => (
            <button key={r.id} role="tab" type="button" aria-selected={r.id === draft.id} onClick={() => r.id !== draft.id && abrir(r)}
              className={`shrink-0 h-9 px-4 rounded-lg text-[13.5px] ${r.id === draft.id ? "bg-rc-raised text-white font-semibold shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]" : "text-gray-400 hover:text-white hover:bg-white/[0.04]"}`}>
              {fmtData(r.data)}{r.finalizado && <Lock className="inline w-3 h-3 ml-1.5 -mt-0.5 text-gray-500" />}
            </button>
          ))}
          {!draft.id && <span className="shrink-0 h-9 px-4 inline-flex items-center rounded-lg bg-rc-raised text-[13.5px] font-semibold">Novo <span className="ml-2 text-[11px] text-gray-500 font-normal">não salvo</span></span>}
        </div>
        <button type="button" onClick={() => abrir(null)} className="rc-btn-secondary h-9"><Plus className="w-4 h-4" /> Novo recordatório</button>
      </div>

      <ResumoConsumo refeicoes={draft.refeicoes} peso={peso} />
      <BarraTotal modoRecordatorio refeicoes={draft.refeicoes} planejamento={planejamento} peso={peso}
        acoesExtras={(
          <button type="button" onClick={usarComoBase} disabled={usando} className="rc-btn-primary h-9" data-testid="usar-como-base">
            {usando ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />} Usar como base da prescrição
          </button>
        )} />

      <PreferenciasContext.Provider value={preferencias}>
      <div className={gaveta.fixada ? "grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px] items-start" : ""}>
      <section className="rc-card p-4 sm:p-5 min-w-0">
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <label className="block">
            <span className="rc-label">Data do recordatório</span>
            <input type="date" className="rc-input h-10" value={draft.data} disabled={bloqueado} onChange={(e) => set("data", e.target.value)} />
          </label>
          {bloqueado && <p className="text-[12.5px] text-gray-400 flex items-center gap-1.5 pb-2.5"><Lock className="w-3.5 h-3.5" /> Finalizado: só leitura. Use como base da prescrição ou crie um novo.</p>}
        </div>
        <div className="overflow-x-auto -mx-1 px-1 pb-1">
          <div className={`${LARGURA_EDITOR} ${bloqueado ? "pointer-events-none opacity-80" : ""}`} aria-disabled={bloqueado}>
            <EditorRefeicoes modoRecordatorio refeicoes={draft.refeicoes} onChange={(r) => set("refeicoes", r)} config={config} modelos={[]} planejamento={planejamento} peso={peso} favoritos={config.alimentos_favoritos || []} />
          </div>
        </div>
        <label className="block mt-5">
          <span className="rc-label">Observações</span>
          <textarea className="rc-input h-20 py-2 resize-none" disabled={bloqueado} value={draft.observacoes} onChange={(e) => set("observacoes", e.target.value)} placeholder="Ex.: fim de semana, come fora no almoço, belisca à tarde…" />
        </label>
        {!bloqueado && (
          <div className="mt-5 pt-4 border-t border-white/[0.06] flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => salvar(false)} disabled={salvando} className="rc-btn-primary min-w-[120px]" data-testid="salvar-recordatorio">
              {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar
            </button>
            <button type="button" onClick={() => window.confirm("Finalizar? Depois de finalizado o recordatório não pode ser editado.") && salvar(true)} disabled={salvando} className="rc-btn-secondary"><Lock className="w-4 h-4" /> Finalizar</button>
            {draft.id && <button type="button" onClick={remover} className="rc-btn-secondary"><Trash2 className="w-4 h-4" /> Remover</button>}
            {sujo && <span className="text-[12.5px] text-rc-amber ml-1">Alterações não salvas</span>}
          </div>
        )}
        {bloqueado && draft.id && (
          <div className="mt-5 pt-4 border-t border-white/[0.06]"><button type="button" onClick={remover} className="rc-btn-secondary"><Trash2 className="w-4 h-4" /> Remover</button></div>
        )}
      </section>
      {gaveta.fixada && <PreferenciasGaveta paciente={d.patient} anamnese={d.anamnese_v2} estrutura={estruturaForm} estado={gaveta} />}
      </div>
      {!gaveta.fixada && <PreferenciasGaveta paciente={d.patient} anamnese={d.anamnese_v2} estrutura={estruturaForm} estado={gaveta} />}
      </PreferenciasContext.Provider>
    </div>
  );
}
