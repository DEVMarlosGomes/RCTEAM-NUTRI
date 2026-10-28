import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeftRight, Check, Loader2, Search, X } from "lucide-react";
import { api } from "@/lib/evo-api";
import { textoMedida } from "./calculos";

const nf = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

function Diff({ label, value }) {
  if (value === null || value === undefined || Math.abs(value) < 0.5) {
    return <span className="text-gray-500">{label} =</span>;
  }
  const up = value > 0;
  return <span className={up ? "text-rc-amber" : "text-rc-blueLight"}>{label} {up ? "+" : ""}{nf.format(value)}</span>;
}

/**
 * Lista alimentos equivalentes ao item escolhido (mesmo tipo de troca e perfil de macros),
 * com a quantidade calculada para as mesmas calorias (ou mesmo peso, para vegetais).
 */
export default function EquivalentesModal({ item, refeicaoNome, onAddSubstitutos, onTrocar, onClose }) {
  const [dados, setDados] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [buscaAtiva, setBuscaAtiva] = useState("");
  const [marcados, setMarcados] = useState({});
  const jaSubstitutos = useMemo(() => new Set((item.substitutos || []).map((s) => s.alimento_id)), [item.substitutos]);

  useEffect(() => {
    const t = setTimeout(() => setBuscaAtiva(busca.trim()), 300);
    return () => clearTimeout(t);
  }, [busca]);

  useEffect(() => {
    let ativo = true;
    setLoading(true);
    api.get(`/alimentos/${item.alimento_id}/equivalentes-calculados`, {
      params: { quantidade_g: Number(item.quantidade_g) || 100, q: buscaAtiva, limit: buscaAtiva ? 25 : 15 },
    })
      .then(({ data }) => { if (ativo) setDados(data); })
      .catch(() => { if (ativo) setDados({ equivalentes: [] }); })
      .finally(() => { if (ativo) setLoading(false); });
    return () => { ativo = false; };
  }, [item.alimento_id, item.quantidade_g, buscaAtiva]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const lista = dados?.equivalentes || [];
  const selecionados = lista.filter((e) => marcados[e.alimento_id]);
  const base = dados?.base;

  // No <body>: dentro da aba (que anima com transform) o position:fixed ficaria deslocado.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6" role="dialog" aria-modal="true" aria-label="Alimentos equivalentes">
      <button className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in" onClick={onClose} aria-label="Fechar" />
      <div className="relative w-full sm:max-w-3xl max-h-[92dvh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-rc-ink shadow-[var(--shadow-pop)] animate-fade-up">
        {/* Cabecalho com a porcao base */}
        <div className="px-5 sm:px-7 pt-5 pb-4 border-b border-white/[0.06]">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="rc-eyebrow">Lista de substituição · {refeicaoNome}</div>
              <h3 className="font-display font-bold uppercase text-[22px] text-white mt-2 leading-tight truncate" style={{ fontStretch: "82%" }}>
                {item.alimento_nome || item.nome}
              </h3>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[13px] text-gray-400">
                <span className="text-white font-medium tabular">{nf.format(Number(item.quantidade_g) || 0)} g</span>
                {base && <>
                  <span className="tabular">{nf.format(base.macros.kcal)} kcal</span>
                  <span className="tabular">P {nf.format(base.macros.ptn)} · C {nf.format(base.macros.cho)} · G {nf.format(base.macros.lip)}</span>
                </>}
              </div>
            </div>
            <button onClick={onClose} className="rc-btn-ghost p-2 -mr-2" aria-label="Fechar"><X className="w-5 h-5" /></button>
          </div>
          <div className="mt-4 flex flex-col sm:flex-row gap-3 sm:items-center">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                className="rc-input pl-9 h-10"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar outro alimento para trocar (calcula a quantidade equivalente)"
                autoFocus
              />
            </div>
            <div className="text-[12px] text-gray-500 shrink-0">
              Critério: <span className="text-gray-300">{dados?.criterio || "mesmas calorias"}</span>
            </div>
          </div>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto px-2 sm:px-3 py-2">
          {loading && (
            <div className="py-16 flex items-center justify-center gap-2 text-gray-400 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Calculando equivalentes…</div>
          )}
          {!loading && lista.length === 0 && (
            <div className="py-14 text-center">
              <p className="text-gray-300">Nenhum equivalente encontrado.</p>
              <p className="text-[13px] text-gray-500 mt-1">Busque pelo nome de outro alimento para calcular a troca.</p>
            </div>
          )}
          {!loading && lista.map((e) => {
            const ja = jaSubstitutos.has(e.alimento_id);
            const marcado = !!marcados[e.alimento_id];
            return (
              <div key={e.alimento_id} className={`group flex items-center gap-3 rounded-2xl px-3 sm:px-4 py-3 transition-colors ${marcado ? "bg-rc-lime/[0.07]" : "hover:bg-white/[0.03]"}`}>
                <button
                  type="button"
                  disabled={ja}
                  onClick={() => setMarcados((m) => ({ ...m, [e.alimento_id]: !m[e.alimento_id] }))}
                  className={`w-6 h-6 shrink-0 rounded-md flex items-center justify-center transition-colors ${ja ? "bg-white/[0.08] text-gray-500" : marcado ? "bg-rc-lime text-rc-ink" : "shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.18)] hover:shadow-[inset_0_0_0_1.5px_#C3F53C]"}`}
                  aria-label={ja ? "Já é substituto" : marcado ? "Desmarcar" : "Marcar como substituto"}
                >
                  {(marcado || ja) && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="rc-num text-[17px] text-white shrink-0">{nf.format(e.quantidade_g)} g</span>
                    <span className="text-[14px] text-gray-100 truncate">{e.nome}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-[12px]">
                    {e.medida && <span className="text-rc-lime/90">≈ {nf.format(e.medida.quantidade)} {textoMedida(e.medida.nome, e.medida.quantidade)}</span>}
                    <span className="text-gray-400 tabular">{nf.format(e.macros.kcal)} kcal</span>
                    <span className="tabular"><Diff label="P" value={e.diferenca.ptn} /></span>
                    <span className="tabular"><Diff label="C" value={e.diferenca.cho} /></span>
                    <span className="tabular"><Diff label="G" value={e.diferenca.lip} /></span>
                    <span className="text-gray-600 hidden sm:inline">{e.fonte}</span>
                  </div>
                </div>
                <div className="hidden md:block w-16 shrink-0" title={`Semelhança ${e.similaridade}%`}>
                  <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden"><div className="h-full rounded-full bg-rc-lime/70" style={{ width: `${e.similaridade}%` }} /></div>
                </div>
                <button type="button" onClick={() => onTrocar(e)} className="rc-btn-ghost text-[12.5px] px-2.5 py-1.5 shrink-0" title="Trocar o alimento por este">
                  <ArrowLeftRight className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Trocar</span>
                </button>
              </div>
            );
          })}
        </div>

        {/* Rodape */}
        <div className="px-5 sm:px-7 py-4 border-t border-white/[0.06] flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-[12.5px] text-gray-500">Marque para imprimir como “ou …” abaixo do alimento, ou troque o alimento.</p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rc-btn-secondary">Agora não</button>
            <button
              type="button"
              disabled={!selecionados.length}
              onClick={() => onAddSubstitutos(selecionados)}
              className="rc-btn-lime"
            >
              Adicionar {selecionados.length ? `${selecionados.length} ` : ""}substituto{selecionados.length === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
