import React, { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api, formatApiError } from "@/lib/evo-api";
import GlowOrb from "@/components/evonut/GlowOrb";
import Brand from "@/components/evonut/Brand";
import { ArrowLeft, ArrowRight, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

const SECTIONS = [
  {
    title: "Dados pessoais",
    fields: [
      { k: "nome", l: "Nome completo", type: "text", req: true },
      { k: "data_nascimento", l: "Data de nascimento", type: "date", req: true },
      { k: "sexo", l: "Sexo", type: "select", opts: ["M", "F"], req: true },
      { k: "email", l: "E-mail", type: "email" },
    ],
  },
  {
    title: "Condicionamento físico",
    fields: [
      { k: "peso", l: "Peso atual (kg)", type: "number", req: true },
      { k: "altura", l: "Altura (cm)", type: "number", req: true },
      { k: "historico_peso", l: "Histórico de peso (relato livre)", type: "textarea" },
    ],
  },
  {
    title: "Objetivo principal",
    fields: [
      { k: "objetivo", l: "Objetivo", type: "select", opts: ["emagrecimento", "manutencao", "hipertrofia", "performance", "saude_geral"], req: true },
      { k: "prazo_objetivo", l: "Prazo desejado", type: "text", placeholder: "ex: 3 meses" },
    ],
  },
  {
    title: "Rotina de treino",
    fields: [
      { k: "treino_tipo", l: "Tipo de treino", type: "text", placeholder: "musculação, corrida..." },
      { k: "treino_freq", l: "Frequência semanal", type: "number" },
      { k: "treino_duracao", l: "Duração média (min)", type: "number" },
      { k: "treino_intensidade", l: "Intensidade", type: "select", opts: ["leve", "moderada", "alta"] },
    ],
  },
  {
    title: "Sono",
    fields: [
      { k: "sono_horas", l: "Horas por noite", type: "number" },
      { k: "sono_qualidade", l: "Qualidade do sono", type: "select", opts: ["ruim", "regular", "boa", "ótima"] },
      { k: "sono_horarios", l: "Horários (deita / acorda)", type: "text" },
    ],
  },
  {
    title: "Hábitos",
    fields: [
      { k: "tabagismo", l: "Tabagismo", type: "select", opts: ["não", "ocasional", "diário"] },
      { k: "alcool", l: "Álcool", type: "select", opts: ["não", "social", "frequente"] },
      { k: "medicamentos", l: "Medicamentos em uso", type: "textarea" },
      { k: "suplementos", l: "Suplementos em uso", type: "textarea" },
    ],
  },
  {
    title: "Hidratação",
    fields: [
      { k: "agua_litros", l: "Água por dia (litros)", type: "number" },
      { k: "agua_distribuicao", l: "Como distribui ao longo do dia", type: "textarea" },
    ],
  },
  {
    title: "Alimentação",
    fields: [
      { k: "restricoes", l: "Restrições / alergias / intolerâncias", type: "textarea" },
      { k: "preferencias", l: "Preferências alimentares", type: "textarea" },
    ],
  },
  {
    title: "Saúde",
    fields: [
      { k: "diagnosticos", l: "Diagnósticos atuais", type: "textarea" },
      { k: "historico_familiar", l: "Histórico familiar relevante", type: "textarea" },
    ],
  },
  {
    title: "Rotina de trabalho",
    fields: [
      { k: "trabalho_tipo", l: "Tipo de trabalho", type: "select", opts: ["sedentário", "ativo"] },
      { k: "trabalho_horarios", l: "Horários", type: "text" },
      { k: "estresse", l: "Nível de estresse (1-10)", type: "number" },
    ],
  },
  {
    title: "Energia e desempenho",
    fields: [
      { k: "fadiga", l: "Tem fadiga frequente?", type: "select", opts: ["não", "às vezes", "sim"] },
      { k: "foco", l: "Como está seu foco?", type: "select", opts: ["bom", "regular", "ruim"] },
    ],
  },
  {
    title: "Funcionamento intestinal",
    fields: [
      { k: "intestino_freq", l: "Frequência (vezes/dia)", type: "text" },
      { k: "intestino_consist", l: "Consistência", type: "select", opts: ["normal", "ressecado", "líquido", "alternado"] },
      { k: "sintomas_gi", l: "Sintomas GI (gases, dor, etc)", type: "textarea" },
    ],
  },
  {
    title: "Saúde geral",
    fields: [
      { k: "autoavaliacao", l: "Autoavaliação 1–10", type: "number" },
      { k: "autoavaliacao_just", l: "Justificativa", type: "textarea" },
    ],
  },
  {
    title: "Rotina alimentar descritiva",
    fields: [{ k: "rotina_alimentar", l: "Como é um dia típico de alimentação?", type: "textarea", req: true }],
  },
  {
    title: "Informações adicionais",
    fields: [{ k: "info_adicional", l: "Algo mais que queira compartilhar", type: "textarea" }],
  },
];

const STORAGE_KEY = (token) => `evonut_anamnesis_${token}`;

export default function PreConsulta() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [data, setData] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [lead, setLead] = useState(null);

  useEffect(() => {
    if (!token) return;
    api.get(`/public/lead/${token}`).then((r) => setLead(r.data)).catch(() => {
      toast.error("Link inválido ou expirado");
      navigate("/");
    });
    const cached = localStorage.getItem(STORAGE_KEY(token));
    if (cached) {
      try { setData(JSON.parse(cached)); } catch (_) {}
    }
  }, [token, navigate]);

  const persist = (d) => {
    if (token) localStorage.setItem(STORAGE_KEY(token), JSON.stringify(d));
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-300">
        <div className="text-center">
          <p className="mb-4">Você precisa de um link de pré-consulta válido.</p>
          <Link to="/" className="evo-btn-primary">Voltar à página inicial</Link>
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

  const canAdvance = () => section.fields.every((f) => !f.req || (data[f.k] !== undefined && data[f.k] !== ""));

  const submit = async () => {
    setSubmitting(true);
    try {
      await api.post("/public/anamnesis", { token, respostas: data });
      localStorage.removeItem(STORAGE_KEY(token));
      toast.success("Anamnese registrada! Vamos para o chat IA.");
      navigate(`/chat/${token}`);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen relative bg-rc-ink overflow-hidden">
      <GlowOrb color="#0081FD" size={400} top="-10%" left="-5%" opacity={0.18} />
      <GlowOrb color="#0066CC" size={350} top="50%" left="80%" opacity={0.12} />

      <header className="relative z-10 max-w-3xl mx-auto px-4 sm:px-6 pt-6 pb-4 flex items-center justify-between">
        <Link to="/" aria-label="Voltar para a página inicial">
          <Brand size="sm" />
        </Link>
        <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold" data-testid="autosave-indicator">Progresso salvo</div>
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
        </div>

        <div className="evo-card p-6 sm:p-8 animate-fade-up" key={step}>
          <h2 className="evo-h3">{section.title}</h2>
          <div className="mt-6 space-y-5">
            {section.fields.map((f) => (
              <Field key={f.k} f={f} value={data[f.k] ?? ""} onChange={(v) => update(f.k, v)} />
            ))}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button
            data-testid="step-prev"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="evo-btn-secondary"
          >
            <ArrowLeft className="w-4 h-4" /> Voltar
          </button>
          {step < total - 1 ? (
            <button
              data-testid="step-next"
              onClick={() => canAdvance() ? setStep((s) => s + 1) : toast.error("Preencha os campos obrigatórios")}
              className="evo-btn-primary"
            >
              Avançar <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button data-testid="submit-anamnesis" onClick={submit} disabled={submitting} className="evo-btn-primary">
              {submitting ? "Enviando..." : "Concluir anamnese"} <CheckCircle2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </main>
    </div>
  );
}

function Field({ f, value, onChange }) {
  const tid = `field-${f.k}`;
  if (f.type === "select") {
    return (
      <div>
        <label className="evo-label">{f.l}{f.req && <span className="text-evo-coral">*</span>}</label>
        <select data-testid={tid} className="evo-input" value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Selecione</option>
          {f.opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    );
  }
  if (f.type === "textarea") {
    return (
      <div>
        <label className="evo-label">{f.l}{f.req && <span className="text-evo-coral">*</span>}</label>
        <textarea data-testid={tid} rows={3} className="evo-input resize-none" value={value} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} />
      </div>
    );
  }
  if (f.type === "date") {
    return (
      <div>
        <label className="evo-label">{f.l}{f.req && <span className="text-evo-coral">*</span>}</label>
        <input
          data-testid={tid}
          type="date"
          lang="pt-BR"
          className="evo-input [color-scheme:dark]"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <p className="text-[11px] text-gray-500 mt-1">Formato: dia/mês/ano</p>
      </div>
    );
  }
  return (
    <div>
      <label className="evo-label">{f.l}{f.req && <span className="text-evo-coral">*</span>}</label>
      <input data-testid={tid} type={f.type} className="evo-input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} />
    </div>
  );
}
