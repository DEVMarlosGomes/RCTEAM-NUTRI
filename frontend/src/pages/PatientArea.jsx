import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { api, formatApiError } from "@/lib/evo-api";
import RCLogo from "@/components/evonut/RCLogo";
import MacroRings from "@/components/evonut/MacroRings";
import { LogOut, Salad, MessageCircle, Send, Loader2, Utensils, FlaskConical, FileText, ChevronDown, ChevronUp } from "lucide-react";
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
  const [tab, setTab] = useState("diet"); // diet | chat | exams
  const [diet, setDiet] = useState(null);
  const [loadingDiet, setLoadingDiet] = useState(true);
  const [exams, setExams] = useState([]);
  const [loadingExams, setLoadingExams] = useState(false);
  const [expandedExam, setExpandedExam] = useState(null);
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

  useEffect(() => {
    if (tab !== "exams" || exams.length > 0) return;
    setLoadingExams(true);
    api.get("/patient/exams")
      .then((r) => setExams(r.data || []))
      .catch(() => setExams([]))
      .finally(() => setLoadingExams(false));
  }, [tab, exams.length]); // eslint-disable-line react-hooks/exhaustive-deps

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
    navigate("/", { replace: true });
    await logout();
  };

  return (
    <div className="min-h-[100dvh] text-gray-100 relative pb-24 sm:pb-12">
      <header className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 pt-5 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <RCLogo size={30} variant="blue" />
          <span className="rc-display text-[15px] text-white">Rogério Costa</span>
        </div>
        <button data-testid="patient-logout" onClick={doLogout} className="rc-btn-ghost p-2 -mr-2" title="Sair" aria-label="Sair">
          <LogOut className="w-4 h-4" />
        </button>
      </header>

      <main className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6">
        <section className="pt-6 pb-6 sm:pb-8">
          <div className="rc-eyebrow">Área do paciente</div>
          <h1 className="rc-h1 mt-3">Olá, <span className="text-rc-lime">{(user?.name || "").split(" ")[0]}</span></h1>
        </section>

        {/* Abas: barra inferior no celular, segmentado no desktop */}
        <nav
          data-testid="patient-tabs"
          aria-label="Seções"
          className="fixed sm:static bottom-0 inset-x-0 z-40 sm:z-auto sm:mb-6 bg-rc-ink/90 sm:bg-transparent backdrop-blur-xl sm:backdrop-blur-none border-t border-white/[0.06] sm:border-0 pb-[env(safe-area-inset-bottom)]"
        >
          <div className="grid grid-cols-3 sm:inline-grid sm:gap-1 sm:p-1 sm:rounded-xl sm:bg-rc-surface sm:shadow-[var(--shadow-card)]">
            {[
              { k: "diet", label: "Minha dieta", icon: Salad, testid: "tab-diet" },
              { k: "chat", label: "Assistente", icon: MessageCircle, testid: "tab-chat" },
              { k: "exams", label: "Exames", icon: FlaskConical, testid: "tab-exams" },
            ].map((t) => (
              <button
                key={t.k}
                data-testid={t.testid}
                onClick={() => setTab(t.k)}
                aria-current={tab === t.k ? "page" : undefined}
                className={`flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 h-16 sm:h-10 sm:px-4 sm:rounded-lg text-[11px] sm:text-[13.5px] transition-colors duration-150 active:scale-[0.97] ${
                  tab === t.k ? "text-rc-lime sm:text-white sm:bg-white/[0.07] font-medium" : "text-gray-500 hover:text-gray-200"
                }`}
              >
                <t.icon className={`w-5 h-5 sm:w-4 sm:h-4 ${tab === t.k ? "sm:text-rc-lime" : ""}`} strokeWidth={1.75} />
                {t.label}
              </button>
            ))}
          </div>
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
                {/* Meta do dia */}
                <section className="relative rc-card p-5 sm:p-8 grid sm:grid-cols-[1fr_auto] gap-6 sm:gap-10 items-center" data-testid="patient-diet-kpis">
                  <MacroRings
                    className="sm:hidden absolute right-4 top-4 w-[92px] h-[92px]"
                    stroke={18}
                    values={{ ptn: (diet.ptn_pct || 0) / 100, cho: (diet.cho_pct || 0) / 100, lip: (diet.lip_pct || 0) / 100 }}
                  />
                  <div>
                    <div className="text-[12px] text-gray-400">Meta diária</div>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="rc-num text-[72px] sm:text-[88px] leading-none text-white">{diet.kcal_total ? Number(diet.kcal_total).toLocaleString("pt-BR") : "–"}</span>
                      <span className="text-gray-400">kcal</span>
                    </div>
                    <div className="mt-6 space-y-3.5 max-w-sm">
                      <MacroRow label="Proteína" g={diet.proteina_g} pct={diet.ptn_pct} color="bg-macro-ptn" />
                      <MacroRow label="Carboidrato" g={diet.carboidrato_g} pct={diet.cho_pct} color="bg-macro-cho" />
                      <MacroRow label="Gordura" g={diet.gordura_g} pct={diet.lip_pct} color="bg-macro-lip" />
                    </div>
                  </div>
                  <MacroRings
                    className="hidden sm:block w-56 h-56"
                    values={{ ptn: (diet.ptn_pct || 0) / 100, cho: (diet.cho_pct || 0) / 100, lip: (diet.lip_pct || 0) / 100 }}
                  />
                </section>

                <div className="rc-card p-6 sm:p-8">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h2 className="rc-h2">Plano alimentar</h2>
                      <p className="text-xs text-gray-500 mt-1">
                        Versão {diet.version} · {new Date(diet.created_at).toLocaleDateString("pt-BR")} · Objetivo: <strong className="text-gray-200 font-medium">{diet.objetivo}</strong>
                      </p>
                    </div>
                  </div>
                  <div className="prose-rc">{renderMarkdown(diet.content)}</div>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "chat" && (
          <div data-testid="patient-chat-panel" className="animate-fade-up">
            <div className="rc-card flex flex-col" style={{ minHeight: "calc(100dvh - 300px)" }}>
              <header className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Tire suas dúvidas</div>
                  <div className="font-bold mt-0.5">Assistente do Rogério Costa</div>
                </div>
                <div className="text-[10px] uppercase tracking-widest text-emerald-300 font-bold">Agente 3</div>
              </header>

              <div className="flex-1 overflow-y-auto p-5 space-y-3" style={{ maxHeight: "calc(100dvh - 420px)" }}>
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
                          ? "max-w-[80%] bg-rc-blue text-rc-ink rounded-2xl rounded-tr-md px-4 py-3 text-[14px] font-medium whitespace-pre-wrap"
                          : m.kind === "proactive"
                          ? "max-w-[85%] bg-emerald-400/[0.08] border border-emerald-300/40 rounded-2xl rounded-tl-sm p-3.5 text-gray-100 shadow-sm text-sm whitespace-pre-wrap leading-relaxed relative"
                          : "max-w-[85%] bg-rc-raised rounded-2xl rounded-tl-md px-4 py-3 text-gray-200 text-[14px] whitespace-pre-wrap leading-relaxed shadow-[0_0_0_1px_rgba(255,255,255,0.06)]"
                      }
                    >
                      {m.kind === "proactive" && !m.typing && (
                        <div className="text-[9px] uppercase tracking-widest text-emerald-300 font-black mb-1.5 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse-soft inline-block" />
                          Lembrete do Rogério
                        </div>
                      )}
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
        {tab === "exams" && (
          <div data-testid="patient-exams-panel" className="animate-fade-up">
            {loadingExams ? (
              <div className="rc-card p-10 text-center text-gray-500 text-sm">
                <Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Carregando exames…
              </div>
            ) : exams.length === 0 ? (
              <div className="rc-card p-10 text-center">
                <FlaskConical className="w-10 h-10 mx-auto text-gray-600 mb-3" />
                <h3 className="font-display font-black text-lg">Nenhum exame anexado</h3>
                <p className="text-sm text-gray-400 mt-2 max-w-md mx-auto">
                  Quando o Rogério anexar seus exames, eles aparecerão aqui com a análise completa.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {exams.map((ex) => (
                  <div key={ex.id} className="rc-card overflow-hidden">
                    <button
                      className="w-full flex items-center justify-between p-5 text-left hover:bg-white/[0.02] transition-colors"
                      onClick={() => setExpandedExam(expandedExam === ex.id ? null : ex.id)}
                    >
                      <div className="flex items-center gap-3">
                        <FileText className="w-5 h-5 text-rc-blue flex-shrink-0" />
                        <div>
                          <div className="font-bold text-sm">{ex.file_name}</div>
                          <div className="text-[11px] text-gray-500 mt-0.5">
                            {new Date(ex.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}
                          </div>
                        </div>
                      </div>
                      {expandedExam === ex.id
                        ? <ChevronUp className="w-4 h-4 text-gray-400" />
                        : <ChevronDown className="w-4 h-4 text-gray-400" />}
                    </button>

                    {expandedExam === ex.id && (
                      <div className="border-t border-white/5 px-5 pb-5 pt-4 space-y-4">
                        {ex.resumo && (
                          <div>
                            <div className="text-[10px] uppercase tracking-widest text-rc-blue font-bold mb-1">Resumo</div>
                            <p className="text-sm text-gray-300 leading-relaxed">{ex.resumo}</p>
                          </div>
                        )}
                        {ex.markers && ex.markers.length > 0 && (
                          <div>
                            <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-2">Marcadores</div>
                            <div className="grid sm:grid-cols-2 gap-2">
                              {ex.markers.map((m, i) => (
                                <div key={i} className="flex items-center justify-between bg-white/[0.03] border border-white/5 rounded-lg px-3 py-2">
                                  <span className="text-xs text-gray-300">{m.name}</span>
                                  <span className={`text-xs font-bold ml-2 px-2 py-0.5 rounded-full ${
                                    m.status === "normal"
                                      ? "bg-emerald-400/10 text-emerald-400"
                                      : m.status === "alto" || m.status === "elevado"
                                      ? "bg-red-400/10 text-red-400"
                                      : m.status === "baixo"
                                      ? "bg-amber-400/10 text-amber-400"
                                      : "bg-white/5 text-gray-400"
                                  }`}>
                                    {m.value} {m.unit || ""}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {ex.conduta_sugerida && (
                          <div>
                            <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-1">Conduta sugerida</div>
                            <p className="text-sm text-gray-400 leading-relaxed">{ex.conduta_sugerida}</p>
                          </div>
                        )}
                        {ex.observacoes && (
                          <div>
                            <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-1">Observações do Rogério</div>
                            <p className="text-sm text-gray-300 leading-relaxed">{ex.observacoes}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function MacroRow({ label, g, pct, color }) {
  const width = Math.max(0, Math.min(100, Number(pct) || 0));
  return (
    <div>
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="text-gray-300 inline-flex items-center gap-2"><span className={`w-2 h-2 rounded-[2px] ${color}`} />{label}</span>
        <span className="tabular text-gray-400"><span className="text-white font-medium">{g ?? "–"} g</span> · {pct ?? "–"}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/[0.05] mt-1.5 overflow-hidden">
        <div className={`h-full rounded-full origin-left animate-bar-grow ${color}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}
