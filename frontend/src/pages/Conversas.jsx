import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Bot, FlaskConical, Hand, Loader2, Send, UserRound } from "lucide-react";
import { toast } from "sonner";
import NutriLayout from "@/components/evonut/NutriLayout";
import PageHeader from "@/components/evonut/PageHeader";
import { api, formatApiError } from "@/lib/evo-api";

/**
 * Conversas do WhatsApp (ajuste fn1): o agente de vendas atende sozinho; o que for clínico ou que ele não sabe
 * vira "Conversa para você" e o Rogério responde por aqui. Simulador para testar antes de ligar o número.
 */
const hora = (v) => (v ? new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
const ETAPA = { LEAD_INICIADO: "lead", PROPOSTA_ACEITA: "proposta aceita", CONSULTA_AGENDADA: "agendada", PERDIDO: "perdido" };
const STATUS_ENVIO = { aguardando_numero: "aguardando o número ser ligado", erro: "erro no envio", fora_da_janela: "fora da janela de 24 h", enviada: "enviada", delivered: "entregue", read: "lida" };
const ORIGEM = { agente: "agente", rogerio: "você", followup: "follow-up", lembrete: "lembrete" };

export default function Conversas() {
  const [busca, setBusca] = useSearchParams();
  const [lista, setLista] = useState(null);
  const [ligado, setLigado] = useState(false);
  const [aberta, setAberta] = useState(busca.get("c"));
  const [conversa, setConversa] = useState(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [sim, setSim] = useState({ telefone: "11 90000-0001", nome: "Cliente teste", texto: "" });
  const [simulando, setSimulando] = useState(false);
  const fimRef = useRef(null);

  const carregarLista = useCallback(() => api.get("/conversas").then((r) => { setLista(r.data.conversas || []); setLigado(!!r.data.numero_ligado); }).catch(() => setLista([])), []);
  const carregarConversa = useCallback((pid) => { if (pid) api.get(`/conversas/${pid}`).then((r) => setConversa(r.data)).catch(() => setConversa(null)); }, []);
  useEffect(() => { carregarLista(); }, [carregarLista]);
  useEffect(() => { carregarConversa(aberta); }, [aberta, carregarConversa]);
  useEffect(() => { fimRef.current?.scrollIntoView({ block: "end" }); }, [conversa]);

  const abrir = (pid) => { setAberta(pid); setBusca(pid ? { c: pid } : {}); };
  const responder = async () => {
    if (!texto.trim()) return;
    setEnviando(true);
    try {
      await api.post(`/conversas/${aberta}/responder`, { texto });
      setTexto(""); carregarConversa(aberta); carregarLista();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); } finally { setEnviando(false); }
  };
  const agente = async (ativo) => {
    try {
      await api.post(`/conversas/${aberta}/agente`, { ativo });
      toast.success(ativo ? "O agente volta a responder esta conversa." : "Você assumiu a conversa. O agente parou de responder.");
      carregarConversa(aberta); carregarLista();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const simular = async () => {
    if (!sim.texto.trim()) return;
    setSimulando(true);
    try {
      const { data } = await api.post("/conversas/simular", sim);
      setSim((s) => ({ ...s, texto: "" }));
      await carregarLista();
      abrir(data.patient_id);
      carregarConversa(data.patient_id);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); } finally { setSimulando(false); }
  };

  const paraVoce = !!conversa?.contato?.conversa_humana?.aberta;

  return (
    <NutriLayout>
      <PageHeader eyebrow="Acompanhamento" title="Conversas do WhatsApp"
        description="O agente de vendas responde na hora, passa planos e valores e envia o link de agendamento. Perguntas clínicas ou que ele não sabe ficam marcadas como “para você”." />

      {!ligado && (
        <div className="rc-card mb-4 border-l-2 border-rc-amber p-4 text-[13px] text-gray-300" data-testid="aviso-numero">
          O número do WhatsApp Business ainda não está ligado. As respostas ficam guardadas aqui e use o simulador abaixo para testar o agente.
          Para ligar: crie o app na Meta (WhatsApp Cloud API) e informe WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN e WHATSAPP_APP_SECRET no servidor; o endereço do webhook é <code className="text-white">/api/whatsapp/webhook</code>.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <aside className="rc-card overflow-hidden" aria-label="Conversas">
          {lista === null && <div className="p-5 text-sm text-gray-500"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Carregando…</div>}
          {lista?.length === 0 && <div className="p-5 text-sm text-gray-500">Nenhuma conversa ainda.</div>}
          <ul className="max-h-[560px] divide-y divide-white/[0.05] overflow-y-auto">
            {(lista || []).map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => abrir(c.id)} data-testid={`conversa-${c.id}`}
                  className={`w-full px-4 py-3 text-left hover:bg-white/[0.03] ${aberta === c.id ? "bg-white/[0.05]" : ""}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-white">{c.nome}</span>
                    <span className="shrink-0 text-[11px] text-gray-500">{hora(c.ultima?.created_at)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[12.5px]">
                    {c.para_voce && <span className="shrink-0 bg-rc-amber/15 px-1.5 py-0.5 text-[11px] font-semibold text-rc-amber">para você</span>}
                    <span className="truncate text-gray-400">{c.ultima?.direcao === "saida" ? "↳ " : ""}{c.ultima?.texto}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-white/[0.06] p-4" data-testid="simulador">
            <div className="mb-2 flex items-center gap-2 text-[12.5px] font-semibold text-gray-200"><FlaskConical className="h-4 w-4 text-rc-blue" /> Simular cliente</div>
            <div className="grid grid-cols-2 gap-2">
              <input className="rc-input h-9 text-[13px]" value={sim.nome} onChange={(e) => setSim({ ...sim, nome: e.target.value })} aria-label="Nome do cliente simulado" />
              <input className="rc-input h-9 text-[13px]" value={sim.telefone} onChange={(e) => setSim({ ...sim, telefone: e.target.value })} aria-label="Telefone do cliente simulado" />
            </div>
            <div className="mt-2 flex gap-2">
              <input className="rc-input h-9 flex-1 text-[13px]" placeholder="Mensagem do cliente" value={sim.texto} onChange={(e) => setSim({ ...sim, texto: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") simular(); }} data-testid="sim-texto" />
              <button type="button" className="rc-btn-secondary h-9" onClick={simular} disabled={simulando} data-testid="sim-enviar">{simulando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enviar"}</button>
            </div>
          </div>
        </aside>

        <section className="rc-card flex min-h-[560px] flex-col" aria-label="Conversa">
          {!conversa && <div className="m-auto p-8 text-sm text-gray-500">Escolha uma conversa.</div>}
          {conversa && (
            <>
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-3">
                <div>
                  <Link to={`/pacientes/${conversa.contato.id}`} className="font-semibold text-white hover:underline">{conversa.contato.nome}</Link>
                  <div className="text-[12px] text-gray-400">{conversa.contato.telefone} · {ETAPA[conversa.contato.status_funil] || "paciente"}{conversa.contato.plano_interesse ? ` · interesse: ${conversa.contato.plano_interesse}` : ""}</div>
                </div>
                {paraVoce
                  ? <button type="button" className="rc-btn-secondary h-9 text-[12.5px]" onClick={() => agente(true)} data-testid="devolver-agente"><Bot className="h-4 w-4" /> Devolver ao agente</button>
                  : <button type="button" className="rc-btn-ghost h-9 text-[12.5px]" onClick={() => agente(false)} data-testid="assumir"><Hand className="h-4 w-4" /> Assumir conversa</button>}
              </header>
              {paraVoce && (
                <div className="border-b border-white/[0.06] bg-rc-amber/[0.06] px-5 py-2 text-[12.5px] text-rc-amber" data-testid="faixa-para-voce">
                  Conversa para você: {conversa.contato.conversa_humana?.pergunta}. O agente não responde até você devolver.
                </div>
              )}
              <ol className="flex-1 space-y-2 overflow-y-auto px-5 py-4" data-testid="mensagens">
                {conversa.mensagens.map((m) => (
                  <li key={m.id} className={`flex ${m.direcao === "saida" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[78%] px-3.5 py-2 text-[13.5px] ${m.direcao === "saida" ? "bg-rc-blue/15 text-gray-100" : "bg-white/[0.06] text-gray-100"}`}>
                      <div className="whitespace-pre-wrap break-words">{m.texto}</div>
                      <div className="mt-1 flex items-center gap-1.5 text-[10.5px] text-gray-500">
                        {m.direcao === "saida" ? (m.origem === "rogerio" ? <UserRound className="h-3 w-3" /> : <Bot className="h-3 w-3" />) : null}
                        {m.direcao === "saida" ? `${ORIGEM[m.origem] || m.origem} · ` : ""}{hora(m.created_at)}
                        {m.direcao === "saida" && m.status && ` · ${STATUS_ENVIO[m.status] || m.status}`}
                      </div>
                    </div>
                  </li>
                ))}
                <li ref={fimRef} />
              </ol>
              <footer className="flex gap-2 border-t border-white/[0.06] p-3">
                <textarea className="rc-input min-h-[44px] flex-1 resize-none text-[13.5px]" rows={2} placeholder="Responder como Rogério…" value={texto}
                  onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); responder(); } }} data-testid="resposta" />
                <button type="button" className="rc-btn-primary h-11 self-end" onClick={responder} disabled={enviando || !texto.trim()} data-testid="responder"><Send className="h-4 w-4" /> Enviar</button>
              </footer>
            </>
          )}
        </section>
      </div>
    </NutriLayout>
  );
}
