import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, FileText, Loader2, Pencil, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/evo-api";
import { abrirAnexo, carregarEstrutura, respostasPlanas, textoResposta, vazio, visivel } from "@/lib/anamnese";
import SeletorObjetivos from "./SeletorObjetivos";

/**
 * Anamnese organizada pelos blocos do formulário pré-consulta (o Bloco 1, dados pessoais, fica no card do topo).
 * Mostra o que o cliente respondeu; o nutricionista edita qualquer resposta ou preenche manualmente, e a edição
 * salva sozinha. Dado antigo sem pergunta equivalente aparece em "Outras informações" do bloco.
 */
export default function AnamneseBlocos({ pacienteId, sexoPaciente, inicial }) {
  const [estrutura, setEstrutura] = useState(null);
  const [doc, setDoc] = useState(inicial || {});
  const [abertos, setAbertos] = useState(() => new Set());
  const [estado, setEstado] = useState("");
  // respostas do cliente em modo leitura; "Editar respostas" libera a edição (sem formulário, já abre editando)
  const [editando, setEditando] = useState(() => !(inicial?.enviado_em));
  const pendente = useRef({ respostas: {}, outras: {} });
  const timer = useRef(null);

  useEffect(() => {
    carregarEstrutura().then(setEstrutura).catch(() => toast.error("Não foi possível carregar as perguntas da anamnese."));
    // a leitura também migra a anamnese antiga para os blocos, na primeira vez
    api.get(`/patients/${pacienteId}/anamnese-v2`).then((r) => setDoc(r.data || {})).catch(() => {});
  }, [pacienteId]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const formulario = useMemo(() => doc.formulario || {}, [doc.formulario]);
  const outras = useMemo(() => doc.formulario_outras || {}, [doc.formulario_outras]);
  const planas = useMemo(() => {
    const p = respostasPlanas(formulario);
    if (vazio(p.sexo) && sexoPaciente) p.sexo = { F: "Feminino", M: "Masculino" }[sexoPaciente];
    return p;
  }, [formulario, sexoPaciente]);

  const salvar = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const envio = pendente.current;
      pendente.current = { respostas: {}, outras: {} };
      setEstado("salvando");
      try {
        const { data } = await api.patch(`/patients/${pacienteId}/anamnese-form`, {
          respostas: envio.respostas, ...(Object.keys(envio.outras).length ? { outras: envio.outras } : {}),
        });
        // mantém o que foi digitado enquanto salvava
        setDoc((atual) => mesclarPendente(data, pendente.current, atual));
        setEstado("salvo");
      } catch (e) {
        pendente.current = {
          respostas: { ...envio.respostas, ...pendente.current.respostas },
          outras: mesclarOutras(envio.outras, pendente.current.outras),
        };
        setEstado("erro");
        toast.error(formatApiError(e.response?.data?.detail));
      }
    }, 700);
  };

  const mudarResposta = (bloco, id, valor) => {
    setDoc((atual) => ({ ...atual, formulario: { ...(atual.formulario || {}), [bloco]: { ...((atual.formulario || {})[bloco] || {}), [id]: valor } } }));
    pendente.current.respostas[id] = valor;
    setEstado("editando");
    salvar();
  };
  const mudarOutra = (bloco, rotulo, valor) => {
    setDoc((atual) => ({ ...atual, formulario_outras: { ...(atual.formulario_outras || {}), [bloco]: { ...((atual.formulario_outras || {})[bloco] || {}), [rotulo]: valor } } }));
    pendente.current.outras = mesclarOutras(pendente.current.outras, { [bloco]: { [rotulo]: valor } });
    setEstado("editando");
    salvar();
  };

  if (!estrutura) return <div className="evo-card p-5 text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Carregando anamnese…</div>;

  const enviadoEm = doc.enviado_em ? new Date(doc.enviado_em).toLocaleDateString("pt-BR") : null;
  // numeração contínua só das perguntas que aparecem (não pula número de pergunta escondida)
  const blocosVisiveis = estrutura.blocos.filter((b) => b.key !== "dados_pessoais" && b.key !== "fotos");
  const totais = blocosVisiveis.reduce((t, b) => {
    const ps = b.perguntas.filter((q) => q.tipo !== "interno" && q.tipo !== "fotos" && visivel(q, planas));
    return { total: t.total + ps.length, respondidas: t.respondidas + ps.filter((q) => !vazio(planas[q.id])).length };
  }, { total: 0, respondidas: 0 });
  const numeros = {};
  let contador = 0;
  estrutura.blocos.forEach((b) => b.perguntas.forEach((p) => {
    if (p.tipo === "interno" || p.tipo === "fotos") return;
    if (visivel(p, planas) || !vazio(planas[p.id])) { contador += 1; numeros[p.id] = contador; }
  }));

  return (
    <div className="space-y-3" data-testid="anamnese-blocos">
      <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-[12px] text-gray-500 min-h-[20px]">
        <span data-testid="formulario-resumo">
          {enviadoEm ? `Formulário respondido em ${enviadoEm}` : "Formulário ainda não respondido (pode preencher manualmente)"}
          {` · ${totais.respondidas} de ${totais.total} respondidas`}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          {blocosVisiveis.map((b, i) => (
            <button key={b.key} type="button" onClick={() => { setAbertos((s) => new Set(s).add(b.key)); setTimeout(() => document.querySelector(`[data-testid=anamnese-bloco-${b.key}]`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); }}
              className="rounded-md bg-white/[0.05] px-2 py-1 text-[11.5px] text-gray-300 hover:text-white">{i + 2}. {b.titulo}</button>
          ))}
          <button type="button" onClick={() => setAbertos((s) => (s.size >= blocosVisiveis.length ? new Set() : new Set(blocosVisiveis.map((b) => b.key))))} className="rc-btn-ghost h-7 text-[11.5px]" data-testid="expandir-tudo">
            {abertos.size >= blocosVisiveis.length ? "Recolher tudo" : "Expandir tudo"}
          </button>
        </span>
        <span className="flex items-center gap-3">
          <EstadoSalvar estado={estado} />
          <button type="button" onClick={() => setEditando((v) => !v)} className="rc-btn-ghost h-8 text-[12.5px]" data-testid="editar-respostas">
            {editando ? <><Check className="h-3.5 w-3.5" /> Concluir edição</> : <><Pencil className="h-3.5 w-3.5" /> Editar respostas</>}
          </button>
        </span>
      </div>
      {estrutura.blocos.filter((b) => b.key !== "dados_pessoais").map((b, i) => {
        const perguntas = b.perguntas.filter((p) => p.tipo !== "interno" && p.tipo !== "fotos" && (visivel(p, planas) || !vazio(planas[p.id])));
        if (!perguntas.length) return null;
        const respondidas = perguntas.filter((p) => !vazio(planas[p.id])).length;
        const extras = Object.entries(outras[b.key] || {});
        const aberto = abertos.has(b.key);
        return (
          <section key={b.key} className="evo-card overflow-hidden" data-testid={`anamnese-bloco-${b.key}`}>
            <button type="button" aria-expanded={aberto}
              onClick={() => setAbertos((s) => { const n = new Set(s); n.has(b.key) ? n.delete(b.key) : n.add(b.key); return n; })}
              className="w-full flex items-center gap-3 p-4 text-left hover:bg-white/[0.02] transition-colors">
              <span className="rc-num text-[15px] text-gray-500 w-5">{i + 2}</span>
              <span className="font-semibold text-[15px] text-white flex-1">{b.titulo}</span>
              <span className={`text-[12px] tabular ${respondidas === perguntas.length ? "text-rc-lime" : "text-gray-500"}`}>
                {respondidas}/{perguntas.length} respondidas
              </span>
              {extras.length > 0 && <span className="text-[11px] text-gray-400 bg-white/[0.05] rounded-full px-2 py-0.5">+{extras.length} outras</span>}
              <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${aberto ? "rotate-180" : ""}`} />
            </button>
            {!aberto && respondidas > 0 && (
              <ul className="-mt-1 px-4 pb-3 pl-12 space-y-0.5 text-[12.5px]" data-testid={`previa-${b.key}`}>
                {perguntas.filter((q) => !vazio(planas[q.id])).slice(0, 3).map((q) => (
                  <li key={q.id} className="truncate text-gray-400"><span className="text-gray-500">{q.titulo.replace(/\?.*$/, "?")}</span> <span className="text-gray-200">{textoResposta(q, planas[q.id])}</span></li>
                ))}
              </ul>
            )}
            {aberto && (
              <div className="px-4 pb-5 divide-y divide-white/[0.05]">
                {perguntas.map((p) => (
                  <div key={p.id} className="py-3.5 grid md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-6 gap-y-2">
                    <label className="text-[13px] text-gray-400 leading-snug" htmlFor={`anam-${p.id}`}>
                      <span className="text-gray-600 tabular mr-1.5">{numeros[p.id]}.</span>{p.titulo}
                    </label>
                    {editando || p.tipo === "arquivo" ? (
                      <Editor pergunta={p} valor={planas[p.id]} planas={planas} pacienteId={pacienteId}
                        onChange={(v, extra) => { mudarResposta(b.key, p.id, v); if (extra) Object.entries(extra).forEach(([k, x]) => mudarResposta(b.key, k, x)); }} />
                    ) : (
                      <Leitura pergunta={p} valor={planas[p.id]} planas={planas} />
                    )}
                  </div>
                ))}
                {extras.length > 0 && (
                  <div className="pt-4">
                    <div className="text-[11px] uppercase tracking-[0.12em] text-gray-500 mb-2">Outras informações (anamnese antiga)</div>
                    {extras.map(([rotulo, valor]) => (
                      <div key={rotulo} className="py-2 grid md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-6 gap-y-1">
                        <span className="text-[13px] text-gray-400">{rotulo}</span>
                        <TextoAuto valor={valor} onChange={(v) => mudarOutra(b.key, rotulo, v)} label={rotulo} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function mesclarOutras(a, b) {
  const out = { ...a };
  Object.entries(b || {}).forEach(([bloco, itens]) => { out[bloco] = { ...(out[bloco] || {}), ...itens }; });
  return out;
}

function mesclarPendente(servidor, pend, atual) {
  const doc = { ...servidor, formulario: { ...(servidor.formulario || {}) }, formulario_outras: { ...(servidor.formulario_outras || {}) } };
  Object.keys(pend.respostas).forEach((id) => {
    const bloco = Object.keys(atual.formulario || {}).find((b) => id in ((atual.formulario || {})[b] || {}));
    if (bloco) doc.formulario[bloco] = { ...(doc.formulario[bloco] || {}), [id]: pend.respostas[id] };
  });
  return { ...doc, formulario_outras: mesclarOutras(doc.formulario_outras, pend.outras) };
}

function EstadoSalvar({ estado }) {
  if (estado === "salvando" || estado === "editando") return <span className="flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" />Salvando…</span>;
  if (estado === "salvo") return <span className="flex items-center gap-1.5 text-rc-lime"><Check className="w-3 h-3" />Salvo</span>;
  if (estado === "erro") return <span className="text-rc-coral">Não salvou: tente de novo</span>;
  return null;
}

function TextoAuto({ valor, onChange, label, id }) {
  const linhas = Math.min(10, Math.max(1, String(valor || "").split("\n").length + Math.floor(String(valor || "").length / 70)));
  return (
    <textarea id={id} aria-label={label} rows={linhas} value={valor ?? ""} onChange={(e) => onChange(e.target.value)}
      className="evo-input py-2 leading-relaxed resize-y min-h-[38px]" placeholder="—" />
  );
}

function Leitura({ pergunta: p, valor, planas }) {
  if (vazio(valor)) return <span className="text-[13px] italic text-rc-amber/80">perguntar na consulta</span>;
  if (p.tipo === "objetivos") {
    const lista = Array.isArray(valor) ? valor : [String(valor)];
    const princ = lista.includes(planas.objetivo_principal) ? planas.objetivo_principal : lista[0];
    return <span className="flex flex-wrap gap-1.5">{lista.map((o) => <span key={o} className={`rounded-lg px-2 py-0.5 text-[12.5px] ${o === princ ? "bg-rc-lime/15 font-semibold text-rc-lime" : "bg-white/[0.05] text-gray-200"}`}>{o === princ ? `★ ${o}` : o}</span>)}</span>;
  }
  if (p.tipo === "rotina" && Array.isArray(valor)) {
    return (
      <ul className="space-y-1 text-[13.5px] text-gray-100">
        {valor.map((r, i) => <li key={i}><span className="tabular text-gray-400">{r.horario}</span> {r.refeicao && <b className="font-semibold">{r.refeicao}:</b>} {r.alimentos}</li>)}
      </ul>
    );
  }
  return <span className="whitespace-pre-line text-[13.5px] text-gray-100">{textoResposta(p, valor)}</span>;
}

function EditorRotina({ valor, onChange }) {
  const linhas = Array.isArray(valor) ? valor : [];
  if (!Array.isArray(valor) && !vazio(valor)) return <TextoAuto valor={valor} onChange={onChange} label="Rotina alimentar" />;
  const set = (i, k, v) => onChange(linhas.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="space-y-1.5">
      {linhas.map((r, i) => (
        <div key={i} className="grid grid-cols-[70px_minmax(0,140px)_minmax(0,1fr)_28px] gap-1.5">
          <input className="evo-input h-9" value={r.horario || ""} onChange={(e) => set(i, "horario", e.target.value)} placeholder="07:00" aria-label="Horário" />
          <input className="evo-input h-9" value={r.refeicao || ""} onChange={(e) => set(i, "refeicao", e.target.value)} placeholder="Refeição" aria-label="Refeição" />
          <input className="evo-input h-9" value={r.alimentos || ""} onChange={(e) => set(i, "alimentos", e.target.value)} placeholder="O que come" aria-label="O que come" />
          <button type="button" onClick={() => onChange(linhas.filter((_, j) => j !== i))} className="text-gray-500 hover:text-white" aria-label="Remover refeição"><X className="h-4 w-4" /></button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...linhas, { horario: "", refeicao: "", alimentos: "" }])} className="rc-btn-ghost h-8 -ml-2 text-[12.5px] text-rc-blueLight"><Plus className="h-3.5 w-3.5" /> Refeição</button>
    </div>
  );
}

function Editor({ pergunta: p, valor, planas, pacienteId, onChange }) {
  const id = `anam-${p.id}`;
  if (p.tipo === "objetivos") {
    const lista = Array.isArray(valor) ? valor : vazio(valor) ? [] : [String(valor)];
    return <SeletorObjetivos valor={lista} principal={planas?.objetivo_principal} onChange={(l, princ) => onChange(l, { objetivo_principal: princ })} />;
  }
  if (p.tipo === "rotina") return <EditorRotina valor={valor} onChange={onChange} />;
  if (p.tipo === "unica" || p.tipo === "escala") {
    const opcoes = p.tipo === "escala" ? Array.from({ length: (p.max ?? 10) - (p.min ?? 0) + 1 }, (_, i) => String((p.min ?? 0) + i)) : p.opcoes;
    const legado = !vazio(valor) && !opcoes.includes(String(valor)); // resposta antiga em texto livre
    return (
      <select id={id} className="evo-input h-10" value={vazio(valor) ? "" : String(valor)} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {legado && <option value={String(valor)}>{String(valor)}</option>}
        {opcoes.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (p.tipo === "multipla") {
    const atual = Array.isArray(valor) ? valor : vazio(valor) ? [] : [String(valor)];
    const todas = [...p.opcoes, ...atual.filter((v) => !p.opcoes.includes(v))];
    const alternar = (o) => {
      if (atual.includes(o)) onChange(atual.filter((x) => x !== o));
      else if (o === p.exclusivo) onChange([o]);
      else onChange(atual.filter((x) => x !== p.exclusivo).concat(o));
    };
    return (
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={p.titulo}>
        {todas.map((o) => (
          <button key={o} type="button" aria-pressed={atual.includes(o)} onClick={() => alternar(o)}
            className={`px-2.5 py-1 rounded-lg border text-[12.5px] text-left transition-colors ${atual.includes(o) ? "bg-rc-blue/15 border-rc-blue/60 text-white" : "border-white/[0.08] text-gray-400 hover:text-gray-200"}`}>
            {o}
          </button>
        ))}
      </div>
    );
  }
  if (p.tipo === "arquivo") {
    const arquivos = Array.isArray(valor) ? valor : [];
    if (!arquivos.length) return <span className="text-sm text-gray-600 pt-2">Nenhum arquivo enviado.</span>;
    return (
      <div className="flex flex-wrap gap-2">
        {arquivos.map((a) => (
          <button key={a.id} type="button" onClick={() => abrirAnexo(pacienteId, a.id).catch(() => toast.error("Não foi possível abrir o arquivo."))}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] px-2.5 py-1.5 text-[12.5px] text-gray-200">
            <FileText className="w-3.5 h-3.5 text-rc-blue" />{a.nome}
          </button>
        ))}
      </div>
    );
  }
  if (p.tipo === "longo" || p.tipo === "texto") return <TextoAuto id={id} valor={valor} onChange={onChange} label={p.titulo} />;
  return (
    <input id={id} className="evo-input h-10" type={p.tipo === "data" ? "date" : p.tipo === "email" ? "email" : "text"}
      inputMode={p.tipo === "numero" ? "decimal" : undefined} value={valor ?? ""} onChange={(e) => onChange(e.target.value)} />
  );
}
