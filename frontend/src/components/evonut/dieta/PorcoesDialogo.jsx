import React, { useContext, useMemo, useState } from "react";
import { Minus, Plus, Wand2 } from "lucide-react";
import Dialogo from "./Dialogo";
import { nf, nf0, num } from "./calculos";
import { GruposContext, itemDaReferencia, macrosDaPorcao, substitutosDoGrupo, sugerirPorcoes } from "./grupos";

/**
 * Item 11 dos ajustes: montar a refeição por porções (2 carboidratos + 1 proteína…). Cada porção é a porção de
 * referência do grupo; "Ajustar porções" sugere quantas porções fecham a meta da refeição.
 */
export default function PorcoesDialogo({ refeicaoNome, meta, onAplicar, onClose }) {
  const grupos = useContext(GruposContext);
  const [porcoes, setPorcoes] = useState({});
  const total = useMemo(() => grupos.reduce((a, g) => {
    const m = macrosDaPorcao(g); const n = num(porcoes[g.id]);
    return { cho: a.cho + m.cho * n, ptn: a.ptn + m.ptn * n, lip: a.lip + m.lip * n, kcal: a.kcal + m.kcal * n };
  }, { cho: 0, ptn: 0, lip: 0, kcal: 0 }), [grupos, porcoes]);
  const passo = (id, d) => setPorcoes((s) => ({ ...s, [id]: Math.max(0, Math.min(10, num(s[id]) + d)) }));
  const aplicar = () => {
    const itens = grupos.filter((g) => num(porcoes[g.id]) > 0).map((g) => {
      const it = itemDaReferencia(g, num(porcoes[g.id]));
      return it && { ...it, substitutos: substitutosDoGrupo(g, it) };
    }).filter(Boolean);
    onAplicar(itens);
  };
  const linhaMeta = (rot, v, alvo, cor) => (
    <div className="flex items-baseline justify-between gap-3 text-[13px] tabular">
      <span className={`font-semibold ${cor}`}>{rot}</span>
      <span className="text-white">{nf0.format(v)}{alvo != null && <span className="text-gray-500"> / {nf0.format(alvo)}</span>}</span>
    </div>
  );

  return (
    <Dialogo eyebrow={refeicaoNome || "Refeição"} titulo="Montar por porções" onClose={onClose} largura="sm:max-w-2xl"
      rodape={(
        <>
          {meta && <button type="button" className="rc-btn-secondary mr-auto" onClick={() => setPorcoes((s) => sugerirPorcoes(grupos, s, meta))} data-testid="ajustar-porcoes"><Wand2 className="h-4 w-4" /> Ajustar porções</button>}
          <button type="button" className="rc-btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="button" className="rc-btn-primary" onClick={aplicar} disabled={!total.kcal} data-testid="aplicar-porcoes">Adicionar à refeição</button>
        </>
      )}>
      {!grupos.length ? <p className="text-[13px] text-gray-400">Cadastre os grupos em Configurações da dieta › Grupos de substituição.</p> : (
        <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_190px]">
          <ul className="space-y-1.5">
            {grupos.map((g) => (
              <li key={g.id} className="flex items-center gap-3 rounded-lg px-3 py-2 bg-white/[0.03]">
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold text-white">{g.nome}</div>
                  <div className="text-[11.5px] text-gray-500 truncate">1 porção = {g.referencia ? `${g.referencia.nome} ${nf.format(g.referencia.quantidade_g)} g · ${nf0.format(macrosDaPorcao(g).kcal)} kcal` : "sem referência"}</div>
                </div>
                <button type="button" className="h-8 w-8 rounded-md bg-white/[0.05] inline-flex items-center justify-center text-gray-300 hover:text-white" aria-label={`Menos meia porção de ${g.nome}`} onClick={() => passo(g.id, -0.5)}><Minus className="h-4 w-4" /></button>
                <span className="w-9 text-center rc-num text-[18px] text-white tabular" data-testid={`porcoes-${g.id}`}>{nf.format(num(porcoes[g.id]))}</span>
                <button type="button" className="h-8 w-8 rounded-md bg-white/[0.05] inline-flex items-center justify-center text-gray-300 hover:text-white" aria-label={`Mais meia porção de ${g.nome}`} onClick={() => passo(g.id, 0.5)}><Plus className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
          <aside className="space-y-1.5 sm:border-l sm:border-white/[0.06] sm:pl-5">
            <div className="text-[11px] uppercase tracking-[0.14em] text-gray-500 mb-2">Total {meta ? "/ meta da refeição" : ""}</div>
            {linhaMeta("Kcal", total.kcal, meta?.kcal, "text-gray-300")}
            {linhaMeta("CHO g", total.cho, meta?.cho, "text-macro-cho")}
            {linhaMeta("PTN g", total.ptn, meta?.ptn, "text-macro-ptn")}
            {linhaMeta("LIP g", total.lip, meta?.lip, "text-macro-lip")}
            <p className="text-[11.5px] text-gray-500 pt-3">Cada alimento entra com os “OU” do grupo já calculados.</p>
          </aside>
        </div>
      )}
    </Dialogo>
  );
}
