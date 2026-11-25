import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown, ArrowLeftRight, ArrowUp, ArrowUpDown, BookOpen, ChevronDown, ClipboardPaste, Copy, CopyPlus, GripVertical,
  Layers, Loader2, MessageSquareText, MoreHorizontal, PieChart, Plus, Star, Trash2, X,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/evo-api";
import EquivalentesModal from "./EquivalentesModal";
import Combobox from "./Combobox";
import Flutuante from "./Flutuante";
import PainelTotais from "./PainelTotais";
import PorcoesDialogo from "./PorcoesDialogo";
import {
  GruposContext, ROTULO_CRITERIO, gruposSemRestricoes, grupoDoItem, opcoesDoGrupo, porcaoEquivalente, substitutosDoGrupo, useGruposSubstituicao, valorCriterio,
} from "./grupos";
import { metasDoPlanejamento } from "./plano";
import {
  copiarRefeicao, ehGramas, escalarSubstitutos, gramasDaMedida, itemDoSalvo, macrosDoItem, medidaPadrao, nf, nf0,
  normalizar, novaRefeicao, novoItem, num, refeicaoCopiada, textoMedida, textoQuantidade, totaisBloco, totaisDia,
} from "./calculos";

/**
 * Editor de refeições da Prescrição Dietética e do Recordatório (itens 4, 5, 6, 7 e 13 dos ajustes do Rogério):
 * total no topo, uma linha por alimento, meta por refeição com barra e "faltam X kcal", "Ajustar à meta",
 * favoritos/recentes na busca, teclado (alimento → Enter → quantidade → Enter = nova linha), arrastar alimentos
 * entre refeições, duplicar refeição. Cores: CHO lima, PTN azul, LIP laranja.
 */
const COLS = "grid grid-cols-[40px_minmax(180px,1fr)_minmax(220px,270px)_54px_50px_50px_50px_128px] gap-2 items-center";
export const LARGURA_EDITOR = "min-w-[880px]";
const r1 = (v) => Math.round(num(v) * 10) / 10;
const COR = { cho: "text-macro-cho", ptn: "text-macro-ptn", lip: "text-macro-lip" };
const RECENTES_KEY = "rc_alimentos_recentes";

const focar = (id, selecionar = true) => requestAnimationFrame(() => {
  const el = document.getElementById(id);
  if (el) { el.focus(); if (selecionar && el.select) el.select(); }
});

/** Medidas caseiras e grupo de substituição do alimento (uma chamada só). */
export async function carregarAlimentoInfo(alimentoId) {
  try {
    const { data } = await api.get(`/alimentos/${alimentoId}/medidas`);
    return { medidas: data.medidas || [], grupo: data.grupo_substituicao || null };
  } catch {
    return { medidas: [{ nome: "Gramas", gramas: 1 }], grupo: null };
  }
}
export async function carregarMedidas(alimentoId) {
  return (await carregarAlimentoInfo(alimentoId)).medidas;
}

/** Troca do item por outra opção do grupo na porção equivalente (⇄): o "OU" passa a ser calculado para o novo. */
export function trocarPorOpcao(item, grupo, opcao) {
  const alvo = valorCriterio(item._m100, item.quantidade_g, grupo.criterio);
  const p = porcaoEquivalente(grupo, opcao, alvo);
  if (!p) return null;
  const novo = {
    ...item, alimento_id: opcao.alimento_id, nome: opcao.nome, alimento_nome: opcao.nome, _m100: opcao.macros_100g,
    _medidas: opcao.medidas || [], _grupo: grupo.id, medida_nome: p.medida_nome, quantidade: p.quantidade, quantidade_g: p.quantidade_g,
  };
  return { ...novo, substitutos: substitutosDoGrupo(grupo, novo) };
}

const snapshot = (f) => ({ id: f.id, nome: f.nome, macros_100g: f.macros_100g, energia_kcal_100g: f.energia_kcal_100g ?? f.macros_100g?.kcal, grupo_display: f.grupo_display, fonte: f.fonte });

export function lerRecentes() {
  try { return JSON.parse(localStorage.getItem(RECENTES_KEY) || "[]"); } catch { return []; }
}
function guardarRecente(f) {
  try {
    const lista = [snapshot(f), ...lerRecentes().filter((x) => x.id !== f.id)].slice(0, 20);
    localStorage.setItem(RECENTES_KEY, JSON.stringify(lista));
  } catch { /* sem armazenamento: só não lembra */ }
}

// ── Meta por refeição ──────────────────────────────────────────────────────

/** Meta da refeição: % do dia (ajuste manual da refeição > distribuição da Previsão de Macros, por nome ou posição). */
export function metaDaRefeicao(planejamento, peso, refeicao, indice) {
  const pl = planejamento || {};
  const dia = metasDoPlanejamento(pl, peso);
  if (!dia.meta_kcal) return null;
  let pct = refeicao.meta_pct;
  if (pct === null || pct === undefined || pct === "") {
    const dist = pl.distribuicao || [];
    const porNome = dist.find((x) => normalizar(x.nome) && normalizar(x.nome) === normalizar(refeicao.nome));
    pct = porNome ? porNome.pct : dist[indice]?.pct;
  }
  pct = num(pct);
  if (!pct) return null;
  const f = pct / 100;
  return {
    pct, kcal: dia.meta_kcal * f,
    cho: dia.meta_carboidrato_g != null ? dia.meta_carboidrato_g * f : null,
    ptn: dia.meta_proteina_g != null ? dia.meta_proteina_g * f : null,
    lip: dia.meta_lipidio_g != null ? dia.meta_lipidio_g * f : null,
  };
}

/** Situação da refeição: verde dentro de ±5% da meta, laranja quando falta, vermelho quando passa. */
export function situacaoMeta(total, meta) {
  if (!meta?.kcal) return null;
  const dif = total - meta.kcal;
  if (Math.abs(dif) <= meta.kcal * 0.05) return { cor: "verde", texto: "meta atingida", barra: "bg-[#4ADE80]", txt: "text-[#4ADE80]" };
  if (dif < 0) return { cor: "laranja", texto: `faltam ${nf0.format(-dif)} kcal`, barra: "bg-rc-amber", txt: "text-rc-amber" };
  return { cor: "vermelho", texto: `passou ${nf0.format(dif)} kcal`, barra: "bg-rc-coral", txt: "text-rc-coral" };
}

/**
 * "Ajustar à meta": recalcula só os gramas dos alimentos marcados com ⇅ para fechar a meta da refeição.
 * Com metas de macro, minimiza a diferença de CHO, PTN e LIP (em kcal); sem elas, fecha só as kcal.
 * Arredonda para a medida caseira mais próxima (meias unidades) ou múltiplos de 5 g.
 */
export function ajustarAMeta(bloco, meta) {
  const itens = bloco.alimentos || [];
  const ajust = itens.map((it, i) => ({ it, i })).filter(({ it }) => it.ajustavel && it._m100 && it.alimento_id);
  if (!ajust.length || !meta?.kcal) return null;
  const fixos = itens.filter((it) => !(it.ajustavel && it._m100 && it.alimento_id)).map(macrosDoItem)
    .reduce((a, m) => ({ cho: a.cho + m.cho, ptn: a.ptn + m.ptn, lip: a.lip + m.lip, kcal: a.kcal + m.kcal }), { cho: 0, ptn: 0, lip: 0, kcal: 0 });
  const comMacros = meta.cho != null && meta.ptn != null && meta.lip != null;
  // linhas da conta: cada macro em kcal (4, 4, 9) ou só as kcal
  const eqs = comMacros
    ? [["cho", 4], ["ptn", 4], ["lip", 9]].map(([k, w]) => ({ alvo: meta[k] * w - fixos[k] * w, coef: ajust.map(({ it }) => (num(it._m100[k]) / 100) * w) }))
    : [{ alvo: meta.kcal - fixos.kcal, coef: ajust.map(({ it }) => (num(it._m100.cho) * 4 + num(it._m100.ptn) * 4 + num(it._m100.lip) * 9) / 100) }];
  const x = ajust.map(({ it }) => Math.max(0, num(it.quantidade_g)));
  for (let iter = 0; iter < 800; iter += 1) {
    for (let j = 0; j < x.length; j += 1) {
      let grad = 0; let h = 0;
      eqs.forEach((e) => {
        const r = e.coef.reduce((a, c, k) => a + c * x[k], 0) - e.alvo;
        grad += e.coef[j] * r;
        h += e.coef[j] * e.coef[j];
      });
      if (h > 0) x[j] = Math.max(0, x[j] - grad / h);
    }
  }
  const mudancas = [];
  const novos = itens.map((it) => ({ ...it }));
  ajust.forEach(({ it, i }, j) => {
    let g = x[j];
    let qtd;
    const gm = gramasDaMedida(it);
    if (!ehGramas(it.medida_nome) && gm) {
      qtd = Math.max(0.5, Math.round((g / gm) * 2) / 2);
      g = r1(qtd * gm);
    } else {
      g = Math.max(5, Math.round(g / 5) * 5);
      qtd = g;
    }
    const antes = num(it.quantidade_g);
    if (Math.abs(g - antes) >= 0.5) mudancas.push(`${it.nome || it.alimento_nome} ${nf0.format(antes)} → ${nf0.format(g)} g`);
    const subs = antes > 0 ? escalarSubstitutos(it.substitutos, g / antes) : it.substitutos;
    novos[i] = { ...it, quantidade: qtd, quantidade_g: g, substitutos: subs };
  });
  return { alimentos: novos, mudancas };
}

// ── Peças pequenas ─────────────────────────────────────────────────────────

function Menu({ rotulo, itens, testId }) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef(null);
  const listaRef = useRef(null);
  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (e) => { if (!ref.current?.contains(e.target) && !listaRef.current?.contains(e.target)) setAberto(false); };
    const esc = (e) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc); };
  }, [aberto]);
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label={rotulo} title={rotulo} aria-expanded={aberto} data-testid={testId} onClick={() => setAberto((v) => !v)}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:text-white hover:bg-white/[0.06]">
        <MoreHorizontal className="h-4 w-4" />
      </button>
      <Flutuante ancora={ref} aberto={aberto} largura={230} listaRef={listaRef} className="py-1">
        {itens.filter(Boolean).map((it) => (
          <button key={it.rotulo} type="button" disabled={it.disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { setAberto(false); it.acao(); }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] disabled:opacity-30 hover:bg-white/[0.06] ${it.perigo ? "text-rc-coral" : "text-gray-200"}`}>
            {it.icone && <it.icone className="h-4 w-4 shrink-0 text-gray-400" />}{it.rotulo}
          </button>
        ))}
      </Flutuante>
    </div>
  );
}

function Popover({ ancoraRef, aberto, onClose, largura = 320, children }) {
  const listaRef = useRef(null);
  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (e) => { if (!ancoraRef.current?.contains(e.target) && !listaRef.current?.contains(e.target)) onClose(); };
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc); };
  }, [aberto, ancoraRef, onClose]);
  return <Flutuante ancora={ancoraRef} aberto={aberto} largura={largura} listaRef={listaRef} className="p-3">{children}</Flutuante>;
}

/** Busca de alimento: favoritos e recentes primeiro; Enter escolhe; texto livre é permitido (sem cálculo). */
function BuscaAlimento({ id, item, tabelas, favoritos, onFavoritar, onTexto, onEscolher, onEnterLivre }) {
  const [itens, setItens] = useState([]);
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const [carregando, setCarregando] = useState(false);
  const [situacao, setSituacao] = useState(null);
  const ref = useRef(null);
  const listaRef = useRef(null);
  const texto = item.nome || "";
  const nomeEscolhido = item.alimento_nome || "";
  const q = texto.trim();
  const buscando = aberto && q !== nomeEscolhido;

  useEffect(() => {
    if (!buscando || q.length < 2) { setItens([]); setSituacao(null); setCarregando(false); return undefined; }
    const controle = new AbortController();
    const t = setTimeout(async () => {
      setCarregando(true); setSituacao(null);
      try {
        const { data } = await api.get("/alimentos", { params: { q, limit: 12, ordenar: "relevancia", tabelas }, signal: controle.signal, timeout: 20000 });
        const lista = data.items || [];
        setItens(lista); setAtivo(0); setSituacao(lista.length ? null : "vazio"); setCarregando(false);
      } catch {
        if (controle.signal.aborted) return;
        setItens([]); setSituacao("erro"); setCarregando(false);
      }
    }, 250);
    return () => { clearTimeout(t); controle.abort(); };
  }, [q, buscando, tabelas]);

  useEffect(() => {
    const fora = (e) => { if (!ref.current?.contains(e.target) && !listaRef.current?.contains(e.target)) setAberto(false); };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, []);

  const casa = (f) => !q || normalizar(f.nome).includes(normalizar(q));
  const favs = buscando ? (favoritos || []).filter(casa).slice(0, 5) : [];
  const idsFav = new Set((favoritos || []).map((f) => f.id));
  const recs = buscando ? lerRecentes().filter((f) => casa(f) && !idsFav.has(f.id)).slice(0, 4) : [];
  const vistos = new Set([...favs, ...recs].map((f) => f.id));
  const resultados = itens.filter((f) => !vistos.has(f.id));
  const opcoes = [...favs.map((f) => ({ f, sec: "fav" })), ...recs.map((f) => ({ f, sec: "rec" })), ...resultados.map((f) => ({ f, sec: "res" }))];
  const visivel = buscando && (opcoes.length > 0 || carregando || !!situacao);
  const escolher = (food) => { setAberto(false); setItens([]); guardarRecente(food); onEscolher(food); };

  const Linha = ({ o, idx }) => (
    <div className={`flex items-center ${idx === ativo ? "bg-rc-blue/20" : ""}`}>
      <button type="button" role="option" aria-selected={idx === ativo} onMouseEnter={() => setAtivo(idx)}
        onMouseDown={(e) => { e.preventDefault(); escolher(o.f); }}
        className="flex-1 min-w-0 flex items-center justify-between gap-3 px-3 py-1.5 text-left">
        <span className="min-w-0">
          <span className="block text-[13px] text-gray-100 truncate">{o.f.nome}</span>
          <span className="block text-[10.5px] text-gray-500 truncate">{o.f.grupo_display || "—"}{o.f.fonte ? ` · ${o.f.fonte}` : ""}</span>
        </span>
        <span className="shrink-0 tabular text-[11px] text-gray-400">{nf0.format(o.f.energia_kcal_100g || o.f.macros_100g?.kcal || 0)} kcal/100 g</span>
      </button>
      {onFavoritar && (
        <button type="button" aria-label={idsFav.has(o.f.id) ? `Tirar ${o.f.nome} dos favoritos` : `Favoritar ${o.f.nome}`}
          onMouseDown={(e) => { e.preventDefault(); onFavoritar(snapshot(o.f)); }}
          className={`px-2.5 py-1.5 ${idsFav.has(o.f.id) ? "text-rc-lime" : "text-gray-600 hover:text-gray-300"}`}>
          <Star className={`h-3.5 w-3.5 ${idsFav.has(o.f.id) ? "fill-current" : ""}`} />
        </button>
      )}
    </div>
  );
  let idx = -1;
  const secao = (sec, titulo) => {
    const lista = opcoes.filter((o) => o.sec === sec);
    if (!lista.length) return null;
    return (
      <div key={sec}>
        <div className={`px-3 pt-2 pb-1 text-[10.5px] uppercase tracking-[0.14em] ${sec === "fav" ? "text-rc-lime" : "text-gray-500"}`}>{titulo}</div>
        {lista.map((o) => { idx += 1; return <Linha key={`${sec}-${o.f.id}`} o={o} idx={idx} />; })}
      </div>
    );
  };

  return (
    <div ref={ref} className="relative min-w-0">
      <input id={id} value={texto} placeholder="Digite o alimento" autoComplete="off" role="combobox" aria-label="Alimento" aria-expanded={visivel}
        title={!item.alimento_id && texto ? "Alimento sem cadastro: não entra no cálculo" : texto}
        className={`w-full h-8 bg-transparent border-0 border-b border-transparent px-0 text-[13.5px] outline-none focus:border-rc-blue ${item.alimento_id ? "text-gray-100" : texto ? "text-rc-amber" : "text-gray-100"}`}
        onFocus={() => setAberto(true)}
        onChange={(e) => { onTexto(e.target.value); setAberto(true); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && opcoes.length) { e.preventDefault(); setAtivo((i) => Math.min(i + 1, opcoes.length - 1)); }
          if (e.key === "ArrowUp" && opcoes.length) { e.preventDefault(); setAtivo((i) => Math.max(i - 1, 0)); }
          if (e.key === "Escape") setAberto(false);
          if (e.key === "Enter") {
            e.preventDefault();
            if (visivel && opcoes[ativo]) escolher(opcoes[ativo].f);
            else { setAberto(false); onEnterLivre(); }
          }
        }} />
      <Flutuante ancora={ref} aberto={visivel} largura={Math.min(500, window.innerWidth - 16)} listaRef={listaRef}>
        <div role="listbox">
          {secao("fav", "★ Favoritos")}
          {secao("rec", "Recentes")}
          {(favs.length > 0 || recs.length > 0) && resultados.length > 0 && <div className="px-3 pt-2 pb-1 text-[10.5px] uppercase tracking-[0.14em] text-gray-500">Base de alimentos</div>}
          {opcoes.filter((o) => o.sec === "res").map((o) => { idx += 1; return <Linha key={`res-${o.f.id}`} o={o} idx={idx} />; })}
          {carregando && !resultados.length && <div className="px-3 py-3 text-[12.5px] text-gray-400 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" />Buscando…</div>}
          {!carregando && situacao === "vazio" && !favs.length && !recs.length && <div className="px-3 py-3 text-[12.5px] text-gray-400">Nenhum alimento encontrado. Enter mantém “{q}” como texto livre (sem cálculo).</div>}
          {!carregando && situacao === "erro" && <div className="px-3 py-3 text-[12.5px] text-rc-coral">Não foi possível buscar agora. Continue digitando para tentar de novo.</div>}
        </div>
      </Flutuante>
    </div>
  );
}

function abreviar(medida, qtd) {
  const t = textoMedida(medida, qtd);
  return t.replace(/^unidades?\b/, "unid.").replace(/^colher(es)? de sopa/, "col. sopa").replace(/^colher(es)? de chá/, "col. chá")
    .replace(/^colher(es)? de arroz/, "col. arroz").replace(/^colher(es)? de sobremesa/, "col. sobrem.");
}

// ── Linha de alimento ──────────────────────────────────────────────────────

function LinhaAlimento({ bk, i, item, ultima, config, favoritos, onFavoritar, onChange, onInserir, onRemover, onMover, onEquivalentes, onArrastar, modoRecordatorio }) {
  const m = macrosDoItem(item);
  const grupos = useContext(GruposContext);
  const grupo = grupoDoItem(grupos, item);
  const tolerancia = num(grupo?.tolerancia_pct || 10);
  const [trocaAberta, setTrocaAberta] = useState(false);
  const trocaRef = useRef(null);
  const medidas = useMemo(() => {
    const lista = item._medidas?.length ? item._medidas : [{ nome: "Gramas", gramas: 1 }];
    if (!item.medida_nome || lista.some((x) => x.nome === item.medida_nome)) return lista;
    return [...lista, { nome: item.medida_nome, gramas: null }];
  }, [item._medidas, item.medida_nome]);
  const temCalculo = !!item.alimento_id;
  const [obsAberta, setObsAberta] = useState(false);
  const [subsAberto, setSubsAberto] = useState(false);
  const obsRef = useRef(null);
  const subsRef = useRef(null);

  const aplicar = (patch) => {
    const antes = num(item.quantidade_g);
    const depois = num(patch.quantidade_g ?? item.quantidade_g);
    const subs = antes > 0 && depois > 0 && antes !== depois ? escalarSubstitutos(item.substitutos, depois / antes) : item.substitutos;
    onChange({ ...patch, substitutos: subs });
  };
  const setQtd = (v) => {
    const g = gramasDaMedida(item);
    aplicar({ quantidade: v, quantidade_g: g != null ? r1(num(v) * g) : item.quantidade_g });
  };
  const setMedida = (nome) => {
    if (ehGramas(nome)) { aplicar({ medida_nome: "Gramas", quantidade: item.quantidade_g }); focar(`${bk}-${i}-g`); return; }
    const md = medidas.find((x) => x.nome === nome);
    const q = num(item.quantidade) && !ehGramas(item.medida_nome) ? num(item.quantidade) : 1;
    aplicar({ medida_nome: nome, quantidade: q, quantidade_g: md?.gramas ? r1(q * num(md.gramas)) : item.quantidade_g });
  };
  const setGramas = (v) => aplicar({ quantidade_g: v, ...(ehGramas(item.medida_nome) ? { quantidade: v } : {}) });
  const enter = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (ultima) onInserir(); else focar(`${bk}-${i + 1}-nome`);
  };
  const escolherAlimento = async (food) => {
    const { medidas: medidasFood, grupo: grupoId } = await carregarAlimentoInfo(food.id);
    const base = { alimento_id: food.id, nome: food.nome, alimento_nome: food.nome, _m100: food.macros_100g, _medidas: medidasFood, _grupo: grupoId, substitutos: [] };
    const md = config.forma_calculo === "gramas" ? null : medidaPadrao(medidasFood);
    const novo = md ? { ...base, medida_nome: md.nome, quantidade: 1, quantidade_g: r1(md.gramas) } : { ...base, medida_nome: "Gramas", quantidade: "", quantidade_g: "" };
    // item 10: "OU" já preenchidos com as opções do grupo na porção equivalente
    if (!modoRecordatorio && config.equivalentes_automaticos !== false && md) {
      novo.substitutos = substitutosDoGrupo(grupoDoItem(grupos, novo, grupoId), novo);
    }
    onChange(novo);
    focar(`${bk}-${i}-${md ? "qtd" : "g"}`);
  };
  const setGramasComSubs = (v) => {
    // sem medida caseira, os "OU" automáticos nascem quando os gramas são informados
    if (!modoRecordatorio && config.equivalentes_automaticos !== false && !(item.substitutos || []).length && grupo && num(v) > 0) {
      const patch = { quantidade_g: v, ...(ehGramas(item.medida_nome) ? { quantidade: v } : {}) };
      onChange({ ...patch, substitutos: substitutosDoGrupo(grupo, { ...item, ...patch }) });
      return;
    }
    setGramas(v);
  };
  const trocar = (opcao) => {
    const novo = trocarPorOpcao(item, grupo, opcao);
    setTrocaAberta(false);
    if (!novo) return;
    onChange(novo);
    toast.success(`${item.nome} → ${novo.nome} ${textoQuantidade(novo)}`);
  };
  const alvoTroca = grupo && trocaAberta ? valorCriterio(item._m100, item.quantidade_g, grupo.criterio) : 0;
  const foraTol = (sub) => sub.desvio_pct != null && Math.abs(num(sub.desvio_pct)) > tolerancia;
  const vazio = !item.alimento_id && !(item.nome || "").trim();
  const nSubs = (item.substitutos || []).length;

  return (
    <div className={`group ${COLS} px-2 py-1 rounded-lg ${item.ajustavel ? "bg-rc-lime/[0.05]" : "hover:bg-white/[0.025]"}`} data-testid={`${bk}-linha-${i}`}>
      <div className="flex items-center">
        <span draggable={!vazio} onDragStart={(e) => onArrastar(e)} title="Arraste para outra refeição (Ctrl = copiar)"
          className={`text-gray-600 ${vazio ? "opacity-0" : "cursor-grab hover:text-gray-300"}`}><GripVertical className="h-4 w-4" /></span>
        {!modoRecordatorio && (
          <button type="button" aria-pressed={!!item.ajustavel} aria-label={item.ajustavel ? "Não ajustar este alimento" : "Marcar como ajustável (⇅)"}
            title="Ajustável: o botão Ajustar à meta recalcula os gramas" disabled={!temCalculo}
            onClick={() => onChange({ ajustavel: !item.ajustavel })}
            className={`h-6 w-5 inline-flex items-center justify-center rounded ${item.ajustavel ? "text-rc-lime" : "text-gray-600 hover:text-gray-300 disabled:opacity-20"}`}>
            <ArrowUpDown className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <BuscaAlimento id={`${bk}-${i}-nome`} item={item} tabelas={(config.tabelas_alimentos || []).join(",")} favoritos={favoritos} onFavoritar={onFavoritar}
        onTexto={(t) => onChange({ nome: t })} onEscolher={escolherAlimento}
        onEnterLivre={() => focar(`${bk}-${i}-${temCalculo && !ehGramas(item.medida_nome) ? "qtd" : "g"}`)} />
      {/* quantidade + medida + gramas numa célula só: "3 unid. · 150 g" */}
      <div className={`flex items-center gap-1 text-[13px] ${temCalculo ? "" : "opacity-40"}`}>
        {!ehGramas(item.medida_nome) && (
          <input id={`${bk}-${i}-qtd`} inputMode="decimal" aria-label="Quantidade da medida caseira" disabled={!temCalculo}
            className="w-11 h-8 rounded-md bg-black/20 px-1.5 text-center tabular outline-none focus:ring-1 focus:ring-rc-blue"
            value={item.quantidade ?? ""} onFocus={(e) => e.target.select()} onChange={(e) => setQtd(e.target.value)} onKeyDown={enter} />
        )}
        <div className="relative min-w-0 flex-1">
          <select aria-label="Medida caseira" disabled={!temCalculo} value={ehGramas(item.medida_nome) ? "Gramas" : item.medida_nome} onChange={(e) => setMedida(e.target.value)}
            className="w-full h-8 appearance-none rounded-md bg-transparent pl-1 pr-5 text-[13px] text-gray-300 outline-none hover:bg-white/[0.04] focus:ring-1 focus:ring-rc-blue truncate">
            {medidas.map((md) => (
              <option key={md.nome} value={md.nome}>
                {ehGramas(md.nome) ? "gramas" : abreviar(md.nome, item.medida_nome === md.nome ? item.quantidade : 1)}{md.gramas && !ehGramas(md.nome) ? ` (${md.estimada ? "≈" : ""}${nf.format(md.gramas)} g)` : ""}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-600" />
        </div>
        <span className="text-gray-600">·</span>
        <div className="relative">
          <input id={`${bk}-${i}-g`} inputMode="decimal" aria-label="Gramas" disabled={!temCalculo}
            className="w-[62px] h-8 rounded-md bg-black/20 pl-1.5 pr-5 text-right tabular outline-none focus:ring-1 focus:ring-rc-blue"
            value={item.quantidade_g ?? ""} onFocus={(e) => e.target.select()} onChange={(e) => setGramasComSubs(e.target.value)} onKeyDown={enter} />
          <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10.5px] text-gray-500">g</span>
        </div>
      </div>
      <span className="text-right tabular text-[13.5px] font-semibold text-white">{m.kcal ? nf0.format(m.kcal) : ""}</span>
      <span className="text-right tabular text-[13px] text-gray-300">{m.kcal ? nf.format(m.cho) : ""}</span>
      <span className="text-right tabular text-[13px] text-gray-300">{m.kcal ? nf.format(m.ptn) : ""}</span>
      <span className="text-right tabular text-[13px] text-gray-300">{m.kcal ? nf.format(m.lip) : ""}</span>
      <div className="flex items-center justify-end gap-1">
        {nSubs > 0 && (
          <span ref={subsRef}>
            <button type="button" onClick={() => setSubsAberto((v) => !v)} data-testid={`${bk}-${i}-subs`}
              title={item.substitutos.some(foraTol) ? `Alguma troca passa de ±${tolerancia}% do critério do grupo` : undefined}
              className={`h-6 px-2 rounded-full text-[11.5px] font-semibold whitespace-nowrap ${item.substitutos.some(foraTol) ? "bg-rc-amber/[0.15] text-rc-amber" : "bg-rc-lime/[0.12] text-rc-lime"}`}>{nSubs} subst.</button>
            <Popover ancoraRef={subsRef} aberto={subsAberto} onClose={() => setSubsAberto(false)} largura={360}>
              <div className="text-[11px] uppercase tracking-[0.12em] text-gray-500 mb-2">Substituições de {item.nome}</div>
              <ul className="space-y-1">
                {item.substitutos.map((s, k) => (
                  <li key={`${s.alimento_id}-${k}`} className="flex items-center gap-2 text-[13px]">
                    <span className="text-rc-lime font-bold text-[11px]">OU</span>
                    <span className="flex-1 min-w-0 truncate text-gray-100">{s.nome}</span>
                    <span className="tabular text-gray-400 shrink-0">{textoQuantidade(s)}</span>
                    {s.desvio_pct != null && Math.abs(num(s.desvio_pct)) >= 0.5 && (
                      <span className={`shrink-0 tabular text-[11px] font-semibold px-1.5 rounded ${foraTol(s) ? "bg-rc-amber/15 text-rc-amber" : "text-gray-500"}`} title={foraTol(s) ? `Fora da tolerância de ±${tolerancia}%` : "Dentro da tolerância"}>
                        {num(s.desvio_pct) > 0 ? "+" : ""}{nf.format(s.desvio_pct)}%
                      </span>
                    )}
                    <button type="button" aria-label={`Remover ${s.nome}`} onClick={() => onChange({ substitutos: item.substitutos.filter((_, x) => x !== k) })} className="text-gray-500 hover:text-white"><X className="h-3.5 w-3.5" /></button>
                  </li>
                ))}
              </ul>
              {onEquivalentes && <button type="button" onClick={() => { setSubsAberto(false); onEquivalentes(); }} className="mt-3 text-[12.5px] text-rc-blue hover:underline">Adicionar equivalentes…</button>}
            </Popover>
          </span>
        )}
        {!modoRecordatorio && grupo && temCalculo && (
          <span ref={trocaRef}>
            <button type="button" onClick={() => setTrocaAberta((v) => !v)} aria-label={`Trocar ${item.nome} por outro do grupo ${grupo.nome}`} title={`Trocar por outro de ${grupo.nome} (mantém a meta)`}
              data-testid={`${bk}-${i}-trocar`} className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-white/[0.08] text-gray-400 hover:text-white">
              <ArrowLeftRight className="h-3.5 w-3.5" />
            </button>
            <Popover ancoraRef={trocaRef} aberto={trocaAberta} onClose={() => setTrocaAberta(false)} largura={380}>
              <div className="text-[11px] uppercase tracking-[0.12em] text-gray-500 mb-2">Trocar por · {grupo.nome} <span className="normal-case tracking-normal">(mesmos {nf.format(alvoTroca)} {ROTULO_CRITERIO[grupo.criterio]})</span></div>
              <ul className="space-y-0.5">
                {opcoesDoGrupo(grupo).filter((o) => String(o.alimento_id) !== String(item.alimento_id)).map((o) => {
                  const p = porcaoEquivalente(grupo, o, alvoTroca);
                  return p && (
                    <li key={o.alimento_id}>
                      <button type="button" onClick={() => trocar(o)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-[13px] hover:bg-white/[0.06]">
                        <span className="flex-1 min-w-0 truncate text-gray-100">{o.nome}</span>
                        <span className="tabular text-gray-400 shrink-0">{textoQuantidade(p)}</span>
                        {p.fora && <span className="shrink-0 text-[11px] font-semibold text-rc-amber">{p.desvio_pct > 0 ? "+" : ""}{nf.format(p.desvio_pct)}%</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Popover>
          </span>
        )}
        <span ref={obsRef}>
          <button type="button" onClick={() => setObsAberta((v) => !v)} aria-label={item.observacao ? `Observação: ${item.observacao}` : "Adicionar observação"}
            title={item.observacao || "Observação do alimento"}
            className={`h-7 w-7 inline-flex items-center justify-center rounded-md border ${item.observacao ? "border-rc-lime/60 text-rc-lime" : "border-white/[0.08] text-gray-600 hover:text-gray-300"}`}>
            <MessageSquareText className="h-3.5 w-3.5" />
          </button>
          <Popover ancoraRef={obsRef} aberto={obsAberta} onClose={() => setObsAberta(false)} largura={340}>
            <label className="text-[11px] uppercase tracking-[0.12em] text-gray-500" htmlFor={`${bk}-${i}-obs`}>Observação do alimento</label>
            <Combobox id={`${bk}-${i}-obs`} value={item.observacao || ""} onChange={(v) => onChange({ observacao: v })} opcoes={config.observacoes_alimento || []}
              placeholder="Ex.: ou Grupo de Frutas" inputClassName="rc-input h-9 mt-1.5 text-[13px]" autoFocus onEnter={() => setObsAberta(false)} />
          </Popover>
        </span>
        <Menu rotulo="Ações do alimento" testId={`${bk}-${i}-menu`} itens={[
          { rotulo: "Inserir alimento abaixo", icone: Plus, acao: onInserir },
          onEquivalentes && temCalculo && { rotulo: "Equivalentes / trocar (⇄)", icone: ArrowLeftRight, acao: onEquivalentes },
          { rotulo: "Mover para cima", icone: ArrowUp, acao: () => onMover(-1) },
          { rotulo: "Mover para baixo", icone: ArrowDown, acao: () => onMover(1) },
          { rotulo: "Remover alimento", icone: Trash2, acao: onRemover, perigo: true },
        ]} />
      </div>
    </div>
  );
}

// ── Bloco de alimentos (refeição ou opção OU) ──────────────────────────────

function CabecalhoColunas() {
  return (
    <div className={`${COLS} px-2 pt-1 pb-1 text-[10.5px] uppercase tracking-[0.1em] text-gray-500`}>
      <span />
      <span>Alimento</span>
      <span>Quantidade</span>
      <span className="text-right">Kcal</span>
      <span className={`text-right ${COR.cho}`}>CHO</span>
      <span className={`text-right ${COR.ptn}`}>PTN</span>
      <span className={`text-right ${COR.lip}`}>LIP</span>
      <span />
    </div>
  );
}

function Itens({ bk, bloco, config, favoritos, onFavoritar, onChange, onEquivalentes, onArrastar, modoRecordatorio }) {
  const alimentos = bloco.alimentos?.length ? bloco.alimentos : [novoItem()];
  const set = (lista) => onChange({ ...bloco, alimentos: lista });
  const atualizar = (i, patch) => set(alimentos.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  const inserir = (i) => { set([...alimentos.slice(0, i + 1), novoItem(), ...alimentos.slice(i + 1)]); focar(`${bk}-${i + 1}-nome`); };
  const remover = (i) => {
    const it = alimentos[i];
    if ((it.alimento_id || it.nome) && !window.confirm(`Remover o alimento "${it.nome || it.alimento_nome}"?`)) return;
    const lista = alimentos.filter((_, k) => k !== i);
    set(lista.length ? lista : [novoItem()]);
  };
  const mover = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= alimentos.length) return;
    const lista = [...alimentos];
    [lista[i], lista[j]] = [lista[j], lista[i]];
    set(lista);
  };
  return alimentos.map((item, i) => (
    <LinhaAlimento key={`${bk}-${i}`} bk={bk} i={i} item={item} ultima={i === alimentos.length - 1} config={config}
      favoritos={favoritos} onFavoritar={onFavoritar} modoRecordatorio={modoRecordatorio}
      onChange={(patch) => atualizar(i, patch)} onInserir={() => inserir(i)} onRemover={() => remover(i)} onMover={(d) => mover(i, d)}
      onEquivalentes={onEquivalentes ? () => onEquivalentes(i, item) : null} onArrastar={(e) => onArrastar(e, i)} />
  ));
}

function LinhaTotal({ t, rotulo = "Total" }) {
  return (
    <div className={`${COLS} px-2 pt-2 mt-1 border-t border-white/[0.06] text-[13px]`}>
      <span />
      <span className="font-semibold uppercase tracking-[0.08em] text-gray-300 text-[12px]">{rotulo}</span>
      <span />
      <span className="text-right tabular font-bold text-rc-lime">{nf0.format(t.kcal)}</span>
      <span className="text-right tabular font-semibold text-white">{nf.format(t.cho)}</span>
      <span className="text-right tabular font-semibold text-white">{nf.format(t.ptn)}</span>
      <span className="text-right tabular font-semibold text-white">{nf.format(t.lip)}</span>
      <span />
    </div>
  );
}

// ── Refeição ───────────────────────────────────────────────────────────────

function Refeicao({
  i, r, total, config, modelos, meta, peso, favoritos, onFavoritar, onChange, onInserirRefeicao, onRemover, onMover, onDuplicar,
  onSalvarModelo, onEstatistica, onEquivalentes, onArrastar, onSoltar, modoRecordatorio,
}) {
  const bk = `r${i}`;
  const t = totaisBloco(r);
  const sit = modoRecordatorio ? null : situacaoMeta(t.kcal, meta);
  const [obs, setObs] = useState(!!r.observacao);
  const [modeloAberto, setModeloAberto] = useState(false);
  const [buscaModelo, setBuscaModelo] = useState("");
  const [editandoPct, setEditandoPct] = useState(false);
  const [solta, setSolta] = useState(false);
  useEffect(() => { if (r.observacao) setObs(true); }, [r.observacao]);
  const vazia = !(r.alimentos || []).some((a) => a.alimento_id || (a.nome || "").trim());
  const ajustaveis = (r.alimentos || []).some((a) => a.ajustavel && a.alimento_id);

  const aplicarModelo = (m) => {
    const alimentos = (m.alimentos || []).map(itemDoSalvo);
    onChange({ ...r, alimentos: alimentos.length ? alimentos : [novoItem()], observacao: m.observacao || r.observacao || "" });
    setModeloAberto(false); setBuscaModelo("");
    toast.success(`Modelo "${m.nome}" carregado.`);
  };
  const colar = () => {
    const copia = refeicaoCopiada();
    if (!copia) { toast.message("Não há refeição copiada para colar."); return; }
    if (!vazia && !window.confirm("Colar a refeição copiada? Os alimentos desta refeição serão substituídos.")) return;
    onChange({ ...r, alimentos: (copia.alimentos || []).length ? copia.alimentos : [novoItem()], observacao: copia.observacao || "", opcoes: copia.opcoes || [] });
  };
  const ajustar = () => {
    const res = ajustarAMeta(r, meta);
    if (!res) { toast.message("Marque com ⇅ os alimentos que podem mudar de quantidade."); return; }
    onChange({ ...r, alimentos: res.alimentos });
    toast.success(res.mudancas.length ? res.mudancas.join(" · ") : "A refeição já estava na meta.");
  };
  const setOpcao = (o, nova) => onChange({ ...r, opcoes: r.opcoes.map((op, k) => (k === o ? nova : op)) });
  const addOpcao = () => { onChange({ ...r, opcoes: [...(r.opcoes || []), { observacao: "", alimentos: [novoItem()] }] }); focar(`${bk}o${(r.opcoes || []).length}-0-nome`); };
  const removerOpcao = (o) => {
    if ((r.opcoes[o].alimentos || []).some((a) => a.alimento_id || a.nome) && !window.confirm("Remover esta opção da refeição?")) return;
    onChange({ ...r, opcoes: r.opcoes.filter((_, k) => k !== o) });
  };
  const ptnKg = num(peso) ? t.ptn / num(peso) : null;
  const [porcoesAberto, setPorcoesAberto] = useState(false);
  const aplicarPorcoes = (itens) => {
    const atuais = (r.alimentos || []).filter((a) => a.alimento_id || (a.nome || "").trim());
    onChange({ ...r, alimentos: [...atuais, ...itens] });
    setPorcoesAberto(false);
    toast.success(`${itens.length} ${itens.length === 1 ? "alimento adicionado" : "alimentos adicionados"} por porções.`);
  };

  return (
    <section className={`rounded-xl border ${solta ? "border-rc-blue bg-rc-blue/[0.04]" : "border-transparent"}`} data-testid={`refeicao-${i}`}
      onDragOver={(e) => { e.preventDefault(); setSolta(true); }} onDragLeave={() => setSolta(false)}
      onDrop={(e) => { setSolta(false); onSoltar(e, { r: i, o: null }); }}>
      <header className="px-2 pt-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Combobox id={`${bk}-nome`} value={r.nome || ""} onChange={(v) => onChange({ ...r, nome: v })} opcoes={config.nomes_refeicao || []} placeholder="NOME DA REFEIÇÃO"
            className="min-w-[160px] max-w-[280px]" inputClassName="h-8 w-full bg-transparent border-0 px-0 text-[16px] font-bold uppercase tracking-[0.02em] text-white outline-none focus:border-b focus:border-rc-blue"
            onEnter={() => focar(`${bk}-horario`)} onSelect={() => focar(`${bk}-horario`)} />
          <input id={`${bk}-horario`} value={r.horario || ""} placeholder="00:00" aria-label="Horário da refeição"
            onChange={(e) => onChange({ ...r, horario: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); focar(`${bk}-0-nome`); } }}
            className="w-[58px] h-8 bg-transparent text-[14px] tabular text-gray-400 outline-none focus:text-white" />
          {!modoRecordatorio && (editandoPct ? (
            <input autoFocus inputMode="decimal" defaultValue={meta?.pct ?? ""} aria-label="% do dia nesta refeição"
              className="w-20 h-7 rounded-full bg-white/[0.06] px-3 text-[12.5px] tabular outline-none ring-1 ring-rc-blue"
              onBlur={(e) => { const v = e.target.value.trim(); onChange({ ...r, meta_pct: v === "" ? null : num(v) }); setEditandoPct(false); }}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setEditandoPct(false); }} />
          ) : (
            <button type="button" onClick={() => setEditandoPct(true)} title="Mudar o % do dia desta refeição" data-testid={`${bk}-meta`}
              className="h-7 px-3 rounded-full bg-white/[0.06] text-[12.5px] font-medium text-gray-200 hover:bg-white/[0.1] tabular">
              {meta ? `${nf.format(meta.pct)}% · meta ${nf0.format(meta.kcal)} kcal` : "Definir % da meta"}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-3">
            <span className="tabular text-[14px]"><b className="text-white">{nf0.format(t.kcal)}</b>{meta && !modoRecordatorio && <span className="text-gray-500"> / {nf0.format(meta.kcal)}</span>}</span>
            {sit && <span className={`text-[12.5px] font-semibold ${sit.txt}`} data-testid={`${bk}-situacao`}>{sit.texto}</span>}
            <span className="text-[12px] tabular text-macro-ptn" title="Proteína da refeição">PTN {nf0.format(t.ptn)} g{ptnKg != null ? ` · ${nf.format(ptnKg)} g/kg` : ""}</span>
            <Menu rotulo="Ações da refeição" testId={`${bk}-acoes`} itens={[
              !modoRecordatorio && { rotulo: "Montar por porções", icone: Layers, acao: () => setPorcoesAberto(true) },
              { rotulo: "Adicionar opção (OU)", icone: Plus, acao: addOpcao },
              { rotulo: obs ? "Esconder observação" : "Observação da refeição", icone: MessageSquareText, acao: () => setObs((v) => !v) },
              { rotulo: "Carregar modelo de refeição", icone: BookOpen, acao: () => setModeloAberto(true) },
              onSalvarModelo && { rotulo: "Salvar como modelo de refeição", icone: Star, acao: () => onSalvarModelo(r) },
              { rotulo: "Copiar refeição", icone: Copy, acao: () => { if (copiarRefeicao(r)) toast.success("Refeição copiada."); } },
              { rotulo: "Colar refeição", icone: ClipboardPaste, acao: colar },
              { rotulo: "Duplicar refeição", icone: CopyPlus, acao: onDuplicar },
              onEstatistica && { rotulo: "Estatística da refeição", icone: PieChart, acao: () => onEstatistica(r) },
              { rotulo: "Mover refeição para cima", icone: ArrowUp, acao: () => onMover(-1), disabled: i === 0 },
              { rotulo: "Mover refeição para baixo", icone: ArrowDown, acao: () => onMover(1), disabled: i === total - 1 },
              { rotulo: "Adicionar refeição abaixo", icone: Plus, acao: onInserirRefeicao },
              { rotulo: "Remover refeição", icone: Trash2, acao: onRemover, perigo: true },
            ]} />
          </div>
        </div>
        {sit && (
          <div className="mt-2 h-1.5 rounded-full bg-white/[0.05] overflow-hidden" aria-hidden>
            <div className={`h-full rounded-full ${sit.barra} transition-[width] duration-300`} style={{ width: `${Math.min(100, (t.kcal / meta.kcal) * 100)}%` }} />
          </div>
        )}
      </header>
      {porcoesAberto && <PorcoesDialogo refeicaoNome={r.nome} meta={meta} onAplicar={aplicarPorcoes} onClose={() => setPorcoesAberto(false)} />}
      {modeloAberto && (
        <div className="px-2 pt-3 flex items-center gap-2 max-w-[560px]">
          <Combobox value={buscaModelo} onChange={setBuscaModelo} opcoes={modelos || []} rotulo={(m) => m.nome} valorDe={(m) => m.nome} onSelect={aplicarModelo} autoFocus className="flex-1"
            placeholder={modelos?.length ? "Modelo de refeição (digite ou escolha)" : "Nenhum modelo de refeição salvo"} inputClassName="rc-input h-9 text-[13px]" />
          <button type="button" className="evo-btn-ghost p-2" aria-label="Fechar" onClick={() => setModeloAberto(false)}><X className="h-4 w-4" /></button>
        </div>
      )}
      <div className="mt-2">
        <CabecalhoColunas />
        <Itens bk={bk} bloco={r} config={config} favoritos={favoritos} onFavoritar={onFavoritar} modoRecordatorio={modoRecordatorio}
          onChange={onChange} onEquivalentes={onEquivalentes ? (idx, item) => onEquivalentes({ r: i, o: null, indice: idx, item }) : null}
          onArrastar={(e, idx) => onArrastar(e, { r: i, o: null, indice: idx })} />
        {vazia && (modelos || []).length > 0 && (
          <div className="px-2 pt-2 pb-1">
            <div className="text-[10.5px] uppercase tracking-[0.14em] text-gray-500 mb-1.5">Modelos de refeição</div>
            <div className="flex flex-wrap gap-2">
              {(modelos || []).slice(0, 6).map((m) => (
                <button key={m.id} type="button" onClick={() => aplicarModelo(m)} className="h-8 px-3 rounded-lg border border-white/[0.08] text-[12.5px] text-gray-200 hover:border-rc-lime/50">{m.nome}</button>
              ))}
            </div>
          </div>
        )}
        {obs && (
          <div className="px-2 pt-2 flex items-center gap-2">
            <Combobox value={r.observacao || ""} onChange={(v) => onChange({ ...r, observacao: v })} opcoes={config.observacoes_refeicao || []}
              placeholder="Observação da refeição" inputClassName="rc-input h-9 text-[13px]" className="flex-1" />
            <button type="button" className="evo-btn-ghost p-2" aria-label="Remover observação" onClick={() => { onChange({ ...r, observacao: "" }); setObs(false); }}><X className="h-4 w-4" /></button>
          </div>
        )}
        <LinhaTotal t={t} />
        {(r.opcoes || []).map((op, o) => (
          <div key={`${bk}o${o}`} className="mt-3 ml-6 pl-3 border-l-2 border-rc-lime/30"
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.stopPropagation(); onSoltar(e, { r: i, o }); }}>
            <div className="flex items-center gap-2 px-2">
              <span className="text-[11px] font-black tracking-[0.2em] text-rc-lime">OU</span>
              <span className="text-[12px] text-gray-500">Opção {o + 1} para {r.nome || "a refeição"} (não entra no total do dia)</span>
              <button type="button" className="ml-auto evo-btn-ghost p-1.5" aria-label={`Remover opção ${o + 1}`} onClick={() => removerOpcao(o)}><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
            <Itens bk={`${bk}o${o}`} bloco={op} config={config} favoritos={favoritos} onFavoritar={onFavoritar} modoRecordatorio={modoRecordatorio}
              onChange={(nova) => setOpcao(o, nova)} onEquivalentes={onEquivalentes ? (idx, item) => onEquivalentes({ r: i, o, indice: idx, item }) : null}
              onArrastar={(e, idx) => onArrastar(e, { r: i, o, indice: idx })} />
            <LinhaTotal t={totaisBloco(op)} rotulo="Total da opção" />
          </div>
        ))}
        {!modoRecordatorio && ajustaveis && meta && (
          <div className="px-2 pt-3 flex flex-wrap items-center gap-3">
            <button type="button" onClick={ajustar} className="rc-btn-primary h-9" data-testid={`${bk}-ajustar`}><ArrowUpDown className="h-4 w-4" /> Ajustar à meta</button>
            <span className="text-[12px] text-gray-500">ajusta só os alimentos marcados com ⇅</span>
          </div>
        )}
      </div>
    </section>
  );
}

// ── Barra do total do dia ──────────────────────────────────────────────────

export function BarraTotal({ refeicoes, planejamento, peso, modoRecordatorio, onOutrasOpcoes, acoesExtras }) {
  const t = totaisDia(refeicoes);
  const dia = metasDoPlanejamento(planejamento || {}, peso);
  const temMeta = !!dia.meta_kcal;
  const [aberto, setAberto] = useState(false);
  const ref = useRef(null);
  const falta = (meta, v) => (meta != null ? meta - v : null);
  const sinal = (v) => `${v > 0 ? "+" : ""}${nf0.format(v)}`;
  const pctBarra = temMeta ? Math.min(100, (t.kcal / dia.meta_kcal) * 100) : 0;
  const sit = situacaoMeta(t.kcal, temMeta ? { kcal: dia.meta_kcal } : null);
  return (
    <div className="sticky top-[104px] md:top-12 z-10 -mx-1 px-4 py-3 rounded-xl bg-rc-surface/95 backdrop-blur-xl ring-1 ring-white/[0.06] shadow-[0_8px_24px_-12px_rgba(0,0,0,.6)]" data-testid="barra-total">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div>
          <div className="text-[10.5px] uppercase tracking-[0.16em] text-gray-500">{modoRecordatorio ? "Consumo do dia" : "Total da dieta"}</div>
          <div className="tabular"><b className="rc-num text-[24px] text-white">{nf0.format(t.kcal)}</b>{temMeta && <span className="text-gray-400 text-[13px]"> / {nf0.format(dia.meta_kcal)} kcal</span>}</div>
        </div>
        <div className="flex-1 min-w-[200px]">
          {temMeta && (
            <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
              <div className={`h-full rounded-full ${modoRecordatorio ? "bg-rc-blue" : sit?.cor === "vermelho" ? "bg-rc-coral" : "bg-rc-lime"} transition-[width] duration-300`} style={{ width: `${pctBarra}%` }} />
            </div>
          )}
          {temMeta && !modoRecordatorio && (
            <div className={`mt-1.5 text-[12.5px] tabular font-medium ${sit?.cor === "verde" ? "text-[#4ADE80]" : sit?.cor === "vermelho" ? "text-rc-coral" : "text-rc-amber"}`} data-testid="faltam-dia">
              {t.kcal < dia.meta_kcal
                ? `Faltam ${nf0.format(dia.meta_kcal - t.kcal)} kcal · P ${nf0.format(Math.max(0, falta(dia.meta_proteina_g, t.ptn) ?? 0))} g · C ${nf0.format(Math.max(0, falta(dia.meta_carboidrato_g, t.cho) ?? 0))} g · L ${nf0.format(Math.max(0, falta(dia.meta_lipidio_g, t.lip) ?? 0))} g`
                : `Passou ${nf0.format(t.kcal - dia.meta_kcal)} kcal da meta`}
            </div>
          )}
          {temMeta && modoRecordatorio && (
            <div className="mt-1.5 text-[12.5px] tabular text-gray-300" data-testid="consumia-meta">
              Consumia {nf0.format(t.kcal)} kcal · meta {nf0.format(dia.meta_kcal)} kcal ({sinal(dia.meta_kcal - t.kcal)})
              {dia.meta_proteina_g != null && ` · P ${nf0.format(t.ptn)}/${nf0.format(dia.meta_proteina_g)} g (${sinal(dia.meta_proteina_g - t.ptn)})`}
              {dia.meta_carboidrato_g != null && ` · C ${nf0.format(t.cho)}/${nf0.format(dia.meta_carboidrato_g)} g (${sinal(dia.meta_carboidrato_g - t.cho)})`}
              {dia.meta_lipidio_g != null && ` · L ${nf0.format(t.lip)}/${nf0.format(dia.meta_lipidio_g)} g (${sinal(dia.meta_lipidio_g - t.lip)})`}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 text-[12.5px] font-semibold tabular">
          <span className="h-7 px-3 inline-flex items-center rounded-full bg-macro-cho/15 text-macro-cho">CHO {nf0.format(t.cho)} g</span>
          <span className="h-7 px-3 inline-flex items-center rounded-full bg-macro-ptn/15 text-macro-ptn">PTN {nf0.format(t.ptn)} g</span>
          <span className="h-7 px-3 inline-flex items-center rounded-full bg-macro-lip/15 text-macro-lip">LIP {nf0.format(t.lip)} g</span>
        </div>
        <span ref={ref}>
          <button type="button" onClick={() => setAberto((v) => !v)} aria-expanded={aberto} className="text-[13px] text-gray-300 hover:text-white inline-flex items-center gap-1" data-testid="indicadores">
            Indicadores <ChevronDown className={`h-4 w-4 transition-transform ${aberto ? "rotate-180" : ""}`} />
          </button>
          <Popover ancoraRef={ref} aberto={aberto} onClose={() => setAberto(false)} largura={300}>
            <PainelTotais embutido refeicoes={refeicoes} peso={peso} planejamento={planejamento} onOutrasOpcoes={onOutrasOpcoes ? () => { setAberto(false); onOutrasOpcoes(); } : null} />
          </Popover>
        </span>
        {acoesExtras}
      </div>
    </div>
  );
}

// ── Editor ─────────────────────────────────────────────────────────────────

export default function EditorRefeicoes({
  refeicoes, onChange, config, modelos, planejamento, peso, favoritos, onFavoritar, onSalvarModelo, onEstatistica, modoRecordatorio = false, restricoes = [],
}) {
  const [equiv, setEquiv] = useState(null);
  const { grupos: gruposBase } = useGruposSubstituicao();
  // alergias e aversões do paciente tiram as opções das trocas automáticas e do ⇄
  const grupos = useMemo(() => gruposSemRestricoes(gruposBase, restricoes), [gruposBase, restricoes]);
  const removidas = grupos.flatMap((g) => g._removidas || []);
  const setRef = (i, nova) => onChange(refeicoes.map((r, k) => (k === i ? nova : r)));
  const blocoDe = ({ r, o }) => (o == null ? refeicoes[r] : refeicoes[r].opcoes[o]);
  const comBloco = (lista, { r, o }, fn) => lista.map((ref, k) => {
    if (k !== r) return ref;
    if (o == null) return fn(ref);
    return { ...ref, opcoes: ref.opcoes.map((op, x) => (x === o ? fn(op) : op)) };
  });

  const inserirRefeicao = (i) => { onChange([...refeicoes.slice(0, i + 1), novaRefeicao(), ...refeicoes.slice(i + 1)]); focar(`r${i + 1}-nome`); };
  const removerRefeicao = (i) => {
    const r = refeicoes[i];
    const tem = (r.alimentos || []).some((a) => a.alimento_id || a.nome) || (r.opcoes || []).length;
    if (tem && !window.confirm(`Remover a refeição "${r.nome || "sem nome"}" e suas opções?`)) return;
    const lista = refeicoes.filter((_, k) => k !== i);
    onChange(lista.length ? lista : [novaRefeicao()]);
  };
  const moverRefeicao = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= refeicoes.length) return;
    const lista = [...refeicoes];
    [lista[i], lista[j]] = [lista[j], lista[i]];
    onChange(lista);
  };
  const duplicarRefeicao = (i) => {
    const copia = JSON.parse(JSON.stringify(refeicoes[i]));
    copia.nome = `${refeicoes[i].nome || "Refeição"} (cópia)`;
    onChange([...refeicoes.slice(0, i + 1), copia, ...refeicoes.slice(i + 1)]);
    toast.success("Refeição duplicada.");
  };

  // arrastar alimentos entre refeições (Ctrl/Alt = copiar)
  const arrastar = (e, origem) => {
    e.dataTransfer.setData("application/x-rc-alimento", JSON.stringify(origem));
    e.dataTransfer.effectAllowed = "copyMove";
  };
  const soltar = (e, destino) => {
    const dado = e.dataTransfer.getData("application/x-rc-alimento");
    if (!dado) return;
    e.preventDefault();
    const origem = JSON.parse(dado);
    const copiar = e.ctrlKey || e.altKey;
    const item = blocoDe(origem).alimentos[origem.indice];
    if (!item) return;
    if (!copiar && origem.r === destino.r && origem.o === destino.o) return;
    let lista = refeicoes;
    if (!copiar) {
      lista = comBloco(lista, origem, (b) => {
        const restantes = b.alimentos.filter((_, k) => k !== origem.indice);
        return { ...b, alimentos: restantes.length ? restantes : [novoItem()] };
      });
    }
    lista = comBloco(lista, destino, (b) => {
      const atuais = (b.alimentos || []).filter((a) => a.alimento_id || (a.nome || "").trim());
      return { ...b, alimentos: [...atuais, JSON.parse(JSON.stringify(item))] };
    });
    onChange(lista);
    toast.success(`${item.nome || item.alimento_nome} ${copiar ? "copiado" : "movido"} para ${refeicoes[destino.r].nome || "a refeição"}.`);
  };

  const aplicarEquivalentes = (selecionados) => {
    const novos = selecionados.map((e) => ({
      alimento_id: e.alimento_id, nome: e.nome,
      medida_nome: e.medida ? e.medida.nome : "Gramas",
      quantidade: e.medida ? e.medida.quantidade : e.quantidade_g,
      quantidade_g: e.medida ? e.medida.gramas : e.quantidade_g,
    }));
    onChange(comBloco(refeicoes, equiv, (b) => ({ ...b, alimentos: b.alimentos.map((it, k) => (k === equiv.indice ? { ...it, substitutos: [...(it.substitutos || []), ...novos] } : it)) })));
    setEquiv(null);
  };
  const trocar = async (e) => {
    const antigo = blocoDe(equiv).alimentos[equiv.indice];
    const medidas = await carregarMedidas(e.alimento_id);
    const novo = {
      ...antigo, alimento_id: e.alimento_id, alimento_nome: e.nome, nome: e.nome, _m100: e.macros_100g, _medidas: medidas,
      medida_nome: e.medida ? e.medida.nome : "Gramas", quantidade: e.medida ? e.medida.quantidade : e.quantidade_g,
      quantidade_g: e.medida ? e.medida.gramas : e.quantidade_g,
      substitutos: [
        { alimento_id: antigo.alimento_id, nome: antigo.nome || antigo.alimento_nome, medida_nome: antigo.medida_nome, quantidade: antigo.quantidade, quantidade_g: antigo.quantidade_g },
        ...(antigo.substitutos || []).filter((s) => s.alimento_id !== e.alimento_id),
      ],
    };
    onChange(comBloco(refeicoes, equiv, (b) => ({ ...b, alimentos: b.alimentos.map((it, k) => (k === equiv.indice ? novo : it)) })));
    setEquiv(null);
  };

  return (
    <GruposContext.Provider value={grupos}>
    <div className="space-y-2" data-testid="editor-refeicoes">
      {!modoRecordatorio && removidas.length > 0 && (
        <p className="rounded-lg bg-rc-amber/10 px-3 py-2 text-[12px] text-rc-amber" data-testid="aviso-restricoes">
          Fora das trocas por alergia ou aversão do paciente: {removidas.join(", ")}.
        </p>
      )}
      {equiv && (
        <EquivalentesModal item={equiv.item} refeicaoNome={refeicoes[equiv.r]?.nome || "Refeição"} onAddSubstitutos={aplicarEquivalentes} onTrocar={trocar} onClose={() => setEquiv(null)} />
      )}
      {refeicoes.map((r, i) => (
        <div key={`r${i}`} className={i ? "pt-3 border-t border-white/[0.06]" : ""}>
          <Refeicao i={i} r={r} total={refeicoes.length} config={config} modelos={modelos} peso={peso}
            meta={modoRecordatorio ? null : metaDaRefeicao(planejamento, peso, r, i)}
            favoritos={favoritos} onFavoritar={onFavoritar} modoRecordatorio={modoRecordatorio}
            onChange={(nova) => setRef(i, nova)} onInserirRefeicao={() => inserirRefeicao(i)} onRemover={() => removerRefeicao(i)}
            onMover={(d) => moverRefeicao(i, d)} onDuplicar={() => duplicarRefeicao(i)}
            onSalvarModelo={onSalvarModelo ? (b) => onSalvarModelo(b, r.nome) : null}
            onEstatistica={onEstatistica ? (b) => onEstatistica(b, r.nome || "Refeição") : null}
            onEquivalentes={modoRecordatorio ? null : setEquiv} onArrastar={arrastar} onSoltar={soltar} />
        </div>
      ))}
      <button type="button" onClick={() => inserirRefeicao(refeicoes.length - 1)} className="rc-btn-secondary h-9 mt-2"><Plus className="h-4 w-4" /> Adicionar refeição</button>
    </div>
    </GruposContext.Provider>
  );
}
