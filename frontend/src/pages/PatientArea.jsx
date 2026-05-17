import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { api, formatApiError } from "@/lib/evo-api";
import Brand from "@/components/evonut/Brand";
import GlowOrb from "@/components/evonut/GlowOrb";
import { LogOut, Salad, MessageCircle, Send, Loader2, Sparkles, Utensils } from "lucide-react";
import { toast } from "sonner";

// Minimal markdown render for the diet plan content (re-uses same logic as backend PDF)
function renderMarkdown(md) {
  if (!md) return null;
  const lines = md.split("\n");
  const out = [];
  let ul = null;
  lines.forEach((raw, i) => {
    const s = raw.trimEnd();
    const close = () => { if (ul) { out.push(<ul key={`ul-${i}`} className="pl-5 space-y-1 my-2">{ul}</ul>); ul = null; } };
    if (!s.trim()) { close(); return; }
    if (s.startsWith("### ")) { close(); out.push(<h4 key={i} className="text-rc-blue font-bold uppercase tracking-wider text-xs mt-4">{s.slice(4)}</h4>); }
    else if (s.startsWith("## ")) { close(); out.push(<h3 key={i} className="text-white font-bold text-base mt-5">{s.slice(3)}</h3>); }
    else if (s.startsWith("# ")) { close(); out.push(<h2 key={i} className="text-white font-display font-black text-lg mt-6">{s.slice(2)}</h2>); }
    else if (/^[-*•]\s+/.test(s.trimStart())) {
      const txt = s.trimStart().replace(/^[-*•]\s+/, "");
      ul = ul || [];
      ul.push(<li key={i} className="text-sm text-gray-300 leading-relaxed list-disc">{inline(txt)}</li>);
    }
    else { close(); out.push(<p key={i} className="text-sm text-gray-300 leading-relaxed my-1.5">{inline(s)}</p>); }
  });
  if (ul) out.push(<ul key="ul-end" className="pl-5 space-y-1 my-2">{ul}</ul>);
  return out;
}
function inline(s) {
  // bold
  const parts = s.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**")
      ? <strong key={i} className="text-white font-bold">{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>
  );
}

export default function PatientArea() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState("diet"); // diet | chat
  const [diet, setDiet] = useState(null);
  const [loadingDiet, setLoadingDiet] = useState(true);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    api.get("/patient/diet")
      .then((r) => setDiet(r.data?.plan))
      .catch(() => setDiet(null))
      .finally(() => setLoadingDiet(false));
    api.get("/patient/chat")
      .then((r) => setMessages(r.data || []))
      .catch(() => setMessages([]));
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const send = async () => {
    if (!input.trim() || sending) return;
    const text = input;
    setInput("");
    setMessages((m) => [
      ...m,
      { role: "user", content: text },
      { role: "assistant", content: "...", typing: true },
    ]);
    setSending(true);
    try {
      const { data } = await api.post("/patient/chat", { message: text });
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

  const doLogout = async () => {
    await logout();
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-rc-ink text-white relative overflow-hidden">
      <GlowOrb color="#0081FD" size={500} top="-15%" left="-10%" opacity={0.18} />
      <GlowOrb color="#0066CC" size={400} top="60%" left="65%" opacity={0.14} />

      <header className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 pt-6 pb-4 flex items-center justify-between">
        <Brand size="sm" />
        <div className="flex items-center gap-3">
          <div className="hidden sm:block text-right">
            <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Paciente</div>
            <div className="text-sm font-bold truncate max-w-[180px]">{user?.name}</div>
          </div>
          <button data-testid="patient-logout" onClick={doLogout} className="rc-btn-ghost" title="Sair">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      <main className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 pb-12">
        {/* Tabs */}
        <nav className="flex items-center gap-2 mb-6" data-testid="patient-tabs">
          <button
            data-testid="tab-diet"
            onClick={() => setTab("diet")}
            className={`px-4 py-2 rounded-lg text-sm font-bold uppercase tracking-wider transition-all flex items-center gap-2 ${
              tab === "diet"
                ? "bg-rc-blue/15 text-rc-blue border border-rc-blue/40"
                : "text-gray-400 hover:text-white border border-transparent"
            }`}
          >
            <Salad className="w-4 h-4" /> Minha dieta
          </button>
          <button
            data-testid="tab-chat"
            onClick={() => setTab("chat")}
            className={`px-4 py-2 rounded-lg text-sm font-bold uppercase tracking-wider transition-all flex items-center gap-2 ${
              tab === "chat"
                ? "bg-rc-blue/15 text-rc-blue border border-rc-blue/40"
                : "text-gray-400 hover:text-white border border-transparent"
            }`}
          >
            <MessageCircle className="w-4 h-4" /> Assistente IA
          </button>
        </nav>

        {tab === "diet" && (
          <div data-testid="patient-diet-panel" className="animate-fade-up">
            {loadingDiet ? (
              <div className="rc-card p-10 text-center text-gray-500 text-sm">
                <Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Carregando seu plano alimentar…
              </div>
            ) : !diet ? (
              <div className="rc-card p-10 text-center">
                <Utensils className="w-10 h-10 mx-auto text-gray-600 mb-3" />
                <h3 className="font-display font-black text-lg">Ainda não há plano prescrito</h3>
                <p className="text-sm text-gray-400 mt-2 max-w-md mx-auto">
                  Assim que o Rogério publicar sua dieta, ela aparecerá aqui. Você pode tirar dúvidas com nossa IA enquanto isso.
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                {/* KPIs */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="patient-diet-kpis">
                  <Kpi label="Calorias / dia" value={diet.kcal_total} unit="kcal" highlight />
                  <Kpi label="Proteína" value={diet.proteina_g} unit={`g · ${diet.ptn_pct}%`} />
                  <Kpi label="Carboidrato" value={diet.carboidrato_g} unit={`g · ${diet.cho_pct}%`} />
                  <Kpi label="Gordura" value={diet.gordura_g} unit={`g · ${diet.lip_pct}%`} />
                </div>

                <div className="rc-card p-6 sm:p-8">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h2 className="rc-h2">Plano alimentar</h2>
                      <p className="text-xs text-gray-500 mt-1">
                        Versão {diet.version} · {new Date(diet.created_at).toLocaleDateString("pt-BR")} · Objetivo: <strong className="text-rc-blue">{diet.objetivo}</strong>
                      </p>
                    </div>
                    <Sparkles className="w-5 h-5 text-rc-blue" />
                  </div>
                  <div className="prose-rc">{renderMarkdown(diet.content)}</div>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "chat" && (
          <div data-testid="patient-chat-panel" className="animate-fade-up">
            <div className="rc-card flex flex-col" style={{ minHeight: "calc(100vh - 240px)" }}>
              <header className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Tire suas dúvidas</div>
                  <div className="font-bold mt-0.5">Assistente do Rogério Costa</div>
                </div>
                <div className="text-[10px] uppercase tracking-widest text-emerald-300 font-bold">Agente 3</div>
              </header>

              <div className="flex-1 overflow-y-auto p-5 space-y-3" style={{ maxHeight: "calc(100vh - 380px)" }}>
                {messages.length === 0 && (
                  <p className="text-sm text-gray-500 text-center pt-12">
                    Olá, {user?.name?.split(" ")[0] || "tudo bem"}! Pergunte qualquer dúvida sobre sua dieta ou treino.
                  </p>
                )}
                {messages.map((m, i) => (
                  <div key={i} data-testid={`patient-chat-msg-${m.role}`} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={
                        m.role === "user"
                          ? "max-w-[80%] bg-rc-blue text-black rounded-2xl rounded-tr-sm p-3.5 shadow-md text-sm font-semibold whitespace-pre-wrap"
                          : "max-w-[85%] bg-rc-surfaceAlt border border-emerald-300/20 rounded-2xl rounded-tl-sm p-3.5 text-gray-200 shadow-sm text-sm whitespace-pre-wrap leading-relaxed"
                      }
                    >
                      {m.typing ? (
                        <span className="inline-flex gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse-soft" />
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse-soft" style={{ animationDelay: "0.2s" }} />
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse-soft" style={{ animationDelay: "0.4s" }} />
                        </span>
                      ) : m.content}
                    </div>
                  </div>
                ))}
                <div ref={endRef} />
              </div>

              <div className="p-4 border-t border-white/5 flex gap-2">
                <input
                  data-testid="patient-chat-input"
                  className="rc-input"
                  placeholder="Pergunte sobre sua dieta ou treino…"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && send()}
                  disabled={sending}
                />
                <button
                  data-testid="patient-chat-send"
                  onClick={send}
                  disabled={sending || !input.trim()}
                  className="rc-btn-primary"
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function Kpi({ label, value, unit, highlight }) {
  return (
    <div className={`rc-card p-4 ${highlight ? "border-rc-blue/50 bg-rc-blue/5" : ""}`}>
      <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">{label}</div>
      <div className="mt-1.5 font-display font-black text-xl">
        {value ?? "—"} <span className="text-xs text-gray-400 font-bold">{unit}</span>
      </div>
    </div>
  );
}
