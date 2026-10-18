import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight, ArrowUpRight, ShieldCheck, MessageCircle, Salad, Dumbbell, LineChart, FlaskConical,
  Smartphone, ClipboardCheck, Menu, X, Star, Flame, Timer, Trophy, ListChecks,
} from "lucide-react";
import RCLogo from "@/components/evonut/RCLogo";
import MacroRings from "@/components/evonut/MacroRings";
import { API, api } from "@/lib/evo-api";
import { Reveal, SectionLabel, CheckItem } from "@/components/landing/LandingParts";
import { Phone, WorkoutScreen, SetScreen, ProgressScreen, NutritionScreen } from "@/components/landing/AppScreens";

const WHATSAPP = "5511983692815";
const waLink = (msg) => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(msg)}`;

// Resultados e relatos reais publicados no site original do Rogerio.
const RESULTADOS = [
  { de: "15,5%", para: "10%", rotulo: "de gordura", quem: "Caio Felipe", tempo: "3 meses" },
  { de: "73 kg", para: "61 kg", rotulo: "com mais disposição", quem: "Flavia Fantin", tempo: "" },
  { para: "−7%", rotulo: "de gordura, sem dieta restritiva", quem: "Eduarda Freire", tempo: "3 meses" },
  { para: "−8 kg", rotulo: "o que não veio treinando sozinha", quem: "Lilian Oliveira", tempo: "10 meses" },
  { para: "−8%", rotulo: "de gordura e mais massa magra", quem: "Kauê Lopes", tempo: "3 meses" },
  { para: "2016", rotulo: "aluna desde então", quem: "Fernanda Zecchin", tempo: "" },
];

const DEPOIMENTOS_PADRAO = [
  { name: "Caio Felipe", phrase: "15,5% → 10% de gordura em 3 meses", quote: "Em 3 meses reduzi meu percentual de gordura de 15,5% para 10% e ainda tive melhora notável na saúde. A dieta é prática, os treinos bem explicados e o suporte pelo WhatsApp é excelente." },
  { name: "Flavia Fantin", phrase: "73 kg → 61 kg com saúde e disposição", quote: "Saí dos 73 kg para 61 kg com mais disposição, autoestima e saúde. Nos primeiros meses já vi mais energia, menos inchaço e motivação renovada. Foi uma verdadeira virada de chave." },
  { name: "Fernanda Zecchin", phrase: "Aluna desde 2016", quote: "Estou com ele desde 2016 e não troco por ninguém. Em um mês ganhei energia, reduzi as dores no joelho e melhorei o fortalecimento. O suporte constante e os ajustes personalizados fazem toda diferença." },
  { name: "Eduarda Freire", phrase: "−7% de gordura em 3 meses", quote: "Perdi 7% de gordura em três meses, ganhei massa magra e vi resultados reais, tudo sem dieta restritiva. Recomendo pra quem quer mudar o estilo de vida com saúde e consistência." },
  { name: "Lilian Oliveira", phrase: "−8 kg em 10 meses", quote: "Em 10 meses foram 8 kg a menos, algo que não havia conseguido em um ano treinando sozinha. O investimento vale a pena quando temos um profissional tão qualificado ao lado." },
  { name: "Kauê Lopes", phrase: "−8% de gordura e mais massa magra", quote: "Em 3 meses reduzi 8% de gordura e me senti mais saudável e disposto no dia a dia. O suporte com treinos e ajustes na dieta fez toda a diferença pra ganhar massa de forma organizada." },
];

const DORES = [
  "Começa, para, recomeça, e o resultado nunca aparece de verdade.",
  "Já treinou e fez dieta, mas sempre parece faltar alguma peça.",
  "Segue planos genéricos que não cabem na sua rotina.",
  "Quer alguém guiando com método, clareza e compromisso real.",
];

const ETAPAS = [
  { n: "01", t: "Avaliação completa", d: "Body check, rotina, histórico, objetivos e, quando houver, seus exames. Nada começa sem entender o seu ponto de partida." },
  { n: "02", t: "Plano sob medida", d: "Dieta e treino montados juntos, pelo mesmo profissional. Cardápio prático, adaptado à sua vida, sem restrições radicais." },
  { n: "03", t: "Ajuste contínuo", d: "Check-ins, retornos e dados reais de evolução. O plano muda quando o seu corpo responde, não quando a planilha manda." },
];

// Mesmos planos do atendimento (Agente 1) e do checkout.
const PLANOS = [
  {
    id: "treino",
    nome: "Plano Treino",
    duracao: "2 meses",
    tagline: "Treino personalizado no app, com método do primeiro ao último exercício.",
    itens: [
      "Avaliação física e da sua rotina",
      "Treino personalizado no app",
      "Vídeos de execução de cada exercício",
      "Registro de séries, cargas e timer de descanso",
      "Gráficos de evolução e conquistas",
    ],
    cta: "Quero o Plano Treino",
    msg: "Olá, Rogério! Vim pelo site e tenho interesse no Plano Treino. Pode me passar as condições?",
  },
  {
    id: "gold",
    nome: "Consultoria Gold",
    duracao: "2 meses",
    destaque: true,
    tagline: "Treino e nutrição integrados pelo mesmo profissional, com suporte VIP.",
    itens: [
      "Tudo do Plano Treino e do Plano Nutrição",
      "Avaliação física e consulta completa",
      "App com vídeos de execução e seu plano nutricional",
      "Suporte VIP e ilimitado no WhatsApp do Rogério",
      "Feedback semanal com ajustes no planejamento",
    ],
    cta: "Quero a Consultoria Gold",
    msg: "Olá, Rogério! Vim pelo site e tenho interesse na Consultoria Gold. Pode me passar as condições?",
  },
  {
    id: "nutricao",
    nome: "Plano Nutrição",
    duracao: "2 meses",
    tagline: "Plano alimentar sob medida e acompanhamento para ajustar pelo resultado.",
    itens: [
      "Consulta e avaliação nutricional",
      "Plano alimentar individualizado",
      "Calorias e macros calculados para o seu objetivo",
      "Exames laboratoriais considerados na estratégia",
      "Acompanhamento com ajustes no plano",
    ],
    cta: "Quero o Plano Nutrição",
    msg: "Olá, Rogério! Vim pelo site e tenho interesse no Plano Nutrição. Pode me passar as condições?",
  },
];

const FAQ = [
  { q: "Como funciona a consultoria online?", a: "Você faz um atendimento inicial rápido, passa pela avaliação completa e recebe dieta e treino no app. A partir daí, check-ins e retornos ajustam o plano conforme a sua evolução." },
  { q: "Como funciona o app de treino?", a: "Você abre o treino do dia, vê séries, repetições e carga de cada exercício, registra o que fez e usa o timer de descanso. O app guarda seu histórico, mostra a evolução das cargas e libera conquistas pela sua constância." },
  { q: "A dieta é muito restritiva?", a: "Não. O cardápio é prático e montado em cima da sua rotina e das suas preferências, sem cortes radicais. O objetivo é algo que você consiga sustentar." },
  { q: "Vou falar direto com o Rogério?", a: "Sim. O suporte é pelo WhatsApp, direto com ele, sem intermediários. No app você também tem o plano, o histórico e um assistente para dúvidas do dia a dia." },
  { q: "Qual a diferença entre os planos?", a: "Todos têm 2 meses de acompanhamento. O Plano Treino cuida do treino no app, o Plano Nutrição cuida da sua alimentação e a Consultoria Gold integra os dois, com suporte VIP ilimitado e feedback semanal." },
  { q: "E se eu não ficar satisfeito?", a: "Seguindo todas as etapas da consultoria, se você não estiver 100% satisfeito com os resultados, seu investimento é devolvido integralmente." },
  { q: "Como eu começo?", a: "Clique em começar e faça o atendimento inicial, que leva menos de 5 minutos. Valores e condições de pagamento são apresentados no atendimento." },
];

function Nav({ onStart }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const links = [["#app", "O app"], ["#metodo", "Método"], ["#resultados", "Resultados"], ["#planos", "Planos"], ["#duvidas", "Dúvidas"]];
  return (
    <header className={`fixed top-0 inset-x-0 z-50 transition-colors duration-300 ${scrolled || open ? "bg-rc-ink/85 backdrop-blur-xl border-b border-white/[0.06]" : "border-b border-transparent"}`}>
      <div className="max-w-[1240px] mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
        <a href="#topo" className="flex items-center gap-2.5" aria-label="Rogério Costa, início">
          <RCLogo size={30} variant="blue" />
          <span className="rc-display text-[16px] text-white">Rogério Costa</span>
        </a>
        <nav className="hidden md:flex items-center gap-1" aria-label="Seções">
          {links.map(([h, l]) => <a key={h} href={h} className="rc-btn-ghost">{l}</a>)}
        </nav>
        <div className="flex items-center gap-2">
          <Link to="/login-paciente" className="hidden sm:inline-flex rc-btn-ghost">Área do paciente</Link>
          <button onClick={onStart} className="hidden sm:inline-flex rc-btn-lime">Começar agora</button>
          <button className="md:hidden rc-btn-ghost p-2 -mr-2" onClick={() => setOpen((v) => !v)} aria-label="Menu" aria-expanded={open}>
            {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>
      {open && (
        <nav className="md:hidden px-5 pb-5 pt-1 grid gap-1 animate-fade-in" aria-label="Seções">
          {links.map(([h, l]) => <a key={h} href={h} onClick={() => setOpen(false)} className="py-3 text-[17px] text-gray-100 border-b border-white/[0.05]">{l}</a>)}
          <Link to="/login-paciente" className="py-3 text-[17px] text-gray-400">Área do paciente</Link>
        </nav>
      )}
    </header>
  );
}

function Hero({ onStart }) {
  return (
    <section id="topo" className="relative pt-28 sm:pt-36 pb-16 sm:pb-24 overflow-hidden">
      <div className="absolute inset-0 rc-grid-bg pointer-events-none" />
      <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[1100px] h-[700px] bg-[radial-gradient(closest-side,rgba(0,129,253,0.16),transparent)] pointer-events-none" />
      <div className="relative max-w-[1240px] mx-auto px-5 sm:px-8 grid lg:grid-cols-[1.15fr_0.85fr] gap-14 lg:gap-8 items-center">
        <div>
          <div className="animate-fade-up inline-flex items-center gap-2 rounded-full bg-white/[0.05] pl-1.5 pr-3.5 py-1.5 text-[12.5px] text-gray-300 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
            <span className="rounded-full bg-rc-lime text-rc-ink text-[11px] font-semibold px-2 py-0.5">Novo</span>
            App de treino + acompanhamento nutricional
          </div>
          <h1 className="rc-display text-[clamp(56px,7.2vw,112px)] text-white mt-6 animate-fade-up" style={{ animationDelay: "60ms" }}>
            Treino no app. <span className="text-rc-lime">Dieta com método.</span>
          </h1>
          <p className="text-[17px] sm:text-[19px] text-gray-300 mt-7 max-w-[34ch] sm:max-w-[46ch] leading-relaxed animate-fade-up" style={{ animationDelay: "120ms" }}>
            Treino do dia, séries, cargas e descanso no celular. Plano alimentar e acompanhamento do Rogério, treinador e nutricionista, ajustando tudo pela sua evolução.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3 animate-fade-up" style={{ animationDelay: "180ms" }}>
            <button onClick={onStart} className="rc-btn-lime h-14 px-7 text-[15px]" data-testid="hero-cta">
              Quero começar minha transformação <ArrowRight className="w-4 h-4" />
            </button>
            <a href="#resultados" className="rc-btn-secondary h-14 px-6 text-[15px]">Ver resultados</a>
          </div>
          <p className="mt-4 text-[13px] text-gray-500 animate-fade-up" style={{ animationDelay: "220ms" }}>
            Atendimento inicial em menos de 5 minutos · Garantia de satisfação
          </p>

          <dl className="mt-12 grid grid-cols-3 max-w-lg divide-x divide-white/[0.07] animate-fade-up" style={{ animationDelay: "260ms" }}>
            {[["10+", "anos de experiência"], ["500+", "alunos acompanhados"], ["2 em 1", "treino e nutrição"]].map(([n, l], i) => (
              <div key={l} className={i ? "pl-5" : "pr-5"}>
                <dt className="rc-num text-[34px] sm:text-[40px] leading-none text-white">{n}</dt>
                <dd className="text-[12.5px] text-gray-500 mt-2 leading-snug">{l}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="relative flex justify-center lg:justify-end">
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[560px] h-[560px] rounded-full bg-[radial-gradient(closest-side,rgba(195,245,60,0.10),rgba(0,129,253,0.08)_55%,transparent)] pointer-events-none" />
          <div className="relative">
            <Phone label="Tela de dieta do app" className="!absolute left-1/2 top-10 -translate-x-[8%] rotate-[6deg] scale-[0.9] opacity-60 hidden sm:block">
              <NutritionScreen />
            </Phone>
            <div className="relative sm:-translate-x-[38%]">
              <div className="rc-float">
                <Phone label="Tela de treino do dia no app">
                  <WorkoutScreen />
                </Phone>
              </div>
            </div>
            <div className="hidden sm:flex absolute -left-[78%] top-[34%] rc-glass rounded-2xl px-4 py-3 items-center gap-3 animate-fade-up" style={{ animationDelay: "500ms" }}>
              <span className="w-8 h-8 rounded-[10px] bg-rc-amber/15 text-rc-amber flex items-center justify-center"><Flame className="w-4 h-4" /></span>
              <div>
                <div className="text-[13px] text-white font-medium">7 dias seguidos</div>
                <div className="text-[11.5px] text-gray-400">Conquista desbloqueada</div>
              </div>
            </div>
            <div className="hidden sm:flex absolute -right-2 bottom-16 rc-glass rounded-2xl px-4 py-3 items-center gap-3 animate-fade-up" style={{ animationDelay: "650ms" }}>
              <span className="w-8 h-8 rounded-[10px] bg-rc-lime/15 text-rc-lime flex items-center justify-center"><Salad className="w-4 h-4" /></span>
              <div>
                <div className="text-[13px] text-white font-medium">Dieta ajustada</div>
                <div className="text-[11.5px] text-gray-400">Para o seu dia de treino</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ResultadosFaixa() {
  const itens = [...RESULTADOS, ...RESULTADOS];
  return (
    <section aria-label="Resultados de alunos" className="border-y border-white/[0.06] bg-rc-black/40 overflow-hidden">
      <div className="rc-marquee py-7">
        {itens.map((r, i) => (
          <div key={i} className="flex items-baseline gap-3 px-10 border-r border-white/[0.06] whitespace-nowrap" aria-hidden={i >= RESULTADOS.length}>
            <span className="rc-num text-[34px] text-white leading-none">
              {r.de && <><span className="text-gray-500">{r.de}</span><span className="text-gray-600 mx-2">→</span></>}
              <span className="text-rc-lime">{r.para}</span>
            </span>
            <span className="text-[13px] text-gray-400">{r.rotulo}<br /><span className="text-gray-500">{r.quem}{r.tempo ? ` · ${r.tempo}` : ""}</span></span>
          </div>
        ))}
      </div>
    </section>
  );
}

const APP_FEATURES = [
  { k: "treino", icon: ListChecks, t: "Treino do dia", d: "Seus exercícios organizados por dia, com séries, repetições, carga e observações do Rogério.", Screen: WorkoutScreen },
  { k: "series", icon: Timer, t: "Séries, cargas e descanso", d: "Registre carga e repetições de cada série. O timer de descanso avisa a hora de voltar.", Screen: SetScreen },
  { k: "evolucao", icon: Trophy, t: "Evolução e conquistas", d: "Gráficos de carga por exercício, recordes pessoais e conquistas pela sua constância.", Screen: ProgressScreen },
  { k: "dieta", icon: Salad, t: "Dieta e macros", d: "Meta calórica, macros e refeições do seu plano alimentar, ajustados pelo Rogério.", Screen: NutritionScreen },
];

function AppShowcase() {
  const [ativo, setAtivo] = useState(0);
  const tocou = useRef(false);
  useEffect(() => {
    const reduz = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduz) return undefined;
    const id = setInterval(() => { if (!tocou.current) setAtivo((i) => (i + 1) % APP_FEATURES.length); }, 5000);
    return () => clearInterval(id);
  }, []);
  const escolher = (i) => { tocou.current = true; setAtivo(i); };
  return (
    <section id="app" className="py-24 sm:py-32 bg-rc-black/40 border-y border-white/[0.05] scroll-mt-16 overflow-hidden">
      <div className="max-w-[1240px] mx-auto px-5 sm:px-8 grid lg:grid-cols-[1fr_auto] gap-14 lg:gap-20 items-center">
        <div>
          <Reveal>
            <SectionLabel n="02">O app</SectionLabel>
            <h2 className="rc-display text-[clamp(44px,5.6vw,80px)] text-white mt-6">Seu personal <span className="text-rc-lime">no bolso.</span></h2>
            <p className="text-gray-400 text-[17px] mt-5 max-w-[46ch]">Abra o app na academia e saiba exatamente o que fazer. Fora dela, a dieta e o Rogério continuam com você.</p>
          </Reveal>
          <div className="mt-10 space-y-2" role="tablist" aria-label="Funcionalidades do app">
            {APP_FEATURES.map((f, i) => (
              <button
                key={f.k}
                role="tab"
                aria-selected={ativo === i}
                onClick={() => escolher(i)}
                onMouseEnter={() => escolher(i)}
                className={`w-full text-left rounded-2xl px-5 py-4 flex gap-4 transition-colors duration-200 ${ativo === i ? "bg-rc-surface shadow-[var(--shadow-card)]" : "hover:bg-white/[0.025]"}`}
              >
                <span className={`mt-0.5 w-9 h-9 shrink-0 rounded-[10px] flex items-center justify-center transition-colors ${ativo === i ? "bg-rc-lime text-rc-ink" : "bg-white/[0.05] text-gray-400"}`}>
                  <f.icon className="w-[18px] h-[18px]" strokeWidth={1.9} />
                </span>
                <span>
                  <span className={`block text-[17px] font-medium ${ativo === i ? "text-white" : "text-gray-300"}`}>{f.t}</span>
                  <span className={`block text-[14.5px] leading-relaxed mt-1 ${ativo === i ? "text-gray-400" : "text-gray-500"}`}>{f.d}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
        <Reveal className="flex justify-center">
          <div className="relative">
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] h-[520px] rounded-full bg-[radial-gradient(closest-side,rgba(195,245,60,0.10),rgba(0,129,253,0.06)_55%,transparent)] pointer-events-none" />
            <Phone label={`Tela do app: ${APP_FEATURES[ativo].t}`}>
              {APP_FEATURES.map((f, i) => (
                <div
                  key={f.k}
                  aria-hidden={ativo !== i}
                  className="absolute inset-0 transition-[opacity,filter] duration-300 ease-out"
                  style={{ opacity: ativo === i ? 1 : 0, filter: ativo === i ? "none" : "blur(2px)" }}
                >
                  <f.Screen />
                </div>
              ))}
            </Phone>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function ParaQuem({ onStart }) {
  return (
    <section className="py-24 sm:py-32">
      <div className="max-w-[1240px] mx-auto px-5 sm:px-8 grid lg:grid-cols-[0.9fr_1.1fr] gap-12 lg:gap-20">
        <Reveal>
          <SectionLabel n="01">Para quem é</SectionLabel>
          <h2 className="rc-display text-[clamp(44px,5.6vw,80px)] text-white mt-6">Cansado de <span className="text-rc-blue">recomeçar</span>?</h2>
          <p className="text-gray-400 text-[17px] mt-6 max-w-[42ch] leading-relaxed">
            Força de vontade não falta. Falta um plano que entenda a sua rotina e alguém que ajuste o caminho quando ele sai do trilho.
          </p>
          <button onClick={onStart} className="rc-btn-primary h-12 px-6 mt-9">Quero um plano feito para mim <ArrowRight className="w-4 h-4" /></button>
        </Reveal>
        <ol className="grid sm:grid-cols-2 gap-px bg-white/[0.06] rounded-2xl overflow-hidden self-start">
          {DORES.map((d, i) => (
            <Reveal as="li" key={d} delay={i * 60} className="bg-rc-ink p-7 sm:p-8">
              <span className="rc-num text-rc-lime text-[15px]">0{i + 1}</span>
              <p className="text-[18px] text-gray-100 mt-4 leading-snug">{d}</p>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Metodo() {
  return (
    <section id="metodo" className="py-24 sm:py-32 bg-rc-black/40 border-y border-white/[0.05] scroll-mt-16">
      <div className="max-w-[1240px] mx-auto px-5 sm:px-8">
        <Reveal className="max-w-3xl">
          <SectionLabel n="03">O método</SectionLabel>
          <h2 className="rc-display text-[clamp(44px,5.6vw,80px)] text-white mt-6">Cada detalhe do seu plano tem <span className="text-rc-lime">um porquê.</span></h2>
        </Reveal>
        <div className="mt-16 grid md:grid-cols-3 gap-10 md:gap-8">
          {ETAPAS.map((e, i) => (
            <Reveal key={e.n} delay={i * 80} className="relative">
              <div className="rc-num text-[120px] leading-[0.8] text-transparent [-webkit-text-stroke:1.5px_rgba(255,255,255,0.18)]">{e.n}</div>
              <div className="h-px bg-gradient-to-r from-rc-lime/70 via-white/10 to-transparent mt-6" />
              <h3 className="font-display font-bold uppercase text-[22px] text-white mt-6" style={{ fontStretch: "80%" }}>{e.t}</h3>
              <p className="text-gray-400 mt-3 leading-relaxed text-[15.5px]">{e.d}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Entregas() {
  const card = "rc-card p-7 sm:p-8 relative overflow-hidden";
  return (
    <section className="py-24 sm:py-32">
      <div className="max-w-[1240px] mx-auto px-5 sm:px-8">
        <Reveal className="flex items-end justify-between flex-wrap gap-6">
          <div className="max-w-2xl">
            <SectionLabel n="04">O que você recebe</SectionLabel>
            <h2 className="rc-display text-[clamp(44px,5.6vw,80px)] text-white mt-6">Tudo o que o resultado <span className="text-rc-lime">exige.</span></h2>
          </div>
          <p className="text-gray-400 max-w-[38ch]">Nutrição, treino e acompanhamento no mesmo lugar, com tecnologia a favor da sua consistência.</p>
        </Reveal>

        <div className="mt-14 grid md:grid-cols-6 gap-4">
          <Reveal className={`${card} md:col-span-4`}>
            <div className="grid sm:grid-cols-[1fr_auto] gap-8 items-center">
              <div>
                <Salad className="w-6 h-6 text-rc-lime" strokeWidth={1.75} />
                <h3 className="text-[24px] font-display font-bold uppercase text-white mt-5" style={{ fontStretch: "80%" }}>Plano alimentar individualizado</h3>
                <p className="text-gray-400 mt-3 max-w-[44ch] leading-relaxed">Calorias e macros calculados para o seu objetivo, em um cardápio prático que cabe na sua rotina. Sem restrições radicais.</p>
              </div>
              <div className="flex items-center gap-5">
                <MacroRings className="w-32 h-32" stroke={16} values={{ ptn: 0.3, cho: 0.45, lip: 0.25 }} />
                <ul className="space-y-2 text-[13px]">
                  <li className="flex items-center gap-2 text-gray-300"><span className="w-2 h-2 rounded-[2px] bg-macro-ptn" />Proteína</li>
                  <li className="flex items-center gap-2 text-gray-300"><span className="w-2 h-2 rounded-[2px] bg-macro-cho" />Carboidrato</li>
                  <li className="flex items-center gap-2 text-gray-300"><span className="w-2 h-2 rounded-[2px] bg-macro-lip" />Gordura</li>
                </ul>
              </div>
            </div>
          </Reveal>
          <Reveal delay={60} className={`${card} md:col-span-2`}>
            <Dumbbell className="w-6 h-6 text-rc-blueLight" strokeWidth={1.75} />
            <h3 className="text-[24px] font-display font-bold uppercase text-white mt-5" style={{ fontStretch: "80%" }}>Treino personalizado</h3>
            <p className="text-gray-400 mt-3 leading-relaxed">Montado junto com a dieta, pelo mesmo profissional, e entregue direto no app. Um plano só, não dois.</p>
          </Reveal>
          <Reveal className={`${card} md:col-span-2`}>
            <MessageCircle className="w-6 h-6 text-rc-lime" strokeWidth={1.75} />
            <h3 className="text-[24px] font-display font-bold uppercase text-white mt-5" style={{ fontStretch: "80%" }}>Rogério no WhatsApp</h3>
            <p className="text-gray-400 mt-3 leading-relaxed">Dúvida respondida por quem montou o seu plano. Sem intermediários, sem demora.</p>
          </Reveal>
          <Reveal delay={60} className={`${card} md:col-span-2`}>
            <Smartphone className="w-6 h-6 text-rc-blueLight" strokeWidth={1.75} />
            <h3 className="text-[24px] font-display font-bold uppercase text-white mt-5" style={{ fontStretch: "80%" }}>App de treino</h3>
            <p className="text-gray-400 mt-3 leading-relaxed">Treino do dia, registro de séries, timer de descanso e vídeos de execução no celular.</p>
          </Reveal>
          <Reveal delay={120} className={`${card} md:col-span-2`}>
            <FlaskConical className="w-6 h-6 text-rc-lime" strokeWidth={1.75} />
            <h3 className="text-[24px] font-display font-bold uppercase text-white mt-5" style={{ fontStretch: "80%" }}>Exames com olhar nutricional</h3>
            <p className="text-gray-400 mt-3 leading-relaxed">Seus exames laboratoriais considerados na estratégia, para ajustar o plano ao que o seu corpo mostra.</p>
          </Reveal>
          <Reveal className={`${card} md:col-span-3`}>
            <ClipboardCheck className="w-6 h-6 text-rc-blueLight" strokeWidth={1.75} />
            <h3 className="text-[24px] font-display font-bold uppercase text-white mt-5" style={{ fontStretch: "80%" }}>Body check completo</h3>
            <p className="text-gray-400 mt-3 leading-relaxed max-w-[48ch]">Avaliação detalhada de composição corporal para definir a estratégia exata e medir cada avanço.</p>
          </Reveal>
          <Reveal delay={60} className={`${card} md:col-span-3`}>
            <LineChart className="w-6 h-6 text-rc-lime" strokeWidth={1.75} />
            <h3 className="text-[24px] font-display font-bold uppercase text-white mt-5" style={{ fontStretch: "80%" }}>Retornos e evolução</h3>
            <p className="text-gray-400 mt-3 leading-relaxed max-w-[48ch]">Consultas periódicas com dados reais de progresso. Ajuste baseado em evidência, não em palpite.</p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function Depoimentos({ itens }) {
  return (
    <section id="resultados" className="py-24 sm:py-32 bg-rc-black/40 border-y border-white/[0.05] scroll-mt-16">
      <div className="max-w-[1240px] mx-auto px-5 sm:px-8">
        <Reveal className="max-w-3xl">
          <SectionLabel n="05">Resultados</SectionLabel>
          <h2 className="rc-display text-[clamp(44px,5.6vw,80px)] text-white mt-6">Quem confiou no processo <span className="text-rc-lime">conta.</span></h2>
        </Reveal>
        <div className="mt-14 columns-1 md:columns-2 lg:columns-3 gap-4 [&>*]:mb-4">
          {itens.map((t, i) => (
            <Reveal key={t.id || t.name} delay={(i % 3) * 60} className="break-inside-avoid rc-card p-7">
              <div className="flex items-center gap-0.5 text-rc-lime" aria-label={`${t.stars || 5} estrelas`}>
                {Array.from({ length: t.stars || 5 }).map((_, k) => <Star key={k} className="w-3.5 h-3.5 fill-current" />)}
              </div>
              {t.phrase && <div className="rc-num text-[26px] leading-tight text-white mt-4">{t.phrase}</div>}
              <blockquote className="text-gray-300 mt-4 leading-relaxed text-[15.5px]">“{t.quote}”</blockquote>
              <figcaption className="flex items-center gap-3 mt-6">
                {t.id ? (
                  <img src={`${API}/public/testimonials/${t.id}/photo`} alt="" loading="lazy" className="w-9 h-9 rounded-[10px] object-cover bg-rc-raised" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                ) : (
                  <span className="w-9 h-9 rounded-[10px] bg-rc-raised text-rc-lime flex items-center justify-center text-[12px] font-semibold">
                    {t.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
                  </span>
                )}
                <span className="text-[14px] text-white font-medium">{t.name}</span>
              </figcaption>
            </Reveal>
          ))}
        </div>
        <p className="text-[12.5px] text-gray-500 mt-6">Resultados individuais. Cada corpo responde no seu tempo.</p>
      </div>
    </section>
  );
}

function Sobre({ onStart }) {
  const [foto, setFoto] = useState(true);
  return (
    <section className="py-24 sm:py-32">
      <div className="max-w-[1240px] mx-auto px-5 sm:px-8 grid lg:grid-cols-2 gap-14 items-center">
        <Reveal className="relative order-last lg:order-first">
          <div className="relative aspect-[4/5] max-w-[520px] rounded-3xl overflow-hidden bg-rc-surface shadow-[var(--shadow-card)]">
            {foto ? (
              <img src="/landing/rogerio.webp" alt="Rogério Costa, treinador e nutricionista" className="w-full h-full object-cover" onError={() => setFoto(false)} />
            ) : (
              <div className="absolute inset-0 p-8 sm:p-10 flex flex-col bg-[radial-gradient(520px_420px_at_20%_10%,rgba(0,129,253,0.24),transparent_60%),radial-gradient(420px_360px_at_100%_100%,rgba(195,245,60,0.10),transparent_60%)]">
                <RCLogo size={44} variant="blue" />
                <blockquote className="rc-display text-[clamp(36px,4.2vw,54px)] text-white mt-auto mb-24">
                  “Nada de achismo. Cada detalhe do seu plano tem <span className="text-rc-lime">um porquê.</span>”
                </blockquote>
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 p-6 bg-gradient-to-t from-black/80 to-transparent">
              <div className="rc-display text-[34px] text-white">Rogério Costa</div>
              <div className="text-[13px] text-gray-300 mt-1">Treinador e Nutricionista</div>
            </div>
          </div>
        </Reveal>
        <Reveal>
          <SectionLabel n="06">Quem vai te acompanhar</SectionLabel>
          <h2 className="rc-display text-[clamp(44px,5.6vw,80px)] text-white mt-6">Treino e nutrição em <span className="text-rc-blue">um só</span> profissional.</h2>
          <div className="space-y-4 text-gray-300 text-[16.5px] leading-relaxed mt-7 max-w-[54ch]">
            <p>Sou treinador e nutricionista, especializado em treinamento de força e nutrição esportiva. Ajudo pessoas a conquistar um corpo forte e definido sem abrir mão da vida social.</p>
            <p>Se você busca performance, estética e qualidade de vida, meu trabalho é transformar esse objetivo em um plano que você consegue seguir.</p>
          </div>
          <ul className="grid sm:grid-cols-2 gap-3 mt-8">
            <CheckItem>Pós-graduado em Bodybuilding Coach</CheckItem>
            <CheckItem>+10 anos em treinamento personalizado</CheckItem>
            <CheckItem>5 anos em nutrição esportiva</CheckItem>
            <CheckItem>Treino + nutrição integrados</CheckItem>
          </ul>
          <button onClick={onStart} className="rc-btn-primary h-12 px-6 mt-10">Quero ser acompanhado pelo Rogério <ArrowRight className="w-4 h-4" /></button>
        </Reveal>
      </div>
    </section>
  );
}

function Planos({ onStart }) {
  return (
    <section id="planos" className="py-24 sm:py-32 bg-rc-black/40 border-y border-white/[0.05] scroll-mt-16 relative overflow-hidden">
      <div className="absolute left-1/2 top-1/3 -translate-x-1/2 w-[900px] h-[600px] bg-[radial-gradient(closest-side,rgba(195,245,60,0.07),transparent)] pointer-events-none" />
      <div className="relative max-w-[1240px] mx-auto px-5 sm:px-8">
        <Reveal className="text-center max-w-3xl mx-auto">
          <div className="flex justify-center"><SectionLabel n="07">Planos</SectionLabel></div>
          <h2 className="rc-display text-[clamp(44px,5.6vw,80px)] text-white mt-6">Escolha o seu <span className="text-rc-lime">plano.</span></h2>
          <p className="text-gray-400 text-[17px] mt-5">Treino, nutrição ou os dois integrados. Mesmo método, 2 meses de acompanhamento com o Rogério.</p>
        </Reveal>

        <div className="mt-14 grid lg:grid-cols-3 gap-5 max-w-md lg:max-w-none mx-auto items-stretch">
          {PLANOS.map((p, i) => (
            <Reveal
              key={p.id}
              delay={i * 80}
              className={`relative rounded-3xl p-8 flex flex-col ${p.destaque ? "order-first lg:order-none lg:-my-3 lg:py-11 " : ""}${p.destaque
                ? "bg-rc-raised shadow-[0_0_0_1.5px_#C3F53C,0_40px_80px_-40px_rgba(195,245,60,0.35)]"
                : "rc-card"}`}
            >
              {p.destaque && (
                <div className="absolute -top-3.5 left-8 rounded-md bg-rc-lime text-rc-ink text-[12px] font-semibold px-3 py-1">Mais popular</div>
              )}
              <div className="flex items-start justify-between gap-4">
                <h3 className="rc-display text-[38px] text-white">{p.nome}</h3>
                <span className="rc-num text-[15px] text-gray-500 whitespace-nowrap pt-2">{p.duracao}</span>
              </div>
              <p className={`mt-3 text-[15.5px] ${p.destaque ? "text-gray-200" : "text-gray-400"}`}>{p.tagline}</p>
              <div className="h-px bg-white/[0.08] my-7" />
              <ul className="space-y-3.5 flex-1">
                {p.itens.map((it) => <CheckItem key={it} muted={!p.destaque}>{it}</CheckItem>)}
              </ul>
              <a
                href={waLink(p.msg)}
                target="_blank"
                rel="noopener noreferrer"
                data-testid={`plano-${p.id}`}
                className={`${p.destaque ? "rc-btn-lime" : "rc-btn-secondary"} h-14 w-full text-[15px] mt-9`}
              >
                {p.cta} <ArrowUpRight className="w-4 h-4" />
              </a>
              <p className="text-[12.5px] text-gray-500 text-center mt-3">Valores e condições enviados no atendimento</p>
            </Reveal>
          ))}
        </div>

        <Reveal className="text-center mt-10">
          <p className="text-gray-400">
            Ainda em dúvida?{" "}
            <button onClick={onStart} className="text-white underline decoration-rc-lime/60 underline-offset-4 hover:decoration-rc-lime">Faça o atendimento inicial</button>{" "}
            e descubra o formato ideal para você.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

function Garantia({ onStart }) {
  return (
    <section className="py-24 sm:py-28">
      <div className="max-w-[1240px] mx-auto px-5 sm:px-8">
        <Reveal className="rounded-3xl bg-rc-surface shadow-[var(--shadow-card)] p-8 sm:p-14 grid lg:grid-cols-[auto_1fr_auto] gap-8 lg:gap-12 items-center relative overflow-hidden">
          <div className="absolute -right-20 -bottom-24 w-[380px] h-[380px] rounded-full bg-[radial-gradient(closest-side,rgba(195,245,60,0.12),transparent)]" />
          <div className="relative w-24 h-24 rounded-full bg-rc-lime/10 flex items-center justify-center shadow-[0_0_0_1px_rgba(195,245,60,0.35)]">
            <ShieldCheck className="w-11 h-11 text-rc-lime" strokeWidth={1.5} />
          </div>
          <div className="relative">
            <h2 className="rc-display text-[clamp(38px,4.4vw,60px)] text-white">O risco é <span className="text-rc-lime">todo nosso.</span></h2>
            <p className="text-gray-300 text-[17px] mt-4 max-w-[60ch] leading-relaxed">
              Participe da consultoria, siga todas as etapas e, se você não estiver 100% satisfeito com os resultados, devolvemos o seu investimento integralmente. Sem perguntas, sem complicação.
            </p>
          </div>
          <button onClick={onStart} className="relative rc-btn-lime h-14 px-7 text-[15px]">Começar com garantia <ArrowRight className="w-4 h-4" /></button>
        </Reveal>
      </div>
    </section>
  );
}

function Duvidas() {
  return (
    <section id="duvidas" className="pb-24 sm:pb-32 scroll-mt-20">
      <div className="max-w-[1240px] mx-auto px-5 sm:px-8 grid lg:grid-cols-[0.8fr_1.2fr] gap-12">
        <Reveal>
          <SectionLabel n="08">Dúvidas</SectionLabel>
          <h2 className="rc-display text-[clamp(44px,5.6vw,80px)] text-white mt-6">Antes de <span className="text-rc-blue">começar.</span></h2>
          <a href={waLink("Olá, Rogério! Vim pelo site e tenho uma dúvida sobre a consultoria.")} target="_blank" rel="noopener noreferrer" className="rc-btn-secondary h-12 px-5 mt-8">
            <MessageCircle className="w-4 h-4" /> Perguntar no WhatsApp
          </a>
        </Reveal>
        <dl className="grid sm:grid-cols-2 gap-x-10 gap-y-10">
          {FAQ.map((f, i) => (
            <Reveal key={f.q} delay={(i % 2) * 60}>
              <dt className="text-[17px] text-white font-medium">{f.q}</dt>
              <dd className="text-gray-400 mt-2.5 leading-relaxed text-[15px]">{f.a}</dd>
            </Reveal>
          ))}
        </dl>
      </div>
    </section>
  );
}

function ChamadaFinal({ onStart }) {
  return (
    <section className="relative overflow-hidden border-t border-white/[0.06]">
      <div className="absolute inset-0 bg-[radial-gradient(900px_500px_at_50%_120%,rgba(0,129,253,0.22),transparent_70%)]" />
      <div className="relative max-w-[1240px] mx-auto px-5 sm:px-8 py-28 sm:py-36 text-center">
        <Reveal>
          <h2 className="rc-display text-[clamp(54px,8.4vw,128px)] text-white">O próximo treino <br className="hidden sm:block" />começa com <span className="text-rc-lime">um plano.</span></h2>
          <p className="text-gray-300 text-[18px] mt-7 max-w-[46ch] mx-auto">Conte seu objetivo em poucos minutos. O Rogério monta a estratégia, você executa com suporte do primeiro ao último dia.</p>
          <button onClick={onStart} className="rc-btn-lime h-14 px-8 text-[15px] mt-10">Quero começar agora <ArrowRight className="w-4 h-4" /></button>
        </Reveal>
      </div>
    </section>
  );
}

function Rodape() {
  return (
    <footer className="border-t border-white/[0.06] pb-24 sm:pb-0">
      <div className="max-w-[1240px] mx-auto px-5 sm:px-8 py-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
        <div className="flex items-center gap-2.5">
          <RCLogo size={28} variant="blue" />
          <div className="leading-none">
            <div className="rc-display text-[15px] text-white">Rogério Costa</div>
            <div className="text-[11px] text-gray-500 mt-1">Treinador e Nutricionista</div>
          </div>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-[13.5px] text-gray-400" aria-label="Rodapé">
          <Link to="/login-paciente" className="hover:text-white">Área do paciente</Link>
          <Link to="/login" className="hover:text-white">Acesso profissional</Link>
          <a href={waLink("Olá, Rogério! Vim pelo site.")} target="_blank" rel="noopener noreferrer" className="hover:text-white">WhatsApp</a>
        </nav>
        <div className="text-[12.5px] text-gray-600">© {new Date().getFullYear()} Rogério Costa</div>
      </div>
    </footer>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const [depoimentos, setDepoimentos] = useState(DEPOIMENTOS_PADRAO);
  const [showSticky, setShowSticky] = useState(false);
  const onStart = () => navigate("/atendimento");

  useEffect(() => {
    document.title = "Rogério Costa | App de treino com acompanhamento nutricional";
    api.get("/public/testimonials")
      .then(({ data }) => { if (Array.isArray(data) && data.length) setDepoimentos(data); })
      .catch(() => {});
    const onScroll = () => setShowSticky(window.scrollY > 640);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="min-h-[100dvh] text-gray-100 overflow-x-clip">
      <Nav onStart={onStart} />
      <main>
        <Hero onStart={onStart} />
        <ResultadosFaixa />
        <ParaQuem onStart={onStart} />
        <AppShowcase />
        <Metodo />
        <Entregas />
        <Depoimentos itens={depoimentos} />
        <Sobre onStart={onStart} />
        <Planos onStart={onStart} />
        <Garantia onStart={onStart} />
        <Duvidas />
        <ChamadaFinal onStart={onStart} />
      </main>
      <Rodape />

      {/* CTA fixo no celular */}
      <div className={`sm:hidden fixed bottom-0 inset-x-0 z-40 p-3 pb-[calc(12px+env(safe-area-inset-bottom))] bg-rc-ink/90 backdrop-blur-xl border-t border-white/[0.06] transition-transform duration-300 ease-out ${showSticky ? "translate-y-0" : "translate-y-full"}`}>
        <button onClick={onStart} className="rc-btn-lime w-full h-12 text-[15px]">Quero começar agora <ArrowRight className="w-4 h-4" /></button>
      </div>
    </div>
  );
}
