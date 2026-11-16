import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, ListChecks } from "lucide-react";

/**
 * Sem limite de avaliações: as tabelas de histórico mostram por padrão as mais recentes que cabem na tela,
 * com setas para as anteriores e o seletor "Avaliações exibidas" (lista com data, marcar quais comparar).
 * Usado em Antropometria e em Gasto Energético. A numeração (1ª, 2ª...) é sempre a cronológica real.
 */

const dataBR = (v) => {
  if (!v) return "sem data";
  const d = new Date(`${String(v).slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("pt-BR");
};
export const dataDaAvaliacao = (e) => e?.data_avaliacao || e?.created_at?.slice(0, 10);

/** Ordem cronológica + número real de cada avaliação (`_numero`). */
export const numerarAvaliacoes = (avaliacoes) =>
  [...(avaliacoes || [])]
    .sort((a, b) => String(dataDaAvaliacao(a) || a.created_at || "").localeCompare(String(dataDaAvaliacao(b) || b.created_at || "")))
    .map((e, i) => ({ ...e, _numero: i + 1 }));

/** Quantas colunas cabem: largura do contêiner menos a coluna de rótulos, dividida pela largura da coluna. */
export function useCapacidade(ref, { rotulo = 240, coluna = 110, min = 3, max = 12 } = {}) {
  const [cap, setCap] = useState(min);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const medir = () => setCap(Math.max(min, Math.min(max, Math.floor((el.clientWidth - rotulo) / coluna))));
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, rotulo, coluna, min, max]);
  return cap;
}

export function useAvaliacoesExibidas(lista, capacidade) {
  const [ids, setIds] = useState(null); // null = automático (as mais recentes)
  const [fim, setFim] = useState(null); // navegação no automático (índice final, exclusivo)
  const total = lista.length;
  const escolhidas = ids ? lista.filter((e) => ids.includes(e.id)) : [];
  const manual = escolhidas.length > 0;
  const fimEf = Math.min(total, fim ?? total);
  const inicio = Math.max(0, fimEf - capacidade);
  const visiveis = manual ? escolhidas.slice(-capacidade) : lista.slice(inicio, fimEf);
  return {
    lista, capacidade, visiveis, manual, ids: manual ? ids : visiveis.map((e) => e.id),
    inicio: manual ? null : inicio, fim: manual ? null : fimEf, total,
    podeAnterior: !manual && inicio > 0,
    podeProxima: !manual && fimEf < total,
    anterior: () => setFim(Math.max(Math.min(capacidade, total), fimEf - 1)),
    proxima: () => setFim(Math.min(total, fimEf + 1)),
    escolher: (novos) => { setIds(novos && novos.length ? novos : null); setFim(null); },
    recentes: () => { setIds(null); setFim(null); },
  };
}

export default function SeletorAvaliacoes({ estado, limite }) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef(null);
  const max = limite ?? estado.capacidade;

  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (e) => { if (ref.current && !ref.current.contains(e.target)) setAberto(false); };
    const esc = (e) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc); };
  }, [aberto]);

  if (estado.total === 0) return null;
  const marcadas = new Set(estado.ids);
  const alternar = (id) => {
    const nova = new Set(marcadas);
    if (nova.has(id)) nova.delete(id);
    else if (nova.size < max) nova.add(id);
    estado.escolher(estado.lista.filter((e) => nova.has(e.id)).map((e) => e.id));
  };
  const faixa = estado.manual
    ? `${estado.visiveis.length} escolhidas de ${estado.total}`
    : `${estado.inicio + 1}ª a ${estado.fim}ª de ${estado.total}`;

  return (
    <div className="flex items-center justify-end gap-1 text-[11.5px] text-gray-500" ref={ref}>
      {!estado.manual && estado.total > estado.capacidade && (
        <button type="button" aria-label="Avaliações anteriores" disabled={!estado.podeAnterior} onClick={estado.anterior} className="evo-btn-ghost p-1.5 disabled:opacity-30">
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}
      <span className="tabular px-1">{faixa}</span>
      {!estado.manual && estado.total > estado.capacidade && (
        <button type="button" aria-label="Próximas avaliações" disabled={!estado.podeProxima} onClick={estado.proxima} className="evo-btn-ghost p-1.5 disabled:opacity-30">
          <ChevronRight className="h-4 w-4" />
        </button>
      )}
      <div className="relative">
        <button type="button" aria-expanded={aberto} onClick={() => setAberto((v) => !v)} className="evo-btn-ghost h-8 text-[12px]" data-testid="seletor-avaliacoes">
          <ListChecks className="h-4 w-4" /> Avaliações exibidas
        </button>
        {aberto && (
          <div className="absolute right-0 top-full mt-1 z-30 w-64 rounded-xl bg-rc-raised shadow-[var(--shadow-pop)] ring-1 ring-white/[0.08] p-2 animate-fade-in">
            <p className="px-2 py-1.5 text-[11.5px] text-gray-400">Marque até {max} para comparar lado a lado.</p>
            <ul className="max-h-64 overflow-y-auto">
              {[...estado.lista].reverse().map((e) => {
                const on = marcadas.has(e.id);
                const cheio = !on && marcadas.size >= max;
                return (
                  <li key={e.id}>
                    <button type="button" disabled={cheio} onClick={() => alternar(e.id)}
                      className="w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[12.5px] text-gray-200 hover:bg-white/[0.05] disabled:opacity-35">
                      <span className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center ${on ? "bg-rc-blue border-rc-blue" : "border-white/25"}`}>
                        {on && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                      </span>
                      <span className="tabular w-8 text-gray-400">{e._numero}ª</span>
                      <span className="tabular">{dataBR(dataDaAvaliacao(e))}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <button type="button" onClick={() => { estado.recentes(); setAberto(false); }} className="mt-1 w-full rounded-lg px-2 py-1.5 text-[12px] text-rc-blue hover:bg-white/[0.05] text-left">
              Mostrar as mais recentes
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
