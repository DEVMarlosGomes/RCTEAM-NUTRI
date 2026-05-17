import React, { useEffect, useRef, useState } from "react";
import NutriLayout from "@/components/evonut/NutriLayout";
import { api, formatApiError } from "@/lib/evo-api";
import { Stethoscope, Send, Loader2, User, MessageCircle } from "lucide-react";
import { toast } from "sonner";

export default function Consultorio() {
  const [patients, setPatients] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    api
      .get("/consultorio/patients")
      .then((r) => setPatients(r.data || []))
      .catch((e) => toast.error(formatApiError(e.response?.data?.detail)));
  }, []);

  useEffect(() => {
    if (!selectedId) { setMessages([]); return; }
    setLoadingHistory(true);
    api
      .get(`/consultorio/chat/${selectedId}`)
      .then((r) => setMessages(r.data || []))
      .catch(() => setMessages([]))
      .finally(() => setLoadingHistory(false));
  }, [selectedId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const filtered = patients.filter((p) =>
    (p.nome || "").toLowerCase().includes(search.toLowerCase())
  );

  const send = async () => {
    if (!input.trim() || !selectedId || sending) return;
    const text = input;
    setInput("");
    setMessages((m) => [
      ...m,
      { role: "user", content: text },
      { role: "assistant", content: "...", typing: true },
    ]);
    setSending(true);
    try {
      const { data } = await api.post("/consultorio/chat", { patient_id: selectedId, message: text });
      setMessages((m) => {
        const next = m.filter((x) => !x.typing);
        return [...next, { role: "assistant", content: data.reply }];
      });
    } catch (e) {
      setMessages((m) => m.filter((x) => !x.typing));
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setSending(false);
    }
  };

  const selected = patients.find((p) => p.id === selectedId);

  return (
    <NutriLayout>
      <div className="max-w-7xl mx-auto" data-testid="consultorio-page">
        <header className="mb-6">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-cyan-400/15 border border-cyan-400/30 flex items-center justify-center">
              <Stethoscope className="w-5 h-5 text-cyan-300" />
            </div>
            <div>
              <h1 className="rc-h2">Consultório</h1>
              <p className="text-sm text-gray-400 mt-1">
                Apoio do <strong className="text-rc-blue">Agente 2</strong> durante a consulta. Selecione o paciente para começar.
              </p>
            </div>
          </div>
        </header>

        <div className="grid lg:grid-cols-[320px_1fr] gap-6">
          {/* Patient picker */}
          <aside className="rc-card p-3 flex flex-col" style={{ maxHeight: "calc(100vh - 200px)" }} data-testid="consultorio-patient-list">
            <input
              data-testid="consultorio-search"
              className="rc-input mb-3"
              placeholder="Buscar paciente..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="flex-1 overflow-y-auto space-y-1.5">
              {filtered.length === 0 && (
                <p className="text-xs text-gray-500 px-2 py-4 text-center">Nenhum paciente</p>
              )}
              {filtered.map((p) => {
                const active = p.id === selectedId;
                return (
                  <button
                    key={p.id}
                    data-testid={`patient-pick-${p.id}`}
                    onClick={() => setSelectedId(p.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-all ${
                      active
                        ? "bg-rc-blue/15 border-rc-blue/50 text-white"
                        : "border-white/5 text-gray-300 hover:bg-white/[0.04] hover:text-white"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <User className="w-3.5 h-3.5 text-rc-blue" />
                      <span className="font-medium truncate">{p.nome || "—"}</span>
                    </div>
                    {p.email && <div className="text-[11px] text-gray-500 truncate mt-0.5 pl-5">{p.email}</div>}
                  </button>
                );
              })}
            </div>
          </aside>

          {/* Chat */}
          <section className="rc-card flex flex-col" style={{ minHeight: "calc(100vh - 200px)" }} data-testid="consultorio-chat">
            {!selectedId ? (
              <div className="flex-1 flex flex-col items-center justify-center text-gray-500 p-10">
                <MessageCircle className="w-10 h-10 mb-3 opacity-40" />
                <p className="text-sm">Escolha um paciente à esquerda para iniciar a conversa com o Agente 2.</p>
              </div>
            ) : (
              <>
                <header className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-widest text-gray-500 font-bold">Paciente em atendimento</div>
                    <div className="font-bold text-base mt-0.5">{selected?.nome}</div>
                  </div>
                  <div className="text-[10px] uppercase tracking-widest text-cyan-300 font-bold">Agente 2 · Consultório</div>
                </header>

                <div className="flex-1 overflow-y-auto p-5 space-y-3" style={{ maxHeight: "calc(100vh - 360px)" }}>
                  {loadingHistory && <div className="text-center text-gray-500 text-xs"><Loader2 className="w-4 h-4 animate-spin inline" /> carregando histórico…</div>}
                  {!loadingHistory && messages.length === 0 && (
                    <p className="text-sm text-gray-500 text-center pt-12">
                      Pergunte algo sobre o paciente — exames, alimentação, orientações…
                    </p>
                  )}
                  {messages.map((m, i) => (
                    <div key={i} data-testid={`consult-msg-${m.role}`} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div
                        className={
                          m.role === "user"
                            ? "max-w-[80%] bg-rc-blue text-black rounded-2xl rounded-tr-sm p-3.5 shadow-md text-sm font-semibold whitespace-pre-wrap"
                            : "max-w-[85%] bg-rc-surfaceAlt border border-cyan-300/20 rounded-2xl rounded-tl-sm p-3.5 text-gray-200 shadow-sm text-sm whitespace-pre-wrap leading-relaxed"
                        }
                      >
                        {m.typing ? <TypingDots /> : m.content}
                      </div>
                    </div>
                  ))}
                  <div ref={endRef} />
                </div>

                <div className="p-4 border-t border-white/5 flex gap-2">
                  <input
                    data-testid="consult-chat-input"
                    className="rc-input"
                    placeholder="Pergunte ao Agente 2…"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && send()}
                    disabled={sending}
                  />
                  <button
                    data-testid="consult-chat-send"
                    onClick={send}
                    disabled={sending || !input.trim()}
                    className="rc-btn-primary"
                  >
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </NutriLayout>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex gap-1">
      <span className="w-1.5 h-1.5 rounded-full bg-cyan-300 animate-pulse-soft" />
      <span className="w-1.5 h-1.5 rounded-full bg-cyan-300 animate-pulse-soft" style={{ animationDelay: "0.2s" }} />
      <span className="w-1.5 h-1.5 rounded-full bg-cyan-300 animate-pulse-soft" style={{ animationDelay: "0.4s" }} />
    </span>
  );
}
