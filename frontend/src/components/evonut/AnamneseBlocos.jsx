import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/evo-api";
import { abrirAnexo, carregarEstrutura, respostasPlanas, vazio, visivel } from "@/lib/anamnese";

/**
 * Anamnese organizada pelos blocos do formulário pré-consulta (o Bloco 1, dados pessoais, fica no card do topo).
 * Mostra o que o cliente respondeu; o nutricionista edita qualquer resposta ou preenche manualmente, e a edição
 * salva sozinha. Dado antigo sem pergunta equivalente aparece em "Outras informações" do bloco.
 */
export default function AnamneseBlocos({ pacienteId, sexoPaciente, inicial }) {
  const [estrutura, setEstrutura] = useState(null);
  const [doc, setDoc] = useState(inicial || {});
  const [abertos, setAbertos] = useState(() => new Set(["objetivos_treinamento"]));
  const [estado, setEstado] = useState("");
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

  return (
    <div className="space-y-3" data-testid="anamnese-blocos">
      <div className="flex items-center justify-between gap-3 px-1 text-[12px] text-gray-500 min-h-[20px]">
        <span>{enviadoEm ? `Formulário pré-consulta respondido pelo paciente em ${enviadoEm}.` : "O paciente ainda não enviou o formulário pré-consulta. Você pode preencher manualmente."}</span>
        <EstadoSalvar estado={estado} />
      </div>
      {estrutura.blocos.filter((b) => b.key !== "dados_pessoais").map((b, i) => {
        const perguntas = b.perguntas.filter((p) => visivel(p, planas) || !vazio(planas[p.id]));
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
            {aberto && (
              <div className="px-4 pb-5 divide-y divide-white/[0.05]">
                {perguntas.map((p) => (
                  <div key={p.id} className="py-3.5 grid md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-6 gap-y-2">
                    <label className="text-[13px] text-gray-400 leading-snug" htmlFor={`anam-${p.id}`}>
                      <span className="text-gray-600 tabular mr-1.5">{p.n}.</span>{p.titulo}
                    </label>
                    <Editor pergunta={p} valor={planas[p.id]} pacienteId={pacienteId} onChange={(v) => mudarResposta(b.key, p.id, v)} />
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

function Editor({ pergunta: p, valor, pacienteId, onChange }) {
  const id = `anam-${p.id}`;
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
