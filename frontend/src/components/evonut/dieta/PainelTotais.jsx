import React from "react";
import { indicadores, nf, nf0, num, totaisDia } from "./calculos";

// Abaixo da meta do planejamento fica coral; atingida, lima (no NutriDiet: vermelho/azul).
const corMeta = (valor, meta) => {
  if (!num(meta) || valor == null) return "text-white";
  return valor + 1e-9 >= num(meta) ? "text-rc-lime" : "text-rc-coral";
};

function Linha({ rotulo, pct, valor, meta, metaTexto, corValor }) {
  return (
    <div className="flex items-baseline gap-2 py-[5px]" title={metaTexto ? `Meta: ${metaTexto}` : undefined}>
      <span className="text-[12px] font-semibold text-gray-400 w-[64px] shrink-0">{rotulo}</span>
      {pct != null && <span className={`text-[12px] tabular w-9 text-right ${corValor || "text-gray-300"}`}>{pct}</span>}
      <span className={`ml-auto text-[13px] tabular font-medium ${corValor || "text-white"}`}>{valor}</span>
      {meta && <span className="sr-only">Meta {meta}</span>}
    </div>
  );
}

/** "Total da dieta" fixo na lateral, como no NutriDiet. */
export default function PainelTotais({ refeicoes, peso, planejamento, onOutrasOpcoes }) {
  const t = totaisDia(refeicoes);
  const ind = indicadores(t, peso);
  const pl = planejamento || {};
  const temPeso = num(peso) > 0;
  const barra = [
    ["bg-macro-cho", ind.pct_cho], ["bg-macro-ptn", ind.pct_ptn], ["bg-macro-lip", ind.pct_lip],
  ];

  return (
    <aside className="rc-card p-4 xl:sticky xl:top-20" aria-label="Total da dieta">
      <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500 text-center">Total da dieta</div>
      <div className="mt-2 text-center">
        <span className={`rc-num text-[40px] leading-none ${corMeta(t.kcal, pl.kcal)}`}>{nf0.format(t.kcal)}</span>
        <span className="text-gray-400 text-[12px] ml-1">kcal</span>
        {num(pl.kcal) > 0 && <div className="text-[11px] text-gray-500 mt-1 tabular">meta {nf0.format(num(pl.kcal))} kcal</div>}
      </div>
      <div className="flex h-1.5 rounded-full overflow-hidden bg-white/[0.05] mt-3" aria-hidden>
        {barra.map(([c, v]) => <div key={c} className={c} style={{ width: `${v}%` }} />)}
      </div>
      <div className="mt-2">
        <Linha rotulo="CHO" pct={`${Math.round(ind.pct_cho)}%`} valor={`${nf.format(t.cho)}g`} corValor={num(pl.pct_cho) ? corMeta(ind.pct_cho, pl.pct_cho) : null} metaTexto={num(pl.pct_cho) ? `${pl.pct_cho}%` : null} />
        <Linha rotulo="PTN" pct={`${Math.round(ind.pct_ptn)}%`} valor={`${nf.format(t.ptn)}g`} corValor={num(pl.pct_ptn) ? corMeta(ind.pct_ptn, pl.pct_ptn) : null} metaTexto={num(pl.pct_ptn) ? `${pl.pct_ptn}%` : null} />
        <Linha rotulo="LIP" pct={`${Math.round(ind.pct_lip)}%`} valor={`${nf.format(t.lip)}g`} corValor={num(pl.pct_lip) ? corMeta(ind.pct_lip, pl.pct_lip) : null} metaTexto={num(pl.pct_lip) ? `${pl.pct_lip}%` : null} />
      </div>
      <div className="h-px bg-white/[0.06] my-2" />
      <Linha rotulo="Kcal/kg" valor={temPeso ? nf.format(ind.kcal_kg) : "–"} corValor={temPeso && num(pl.kcal_kg) ? corMeta(ind.kcal_kg, pl.kcal_kg) : null} metaTexto={num(pl.kcal_kg) ? pl.kcal_kg : null} />
      <Linha rotulo="gCHO/kg" valor={temPeso ? `${nf.format(ind.cho_gkg)}g` : "–"} corValor={temPeso && num(pl.cho_gkg) ? corMeta(ind.cho_gkg, pl.cho_gkg) : null} metaTexto={num(pl.cho_gkg) ? `${pl.cho_gkg} g/kg` : null} />
      <Linha rotulo="gPTN/kg" valor={temPeso ? `${nf.format(ind.ptn_gkg)}g` : "–"} corValor={temPeso && num(pl.ptn_gkg) ? corMeta(ind.ptn_gkg, pl.ptn_gkg) : null} metaTexto={num(pl.ptn_gkg) ? `${pl.ptn_gkg} g/kg` : null} />
      <Linha rotulo="gLIP/kg" valor={temPeso ? `${nf.format(ind.lip_gkg)}g` : "–"} corValor={temPeso && num(pl.lip_gkg) ? corMeta(ind.lip_gkg, pl.lip_gkg) : null} metaTexto={num(pl.lip_gkg) ? `${pl.lip_gkg} g/kg` : null} />
      {!temPeso && <p className="text-[11px] text-gray-500 mt-1">Informe o peso em Outras opções › Planejamento para ver os valores por kg.</p>}
      <div className="h-px bg-white/[0.06] my-2" />
      <div className="flex items-baseline justify-between gap-2 py-[5px]">
        <span className="text-[12px] font-semibold text-gray-400 leading-tight">kcal não ptn/gN</span>
        <span className="text-[13px] tabular font-medium text-white">{nf.format(ind.kcal_nao_ptn_gn)}</span>
      </div>
      <Linha rotulo="Fibras" valor={`${nf.format(t.fib)}g`} />
      <button type="button" onClick={onOutrasOpcoes} className="rc-btn-primary w-full mt-3 h-9 text-[12.5px]">Outras opções</button>
    </aside>
  );
}
