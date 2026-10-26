import React, { useEffect, useMemo, useState } from "react";
import { Activity, Calculator, Flame, PieChart, RotateCcw, Save, Scale, Settings2, Zap } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/evo-api";

const EMPTY_EVALUATIONS = [];
const MAX_COLUMNS = 10;

const SECTIONS = [
  ["dados", "Dados iniciais", Activity],
  ["protocolos", "Seleção de Protocolos", Settings2],
  ["gasto", "Gasto Energético", Zap],
  ["meta", "Meta calórica", Scale],
  ["macros", "Previsão de macros", PieChart],
];

const NAF_RAPIDOS = ["1.4", "1.5", "1.6"];

const ARREDONDAMENTOS = [
  ["nenhum", "Sem arredondar"],
  ["cima", "Para cima"],
  ["baixo", "Para baixo"],
];

const arredondar = (value, modo, multiplo = 1) => {
  if (value == null || !Number.isFinite(value)) return null;
  const m = Number(multiplo) || 1;
  if (modo === "cima") return Math.ceil(value / m) * m;
  if (modo === "baixo") return Math.floor(value / m) * m;
  return Math.round(value * 100) / 100;
};

const textoNumero = (value) => (value == null || value === "" ? "" : String(value).replace(".", ","));

const calcPadrao = (salvo, getCalculado) => ({
  get_base: textoNumero(salvo?.get_base ?? getCalculado ?? ""),
  operacao: salvo?.operacao || "diminuir",
  ajuste_kcal: textoNumero(salvo?.ajuste_kcal ?? 0),
  arredondamento: salvo?.arredondamento || "nenhum",
  multiplo: String(salvo?.multiplo || 10),
  kcal_final: textoNumero(salvo?.kcal_final ?? ""),
  final_manual: Boolean(salvo?.final_manual),
  ptn_gkg: textoNumero(salvo?.ptn_gkg ?? 2),
  lip_gkg: textoNumero(salvo?.lip_gkg ?? 1),
  cho_modo: salvo?.cho_modo || "restante",
  cho_gkg: textoNumero(salvo?.cho_gkg ?? 3),
});

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

function CalculadoraGet({ calc, setCalcValue, getCalculado, totalCalculado, kcalFinal, onSalvar, salvando }) {
  const baseDiferente = getCalculado != null && toNumber(calc.get_base) !== Math.round(getCalculado * 100) / 100;
  return (
    <SectionCard title="Calculadora GET" description="Todos os campos são editáveis. O resultado final fica a critério do personal.">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Field label="Valor atual (GET)" type="text" value={calc.get_base} onChange={(value) => setCalcValue("get_base", value)} unit="kcal/dia" />
          {baseDiferente && (
            <button type="button" onClick={() => setCalcValue("get_base", textoNumero(Math.round(getCalculado * 100) / 100))} className="mt-1 text-[11px] text-rc-blueLight hover:text-white">
              Usar GET calculado ({formatValue(getCalculado, "kcal")})
            </button>
          )}
        </div>
        <SelectField label="Aumentar/Diminuir" value={calc.operacao} onChange={(value) => setCalcValue("operacao", value)}>
          <option value="diminuir">Diminuir</option>
          <option value="aumentar">Aumentar</option>
        </SelectField>
        <Field label="Somar/Diminuir" type="text" value={calc.ajuste_kcal} onChange={(value) => setCalcValue("ajuste_kcal", value)} unit="kcal" />
        <SelectField label="Arredondamento" value={calc.arredondamento} onChange={(value) => setCalcValue("arredondamento", value)}>
          {ARREDONDAMENTOS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </SelectField>
        <SelectField label="Arredondar de" value={calc.multiplo} onChange={(value) => setCalcValue("multiplo", value)}>
          {["1", "10", "50", "100"].map((m) => <option key={m} value={m}>{m} em {m} kcal</option>)}
        </SelectField>
        <div className="col-span-2"><Metric label="Total calculado" value={totalCalculado} unit="kcal/dia" /></div>
      </div>

      <div className="mt-4 rounded-lg bg-rc-lime/[0.06] p-4 shadow-[inset_0_0_0_1px_rgba(195,245,60,0.2)]">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-rc-lime">Resultado final</span>
          {calc.final_manual && (
            <button type="button" onClick={() => setCalcValue("final_manual", false)} className="inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-white">
              <RotateCcw className="h-3 w-3" /> Voltar ao total
            </button>
          )}
        </div>
        <div className="relative mt-2">
          <input
            inputMode="decimal"
            aria-label="Resultado final em kcal por dia"
            className="evo-input h-12 pr-20 rc-num text-2xl"
            value={calc.final_manual ? calc.kcal_final : textoNumero(totalCalculado)}
            onChange={(event) => { setCalcValue("final_manual", true); setCalcValue("kcal_final", event.target.value); }}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-gray-500">kcal/dia</span>
        </div>
        <p className="mt-2 text-[11px] text-gray-500">
          {calc.final_manual ? "Valor definido pelo personal." : "Segue o total calculado. Digite para definir outro valor."}
        </p>
        <button type="button" onClick={onSalvar} disabled={salvando || kcalFinal == null} className="evo-btn-primary mt-3 w-full">
          <Save className="h-4 w-4" />{salvando ? "Salvando..." : "Salvar meta do paciente"}
        </button>
      </div>
    </SectionCard>
  );
}

function PrevisaoMacros({ calc, setCalcValue, macros, kcalFinal, kcalMacros, peso, onSalvar, salvando }) {
  const diferenca = kcalFinal != null ? Math.round((kcalMacros - kcalFinal) * 10) / 10 : null;
  const choNegativo = macros.find((m) => m.key === "cho")?.g < 0;
  return (
    <div className="grid gap-4 xl:grid-cols-5">
      <SectionCard className="xl:col-span-2" title="Previsão de macros" description="Distribuição a partir do resultado final da meta calórica, em gramas por kg de peso.">
        <div className="mb-4 grid grid-cols-2 gap-3">
          <Metric label="Meta (resultado final)" value={kcalFinal} unit="kcal/dia" />
          <Metric label="Peso" value={peso} unit="kg" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Proteínas" type="text" value={calc.ptn_gkg} onChange={(value) => setCalcValue("ptn_gkg", value)} unit="g/kg" />
          <Field label="Lipídios" type="text" value={calc.lip_gkg} onChange={(value) => setCalcValue("lip_gkg", value)} unit="g/kg" />
          <SelectField label="Carboidratos" value={calc.cho_modo} onChange={(value) => setCalcValue("cho_modo", value)}>
            <option value="restante">Completar a meta</option>
            <option value="gkg">Definir em g/kg</option>
          </SelectField>
          {calc.cho_modo === "gkg" && (
            <Field label="Carboidratos" type="text" value={calc.cho_gkg} onChange={(value) => setCalcValue("cho_gkg", value)} unit="g/kg" />
          )}
        </div>
        <p className="mt-3 text-[11px] text-gray-500">O arredondamento escolhido na calculadora GET também vale para os gramas.</p>
        <button type="button" onClick={onSalvar} disabled={salvando || kcalFinal == null} className="evo-btn-primary mt-4 w-full">
          <Save className="h-4 w-4" />{salvando ? "Salvando..." : "Salvar meta e macros"}
        </button>
      </SectionCard>

      <SectionCard className="xl:col-span-3" title="Resultado">
        {kcalFinal == null || !peso ? (
          <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-6 text-center text-sm text-gray-500">
            Defina o resultado final na calculadora GET e o peso em Dados iniciais.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-white/[0.08]">
              <table className="w-full min-w-[480px] border-collapse text-sm">
                <thead>
                  <tr className="bg-white/[0.05] text-[11px] uppercase text-gray-400">
                    <th className="px-3 py-3 text-left">Macronutriente</th>
                    <th className="border-l border-white/[0.08] px-3 py-3 text-center">g/kg</th>
                    <th className="border-l border-white/[0.08] px-3 py-3 text-center">Gramas</th>
                    <th className="border-l border-white/[0.08] px-3 py-3 text-center">kcal</th>
                    <th className="border-l border-white/[0.08] px-3 py-3 text-center">%</th>
                  </tr>
                </thead>
                <tbody>
                  {macros.map((m, i) => (
                    <tr key={m.key} className={i % 2 ? "bg-white/[0.025]" : "bg-white/[0.055]"}>
                      <th className="px-3 py-2.5 text-left font-semibold text-gray-200">
                        <span className="mr-2 inline-block h-2 w-2 rounded-[2px]" style={{ background: m.cor }} />{m.label}
                      </th>
                      <td className="border-l border-white/[0.08] px-3 py-2.5 text-center tabular-nums text-gray-300">{formatValue(m.gkg)}</td>
                      <td className="border-l border-white/[0.08] px-3 py-2.5 text-center tabular-nums font-semibold text-white">{formatValue(m.g, "g")}</td>
                      <td className="border-l border-white/[0.08] px-3 py-2.5 text-center tabular-nums text-gray-300">{formatValue(m.kcal)}</td>
                      <td className="border-l border-white/[0.08] px-3 py-2.5 text-center tabular-nums text-gray-300">
                        {m.kcal != null && kcalMacros > 0 ? `${numberFmt.format(Math.round((m.kcal / kcalMacros) * 1000) / 10)}%` : "-"}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-white/[0.1]">
                    <th className="px-3 py-2.5 text-left font-bold text-gray-100">Total</th>
                    <td className="border-l border-white/[0.08]" />
                    <td className="border-l border-white/[0.08]" />
                    <td className="border-l border-white/[0.08] px-3 py-2.5 text-center tabular-nums font-semibold text-rc-lime">{formatValue(Math.round(kcalMacros * 10) / 10)}</td>
                    <td className="border-l border-white/[0.08] px-3 py-2.5 text-center text-gray-300">100%</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-white/[0.04]">
              {kcalMacros > 0 && macros.filter((m) => m.kcal > 0).map((m) => (
                <div key={m.key} style={{ width: `${(m.kcal / kcalMacros) * 100}%`, background: m.cor }} />
              ))}
            </div>
            {choNegativo && <p className="mt-3 text-[12px] text-rc-coral">Proteínas e lipídios já passam da meta: reduza o g/kg para sobrar carboidrato.</p>}
            {!choNegativo && diferenca != null && Math.abs(diferenca) >= 1 && (
              <p className="mt-3 text-[12px] text-rc-amber">Os macros somam {formatValue(Math.abs(diferenca), "kcal")} {diferenca > 0 ? "acima" : "abaixo"} da meta.</p>
            )}
          </>
        )}
      </SectionCard>
    </div>
  );
}

export default function GastoEnergetico({ d, reload }) {
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
    peso_desejado: "",
    prazo_dias: 30,
  });
  const [calc, setCalc] = useState(() => calcPadrao(patient.meta_energetica, lastComp.get_kcal));
  const [salvandoMeta, setSalvandoMeta] = useState(false);
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
        naf_codigo: toNumber(form.naf_manual) ? null : Number(form.naf_codigo),
        naf_manual: toNumber(form.naf_manual) || null,
        fi_codigo: form.fi_codigo ? Number(form.fi_codigo) : null,
        fi_manual: toNumber(form.fi_manual) || null,
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
      setCalc((current) => ({ ...current, get_base: textoNumero(getRes.data.get) }));
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

  const getCalculado = result?.get ?? lastComp.get_kcal ?? null;
  const getBase = toNumber(calc.get_base);
  const ajuste = toNumber(calc.ajuste_kcal) || 0;
  const totalBruto = getBase == null ? null : calc.operacao === "aumentar" ? getBase + ajuste : getBase - ajuste;
  const totalCalculado = arredondar(totalBruto, calc.arredondamento, calc.multiplo);
  const kcalFinal = calc.final_manual ? toNumber(calc.kcal_final) : totalCalculado;
  const currentGet = getBase;
  const adjustedGet = kcalFinal;

  // Previsão de macros a partir do resultado final escolhido pelo personal.
  const peso = toNumber(form.peso);
  const gramas = (gkg) => (peso && toNumber(gkg) != null ? toNumber(gkg) * peso : null);
  const arredGramas = (g) => (g == null ? null : calc.arredondamento === "nenhum" ? Math.round(g * 10) / 10 : arredondar(g, calc.arredondamento, 1));
  const ptnG = arredGramas(gramas(calc.ptn_gkg));
  const lipG = arredGramas(gramas(calc.lip_gkg));
  const choG = calc.cho_modo === "gkg"
    ? arredGramas(gramas(calc.cho_gkg))
    : kcalFinal != null && ptnG != null && lipG != null ? arredGramas((kcalFinal - ptnG * 4 - lipG * 9) / 4) : null;
  const macros = [
    { key: "ptn", label: "Proteínas", g: ptnG, kcalPorG: 4, cor: "#4DA6FF" },
    { key: "cho", label: "Carboidratos", g: choG, kcalPorG: 4, cor: "#C3F53C" },
    { key: "lip", label: "Lipídios", g: lipG, kcalPorG: 9, cor: "#FFB547" },
  ].map((m) => ({ ...m, kcal: m.g == null ? null : Math.round(m.g * m.kcalPorG * 10) / 10, gkg: m.g != null && peso ? Math.round((m.g / peso) * 100) / 100 : null }));
  const kcalMacros = macros.reduce((acc, m) => acc + (m.kcal || 0), 0);

  const setCalcValue = (key, value) => setCalc((current) => ({ ...current, [key]: value }));
  const salvarMeta = async () => {
    setSalvandoMeta(true);
    try {
      await api.patch(`/patients/${patient.id}`, {
        meta_energetica: {
          get_base: getBase,
          operacao: calc.operacao,
          ajuste_kcal: ajuste,
          arredondamento: calc.arredondamento,
          multiplo: Number(calc.multiplo),
          kcal_final: kcalFinal,
          final_manual: calc.final_manual,
          ptn_gkg: toNumber(calc.ptn_gkg),
          lip_gkg: toNumber(calc.lip_gkg),
          cho_modo: calc.cho_modo,
          cho_gkg: toNumber(calc.cho_gkg),
          macros_g: { proteinas: ptnG, carboidratos: choG, lipidios: lipG },
          atualizado_em: new Date().toISOString(),
        },
      });
      toast.success(`Meta salva: ${formatValue(kcalFinal, "kcal/dia")}.`);
      reload?.();
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail));
    } finally {
      setSalvandoMeta(false);
    }
  };

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
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="evo-label mb-0 mr-1">Fator de atividade rápido</span>
              {NAF_RAPIDOS.map((valor) => {
                const ativo = toNumber(form.naf_manual) === Number(valor);
                return (
                  <button
                    key={valor}
                    type="button"
                    onClick={() => set("naf_manual", ativo ? "" : textoNumero(valor))}
                    className={`h-9 min-w-[64px] rounded-lg px-3 text-sm font-semibold tabular-nums transition-colors ${
                      ativo ? "bg-rc-lime text-rc-ink" : "bg-white/[0.05] text-gray-300 hover:bg-white/[0.09]"
                    }`}
                  >
                    {valor.replace(".", ",")}
                  </button>
                );
              })}
              <span className="text-[11px] text-gray-500">
                {toNumber(form.naf_manual) ? `Usando NAF ${textoNumero(form.naf_manual)} no lugar da tabela.` : "Clique para usar no lugar da tabela."}
              </span>
            </div>
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
              <Field label="NAF manual" type="text" value={form.naf_manual} onChange={(value) => set("naf_manual", value)} />
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
            <CalculadoraGet
              calc={calc}
              setCalcValue={setCalcValue}
              getCalculado={getCalculado}
              totalCalculado={totalCalculado}
              kcalFinal={kcalFinal}
              onSalvar={salvarMeta}
              salvando={salvandoMeta}
            />
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
                  <Metric label="Resultado final" value={adjustedGet} unit="kcal/dia" />
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
            <button type="button" onClick={() => setSection("macros")} className="evo-btn-secondary w-full">
              <PieChart className="h-4 w-4" />Ir para a previsão de macros
            </button>
          </div>
        </div>
      )}

      {section === "macros" && (
        <PrevisaoMacros
          calc={calc}
          setCalcValue={setCalcValue}
          macros={macros}
          kcalFinal={kcalFinal}
          kcalMacros={kcalMacros}
          peso={peso}
          onSalvar={salvarMeta}
          salvando={salvandoMeta}
        />
      )}
    </div>
  );
}
