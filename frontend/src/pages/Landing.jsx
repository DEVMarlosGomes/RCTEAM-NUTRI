import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Sparkles, BrainCircuit, LineChart, Calendar, ShieldCheck, Stethoscope } from "lucide-react";
import { api, formatApiError } from "@/lib/evo-api";
import GlowOrb from "@/components/evonut/GlowOrb";
import { toast } from "sonner";

const features = [
  { icon: BrainCircuit, title: "IA Clínica Embarcada", desc: "Análise antropométrica, exames e padrões alimentares interpretados com Claude Sonnet 4.5." },
  { icon: LineChart, title: "Evolução Visual", desc: "Comparativo lado a lado, gráficos por avaliação e diagnóstico narrativo automatizado." },
  { icon: Calendar, title: "Pipeline Completo", desc: "Do lead à consulta — formulário, chat adaptativo e agendamento em um único fluxo." },
  { icon: ShieldCheck, title: "Multi-profissional", desc: "Cada nutricionista com seu CRM clínico, dados isolados e rastreabilidade total." },
];

const stats = [
  { v: "60%", l: "menos tempo operacional" },
  { v: "15", l: "seções de anamnese" },
  { v: "5", l: "protocolos de dobras" },
  { v: "AI", l: "plano alimentar gerado" },
];

export default function Landing() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const startLead = async (e) => {
    e.preventDefault();
    if (!name || !phone) {
      toast.error("Preencha nome e telefone");
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post("/leads", { name, phone, email: email || null });
      toast.success("Lead criado! Vamos para a anamnese.");
      navigate(`/pre-consulta/${data.token}`);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Erro ao criar lead");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden bg-evo-bg">
      <GlowOrb color="#7B61FF" size={520} top="-10%" left="-8%" opacity={0.35} />
      <GlowOrb color="#1DB97E" size={420} top="40%" left="70%" opacity={0.28} />
      <div className="absolute inset-0 evo-grid-bg pointer-events-none" />

      {/* Nav */}
      <header className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2" data-testid="brand-link">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-evo-purple to-evo-teal flex items-center justify-center shadow-[0_4px_14px_rgba(123,97,255,0.4)]">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div className="flex flex-col leading-none">
            <span className="font-display text-lg font-semibold tracking-tight">EvoNut</span>
            <span className="text-[10px] text-gray-400 tracking-widest uppercase">Clinical AI</span>
          </div>
        </Link>
        <nav className="flex items-center gap-2">
          <Link to="/login" data-testid="login-link" className="evo-btn-ghost text-sm">Entrar</Link>
          <a href="#start" data-testid="cta-start-nav" className="evo-btn-primary text-sm">Começar agora</a>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 lg:pt-20 pb-16 grid lg:grid-cols-12 gap-10">
        <div className="lg:col-span-7 animate-fade-up">
          <div className="inline-flex items-center gap-2 evo-glass rounded-full px-3 py-1 text-xs text-gray-300 mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-evo-teal animate-pulse-soft" />
            Sistema Nutricional Inteligente — versão sênior
          </div>
          <h1 className="evo-h1 text-balance">
            Da captação ao plano: <span className="evo-text-gradient">nutrição clínica</span> com IA embarcada.
          </h1>
          <p className="mt-6 text-base sm:text-lg text-gray-300 max-w-2xl">
            EvoNut automatiza anamnese, análise antropométrica, interpretação de padrões alimentares e geração de plano —
            entregando ao nutricionista um CRM clínico premium pronto para a consulta.
          </p>

          <form id="start" onSubmit={startLead} className="mt-10 evo-card p-6 max-w-xl">
            <div className="text-sm text-gray-400 uppercase tracking-wider mb-4 font-semibold">Pré-consulta gratuita</div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="evo-label">Nome completo</label>
                <input data-testid="lead-name-input" className="evo-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome" />
              </div>
              <div>
                <label className="evo-label">WhatsApp</label>
                <input data-testid="lead-phone-input" className="evo-input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(11) 98888-7777" />
              </div>
              <div className="sm:col-span-2">
                <label className="evo-label">E-mail (opcional)</label>
                <input data-testid="lead-email-input" type="email" className="evo-input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" />
              </div>
            </div>
            <button data-testid="lead-submit-btn" disabled={loading} className="evo-btn-primary w-full mt-5">
              {loading ? "Iniciando..." : "Iniciar minha pré-consulta"}
              <ArrowRight className="w-4 h-4" />
            </button>
            <div className="mt-3 text-xs text-gray-500">Você é nutricionista? <Link to="/login" className="text-evo-purple hover:underline">Entrar no painel</Link></div>
          </form>

          <div className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-4">
            {stats.map((s) => (
              <div key={s.l} className="evo-card p-4">
                <div className="font-display text-2xl font-semibold evo-text-gradient">{s.v}</div>
                <div className="text-xs text-gray-400 mt-1">{s.l}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-5 relative animate-fade-up" style={{ animationDelay: "120ms" }}>
          <div className="evo-glass rounded-2xl p-5 relative overflow-hidden">
            <img
              alt="EvoNut clinical analysis"
              src="https://images.unsplash.com/photo-1736773879027-8db3a20621fd?crop=entropy&cs=srgb&fm=jpg&q=85"
              className="rounded-xl w-full h-64 object-cover opacity-90"
            />
            <div className="absolute top-10 -left-6 evo-glass rounded-xl p-4 w-56 shadow-2xl rotate-[-3deg]">
              <div className="text-[10px] uppercase tracking-widest text-gray-400">Análise IA</div>
              <div className="font-display text-base font-semibold mt-1">Score de adesão</div>
              <div className="mt-2 flex items-end gap-1">
                <span className="font-display text-3xl font-semibold text-evo-teal">8.7</span>
                <span className="text-xs text-gray-400 mb-1">/10</span>
              </div>
              <div className="mt-2 h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-evo-purple to-evo-teal" style={{ width: "87%" }} />
              </div>
            </div>
            <div className="absolute bottom-8 right-2 evo-glass rounded-xl p-4 w-56 shadow-2xl rotate-[2deg]">
              <div className="text-[10px] uppercase tracking-widest text-gray-400">Plano</div>
              <div className="font-display text-base font-semibold mt-1">2.340 kcal/dia</div>
              <div className="mt-2 flex gap-2 text-[11px]">
                <span className="px-2 py-0.5 rounded-full bg-evo-purple/20 text-evo-purple">PTN 31%</span>
                <span className="px-2 py-0.5 rounded-full bg-evo-teal/20 text-evo-teal">CHO 44%</span>
                <span className="px-2 py-0.5 rounded-full bg-evo-amber/20 text-evo-amber">LIP 25%</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="max-w-2xl">
          <div className="text-evo-purple text-sm font-semibold tracking-widest uppercase">Pipeline 6 etapas</div>
          <h2 className="evo-h2 mt-2">Inteligência clínica em cada etapa do funil.</h2>
          <p className="text-gray-400 mt-3">Lead → Anamnese → Agendamento → Análise IA → Plano → Acompanhamento. Sem fricção.</p>
        </div>
        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {features.map((f) => (
            <div key={f.title} data-testid={`feature-${f.title}`} className="evo-card evo-card-hover p-6">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-evo-purple/20 to-evo-teal/20 border border-white/[0.08] flex items-center justify-center">
                <f.icon className="w-5 h-5 text-evo-purple" />
              </div>
              <h3 className="evo-h3 mt-4 text-lg">{f.title}</h3>
              <p className="text-sm text-gray-400 mt-2">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="evo-card p-10 lg:p-14 relative overflow-hidden">
          <GlowOrb color="#7B61FF" size={300} top="-20%" left="80%" opacity={0.4} />
          <div className="relative grid lg:grid-cols-2 gap-8 items-center">
            <div>
              <Stethoscope className="w-7 h-7 text-evo-teal" />
              <h2 className="evo-h2 mt-4">Para nutricionistas que querem autoridade clínica.</h2>
              <p className="text-gray-400 mt-3">Crie sua conta e teste o painel completo: dashboard, antropometria com 5 protocolos, comparativo evolutivo e geração de plano por IA.</p>
            </div>
            <div className="flex flex-col sm:flex-row lg:justify-end gap-3">
              <Link to="/login" data-testid="cta-login" className="evo-btn-secondary justify-center">Já tenho conta</Link>
              <a href="#start" data-testid="cta-bottom-start" className="evo-btn-primary justify-center">Começar grátis <ArrowRight className="w-4 h-4" /></a>
            </div>
          </div>
        </div>
      </section>

      <footer className="relative z-10 border-t border-white/[0.06] py-8 text-center text-xs text-gray-500">
        EvoNut — Sistema Nutricional Inteligente · v1.0
      </footer>
    </div>
  );
}
