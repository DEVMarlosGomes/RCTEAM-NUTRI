import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight, BookOpen, ChevronDown, ChevronUp, ClipboardPaste, Copy, Loader2, MessageSquareText,
  MinusCircle, PieChart, PlusCircle, Star, X,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/evo-api";
import EquivalentesModal from "./EquivalentesModal";
import Combobox from "./Combobox";
import Flutuante from "./Flutuante";
import {
  copiarRefeicao, ehGramas, escalarSubstitutos, gramasDaMedida, itemDoSalvo, macrosDoItem, medidaPadrao,
  nf, nf0, novaRefeicao, novoItem, num, refeicaoCopiada, textoMedida, textoQuantidade, totaisBloco,
} from "./calculos";

// Colunas na ordem do NutriDiet: +/- | alimento | qtd | medida caseira | gramas | observacao | acoes | kcal cho ptn lip
const GRID = "grid grid-cols-[38px_minmax(150px,2fr)_44px_minmax(100px,1fr)_62px_minmax(80px,0.9fr)_66px_repeat(4,42px)] gap-1 items-center";
export const LARGURA_MIN_EDITOR = "min-w-[780px]";
const r1 = (v) => Math.round(num(v) * 10) / 10;

const focar = (id, selecionar = true) => {
  requestAnimationFrame(() => {
    const el = document.getElementById(id);
    if (el) { el.focus(); if (selecionar && el.select) el.select(); }
  });
};

async function carregarMedidas(alimentoId) {
  try {
    const { data } = await api.get(`/alimentos/${alimentoId}/medidas`);
    return data.medidas || [];
  } catch {
    return [{ nome: "Gramas", gramas: 1 }];
  }
}

function Icone({ titulo, onClick, children, ativo, perigo, disabled, className = "" }) {
  return (
    <button
      type="button"
      title={titulo}
      aria-label={titulo}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-7 w-[22px] shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-25 ${
        ativo ? "text-rc-lime bg-rc-lime/10" : perigo ? "text-gray-500 hover:text-rc-coral hover:bg-white/[0.05]" : "text-gray-400 hover:text-white hover:bg-white/[0.06]"
      } ${className}`}
    >
      {children}
    </button>
  );
}

function MaisMenos({ onMais, onMenos, tituloMais, tituloMenos }) {
  return (
    <div className="flex items-center gap-0.5">
      <button type="button" onClick={onMais} title={tituloMais} aria-label={tituloMais} className="text-gray-500 hover:text-rc-lime"><PlusCircle className="h-[17px] w-[17px]" strokeWidth={1.6} /></button>
      <button type="button" onClick={onMenos} title={tituloMenos} aria-label={tituloMenos} className="text-gray-500 hover:text-rc-coral"><MinusCircle className="h-[17px] w-[17px]" strokeWidth={1.6} /></button>
    </div>
  );
}

function Celula({ valor, casas = 1, sufixo = "", forte }) {
  const zero = !valor || Math.abs(valor) < 0.05;
  return (
    <div className={`h-8 rounded-md bg-black/20 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)] flex items-center justify-center text-[12px] tabular ${zero ? "text-gray-600" : forte ? "text-white font-semibold" : "text-gray-200"}`}>
      {casas === 0 ? nf0.format(valor || 0) : nf.format(valor || 0)}{!zero && sufixo}
    </div>
  );
}

/** Busca de alimento em linha. Texto livre e permitido (fica sem calculo, como no NutriDiet). */
function BuscaAlimento({ id, item, tabelas, onTexto, onEscolher, onEnterLivre }) {
  const [itens, setItens] = useState([]);
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const [carregando, setCarregando] = useState(false);
  const [situacao, setSituacao] = useState(null); // null | "vazio" | "erro"
  const ref = useRef(null);
  const listaRef = useRef(null);
  const texto = item.nome || "";
  const nomeEscolhido = item.alimento_nome || "";

  useEffect(() => {
    const q = texto.trim();
    if (!aberto || q.length < 2 || q === nomeEscolhido) { setItens([]); setSituacao(null); setCarregando(false); return undefined; }
    // cada tecla cancela a busca anterior; sem resposta em 20 s mostra erro em vez de girar para sempre
    const controle = new AbortController();
    const t = setTimeout(async () => {
      setCarregando(true);
      setSituacao(null);
      try {
        const { data } = await api.get("/alimentos", {
          params: { q, limit: 12, ordenar: "relevancia", tabelas }, signal: controle.signal, timeout: 20000,
        });
        const lista = data.items || [];
        setItens(lista);
        setAtivo(0);
        setSituacao(lista.length ? null : "vazio");
        setCarregando(false);
      } catch {
        if (controle.signal.aborted) return;
        setItens([]);
        setSituacao("erro");
        setCarregando(false);
      }
    }, 250);
    return () => { clearTimeout(t); controle.abort(); };
  }, [texto, aberto, nomeEscolhido, tabelas]);

  useEffect(() => {
    const fora = (e) => {
      if (ref.current?.contains(e.target) || listaRef.current?.contains(e.target)) return;
      setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, []);

  const escolher = (food) => { setAberto(false); setItens([]); onEscolher(food); };
  const visivel = aberto && (carregando || itens.length > 0 || !!situacao);

  return (
    <div ref={ref} className="relative min-w-0">
      <input
        id={id}
        className={`rc-input h-8 py-0 px-2.5 text-[13px] ${item.alimento_id ? "" : texto ? "text-rc-amber" : ""}`}
        value={texto}
        placeholder="Nome do alimento"
        autoComplete="off"
        title={!item.alimento_id && texto ? "Alimento sem cadastro: não entra no cálculo" : undefined}
        onFocus={() => setAberto(true)}
        onChange={(e) => { onTexto(e.target.value); setAberto(true); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && itens.length) { e.preventDefault(); setAtivo((i) => Math.min(i + 1, itens.length - 1)); }
          if (e.key === "ArrowUp" && itens.length) { e.preventDefault(); setAtivo((i) => Math.max(i - 1, 0)); }
          if (e.key === "Escape") setAberto(false);
          if (e.key === "Enter") {
            e.preventDefault();
            if (visivel && itens[ativo]) escolher(itens[ativo]);
            else { setAberto(false); onEnterLivre(); }
          }
        }}
        role="combobox"
        aria-label="Alimento"
        aria-expanded={visivel}
      />
      <Flutuante ancora={ref} aberto={visivel} largura={Math.min(480, window.innerWidth - 16)} listaRef={listaRef}>
        <div role="listbox">
          {carregando && !itens.length && <div className="px-3 py-3 text-[12.5px] text-gray-400 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" />Buscando…</div>}
          {!carregando && situacao === "vazio" && <div className="px-3 py-3 text-[12.5px] text-gray-400">Nenhum alimento encontrado. Enter mantém “{texto.trim()}” como texto livre (sem cálculo).</div>}
          {!carregando && situacao === "erro" && <div className="px-3 py-3 text-[12.5px] text-rc-coral">Não foi possível buscar agora. Continue digitando para tentar de novo.</div>}
          {itens.map((f, i) => (
            <button
              key={f.id}
              type="button"
              role="option"
              aria-selected={i === ativo}
              onMouseEnter={() => setAtivo(i)}
              onMouseDown={(e) => { e.preventDefault(); escolher(f); }}
              className={`w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left ${i === ativo ? "bg-rc-blue/20" : ""}`}
            >
              <span className="min-w-0">
                <span className="block text-[13px] text-gray-100 truncate">{f.nome}</span>
                <span className="block text-[10.5px] text-gray-500 truncate">{f.grupo_display || "—"} · {f.fonte || "base"}</span>
              </span>
              <span className="shrink-0 text-right tabular text-[11px] text-gray-400">{nf0.format(f.energia_kcal_100g || 0)} kcal/100 g</span>
            </button>
          ))}
        </div>
      </Flutuante>
    </div>
  );
}

function LinhaAlimento({ bk, i, item, ultima, config, onChange, onMais, onMenos, onSubir, onDescer, onEquivalentes, onEnterFinal }) {
  const m = macrosDoItem(item);
  const medidas = useMemo(() => {
    const lista = item._medidas?.length ? item._medidas : [{ nome: "Gramas", gramas: 1 }];
    if (!item.medida_nome || lista.some((x) => x.nome === item.medida_nome)) return lista;
    return [...lista, { nome: item.medida_nome, gramas: null }];
  }, [item._medidas, item.medida_nome]);
  const temCalculo = !!item.alimento_id;

  // Ao mudar as gramas, os substitutos acompanham na mesma proporcao.
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
    if (ehGramas(nome)) { aplicar({ medida_nome: "Gramas", quantidade: item.quantidade_g }); return; }
    const md = medidas.find((x) => x.nome === nome);
    const q = num(item.quantidade) && !ehGramas(item.medida_nome) ? num(item.quantidade) : 1;
    aplicar({ medida_nome: nome, quantidade: q, quantidade_g: md?.gramas ? r1(q * num(md.gramas)) : item.quantidade_g });
  };
  // Como no NutriDiet, editar as gramas nao muda a quantidade da medida caseira (ex.: 1 unidade grande = 130 g).
  const setGramas = (v) => aplicar({ quantidade_g: v, ...(ehGramas(item.medida_nome) ? { quantidade: v } : {}) });

  const enter = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (ultima) onEnterFinal(); else focar(`${bk}-${i + 1}-nome`);
  };

  const escolherAlimento = async (food) => {
    const medidasFood = await carregarMedidas(food.id);
    const base = {
      alimento_id: food.id, nome: food.nome, alimento_nome: food.nome, _m100: food.macros_100g, _medidas: medidasFood, substitutos: [],
    };
    const md = config.forma_calculo === "gramas" ? null : medidaPadrao(medidasFood);
    if (md) {
      onChange({ ...base, medida_nome: md.nome, quantidade: 1, quantidade_g: r1(md.gramas) });
      focar(`${bk}-${i}-qtd`);
    } else {
      onChange({ ...base, medida_nome: "Gramas", quantidade: "", quantidade_g: "" });
      focar(`${bk}-${i}-g`);
    }
  };

  return (
    <div className="py-[3px]">
      <div className={GRID}>
        <MaisMenos onMais={onMais} onMenos={onMenos} tituloMais="Adicionar alimento abaixo" tituloMenos="Remover alimento" />
        <BuscaAlimento tabelas={(config.tabelas_alimentos || []).join(",")}
          id={`${bk}-${i}-nome`}
          item={item}
          onTexto={(t) => onChange({ nome: t })}
          onEscolher={escolherAlimento}
          onEnterLivre={() => focar(`${bk}-${i}-${temCalculo && !ehGramas(item.medida_nome) ? "qtd" : "g"}`)}
        />
        <input
          id={`${bk}-${i}-qtd`}
          className="rc-input h-8 py-0 px-1.5 text-center text-[13px] tabular"
          inputMode="decimal"
          value={ehGramas(item.medida_nome) ? "" : item.quantidade ?? ""}
          placeholder={ehGramas(item.medida_nome) ? "–" : "0"}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setQtd(e.target.value)}
          onKeyDown={enter}
          aria-label="Quantidade da medida caseira"
          disabled={!temCalculo || ehGramas(item.medida_nome)}
        />
        <select
          className="rc-input h-8 py-0 px-2 text-[12.5px]"
          value={ehGramas(item.medida_nome) ? "Gramas" : item.medida_nome}
          onChange={(e) => setMedida(e.target.value)}
          aria-label="Medida caseira"
          disabled={!temCalculo}
        >
          {medidas.map((md) => (
            <option key={md.nome} value={md.nome}>
              {ehGramas(md.nome) ? "gramas" : textoMedida(md.nome, item.medida_nome === md.nome ? item.quantidade : 1)}{md.gramas && !ehGramas(md.nome) ? ` (${md.estimada ? "≈" : ""}${nf.format(md.gramas)} g)` : ""}
            </option>
          ))}
        </select>
        <div className="relative">
          <input
            id={`${bk}-${i}-g`}
            className="rc-input h-8 py-0 pl-2 pr-5 text-right text-[13px] tabular"
            inputMode="decimal"
            value={item.quantidade_g ?? ""}
            placeholder="0"
            onFocus={(e) => e.target.select()}
            onChange={(e) => setGramas(e.target.value)}
            onKeyDown={enter}
            aria-label="Gramas"
            disabled={!temCalculo}
          />
          <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10.5px] text-gray-500">g</span>
        </div>
        <Combobox
          value={item.observacao || ""}
          onChange={(v) => onChange({ observacao: v })}
          opcoes={config.observacoes_alimento || []}
          placeholder="Observação"
          inputClassName="rc-input h-8 py-0 px-2.5 text-[12.5px]"
          larguraLista="320px"
        />
        <div className="flex items-center">
          <Icone titulo="Mover abaixo" onClick={onDescer}><ChevronDown className="h-4 w-4" /></Icone>
          <Icone titulo="Mover acima" onClick={onSubir}><ChevronUp className="h-4 w-4" /></Icone>
          <Icone titulo="Lista de substituição (equivalentes)" onClick={onEquivalentes} disabled={!temCalculo || !onEquivalentes} ativo={item.substitutos?.length > 0}><ArrowLeftRight className="h-[15px] w-[15px]" /></Icone>
        </div>
        <Celula valor={m.kcal} casas={0} />
        <Celula valor={m.cho} sufixo="g" />
        <Celula valor={m.ptn} sufixo="g" />
        <Celula valor={m.lip} sufixo="g" />
      </div>
      {item.substitutos?.length > 0 && (
        <div className="grid grid-cols-[38px_1fr] gap-1 mt-1">
          <span />
          <div className="flex flex-wrap items-center gap-1.5">
            {item.substitutos.map((s, k) => (
              <span key={`${s.alimento_id}-${k}`} className="rc-chip bg-white/[0.05] text-gray-300">
                <span className="text-gray-500">ou</span>
                <span className="tabular">{textoQuantidade(s)}</span>
                <span className="max-w-[240px] truncate text-gray-100">{s.nome}</span>
                <button type="button" onClick={() => onChange({ substitutos: item.substitutos.filter((_, x) => x !== k) })} className="text-gray-500 hover:text-white" aria-label={`Remover ${s.nome}`}><X className="w-3 h-3" /></button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Linhas de alimentos + linha de total de um bloco (refeicao, opcao "OU", grupo da lista de substituicao). */
export function BlocoAlimentos({ bk, bloco, config, onChange, onEquivalentes, rodapeEsquerda }) {
  const alimentos = bloco.alimentos?.length ? bloco.alimentos : [novoItem()];
  const t = totaisBloco(bloco);
  const set = (lista) => onChange({ ...bloco, alimentos: lista });
  const atualizar = (i, patch) => set(alimentos.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  const inserir = (i) => {
    set([...alimentos.slice(0, i + 1), novoItem(), ...alimentos.slice(i + 1)]);
    focar(`${bk}-${i + 1}-nome`);
  };
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

  return (
    <div>
      {alimentos.map((item, i) => (
        <LinhaAlimento
          key={`${bk}-${i}`}
          bk={bk}
          i={i}
          item={item}
          ultima={i === alimentos.length - 1}
          config={config}
          onChange={(patch) => atualizar(i, patch)}
          onMais={() => inserir(i)}
          onMenos={() => remover(i)}
          onSubir={() => mover(i, -1)}
          onDescer={() => mover(i, 1)}
          onEquivalentes={onEquivalentes ? () => onEquivalentes(i, item) : null}
          onEnterFinal={() => inserir(i)}
        />
      ))}
      <div className={`${GRID} mt-1`}>
        <span />
        <div className="col-span-5 min-w-0">{rodapeEsquerda}</div>
        <span className="text-right text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-500 pr-1">Total</span>
        <Celula valor={t.kcal} casas={0} forte />
        <Celula valor={t.cho} sufixo="g" forte />
        <Celula valor={t.ptn} sufixo="g" forte />
        <Celula valor={t.lip} sufixo="g" forte />
      </div>
    </div>
  );
}

function CabecalhoColunas() {
  return (
    <>
      <span className="text-center text-[10.5px] font-semibold uppercase tracking-[0.08em] text-gray-500">Kcal</span>
      <span className="text-center text-[10.5px] font-semibold uppercase tracking-[0.08em] text-gray-500">CHO</span>
      <span className="text-center text-[10.5px] font-semibold uppercase tracking-[0.08em] text-gray-500">PTN</span>
      <span className="text-center text-[10.5px] font-semibold uppercase tracking-[0.08em] text-gray-500">LIP</span>
    </>
  );
}

/** Bloco de refeicao (principal ou opcao "OU") com a barra de acoes do NutriDiet. */
function BlocoRefeicao({
  bk, bloco, principal, indice, total, config, modelos, onChange, onMaisRefeicao, onMenos, onMover, onAddOpcao,
  onEstatistica, onSalvarModelo, onEquivalentes, tituloRefeicao,
}) {
  const [mostrarObs, setMostrarObs] = useState(!!bloco.observacao);
  const [carregarModelo, setCarregarModelo] = useState(false);
  const [buscaModelo, setBuscaModelo] = useState("");
  useEffect(() => { if (bloco.observacao) setMostrarObs(true); }, [bloco.observacao]);

  const colar = () => {
    const copia = refeicaoCopiada();
    if (!copia) { toast.message("Não há refeição copiada para colar."); return; }
    if (!window.confirm("Colar a refeição copiada? Os alimentos desta refeição serão substituídos.")) return;
    const alimentos = (copia.alimentos || []).length ? copia.alimentos : [novoItem()];
    if (principal) onChange({ ...bloco, alimentos, observacao: copia.observacao || "", opcoes: copia.opcoes || [] });
    else onChange({ ...bloco, alimentos, observacao: copia.observacao || "" });
  };

  const aplicarModelo = (modelo) => {
    const alimentos = (modelo.alimentos || []).map(itemDoSalvo);
    onChange({ ...bloco, alimentos: alimentos.length ? alimentos : [novoItem()], observacao: modelo.observacao || bloco.observacao || "" });
    setCarregarModelo(false);
    setBuscaModelo("");
    toast.success(`Modelo "${modelo.nome}" carregado.`);
  };

  return (
    <div>
      {!principal && <div className="pl-[42px] pt-1 pb-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-rc-lime">ou</div>}
      <div className={`${GRID} mb-1.5`}>
        <MaisMenos
          onMais={onMaisRefeicao}
          onMenos={onMenos}
          tituloMais="Adicionar refeição abaixo"
          tituloMenos={principal ? "Remover refeição" : "Remover opção"}
        />
        {principal ? (
          <Combobox
            id={`${bk}-nome`}
            value={bloco.nome || ""}
            onChange={(v) => onChange({ ...bloco, nome: v })}
            opcoes={config.nomes_refeicao || []}
            placeholder="Nome da refeição"
            inputClassName="rc-input h-8 py-0 px-2.5 text-[13px] font-semibold uppercase tracking-[0.03em]"
            onEnter={() => focar(`${bk}-horario`)}
            onSelect={() => focar(`${bk}-horario`)}
          />
        ) : <span className="text-[12px] text-gray-500 pl-1 truncate">Opção para {tituloRefeicao || "a refeição"}</span>}
        {principal ? (
          <input
            id={`${bk}-horario`}
            className="rc-input h-8 py-0 px-2 text-[13px] tabular col-span-2 max-w-[110px]"
            value={bloco.horario || ""}
            placeholder="Horário"
            onChange={(e) => onChange({ ...bloco, horario: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); focar(`${bk}-0-nome`); } }}
            aria-label="Horário da refeição"
          />
        ) : <span className="col-span-2" />}
        <div className="col-span-3 flex items-center flex-wrap">
          {principal && <Icone titulo="Mover refeição abaixo" onClick={() => onMover(1)} disabled={indice === total - 1}><ChevronDown className="h-4 w-4" /></Icone>}
          {principal && <Icone titulo="Mover refeição acima" onClick={() => onMover(-1)} disabled={indice === 0}><ChevronUp className="h-4 w-4" /></Icone>}
          <Icone titulo="Adicionar opção (OU) para comparar calorias e macronutrientes" onClick={onAddOpcao}>
            <span className="text-[10px] font-black tracking-tight">OU</span>
          </Icone>
          <Icone titulo="Observação da refeição" onClick={() => setMostrarObs((v) => !v)} ativo={mostrarObs}><MessageSquareText className="h-[15px] w-[15px]" /></Icone>
          <Icone titulo="Copiar refeição" onClick={() => { if (copiarRefeicao(bloco)) toast.success("Refeição copiada. Use Colar em qualquer refeição ou dieta."); }}><Copy className="h-[15px] w-[15px]" /></Icone>
          <Icone titulo="Colar refeição" onClick={colar}><ClipboardPaste className="h-[15px] w-[15px]" /></Icone>
          <Icone titulo="Salvar como modelo de refeição" onClick={() => onSalvarModelo(bloco)}><Star className="h-[15px] w-[15px]" /></Icone>
          {onEstatistica && <Icone titulo="Estatística da refeição (macros, vitaminas e minerais)" onClick={() => onEstatistica(bloco)}><PieChart className="h-[15px] w-[15px]" /></Icone>}
          <Icone titulo="Carregar modelo de refeição" onClick={() => setCarregarModelo((v) => !v)} ativo={carregarModelo}><BookOpen className="h-[15px] w-[15px]" /></Icone>
        </div>
        <CabecalhoColunas />
      </div>
      {carregarModelo && (
        <div className="grid grid-cols-[38px_1fr] gap-1 mb-2">
          <span />
          <div className="flex items-center gap-2 max-w-[520px]">
            <Combobox
              value={buscaModelo}
              onChange={setBuscaModelo}
              opcoes={modelos || []}
              rotulo={(m) => m.nome}
              valorDe={(m) => m.nome}
              onSelect={aplicarModelo}
              placeholder={modelos?.length ? "Modelo de refeição (digite ou escolha)" : "Nenhum modelo ainda — adicione os prontos em Padrões da dieta ou use a estrela"}
              inputClassName="rc-input h-8 py-0 px-2.5 text-[13px]"
              autoFocus
              className="flex-1"
              renderOpcao={(m) => (
                <span className="flex justify-between gap-3"><span className="truncate">{m.nome}</span><span className="text-gray-500 text-[11px] shrink-0">{(m.alimentos || []).length} alimentos</span></span>
              )}
            />
            <Icone titulo="Fechar" onClick={() => setCarregarModelo(false)}><X className="h-4 w-4" /></Icone>
          </div>
        </div>
      )}
      <BlocoAlimentos
        bk={bk}
        bloco={bloco}
        config={config}
        onChange={onChange}
        onEquivalentes={onEquivalentes}
        rodapeEsquerda={mostrarObs ? (
          <div className="flex items-center gap-1">
            <Combobox
              value={bloco.observacao || ""}
              onChange={(v) => onChange({ ...bloco, observacao: v })}
              opcoes={config.observacoes_refeicao || []}
              placeholder="Observação da refeição"
              inputClassName="rc-input h-8 py-0 px-2.5 text-[12.5px]"
              className="flex-1"
            />
            <Icone titulo="Remover observação" onClick={() => { onChange({ ...bloco, observacao: "" }); setMostrarObs(false); }} perigo><X className="h-4 w-4" /></Icone>
          </div>
        ) : null}
      />
    </div>
  );
}

/**
 * Editor de refeicoes no layout do NutriDiet: refeicoes com opcoes "OU", busca em linha,
 * medida caseira -> gramas, macros por linha/refeicao, copiar/colar, modelos e equivalentes.
 */
export default function EditorDieta({ refeicoes, onChange, config, modelos, onSalvarModelo, onEstatistica }) {
  const [equiv, setEquiv] = useState(null); // { r, o, indice, item }

  const setRef = (i, nova) => onChange(refeicoes.map((r, k) => (k === i ? nova : r)));
  const setOpcao = (i, o, nova) => setRef(i, { ...refeicoes[i], opcoes: refeicoes[i].opcoes.map((op, k) => (k === o ? nova : op)) });
  const blocoDe = ({ r, o }) => (o == null ? refeicoes[r] : refeicoes[r].opcoes[o]);
  const setBloco = ({ r, o }, novo) => (o == null ? setRef(r, novo) : setOpcao(r, o, novo));

  const inserirRefeicao = (i) => {
    onChange([...refeicoes.slice(0, i + 1), novaRefeicao(), ...refeicoes.slice(i + 1)]);
    focar(`r${i + 1}-nome`);
  };
  const removerRefeicao = (i) => {
    const r = refeicoes[i];
    const temConteudo = (r.alimentos || []).some((a) => a.alimento_id || a.nome) || (r.opcoes || []).length;
    if (temConteudo && !window.confirm(`Remover a refeição "${r.nome || "sem nome"}" e suas opções?`)) return;
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
  const addOpcao = (i, depoisDe) => {
    const r = refeicoes[i];
    const opcoes = [...(r.opcoes || [])];
    opcoes.splice(depoisDe + 1, 0, { observacao: "", alimentos: [novoItem()] });
    setRef(i, { ...r, opcoes });
    focar(`r${i}o${depoisDe + 1}-0-nome`);
  };
  const removerOpcao = (i, o) => {
    const op = refeicoes[i].opcoes[o];
    if ((op.alimentos || []).some((a) => a.alimento_id || a.nome) && !window.confirm("Remover esta opção da refeição?")) return;
    setRef(i, { ...refeicoes[i], opcoes: refeicoes[i].opcoes.filter((_, k) => k !== o) });
  };

  const aplicarEquivalentes = (selecionados) => {
    const bloco = blocoDe(equiv);
    const item = bloco.alimentos[equiv.indice];
    const novos = selecionados.map((e) => ({
      alimento_id: e.alimento_id, nome: e.nome,
      medida_nome: e.medida ? e.medida.nome : "Gramas",
      quantidade: e.medida ? e.medida.quantidade : e.quantidade_g,
      quantidade_g: e.medida ? e.medida.gramas : e.quantidade_g,
    }));
    setBloco(equiv, { ...bloco, alimentos: bloco.alimentos.map((it, k) => (k === equiv.indice ? { ...item, substitutos: [...(item.substitutos || []), ...novos] } : it)) });
    setEquiv(null);
  };

  const trocar = async (e) => {
    const bloco = blocoDe(equiv);
    const antigo = bloco.alimentos[equiv.indice];
    const medidas = await carregarMedidas(e.alimento_id);
    const novo = {
      ...antigo,
      alimento_id: e.alimento_id, alimento_nome: e.nome, nome: e.nome, _m100: e.macros_100g, _medidas: medidas,
      medida_nome: e.medida ? e.medida.nome : "Gramas",
      quantidade: e.medida ? e.medida.quantidade : e.quantidade_g,
      quantidade_g: e.medida ? e.medida.gramas : e.quantidade_g,
      // o alimento anterior vira substituto, para nao perder a opcao
      substitutos: [
        { alimento_id: antigo.alimento_id, nome: antigo.nome || antigo.alimento_nome, medida_nome: antigo.medida_nome, quantidade: antigo.quantidade, quantidade_g: antigo.quantidade_g },
        ...(antigo.substitutos || []).filter((s) => s.alimento_id !== e.alimento_id),
      ],
    };
    setBloco(equiv, { ...bloco, alimentos: bloco.alimentos.map((it, k) => (k === equiv.indice ? novo : it)) });
    setEquiv(null);
  };

  return (
    <div>
      {equiv && (
        <EquivalentesModal
          item={equiv.item}
          refeicaoNome={refeicoes[equiv.r]?.nome || "Refeição"}
          onAddSubstitutos={aplicarEquivalentes}
          onTrocar={trocar}
          onClose={() => setEquiv(null)}
        />
      )}
      {refeicoes.map((r, i) => (
        <div key={`r${i}`} className={i ? "mt-4 pt-4 border-t border-white/[0.08]" : ""}>
          <BlocoRefeicao
            bk={`r${i}`}
            bloco={r}
            principal
            indice={i}
            total={refeicoes.length}
            config={config}
            modelos={modelos}
            onChange={(nova) => setRef(i, nova)}
            onMaisRefeicao={() => inserirRefeicao(i)}
            onMenos={() => removerRefeicao(i)}
            onMover={(d) => moverRefeicao(i, d)}
            onAddOpcao={() => addOpcao(i, -1)}
            onEstatistica={onEstatistica ? (b) => onEstatistica(b, r.nome || "Refeição") : null}
            onSalvarModelo={(b) => onSalvarModelo(b, r.nome)}
            onEquivalentes={(indice, item) => setEquiv({ r: i, o: null, indice, item })}
          />
          {(r.opcoes || []).map((op, o) => (
            <div key={`r${i}o${o}`} className="mt-2">
              <BlocoRefeicao
                bk={`r${i}o${o}`}
                bloco={op}
                principal={false}
                indice={o}
                total={r.opcoes.length}
                config={config}
                modelos={modelos}
                tituloRefeicao={r.nome}
                onChange={(nova) => setOpcao(i, o, nova)}
                onMaisRefeicao={() => inserirRefeicao(i)}
                onMenos={() => removerOpcao(i, o)}
                onMover={() => {}}
                onAddOpcao={() => addOpcao(i, o)}
                onEstatistica={onEstatistica ? (b) => onEstatistica(b, `${r.nome || "Refeição"} (opção ${o + 1})`) : null}
                onSalvarModelo={(b) => onSalvarModelo(b, r.nome)}
                onEquivalentes={(indice, item) => setEquiv({ r: i, o, indice, item })}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Editor da lista de substituicao da dieta (grupos de alimentos), na mesma grade do editor de refeicoes. */
export function EditorListas({ listas, onChange, config, listasSalvas = [] }) {
  const [importar, setImportar] = useState("");
  const setLista = (i, nova) => onChange(listas.map((l, k) => (k === i ? nova : l)));
  const inserir = (i) => onChange([...listas.slice(0, i + 1), { nome: "", alimentos: [novoItem()] }, ...listas.slice(i + 1)]);
  const remover = (i) => {
    if ((listas[i].alimentos || []).some((a) => a.alimento_id || a.nome) && !window.confirm(`Remover o grupo "${listas[i].nome || "sem nome"}"?`)) return;
    onChange(listas.filter((_, k) => k !== i));
  };
  const mover = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= listas.length) return;
    const lista = [...listas];
    [lista[i], lista[j]] = [lista[j], lista[i]];
    onChange(lista);
  };
  const adicionarSalva = (salva) => {
    onChange([...listas.filter((l) => (l.alimentos || []).some((a) => a.alimento_id || a.nome) || l.nome), { nome: salva.nome, alimentos: (salva.alimentos || []).map(itemDoSalvo) }]);
    setImportar("");
    toast.success(`Lista "${salva.nome}" adicionada.`);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Combobox
          value={importar}
          onChange={setImportar}
          opcoes={listasSalvas}
          rotulo={(l) => l.nome}
          valorDe={(l) => l.nome}
          onSelect={adicionarSalva}
          placeholder={listasSalvas.length ? "Adicionar lista padrão (Carnes e ovos, Frutas…)" : "Nenhuma lista padrão — crie em Configurações da dieta"}
          inputClassName="rc-input h-9 px-3 text-[13px]"
          className="w-full sm:w-[380px]"
        />
        <button type="button" onClick={() => onChange([...listas, { nome: "", alimentos: [novoItem()] }])} className="rc-btn-secondary h-9">Novo grupo</button>
      </div>
      {listas.length === 0 && <p className="text-[13px] text-gray-500 py-6 text-center">Nenhum grupo na lista de substituição desta dieta.</p>}
      <div className="overflow-x-auto">
        <div className={LARGURA_MIN_EDITOR}>
          {listas.map((l, i) => (
            <div key={`l${i}`} className={i ? "mt-4 pt-4 border-t border-white/[0.08]" : ""}>
              <div className={`${GRID} mb-1.5`}>
                <MaisMenos onMais={() => inserir(i)} onMenos={() => remover(i)} tituloMais="Adicionar grupo abaixo" tituloMenos="Remover grupo" />
                <input className="rc-input h-8 py-0 px-2.5 text-[13px] font-semibold" value={l.nome || ""} placeholder="Nome do grupo (ex.: Frutas)" onChange={(e) => setLista(i, { ...l, nome: e.target.value })} />
                <div className="col-span-5 flex items-center">
                  <Icone titulo="Mover grupo abaixo" onClick={() => mover(i, 1)} disabled={i === listas.length - 1}><ChevronDown className="h-4 w-4" /></Icone>
                  <Icone titulo="Mover grupo acima" onClick={() => mover(i, -1)} disabled={i === 0}><ChevronUp className="h-4 w-4" /></Icone>
                </div>
                <CabecalhoColunas />
              </div>
              <BlocoAlimentos bk={`l${i}`} bloco={l} config={config} onChange={(nova) => setLista(i, nova)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
