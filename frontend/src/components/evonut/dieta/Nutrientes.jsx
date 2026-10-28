import React, { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/evo-api";
import Dialogo from "./Dialogo";
import { indicadores, nf, nf0, num, totaisBloco } from "./calculos";

/** Itens (alimento_id + gramas) dos blocos informados, para a analise de micronutrientes. */
export const itensDosBlocos = (blocos) => (blocos || [])
  .flatMap((b) => b.alimentos || [])
  .filter((i) => i.alimento_id && num(i.quantidade_g) > 0)
  .map((i) => ({ alimento_id: i.alimento_id, quantidade_g: num(i.quantidade_g) }));

/** Busca vitaminas/minerais dos itens contra as DRIs do paciente (idade, sexo, gestacao). */
export function useAnalise(pid, itens) {
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const chave = JSON.stringify(itens);
  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    api.post(`/patients/${pid}/dieta/analise`, { itens: JSON.parse(chave) })
      .then(({ data }) => { if (ativo) setDados(data); })
      .catch(() => { if (ativo) setDados(null); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, [pid, chave]);
  return { dados, carregando };
}

export function TabelaNutrientes({ linhas, carregando }) {
  if (carregando) return <div className="py-12 flex items-center justify-center gap-2 text-gray-400 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Calculando…</div>;
  if (!linhas) return <p className="py-8 text-center text-[13px] text-gray-500">Não foi possível calcular agora.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left text-[10.5px] uppercase tracking-[0.12em] text-gray-500">
            <th className="py-2 pr-3 font-semibold">Nutriente</th>
            <th className="py-2 pr-3 font-semibold text-right">Dieta</th>
            <th className="py-2 pr-3 font-semibold text-right">Referência</th>
            <th className="py-2 font-semibold text-right w-[38%]">Adequação</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => {
            const pct = l.adequacao;
            const ok = pct != null && pct >= 100;
            return (
              <tr key={l.codigo} className="border-t border-white/[0.05]">
                <td className="py-2 pr-3 text-gray-200">
                  {l.nome}
                  {!l.disponivel && <span className="text-gray-500" title="Nutriente não presente na tabela de alimentos"> *</span>}
                  {l.disponivel && l.alimentos_sem_dado > 0 && <span className="text-gray-500" title={`${l.alimentos_sem_dado} alimento(s) sem este dado na tabela`}> **</span>}
                </td>
                <td className="py-2 pr-3 text-right tabular text-white">{l.disponivel ? `${nf.format(l.valor || 0)} ${l.unidade}` : "—"}</td>
                <td className="py-2 pr-3 text-right tabular text-gray-400">{l.referencia != null ? `${nf.format(l.referencia)} ${l.unidade}` : "—"}</td>
                <td className="py-2">
                  {pct == null ? <div className="text-right text-gray-600">—</div> : (
                    <div className="flex items-center justify-end gap-2">
                      <div className="hidden sm:block h-1.5 flex-1 max-w-[120px] rounded-full bg-white/[0.06] overflow-hidden">
                        <div className={`h-full rounded-full ${ok ? "bg-rc-lime" : "bg-rc-coral"}`} style={{ width: `${Math.min(100, pct)}%` }} />
                      </div>
                      <span className={`tabular w-14 text-right ${ok ? "text-rc-lime" : "text-rc-coral"}`}>{nf.format(pct)}%</span>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function NotaReferencia({ referencia }) {
  return (
    <div className="mt-4 text-[12px] text-gray-500 space-y-1">
      {referencia && <p className="text-gray-300 font-medium">Referência (DRI): {referencia.faixa}</p>}
      <p>* Nutriente não presente na tabela de alimentos utilizada.</p>
      <p>** Algum alimento não tem este nutriente informado na tabela (o total pode estar subestimado).</p>
    </div>
  );
}

export function ResumoMacros({ t, peso }) {
  const ind = indicadores(t, peso);
  const temPeso = num(peso) > 0;
  const linhas = [
    ["Kcal", nf0.format(t.kcal)],
    ["CHO", `${nf.format(t.cho)} g · ${Math.round(ind.pct_cho)}%`],
    ["PTN", `${nf.format(t.ptn)} g · ${Math.round(ind.pct_ptn)}%`],
    ["LIP", `${nf.format(t.lip)} g · ${Math.round(ind.pct_lip)}%`],
    ["Kcal/kg", temPeso ? nf.format(ind.kcal_kg) : "–"],
    ["gCHO/kg", temPeso ? nf.format(ind.cho_gkg) : "–"],
    ["gPTN/kg", temPeso ? nf.format(ind.ptn_gkg) : "–"],
    ["gLIP/kg", temPeso ? nf.format(ind.lip_gkg) : "–"],
    ["Kcal não proteica/gN", nf.format(ind.kcal_nao_ptn_gn)],
    ["Fibras", `${nf.format(t.fib)} g`],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-6">
      {linhas.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-3 py-2 border-b border-white/[0.05]">
          <dt className="text-[13px] text-gray-400">{k}</dt>
          <dd className="text-[14px] text-white tabular font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Abas({ abas, ativa, onChange }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto [scrollbar-width:none] mb-4">
      {abas.map(([k, l]) => (
        <button
          key={k}
          role="tab"
          type="button"
          aria-selected={ativa === k}
          onClick={() => onChange(k)}
          className={`shrink-0 h-9 px-3.5 rounded-lg text-[13px] transition-colors ${ativa === k ? "bg-rc-blue text-rc-ink font-semibold" : "text-gray-400 hover:text-white hover:bg-white/[0.05]"}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

/** "Estatística da refeição": macros, vitaminas e minerais de uma refeicao ou opcao. */
export function EstatisticaRefeicaoModal({ pid, bloco, titulo, peso, onClose }) {
  const [aba, setAba] = useState("estatistica");
  const itens = useMemo(() => itensDosBlocos([bloco]), [bloco]);
  const { dados, carregando } = useAnalise(pid, itens);
  return (
    <Dialogo eyebrow="Estatística da refeição" titulo={titulo} onClose={onClose} largura="sm:max-w-3xl"
      rodape={<button type="button" onClick={onClose} className="rc-btn-primary">Ok</button>}>
      <Abas abas={[["estatistica", "Estatística"], ["vitaminas", "Vitaminas"], ["minerais", "Minerais"]]} ativa={aba} onChange={setAba} />
      {aba === "estatistica" && <ResumoMacros t={totaisBloco(bloco)} peso={peso} />}
      {aba === "vitaminas" && <><TabelaNutrientes linhas={dados?.vitaminas} carregando={carregando} /><NotaReferencia referencia={dados?.referencia} /></>}
      {aba === "minerais" && <><TabelaNutrientes linhas={dados?.minerais} carregando={carregando} /><NotaReferencia referencia={dados?.referencia} /></>}
    </Dialogo>
  );
}
