import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, CalendarDays, Camera, Check, CheckCircle2, FileText, Loader2, MessageCircle, Plus, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/evo-api";
import Brand from "@/components/evonut/Brand";
import { POSES, REGRAS } from "@/components/evonut/ProtocoloFotos";
import SeletorObjetivos, { OBJETIVOS } from "@/components/evonut/SeletorObjetivos";
import { carregarEstrutura, idadeAnos, opcoesVisiveis, perguntasVisiveis, vazio } from "@/lib/anamnese";

const WHATSAPP_PADRAO = "5511983692815";

/**
 * Pré-consulta pública (link enviado pelo WhatsApp): boas-vindas -> tela inicial -> uma pergunta por tela
 * (5 blocos, 37 perguntas, condicionais) -> "Tudo certo". As perguntas vêm do backend (anamnese_form.py).
 * Rascunho salvo a cada resposta (no aparelho e no servidor): o cliente pode fechar e voltar pelo mesmo link.
 */
const STORAGE_KEY = (token) => `rc_preconsulta_${token}_${window.__rcTipoForm || "inicial"}`;

function lerLocal(token) {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY(token)) || "null"); } catch { return null; }
}
function gravarLocal(token, dados) {
  try { localStorage.setItem(STORAGE_KEY(token), JSON.stringify(dados)); } catch { /* sem armazenamento: segue só com o servidor */ }
}
function apagarLocal(token) {
  try { localStorage.removeItem(STORAGE_KEY(token)); } catch { /* idem */ }
}

export default function PreConsulta() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [estrutura, setEstrutura] = useState(null);
  const [fase, setFase] = useState("boas_vindas");
  const [respostas, setRespostas] = useState({});
  const [cur, setCur] = useState(null);
  const [retomar, setRetomar] = useState(false);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [info, setInfo] = useState(null);
  const [consentimento, setConsentimento] = useState(false);
  const timerAvanco = useRef(null);
  const timerRascunho = useRef(null);

  useEffect(() => {
    if (!token) return;
    let ativo = true;
    api.get(`/public/lead/${token}/formulario`).then((r) => r.data).catch(() => ({ tipo: "inicial", estado: "aberto" })).then((form) => {
      window.__rcTipoForm = form.tipo || "inicial";
      return Promise.all([
        carregarEstrutura(form.tipo || "inicial"),
        api.get(`/public/lead/${token}`).then((r) => r.data),
        api.get(`/public/lead/${token}/rascunho`).then((r) => r.data).catch(() => ({})),
        form,
      ]);
    }).then(([est, lead, servidor, form]) => {
      if (!ativo) return;
      setEstrutura(est);
      setInfo(form);
      // já respondido: só a tela final (reenviar só pelo nutricionista)
      if (form.estado === "respondido") { setRespostas({ nome: lead.nome || form.nome || "" }); setFase("fim"); return; }
      if (form.tipo === "retorno") setFase("intro");
      const local = lerLocal(token);
      const maisNovo = [local, servidor].filter((x) => x?.respostas)
        .sort((a, b) => String(b.atualizado_em || "").localeCompare(String(a.atualizado_em || "")))[0];
      if (maisNovo && Object.keys(maisNovo.respostas).length) {
        setRespostas(maisNovo.respostas);
        setCur(local?.cur || null);
        setRetomar(true);
      } else {
        const pre = {};
        if (lead.nome) pre.nome = lead.nome;
        if (lead.email) pre.email = lead.email;
        if (lead.peso) pre.peso_atual = String(lead.peso);
        if (lead.altura) pre.estatura = String(lead.altura);
        if (OBJETIVOS.includes(lead.objetivo)) { pre.objetivo = [lead.objetivo]; pre.objetivo_principal = lead.objetivo; }
        setRespostas(pre);
      }
    }).catch(() => {
      toast.error("Link inválido ou expirado");
      navigate("/");
    });
    return () => { ativo = false; };
  }, [token, navigate]);

  useEffect(() => () => { clearTimeout(timerAvanco.current); clearTimeout(timerRascunho.current); }, []);

  const lista = useMemo(() => (estrutura ? perguntasVisiveis(estrutura, respostas) : []), [estrutura, respostas]);
  const idx = Math.max(0, lista.findIndex((p) => p.id === cur));
  const pergunta = lista[idx];

  const salvarRascunho = useCallback((novas, posicao) => {
    const agora = new Date().toISOString();
    gravarLocal(token, { respostas: novas, cur: posicao, atualizado_em: agora });
    clearTimeout(timerRascunho.current);
    timerRascunho.current = setTimeout(() => {
      api.put(`/public/lead/${token}/rascunho`, { respostas: novas }).catch(() => { /* fica salvo no aparelho */ });
    }, 800);
  }, [token]);

  const irPara = useCallback((delta) => {
    clearTimeout(timerAvanco.current);
    const atual = lista[idx];
    if (delta > 0 && atual?.obrig && vazio(respostas[atual.id])) {
      setErro("Esta resposta é obrigatória.");
      return;
    }
    setErro("");
    const j = idx + delta;
    if (j < 0) setFase("intro");
    else if (j < lista.length) {
      setCur(lista[j].id);
      salvarRascunho(respostas, lista[j].id);
    }
    try { window.scrollTo(0, 0); } catch { /* sem janela */ }
  }, [idx, lista, respostas, salvarRascunho]);

  const responder = (id, valor, avancar = false) => {
    const novas = { ...respostas, [id]: valor };
    setRespostas(novas);
    setErro("");
    salvarRascunho(novas, id);
    if (avancar) {
      // escolha única: avança sozinho depois de mostrar a opção marcada. A próxima pergunta é calculada
      // com as respostas novas, porque a resposta pode abrir ou fechar perguntas condicionais.
      clearTimeout(timerAvanco.current);
      timerAvanco.current = setTimeout(() => avancarDepois(novas, id), 220);
    }
  };

  const avancarDepois = (novas, id) => {
    const nova = perguntasVisiveis(estrutura, novas);
    const i = nova.findIndex((p) => p.id === id);
    if (i >= 0 && i + 1 < nova.length) {
      setCur(nova[i + 1].id);
      salvarRascunho(novas, nova[i + 1].id);
      try { window.scrollTo(0, 0); } catch { /* sem janela */ }
    }
  };

  const enviar = async () => {
    if (pergunta?.obrig && vazio(respostas[pergunta.id])) {
      setErro("Esta resposta é obrigatória.");
      return;
    }
    setEnviando(true);
    try {
      const visiveis = new Set([...lista.map((p) => p.id), "objetivo_principal"]);
      const payload = Object.fromEntries(Object.entries(respostas).filter(([k, v]) => visiveis.has(k) && !vazio(v)));
      if (info?.tipo === "retorno") await api.post("/public/retorno", { token, respostas: payload });
      else await api.post("/public/anamnesis", { token, respostas: payload, consentimento_lgpd: consentimento });
      clearTimeout(timerRascunho.current);
      apagarLocal(token);
      setFase("fim");
      try { window.scrollTo(0, 0); } catch { /* sem janela */ }
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setEnviando(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-300 bg-rc-ink px-4">
        <div className="text-center">
          <p className="mb-4">Você precisa de um link de pré-consulta válido.</p>
          <Link to="/" className="rc-btn-primary">Voltar à página inicial</Link>
        </div>
      </div>
    );
  }
  if (!estrutura) {
    return <div className="min-h-screen bg-rc-ink flex items-center justify-center"><Loader2 className="w-6 h-6 text-rc-blue animate-spin" /></div>;
  }

  const nome = String(respostas.nome || "").trim().split(/\s+/)[0] || "";

  if (fase === "boas_vindas") return <BoasVindas onComecar={() => setFase("intro")} />;

  if (fase === "intro") {
    return (
      <Moldura>
        <div className="max-w-xl mt-6 space-y-5 animate-fade-up">
          <h1 className="rc-h2">{info?.tipo === "retorno" ? "Questionário de retorno" : "Formulário pré-consulta"}</h1>
          <p className="text-[15px] text-gray-300 leading-relaxed">
            {info?.tipo === "retorno"
              ? "Antes da sua reavaliação, conta como foram estas semanas. São 10 perguntas rápidas."
              : "Suas respostas são a base do seu plano alimentar e do seu treino. É uma pergunta por vez e leva cerca de 10 minutos. Responda com sinceridade, pensando na sua rotina real."}
          </p>
          <label className="flex items-start gap-3 rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/[0.08] cursor-pointer" data-testid="lgpd">
            <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-[#0081FD]" checked={consentimento} onChange={(e) => setConsentimento(e.target.checked)} />
            <span className="text-[13.5px] text-gray-300 leading-relaxed">
              Autorizo o uso dos meus dados pessoais e de saúde (respostas, exames e fotos) pelo Rogério Costa e equipe somente para a minha
              consultoria, conforme a Lei Geral de Proteção de Dados (LGPD). Meus dados não serão compartilhados com terceiros e posso pedir a
              exclusão a qualquer momento.
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button type="button" className="rc-btn-primary h-12 px-7" data-testid="preconsulta-comecar" disabled={!consentimento}
              onClick={() => { setFase("perguntas"); if (!retomar || !cur) setCur(lista[0]?.id); }}>
              {retomar ? "Continuar de onde parei" : "Começar"} <ArrowRight className="w-4 h-4" />
            </button>
            {retomar && (
              <button type="button" className="rc-btn-secondary h-12" disabled={!consentimento} onClick={() => { setFase("perguntas"); setCur(lista[0]?.id); }}>
                Revisar desde o início
              </button>
            )}
          </div>
          <button type="button" onClick={() => setFase("boas_vindas")} className="text-sm font-medium text-rc-blue hover:underline">
            Voltar para a página inicial
          </button>
        </div>
      </Moldura>
    );
  }

  if (fase === "fim") {
    return <Final nome={nome} info={info} retorno={info?.tipo === "retorno"} />;
  }

  // ── uma pergunta por tela ──
  const bloco = estrutura.blocos[pergunta.blocoIndex];
  const primeiraDoBloco = idx === 0 || lista[idx - 1].bloco !== pergunta.bloco;
  const transicao = primeiraDoBloco
    ? (nome ? bloco.transicao.replace("{nome}", nome) : bloco.transicao.replace(/Prazer, \{nome\}! /, ""))
    : "";
  const pct = Math.round(((idx + 1) / lista.length) * 100);
  const ultima = idx === lista.length - 1;
  const valor = respostas[pergunta.id];
  const autoAvanca = pergunta.tipo === "unica" || pergunta.tipo === "escala";
  const bloqueado = pergunta.obrig && vazio(valor);
  const idade = pergunta.id === "data_nascimento" ? idadeAnos(valor) : null;

  return (
    <div className="min-h-screen bg-rc-ink">
      <header className="sticky top-0 z-10 bg-rc-ink/90 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[13px] font-medium text-gray-300 truncate" data-testid="preconsulta-bloco">
              Bloco {pergunta.blocoIndex + 1} de {estrutura.blocos.length}: {bloco.titulo}
            </p>
            <span className="rc-num text-[18px] text-rc-blue tabular">{pct}%</span>
          </div>
          <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso do formulário"
            className="mt-2 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
            <div className="h-full bg-rc-blue rounded-full transition-[width] duration-300 ease-out" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 pt-8 pb-16" key={pergunta.id}>
        <div className="space-y-5 animate-fade-up">
          {transicao && <p className="text-rc-blue font-semibold text-[15px]">{transicao}</p>}
          <h1 className="text-[22px] sm:text-[24px] font-semibold text-white leading-snug">
            {pergunta.titulo}{pergunta.obrig && <span className="text-rc-coral ml-1" aria-label="obrigatória">*</span>}
          </h1>
          {pergunta.desc && <p className="text-[14px] text-gray-400 whitespace-pre-line leading-relaxed">{pergunta.desc}</p>}

          <Entrada pergunta={pergunta} valor={valor} token={token} respostas={respostas} tipoForm={info?.tipo}
            onChange={(v, avancar, extra) => (extra ? (() => { const novas = { ...respostas, [pergunta.id]: v, ...extra }; setRespostas(novas); salvarRascunho(novas, pergunta.id); })() : responder(pergunta.id, v, avancar))}
            onEnter={() => (ultima ? enviar() : irPara(1))} />

          {idade !== null && <p className="text-rc-blue font-semibold">Idade: {idade} {idade === 1 ? "ano" : "anos"}</p>}
          {erro && <p role="alert" className="text-rc-coral font-medium text-sm">{erro}</p>}

          <div className="flex items-center justify-between gap-3 pt-3">
            <button type="button" onClick={() => irPara(-1)} className="rc-btn-secondary h-12" data-testid="preconsulta-voltar">
              <ArrowLeft className="w-4 h-4" /> Voltar
            </button>
            {ultima ? (
              <button type="button" onClick={enviar} disabled={enviando || bloqueado} className="rc-btn-primary h-12 px-6" data-testid="preconsulta-enviar">
                {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Enviar respostas
              </button>
            ) : (!autoAvanca || !vazio(valor)) && (
              <button type="button" onClick={() => irPara(1)} disabled={bloqueado} className="rc-btn-primary h-12 px-6" data-testid="preconsulta-continuar">
                Continuar <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
          <p className="text-[12px] text-gray-500">Suas respostas ficam salvas: se precisar sair, é só abrir o mesmo link depois.</p>
        </div>
      </main>
    </div>
  );
}

function Moldura({ children }) {
  return (
    <div className="min-h-screen bg-rc-ink">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        <Link to="/" aria-label="Página inicial"><Brand size="sm" /></Link>
        {children}
      </div>
    </div>
  );
}

const opcaoClasse = (on) =>
  `w-full min-h-[52px] px-4 py-3 rounded-xl border text-left text-[15px] transition-colors duration-150 ${
    on ? "bg-rc-blue/15 border-rc-blue text-white" : "bg-white/[0.03] border-white/[0.1] text-gray-200 hover:border-rc-blue/50"}`;

function Entrada({ pergunta, valor, token, respostas, tipoForm, onChange, onEnter }) {
  const { tipo } = pergunta;
  if (tipo === "objetivos") {
    const lista = Array.isArray(valor) ? valor : [];
    return <SeletorObjetivos grande valor={lista} principal={respostas.objetivo_principal} onChange={(l, princ) => onChange(l, false, { objetivo_principal: princ })} />;
  }
  if (tipo === "rotina") return <EntradaRotina valor={valor} onChange={onChange} />;
  if (tipo === "fotos") return <EntradaFotos valor={valor} token={token} tipoForm={tipoForm} onChange={onChange} />;
  if (tipo === "unica") {
    return (
      <div className="space-y-2.5" role="radiogroup" aria-label={pergunta.titulo}>
        {opcoesVisiveis(pergunta, respostas).map((o) => (
          <button key={o} type="button" role="radio" aria-checked={valor === o} onClick={() => onChange(o, true)} className={opcaoClasse(valor === o)}>
            {o}
          </button>
        ))}
      </div>
    );
  }
  if (tipo === "multipla") {
    const atual = Array.isArray(valor) ? valor : [];
    const alternar = (o) => {
      let novo;
      if (atual.includes(o)) novo = atual.filter((x) => x !== o);
      else if (o === pergunta.exclusivo) novo = [o];
      else novo = atual.filter((x) => x !== pergunta.exclusivo).concat(o);
      onChange(novo);
    };
    return (
      <div className="space-y-2.5">
        <p className="text-[12px] text-gray-500">Pode marcar mais de uma.</p>
        {opcoesVisiveis(pergunta, respostas).map((o) => (
          <button key={o} type="button" aria-pressed={atual.includes(o)} onClick={() => alternar(o)} className={`${opcaoClasse(atual.includes(o))} flex items-center gap-3`}>
            <span className={`w-5 h-5 shrink-0 rounded-md border flex items-center justify-center ${atual.includes(o) ? "bg-rc-blue border-rc-blue" : "border-white/25"}`}>
              {atual.includes(o) && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
            </span>
            {o}
          </button>
        ))}
      </div>
    );
  }
  if (tipo === "escala") {
    const nums = Array.from({ length: (pergunta.max ?? 10) - (pergunta.min ?? 0) + 1 }, (_, i) => String((pergunta.min ?? 0) + i));
    return (
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={pergunta.titulo}>
        {nums.map((n) => (
          <button key={n} type="button" role="radio" aria-checked={String(valor) === n} onClick={() => onChange(n, true)}
            className={`w-12 h-12 rounded-xl border font-semibold tabular transition-colors ${String(valor) === n ? "bg-rc-blue border-rc-blue text-white" : "bg-white/[0.03] border-white/[0.1] text-gray-200 hover:border-rc-blue/50"}`}>
            {n}
          </button>
        ))}
      </div>
    );
  }
  if (tipo === "longo") {
    return <textarea className="rc-input min-h-[120px] leading-relaxed resize-y" rows={pergunta.rows || 4} aria-label={pergunta.titulo}
      value={valor || ""} onChange={(e) => onChange(e.target.value)} autoFocus />;
  }
  if (tipo === "arquivo") return <EntradaArquivo pergunta={pergunta} valor={valor} token={token} onChange={onChange} />;
  const inputType = { email: "email", data: "date", numero: "text" }[tipo] || "text";
  return (
    <input className="rc-input h-14 text-[16px]" type={inputType} aria-label={pergunta.titulo} autoFocus
      inputMode={tipo === "numero" ? "decimal" : undefined}
      value={valor || ""} onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onEnter(); } }} />
  );
}

const ROTINA_PADRAO = [
  { horario: "07:00", refeicao: "Café da manhã", alimentos: "" },
  { horario: "10:00", refeicao: "Lanche da manhã", alimentos: "" },
  { horario: "12:30", refeicao: "Almoço", alimentos: "" },
  { horario: "16:00", refeicao: "Lanche da tarde", alimentos: "" },
  { horario: "20:00", refeicao: "Jantar", alimentos: "" },
];

/** Rotina alimentar guiada: horário, refeição e o que come (vira o rascunho do Recordatório). */
function EntradaRotina({ valor, onChange }) {
  const linhas = Array.isArray(valor) && valor.length ? valor : ROTINA_PADRAO;
  const set = (i, k, v) => onChange(linhas.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="space-y-3" data-testid="rotina-guiada">
      {linhas.map((r, i) => (
        <div key={i} className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/[0.08] space-y-2">
          <div className="flex gap-2">
            <input className="rc-input h-11 w-24 tabular" value={r.horario} onChange={(e) => set(i, "horario", e.target.value)} placeholder="07:00" aria-label={`Horário da refeição ${i + 1}`} inputMode="numeric" />
            <input className="rc-input h-11 flex-1" value={r.refeicao} onChange={(e) => set(i, "refeicao", e.target.value)} placeholder="Refeição" aria-label={`Nome da refeição ${i + 1}`} />
            <button type="button" onClick={() => onChange(linhas.filter((_, j) => j !== i))} className="px-2 text-gray-500 hover:text-white" aria-label={`Remover refeição ${i + 1}`}><X className="h-4 w-4" /></button>
          </div>
          <textarea className="rc-input min-h-[60px] leading-relaxed" rows={2} value={r.alimentos} onChange={(e) => set(i, "alimentos", e.target.value)}
            placeholder="O que você come (ex.: 2 fatias de pão + 1 ovo + café)" aria-label={`O que come na refeição ${i + 1}`} />
        </div>
      ))}
      <button type="button" onClick={() => onChange([...linhas, { horario: "", refeicao: "", alimentos: "" }])} className="rc-btn-secondary h-11"><Plus className="h-4 w-4" /> Adicionar refeição</button>
    </div>
  );
}

/** 3 fotos de avaliação (frente, lado, costas), reduzidas antes de enviar. */
function EntradaFotos({ valor, token, tipoForm, onChange }) {
  const enviadas = Array.isArray(valor) ? valor : [];
  const [enviando, setEnviando] = useState("");
  const [previas, setPrevias] = useState({});
  const enviar = async (pose, file) => {
    if (!file) return;
    setEnviando(pose);
    try {
      const dataUrl = await fotoReduzida(file);
      const { data } = await api.post(`/public/lead/${token}/foto`, { pose, data_url: dataUrl, tipo: tipoForm === "retorno" ? "retorno" : "inicial" });
      setPrevias((s) => ({ ...s, [pose]: dataUrl }));
      onChange([...enviadas.filter((f) => f.pose !== pose), { pose, id: data.id }]);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Não foi possível enviar a foto."); } finally { setEnviando(""); }
  };
  return (
    <div className="grid grid-cols-3 gap-3" data-testid="fotos-formulario">
      {[["frente", "Frente"], ["lado", "Lado"], ["costas", "Costas"]].map(([pose, rotulo]) => {
        const ok = enviadas.some((f) => f.pose === pose);
        return (
          <label key={pose} className={`relative flex aspect-[3/4] cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border-2 ${ok ? "border-rc-blue" : "border-dashed border-white/[0.14] hover:border-rc-blue/50"} bg-white/[0.02] text-gray-300`}>
            <input type="file" accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer" aria-label={`Foto de ${rotulo.toLowerCase()}`} onChange={(e) => { enviar(pose, e.target.files?.[0]); e.target.value = ""; }} />
            {previas[pose] ? <img src={previas[pose]} alt={rotulo} className="absolute inset-0 h-full w-full object-cover" /> : enviando === pose ? <Loader2 className="h-5 w-5 animate-spin text-rc-blue" /> : ok ? <Check className="h-6 w-6 text-rc-blue" /> : <Camera className="h-6 w-6 text-rc-blue" />}
            <span className="relative rounded bg-black/50 px-2 text-[12px] font-semibold">{rotulo}{ok ? " ✓" : ""}</span>
          </label>
        );
      })}
    </div>
  );
}

function EntradaArquivo({ pergunta, valor, token, onChange }) {
  const arquivos = Array.isArray(valor) ? valor : [];
  const [enviando, setEnviando] = useState(false);
  const enviar = async (files) => {
    const lista = Array.from(files || []);
    if (!lista.length) return;
    setEnviando(true);
    const novos = [...arquivos];
    for (const f of lista) {
      if (f.size > 10 * 1024 * 1024) { toast.error(`${f.name}: maior que 10 MB`); continue; }
      try {
        const fd = new FormData();
        fd.append("file", f);
        const { data } = await api.post(`/public/lead/${token}/arquivo?destino=${pergunta.destino}`, fd);
        novos.push({ id: data.id, nome: data.nome });
      } catch (e) {
        toast.error(`${f.name}: ${formatApiError(e.response?.data?.detail)}`);
      }
    }
    onChange(novos);
    setEnviando(false);
  };
  return (
    <div className="space-y-3">
      <label className="relative flex flex-col items-center justify-center gap-2 min-h-[110px] rounded-xl border-2 border-dashed border-white/[0.14] hover:border-rc-blue/50 bg-white/[0.02] cursor-pointer text-gray-300 transition-colors">
        <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" className="absolute inset-0 opacity-0 cursor-pointer"
          aria-label={pergunta.titulo} onChange={(e) => { enviar(e.target.files); e.target.value = ""; }} disabled={enviando} />
        {enviando ? <Loader2 className="w-5 h-5 animate-spin text-rc-blue" /> : <Upload className="w-5 h-5 text-rc-blue" />}
        <span className="text-sm">{enviando ? "Enviando…" : "Toque para escolher os arquivos"}</span>
        <span className="text-[12px] text-gray-500">PDF, JPG ou PNG · até 10 MB cada</span>
      </label>
      {arquivos.length > 0 && (
        <ul className="space-y-1.5">
          {arquivos.map((a) => (
            <li key={a.id} className="flex items-center gap-2 text-sm text-gray-200 bg-white/[0.03] rounded-lg px-3 py-2">
              <FileText className="w-4 h-4 text-rc-blue shrink-0" /><span className="truncate flex-1">{a.nome}</span>
              <button type="button" aria-label={`Remover ${a.nome}`} onClick={() => onChange(arquivos.filter((x) => x.id !== a.id))}
                className="text-gray-500 hover:text-white p-1"><X className="w-4 h-4" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BoasVindas({ onComecar }) {
  return (
    <div className="min-h-screen bg-rc-ink text-white">
      <section className="max-w-5xl mx-auto grid md:grid-cols-2 items-center">
        <img src="/landing/rogerio.jpg" alt="Rogério Costa de braços cruzados em uma academia" className="w-full h-[46vh] md:h-[640px] object-cover object-top" />
        <div className="px-5 sm:px-8 py-10 space-y-5">
          <Brand size="sm" />
          <h1 className="rc-display text-[clamp(19px,2.8vw,29px)] leading-[1.05]">Bem-vindo(a) à sua <span className="text-rc-blue">jornada de evolução!</span></h1>
          <p className="text-[17px] text-gray-300 leading-relaxed">
            Você está iniciando um caminho de transformação real. Estou ao seu lado para garantir resultados concretos e fazer de você o
            próximo grande caso de sucesso do nosso time.
          </p>
          <p className="text-[13px] text-gray-500">Rogério Costa · Treinador e Nutricionista</p>
        </div>
      </section>
      <section className="border-t border-white/[0.06] bg-white/[0.015]">
        <div className="max-w-2xl mx-auto px-5 sm:px-8 py-14 text-center space-y-5">
          <span className="inline-block rounded-full bg-rc-blue/15 text-rc-blue px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.14em]">Primeiro passo</span>
          <h2 className="rc-h2">Formulário pré-consulta</h2>
          <p className="text-gray-300 leading-relaxed">
            Antes de iniciarmos sua consultoria, preciso conhecer mais sobre você: seus hábitos, rotina, histórico e objetivos. Esse é o
            ponto de partida para criar um plano totalmente personalizado, com estratégias que realmente funcionam para o seu estilo de vida.
          </p>
          <p className="text-[18px] font-semibold text-white">Para começar, preencha o questionário clicando no botão abaixo.</p>
          <button type="button" onClick={onComecar} className="rc-btn-primary h-14 px-8 text-[15px]" data-testid="preconsulta-boas-vindas">
            Preencher pré-consulta <ArrowRight className="w-4 h-4" />
          </button>
          <div className="space-y-3 text-[14px] text-gray-400 leading-relaxed pt-4 text-left sm:text-center">
            <p>Reserve cerca de 10 minutos para responder com atenção e sinceridade.</p>
            <p>Suas respostas são essenciais para entendermos quem você é e criarmos um plano que se adapte à sua rotina e às suas preferências.</p>
            <p>Quanto mais detalhes você fornecer, melhor poderemos atender às suas necessidades e ajudá-lo(a) a alcançar seus objetivos.</p>
          </div>
        </div>
      </section>

      {/* Segundo passo: protocolo de fotos (como no protótipo do Rogério) */}
      <section className="max-w-5xl mx-auto px-5 sm:px-8 py-14 space-y-8" data-testid="boas-vindas-protocolo">
        <div className="text-center space-y-4 max-w-2xl mx-auto">
          <SeloPasso>Segundo passo</SeloPasso>
          <h2 className="rc-h2">Protocolo de fotos</h2>
          <p className="text-gray-300 leading-relaxed">
            Seguir as diretrizes do nosso Protocolo de Fotos é crucial. Nosso objetivo é oferecer suporte, não fazer julgamentos.
            Diariamente, analisamos fotos de avaliação física de todos os tipos de corpos. Nesta fase, nosso único propósito é entender
            como podemos ajudá-lo(a) melhor e acompanhar sua jornada de transformação.
          </p>
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          {REGRAS.map((r) => (
            <div key={r.t} className="rc-card p-5 border-t-2 border-rc-blue">
              <h3 className="text-[13px] uppercase tracking-[0.14em] text-rc-blue font-semibold">{r.t}</h3>
              <ul className="mt-3 space-y-2 text-[14px] text-gray-300 leading-relaxed">{r.itens.map((i) => <li key={i}>{i}</li>)}</ul>
            </div>
          ))}
        </div>
        <p className="text-center text-[14px] text-gray-400">Essas orientações são padrão para todos os relatórios enviados, garantindo uma avaliação consistente e precisa.</p>
      </section>

      {/* Terceiro passo: padrão de fotos (provas de vida) */}
      <section className="border-t border-white/[0.06] bg-white/[0.015]" data-testid="boas-vindas-padrao">
        <div className="max-w-5xl mx-auto px-5 sm:px-8 py-14 space-y-8">
          <div className="text-center space-y-4">
            <SeloPasso>Terceiro passo</SeloPasso>
            <h2 className="rc-h2">Padrão de fotos</h2>
          </div>
          {[["homem", "Homens"], ["mulher", "Mulheres"]].map(([g, rotulo]) => (
            <div key={g}>
              <h3 className="text-[13px] uppercase tracking-[0.14em] text-rc-blue font-semibold mb-3">{rotulo}</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {POSES.map(([k, l]) => (
                  <figure key={k} className="rounded-xl overflow-hidden bg-rc-surfaceAlt ring-1 ring-white/[0.06]">
                    <img src={`/protocolo-fotos/${g}-${k}.jpg`} alt={`${rotulo === "Homens" ? "Homem" : "Mulher"}: ${l.toLowerCase()}`} loading="lazy" className="w-full aspect-[3/4] object-cover" />
                    <figcaption className="px-3 py-2 text-[12.5px] text-gray-400">{l}</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          ))}
          <div className="max-w-3xl space-y-3 pt-2">
            <h3 className="text-[17px] font-semibold text-rc-blue">Atualizações e feedbacks</h3>
            <p className="text-gray-300 leading-relaxed">Após nosso primeiro encontro, é crucial que você nos mantenha atualizados semanalmente com seu peso e com as fotos padrão. A pesagem deve ser realizada em jejum, logo após acordar.</p>
            <p className="text-gray-300 leading-relaxed">Essas atualizações, juntamente com seus feedbacks, são essenciais para que possamos acompanhar de perto seu progresso e ajustar seu plano conforme necessário.</p>
            <p className="text-gray-300 leading-relaxed">Nossa consultoria online funciona em conjunto, com base nas suas experiências e necessidades. Por isso, sua participação ativa é fundamental. Não hesite em nos informar sobre quaisquer problemas ou dúvidas que surgirem durante o processo.</p>
            <p className="text-white font-medium">Juntos, estaremos sempre alinhados e evoluindo em direção aos seus objetivos.</p>
          </div>
          <div className="text-center pt-4">
            <button type="button" onClick={onComecar} className="rc-btn-primary h-14 px-8 text-[15px]">
              Preencher pré-consulta <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function SeloPasso({ children }) {
  return <span className="inline-block rounded-full bg-rc-blue/15 text-rc-blue px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.14em]">{children}</span>;
}

async function fotoReduzida(file, maxSize = 1280, quality = 0.78) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const ratio = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * ratio);
        canvas.height = Math.round(img.height * ratio);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function Final({ nome, info, retorno }) {
  const consulta = info?.consulta?.data_hora ? new Date(info.consulta.data_hora) : null;
  const fone = info?.whatsapp || WHATSAPP_PADRAO;
  const zap = `https://wa.me/${fone.length <= 11 ? `55${fone}` : fone}?text=${encodeURIComponent(`Oi, Rogério! Aqui é ${nome || "o(a) paciente"}. Acabei de enviar o ${retorno ? "questionário de retorno" : "formulário"}.`)}`;
  return (
    <Moldura>
      <div className="mt-10 max-w-xl space-y-6 animate-fade-up" data-testid="preconsulta-final">
        <CheckCircle2 className="w-12 h-12 text-rc-blue" />
        <div className="space-y-3">
          <h1 className="rc-h2">{nome ? `Obrigado, ${nome}!` : "Obrigado!"} Recebemos suas informações.</h1>
          <p className="text-[16px] text-gray-300 leading-relaxed">
            Agora vou analisar tudo com calma para montar um plano feito pra você. Qualquer dúvida, é só chamar no WhatsApp.
          </p>
          <p className="text-[15px] font-semibold text-white">Te vejo na consulta — Rogerio Costa</p>
        </div>
        {consulta && !Number.isNaN(consulta.getTime()) && (
          <div className="flex items-center gap-3 rounded-xl bg-rc-blue/10 px-4 py-3 ring-1 ring-rc-blue/30" data-testid="final-consulta">
            <CalendarDays className="h-5 w-5 text-rc-blue" />
            <div>
              <div className="text-[11px] uppercase tracking-[0.14em] text-gray-400">Sua consulta</div>
              <div className="text-[15px] font-semibold text-white">
                {consulta.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })} às {consulta.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
          </div>
        )}
        <a href={zap} target="_blank" rel="noopener noreferrer" className="rc-btn-primary h-12 px-6 inline-flex" data-testid="final-whatsapp">
          <MessageCircle className="w-4 h-4" /> Falar no WhatsApp
        </a>
      </div>
    </Moldura>
  );
}
