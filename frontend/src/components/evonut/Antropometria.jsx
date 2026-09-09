import React, { useMemo, useState } from "react";
import {
  Baby, CalendarDays, HeartPulse, Pencil, Ruler, Save, ScanLine,
  Trash2, UserRound, X,
} from "lucide-react";
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/evo-api";

const MAX_RESULT_COLUMNS = 4;
const EMPTY_EVALUATIONS = [];

const SECTIONS = [
  ["dados", "Dados iniciais", CalendarDays],
  ["medidas", "Perimetria e adipometria", Ruler],
  ["bio", "Bioimpedância", ScanLine],
  ["adultos", "Adultos e idosos", UserRound],
  ["criancas", "Crianças e adolescentes", Baby],
  ["gestacional", "Avaliação gestacional", HeartPulse],
];

const PERIMETRIA = [
  ["braco_relaxado_d", "Braço relaxado direito"],
  ["braco_relaxado_e", "Braço relaxado esquerdo"],
  ["braco_contraido_d", "Braço contraído direito"],
  ["braco_contraido_e", "Braço contraído esquerdo"],
  ["antebraco_d", "Antebraço direito"],
  ["antebraco_e", "Antebraço esquerdo"],
  ["punho_d", "Punho direito"],
  ["punho_e", "Punho esquerdo"],
  ["pescoco", "Pescoço"],
  ["ombro", "Ombro"],
  ["torax", "Tórax"],
  ["cintura", "Cintura"],
  ["abdomen", "Abdômen"],
  ["quadril", "Quadril"],
  ["panturrilha_d", "Panturrilha direita"],
  ["panturrilha_e", "Panturrilha esquerda"],
  ["coxa_d", "Coxa direita"],
  ["coxa_e", "Coxa esquerda"],
  ["coxa_proximal_d", "Coxa proximal direita"],
  ["coxa_proximal_e", "Coxa proximal esquerda"],
];

const DOBRAS = [
  ["bicipital", "Bicipital"],
  ["abdominal", "Abdominal"],
  ["tricipital", "Tricipital"],
  ["suprailiaca", "Suprailíaca"],
  ["axilar", "Axilar média"],
  ["subescapular", "Subescapular"],
  ["peitoral", "Peitoral"],
  ["coxa", "Coxa"],
  ["panturrilha", "Panturrilha"],
];

const BIOIMPEDANCIA = [
  ["imc", "IMC", "kg/m²"],
  ["peso_ideal_kg", "Peso Ideal", "kg"],
  ["pct_gordura", "% Massa Gorda", "%"],
  ["pct_massa_magra", "% Massa Magra", "%"],
  ["massa_gorda_kg", "Massa Gorda", "kg"],
  ["massa_magra_kg", "Massa Magra", "kg"],
  ["agua_corporal_pct", "% Água Corporal", "%"],
  ["agua_corporal_l", "Água Corporal", "L"],
  ["peso_osseo_kg", "Peso Ósseo", "kg"],
  ["peso_residual_kg", "Peso Residual", "kg"],
  ["peso_muscular_kg", "Peso Muscular", "kg"],
  ["gordura_visceral", "Nível de Gordura Visceral", ""],
  ["idade_metabolica", "Idade Metabólica", "anos"],
];

const PROTOCOLOS = [
  ["pollock7", "Jackson & Pollock - 7 dobras"],
  ["pollock3", "Jackson & Pollock - 3 dobras"],
  ["faulkner", "Faulkner - 4 dobras"],
];

const numberFmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

const today = () => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const patientAge = (patient) => {
  const birth = patient?.data_nascimento ? new Date(`${patient.data_nascimento}T12:00:00`) : null;
  if (!birth || Number.isNaN(birth.getTime())) return 30;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  if (now < new Date(now.getFullYear(), birth.getMonth(), birth.getDate())) age -= 1;
  return Math.max(age, 0);
};

const emptyForm = (patient) => ({
  data_avaliacao: today(),
  retorno: false,
  peso: patient?.peso ?? "",
  altura: patient?.altura ?? "",
  idade: patientAge(patient),
  sexo: patient?.sexo || "F",
  nivel_atividade: 1.55,
  objetivo: patient?.objetivo || "manutencao",
  protocolo_dobras: "pollock7",
  protocolo_tmb: "mifflin_st_jeor",
  gestante: false,
  ig_semanas: "",
  dobras: {},
  perimetria: {},
  diametros_osseos: {},
  bioimpedancia: {},
  gestacional: { peso_pre_gestacional: "", dum: "", idade_gestacional: "", dpp: "" },
});

const numericObject = (source = {}) => Object.fromEntries(
  Object.entries(source)
    .map(([key, value]) => [key, value === "" || value == null ? null : Number(value)])
    .filter(([, value]) => Number.isFinite(value)),
);

const toNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(",", ".").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const valueOrBlank = (value, unit) => {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "number") return `${numberFmt.format(value)}${unit ? ` ${unit}` : ""}`;
  return String(value);
};

const formatDate = (value) => {
  if (!value) return "-";
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("pt-BR");
};

const evaluationDate = (evaluation) => evaluation?.data_avaliacao || evaluation?.created_at?.slice(0, 10);

const composition = (evaluation) => evaluation?.composicao || {};

const getBio = (evaluation, key) => {
  const direct = evaluation?.bioimpedancia?.[key];
  if (direct !== null && direct !== undefined && direct !== "") return direct;
  return composition(evaluation).bioimpedancia?.[key];
};

const idealWeight = (comp) => {
  if (comp?.peso_ideal_min == null || comp?.peso_ideal_max == null) return null;
  return `${numberFmt.format(comp.peso_ideal_min)} - ${numberFmt.format(comp.peso_ideal_max)}`;
};

const sumDobras = (evaluation) => {
  const values = Object.values(evaluation?.dobras || {}).map(toNumber).filter((value) => value != null);
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0);
};

const gestationalPreImc = (evaluation) => {
  const pesoPre = toNumber(evaluation?.gestacional?.peso_pre_gestacional);
  const altura = toNumber(evaluation?.altura);
  if (!pesoPre || !altura) return null;
  const heightM = altura / 100;
  return Math.round((pesoPre / (heightM ** 2)) * 100) / 100;
};

const gestationalGain = (evaluation) => {
  const pesoPre = toNumber(evaluation?.gestacional?.peso_pre_gestacional);
  const peso = toNumber(evaluation?.peso);
  if (pesoPre == null || peso == null) return null;
  return Math.round((peso - pesoPre) * 100) / 100;
};

const withFixedColumns = (evaluations) => {
  const rows = [...evaluations];
  while (rows.length < MAX_RESULT_COLUMNS) rows.push(null);
  return rows;
};

function Field({ label, value, onChange, type = "number", unit, testId, min, max }) {
  return (
    <label className="block">
      <span className="evo-label">{label}</span>
      <div className="relative">
        <input
          data-testid={testId}
          type={type}
          step={type === "number" ? "any" : undefined}
          min={min}
          max={max}
          className={`evo-input h-11 ${unit ? "pr-14" : ""}`}
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value)}
        />
        {unit && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-gray-500">{unit}</span>}
      </div>
    </label>
  );
}

function SelectField({ label, value, onChange, options, testId }) {
  return (
    <label className="block">
      <span className="evo-label">{label}</span>
      <select data-testid={testId} className="evo-input h-11" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
      </select>
    </label>
  );
}

function SectionCard({ title, description, children, className = "" }) {
  return (
    <section className={`evo-card p-5 ${className}`}>
      <div className="mb-5">
        <h3 className="evo-h3">{title}</h3>
        {description && <p className="mt-1 text-xs leading-relaxed text-gray-500">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function SheetTable({ title, description, evaluations, rows }) {
  const active = withFixedColumns(evaluations);
  const lastFilled = [...evaluations].reverse()[0] || null;

  const evolution = (row) => {
    const values = evaluations
      .map((evaluation) => row.numeric?.(evaluation, composition(evaluation)) ?? toNumber(row.get(evaluation, composition(evaluation))))
      .filter((value) => value !== null && value !== undefined);
    if (values.length < 2) return "-";
    const diff = Math.round((values[values.length - 1] - values[0]) * 100) / 100;
    if (diff === 0) return "0";
    return `${diff > 0 ? "▲" : "▼"} ${numberFmt.format(Math.abs(diff))}${row.unit ? ` ${row.unit}` : ""}`;
  };

  return (
    <SectionCard title={title} description={description}>
      <div className="overflow-x-auto rounded-lg border border-white/[0.08]">
        <table className="min-w-[980px] w-full border-collapse text-xs">
          <thead>
            <tr className="bg-white/[0.05] text-[11px] uppercase text-gray-400">
              <th className="w-[220px] px-3 py-3 text-left font-bold">Indicador</th>
              {active.map((evaluation, index) => (
                <th key={evaluation?.id || index} className="w-[130px] border-l border-white/[0.08] px-3 py-3 text-center font-bold">
                  <div className="text-rc-blue">{index + 1}ª Avaliação</div>
                  <div className="mt-0.5 normal-case text-gray-500">{formatDate(evaluationDate(evaluation))}</div>
                </th>
              ))}
              <th className="w-[150px] border-l border-white/[0.08] px-3 py-3 text-center font-bold">Evolução</th>
              <th className="w-[190px] border-l border-white/[0.08] px-3 py-3 text-center font-bold">Recomendação</th>
              <th className="w-[150px] border-l border-white/[0.08] px-3 py-3 text-center font-bold">Situação</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={row.label} className={rowIndex % 2 ? "bg-white/[0.025]" : "bg-white/[0.055]"}>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-200">{row.label}</th>
                {active.map((evaluation, index) => {
                  const comp = composition(evaluation);
                  return (
                    <td key={evaluation?.id || index} className="border-l border-white/[0.08] px-3 py-2.5 text-center text-gray-200">
                      {evaluation ? valueOrBlank(row.get(evaluation, comp), row.unit) : "-"}
                    </td>
                  );
                })}
                <td className="border-l border-white/[0.08] px-3 py-2.5 text-center text-rc-blue">{evolution(row)}</td>
                <td className="border-l border-white/[0.08] px-3 py-2.5 text-center text-gray-300">
                  {lastFilled ? valueOrBlank(row.recommendation?.(lastFilled, composition(lastFilled))) : "-"}
                </td>
                <td className="border-l border-white/[0.08] px-3 py-2.5 text-center font-semibold text-gray-200">
                  {lastFilled ? valueOrBlank(row.status?.(lastFilled, composition(lastFilled))) : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

const BIO_ROWS = [
  { label: "IMC", unit: "kg/m²", get: (e, c) => getBio(e, "imc") ?? c.imc, status: (e, c) => c.imc_classificacao },
  { label: "Peso Ideal (kg)", unit: "kg", get: (e, c) => getBio(e, "peso_ideal_kg") ?? idealWeight(c), recommendation: (e, c) => idealWeight(c) },
  { label: "% Massa Gorda", unit: "%", get: (e, c) => getBio(e, "pct_gordura") ?? c.pct_gordura, status: (e, c) => c.pct_gordura_classificacao },
  { label: "% Massa Magra", unit: "%", get: (e, c) => getBio(e, "pct_massa_magra") ?? c.pct_massa_magra },
  { label: "Massa Gorda (kg)", unit: "kg", get: (e, c) => getBio(e, "massa_gorda_kg") ?? c.massa_gorda },
  { label: "Massa Magra (kg)", unit: "kg", get: (e, c) => getBio(e, "massa_magra_kg") ?? c.massa_magra },
  { label: "% Água Corporal", unit: "%", get: (e) => getBio(e, "agua_corporal_pct") },
  { label: "Água Corporal (L)", unit: "L", get: (e) => getBio(e, "agua_corporal_l") },
  { label: "Peso Ósseo (kg)", unit: "kg", get: (e) => getBio(e, "peso_osseo_kg") },
  { label: "Peso Residual (kg)", unit: "kg", get: (e, c) => getBio(e, "peso_residual_kg") ?? c.peso_residual },
  { label: "Peso Muscular (kg)", unit: "kg", get: (e) => getBio(e, "peso_muscular_kg") },
  { label: "Nível de Gordura Visceral", get: (e) => getBio(e, "gordura_visceral"), recommendation: () => "<= 9" },
  { label: "Idade Metabólica (anos)", unit: "anos", get: (e) => getBio(e, "idade_metabolica") },
];

const ADULT_ROWS = [
  { label: "Peso Corporal", unit: "kg", get: (e) => e?.peso },
  { label: "IMC", get: (e, c) => c.imc, recommendation: (e, c) => c.imc_referencia, status: (e, c) => c.imc_classificacao },
  { label: "% Massa gorda", unit: "%", get: (e, c) => c.pct_gordura, status: (e, c) => c.pct_gordura_classificacao },
  { label: "% Massa magra", unit: "%", get: (e, c) => c.pct_massa_magra },
  { label: "Massa gorda", unit: "kg", get: (e, c) => c.massa_gorda },
  { label: "Massa magra", unit: "kg", get: (e, c) => c.massa_magra },
  { label: "* Peso ósseo", unit: "kg", get: (e) => getBio(e, "peso_osseo_kg") },
  { label: "* Peso residual", unit: "kg", get: (e, c) => c.peso_residual },
  { label: "* Peso muscular", unit: "kg", get: (e) => getBio(e, "peso_muscular_kg") },
  { label: "Densidade corporal", get: (e, c) => c.densidade_corporal },
  { label: "Razão cintura / quadril", get: (e, c) => c.rcq, status: (e, c) => c.rcq == null ? null : c.rcq_risco ? "Risco" : "Normal" },
  { label: "Índice de conicidade", get: (e, c) => c.ic, recommendation: () => "M < 1,25 / F < 1,18", status: (e, c) => c.ic_classificacao },
  { label: "Medida do pescoço", unit: "cm", get: (e) => e?.perimetria?.pescoco, recommendation: () => "M <= 39,5 cm / F <= 36,5 cm" },
  { label: "Área muscular do braço", unit: "cm²", get: (e, c) => c.amb },
  { label: "Área de gordura do braço", unit: "cm²", get: (e, c) => c.agb },
];

const CHILD_ROWS = [
  { label: "Estatura para idade", unit: "cm", get: (e) => e?.altura },
  { label: "Peso para idade", unit: "kg", get: (e) => e?.peso },
  { label: "IMC para idade", get: (e, c) => c.imc, recommendation: (e, c) => c.imc_referencia, status: (e, c) => c.imc_classificacao },
  { label: "% Massa gorda", unit: "%", get: (e, c) => c.pct_gordura, status: (e, c) => c.pct_gordura_classificacao },
  { label: "% Massa magra", unit: "%", get: (e, c) => c.pct_massa_magra },
  { label: "Massa Gorda", unit: "kg", get: (e, c) => c.massa_gorda },
  { label: "Massa magra", unit: "kg", get: (e, c) => c.massa_magra },
  { label: "Soma das dobras", unit: "mm", get: (e) => sumDobras(e) },
];

const GESTATIONAL_ROWS = [
  { label: "Peso Pré-gestacional", unit: "kg", get: (e) => e?.gestacional?.peso_pre_gestacional },
  { label: "IMC Pré-gestacional", get: (e) => gestationalPreImc(e) },
  { label: "Peso da avaliação", unit: "kg", get: (e) => e?.peso },
  { label: "IMC da avaliação", get: (e, c) => c.imc },
  { label: "Ganho de peso", unit: "kg", get: (e) => gestationalGain(e), status: (e, c) => c.imc_gestacional_classificacao },
];

export default function Antropometria({ d, reload }) {
  const [section, setSection] = useState("dados");
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => emptyForm(d.patient));
  const evaluations = d.evaluations || EMPTY_EVALUATIONS;

  const orderedEvaluations = useMemo(() => [...evaluations]
    .sort((a, b) => String(evaluationDate(a) || a.created_at || "").localeCompare(String(evaluationDate(b) || b.created_at || ""))),
  [evaluations]);
  const resultEvaluations = orderedEvaluations.slice(-MAX_RESULT_COLUMNS);

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const setNested = (group, key, value) => setForm((current) => ({
    ...current,
    [group]: { ...(current[group] || {}), [key]: value },
  }));

  const chartData = useMemo(() => orderedEvaluations.map((evaluation, index) => ({
    name: `Av. ${index + 1}`,
    peso: evaluation.peso,
    gordura: evaluation.composicao?.pct_gordura,
    muscular: evaluation.composicao?.massa_magra,
  })), [orderedEvaluations]);

  const reset = () => {
    setEditingId(null);
    setForm(emptyForm(d.patient));
    setSection("dados");
  };

  const editEvaluation = (evaluation) => {
    setEditingId(evaluation.id);
    setForm({
      ...emptyForm(d.patient),
      ...evaluation,
      data_avaliacao: evaluation.data_avaliacao || evaluation.created_at?.slice(0, 10) || today(),
      retorno: Boolean(evaluation.retorno),
      dobras: evaluation.dobras || {},
      perimetria: evaluation.perimetria || {},
      diametros_osseos: evaluation.diametros_osseos || {},
      bioimpedancia: evaluation.bioimpedancia || {},
      gestacional: { ...emptyForm(d.patient).gestacional, ...(evaluation.gestacional || {}) },
    });
    setSection("dados");
  };

  const removeEvaluation = async (evaluation) => {
    if (!window.confirm("Excluir esta avaliação antropométrica?")) return;
    try {
      await api.delete(`/patients/${d.patient.id}/evaluations/${evaluation.id}`);
      toast.success("Avaliação excluída.");
      if (editingId === evaluation.id) reset();
      reload();
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail));
    }
  };

  const save = async () => {
    if (!form.peso || !form.altura || !form.idade) {
      setSection("dados");
      toast.error("Preencha peso, altura e idade.");
      return;
    }
    setSaving(true);
    try {
      const igSemanas = form.gestacional.idade_gestacional || form.ig_semanas;
      const gestante = form.gestante || Boolean(igSemanas || form.gestacional.peso_pre_gestacional);
      const payload = {
        ...form,
        peso: Number(form.peso),
        altura: Number(form.altura),
        idade: Number(form.idade),
        sexo_num: form.sexo === "M" ? 1 : 2,
        gestante,
        ig_semanas: gestante && igSemanas ? Number(igSemanas) : null,
        nivel_atividade: Number(form.nivel_atividade),
        dobras: numericObject(form.dobras),
        perimetria: numericObject(form.perimetria),
        diametros_osseos: numericObject(form.diametros_osseos),
        bioimpedancia: numericObject(form.bioimpedancia),
        gestacional: {
          ...form.gestacional,
          peso_pre_gestacional: form.gestacional.peso_pre_gestacional
            ? Number(form.gestacional.peso_pre_gestacional) : null,
          idade_gestacional: igSemanas ? Number(igSemanas) : null,
        },
      };
      const response = editingId
        ? await api.put(`/patients/${d.patient.id}/evaluations/${editingId}`, payload)
        : await api.post(`/patients/${d.patient.id}/evaluations-v2`, payload);
      toast.success(`${editingId ? "Avaliação atualizada" : "Avaliação salva"}. IMC: ${response.data.composicao.imc}`);
      reset();
      reload();
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="anthropometry-workspace">
      <div className="evo-card p-2 overflow-x-auto">
        <div className="flex min-w-max gap-1.5">
          {SECTIONS.map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSection(key)}
              className={`flex h-10 items-center gap-2 rounded-lg px-3.5 text-xs font-semibold transition-colors ${
                section === key ? "bg-evo-purple text-white" : "text-gray-400 hover:bg-white/[0.05] hover:text-white"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />{label}
            </button>
          ))}
        </div>
      </div>

      {section === "dados" && (
        <SectionCard title={editingId ? "Editar avaliação" : "Dados iniciais"} description="Campos da linha inicial da planilha: data, retorno, altura, peso, IMC e composição quando informada.">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Field label="Data" value={form.data_avaliacao} onChange={(v) => set("data_avaliacao", v)} type="date" testId="anth-data" />
            <SelectField label="Retorno" value={form.retorno ? "sim" : "nao"} onChange={(v) => set("retorno", v === "sim")} options={[["nao", "Não"], ["sim", "Sim"]]} />
            <Field label="Altura" value={form.altura} onChange={(v) => set("altura", v)} unit="cm" testId="anth-altura" />
            <Field label="Peso" value={form.peso} onChange={(v) => set("peso", v)} unit="kg" testId="anth-peso" />
            <Field label="Idade" value={form.idade} onChange={(v) => set("idade", v)} unit="anos" testId="anth-idade" />
            <SelectField label="Sexo" value={form.sexo} onChange={(v) => set("sexo", v)} options={[["F", "Feminino"], ["M", "Masculino"]]} testId="anth-sexo" />
          </div>
        </SectionCard>
      )}

      {section === "medidas" && (
        <div className="grid gap-4 xl:grid-cols-2">
          <SectionCard title="Perímetros (cm)" description="Mesmos perímetros da planilha, separados por lateralidade quando aplicável.">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              {PERIMETRIA.map(([key, label]) => (
                <Field key={key} label={label} value={form.perimetria[key]} onChange={(v) => setNested("perimetria", key, v)} unit="cm" testId={`perim-${key}`} />
              ))}
            </div>
          </SectionCard>
          <div className="space-y-4">
            <SectionCard title="Dobras (mm)" description="Dobras cutâneas do bloco de adipometria. O protocolo define quais entram no cálculo.">
              <SelectField label="Protocolo de dobras" value={form.protocolo_dobras} onChange={(v) => set("protocolo_dobras", v)} options={PROTOCOLOS} testId="anth-protocolo" />
              <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
                {DOBRAS.map(([key, label]) => (
                  <Field key={key} label={label} value={form.dobras[key]} onChange={(v) => setNested("dobras", key, v)} unit="mm" testId={`dobra-${key}`} />
                ))}
              </div>
            </SectionCard>
            <SectionCard title="Diâmetros ósseos" description="Campos auxiliares do bloco de perimetria e adipometria.">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Punho" value={form.diametros_osseos.punho} onChange={(v) => setNested("diametros_osseos", "punho", v)} unit="cm" />
                <Field label="Fêmur" value={form.diametros_osseos.femur} onChange={(v) => setNested("diametros_osseos", "femur", v)} unit="cm" />
              </div>
            </SectionCard>
          </div>
        </div>
      )}

      {section === "bio" && (
        <div className="space-y-4">
          <SectionCard title="Bioimpedância" description="Campos iguais ao bloco de bioimpedância da planilha. Campos não medidos podem ficar vazios.">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {BIOIMPEDANCIA.map(([key, label, unit]) => (
                <Field key={key} label={label} value={form.bioimpedancia[key]} onChange={(v) => setNested("bioimpedancia", key, v)} unit={unit} testId={`bio-${key}`} />
              ))}
            </div>
          </SectionCard>
          <SheetTable
            title="Resultado - bioimpedância"
            description="Histórico separado em até quatro avaliações, com evolução e situação."
            evaluations={resultEvaluations}
            rows={BIO_ROWS}
          />
        </div>
      )}

      {section === "adultos" && (
        <div className="grid gap-4 xl:grid-cols-5">
          <div className="xl:col-span-3">
            <SheetTable
              title="Resultado - adultos e idosos"
              description="Campos iguais ao resultado adulto da planilha."
              evaluations={resultEvaluations}
              rows={ADULT_ROWS}
            />
          </div>
          <div className="evo-card p-5 xl:col-span-2">
            <h3 className="evo-h3 mb-4">Evolução</h3>
            {chartData.length ? (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="name" stroke="#9CA3AF" fontSize={11} />
                  <YAxis stroke="#9CA3AF" fontSize={11} />
                  <Tooltip contentStyle={{ background: "#161B22", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="peso" stroke="#0081FD" strokeWidth={2} />
                  <Line type="monotone" dataKey="gordura" stroke="#FFB347" strokeWidth={2} />
                  <Line type="monotone" dataKey="muscular" stroke="#3DA0FF" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            ) : <p className="text-sm text-gray-500">Adicione avaliações para visualizar a evolução.</p>}
          </div>
        </div>
      )}

      {section === "criancas" && (
        <SheetTable
          title="Resultado - crianças e adolescentes"
          description="Campos iguais ao resultado infantil da planilha."
          evaluations={resultEvaluations}
          rows={CHILD_ROWS}
        />
      )}

      {section === "gestacional" && (
        <div className="space-y-4">
          <SectionCard title="Avaliação gestacional" description="Campos iguais ao bloco gestacional da planilha.">
            <label className="mb-4 flex items-center gap-2 text-sm text-gray-300">
              <input type="checkbox" checked={form.gestante} onChange={(event) => set("gestante", event.target.checked)} className="h-4 w-4" />
              Paciente gestante
            </label>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Field label="Peso Pré-Gestacional" value={form.gestacional.peso_pre_gestacional} onChange={(v) => setNested("gestacional", "peso_pre_gestacional", v)} unit="kg" />
              <Field label="Última Menstruação" value={form.gestacional.dum} onChange={(v) => setNested("gestacional", "dum", v)} type="date" />
              <Field label="Idade Gestacional" value={form.gestacional.idade_gestacional || form.ig_semanas} onChange={(v) => { setNested("gestacional", "idade_gestacional", v); set("ig_semanas", v); }} unit="semanas" min="1" max="45" />
              <Field label="Previsão de parto" value={form.gestacional.dpp} onChange={(v) => setNested("gestacional", "dpp", v)} type="date" />
            </div>
          </SectionCard>
          <SheetTable
            title="Resultado gestacional"
            description="Peso pré-gestacional, IMC pré-gestacional e evolução do ganho de peso."
            evaluations={resultEvaluations}
            rows={GESTATIONAL_ROWS}
          />
        </div>
      )}

      {!["adultos", "criancas"].includes(section) && (
        <div className="evo-card flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="text-xs text-gray-500">Os campos vazios não serão gravados como zero.</div>
          <div className="flex gap-2">
            {editingId && <button type="button" onClick={reset} className="evo-btn-ghost"><X className="h-4 w-4" />Cancelar</button>}
            <button type="button" data-testid="save-evaluation" onClick={save} disabled={saving} className="evo-btn-primary">
              <Save className="h-4 w-4" />{saving ? "Salvando..." : editingId ? "Atualizar avaliação" : "Salvar avaliação"}
            </button>
          </div>
        </div>
      )}

      <SectionCard title="Histórico de avaliações" description={`${evaluations.length} avaliação(ões) cadastrada(s).`}>
        {orderedEvaluations.length ? (
          <div className="overflow-x-auto rounded-lg border border-white/[0.08]">
            <table className="min-w-[760px] w-full text-xs">
              <thead className="bg-white/[0.05] text-[11px] uppercase text-gray-400">
                <tr>
                  <th className="px-3 py-3 text-left">Avaliação</th>
                  <th className="px-3 py-3 text-left">Data</th>
                  <th className="px-3 py-3 text-left">Retorno</th>
                  <th className="px-3 py-3 text-left">Altura</th>
                  <th className="px-3 py-3 text-left">Peso</th>
                  <th className="px-3 py-3 text-left">IMC</th>
                  <th className="px-3 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {orderedEvaluations.map((evaluation, index) => (
                  <tr key={evaluation.id} className={index % 2 ? "bg-white/[0.025]" : "bg-white/[0.055]"}>
                    <td className="px-3 py-2.5 font-semibold text-white">{index + 1}ª Avaliação</td>
                    <td className="px-3 py-2.5 text-gray-300">{formatDate(evaluationDate(evaluation))}</td>
                    <td className="px-3 py-2.5 text-gray-300">{evaluation.retorno ? "Sim" : "Não"}</td>
                    <td className="px-3 py-2.5 text-gray-300">{valueOrBlank(evaluation.altura, "cm")}</td>
                    <td className="px-3 py-2.5 text-gray-300">{valueOrBlank(evaluation.peso, "kg")}</td>
                    <td className="px-3 py-2.5 text-gray-300">{valueOrBlank(evaluation.composicao?.imc)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-1">
                        <button type="button" aria-label="Editar avaliação" onClick={() => editEvaluation(evaluation)} className="evo-btn-ghost p-2"><Pencil className="h-3.5 w-3.5" /></button>
                        <button type="button" aria-label="Excluir avaliação" onClick={() => removeEvaluation(evaluation)} className="evo-btn-ghost p-2 text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-sm text-gray-500">Nenhuma avaliação cadastrada.</p>}
      </SectionCard>
    </div>
  );
}
