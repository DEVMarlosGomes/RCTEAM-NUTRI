import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, formatApiError } from "@/lib/evo-api";
import GlowOrb from "@/components/evonut/GlowOrb";
import { Send, Sparkles, ArrowRight } from "lucide-react";
import { toast } from "sonner";

export default function Chat() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [finished, setFinished] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    api.get(`/public/chat/${token}`).then((r) => {
      const msgs = r.data || [];
      if (msgs.length === 0) {
        setMessages([{
          role: "assistant",
          content:
            "Oi! Sou o EvoNut, assistente da sua nutricionista. Já recebi seu formulário e gostaria de aprofundar alguns pontos importantes pra montar o melhor plano possível pra você. Vamos lá? 💜",
        }]);
      } else {
        setMessages(msgs);
      }
    }).catch(() => toast.error("Erro ao carregar conversa"));
  }, [token]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const send = async () => {
    if (!input.trim() || sending) return;
    const userMsg = { role: "user", content: input };
    setMessages((m) => [...m, userMsg, { role: "assistant", content: "...", typing: true }]);
    const text = input;
    setInput("");
    setSending(true);
    try {
      const { data } = await api.post("/public/chat", { token, message: text });
      setMessages((m) => {
        const next = m.filter((x) => !x.typing);
        return [...next, { role: "assistant", content: data.reply.replace("ANAMNESE_FINALIZADA", "").trim() }];
      });
      if (data.finished) setFinished(true);
    } catch (e) {
      setMessages((m) => m.filter((x) => !x.typing));
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen relative bg-evo-bg overflow-hidden flex flex-col">
      <GlowOrb color="#7B61FF" size={400} top="-10%" left="-5%" opacity={0.2} />

      <header className="relative z-10 max-w-3xl w-full mx-auto px-4 sm:px-6 pt-6 pb-4 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-evo-purple to-evo-teal flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <span className="font-display font-semibold">EvoNut</span>
        </Link>
        <div className="text-xs text-gray-400">Chat clínico adaptativo</div>
      </header>

      <main className="relative z-10 flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 pb-4 flex flex-col">
        <div className="flex-1 evo-card p-4 sm:p-6 overflow-y-auto" style={{ maxHeight: "calc(100vh - 220px)" }}>
          <div className="space-y-4">
            {messages.map((m, i) => (
              <div key={i} data-testid={`chat-msg-${m.role}`} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[80%] bg-evo-purple text-white rounded-2xl rounded-tr-sm p-3.5 shadow-md text-sm"
                      : "max-w-[80%] bg-evo-surfaceAlt border border-evo-purple/20 rounded-2xl rounded-tl-sm p-3.5 text-gray-200 shadow-sm text-sm whitespace-pre-wrap"
                  }
                >
                  {m.typing ? <TypingDots /> : m.content}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        </div>

        {finished ? (
          <div className="mt-4 evo-glass rounded-xl p-5 flex flex-col sm:flex-row items-center gap-4">
            <div className="flex-1 text-sm text-gray-200">Tudo pronto! Vamos agendar sua consulta?</div>
            <button data-testid="go-schedule" onClick={() => navigate(`/agendar/${token}`)} className="evo-btn-primary">
              Escolher horário <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="mt-4 flex gap-2">
            <input
              data-testid="chat-input"
              className="evo-input"
              placeholder="Escreva sua resposta..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              disabled={sending}
            />
            <button data-testid="chat-send" onClick={send} disabled={sending || !input.trim()} className="evo-btn-primary">
              <Send className="w-4 h-4" />
            </button>
          </div>
        )}

        <button
          data-testid="skip-chat"
          onClick={() => navigate(`/agendar/${token}`)}
          className="mt-3 text-xs text-gray-500 hover:text-white self-center"
        >
          Pular e ir direto para o agendamento
        </button>
      </main>
    </div>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex gap-1">
      <span className="w-1.5 h-1.5 rounded-full bg-evo-purple animate-pulse-soft" />
      <span className="w-1.5 h-1.5 rounded-full bg-evo-purple animate-pulse-soft" style={{ animationDelay: "0.2s" }} />
      <span className="w-1.5 h-1.5 rounded-full bg-evo-purple animate-pulse-soft" style={{ animationDelay: "0.4s" }} />
    </span>
  );
}
