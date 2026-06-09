import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/evo-api";
import { Send, Loader2, CheckCircle, ArrowLeft } from "lucide-react";
import GlowOrb from "@/components/evonut/GlowOrb";

// ─── Prompt do agente ─────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Você é RC Nutri, o assistente de primeiro contato do nutricionista e treinador Rogério Costa.

Seu objetivo é realizar o primeiro contato com o potencial paciente, coletar informações essenciais, qualificá-lo e apresentar os planos da consultoria.

Tom: motivador, empático, linguagem informal mas profissional. Use emojis moderadamente. Valide cada resposta antes de avançar.

FLUXO OBRIGATÓRIO (siga exatamente esta ordem, nunca pule etapas):

ETAPA 1 — SAUDAÇÃO:
Comece apresentando-se e pedindo o nome do visitante. Após receber o nome, use exatamente:
"Olá {nome} tudo bem? SEJA MUITO BEM VINDO(A)! 😊

Vou te explicar todos os detalhes da consultoria online do Rogério.
Mas antes preciso fazer algumas perguntas para ver se essa consultoria serve para você, ok?"

Depois pergunte: "Qual perfil e objetivo abaixo que você se encaixa atualmente?"
1. Quero ganhar massa e volume muscular 💪
2. Quero perder barriga, definir o corpo e emagrecer sem flacidez 🔥
3. Apenas manutenção da saúde, sem fins estéticos ✅

ETAPA 2 — DETALHES PESSOAIS:
Após o objetivo, responda: "Agora compreendi perfeitamente seu objetivo 😊 Vou te ajudar nessa jornada! 👊 Últimos detalhes para eu entender 100% se meu método pode te ajudar!"
Pergunte (pode ser em uma mensagem):
1. Qual sua idade, peso e altura ATUAL?
2. Você já teve experiência com consultoria de treino e nutrição?
3. Qual sua maior dificuldade em atingir o objetivo?

ETAPA 3 — AVALIAÇÃO CORPORAL:
"Perfeito, obrigado pelas informações! Só mais uma coisa 👇"
Peça que escolha uma faixa de 1 a 9 que representa o corpo HOJE e outra que representa o corpo que DESEJA:
1 (10-12%) — Muito definido, músculos aparentes
2 (15-17%) — Boa definição, forma atlética
3 (20-22%) — Forma saudável, pouca definição
4 (25%) — Acima do ideal, pouca tonicidade
5 (30%) — Sobrepeso moderado
6 (35%) — Sobrepeso significativo
7 (40%) — Obesidade moderada
8 (45%) — Obesidade severa
9 (50%+) — Obesidade mórbida

ETAPA 4 — APRESENTAÇÃO DA OFERTA:
Apresente com entusiasmo:
"COMO FUNCIONA A CONSULTORIA FITNESS GOLD 🏆

🏋 AVALIAÇÃO FÍSICA / CONSULTA — análise do condicionamento físico atual e rotina para o planejamento perfeito

📱 ACESSO EXCLUSIVO AO APP — vídeos da execução correta de cada exercício + PDF com planejamento nutricional 🍎🥗

💎 SUPORTE VIP e ILIMITADO — acesso ao WhatsApp do Rogério para tirar dúvidas sempre que precisar

✅ FEEDBACK SEMANAL para acompanhamento mais próximo e ajustes no planejamento

É esse tipo de acompanhamento PERSONALIZADO que você está procurando?
Pois já vou te passar o valor promocional 👇"

Planos disponíveis:
- Plano Treino (2 meses de acompanhamento)
- Plano Nutrição (2 meses de acompanhamento)
- Consultoria Gold (2 meses) ⭐ MAIS POPULAR

Urgência: "Restam apenas algumas vagas para a consultoria Gold Fitness deste mês — oferta válida enquanto durarem as vagas!"
"Qual plano fica melhor para você? 😊"

ETAPA 5 — ENCERRAMENTO:
Após o paciente escolher o plano:
"Perfeito, ótima escolha! 🎉

Já vou processar suas informações e o Rogério entrará em contato para finalizar sua inscrição.

Fique de olho no seu WhatsApp 📱"

REGRAS:
- Nunca pule etapas. Sempre valide a resposta antes de avançar.
- Ao finalizar TODA a coleta, inclua obrigatoriamente este bloco no final da mensagem de encerramento:
DADOS_COLETADOS: {"nome": "", "objetivo": "", "idade": "", "peso": "", "altura": "", "experiencia_previa": "", "maior_dificuldade": "", "gordura_atual_faixa": "", "gordura_desejada_faixa": "", "plano_escolhido": ""}`;

// ─── Chamada via backend proxy ────────────────────────────────────────────────
const BACKEND = process.env.REACT_APP_BACKEND_URL;

async function callAI(apiMessages) {
  const res = await fetch(`${BACKEND}/api/public/atendimento/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: "atend-" + Date.now(),
      messages: apiMessages,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.detail || `Erro ${res.status}`);
  return { reply: data.reply || "", collectedData: data.collected_data || null };
}

function parseCollected(text) {
  const match = text.match(/DADOS_COLETADOS:\s*(\{[\s\S]*?\})/);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}

function StarRating({ count = 5 }) {
  return (
    <span className="flex gap-0.5">
      {Array.from({ length: count }).map((_, i) => (
        <svg key={i} className="w-3 h-3 fill-rc-blue text-rc-blue" viewBox="0 0 24 24">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ))}
    </span>
  );
}

export default function Atendimento() {
  const navigate = useNavigate(); // ← declarado corretamente
  const [displayMessages, setDisplayMessages] = useState([]); // msgs exibidas
  const apiConv = useRef([]); // conversa completa enviada à API (inclui msg inicial oculta)
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);
  const [collectedData, setCollectedData] = useState(null);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [displayMessages, loading]);

  // ─── Inicia o chat com mensagem oculta para acionar a saudação do agente ──
  const startChat = async () => {
    setStarted(true);
    setLoading(true);
    const seedMsg = { role: "user", content: "Olá! Vim pelo site do Rogério Costa." };
    apiConv.current = [seedMsg];
    try {
      const { reply } = await callAI(apiConv.current);
      apiConv.current = [...apiConv.current, { role: "assistant", content: reply }];
      setDisplayMessages([{ role: "assistant", content: reply }]);
    } catch (e) {
      const fallback = "Olá! Seja bem-vindo(a) à consultoria do Rogério Costa 😊 Qual é o seu nome?";
      apiConv.current = [...apiConv.current, { role: "assistant", content: fallback }];
      setDisplayMessages([{ role: "assistant", content: fallback }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  // ─── Envia mensagem do usuário ─────────────────────────────────────────────
  const send = async () => {
    const msg = input.trim();
    if (!msg || loading || finished) return;
    setInput("");

    const userMsg = { role: "user", content: msg };
    const nextApiConv = [...apiConv.current, userMsg];
    apiConv.current = nextApiConv;
    setDisplayMessages((m) => [...m, userMsg]);
    setLoading(true);

    try {
      const { reply, collectedData: cd } = await callAI(nextApiConv);
      const aiMsg = { role: "assistant", content: reply };
      apiConv.current = [...nextApiConv, aiMsg];
      setDisplayMessages((m) => [...m, aiMsg]);

      if (cd) {
        setCollectedData(cd);
        setFinished(true);
        saveLead(cd);
      }
    } catch (e) {
      setDisplayMessages((m) => [
        ...m,
        { role: "assistant", content: "Desculpe, tive uma instabilidade momentânea. Pode repetir sua última mensagem? 😊" },
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  // ─── Salva lead no backend e redireciona ao checkout ──────────────────────
  const saveLead = async (data) => {
    try {
      const res = await api.post("/public/atendimento/lead", data);
      const token = res.data?.token;
      if (token) {
        setTimeout(() => navigate(`/checkout/${token}`), 1400);
      }
    } catch (_) { /* silencioso — lead salvo de forma best-effort */ }
  };

  // ─── Tela de boas-vindas ──────────────────────────────────────────────────
  if (!started) {
    return (
      <div className="min-h-screen bg-rc-ink relative overflow-hidden flex flex-col items-center justify-center px-4">
        <GlowOrb color="#0081FD" size={600} top="-15%" left="-10%" opacity={0.15} />
        <GlowOrb color="#0066CC" size={400} top="55%" left="65%" opacity={0.12} />
        <div className="absolute inset-0 rc-grid-bg pointer-events-none" />

        <a href="/landing.html" className="absolute top-6 left-6 rc-btn-ghost">
          <ArrowLeft className="w-4 h-4" /> Voltar
        </a>

        <div className="relative z-10 max-w-lg w-full text-center animate-fade-up">
          <div className="w-20 h-20 rounded-full bg-rc-blue/10 border-2 border-rc-blue/40 flex items-center justify-center mx-auto mb-6 shadow-[0_0_40px_rgba(0,129,253,0.25)]">
            <svg className="w-9 h-9 text-rc-blue" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
          </div>

          <div className="text-[10px] text-rc-blue uppercase tracking-[0.3em] font-bold mb-3">
            Assistente de Atendimento
          </div>
          <h1 className="rc-h1 text-3xl sm:text-4xl mb-4">RC Nutri</h1>
          <p className="text-gray-400 text-sm leading-relaxed mb-2 max-w-sm mx-auto">
            Olá! Sou o assistente do <strong className="text-white">Rogério Costa</strong> e vou
            te fazer algumas perguntas rápidas para montar a melhor estratégia para o seu objetivo.
          </p>
          <p className="text-gray-600 text-xs mb-8">Leva menos de 5 minutos ⚡</p>

          <div className="flex items-center justify-center gap-3 mb-8">
            <div className="flex -space-x-2">
              {["CF", "FF", "EF", "LO", "KL"].map((init) => (
                <div key={init} className="w-7 h-7 rounded-full bg-rc-blue/20 border-2 border-rc-ink flex items-center justify-center text-[9px] font-bold text-rc-blue">
                  {init}
                </div>
              ))}
            </div>
            <div className="text-left">
              <StarRating count={5} />
              <p className="text-[11px] text-gray-400 mt-0.5">+500 alunos transformados</p>
            </div>
          </div>

          <button
            onClick={startChat}
            className="rc-btn-primary text-base px-10 py-3 shadow-[0_8px_40px_rgba(0,129,253,0.4)]"
          >
            Iniciar atendimento →
          </button>
        </div>
      </div>
    );
  }

  // ─── Tela de conclusão ────────────────────────────────────────────────────
  if (finished && collectedData) {
    return (
      <div className="min-h-screen bg-rc-ink relative overflow-hidden flex flex-col items-center justify-center px-4">
        <GlowOrb color="#0081FD" size={500} top="-15%" left="-10%" opacity={0.15} />
        <div className="absolute inset-0 rc-grid-bg pointer-events-none" />

        <div className="relative z-10 max-w-md w-full animate-fade-up">
          <div className="rc-glass rounded-2xl p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-400/10 border-2 border-emerald-400/40 flex items-center justify-center mx-auto mb-5">
              <CheckCircle className="w-8 h-8 text-emerald-400" />
            </div>
            <h2 className="rc-h2 text-2xl mb-2">Perfeito, {collectedData.nome || "bem-vindo"}! 🎉</h2>
            <p className="text-gray-400 text-sm leading-relaxed mb-6">
              Suas informações foram registradas. Redirecionando para finalizar sua inscrição…
            </p>
            <div className="flex justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-rc-blue" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Chat ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-rc-ink flex flex-col relative overflow-hidden">
      <GlowOrb color="#0081FD" size={400} top="-10%" left="-5%" opacity={0.1} />

      {/* Header */}
      <header className="relative z-10 flex items-center gap-3 px-4 py-3 border-b border-white/[0.06] bg-rc-surface/80 backdrop-blur-xl">
        <a href="/landing.html" className="text-gray-500 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/5">
          <ArrowLeft className="w-4 h-4" />
        </a>
        <div className="w-9 h-9 rounded-full bg-rc-blue/15 border border-rc-blue/40 flex items-center justify-center flex-shrink-0">
          <svg className="w-4 h-4 text-rc-blue" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
          </svg>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold uppercase tracking-wider truncate">RC Nutri</p>
          <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-pulse" />
            Online agora
          </p>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-4 relative z-10" style={{ maxHeight: "calc(100vh - 130px)" }}>
        {displayMessages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            {m.role === "assistant" && (
              <div className="w-7 h-7 rounded-full bg-rc-blue/15 border border-rc-blue/30 flex items-center justify-center flex-shrink-0 mr-2 mt-1">
                <svg className="w-3.5 h-3.5 text-rc-blue" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                </svg>
              </div>
            )}
            <div
              className={`max-w-[78%] sm:max-w-[65%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                m.role === "user"
                  ? "bg-rc-blue text-black font-semibold rounded-tr-sm"
                  : "bg-rc-surface border border-white/[0.07] text-gray-100 rounded-tl-sm"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="w-7 h-7 rounded-full bg-rc-blue/15 border border-rc-blue/30 flex items-center justify-center flex-shrink-0 mr-2 mt-1">
              <svg className="w-3.5 h-3.5 text-rc-blue" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </div>
            <div className="bg-rc-surface border border-white/[0.07] rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5">
              {[0, 1, 2].map((i) => (
                <span key={i} className="w-2 h-2 rounded-full bg-gray-500 animate-pulse"
                  style={{ animationDelay: `${i * 0.2}s` }} />
              ))}
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className="relative z-10 px-4 py-3 border-t border-white/[0.06] bg-rc-surface/80 backdrop-blur-xl">
        <div className="flex gap-2 items-end max-w-3xl mx-auto">
          <textarea
            ref={inputRef}
            rows={1}
            className="rc-input resize-none flex-1 min-h-[44px] max-h-32 py-2.5 text-sm leading-snug overflow-auto"
            placeholder="Digite sua resposta..."
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = Math.min(e.target.scrollHeight, 128) + "px";
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            disabled={loading || finished}
          />
          <button
            onClick={send}
            disabled={loading || !input.trim() || finished}
            className="rc-btn-primary h-11 w-11 p-0 flex-shrink-0 rounded-xl"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
        <p className="text-center text-[10px] text-gray-600 mt-1.5">
          Assistente IA do Rogério Costa · Consulta gratuita
        </p>
      </div>
    </div>
  );
}
