import React, { useMemo, useState } from "react";
import { Download, FileText, Wand2 } from "lucide-react";
import Dialogo from "./Dialogo";
import { EditorListas } from "./EditorDieta";
import { Abas, NotaReferencia, ResumoMacros, TabelaNutrientes, itensDosBlocos, useAnalise } from "./Nutrientes";
import { indicadores, nf, num, totaisDia } from "./calculos";
import { planejamentoDaMeta } from "./plano";

function Campo({ rotulo, valor, onChange, unidade, ajuda }) {
  return (
    <label className="block">
      <span className="rc-label">{rotulo}</span>
      <div className="relative">
        <input className={`rc-input h-10 tabular ${unidade ? "pr-14" : ""}`} inputMode="decimal" value={valor ?? ""} onChange={(e) => onChange(e.target.value)} />
        {unidade && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-gray-500">{unidade}</span>}
      </div>
      {ajuda && <span className="block text-[11px] text-gray-500 mt-1 tabular">{ajuda}</span>}
    </label>
  );
}

function Planejamento({ draft, setDraft, patient }) {
  const pl = draft.planejamento || {};
  const pd = draft.prescricao_dietetica || {};
  const peso = pd.peso;
  const t = totaisDia(draft.refeicoes);
  const ind = indicadores(t, peso);
  const setPl = (k, v) => setDraft((d) => ({ ...d, planejamento: { ...(d.planejamento || {}), [k]: v } }));
  const setPd = (k, v) => setDraft((d) => ({ ...d, prescricao_dietetica: { ...(d.prescricao_dietetica || {}), [k]: v } }));
  const daMeta = planejamentoDaMeta(patient?.meta_energetica, peso);
  const somaPct = num(pl.pct_cho) + num(pl.pct_ptn) + num(pl.pct_lip);
  const atual = (v, suf = "") => `Dieta atual: ${v == null ? "–" : `${nf.format(v)}${suf}`}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-gray-400 max-w-[60ch]">As metas colorem o “Total da dieta”: coral enquanto a dieta está abaixo, lima quando atinge.</p>
        <button type="button" disabled={!daMeta} onClick={() => setDraft((d) => ({ ...d, planejamento: daMeta }))} className="rc-btn-secondary h-9" title={daMeta ? "" : "Salve a meta calórica na aba Gasto Energético"}>
          <Wand2 className="w-4 h-4" /> Usar meta do Gasto Energético
        </button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Kcal" valor={pl.kcal} onChange={(v) => setPl("kcal", v)} unidade="kcal" ajuda={atual(t.kcal)} />
        <Campo rotulo="Kcal/kg" valor={pl.kcal_kg} onChange={(v) => setPl("kcal_kg", v)} ajuda={atual(ind.kcal_kg)} />
        <Campo rotulo="% CHO" valor={pl.pct_cho} onChange={(v) => setPl("pct_cho", v)} unidade="%" ajuda={atual(ind.pct_cho, "%")} />
        <Campo rotulo="g CHO/kg" valor={pl.cho_gkg} onChange={(v) => setPl("cho_gkg", v)} unidade="g/kg" ajuda={atual(ind.cho_gkg)} />
        <Campo rotulo="% PTN" valor={pl.pct_ptn} onChange={(v) => setPl("pct_ptn", v)} unidade="%" ajuda={atual(ind.pct_ptn, "%")} />
        <Campo rotulo="g PTN/kg" valor={pl.ptn_gkg} onChange={(v) => setPl("ptn_gkg", v)} unidade="g/kg" ajuda={atual(ind.ptn_gkg)} />
        <Campo rotulo="% LIP" valor={pl.pct_lip} onChange={(v) => setPl("pct_lip", v)} unidade="%" ajuda={atual(ind.pct_lip, "%")} />
        <Campo rotulo="g LIP/kg" valor={pl.lip_gkg} onChange={(v) => setPl("lip_gkg", v)} unidade="g/kg" ajuda={atual(ind.lip_gkg)} />
      </div>
      {somaPct > 0 && Math.abs(somaPct - 100) > 1 && <p className="text-[12.5px] text-rc-amber">Os percentuais somam {nf.format(somaPct)}% (o esperado é 100%).</p>}
      <div>
        <div className="rc-label">Dados do paciente para esta dieta</div>
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3">
          <Campo rotulo="Peso" valor={pd.peso} onChange={(v) => setPd("peso", v)} unidade="kg" />
          <Campo rotulo="Altura" valor={pd.altura} onChange={(v) => setPd("altura", v)} unidade="cm" />
          <Campo rotulo="GET" valor={pd.get} onChange={(v) => setPd("get", v)} unidade="kcal" />
          <Campo rotulo="Água mín." valor={pd.agua_min_ml} onChange={(v) => setPd("agua_min_ml", v)} unidade="ml" />
          <Campo rotulo="Água máx." valor={pd.agua_max_ml} onChange={(v) => setPd("agua_max_ml", v)} unidade="ml" />
          <label className="block">
            <span className="rc-label">Estratégia</span>
            <select className="rc-input h-10" value={draft.estrategia || ""} onChange={(e) => setDraft((d) => ({ ...d, estrategia: e.target.value }))}>
              <option value="">—</option>
              <option value="carbo_alto">Carbo alto</option>
              <option value="carbo_medio">Carbo médio</option>
              <option value="carbo_baixo">Carbo baixo</option>
            </select>
          </label>
        </div>
      </div>
    </div>
  );
}

/** "Outras opções" da dieta (como no NutriDiet): vitaminas, minerais, planejamento, relatório e lista de substituição. */
export default function OutrasOpcoes({ pid, draft, setDraft, patient, config, listasSalvas, abaInicial = "vitaminas", onPdfDieta, onPdfNutrientes, onClose }) {
  const [aba, setAba] = useState(abaInicial);
  const itens = useMemo(() => itensDosBlocos(draft.refeicoes), [draft.refeicoes]);
  const { dados, carregando } = useAnalise(pid, itens);
  const peso = draft.prescricao_dietetica?.peso;

  return (
    <Dialogo eyebrow="Outras opções" titulo={draft.titulo || "Dieta"} onClose={onClose} largura="sm:max-w-5xl"
      rodape={<button type="button" onClick={onClose} className="rc-btn-primary">Concluir</button>}>
      <Abas
        abas={[["vitaminas", "Vitaminas"], ["minerais", "Minerais"], ["planejamento", "Planejamento"], ["relatorio", "Relatório"], ["substituicao", "Lista de substituição"]]}
        ativa={aba}
        onChange={setAba}
      />
      {aba === "vitaminas" && <><TabelaNutrientes linhas={dados?.vitaminas} carregando={carregando} /><NotaReferencia referencia={dados?.referencia} /></>}
      {aba === "minerais" && <><TabelaNutrientes linhas={dados?.minerais} carregando={carregando} /><NotaReferencia referencia={dados?.referencia} /></>}
      {aba === "planejamento" && <Planejamento draft={draft} setDraft={setDraft} patient={patient} />}
      {aba === "relatorio" && (
        <div className="space-y-5">
          <ResumoMacros t={totaisDia(draft.refeicoes)} peso={peso} />
          {dados?.outros && <TabelaNutrientes linhas={dados.outros} carregando={false} />}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onPdfNutrientes} className="rc-btn-primary"><FileText className="w-4 h-4" /> PDF do relatório de nutrientes</button>
            <button type="button" onClick={onPdfDieta} className="rc-btn-secondary"><Download className="w-4 h-4" /> PDF da dieta</button>
          </div>
          <p className="text-[12px] text-gray-500">Os PDFs usam a versão salva — alterações pendentes são salvas antes de gerar.</p>
        </div>
      )}
      {aba === "substituicao" && (
        <div>
          <p className="text-[13px] text-gray-400 mb-4 max-w-[70ch]">Grupos de alimentos que o paciente pode trocar entre si. Saem no PDF da dieta, depois das refeições.</p>
          <EditorListas
            listas={draft.listas_substituicao || []}
            onChange={(listas) => setDraft((d) => ({ ...d, listas_substituicao: listas }))}
            config={config}
            listasSalvas={listasSalvas}
          />
        </div>
      )}
    </Dialogo>
  );
}
