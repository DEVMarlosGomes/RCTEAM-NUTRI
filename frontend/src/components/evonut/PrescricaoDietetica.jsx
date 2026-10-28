import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Bot, ChevronLeft, ChevronRight, Copy, FileDown, FilePlus2, FolderInput, Loader2, Save, Settings2, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/evo-api";
import EditorDieta, { LARGURA_MIN_EDITOR } from "./dieta/EditorDieta";
import PainelTotais from "./dieta/PainelTotais";
import OutrasOpcoes from "./dieta/OutrasOpcoes";
import ImportarDieta from "./dieta/ImportarDieta";
import ObservacoesDieta from "./dieta/ObservacoesDieta";
import DonatoPanel from "./dieta/DonatoPanel";
import Combobox from "./dieta/Combobox";
import { PromptDialogo } from "./dieta/Dialogo";
import { EstatisticaRefeicaoModal } from "./dieta/Nutrientes";
import useDietaConfig from "./dieta/useDietaConfig";
import { itensParaSalvar } from "./dieta/calculos";
import { draftDoPlano, draftNovo, payloadDoDraft } from "./dieta/plano";

// salvar() ja avisa o erro; os demais fluxos so avisam o que ainda nao foi avisado
const avisarErro = (error) => {
  if (error?.response && !error.avisado) toast.error(formatApiError(error.response?.data?.detail));
};
const maisRecente = (lista) => [...lista].sort((a, b) => String(b.atualizado_em || "").localeCompare(String(a.atualizado_em || "")))[0];
const substituir = (lista, plano) => (lista.some((p) => p.id === plano.id) ? lista.map((p) => (p.id === plano.id ? plano : p)) : [...lista, plano]);

function AcaoTopo({ titulo, rotulo, onClick, children, disabled }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={titulo} aria-label={titulo}
      className="flex flex-col items-center gap-1 rounded-xl px-2.5 py-1.5 text-gray-400 hover:text-white hover:bg-white/[0.05] transition-colors disabled:opacity-30">
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
export default function PrescricaoDietetica({ d }) {
  const pid = d.patient.id;
  const { config, recarregar } = useDietaConfig();
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
  const [donato, setDonato] = useState(false);

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

  const salvarModeloDieta = async (nome) => {
    const atual = await garantirSalvo();
    await api.post(`/patients/${pid}/planos-manuais/${atual.id}/template`, { nome });
    setPrompt(null);
    toast.success(`Modelo de dieta "${nome}" salvo. Importe em qualquer paciente pelo ícone Importar.`);
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

  if (!planos || !draft) {
    return <div className="rc-card p-10 flex items-center justify-center gap-2 text-gray-400"><Loader2 className="w-4 h-4 animate-spin" /> Carregando dietas…</div>;
  }

  const abas = draft.id ? planos : [...planos, { id: null, titulo: draft.titulo }];
  const peso = draft.prescricao_dietetica?.peso;
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
                {ativa && sujo && <span className="ml-2 inline-block w-1.5 h-1.5 rounded-full bg-rc-amber align-middle" title="Alterações não salvas" />}
                {!p.id && <span className="ml-2 text-[11px] text-gray-500 font-normal">não salva</span>}
              </button>
            );
          })}
        </div>
        <button type="button" onClick={() => mover(1)} disabled={posicao < 0 || posicao >= planos.length - 1} className="rc-btn-ghost p-1.5 disabled:opacity-25" title="Mover dieta para a direita" aria-label="Mover dieta para a direita"><ChevronRight className="w-5 h-5" /></button>
        <div className="hidden sm:flex items-center gap-1 pl-2 ml-1 border-l border-white/[0.06]">
          <button type="button" onClick={() => setDonato((v) => !v)} className={`rc-btn-ghost text-[12.5px] ${donato ? "text-rc-blueLight" : ""}`}><Bot className="w-4 h-4" /> DONATO</button>
          <Link to="/configuracoes-dieta" className="rc-btn-ghost p-2" title="Configurações da dieta" aria-label="Configurações da dieta"><Settings2 className="w-4 h-4" /></Link>
        </div>
      </div>

      {donato && <DonatoPanel d={d} onApproved={() => aposImportar(null)} />}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_210px] items-start">
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
            <div className="flex items-center gap-0.5">
              <AcaoTopo titulo="Importar dieta (modelos, recordatório, outros pacientes)" rotulo="Importar" onClick={() => setImportar(true)}><FolderInput className="w-5 h-5" /></AcaoTopo>
              <AcaoTopo titulo="Nova dieta em branco" rotulo="Nova" onClick={novaDieta}><FilePlus2 className="w-5 h-5" /></AcaoTopo>
              <AcaoTopo titulo="Duplicar dieta" rotulo="Duplicar" onClick={() => setPrompt({ tipo: "duplicar" })}><Copy className="w-5 h-5" /></AcaoTopo>
              <AcaoTopo titulo="Salvar dieta como modelo" rotulo="Modelo" onClick={() => setPrompt({ tipo: "modeloDieta" })}><Star className="w-5 h-5" /></AcaoTopo>
            </div>
          </div>

          <div className="overflow-x-auto -mx-1 px-1 pb-1">
            <div className={LARGURA_MIN_EDITOR}>
              <EditorDieta
                refeicoes={draft.refeicoes}
                onChange={(refeicoes) => set("refeicoes", refeicoes)}
                config={config}
                modelos={modelos}
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
            <button type="button" onClick={() => pdf("dieta")} className="rc-btn-secondary"><FileDown className="w-4 h-4" /> PDF</button>
            {sujo && <span className="text-[12.5px] text-rc-amber ml-1">Alterações não salvas</span>}
          </div>
        </section>

        <PainelTotais refeicoes={draft.refeicoes} peso={peso} planejamento={draft.planejamento} onOutrasOpcoes={() => setOutras("vitaminas")} />
      </div>

      {importar && <ImportarDieta d={d} onImportado={aposImportar} onClose={() => setImportar(false)} />}
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
        <PromptDialogo titulo="Salvar como modelo" rotulo="Título do modelo de dieta" valorInicial={draft.titulo} onConfirmar={(t) => salvarModeloDieta(t).catch(avisarErro)} onClose={() => setPrompt(null)} />
      )}
      {prompt?.tipo === "modeloRefeicao" && (
        <PromptDialogo titulo="Modelo de refeição" rotulo="Título do modelo de refeição" valorInicial={prompt.sugestao ? prompt.sugestao.charAt(0) + prompt.sugestao.slice(1).toLowerCase() : ""}
          onConfirmar={(t) => salvarModeloRefeicao(t, prompt.bloco).catch(avisarErro)} onClose={() => setPrompt(null)} />
      )}
    </div>
  );
}
