import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles, ChevronLeft, ChevronRight, Copy, FileDown, FilePlus2, FolderInput, Loader2, Save, LibraryBig, Settings2, Star, Trash2, Utensils } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/evo-api";
import EditorRefeicoes, { BarraTotal, LARGURA_EDITOR } from "./dieta/EditorRefeicoes";
import { termosRestritos } from "./dieta/grupos";
import GerarPdfDialogo from "./dieta/GerarPdfDialogo";
import OutrasOpcoes from "./dieta/OutrasOpcoes";
import ImportarDieta from "./dieta/ImportarDieta";
import PreferenciasGaveta, { PreferenciasContext, preferenciasDe, usePreferenciasGaveta } from "./dieta/PreferenciasGaveta";
import { carregarEstrutura } from "@/lib/anamnese";
import ModelosDietaModal, { SalvarModeloDialogo } from "./dieta/ModelosDietaModal";
import ObservacoesDieta from "./dieta/ObservacoesDieta";
import DonatoGaveta, { ajustarRefeicaoAMeta } from "./dieta/DonatoGaveta";
import Combobox from "./dieta/Combobox";
import { PromptDialogo } from "./dieta/Dialogo";
import { EstatisticaRefeicaoModal } from "./dieta/Nutrientes";
import useDietaConfig from "./dieta/useDietaConfig";
import { itensParaSalvar } from "./dieta/calculos";
import { draftDoPlano, draftNovo, payloadDoDraft } from "./dieta/plano";
import { DIAS, ROTULO_NIVEL, situacaoDoCiclo } from "@/lib/ciclos";

// salvar() ja avisa o erro; os demais fluxos so avisam o que ainda nao foi avisado
const avisarErro = (error) => {
  if (error?.response && !error.avisado) toast.error(formatApiError(error.response?.data?.detail));
};
const maisRecente = (lista) => [...lista].sort((a, b) => String(b.atualizado_em || "").localeCompare(String(a.atualizado_em || "")))[0];
const substituir = (lista, plano) => (lista.some((p) => p.id === plano.id) ? lista.map((p) => (p.id === plano.id ? plano : p)) : [...lista, plano]);

function AcaoTopo({ titulo, rotulo, onClick, children, disabled, ativo }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={titulo} aria-label={titulo} aria-pressed={ativo}
      className={`flex flex-col items-center gap-1 rounded-xl px-2.5 py-1.5 hover:text-white hover:bg-white/[0.05] transition-colors disabled:opacity-30 ${ativo ? "text-rc-lime" : "text-gray-400"}`}>
      {children}
      <span className="text-[10.5px] leading-none">{rotulo}</span>
    </button>
  );
}

/** Abre o PDF numa aba ja aberta no clique (evita bloqueio de pop-up); sem aba, baixa o arquivo. */
async function abrirPdf(janela, url, nomeArquivo) {
  const resp = await api.get(url, { responseType: "blob" });
  const href = window.URL.createObjectURL(new Blob([resp.data], { type: "application/pdf" }));
  if (janela && !janela.closed) { janela.location.href = href; return; }
  const a = document.createElement("a");
  a.href = href;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Prescricao dietetica no formato do NutriDiet: varias dietas por paciente em abas, refeicoes com
 * opcoes "OU", copiar/colar, modelos, lista de substituicao, estatistica, "Outras opcoes" e PDF.
 */
export default function PrescricaoDietetica({ d, onAbrirAnamnese }) {
  const pid = d.patient.id;
  const { config, recarregar, salvar: salvarConfig } = useDietaConfig();
  const [planos, setPlanos] = useState(null);
  const [draft, setDraft] = useState(null);
  const [salvoJson, setSalvoJson] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [modelos, setModelos] = useState([]);
  const [listasSalvas, setListasSalvas] = useState([]);
  const [orientacoes, setOrientacoes] = useState([]);
  const [prompt, setPrompt] = useState(null);
  const [estatistica, setEstatistica] = useState(null);
  const [outras, setOutras] = useState(null);
  const [importar, setImportar] = useState(false);
  const [gerarPdf, setGerarPdf] = useState(false);
  const [donato, setDonato] = useState(false);
  // rascunho do Dr. Donatto na tabela (ajuste don1): nada é salvo até "Aplicar plano"
  const [rascunhoDonato, setRascunhoDonato] = useState(null);
  const gaveta = usePreferenciasGaveta();
  const [estruturaForm, setEstruturaForm] = useState(null);
  useEffect(() => { carregarEstrutura().then(setEstruturaForm).catch(() => {}); }, []);
  const preferencias = useMemo(() => preferenciasDe(d.anamnese_v2), [d.anamnese_v2]);
  const [modelosDieta, setModelosDieta] = useState(false);

  const dRef = useRef(d);
  dRef.current = d;
  const json = useMemo(() => (draft ? JSON.stringify(payloadDoDraft(draft)) : ""), [draft]);
  const sujo = !!draft && json !== salvoJson;

  const abrir = useCallback((plano) => {
    const novo = draftDoPlano(plano, dRef.current);
    setDraft(novo);
    setSalvoJson(JSON.stringify(payloadDoDraft(novo)));
  }, []);

  const rascunhoNovo = useCallback((cfg) => {
    const novo = draftNovo(dRef.current, cfg);
    setDraft(novo);
    setSalvoJson(JSON.stringify(payloadDoDraft(novo)));
  }, []);

  useEffect(() => {
    let ativo = true;
    Promise.all([recarregar(), api.get(`/patients/${pid}/planos-manuais`).then((r) => r.data || [])])
      .then(([cfg, lista]) => {
        if (!ativo) return;
        setPlanos(lista);
        if (lista.length) abrir(maisRecente(lista)); else rascunhoNovo(cfg);
      })
      .catch(() => { if (ativo) setPlanos([]); });
    api.get("/dieta/modelos-refeicao").then((r) => ativo && setModelos(r.data || [])).catch(() => {});
    api.get("/dieta/listas-substituicao").then((r) => ativo && setListasSalvas(r.data || [])).catch(() => {});
    api.get("/orientacoes", { params: { ativos: true } }).then((r) => ativo && setOrientacoes(r.data || [])).catch(() => {});
    return () => { ativo = false; };
  }, [pid, recarregar, abrir, rascunhoNovo]);

  // Como no NutriDiet, sair da tela com alteracoes salva automaticamente (dieta ja existente).
  const [pendente] = useState(() => ({ atual: null }));
  pendente.atual = sujo && draft?.id ? { id: draft.id, body: json } : null;
  useEffect(() => () => {
    const p = pendente.atual;
    if (p) api.put(`/patients/${pid}/planos-manuais/${p.id}`, JSON.parse(p.body)).catch(() => {});
  }, [pid, pendente]);
  useEffect(() => {
    if (!sujo) return undefined;
    const aviso = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [sujo]);

  const set = (k, v) => setDraft((cur) => ({ ...cur, [k]: v }));

  const salvar = async ({ silencioso = false } = {}) => {
    setSalvando(true);
    const body = payloadDoDraft(draft);
    try {
      const { data } = draft.id
        ? await api.put(`/patients/${pid}/planos-manuais/${draft.id}`, body)
        : await api.post(`/patients/${pid}/planos-manuais`, body);
      setDraft((cur) => ({ ...cur, id: data.id }));
      setSalvoJson(JSON.stringify(body));
      setPlanos((lista) => substituir(lista || [], data));
      if (!silencioso) toast.success("Dieta salva.");
      return data;
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail));
      error.avisado = true;
      throw error;
    } finally {
      setSalvando(false);
    }
  };
  const garantirSalvo = async () => (sujo || !draft.id ? salvar({ silencioso: true }) : { id: draft.id });

  const trocarPara = async (plano) => {
    if (plano.id === draft?.id) return;
    if (rascunhoDonato) { toast.info("Aplique ou descarte o rascunho do Dr. Donatto antes de trocar de dieta."); setDonato(true); return; }
    if (sujo) { try { await salvar({ silencioso: true }); } catch { return; } }
    abrir(plano);
  };

  const novaDieta = async () => {
    try {
      if (sujo) await salvar({ silencioso: true });
      const base = draftNovo(dRef.current, config, "Nova dieta");
      const { data } = await api.post(`/patients/${pid}/planos-manuais`, payloadDoDraft(base));
      setPlanos((lista) => substituir(lista || [], data));
      abrir(data);
      toast.success("Nova dieta criada.");
    } catch (error) {
      avisarErro(error);
    }
  };

  const duplicar = async (titulo) => {
    const atual = await garantirSalvo();
    const { data } = await api.post(`/patients/${pid}/planos-manuais/${atual.id}/duplicar`, { titulo });
    setPlanos((lista) => substituir(lista || [], data));
    abrir(data);
    setPrompt(null);
    toast.success(`Dieta duplicada: ${titulo}.`);
  };

  const salvarModeloDieta = async (nome, categoria) => {
    const atual = await garantirSalvo();
    await api.post(`/patients/${pid}/planos-manuais/${atual.id}/template`, { nome, categoria });
    setPrompt(null);
    toast.success(`Modelo "${nome}" salvo${categoria ? ` em ${categoria}` : ""}. Use em qualquer paciente pelo botão Modelos.`);
  };

  const salvarModeloRefeicao = async (nome, bloco) => {
    const { data } = await api.post("/dieta/modelos-refeicao", {
      nome, observacao: bloco.observacao || "", alimentos: itensParaSalvar(bloco.alimentos),
    });
    setModelos((lista) => [...lista.filter((m) => m.id !== data.id), data].sort((a, b) => a.nome.localeCompare(b.nome)));
    setPrompt(null);
    toast.success(`Modelo de refeição "${nome}" salvo.`);
  };

  const mover = async (dir) => {
    const lista = [...(planos || [])];
    const i = lista.findIndex((p) => p.id === draft?.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= lista.length) return;
    [lista[i], lista[j]] = [lista[j], lista[i]];
    setPlanos(lista);
    try { await api.put(`/patients/${pid}/planos-manuais-ordem`, { ids: lista.map((p) => p.id) }); } catch { toast.error("Não foi possível salvar a nova ordem."); }
  };

  const apagar = async () => {
    if (!window.confirm(`Tem certeza de que deseja apagar a dieta "${draft.titulo}"?`)) return;
    try {
      if (draft.id) await api.delete(`/patients/${pid}/planos-manuais/${draft.id}`);
      const resto = (planos || []).filter((p) => p.id !== draft.id);
      setPlanos(resto);
      if (resto.length) abrir(resto[0]); else rascunhoNovo(config);
      toast.success("Dieta apagada.");
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail));
    }
  };

  const pdf = async (tipo) => {
    const janela = window.open("", "_blank");
    try {
      const atual = await garantirSalvo();
      const sufixo = tipo === "nutrientes" ? "/nutrientes" : "";
      const nome = `${tipo === "nutrientes" ? "nutrientes" : "dieta"}-${(draft.titulo || "plano").replace(/\s+/g, "-")}.pdf`;
      await abrirPdf(janela, `/patients/${pid}/relatorios/dieta/${atual.id}${sufixo}`, nome);
    } catch (error) {
      if (janela) janela.close();
      if (error?.response) toast.error("Não foi possível gerar o PDF.");
    }
  };

  const aposImportar = async (id) => {
    setImportar(false);
    const { data } = await api.get(`/patients/${pid}/planos-manuais`);
    setPlanos(data || []);
    const alvo = (data || []).find((p) => p.id === id);
    if (alvo) abrir(alvo);
  };

  const kcalDieta = Number(draft?.planejamento?.kcal) || Number(d.patient?.meta_energetica?.kcal_final) || null;

  const receberRascunho = (previa, generationId) => {
    const novo = draftDoPlano(previa.plano, dRef.current);
    const r = previa.resumo || {};
    const g = (x) => Number(x?.quantidade_g) || 0;
    const kcal = Number(r.valor_energetico_total_kcal) || kcalDieta;
    const planejamento = kcal && g(r.proteinas)
      ? { ...novo.planejamento, kcal: Math.round(kcalDieta || kcal),
          pct_ptn: Math.round((g(r.proteinas) * 400) / kcal), pct_cho: Math.round((g(r.carboidratos) * 400) / kcal), pct_lip: Math.round((g(r.gorduras) * 900) / kcal) }
      : novo.planejamento;
    setRascunhoDonato((atual) => ({ generationId, validacao: previa.validacao, justificativa: previa.justificativa,
      anterior: atual?.anterior || { draft, salvoJson } }));
    setDraft({ ...novo, id: null, titulo: "Rascunho · Dr. Donatto", planejamento });
    setSalvoJson("");
  };
  const refeicaoRegenerada = (i, previa) => {
    const bloco = draftDoPlano(previa.plano, dRef.current).refeicoes[i];
    if (!bloco) return;
    setDraft((cur) => ({ ...cur, refeicoes: cur.refeicoes.map((r, j) => (j === i ? { ...bloco, meta_pct: r.meta_pct ?? bloco.meta_pct } : r)) }));
    setRascunhoDonato((cur) => ({ ...cur, validacao: previa.validacao }));
  };
  const ajustarRefeicao = (i) => setDraft((cur) => ({ ...cur, refeicoes: cur.refeicoes.map((r, j) => (j === i ? ajustarRefeicaoAMeta(r, kcalDieta) : r)) }));
  const aplicarDonato = async () => {
    try {
      const { data } = await api.post(`/patients/${pid}/donato/plans/${rascunhoDonato.generationId}/approve`, { plano: payloadDoDraft(draft) });
      const { data: lista } = await api.get(`/patients/${pid}/planos-manuais`);
      setPlanos(lista || []);
      setRascunhoDonato(null);
      abrir(data);
      setDonato(false);
      toast.success(`${data.titulo} salva. O plano anterior continua guardado.`);
    } catch (error) { toast.error(formatApiError(error.response?.data?.detail)); }
  };
  const descartarDonato = async () => {
    if (!window.confirm("Descartar o rascunho do Dr. Donatto? A dieta anterior volta para a tela.")) return;
    api.post(`/patients/${pid}/donato/plans/${rascunhoDonato.generationId}/reject`).catch(() => {});
    const { anterior } = rascunhoDonato;
    setRascunhoDonato(null);
    setDraft(anterior.draft);
    setSalvoJson(anterior.salvoJson);
    toast.success("Rascunho descartado.");
  };

  if (!planos || !draft) {
    return <div className="rc-card p-10 flex items-center justify-center gap-2 text-gray-400"><Loader2 className="w-4 h-4 animate-spin" /> Carregando dietas…</div>;
  }

  const abas = draft.id ? planos : [...planos, { id: null, titulo: draft.titulo }];
  const peso = draft.prescricao_dietetica?.peso;
  const planasAnam = Object.values(d.anamnese_v2?.formulario || {}).reduce((a, b) => ({ ...a, ...(b || {}) }), {});
  const restricoes = termosRestritos(planasAnam.alergias, planasAnam.nao_gosta);
  const posicao = planos.findIndex((p) => p.id === draft.id);

  return (
    <div className="space-y-4" data-testid="prescricao-dietetica-workspace">
      {/* Abas das dietas do paciente, com setas para reordenar (como no NutriDiet) */}
      <div className="rc-card px-3 py-2.5 flex items-center gap-2">
        <button type="button" onClick={() => mover(-1)} disabled={posicao <= 0} className="rc-btn-ghost p-1.5 disabled:opacity-25" title="Mover dieta para a esquerda" aria-label="Mover dieta para a esquerda"><ChevronLeft className="w-5 h-5" /></button>
        <div role="tablist" aria-label="Dietas do paciente" className="flex flex-1 min-w-0 gap-1.5 overflow-x-auto [scrollbar-width:none]">
          {abas.map((p) => {
            const ativa = p.id === draft.id;
            return (
              <button
                key={p.id || "nova"}
                role="tab"
                type="button"
                aria-selected={ativa}
                onClick={() => p.id && trocarPara(p)}
                className={`shrink-0 h-9 px-4 rounded-lg text-[13.5px] transition-colors ${ativa ? "bg-rc-raised text-white font-semibold shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]" : "text-gray-400 hover:text-white hover:bg-white/[0.04]"}`}
              >
                {ativa ? draft.titulo || "Sem título" : p.titulo || "Sem título"}
                {(ativa ? draft.ciclo_tipo : p.ciclo_tipo) && <span className="ml-2 bg-rc-blue/20 px-1.5 text-[10.5px] font-semibold text-rc-blueLight">ciclo</span>}
                {ativa && sujo && <span className="ml-2 inline-block w-1.5 h-1.5 rounded-full bg-rc-amber align-middle" title="Alterações não salvas" />}
                {!p.id && <span className="ml-2 text-[11px] text-gray-500 font-normal">não salva</span>}
              </button>
            );
          })}
        </div>
        <button type="button" onClick={() => mover(1)} disabled={posicao < 0 || posicao >= planos.length - 1} className="rc-btn-ghost p-1.5 disabled:opacity-25" title="Mover dieta para a direita" aria-label="Mover dieta para a direita"><ChevronRight className="w-5 h-5" /></button>
        <div className="hidden sm:flex items-center gap-1 pl-2 ml-1 border-l border-white/[0.06]">
          <button type="button" onClick={() => setDonato((v) => !v)} className={`rc-btn-ghost text-[12.5px] ${donato ? "text-rc-blueLight" : ""}`} data-testid="abrir-donatto"><Sparkles className="w-4 h-4" /> Gerar com Dr. Donatto</button>
          <Link to="/configuracoes-dieta" className="rc-btn-ghost p-2" title="Configurações da dieta" aria-label="Configurações da dieta"><Settings2 className="w-4 h-4" /></Link>
        </div>
      </div>

      {donato && (
        <DonatoGaveta pid={pid} draft={draft} kcalMeta={kcalDieta} preferencias={preferencias} rascunho={rascunhoDonato}
          onFechar={() => setDonato(false)} onRascunho={receberRascunho} onRegenerada={refeicaoRegenerada} onAjustar={ajustarRefeicao}
          onAplicar={aplicarDonato} onDescartar={descartarDonato} />
      )}
      {rascunhoDonato && (
        <div className="rc-card flex flex-wrap items-center justify-between gap-3 border-l-2 border-rc-amber px-4 py-3" data-testid="faixa-rascunho-donatto">
          <div className="text-[13.5px] text-gray-200"><Sparkles className="-mt-0.5 mr-1.5 inline h-4 w-4 text-rc-blue" />Rascunho do Dr. Donatto · <span className="text-rc-amber">nada foi salvo ainda</span>. Revise na tabela e aplique.</div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setDonato(true)} className="rc-btn-ghost h-9 text-[12.5px]">Abrir conferência</button>
            <button type="button" onClick={descartarDonato} className="rc-btn-ghost h-9 text-[12.5px]">Descartar</button>
            <button type="button" onClick={() => { if (window.confirm("Salvar este plano como nova versão? O plano anterior continua guardado.")) aplicarDonato(); }} className="rc-btn-primary h-9 text-[12.5px]">Aplicar plano</button>
          </div>
        </div>
      )}

      <FaixaCiclo ciclo={d.patient?.ciclo_carbo} draft={draft} planos={planos} onAbrir={trocarPara} />

      <BarraTotal refeicoes={draft.refeicoes} peso={peso} planejamento={draft.planejamento} onOutrasOpcoes={() => setOutras("vitaminas")} />

      <PreferenciasContext.Provider value={preferencias}>
      <div className={gaveta.fixada ? "grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px] items-start" : ""}>
        <section className="rc-card p-4 sm:p-5 min-w-0">
          {/* Objetivo + titulo + acoes da dieta */}
          <div className="flex flex-wrap items-end gap-3 mb-5">
            <label className="block flex-1 min-w-[200px]">
              <span className="rc-label">Objetivo</span>
              <Combobox value={draft.objetivo} onChange={(v) => set("objetivo", v)} opcoes={config.objetivos} placeholder="Objetivo da dieta" inputClassName="rc-input h-10 font-medium" onEnter={() => document.getElementById("dieta-titulo")?.focus()} />
            </label>
            <label className="block flex-1 min-w-[200px]">
              <span className="rc-label">Título</span>
              <Combobox id="dieta-titulo" value={draft.titulo} onChange={(v) => set("titulo", v)} opcoes={config.titulos} placeholder="Título da dieta" inputClassName="rc-input h-10 font-medium" onEnter={() => document.getElementById("r0-nome")?.focus()} />
            </label>
            <div className="flex w-full flex-wrap items-center gap-0.5 sm:w-auto">
              <AcaoTopo titulo="Modelos de dieta por categoria (um clique aplica)" rotulo="Modelos" onClick={() => setModelosDieta(true)}><LibraryBig className="w-5 h-5" /></AcaoTopo>
              <AcaoTopo titulo="Importar dieta (modelos, recordatório, outros pacientes)" rotulo="Importar" onClick={() => setImportar(true)}><FolderInput className="w-5 h-5" /></AcaoTopo>
              <AcaoTopo titulo="Nova dieta em branco" rotulo="Nova" onClick={novaDieta}><FilePlus2 className="w-5 h-5" /></AcaoTopo>
              <AcaoTopo titulo="Duplicar dieta" rotulo="Duplicar" onClick={() => setPrompt({ tipo: "duplicar" })}><Copy className="w-5 h-5" /></AcaoTopo>
              <AcaoTopo titulo="Salvar dieta como modelo" rotulo="Salvar modelo" onClick={() => setPrompt({ tipo: "modeloDieta" })}><Star className="w-5 h-5" /></AcaoTopo>
              <AcaoTopo titulo="Preferências do paciente (não come, gosta, rotina)" rotulo="Preferências" onClick={() => gaveta.abrir()} ativo={gaveta.aberta}><Utensils className="w-5 h-5" /></AcaoTopo>
            </div>
          </div>

          <div className="overflow-x-auto -mx-1 px-1 pb-1">
            <div className={LARGURA_EDITOR}>
              <EditorRefeicoes
                refeicoes={draft.refeicoes}
                onChange={(refeicoes) => set("refeicoes", refeicoes)}
                config={config}
                modelos={modelos}
                planejamento={draft.planejamento}
                peso={peso}
                favoritos={config.alimentos_favoritos || []}
                restricoes={restricoes}
                onFavoritar={(f) => {
                  const atuais = config.alimentos_favoritos || [];
                  const tem = atuais.some((x) => x.id === f.id);
                  salvarConfig({ alimentos_favoritos: tem ? atuais.filter((x) => x.id !== f.id) : [f, ...atuais] })
                    .then(() => toast.success(tem ? `${f.nome} saiu dos favoritos.` : `${f.nome} nos favoritos.`)).catch(() => toast.error("Não foi possível salvar o favorito."));
                }}
                onSalvarModelo={(bloco, nomeRefeicao) => setPrompt({ tipo: "modeloRefeicao", bloco, sugestao: nomeRefeicao })}
                onEstatistica={(bloco, titulo) => setEstatistica({ bloco, titulo })}
              />
            </div>
          </div>

          <ObservacoesDieta itens={draft.recomendacoes} onChange={(v) => set("recomendacoes", v)} orientacoes={orientacoes} />

          <div className="mt-6 pt-5 border-t border-white/[0.06] flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => salvar().catch(() => {})} disabled={salvando} className="rc-btn-primary min-w-[120px]">
              {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar
            </button>
            <button type="button" onClick={apagar} className="rc-btn-secondary"><Trash2 className="w-4 h-4" /> Apagar</button>
            <button type="button" onClick={() => setGerarPdf(true)} className="rc-btn-secondary" data-testid="gerar-pdf"><FileDown className="w-4 h-4" /> Gerar PDF do plano</button>
            {sujo && <span className="text-[12.5px] text-rc-amber ml-1">Alterações não salvas</span>}
          </div>
        </section>
        {gaveta.fixada && <PreferenciasGaveta paciente={d.patient} anamnese={d.anamnese_v2} estrutura={estruturaForm} estado={gaveta} />}
      </div>
      {!gaveta.fixada && <PreferenciasGaveta paciente={d.patient} anamnese={d.anamnese_v2} estrutura={estruturaForm} estado={gaveta} />}
      </PreferenciasContext.Provider>

      {gerarPdf && <GerarPdfDialogo pid={pid} titulo={draft.titulo} garantirSalvo={garantirSalvo} onClose={() => setGerarPdf(false)} />}
      {importar && <ImportarDieta d={d} onImportado={aposImportar} onClose={() => setImportar(false)} />}
      {modelosDieta && (
        <ModelosDietaModal pid={pid} draft={draft} categorias={config.categorias_modelos || []}
          onAplicado={(id) => { setModelosDieta(false); aposImportar(id); }} onClose={() => setModelosDieta(false)} />
      )}

      {estatistica && <EstatisticaRefeicaoModal pid={pid} bloco={estatistica.bloco} titulo={estatistica.titulo} peso={peso} onClose={() => setEstatistica(null)} />}
      {outras && (
        <OutrasOpcoes
          pid={pid}
          draft={draft}
          setDraft={setDraft}
          patient={d.patient}
          config={config}
          listasSalvas={listasSalvas}
          abaInicial={outras}
          onPdfDieta={() => pdf("dieta")}
          onPdfNutrientes={() => pdf("nutrientes")}
          onClose={() => setOutras(null)}
        />
      )}
      {prompt?.tipo === "duplicar" && (
        <PromptDialogo titulo="Duplicar dieta" rotulo="Título da dieta duplicada" opcoes={config.titulos} confirmar="Duplicar" onConfirmar={(t) => duplicar(t).catch(avisarErro)} onClose={() => setPrompt(null)} />
      )}
      {prompt?.tipo === "modeloDieta" && (
        <SalvarModeloDialogo valorInicial={draft.titulo} categorias={config.categorias_modelos || []} onConfirmar={(t, c) => salvarModeloDieta(t, c).catch(avisarErro)} onClose={() => setPrompt(null)} />
      )}
      {prompt?.tipo === "modeloRefeicao" && (
        <PromptDialogo titulo="Modelo de refeição" rotulo="Título do modelo de refeição" valorInicial={prompt.sugestao ? prompt.sugestao.charAt(0) + prompt.sugestao.slice(1).toLowerCase() : ""}
          onConfirmar={(t) => salvarModeloRefeicao(t, prompt.bloco).catch(avisarErro)} onClose={() => setPrompt(null)} />
      )}
    </div>
  );
}


/** Ciclo de carbo (cid1/cic1): o que vale hoje e qual dieta usar. */
function FaixaCiclo({ ciclo, draft, planos, onAbrir }) {
  if (!ciclo) return null;
  const sit = situacaoDoCiclo(ciclo);
  if (!sit) return null;
  const rotulo = (chave) => (chave?.startsWith("fase") ? (() => { const f = ciclo.fases?.[Number(chave.slice(4)) - 1]; return f ? `${f.nome} · ${f.tipo === "low" ? "low" : "high"} carb` : chave; })() : ROTULO_NIVEL[chave] || chave);
  const hoje = ciclo.tipo === "haluch"
    ? (sit.terminou ? "ciclo terminado" : sit.antesDoInicio ? `começa em ${String(ciclo.inicio).split("-").reverse().join("/")}` : `${rotulo(sit.chave)}${sit.semanaNaFase ? ` · semana ${sit.semanaNaFase} de ${sit.semanasFase}` : ""}`)
    : ciclo.unidade === "semana" ? `${rotulo(sit.chave)} · semana ${sit.semana}` : `${rotulo(sit.chave)} (${DIAS.find(([k]) => k === sit.dia)?.[1] || ""})`;
  const dietaHoje = (planos || []).find((x) => x.ciclo_tipo === sit.chave);
  const diasDesta = draft?.ciclo_tipo && ciclo.tipo === "nivel" && ciclo.unidade !== "semana"
    ? DIAS.filter(([k]) => (ciclo.semana || {})[k] === draft.ciclo_tipo).map(([, r]) => r).join(", ") : "";
  return (
    <div className="rc-card flex flex-wrap items-center gap-x-4 gap-y-2 border-l-2 border-rc-blue px-4 py-2.5 text-[13px]" data-testid="faixa-ciclo">
      <span className="text-gray-400">Ciclo de carbo · hoje: <b className="text-white">{hoje}</b></span>
      {draft?.ciclo_tipo && <span className="text-gray-400">Esta dieta: <b className="text-white">{rotulo(draft.ciclo_tipo)}</b>{diasDesta ? ` · ${diasDesta}` : ""}</span>}
      {sit.proximaTroca && <span className="text-gray-500">troca em {String(sit.proximaTroca).split("-").reverse().join("/")}</span>}
      {dietaHoje && dietaHoje.id !== draft?.id && <button type="button" onClick={() => onAbrir(dietaHoje)} className="rc-btn-lista ml-auto h-8 text-[12px]">Abrir a dieta de hoje</button>}
      {!dietaHoje && <span className="ml-auto text-[12px] text-rc-amber">Sem dieta para {rotulo(sit.chave)}: crie em Macros › Ciclo de carboidratos.</span>}
    </div>
  );
}
