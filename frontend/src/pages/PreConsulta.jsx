import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api, formatApiError } from "@/lib/evo-api";
import GlowOrb from "@/components/evonut/GlowOrb";
import Brand from "@/components/evonut/Brand";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  User,
  Activity,
  Target,
  Calendar,
  Moon,
  Wine,
  Droplet,
  Apple,
  Heart,
  Briefcase,
  Zap,
  Activity as ActivityIcon,
  PlusCircle,
  Image as ImageIcon,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

/**
 * Estrutura de seções 100% alinhada ao doc "FORMULÁRIO PRÉ CONSULTA".
 * Cada seção tem id, title, helper opcional, ícone e fields tipados.
 * Tipos suportados: text, email, number, date, textarea, radio, radio-card,
 *                   multi-check, slider, yes-no, photos.
 */
const SECTIONS = [
  {
    id: "dados_pessoais",
    title: "Dados pessoais",
    icon: User,
    helper: "Suas informações serão usadas para montar um plano alimentar 100% personalizado.",
    fields: [
      { k: "email", l: "E-mail", type: "email", placeholder: "voce@email.com" },
      { k: "nome", l: "Nome completo", type: "text", req: true },
      { k: "data_nascimento", l: "Data de nascimento", type: "date", req: true },
      { k: "estatura", l: "Estatura (cm)", type: "number", req: true, placeholder: "ex: 178" },
      { k: "peso_atual", l: "Peso atual (kg)", type: "number", req: true, placeholder: "ex: 82.5" },
    ],
  },
  {
    id: "condicionamento",
    title: "Condicionamento físico",
    icon: Activity,
    helper: "Selecione a opção que mais se aproxima da sua realidade atual.",
    fields: [
      {
        k: "condicionamento",
        type: "radio-card",
        req: true,
        opts: [
          { v: "sem_experiencia", l: "Sem experiência", desc: "Nunca treinou ou está começando do zero" },
          { v: "inativo", l: "Inativo", desc: "Já treinou, mas está parado atualmente" },
          { v: "ativo_1", l: "Ativo 1", desc: "Treina às vezes, sem muita regularidade" },
          { v: "ativo_2", l: "Ativo 2", desc: "Treina com frequência e mantém rotina consistente" },
          { v: "atleta", l: "Atleta", desc: "Treina com alto nível de disciplina e foco em performance" },
        ],
      },
    ],
  },
  {
    id: "objetivo",
    title: "Objetivo",
    icon: Target,
    helper: "O que você deseja alcançar com esse acompanhamento?",
    fields: [
      {
        k: "objetivo",
        l: "Descreva seu objetivo",
        type: "textarea",
        req: true,
        placeholder: "ex: emagrecimento, ganho de massa, melhorar saúde, performance...",
      },
    ],
  },
  {
    id: "treino",
    title: "Rotina de treino",
    icon: Calendar,
    fields: [
      {
        k: "dias_treino",
        l: "Marque os dias que você pode treinar",
        type: "multi-check",
        opts: ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"],
      },
      {
        k: "horario_treino",
        l: "Qual horário costuma ou pretende treinar?",
        type: "text",
        placeholder: "ex: 06:00 da manhã / após o trabalho",
      },
    ],
  },
  {
    id: "sono",
    title: "Sono",
    icon: Moon,
    helper: "Como está seu sono atualmente? (Pode marcar mais de uma)",
    fields: [
      {
        k: "sono",
        type: "multi-check",
        opts: [
          "Tenho dificuldade para dormir",
          "Acordo durante a noite",
          "Sono leve ou agitado",
          "Uso celular antes de dormir",
          "Acordo cansado",
          "Durmo bem",
        ],
      },
    ],
  },
  {
    id: "habitos",
    title: "Hábitos",
    icon: Wine,
    fields: [
      {
        k: "alcool",
        l: "Com que frequência você consome bebidas alcoólicas?",
        type: "radio",
        opts: [
          "Apenas finais de semana",
          "Apenas socialmente",
          "Durante a semana e finais de semana",
          "Quase todos os dias",
          "Não consumo",
        ],
      },
    ],
  },
  {
    id: "agua",
    title: "Consumo de água",
    icon: Droplet,
    helper: "Considere um copo de aproximadamente 200ml.",
    fields: [
      {
        k: "agua",
        l: "Quanto de água você consome por dia?",
        type: "radio",
        opts: [
          "Menos de 1L (até 5 copos)",
          "Entre 1L e 2L (5 a 10 copos)",
          "Entre 2L e 3L (10 a 15 copos)",
          "Mais de 3L (mais de 15 copos)",
        ],
      },
    ],
  },
  {
    id: "alimentacao",
    title: "Alimentação",
    icon: Apple,
    helper: "Considere sua rotina da maior parte da semana.",
    fields: [
      {
        k: "alimentacao_atual",
        l: "Como você avalia sua alimentação atual?",
        type: "radio-card",
        opts: [
          { v: "pouco_saudavel", l: "Pouco saudável", desc: "Muitos industrializados, fast food, frituras e baixa ingestão de alimentos naturais" },
          { v: "moderado", l: "Moderado", desc: "Alimentação razoável, mas com exageros frequentes" },
          { v: "saudavel", l: "Saudável", desc: "Base alimentar equilibrada, com alimentos naturais na maior parte do tempo" },
        ],
      },
      {
        k: "alergias",
        l: "Possui alguma alergia, intolerância ou alimento que não gosta?",
        type: "textarea",
        placeholder: "ex: lactose, glúten, frutos do mar... ou alimentos que evita",
      },
      { k: "frutas_preferidas", l: "Quais frutas você prefere?", type: "textarea", placeholder: "ex: banana, mamão, morango, abacate..." },
    ],
  },
  {
    id: "saude",
    title: "Saúde",
    icon: Heart,
    helper: "Informações importantes para garantir segurança e personalização do plano.",
    fields: [
      { k: "lesoes", l: "Possui alguma lesão muscular ou articular?", type: "textarea", placeholder: "Se sim, qual?" },
      { k: "doencas", l: "Possui alguma condição de saúde ou desconforto relevante?", type: "textarea" },
      { k: "medicacao", l: "Faz uso de algum medicamento contínuo?", type: "textarea", placeholder: "Se sim, qual?" },
      { k: "anabolizantes", l: "Faz ou já fez uso de esteroides anabolizantes?", type: "yes-no" },
      { k: "exames_recentes", l: "Realizou exames de sangue nos últimos 6 meses?", type: "yes-no" },
    ],
  },
  {
    id: "trabalho",
    title: "Rotina de trabalho",
    icon: Briefcase,
    helper: "Essas informações ajudam a adaptar sua dieta à sua rotina diária.",
    fields: [
      { k: "profissao", l: "Qual sua atividade profissional atual?", type: "text" },
      {
        k: "tipo_trabalho",
        l: "Durante o trabalho, você passa a maior parte do tempo:",
        type: "multi-check",
        opts: ["Sentado", "Caminhando", "Em pé", "Subindo escadas", "Carregando peso"],
      },
      {
        k: "estrutura_alimentacao",
        l: "No seu trabalho, você tem acesso a:",
        type: "multi-check",
        opts: ["Geladeira", "Micro-ondas", "Local para armazenar ou preparar refeições", "Não tenho acesso"],
      },
    ],
  },
  {
    id: "energia",
    title: "Energia e desempenho",
    icon: Zap,
    fields: [
      { k: "energia", l: "Como está sua energia no dia a dia?", type: "slider", min: 0, max: 10 },
      {
        k: "desempenho_treino",
        l: "Como você avalia seu desempenho nos treinos?",
        type: "radio-card",
        opts: [
          { v: "baixo", l: "Baixo", desc: "Pouca energia e rendimento" },
          { v: "medio", l: "Médio", desc: "Consegue treinar, mas pode melhorar" },
          { v: "alto", l: "Alto", desc: "Boa energia e desempenho" },
        ],
      },
    ],
  },
  {
    id: "intestino",
    title: "Funcionamento intestinal",
    icon: ActivityIcon,
    fields: [
      {
        k: "intestino",
        l: "Como está seu funcionamento intestinal?",
        type: "radio",
        opts: [
          "Regular (diário)",
          "Às vezes irregular",
          "Constipação frequente",
          "Diarreia frequente",
          "Muito instável",
        ],
      },
    ],
  },
  {
    id: "outras",
    title: "Outras informações",
    icon: PlusCircle,
    fields: [
      { k: "suplementacao", l: "Utiliza algum tipo de suplementação? Se sim, qual?", type: "textarea" },
      { k: "fumo", l: "Você fuma? Se sim, quantos cigarros por dia?", type: "text", placeholder: "ex: não / 5 por dia" },
      {
        k: "libido",
        l: "Como está seu desejo sexual (libido)?",
        type: "radio",
        opts: ["Baixo", "Varia ao longo do tempo", "Alto"],
      },
    ],
  },
  {
    id: "saude_geral",
    title: "Saúde geral",
    icon: Heart,
    fields: [
      { k: "saude_score", l: "De 0 a 10, como você avalia sua saúde atualmente?", type: "slider", min: 0, max: 10 },
      {
        k: "rotina_alimentar",
        l: "Descreva de forma breve sua rotina alimentar",
        helper: "Se souber as quantidades melhor — caso não, sem problemas.",
        type: "textarea",
        placeholder:
          "Exemplo:\n07:00 — Café da manhã: 2 fatias de pão + 1 ovo + 1 fruta\n10:00 — Lanche: 1 iogurte + 1 fruta + whey\n12:00 — Almoço: arroz + feijão + carne + salada\n16:00 — Lanche da tarde: 2 fatias de pão + 1 ovo + 1 fruta\n19:00 — Jantar: arroz + feijão + carne + salada",
        rows: 8,
      },
    ],
  },
  {
    id: "fotos",
    title: "Fotos (opcional)",
    icon: ImageIcon,
    helper: "Frente, lateral e costas — para análise antropométrica visual. Privadas, vistas só pelo Rogério.",
    fields: [
      { k: "fotos", type: "photos" },
    ],
  },
];

const STORAGE_KEY = (token) => `rc_anamnesis_${token}`;

// ---------- helpers ----------
function calcAge(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 && age < 130 ? age : "";
}

async function fileToResizedBase64(file, maxSize = 1280, quality = 0.78) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const ratio = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.round(img.width * ratio);
        const h = Math.round(img.height * ratio);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ========== Main page ==========
export default function PreConsulta() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [data, setData] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [lead, setLead] = useState(null);

  useEffect(() => {
    if (!token) return;
    api
      .get(`/public/lead/${token}`)
      .then((r) => setLead(r.data))
      .catch(() => {
        toast.error("Link inválido ou expirado");
        navigate("/");
      });
    const cached = localStorage.getItem(STORAGE_KEY(token));
    if (cached) {
      try {
        setData(JSON.parse(cached));
      } catch (_) {}
    }
  }, [token, navigate]);

  const persist = (d) => token && localStorage.setItem(STORAGE_KEY(token), JSON.stringify(d));

  const idade = useMemo(() => calcAge(data.data_nascimento), [data.data_nascimento]);

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-300 bg-rc-ink">
        <div className="text-center">
          <p className="mb-4">Você precisa de um link de pré-consulta válido.</p>
          <Link to="/" className="rc-btn-primary">
            Voltar à página inicial
          </Link>
        </div>
      </div>
    );
  }

  const section = SECTIONS[step];
  const total = SECTIONS.length;
  const progress = ((step + 1) / total) * 100;

  const update = (k, v) => {
    const next = { ...data, [k]: v };
    setData(next);
    persist(next);
  };

  const canAdvance = () => {
    return section.fields.every((f) => {
      if (!f.req) return true;
      const v = data[f.k];
      if (f.type === "multi-check") return Array.isArray(v) && v.length > 0;
      return v !== undefined && v !== "" && v !== null;
    });
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      // Strip photos from JSON payload — too heavy. Send via separate route.
      const { fotos, ...respostas } = data;
      const idade = calcAge(data.data_nascimento);
      if (idade !== "") respostas.idade = idade;

      await api.post("/public/anamnesis", { token, respostas });
      if (Array.isArray(fotos) && fotos.length > 0) {
        try {
          await api.post(`/public/lead/${token}/photos`, { fotos });
        } catch (e) {
          // Non-blocking: anamnesis is saved; photos optional
          console.warn("Photo upload failed:", e);
        }
      }
      localStorage.removeItem(STORAGE_KEY(token));
      navigate(`/chat/${token}`);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setSubmitting(false);
    }
  };

  const Icon = section.icon || User;

  return (
    <div className="min-h-screen relative bg-rc-ink overflow-hidden">
      <GlowOrb color="#0081FD" size={400} top="-10%" left="-5%" opacity={0.18} />
      <GlowOrb color="#0066CC" size={350} top="50%" left="80%" opacity={0.12} />

      <header className="relative z-10 max-w-3xl mx-auto px-4 sm:px-6 pt-6 pb-4 flex items-center justify-between">
        <Link to="/" aria-label="Voltar para a página inicial">
          <Brand size="sm" />
        </Link>
        <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold" data-testid="autosave-indicator">
          Progresso salvo
        </div>
      </header>

      <main className="relative z-10 max-w-3xl mx-auto px-4 sm:px-6 pb-20">
        <div className="mb-6">
          <div className="text-xs uppercase tracking-[0.2em] text-rc-blue font-bold mb-2">
            Pré-consulta {lead?.nome ? `· Olá, ${lead.nome.split(" ")[0]}` : ""}
          </div>
          <h1 className="rc-h2">Vamos te conhecer</h1>
          <p className="text-sm text-gray-400 mt-1">
            Etapa {step + 1} de {total}: <span className="text-white">{section.title}</span>
          </p>
          <div className="mt-4 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
            <div
              data-testid="progress-bar"
              className="h-full bg-rc-blue transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          {/* Step pills */}
          <div className="mt-4 flex gap-1 overflow-x-auto pb-2 -mx-1 px-1">
            {SECTIONS.map((s, i) => {
              const StepIcon = s.icon || User;
              const isActive = i === step;
              const isDone = i < step;
              return (
                <button
                  key={s.id}
                  data-testid={`step-pill-${s.id}`}
                  onClick={() => setStep(i)}
                  title={s.title}
                  className={`flex-none w-9 h-9 rounded-full flex items-center justify-center border transition-all ${
                    isActive
                      ? "bg-rc-blue border-rc-blue text-black shadow-[0_4px_18px_rgba(0,129,253,0.5)]"
                      : isDone
                        ? "bg-rc-blue/15 border-rc-blue/40 text-rc-blue"
                        : "bg-white/[0.03] border-white/[0.08] text-gray-500 hover:text-gray-300"
                  }`}
                >
                  <StepIcon className="w-3.5 h-3.5" />
                </button>
              );
            })}
          </div>
        </div>

        <div className="rc-card p-6 sm:p-8 animate-fade-up" key={step}>
          <div className="flex items-start gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-rc-blue/10 border border-rc-blue/30 flex items-center justify-center flex-none">
              <Icon className="w-5 h-5 text-rc-blue" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="rc-h3">{section.title}</h2>
              {section.helper && (
                <p className="text-sm text-gray-400 mt-1 leading-relaxed">{section.helper}</p>
              )}
            </div>
          </div>

          <div className="mt-6 space-y-6">
            {section.fields.map((f) => (
              <Field
                key={f.k}
                f={f}
                value={data[f.k]}
                onChange={(v) => update(f.k, v)}
                derived={f.k === "data_nascimento" ? { idade } : null}
              />
            ))}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button
            data-testid="step-prev"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="rc-btn-secondary"
          >
            <ArrowLeft className="w-4 h-4" /> Voltar
          </button>
          {step < total - 1 ? (
            <button
              data-testid="step-next"
              onClick={() =>
                canAdvance() ? setStep((s) => s + 1) : toast.error("Preencha os campos obrigatórios")
              }
              className="rc-btn-primary"
            >
              Avançar <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button data-testid="submit-anamnesis" onClick={submit} disabled={submitting} className="rc-btn-primary">
              {submitting ? "Enviando..." : "Concluir anamnese"} <CheckCircle2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </main>
    </div>
  );
}

// ========== Field renderers ==========
function Field({ f, value, onChange, derived }) {
  const tid = `field-${f.k}`;
  const required = !!f.req;
  const Label = ({ children }) => (
    <label className="rc-label flex items-center justify-between">
      <span>
        {f.l || children}
        {required && <span className="text-red-400 ml-1">*</span>}
      </span>
    </label>
  );

  if (f.type === "radio") {
    return (
      <div>
        <Label />
        {f.helper && <p className="text-xs text-gray-500 mb-2">{f.helper}</p>}
        <div className="space-y-2" data-testid={tid}>
          {f.opts.map((opt) => {
            const isSel = value === opt;
            return (
              <button
                type="button"
                key={opt}
                onClick={() => onChange(opt)}
                data-testid={`${tid}-opt-${opt.slice(0, 20)}`}
                className={`w-full text-left px-4 py-3 rounded-lg border transition-all flex items-center gap-3 ${
                  isSel
                    ? "border-rc-blue bg-rc-blue/10 text-white shadow-[0_4px_18px_-6px_rgba(0,129,253,0.4)]"
                    : "border-white/[0.08] bg-rc-surfaceAlt text-gray-300 hover:border-rc-blue/40"
                }`}
              >
                <span
                  className={`w-4 h-4 rounded-full border-2 flex-none flex items-center justify-center ${
                    isSel ? "border-rc-blue" : "border-gray-500"
                  }`}
                >
                  {isSel && <span className="w-1.5 h-1.5 rounded-full bg-rc-blue" />}
                </span>
                <span className="text-sm">{opt}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (f.type === "radio-card") {
    return (
      <div>
        {f.l && <Label />}
        <div className="grid sm:grid-cols-2 gap-2" data-testid={tid}>
          {f.opts.map((o) => {
            const isSel = value === o.v;
            return (
              <button
                type="button"
                key={o.v}
                onClick={() => onChange(o.v)}
                data-testid={`${tid}-opt-${o.v}`}
                className={`text-left px-4 py-3 rounded-xl border transition-all ${
                  isSel
                    ? "border-rc-blue bg-rc-blue/10 shadow-[0_4px_18px_-6px_rgba(0,129,253,0.4)]"
                    : "border-white/[0.08] bg-rc-surfaceAlt hover:border-rc-blue/40"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`w-4 h-4 rounded-full border-2 flex-none flex items-center justify-center ${
                      isSel ? "border-rc-blue" : "border-gray-500"
                    }`}
                  >
                    {isSel && <span className="w-1.5 h-1.5 rounded-full bg-rc-blue" />}
                  </span>
                  <span className={`font-bold uppercase tracking-wider text-sm ${isSel ? "text-rc-blue" : "text-white"}`}>
                    {o.l}
                  </span>
                </div>
                {o.desc && <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">{o.desc}</p>}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (f.type === "multi-check") {
    const arr = Array.isArray(value) ? value : [];
    const toggle = (opt) => {
      if (arr.includes(opt)) onChange(arr.filter((x) => x !== opt));
      else onChange([...arr, opt]);
    };
    return (
      <div>
        {f.l && <Label />}
        {f.helper && <p className="text-xs text-gray-500 mb-2">{f.helper}</p>}
        <div className="grid sm:grid-cols-2 gap-2" data-testid={tid}>
          {f.opts.map((opt) => {
            const isSel = arr.includes(opt);
            return (
              <button
                type="button"
                key={opt}
                onClick={() => toggle(opt)}
                data-testid={`${tid}-opt-${opt.slice(0, 20)}`}
                className={`text-left px-3.5 py-2.5 rounded-lg border transition-all flex items-center gap-2.5 ${
                  isSel
                    ? "border-rc-blue bg-rc-blue/10 text-white"
                    : "border-white/[0.08] bg-rc-surfaceAlt text-gray-300 hover:border-rc-blue/40"
                }`}
              >
                <span
                  className={`w-4 h-4 rounded border flex-none flex items-center justify-center ${
                    isSel ? "border-rc-blue bg-rc-blue" : "border-gray-500"
                  }`}
                >
                  {isSel && <CheckCircle2 className="w-3 h-3 text-black" />}
                </span>
                <span className="text-sm">{opt}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (f.type === "yes-no") {
    return (
      <div>
        <Label />
        <div className="flex gap-2" data-testid={tid}>
          {[
            { v: "sim", l: "Sim" },
            { v: "nao", l: "Não" },
          ].map((o) => {
            const isSel = value === o.v;
            return (
              <button
                type="button"
                key={o.v}
                onClick={() => onChange(o.v)}
                data-testid={`${tid}-${o.v}`}
                className={`flex-1 px-4 py-3 rounded-lg border font-bold uppercase tracking-wider text-sm transition-all ${
                  isSel
                    ? o.v === "sim"
                      ? "border-rc-blue bg-rc-blue text-black"
                      : "border-white/40 bg-white/10 text-white"
                    : "border-white/[0.08] bg-rc-surfaceAlt text-gray-400 hover:border-white/30"
                }`}
              >
                {o.l}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (f.type === "slider") {
    const v = typeof value === "number" ? value : 5;
    return (
      <div>
        <Label />
        <div className="rc-card p-4 mt-2">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs uppercase tracking-wider text-gray-400 font-bold">{f.min ?? 0}</span>
            <span className="font-display text-3xl font-black text-rc-blue">{v}</span>
            <span className="text-xs uppercase tracking-wider text-gray-400 font-bold">{f.max ?? 10}</span>
          </div>
          <input
            data-testid={tid}
            type="range"
            min={f.min ?? 0}
            max={f.max ?? 10}
            step={1}
            value={v}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-full accent-rc-blue cursor-pointer"
            style={{
              accentColor: "#0081FD",
              background: `linear-gradient(to right, #0081FD ${(v / (f.max ?? 10)) * 100}%, rgba(255,255,255,0.08) ${
                (v / (f.max ?? 10)) * 100
              }%)`,
            }}
          />
          <div className="flex justify-between mt-1 text-[10px] text-gray-500 font-bold uppercase tracking-wider">
            <span>Muito baixo</span>
            <span>Excelente</span>
          </div>
        </div>
      </div>
    );
  }

  if (f.type === "textarea") {
    return (
      <div>
        <Label />
        {f.helper && <p className="text-xs text-gray-500 mb-2">{f.helper}</p>}
        <textarea
          data-testid={tid}
          rows={f.rows ?? 4}
          className="rc-input resize-none whitespace-pre-wrap"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={f.placeholder}
        />
      </div>
    );
  }

  if (f.type === "date") {
    return (
      <div>
        <Label />
        <input
          data-testid={tid}
          type="date"
          lang="pt-BR"
          className="rc-input [color-scheme:dark]"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
        {derived?.idade !== "" && derived?.idade !== undefined && (
          <p className="text-xs text-rc-blue mt-1.5 font-bold uppercase tracking-wider">
            Idade calculada: {derived.idade} anos
          </p>
        )}
      </div>
    );
  }

  if (f.type === "photos") {
    return <PhotoField value={value} onChange={onChange} testId={tid} />;
  }

  // text / email / number
  return (
    <div>
      <Label />
      <input
        data-testid={tid}
        type={f.type}
        className="rc-input"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={f.placeholder}
      />
    </div>
  );
}

function PhotoField({ value, onChange, testId }) {
  const photos = Array.isArray(value) ? value : [];
  const [busy, setBusy] = useState(false);

  const handleFiles = async (filesList) => {
    const files = Array.from(filesList || []).slice(0, 4 - photos.length);
    if (files.length === 0) return;
    setBusy(true);
    try {
      const out = [];
      for (const f of files) {
        if (!f.type.startsWith("image/")) continue;
        const dataUrl = await fileToResizedBase64(f, 1280, 0.78);
        out.push({ name: f.name, data_url: dataUrl, size: dataUrl.length });
      }
      onChange([...photos, ...out].slice(0, 4));
    } catch (e) {
      toast.error("Erro ao processar imagem");
    } finally {
      setBusy(false);
    }
  };

  const remove = (i) => onChange(photos.filter((_, idx) => idx !== i));

  return (
    <div>
      <label className="rc-label">Suas fotos (até 4)</label>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid={testId}>
        {photos.map((p, i) => (
          <div key={i} className="relative group rounded-xl overflow-hidden border border-rc-blue/30 aspect-square bg-rc-surfaceAlt">
            <img src={p.data_url} alt={p.name} className="w-full h-full object-cover" />
            <button
              type="button"
              onClick={() => remove(i)}
              data-testid={`${testId}-remove-${i}`}
              className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-black/70 backdrop-blur text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label="Remover"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        {photos.length < 4 && (
          <label
            data-testid={`${testId}-upload`}
            className="relative cursor-pointer rounded-xl border-2 border-dashed border-white/[0.12] hover:border-rc-blue/50 aspect-square flex flex-col items-center justify-center text-gray-400 hover:text-rc-blue transition-colors bg-rc-surfaceAlt/50"
          >
            <input
              type="file"
              accept="image/*"
              multiple
              className="absolute inset-0 opacity-0 cursor-pointer"
              onChange={(e) => handleFiles(e.target.files)}
            />
            {busy ? (
              <span className="w-5 h-5 rounded-full border-2 border-rc-blue border-t-transparent animate-spin" />
            ) : (
              <>
                <Upload className="w-5 h-5" />
                <span className="text-[10px] mt-1.5 uppercase tracking-wider font-bold">Adicionar</span>
              </>
            )}
          </label>
        )}
      </div>
      <p className="text-xs text-gray-500 mt-2">Sugestão: frente, lateral, costas. Imagens são redimensionadas e enviadas com segurança.</p>
    </div>
  );
}
