import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown, ArrowLeftRight, ArrowUp, Copy, Loader2, MessageSquareText, Plus, Search, Trash2, X,
} from "lucide-react";
import { api } from "@/lib/evo-api";
import EquivalentesModal, { equivalentesAutomaticos } from "./EquivalentesModal";

const nf = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const num = (v) => {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

export const REFEICOES_PADRAO = [
  ["Café da manhã", "07:00"], ["Lanche da manhã", "10:00"], ["Almoço", "12:30"],
  ["Lanche da tarde", "16:00"], ["Jantar", "19:30"], ["Ceia", "22:00"],
].map(([nome, horario]) => ({ nome, horario, meta_kcal: "", observacao: "", alimentos: [] }));

/** Macros por 100 g a partir dos nutrientes de um item salvo (o backend devolve valores da porcao). */
export const m100DoItemSalvo = (item) => {
  const g = num(item?.quantidade_g);
  const n = item?.nutrientes;
  if (!n || !g) return null;
  const f = 100 / g;
  return { kcal: (n.energia_kcal || 0) * f, ptn: (n.proteinas_g || 0) * f, cho: (n.carboidratos_g || 0) * f, lip: (n.lipidios_g || 0) * f, fib: (n.fibras_g || 0) * f };
};

export const macrosDoItem = (item) => {
  const m = item?._m100;
  const g = num(item?.quantidade_g);
  if (!m || !g) return { kcal: 0, ptn: 0, cho: 0, lip: 0, fib: 0 };
  const f = g / 100;
  return { kcal: (m.kcal || 0) * f, ptn: (m.ptn || 0) * f, cho: (m.cho || 0) * f, lip: (m.lip || 0) * f, fib: (m.fib || 0) * f };
};

const somar = (lista) => lista.reduce((acc, m) => ({
  kcal: acc.kcal + m.kcal, ptn: acc.ptn + m.ptn, cho: acc.cho + m.cho, lip: acc.lip + m.lip, fib: acc.fib + m.fib,
}), { kcal: 0, ptn: 0, cho: 0, lip: 0, fib: 0 });

export const totaisRefeicao = (ref) => somar((ref.alimentos || []).map(macrosDoItem));
export const totaisDia = (refeicoes) => somar((refeicoes || []).map(totaisRefeicao));

const medidaGramas = (item) => {
  if (!item.medida_nome || item.medida_nome === "Gramas") return 1;
  const m = (item._medidas || []).find((x) => x.nome === item.medida_nome);
  return m ? num(m.gramas) : null;
};

async function carregarMedidas(alimentoId) {
  try {
    const { data } = await api.get(`/alimentos/${alimentoId}/medidas`);
    return data.medidas || [];
  } catch {
    return [{ nome: "Gramas", gramas: 1 }];
  }
}

/** Campo de alimento com busca em linha (lista suspensa com teclado). */
function BuscaAlimento({ valor, onEscolher, autoFocus }) {
  const [texto, setTexto] = useState(valor || "");
  const [itens, setItens] = useState([]);
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const [carregando, setCarregando] = useState(false);
  const ref = useRef(null);

  useEffect(() => { setTexto(valor || ""); }, [valor]);

  useEffect(() => {
    if (!aberto || texto.trim().length < 2 || texto === valor) { setItens([]); return undefined; }
    const t = setTimeout(async () => {
      setCarregando(true);
      try {
        const { data } = await api.get("/alimentos", { params: { q: texto.trim(), limit: 8 } });
        setItens(data.items || []);
        setAtivo(0);
      } catch { setItens([]); } finally { setCarregando(false); }
    }, 220);
    return () => clearTimeout(t);
  }, [texto, aberto, valor]);

  useEffect(() => {
    const fora = (e) => { if (ref.current && !ref.current.contains(e.target)) setAberto(false); };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, []);

  const escolher = (food) => { setAberto(false); setTexto(food.nome); onEscolher(food); };

  return (
    <div ref={ref} className="relative min-w-0">
      <Search className="w-3.5 h-3.5 text-gray-600 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
      <input
        className="rc-input h-9 pl-8 pr-2 text-[13.5px]"
        value={texto}
        autoFocus={autoFocus}
        placeholder="Buscar alimento…"
        onFocus={() => setAberto(true)}
        onChange={(e) => { setTexto(e.target.value); setAberto(true); }}
        onKeyDown={(e) => {
          if (!itens.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setAtivo((i) => Math.min(i + 1, itens.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setAtivo((i) => Math.max(i - 1, 0)); }
          if (e.key === "Enter") { e.preventDefault(); escolher(itens[ativo]); }
          if (e.key === "Escape") setAberto(false);
        }}
        aria-autocomplete="list"
        aria-expanded={aberto && itens.length > 0}
      />
      {aberto && (carregando || itens.length > 0) && (
        <div className="absolute z-30 left-0 right-0 sm:right-auto sm:w-[460px] mt-1.5 rounded-xl bg-rc-raised shadow-[var(--shadow-pop)] overflow-hidden animate-fade-in" role="listbox">
          {carregando && !itens.length && <div className="px-3 py-3 text-[12.5px] text-gray-400 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" />Buscando…</div>}
          {itens.map((f, i) => (
            <button
              key={f.id}
              type="button"
              role="option"
              aria-selected={i === ativo}
              onMouseEnter={() => setAtivo(i)}
              onMouseDown={(e) => { e.preventDefault(); escolher(f); }}
              className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-left ${i === ativo ? "bg-white/[0.06]" : ""}`}
            >
              <span className="min-w-0">
                <span className="block text-[13.5px] text-gray-100 truncate">{f.nome}</span>
                <span className="block text-[11px] text-gray-500 truncate">{f.grupo_display || "—"} · {f.fonte || "base"}</span>
              </span>
              <span className="shrink-0 text-right tabular">
                <span className="block text-[13px] text-white">{nf0.format(f.energia_kcal_100g || 0)} kcal</span>
                <span className="block text-[10.5px] text-gray-500">P {nf.format(f.macros_100g?.ptn || 0)} · C {nf.format(f.macros_100g?.cho || 0)} · G {nf.format(f.macros_100g?.lip || 0)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const GRID = "grid grid-cols-[minmax(150px,1fr)_52px_128px_64px_46px_44px_44px_44px_118px] gap-1.5 items-center";

function LinhaAlimento({ item, autoFocus, onChange, onEscolher, onEquivalentes, onSubir, onDescer, onRemover }) {
  const [obsAberta, setObsAberta] = useState(!!item.observacao);
  const m = macrosDoItem(item);
  const medidas = useMemo(() => {
    const lista = item._medidas?.length ? item._medidas : [{ nome: "Gramas", gramas: 1 }];
    return lista.some((x) => x.nome === item.medida_nome) || !item.medida_nome ? lista : [...lista, { nome: item.medida_nome, gramas: null }];
  }, [item._medidas, item.medida_nome]);

  const setQtd = (v) => {
    const g = medidaGramas(item);
    onChange({ quantidade: v, quantidade_g: g ? Math.round(num(v) * g * 10) / 10 : item.quantidade_g });
  };
  const setMedida = (nome) => {
    const md = medidas.find((x) => x.nome === nome);
    const qtd = nome === "Gramas" ? num(item.quantidade_g) || 100 : 1;
    onChange({ medida_nome: nome, quantidade: qtd, quantidade_g: nome === "Gramas" ? qtd : Math.round(num(md?.gramas) * qtd * 10) / 10 });
  };
  const setGramas = (v) => {
    const g = medidaGramas(item);
    onChange({ quantidade_g: v, quantidade: !g || g === 1 ? v : Math.round((num(v) / g) * 100) / 100 });
  };

  return (
    <div className="px-3 py-2 border-t border-white/[0.04] first:border-t-0">
      <div className={GRID}>
        <BuscaAlimento valor={item.alimento_nome || item.nome} onEscolher={onEscolher} autoFocus={autoFocus} />
        <input className="rc-input h-9 px-2 text-center text-[13.5px] tabular" inputMode="decimal" value={item.quantidade ?? ""} onChange={(e) => setQtd(e.target.value)} aria-label="Quantidade" disabled={!item.alimento_id} />
        <select className="rc-input h-9 px-2 text-[13px]" value={item.medida_nome || "Gramas"} onChange={(e) => setMedida(e.target.value)} aria-label="Medida caseira" disabled={!item.alimento_id}>
          {medidas.map((md) => <option key={md.nome} value={md.nome}>{md.nome}{md.gramas && md.nome !== "Gramas" ? ` (${nf.format(md.gramas)} g)` : ""}</option>)}
        </select>
        <div className="relative">
          <input className="rc-input h-9 pl-2 pr-5 text-right text-[13.5px] tabular" inputMode="decimal" value={item.quantidade_g ?? ""} onChange={(e) => setGramas(e.target.value)} aria-label="Gramas" disabled={!item.alimento_id} />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-gray-500">g</span>
        </div>
        <div className="text-right text-[13px] text-white tabular">{item.alimento_id ? nf0.format(m.kcal) : "–"}</div>
        <div className="text-right text-[13px] text-gray-300 tabular">{item.alimento_id ? nf.format(m.cho) : "–"}</div>
        <div className="text-right text-[13px] text-gray-300 tabular">{item.alimento_id ? nf.format(m.ptn) : "–"}</div>
        <div className="text-right text-[13px] text-gray-300 tabular">{item.alimento_id ? nf.format(m.lip) : "–"}</div>
        <div className="flex justify-end items-center gap-0.5 pl-2">
          <button type="button" onClick={onEquivalentes} disabled={!item.alimento_id} className="rc-btn-ghost p-1.5 text-rc-lime disabled:opacity-30" title="Equivalentes / substitutos"><ArrowLeftRight className="w-4 h-4" /></button>
          <button type="button" onClick={() => setObsAberta((v) => !v)} className={`rc-btn-ghost p-1.5 ${item.observacao ? "text-rc-blueLight" : ""}`} title="Observação"><MessageSquareText className="w-4 h-4" /></button>
          <div className="flex flex-col">
            <button type="button" onClick={onSubir} className="text-gray-600 hover:text-gray-200 px-1" title="Subir"><ArrowUp className="w-3 h-3" /></button>
            <button type="button" onClick={onDescer} className="text-gray-600 hover:text-gray-200 px-1" title="Descer"><ArrowDown className="w-3 h-3" /></button>
          </div>
          <button type="button" onClick={onRemover} className="rc-btn-ghost p-1.5 hover:text-rc-coral" title="Remover"><Trash2 className="w-4 h-4" /></button>
        </div>
      </div>
      {(item.substitutos?.length > 0 || obsAberta) && (
        <div className="mt-1.5 pl-1 flex flex-wrap items-center gap-1.5">
          {item.substitutos?.length > 0 && <span className="text-[11px] uppercase tracking-[0.12em] text-gray-500 mr-1">ou</span>}
          {(item.substitutos || []).map((s, i) => (
            <span key={`${s.alimento_id}-${i}`} className="rc-chip bg-white/[0.05] text-gray-200">
              <span className="tabular text-gray-400">{s.medida_nome && s.medida_nome !== "Gramas" ? `${nf.format(s.quantidade)} ${s.medida_nome.toLowerCase()}` : `${nf.format(s.quantidade_g || s.quantidade)} g`}</span>
              <span className="max-w-[220px] truncate">{s.nome}</span>
              <button type="button" onClick={() => onChange({ substitutos: item.substitutos.filter((_, k) => k !== i) })} className="text-gray-500 hover:text-white" aria-label={`Remover ${s.nome}`}><X className="w-3 h-3" /></button>
            </span>
          ))}
          {obsAberta && (
            <input
              className="rc-input h-8 text-[12.5px] flex-1 min-w-[220px]"
              value={item.observacao || ""}
              onChange={(e) => onChange({ observacao: e.target.value })}
              placeholder="Observação do alimento (ex.: sem sal, temperar com ervas)"
            />
          )}
        </div>
      )}
    </div>
  );
}

function Refeicao({ refeicao, indice, total, onChange, onMover, onDuplicar, onRemover, onAbrirEquivalentes, focoNovaLinha }) {
  const t = totaisRefeicao(refeicao);
  const alimentos = refeicao.alimentos || [];
  const atualizarItem = (i, patch) => onChange({ ...refeicao, alimentos: alimentos.map((it, k) => (k === i ? { ...it, ...patch } : it)) });
  const moverItem = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= alimentos.length) return;
    const lista = [...alimentos];
    [lista[i], lista[j]] = [lista[j], lista[i]];
    onChange({ ...refeicao, alimentos: lista });
  };

  const escolherAlimento = async (i, food) => {
    const base = {
      alimento_id: food.id, alimento_nome: food.nome, nome: food.nome, _m100: food.macros_100g,
      _grupo: food.grupo_display, medida_nome: "Gramas", quantidade: 100, quantidade_g: 100, substitutos: [],
      observacao: alimentos[i]?.observacao || "",
    };
    const medidas = await carregarMedidas(food.id);
    const caseira = medidas.find((md) => md.nome !== "Gramas" && num(md.gramas) >= 5 && num(md.gramas) <= 300);
    const item = caseira
      ? { ...base, _medidas: medidas, medida_nome: caseira.nome, quantidade: 1, quantidade_g: num(caseira.gramas) }
      : { ...base, _medidas: medidas };
    const lista = [...alimentos];
    lista[i] = item;
    onChange({ ...refeicao, alimentos: lista });
    if (equivalentesAutomaticos()) onAbrirEquivalentes(i, item);
  };

  return (
    <section className="rc-card overflow-visible">
      <header className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-white/[0.06]">
        <input
          className="bg-transparent outline-none font-display font-bold uppercase text-[17px] text-white min-w-0 flex-1 focus:text-rc-lime"
          style={{ fontStretch: "82%" }}
          value={refeicao.nome}
          onChange={(e) => onChange({ ...refeicao, nome: e.target.value })}
          aria-label="Nome da refeição"
        />
        <input type="time" className="rc-input h-8 w-[104px] px-2 text-[13px]" value={refeicao.horario || ""} onChange={(e) => onChange({ ...refeicao, horario: e.target.value })} aria-label="Horário" />
        <div className="text-[12.5px] text-gray-400 tabular min-w-[86px] text-right"><span className="text-white font-medium">{nf0.format(t.kcal)}</span> kcal</div>
        <div className="flex items-center gap-0.5">
          <button type="button" onClick={() => onMover(-1)} disabled={indice === 0} className="rc-btn-ghost p-1.5 disabled:opacity-30" title="Subir refeição"><ArrowUp className="w-4 h-4" /></button>
          <button type="button" onClick={() => onMover(1)} disabled={indice === total - 1} className="rc-btn-ghost p-1.5 disabled:opacity-30" title="Descer refeição"><ArrowDown className="w-4 h-4" /></button>
          <button type="button" onClick={onDuplicar} className="rc-btn-ghost p-1.5" title="Duplicar refeição"><Copy className="w-4 h-4" /></button>
          <button type="button" onClick={onRemover} className="rc-btn-ghost p-1.5 hover:text-rc-coral" title="Remover refeição"><Trash2 className="w-4 h-4" /></button>
        </div>
      </header>

      <div className="overflow-x-auto">
        <div className="min-w-[740px]">
          <div className={`${GRID} px-3 pt-2.5 pb-1 text-[10.5px] uppercase tracking-[0.12em] text-gray-500`}>
            <span>Alimento</span><span className="text-center">Qtd</span><span>Medida caseira</span><span className="text-right">Peso</span>
            <span className="text-right">Kcal</span><span className="text-right">CHO</span><span className="text-right">PTN</span><span className="text-right">LIP</span><span />
          </div>
          {alimentos.map((item, i) => (
            <LinhaAlimento
              key={`${indice}-${i}-${item.alimento_id || "novo"}`}
              item={item}
              autoFocus={focoNovaLinha && i === alimentos.length - 1 && !item.alimento_id}
              onChange={(patch) => atualizarItem(i, patch)}
              onEscolher={(food) => escolherAlimento(i, food)}
              onEquivalentes={() => onAbrirEquivalentes(i, item)}
              onSubir={() => moverItem(i, -1)}
              onDescer={() => moverItem(i, 1)}
              onRemover={() => onChange({ ...refeicao, alimentos: alimentos.filter((_, k) => k !== i) })}
            />
          ))}
          <div className={`${GRID} px-3 py-2.5 border-t border-white/[0.06] bg-black/[0.15]`}>
            <button type="button" onClick={() => onChange({ ...refeicao, alimentos: [...alimentos, { substitutos: [] }] }, true)} className="rc-btn-ghost justify-self-start -ml-2 text-rc-lime">
              <Plus className="w-4 h-4" /> Adicionar alimento
            </button>
            <span /><span />
            <span className="text-right text-[11px] uppercase tracking-[0.12em] text-gray-500">Total</span>
            <span className="text-right text-[13px] text-white font-semibold tabular">{nf0.format(t.kcal)}</span>
            <span className="text-right text-[13px] text-white tabular">{nf.format(t.cho)}g</span>
            <span className="text-right text-[13px] text-white tabular">{nf.format(t.ptn)}g</span>
            <span className="text-right text-[13px] text-white tabular">{nf.format(t.lip)}g</span>
            <span />
          </div>
        </div>
      </div>
    </section>
  );
}

function Indicador({ label, valor, sub }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1.5">
      <span className="text-[12.5px] text-gray-400">{label}</span>
      <span className="text-right tabular"><span className="text-[14px] text-white font-medium">{valor}</span>{sub && <span className="text-[11.5px] text-gray-500 ml-1.5">{sub}</span>}</span>
    </div>
  );
}

/** Painel lateral fixo com o total da dieta (inspirado no "Total da Dieta" de softwares clinicos). */
export function PainelTotais({ refeicoes, peso, metaKcal }) {
  const t = totaisDia(refeicoes);
  const p = num(peso);
  const meta = num(metaKcal);
  const pct = (g, f) => (t.kcal ? Math.round(((g * f) / t.kcal) * 100) : 0);
  const gN = t.ptn / 6.25;
  const naoProteica = gN ? (t.kcal - t.ptn * 4) / gN : null;
  const progresso = meta ? Math.min(100, Math.round((t.kcal / meta) * 100)) : null;
  const macros = [
    ["Carboidrato", t.cho, 4, "bg-macro-cho"],
    ["Proteína", t.ptn, 4, "bg-macro-ptn"],
    ["Gordura", t.lip, 9, "bg-macro-lip"],
  ];
  return (
    <aside className="rc-card p-5 xl:sticky xl:top-20">
      <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Total da dieta</div>
      <div className="flex items-baseline gap-1.5 mt-2">
        <span className="rc-num text-[44px] leading-none text-white">{nf0.format(t.kcal)}</span>
        <span className="text-gray-400 text-[13px]">kcal</span>
      </div>
      {meta > 0 && (
        <div className="mt-3">
          <div className="flex justify-between text-[11.5px] text-gray-500"><span>Meta {nf0.format(meta)} kcal</span><span className={Math.abs(t.kcal - meta) / meta > 0.1 ? "text-rc-amber" : "text-rc-lime"}>{t.kcal - meta >= 0 ? "+" : ""}{nf0.format(t.kcal - meta)}</span></div>
          <div className="h-1.5 rounded-full bg-white/[0.06] mt-1.5 overflow-hidden"><div className="h-full rounded-full bg-rc-lime transition-[width] duration-300" style={{ width: `${progresso}%` }} /></div>
        </div>
      )}
      <div className="flex h-2 rounded-full overflow-hidden bg-white/[0.05] mt-5">
        {macros.map(([l, g, f, c]) => <div key={l} className={c} style={{ width: `${pct(g, f)}%` }} />)}
      </div>
      <div className="mt-3 space-y-0.5">
        {macros.map(([l, g, f, c]) => (
          <div key={l} className="flex items-baseline justify-between text-[13px] py-1">
            <span className="text-gray-300 inline-flex items-center gap-2"><span className={`w-2 h-2 rounded-[2px] ${c}`} />{l}</span>
            <span className="tabular"><span className="text-white font-medium">{nf.format(g)} g</span><span className="text-gray-500 ml-2">{pct(g, f)}%</span>{p > 0 && <span className="text-gray-500 ml-2">{nf.format(g / p)} g/kg</span>}</span>
          </div>
        ))}
      </div>
      <div className="h-px bg-white/[0.06] my-3" />
      {p > 0 && <Indicador label="Kcal/kg" valor={nf.format(t.kcal / p)} />}
      <Indicador label="Fibras" valor={`${nf.format(t.fib)} g`} />
      <Indicador label="Kcal não proteica/gN" valor={naoProteica ? nf.format(naoProteica) : "–"} />
      <div className="h-px bg-white/[0.06] my-3" />
      <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500 mb-2">Distribuição</div>
      {(refeicoes || []).map((r, i) => {
        const k = totaisRefeicao(r).kcal;
        const share = t.kcal ? Math.round((k / t.kcal) * 100) : 0;
        return (
          <div key={`${r.nome}-${i}`} className="py-1">
            <div className="flex justify-between text-[12px]"><span className="text-gray-400 truncate">{r.nome}</span><span className="text-gray-300 tabular">{share}%</span></div>
            <div className="h-1 rounded-full bg-white/[0.05] mt-1"><div className="h-full rounded-full bg-rc-blue/70" style={{ width: `${share}%` }} /></div>
          </div>
        );
      })}
    </aside>
  );
}

/**
 * Editor de refeicoes no estilo de softwares de dieta: busca em linha, medidas caseiras com
 * conversao para gramas, macros ao vivo por linha/refeicao e equivalentes ao escolher alimento.
 */
export default function EditorDieta({ refeicoes, onChange }) {
  const [equiv, setEquiv] = useState(null); // { ref, item, indice }
  const [focoRef, setFocoRef] = useState(null);

  const atualizar = (i, nova, focarNovaLinha = false) => {
    onChange(refeicoes.map((r, k) => (k === i ? nova : r)));
    if (focarNovaLinha) setFocoRef(i);
  };
  const mover = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= refeicoes.length) return;
    const lista = [...refeicoes];
    [lista[i], lista[j]] = [lista[j], lista[i]];
    onChange(lista);
  };

  const aplicarEquivalentes = (selecionados) => {
    const { ref, indice } = equiv;
    const r = refeicoes[ref];
    const item = r.alimentos[indice];
    const novos = selecionados.map((e) => ({
      alimento_id: e.alimento_id, nome: e.nome,
      medida_nome: e.medida ? e.medida.nome : "Gramas",
      quantidade: e.medida ? e.medida.quantidade : e.quantidade_g,
      quantidade_g: e.medida ? e.medida.gramas : e.quantidade_g,
    }));
    atualizar(ref, { ...r, alimentos: r.alimentos.map((it, k) => (k === indice ? { ...item, substitutos: [...(item.substitutos || []), ...novos] } : it)) });
    setEquiv(null);
  };

  const trocar = async (e) => {
    const { ref, indice } = equiv;
    const r = refeicoes[ref];
    const antigo = r.alimentos[indice];
    const medidas = await carregarMedidas(e.alimento_id);
    const novo = {
      alimento_id: e.alimento_id, alimento_nome: e.nome, nome: e.nome, _m100: e.macros_100g, _medidas: medidas,
      medida_nome: e.medida ? e.medida.nome : "Gramas",
      quantidade: e.medida ? e.medida.quantidade : e.quantidade_g,
      quantidade_g: e.medida ? e.medida.gramas : e.quantidade_g,
      observacao: antigo.observacao || "",
      // o alimento anterior vira substituto, para nao perder a opcao
      substitutos: [
        { alimento_id: antigo.alimento_id, nome: antigo.alimento_nome || antigo.nome, medida_nome: antigo.medida_nome, quantidade: antigo.quantidade, quantidade_g: antigo.quantidade_g },
        ...(antigo.substitutos || []).filter((s) => s.alimento_id !== e.alimento_id),
      ],
    };
    atualizar(ref, { ...r, alimentos: r.alimentos.map((it, k) => (k === indice ? novo : it)) });
    setEquiv(null);
  };

  return (
    <div className="space-y-4">
      {equiv && (
        <EquivalentesModal
          item={equiv.item}
          refeicaoNome={refeicoes[equiv.ref]?.nome}
          onAddSubstitutos={aplicarEquivalentes}
          onTrocar={trocar}
          onClose={() => setEquiv(null)}
        />
      )}
      {refeicoes.map((r, i) => (
        <Refeicao
          key={i}
          refeicao={r}
          indice={i}
          total={refeicoes.length}
          focoNovaLinha={focoRef === i}
          onChange={(nova, focar) => atualizar(i, nova, focar)}
          onMover={(d) => mover(i, d)}
          onDuplicar={() => onChange([...refeicoes.slice(0, i + 1), { ...r, nome: `${r.nome} (cópia)`, alimentos: (r.alimentos || []).map((a) => ({ ...a })) }, ...refeicoes.slice(i + 1)])}
          onRemover={() => { if ((r.alimentos || []).length === 0 || window.confirm(`Remover a refeição "${r.nome}"?`)) onChange(refeicoes.filter((_, k) => k !== i)); }}
          onAbrirEquivalentes={(indice, item) => setEquiv({ ref: i, indice, item })}
        />
      ))}
      <button
        type="button"
        onClick={() => onChange([...refeicoes, { nome: `Refeição ${refeicoes.length + 1}`, horario: "", meta_kcal: "", observacao: "", alimentos: [{ substitutos: [] }] }])}
        className="w-full rounded-2xl border border-dashed border-white/[0.12] hover:border-rc-lime/50 text-gray-400 hover:text-rc-lime py-4 text-[14px] transition-colors inline-flex items-center justify-center gap-2"
      >
        <Plus className="w-4 h-4" /> Adicionar refeição
      </button>
    </div>
  );
}
