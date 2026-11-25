import React, { useEffect, useRef, useState } from "react";
import { Loader2, Plus, RotateCcw, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/evo-api";
import Flutuante from "./Flutuante";
import { nf, nf0, textoQuantidade } from "./calculos";
import { CRITERIOS, ROTULO_CRITERIO, porcaoEquivalente, useGruposSubstituicao, valorCriterio } from "./grupos";

/**
 * Item 9 dos ajustes: grupos de substituição. Cada grupo tem critério (kcal ou macro principal), porção de
 * referência, 4 a 6 opções padrão com medida caseira e tolerância. A tabela mostra a porção equivalente de cada
 * opção já arredondada (medida caseira ou 5 g) e marca o que passa da tolerância.
 */
function BuscaSimples({ placeholder, onEscolher }) {
  const [q, setQ] = useState("");
  const [itens, setItens] = useState([]);
  const ref = useRef(null);
  const listaRef = useRef(null);
  useEffect(() => {
    if (q.trim().length < 2) { setItens([]); return undefined; }
    const t = setTimeout(() => {
      api.get("/alimentos", { params: { q: q.trim(), limit: 10, ordenar: "relevancia" } }).then((r) => setItens(r.data.items || [])).catch(() => setItens([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div ref={ref} className="relative">
      <input className="rc-input h-9 text-[13px]" value={q} placeholder={placeholder} onChange={(e) => setQ(e.target.value)} aria-label={placeholder} />
      <Flutuante ancora={ref} aberto={itens.length > 0} largura={420} listaRef={listaRef}>
        {itens.map((f) => (
          <button key={f.id} type="button" onMouseDown={(e) => { e.preventDefault(); setQ(""); setItens([]); onEscolher(f); }}
            className="w-full flex justify-between gap-3 px-3 py-1.5 text-left text-[13px] text-gray-100 hover:bg-white/[0.06]">
            <span className="truncate">{f.nome}</span><span className="text-gray-500 text-[11px] shrink-0">{nf0.format(f.energia_kcal_100g || 0)} kcal/100 g</span>
          </button>
        ))}
      </Flutuante>
    </div>
  );
}

async function infoAlimento(f) {
  const { data } = await api.get(`/alimentos/${f.id}/medidas`);
  return { alimento_id: f.id, nome: f.nome, macros_100g: f.macros_100g, medidas: data.medidas || [] };
}

function Grupo({ g, onChange, onRemover }) {
  const alvo = g.referencia ? valorCriterio(g.referencia.macros_100g, g.referencia.quantidade_g, g.criterio) : 0;
  return (
    <section className="rounded-xl border border-white/[0.07] p-4" data-testid={`grupo-${g.id || g.nome}`}>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block flex-1 min-w-[180px]">
          <span className="rc-label">Grupo</span>
          <input className="rc-input h-9 font-semibold" value={g.nome} onChange={(e) => onChange({ nome: e.target.value })} />
        </label>
        <label className="block">
          <span className="rc-label">Troca pelo critério</span>
          <select className="rc-input h-9" value={g.criterio} onChange={(e) => onChange({ criterio: e.target.value })} aria-label={`Critério de ${g.nome}`}>
            {CRITERIOS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="block w-28">
          <span className="rc-label">Tolerância ±%</span>
          <input className="rc-input h-9 tabular" inputMode="decimal" value={g.tolerancia_pct} onChange={(e) => onChange({ tolerancia_pct: e.target.value })} aria-label={`Tolerância de ${g.nome}`} />
        </label>
        <button type="button" onClick={onRemover} className="rc-btn-ghost p-2 hover:text-rc-coral" aria-label={`Remover grupo ${g.nome}`}><Trash2 className="h-4 w-4" /></button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px] items-end">
        <div>
          <span className="rc-label">Porção de referência</span>
          {g.referencia ? (
            <div className="flex items-center gap-2 h-9 px-3 rounded-lg bg-white/[0.04] text-[13px]">
              <span className="flex-1 truncate text-white">{g.referencia.nome}</span>
              <span className="tabular text-rc-lime font-semibold shrink-0">{nf.format(alvo)} {ROTULO_CRITERIO[g.criterio]}</span>
              <button type="button" className="text-gray-500 hover:text-white" aria-label="Trocar alimento de referência" onClick={() => onChange({ referencia: null })}><X className="h-3.5 w-3.5" /></button>
            </div>
          ) : (
            <BuscaSimples placeholder="Alimento de referência" onEscolher={async (f) => onChange({ referencia: { ...(await infoAlimento(f)), quantidade_g: 100 } })} />
          )}
        </div>
        <label className="block">
          <span className="rc-label">Gramas</span>
          <input className="rc-input h-9 tabular" inputMode="decimal" disabled={!g.referencia} value={g.referencia?.quantidade_g ?? ""}
            onChange={(e) => onChange({ referencia: { ...g.referencia, quantidade_g: e.target.value } })} aria-label={`Gramas da referência de ${g.nome}`} />
        </label>
      </div>

      <table className="w-full mt-4 text-[13px]">
        <thead>
          <tr className="text-[10.5px] uppercase tracking-[0.12em] text-gray-500">
            <th className="text-left font-medium pb-1.5">Opção</th><th className="text-right font-medium pb-1.5">Porção equivalente</th><th className="text-right font-medium pb-1.5 w-20">Desvio</th><th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {(g.opcoes || []).map((o, k) => {
            const p = alvo ? porcaoEquivalente(g, o, alvo) : null;
            return (
              <tr key={o.alimento_id} className="border-t border-white/[0.05]">
                <td className="py-1.5 pr-3 text-gray-100">{o.nome}</td>
                <td className="py-1.5 text-right tabular text-gray-300">{p ? textoQuantidade(p) : "—"}</td>
                <td className={`py-1.5 text-right tabular font-semibold ${p?.fora ? "text-rc-amber" : "text-gray-500"}`}>{p ? `${p.desvio_pct > 0 ? "+" : ""}${nf.format(p.desvio_pct)}%` : ""}</td>
                <td className="text-right"><button type="button" className="text-gray-500 hover:text-white p-1" aria-label={`Remover ${o.nome}`} onClick={() => onChange({ opcoes: g.opcoes.filter((_, x) => x !== k) })}><X className="h-3.5 w-3.5" /></button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {(g.opcoes || []).length < 4 && <p className="mt-2 text-[12px] text-rc-amber">Sugestão: 4 a 6 opções por grupo.</p>}
      <div className="mt-3 max-w-[420px]">
        <BuscaSimples placeholder="Adicionar opção ao grupo" onEscolher={async (f) => {
          if ((g.opcoes || []).some((o) => String(o.alimento_id) === String(f.id))) return;
          onChange({ opcoes: [...(g.opcoes || []), await infoAlimento(f)] });
        }} />
      </div>
    </section>
  );
}

export default function GruposSubstituicaoConfig({ config, salvarConfig }) {
  const { grupos, recarregar, salvar, restaurar } = useGruposSubstituicao();
  const [lista, setLista] = useState(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { recarregar().then((g) => setLista(g)); }, [recarregar]);
  useEffect(() => { if (lista === null && grupos.length) setLista(grupos); }, [grupos, lista]);
  if (!lista) return <div className="py-8 flex justify-center text-gray-400"><Loader2 className="h-4 w-4 animate-spin" /></div>;

  const set = (i, patch) => setLista((l) => l.map((g, k) => (k === i ? { ...g, ...patch } : g)));
  const enviar = async () => {
    const incompleto = lista.find((g) => !g.referencia || !(g.nome || "").trim());
    if (incompleto) { toast.error(`Complete o grupo "${incompleto.nome || "sem nome"}": nome e porção de referência.`); return; }
    setSalvando(true);
    try {
      const salvo = await salvar(lista.map((g) => ({
        id: g.id, nome: g.nome, criterio: g.criterio, tolerancia_pct: Number(String(g.tolerancia_pct).replace(",", ".")) || 10, tipos: g.tipos || [],
        referencia: { alimento_id: String(g.referencia.alimento_id), quantidade_g: Number(String(g.referencia.quantidade_g).replace(",", ".")) || 100 },
        opcoes: (g.opcoes || []).map((o) => ({ alimento_id: String(o.alimento_id), ...(o.medida_nome ? { medida_nome: o.medida_nome } : {}) })),
      })));
      setLista(salvo);
      toast.success("Grupos de substituição salvos.");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); } finally { setSalvando(false); }
  };

  return (
    <div className="space-y-4" data-testid="grupos-substituicao">
      <p className="text-[13px] text-gray-400 max-w-[720px]">
        Usados nos “OU” automáticos da prescrição, no botão ⇄ (trocar mantendo a meta) e em “Montar por porções”.
        A porção equivalente é arredondada para a medida caseira ou 5 g; desvio acima da tolerância fica laranja.
      </p>
      <label className="flex items-center gap-2 text-[13.5px] text-gray-200 cursor-pointer">
        <input type="checkbox" className="accent-[#0081FD] w-4 h-4" checked={config.equivalentes_automaticos !== false}
          onChange={(e) => salvarConfig({ equivalentes_automaticos: e.target.checked }).catch(() => toast.error("Não foi possível salvar."))} />
        Preencher os “OU” automaticamente ao escolher um alimento na prescrição
      </label>
      {lista.map((g, i) => <Grupo key={g.id || `novo-${i}`} g={g} onChange={(p) => set(i, p)} onRemover={() => window.confirm(`Remover o grupo ${g.nome}?`) && setLista((l) => l.filter((_, k) => k !== i))} />)}
      <div className="flex flex-wrap items-center gap-2 pt-2">
        <button type="button" onClick={enviar} disabled={salvando} className="rc-btn-primary" data-testid="salvar-grupos">{salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar grupos</button>
        <button type="button" onClick={() => setLista((l) => [...l, { id: null, nome: "Novo grupo", criterio: "kcal", tolerancia_pct: 10, tipos: [], referencia: null, opcoes: [] }])} className="rc-btn-secondary"><Plus className="h-4 w-4" /> Novo grupo</button>
        <button type="button" onClick={async () => { if (window.confirm("Voltar aos grupos padrão? As alterações serão perdidas.")) setLista(await restaurar()); }} className="rc-btn-ghost ml-auto"><RotateCcw className="h-4 w-4" /> Restaurar padrão</button>
      </div>
    </div>
  );
}
