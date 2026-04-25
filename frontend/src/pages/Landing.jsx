import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, BrainCircuit, LineChart, Calendar, ShieldCheck, Dumbbell, Apple, Activity, Target } from "lucide-react";
import { api, formatApiError } from "@/lib/evo-api";
import GlowOrb from "@/components/evonut/GlowOrb";
import Brand from "@/components/evonut/Brand";
import RCLogo from "@/components/evonut/RCLogo";
import { toast } from "sonner";

const features = [
  { icon: BrainCircuit, title: "IA Clínica Embarcada", desc: "Anamnese adaptativa com Claude Sonnet 4.5 e análise antropométrica automatizada." },
  { icon: Dumbbell, title: "Treino + Nutrição", desc: "Plano alimentar coordenado com sua rotina de treino, intensidade e objetivo." },
  { icon: LineChart, title: "Evolução Visual", desc: "Comparativos lado a lado, gráficos por avaliação e diagnóstico narrativo da IA." },
  { icon: ShieldCheck, title: "Acompanhamento Total", desc: "Do primeiro contato à entrega do plano em um único pipeline integrado." },
];

const stats = [
  { v: "60%", l: "Menos tempo operacional" },
  { v: "15", l: "Seções de anamnese" },
  { v: "5", l: "Protocolos de dobras" },
  { v: "AI", l: "Plano gerado em segundos" },
];

const heroImage = "https://images.pexels.com/photos/35420834/pexels-photo-35420834.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940";

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
      toast.success("Cadastro recebido! Vamos para a anamnese.");
      navigate(`/pre-consulta/${data.token}`);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Erro ao iniciar cadastro");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden bg-rc-ink">
      <GlowOrb color="#0081FD" size={520} top="-10%" left="-8%" opacity={0.32} />
      <GlowOrb color="#0066CC" size={420} top="40%" left="70%" opacity={0.22} />
      <div className="absolute inset-0 rc-grid-bg pointer-events-none" />

      {/* Nav */}
      <header className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2" data-testid="brand-link">
          <Brand size="md" />
        </Link>
        <nav className="flex items-center gap-2">
          <Link to="/login" data-testid="login-link" className="rc-btn-ghost">Entrar</Link>
          <a href="#start" data-testid="cta-start-nav" className="rc-btn-primary">Começar agora</a>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 lg:pt-20 pb-16 grid lg:grid-cols-12 gap-10">
        <div className="lg:col-span-7 animate-fade-up">
          <div className="inline-flex items-center gap-2 rc-glass rounded-full px-3 py-1.5 text-[11px] uppercase tracking-[0.2em] text-gray-300 mb-6 font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-rc-blue animate-pulse-soft" />
            Treinador & Nutricionista · Sistema Premium
          </div>

          <h1 className="rc-h1 text-balance">
            Treino e nutrição em <span className="rc-text-blue">um só sistema</span>.
          </h1>
          <p className="mt-6 text-base sm:text-lg text-gray-300 max-w-2xl leading-relaxed">
            Do primeiro contato ao plano alimentar — anamnese inteligente, antropometria, análise de exames
            e acompanhamento da evolução em um pipeline pensado para resultado real.
          </p>

          <form id="start" onSubmit={startLead} className="mt-10 rc-card p-6 max-w-xl">
            <div className="text-[11px] text-rc-blue uppercase tracking-[0.25em] mb-4 font-bold flex items-center gap-2">
              <Target className="w-3.5 h-3.5" /> Agende sua avaliação
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="rc-label">Nome completo</label>
                <input data-testid="lead-name-input" className="rc-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome" />
              </div>
              <div>
                <label className="rc-label">WhatsApp</label>
                <input data-testid="lead-phone-input" className="rc-input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(11) 98888-7777" />
              </div>
              <div className="sm:col-span-2">
                <label className="rc-label">E-mail (opcional)</label>
                <input data-testid="lead-email-input" type="email" className="rc-input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" />
              </div>
            </div>
            <button data-testid="lead-submit-btn" disabled={loading} className="rc-btn-primary w-full mt-5">
              {loading ? "Enviando..." : "Iniciar Avaliação"}
              <ArrowRight className="w-4 h-4" />
            </button>
            <div className="mt-3 text-xs text-gray-500">É profissional? <Link to="/login" className="text-rc-blue hover:underline font-bold uppercase tracking-wider">Entrar no painel</Link></div>
          </form>

          <div className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-4">
            {stats.map((s) => (
              <div key={s.l} className="rc-card p-4">
                <div className="font-display text-2xl font-black text-rc-blue uppercase tracking-tight">{s.v}</div>
                <div className="text-[11px] text-gray-400 mt-1 uppercase tracking-wider font-semibold">{s.l}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-5 relative animate-fade-up" style={{ animationDelay: "120ms" }}>
          <div className="rc-glass rounded-2xl p-5 relative overflow-hidden">
            <img
              alt="Atleta em treinamento de alta performance"
              src={heroImage}
              className="rounded-xl w-full h-72 object-cover opacity-90"
            />
            {/* Logo watermark on image */}
            <div className="absolute top-8 right-8">
              <RCLogo size={56} variant="blue" />
            </div>
            {/* Stat card 1 */}
            <div className="absolute top-12 -left-6 rc-glass rounded-xl p-4 w-56 shadow-2xl rotate-[-3deg] border-rc-blue/30">
              <div className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-bold flex items-center gap-1.5">
                <Activity className="w-3 h-3 text-rc-blue" /> Aderência
              </div>
              <div className="font-display text-base font-bold mt-1 uppercase">Score IA</div>
              <div className="mt-2 flex items-end gap-1">
                <span className="font-display text-3xl font-black text-rc-blue">8.7</span>
                <span className="text-xs text-gray-400 mb-1">/ 10</span>
              </div>
              <div className="mt-2 h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-rc-blue" style={{ width: "87%" }} />
              </div>
            </div>
            {/* Stat card 2 */}
            <div className="absolute bottom-8 right-2 rc-glass rounded-xl p-4 w-60 shadow-2xl rotate-[2deg] border-rc-blue/30">
              <div className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-bold flex items-center gap-1.5">
                <Apple className="w-3 h-3 text-rc-blue" /> Plano alimentar
              </div>
              <div className="font-display text-base font-bold mt-1 uppercase">2.340 kcal</div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-bold uppercase tracking-wider">
                <span className="px-2 py-0.5 rounded-full bg-rc-blue/20 text-rc-blue border border-rc-blue/30">PTN 31%</span>
                <span className="px-2 py-0.5 rounded-full bg-rc-blueLight/20 text-rc-blueLight border border-rc-blueLight/30">CHO 44%</span>
                <span className="px-2 py-0.5 rounded-full bg-amber-400/15 text-amber-400 border border-amber-400/30">LIP 25%</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="max-w-2xl">
          <div className="text-rc-blue text-xs font-bold tracking-[0.25em] uppercase">Pipeline 6 Etapas</div>
          <h2 className="rc-h2 mt-2">Do diagnóstico ao plano. Sem fricção.</h2>
          <p className="text-gray-400 mt-3 text-base">Lead → Anamnese → Agendamento → Análise IA → Plano → Acompanhamento.</p>
        </div>
        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {features.map((f) => (
            <div key={f.title} data-testid={`feature-${f.title}`} className="rc-card rc-card-hover p-6">
              <div className="w-12 h-12 rounded-xl bg-rc-blue/10 border border-rc-blue/30 flex items-center justify-center">
                <f.icon className="w-6 h-6 text-rc-blue" />
              </div>
              <h3 className="rc-h3 mt-4 text-base">{f.title}</h3>
              <p className="text-sm text-gray-400 mt-2 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="rc-card p-10 lg:p-14 relative overflow-hidden border-rc-blue/30">
          <GlowOrb color="#0081FD" size={300} top="-20%" left="80%" opacity={0.4} />
          <div className="relative grid lg:grid-cols-2 gap-8 items-center">
            <div>
              <Dumbbell className="w-8 h-8 text-rc-blue" />
              <h2 className="rc-h2 mt-4">Resultado real exige sistema real.</h2>
              <p className="text-gray-300 mt-3 leading-relaxed">
                Comece com a avaliação inicial gratuita ou, se você é profissional, acesse o painel completo:
                anamnese, antropometria, comparativos e plano gerado por IA.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row lg:justify-end gap-3">
              <Link to="/login" data-testid="cta-login" className="rc-btn-secondary justify-center">Sou Profissional</Link>
              <a href="#start" data-testid="cta-bottom-start" className="rc-btn-primary justify-center">Quero meu Plano <ArrowRight className="w-4 h-4" /></a>
            </div>
          </div>
        </div>
      </section>

      <footer className="relative z-10 border-t border-white/[0.06] py-8 text-center text-[11px] text-gray-500 uppercase tracking-[0.25em] font-bold">
        ROGÉRIO COSTA · TREINADOR E NUTRICIONISTA
      </footer>
    </div>
  );
}
