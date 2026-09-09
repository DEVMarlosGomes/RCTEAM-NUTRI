import React, { useEffect, useMemo, useState } from "react";
import { Activity, Calculator, Flame, Gauge, Save, Scale, Settings2, Zap } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/evo-api";

const EMPTY_EVALUATIONS = [];
const MAX_COLUMNS = 10;

const SECTIONS = [
  ["dados", "Dados iniciais", Activity],
  ["protocolos", "Seleção de Protocolos", Settings2],
  ["gasto", "Gasto Energético", Zap],
  ["meta", "Meta calórica", Scale],
];

const PROTOCOLOS_TMB = [
  ["mifflin_st_jeor", "Mifflin St Jeor"],
  ["harris_benedict_1984", "Harris-Benedict (1984)"],
  ["harris_benedict_1919", "Harris-Benedict (1919)"],
  ["fao_who_1985", "FAO/WHO (1985)"],
  ["fao_who_2004", "FAO/WHO (2004)"],
  ["cunningham", "Cunningham (requer MLG)"],
  ["tinsley_peso", "Tinsley (por Peso)"],
  ["tinsley_mlg", "Tinsley (por MLG)"],
];

const numberFmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

const patientAge = (patient) => {
  const birth = patient?.data_nascimento ? new Date(`${patient.data_nascimento}T12:00:00`) : null;
  if (!birth || Number.isNaN(birth.getTime())) return 30;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  if (now < new Date(now.getFullYear(), birth.getMonth(), birth.getDate())) age -= 1;
  return Math.max(age, 0);
};

const today = () => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const toNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(",", ".").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const formatValue = (value, unit) => {
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

const fixedColumns = (evaluations) => {
  const rows = [...evaluations];
  while (rows.length < MAX_COLUMNS) rows.push(null);
  return rows.slice(-MAX_COLUMNS);
};

const pocketLoss = (peso) => {
  const value = toNumber(peso);
  return value == null ? null : Math.floor(value * 20);
};

const pocketGain = (peso) => {
  const value = toNumber(peso);
  return value == null ? null : Math.floor(value * 30);
};

const calcActivityKcal = (comp) => {
  const tmb = toNumber(comp?.tmb);
  const naf = toNumber(comp?.naf);
  if (tmb == null || naf == null) return null;
  return Math.round((tmb * naf - tmb) * 100) / 100;
};

const calcInjuryKcal = (comp) => {
  const tmb = toNumber(comp?.tmb);
  const activity = calcActivityKcal(comp);
  const fi = toNumber(comp?.fi);
  if (tmb == null || activity == null || fi == null) return null;
  return Math.round(((tmb + activity) * fi - (tmb + activity)) * 100) / 100;
};

function Field({ label, value, onChange, type = "number", unit, min }) {
  return (
    <label className="block">
      <span className="evo-label">{label}</span>
      <div className="relative">
        <input
          type={type}
          step={type === "number" ? "any" : undefined}
          min={min}
          className={`evo-input h-11 ${unit ? "pr-16" : ""}`}
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value)}
        />
        {unit && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-gray-500">{unit}</span>}
      </div>
    </label>
  );
}

function SelectField({ label, value, onChange, children }) {
  return (
    <label className="block">
      <span className="evo-label">{label}</span>
      <select className="evo-input h-11" value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
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

function Metric({ label, value, unit, tag }) {
  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3">
      <div className="text-[9px] uppercase tracking-widest font-bold text-gray-500">{label}</div>
      <div className="mt-2 text-lg font-semibold tabular-nums text-white">{formatValue(value, unit)}</div>
      {tag && <div className="mt-1 text-[10px] text-rc-blue">{tag}</div>}
    </div>
  );
}

function SheetTable({ title, description, evaluations, rows }) {
  const active = fixedColumns(evaluations);

  return (
    <SectionCard title={title} description={description}>
      <div className="overflow-x-auto rounded-lg border border-white/[0.08]">
        <table className="min-w-[1320px] w-full border-collapse text-xs">
          <thead>
            <tr className="bg-white/[0.05] text-[11px] uppercase text-gray-400">
              <th className="w-[240px] px-3 py-3 text-left font-bold">Campo</th>
              {active.map((evaluation, index) => (
                <th key={evaluation?.id || index} className="w-[108px] border-l border-white/[0.08] px-2 py-3 text-center font-bold">
                  <div className="text-rc-blue">{index + 1}ª Avaliação</div>
                  <div className="mt-0.5 normal-case text-gray-500">{formatDate(evaluationDate(evaluation))}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={row.label} className={rowIndex % 2 ? "bg-white/[0.025]" : "bg-white/[0.055]"}>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-200">{row.label}</th>
                {active.map((evaluation, index) => (
                  <td key={evaluation?.id || index} className="border-l border-white/[0.08] px-2 py-2.5 text-center text-gray-200">
                    {evaluation ? formatValue(row.get(evaluation, evaluation.composicao || {}), row.unit) : "-"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

const INITIAL_ROWS = [
  { label: "Data da avaliação", get: (evaluation) => formatDate(evaluationDate(evaluation)) },
  { label: "Idade do paciente", unit: "anos", get: (evaluation) => evaluation?.idade },
  { label: "Altura (cm)", unit: "cm", get: (evaluation) => evaluation?.altura },
  { label: "Peso (kg)", unit: "kg", get: (evaluation) => evaluation?.peso },
  { label: "MLG (kg)", unit: "kg", get: (evaluation, comp) => comp.massa_magra },
];

const PROTOCOL_ROWS = [
  { label: "Equação TMB", get: (evaluation, comp) => PROTOCOLOS_TMB.find(([key]) => key === comp.tmb_protocolo)?.[1] || comp.tmb_protocolo },
  { label: "Atividade Física", get: (evaluation, comp) => comp.naf },
  { label: "Fator de Injúria", get: (evaluation, comp) => comp.fi },
];

const ENERGY_ROWS = [
  { label: "Taxa Metabólica Basal (TMB)", unit: "kcal/dia", get: (evaluation, comp) => comp.tmb ?? comp.tmb_mifflin },
  { label: "Atividade Física", unit: "kcal/dia", get: (evaluation, comp) => calcActivityKcal(comp) },
  { label: "Fator de Injúria", unit: "kcal/dia", get: (evaluation, comp) => calcInjuryKcal(comp) },
  { label: "Gasto Energético Total (GET)", unit: "kcal/dia", get: (evaluation, comp) => comp.get_kcal },
];

const META_ROWS = [
  { label: "Fórmula de bolso (Perda de peso)", unit: "kcal/dia", get: (evaluation) => pocketLoss(evaluation?.peso) },
  { label: "Fórmula de bolso (Ganho de peso)", unit: "kcal/dia", get: (evaluation) => pocketGain(evaluation?.peso) },
  { label: "Cálculo VENTA", get: () => "-" },
];

export default function GastoEnergetico({ d }) {
  const patient = d.patient;
  const evaluations = d.evaluations || EMPTY_EVALUATIONS;
  const orderedEvaluations = useMemo(() => [...evaluations]
    .sort((a, b) => String(evaluationDate(a) || a.created_at || "").localeCompare(String(evaluationDate(b) || b.created_at || ""))),
  [evaluations]);
  const lastEval = orderedEvaluations[orderedEvaluations.length - 1];
  const lastComp = lastEval?.composicao || {};

  const [section, setSection] = useState("dados");
  const [form, setForm] = useState({
    data_avaliacao: evaluationDate(lastEval) || today(),
    protocolo: lastComp.tmb_protocolo || "fao_who_1985",
    peso: patient.peso || lastEval?.peso || "",
    altura_cm: patient.altura || lastEval?.altura || "",
    idade: lastEval?.idade || patientAge(patient),
    sexo_num: patient.sexo === "M" ? 1 : 2,
    mlg_kg: lastComp.massa_magra || "",
    naf_codigo: 2,
    naf_manual: "",
    fi_codigo: "",
    fi_manual: "",
    usar_mets: false,
  });
  const [atividadesMets, setAtividadesMets] = useState([{ nome: "Treino", met: "6", duracao_min: "60" }]);
  const [nafOpts, setNafOpts] = useState([]);
  const [fiOpts, setFiOpts] = useState([]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [meta, setMeta] = useState({
    enabled: false,
    ajusteOperacao: "diminuir",
    ajusteKcal: 500,
    peso_desejado: "",
    prazo_dias: 30,
  });
  const [ventaResult, setVentaResult] = useState(null);

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const setMetaValue = (key, value) => setMeta((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    api.get(`/referencias/naf?protocolo=${form.protocolo}&sexo=${form.sexo_num}`)
      .then((response) => setNafOpts(response.data))
      .catch(() => {});
    api.get("/referencias/fatores-injuria")
      .then((response) => setFiOpts(response.data))
      .catch(() => {});
  }, [form.protocolo, form.sexo_num]);

  const calcular = async () => {
    if (!form.peso || !form.altura_cm || !form.idade) {
      toast.error("Preencha peso, altura e idade.");
      setSection("dados");
      return;
    }
    setLoading(true);
    try {
      const tmbRes = await api.post("/calculos/tmb", {
        protocolo: form.protocolo,
        peso: Number(form.peso),
        altura_cm: Number(form.altura_cm),
        idade: Number(form.idade),
        sexo_num: Number(form.sexo_num),
        mlg_kg: form.mlg_kg ? Number(form.mlg_kg) : null,
      });
      const tmb = tmbRes.data.tmb;
      const getRes = await api.post("/calculos/get", {
        tmb,
        naf_codigo: form.naf_manual ? null : Number(form.naf_codigo),
        naf_manual: form.naf_manual ? Number(form.naf_manual) : null,
        fi_codigo: form.fi_codigo ? Number(form.fi_codigo) : null,
        fi_manual: form.fi_manual ? Number(form.fi_manual) : null,
        protocolo_tmb: form.protocolo,
        sexo_num: Number(form.sexo_num),
        peso_kg: Number(form.peso),
        usar_mets: Boolean(form.usar_mets),
        atividades_mets: form.usar_mets
          ? atividadesMets
            .filter((atividade) => atividade.nome && atividade.met && atividade.duracao_min)
            .map((atividade) => ({
              nome: atividade.nome,
              met: Number(atividade.met),
              duracao_min: Number(atividade.duracao_min),
            }))
          : [],
      });
      setResult({ ...tmbRes.data, ...getRes.data });
      setSection("gasto");
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  };

  const calcVenta = async () => {
    if (!meta.peso_desejado || !form.peso) return;
    try {
      const response = await api.post("/calculos/venta", {
        peso_atual: Number(form.peso),
        peso_desejado: Number(meta.peso_desejado),
        prazo_dias: Number(meta.prazo_dias),
      });
      setVentaResult(response.data);
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail));
    }
  };

  const currentGet = result?.get ?? lastComp.get_kcal ?? null;
  const adjustment = toNumber(meta.ajusteKcal) || 0;
  const adjustedGet = currentGet == null
    ? null
    : meta.ajusteOperacao === "aumentar" ? currentGet + adjustment : currentGet - adjustment;

  return (
    <div className="space-y-4" data-testid="energy-workspace">
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
        <div className="space-y-4">
          <SectionCard title="Dados iniciais" description="Campos equivalentes ao bloco inicial da planilha de gasto energético.">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              <Field label="Data da avaliação" value={form.data_avaliacao} onChange={(value) => set("data_avaliacao", value)} type="date" />
              <Field label="Idade do paciente" value={form.idade} onChange={(value) => set("idade", value)} unit="anos" />
              <Field label="Altura" value={form.altura_cm} onChange={(value) => set("altura_cm", value)} unit="cm" />
              <Field label="Peso" value={form.peso} onChange={(value) => set("peso", value)} unit="kg" />
              <Field label="MLG" value={form.mlg_kg} onChange={(value) => set("mlg_kg", value)} unit="kg" />
            </div>
          </SectionCard>
          <SheetTable
            title="Histórico - dados iniciais"
            description="Até 10 avaliações, no mesmo formato sequencial da planilha."
            evaluations={orderedEvaluations}
            rows={INITIAL_ROWS}
          />
        </div>
      )}

      {section === "protocolos" && (
        <div className="space-y-4">
          <SectionCard title="Seleção de Protocolos" description="Equação de TMB, atividade física e fator de injúria.">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              <SelectField label="Equação TMB" value={form.protocolo} onChange={(value) => set("protocolo", value)}>
                {PROTOCOLOS_TMB.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </SelectField>
              <SelectField label="Atividade Física" value={form.naf_codigo} onChange={(value) => set("naf_codigo", value)}>
                {nafOpts.map((option) => (
                  <option key={option.codigo} value={option.codigo}>
                    {option.descricao} - NAF {option.naf}
                  </option>
                ))}
              </SelectField>
              <SelectField label="Fator de Injúria" value={form.fi_codigo} onChange={(value) => set("fi_codigo", value)}>
                <option value="">Paciente não complicado - 1</option>
                {fiOpts.map((option) => (
                  <option key={option.codigo} value={option.codigo}>
                    {option.descricao} - FI {option.fator}
                  </option>
                ))}
              </SelectField>
              <Field label="NAF manual" value={form.naf_manual} onChange={(value) => set("naf_manual", value)} />
              <Field label="FI manual" value={form.fi_manual} onChange={(value) => set("fi_manual", value)} />
              <SelectField label="Sexo" value={form.sexo_num} onChange={(value) => set("sexo_num", value)}>
                <option value={1}>Masculino</option>
                <option value={2}>Feminino</option>
              </SelectField>
            </div>

            <div className="mt-5 rounded-lg border border-white/[0.08] bg-white/[0.03] p-4">
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input type="checkbox" checked={Boolean(form.usar_mets)} onChange={(event) => set("usar_mets", event.target.checked)} className="h-4 w-4" />
                Calcular gasto por METs
              </label>
              {form.usar_mets && (
                <div className="mt-4 space-y-2">
                  {atividadesMets.map((atividade, index) => (
                    <div key={index} className="grid grid-cols-12 gap-2">
                      <div className="col-span-5"><Field label="Atividade" type="text" value={atividade.nome} onChange={(value) => setAtividadesMets((items) => items.map((item, i) => i === index ? { ...item, nome: value } : item))} /></div>
                      <div className="col-span-3"><Field label="MET" value={atividade.met} onChange={(value) => setAtividadesMets((items) => items.map((item, i) => i === index ? { ...item, met: value } : item))} /></div>
                      <div className="col-span-3"><Field label="Min" value={atividade.duracao_min} onChange={(value) => setAtividadesMets((items) => items.map((item, i) => i === index ? { ...item, duracao_min: value } : item))} /></div>
                      <div className="col-span-1 flex items-end">
                        <button type="button" onClick={() => setAtividadesMets((items) => items.length === 1 ? items : items.filter((_, i) => i !== index))} className="h-11 w-full rounded-lg border border-white/[0.08] text-gray-400 hover:text-red-400">×</button>
                      </div>
                    </div>
                  ))}
                  <button type="button" onClick={() => setAtividadesMets((items) => [...items, { nome: "", met: "", duracao_min: "" }])} className="evo-btn-ghost">
                    <Save className="h-4 w-4" />Adicionar atividade
                  </button>
                </div>
              )}
            </div>

            <button type="button" onClick={calcular} disabled={loading} className="evo-btn-primary mt-5 w-full">
              <Calculator className="h-4 w-4" />{loading ? "Calculando..." : "Calcular TMB / GET"}
            </button>
          </SectionCard>
          <SheetTable
            title="Histórico - seleção de protocolos"
            description="Protocolos usados nas avaliações já cadastradas."
            evaluations={orderedEvaluations}
            rows={PROTOCOL_ROWS}
          />
        </div>
      )}

      {section === "gasto" && (
        <div className="grid gap-4 xl:grid-cols-5">
          <div className="xl:col-span-3">
            <SheetTable
              title="Gasto Energético"
              description="TMB, adicional de atividade física, fator de injúria e GET."
              evaluations={orderedEvaluations}
              rows={ENERGY_ROWS}
            />
          </div>
          <div className="space-y-4 xl:col-span-2">
            <SectionCard title="Resultado atual" description="Prévia calculada nesta sessão.">
              {result ? (
                <div className="grid grid-cols-2 gap-3">
                  <Metric label="TMB" value={result.tmb} unit="kcal/dia" tag={PROTOCOLOS_TMB.find(([key]) => key === result.protocolo)?.[1]} />
                  <Metric label="GET" value={result.get} unit="kcal/dia" />
                  <Metric label="NAF" value={result.naf} />
                  <Metric label="FI" value={result.fi} />
                </div>
              ) : (
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-6 text-center text-sm text-gray-500">
                  Use a seleção de protocolos para calcular uma prévia.
                </div>
              )}
            </SectionCard>
            <SectionCard title="Calculadora GET" description="Valor atual, ajuste e total, como no bloco da planilha.">
              <div className="grid grid-cols-2 gap-3">
                <Metric label="Valor Atual" value={currentGet} unit="kcal/dia" />
                <SelectField label="Aumentar/Diminuir" value={meta.ajusteOperacao} onChange={(value) => setMetaValue("ajusteOperacao", value)}>
                  <option value="diminuir">Diminuir</option>
                  <option value="aumentar">Aumentar</option>
                </SelectField>
                <Field label="Somar/Diminuir" value={meta.ajusteKcal} onChange={(value) => setMetaValue("ajusteKcal", value)} unit="kcal" />
                <Metric label="Total" value={adjustedGet} unit="kcal/dia" />
              </div>
            </SectionCard>
          </div>
        </div>
      )}

      {section === "meta" && (
        <div className="grid gap-4 xl:grid-cols-5">
          <div className="xl:col-span-3">
            <SheetTable
              title="Meta calórica"
              description="Fórmulas de bolso e VENTA em colunas de avaliação."
              evaluations={orderedEvaluations}
              rows={META_ROWS}
            />
          </div>
          <div className="space-y-4 xl:col-span-2">
            <SectionCard title="Meta calórica opcional" description="Clonagem prática do bloco de meta da planilha para a avaliação atual.">
              <label className="mb-4 flex items-center gap-2 text-sm text-gray-300">
                <input type="checkbox" checked={meta.enabled} onChange={(event) => setMetaValue("enabled", event.target.checked)} className="h-4 w-4" />
                Usar meta calórica nesta sessão
              </label>
              <div className={`${meta.enabled ? "" : "pointer-events-none opacity-45"}`}>
                <div className="grid grid-cols-2 gap-3">
                  <Metric label="Bolso - perda" value={pocketLoss(form.peso)} unit="kcal/dia" />
                  <Metric label="Bolso - ganho" value={pocketGain(form.peso)} unit="kcal/dia" />
                  <Metric label="GET ajustado" value={adjustedGet} unit="kcal/dia" />
                  <Metric label="GET base" value={currentGet} unit="kcal/dia" />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <Field label="Peso desejado" value={meta.peso_desejado} onChange={(value) => setMetaValue("peso_desejado", value)} unit="kg" />
                  <Field label="Prazo" value={meta.prazo_dias} onChange={(value) => setMetaValue("prazo_dias", value)} unit="dias" min="1" />
                </div>
                <button type="button" onClick={calcVenta} disabled={!meta.peso_desejado || !form.peso} className="evo-btn-primary mt-4 w-full">
                  <Flame className="h-4 w-4" />Calcular VENTA
                </button>
                {ventaResult && (
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <Metric label="Sinal" value={ventaResult.saldo_diario_kcal > 0 ? "Diminuir" : "Aumentar"} />
                    <Metric label="Resultado" value={Math.abs(ventaResult.saldo_diario_kcal)} unit="kcal/dia" tag={ventaResult.objetivo} />
                  </div>
                )}
              </div>
            </SectionCard>
          </div>
        </div>
      )}
    </div>
  );
}
