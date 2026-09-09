import React, { useEffect, useMemo, useState } from "react";
import { BarChart3, ClipboardList, FileSpreadsheet, Target } from "lucide-react";
import { api } from "@/lib/evo-api";

const BADGE = {
  baixo: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  alto: "border-red-500/30 bg-red-500/10 text-red-300",
  normal: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
};

const MACROS = [
  ["energia_kcal", "Energia (kcal)", "kcal"],
  ["proteinas_g", "Proteínas (g)", "g"],
  ["lipidios_g", "Lipídios (g)", "g"],
  ["carboidratos_g", "Carboidratos (g)", "g"],
  ["fibras_g", "Fibra alimentar (g)", "g"],
  ["sodio_mg", "Sódio (mg)", "mg"],
];

const DRI_ROWS = [
  "Energia (kcal)",
  "Proteínas (g)",
  "Lipídios (g)",
  "Carboidratos (g)",
  "Fibra alimentar (g)",
  "Sódio (mg)",
  "Sódio de adição (mg)",
  "Potássio (mg)",
  "Cálcio (mg)",
  "Magnésio (mg)",
  "Manganês (mg)",
  "Fósforo (mg)",
  "Ferro (mg)",
  "Cobre (mg)",
  "Zinco (mg)",
  "Selênio (mcg)",
  "Retinol (mcg)",
  "Vitamina A (mcg)",
  "Vitamina B1 (Tiamina) (mg)",
  "Vitamina B2 (Riboflavina) (mg)",
  "Vitamina B3 (Niacina) (mg)",
  "Vitamina B6 (Piridoxina) (mg)",
  "Vitamina B12 (Cobalamina) (mcg)",
  "Folato (mcg)",
  "Vitamina D (calciferol) (mcg)",
  "Vitamina E (mg)",
  "Vitamina C (mg)",
  "Colesterol (mg)",
  "Á. graxos saturados (g)",
  "Á. graxos monoinsaturados (g)",
  "Á. graxos poliinsaturados (g)",
  "Ácidos graxos trans total (g)",
  "Açúcar total (g)",
  "Açúcar de adição (g)",
];

const numberFmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const fmt = (value, unit = "") => {
  if (value === null || value === undefined || value === "") return "-";
  return `${numberFmt.format(Number(value) || 0)}${unit ? ` ${unit}` : ""}`;
};

const pct = (value, total) => {
  const base = toNumber(total);
  return base > 0 ? Math.round((toNumber(value) / base) * 1000) / 10 : null;
};

const patientWeight = (d) => {
  const evals = d.evaluations || [];
  const last = [...evals].sort((a, b) => String(b.data_avaliacao || b.created_at || "").localeCompare(String(a.data_avaliacao || a.created_at || "")))[0];
  return toNumber(d.patient?.peso || last?.peso);
};

const normalizePlanTotal = (totals, key) => {
  if (!totals) return 0;
  if (key === "proteinas_g") return toNumber(totals.proteinas_g ?? totals.proteina_g);
  if (key === "carboidratos_g") return toNumber(totals.carboidratos_g ?? totals.carboidrato_g);
  if (key === "lipidios_g") return toNumber(totals.lipidios_g ?? totals.lipideos_g);
  if (key === "fibras_g") return toNumber(totals.fibras_g ?? totals.fibra_g);
  return toNumber(totals[key]);
};

function Section({ title, icon: Icon, children }) {
  return (
    <section className="evo-card p-5">
      <div className="mb-4 flex items-center gap-2">
        <Icon className="h-4 w-4 text-rc-blue" />
        <h3 className="evo-h3">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function MacroGrid({ planTotals, recordTotals, weight }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-white/[0.08]">
      <table className="min-w-[760px] w-full border-collapse text-xs">
        <thead>
          <tr className="bg-white/[0.05] text-[11px] uppercase text-gray-400">
            <th className="px-3 py-3 text-left">Macronutrientes</th>
            <th className="border-l border-white/[0.08] px-3 py-3 text-center">Recordatório</th>
            <th className="border-l border-white/[0.08] px-3 py-3 text-center">Plano Alimentar</th>
            <th className="border-l border-white/[0.08] px-3 py-3 text-center">Diferença</th>
            <th className="border-l border-white/[0.08] px-3 py-3 text-center">Gramas / Kg</th>
          </tr>
        </thead>
        <tbody>
          {MACROS.map(([key, label, unit], index) => {
            const rec = normalizePlanTotal(recordTotals, key);
            const plan = normalizePlanTotal(planTotals, key);
            const diff = plan - rec;
            const perKg = weight && unit === "g" ? plan / weight : null;
            return (
              <tr key={key} className={index % 2 ? "bg-white/[0.025]" : "bg-white/[0.055]"}>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-200">{label}</th>
                <td className="border-l border-white/[0.08] px-3 py-2.5 text-center text-gray-300">{fmt(rec, unit)}</td>
                <td className="border-l border-white/[0.08] px-3 py-2.5 text-center text-white">{fmt(plan, unit)}</td>
                <td className={`border-l border-white/[0.08] px-3 py-2.5 text-center font-semibold ${diff < 0 ? "text-amber-300" : diff > 0 ? "text-rc-blue" : "text-emerald-300"}`}>{fmt(diff, unit)}</td>
                <td className="border-l border-white/[0.08] px-3 py-2.5 text-center text-gray-300">{perKg == null ? "-" : fmt(perKg, "g/kg")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MealDistribution({ meals, totalKcal }) {
  const rows = Array.from({ length: 8 }, (_, index) => meals?.[index] || { nome: `Refeição ${index + 1}`, totais: {} });
  return (
    <div className="overflow-x-auto rounded-lg border border-white/[0.08]">
      <table className="min-w-[720px] w-full text-xs">
        <thead>
          <tr className="bg-white/[0.05] text-[11px] uppercase text-gray-400">
            <th className="px-3 py-3 text-left">Plano Alimentar</th>
            <th className="border-l border-white/[0.08] px-3 py-3 text-center">Proteínas</th>
            <th className="border-l border-white/[0.08] px-3 py-3 text-center">Lipídios</th>
            <th className="border-l border-white/[0.08] px-3 py-3 text-center">Carboidratos</th>
            <th className="border-l border-white/[0.08] px-3 py-3 text-center">Kcal</th>
            <th className="border-l border-white/[0.08] px-3 py-3 text-center">%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((meal, index) => (
            <tr key={`${meal.nome}-${index}`} className={index % 2 ? "bg-white/[0.025]" : "bg-white/[0.055]"}>
              <th className="px-3 py-2.5 text-left text-gray-200">{meal.nome || `Refeição ${index + 1}`}</th>
              <td className="border-l border-white/[0.08] px-3 py-2.5 text-center">{fmt(normalizePlanTotal(meal.totais, "proteinas_g"), "g")}</td>
              <td className="border-l border-white/[0.08] px-3 py-2.5 text-center">{fmt(normalizePlanTotal(meal.totais, "lipidios_g"), "g")}</td>
              <td className="border-l border-white/[0.08] px-3 py-2.5 text-center">{fmt(normalizePlanTotal(meal.totais, "carboidratos_g"), "g")}</td>
              <td className="border-l border-white/[0.08] px-3 py-2.5 text-center">{fmt(normalizePlanTotal(meal.totais, "energia_kcal"), "kcal")}</td>
              <td className="border-l border-white/[0.08] px-3 py-2.5 text-center">{pct(normalizePlanTotal(meal.totais, "energia_kcal"), totalKcal) ?? "-"}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DriTable({ items }) {
  const byLabel = new Map((items || []).map((item) => [item.label || item.nutriente, item]));
  return (
    <div className="overflow-x-auto rounded-lg border border-white/[0.08]">
      <table className="min-w-[920px] w-full border-collapse text-xs">
        <thead>
          <tr className="bg-white/[0.05] text-[11px] uppercase text-gray-400">
            <th className="w-[70px] px-3 py-3 text-left">N</th>
            <th className="w-[130px] border-l border-white/[0.08] px-3 py-3 text-left">DRIs</th>
            <th className="border-l border-white/[0.08] px-3 py-3 text-left">Nutrientes</th>
            <th className="border-l border-white/[0.08] px-3 py-3 text-center">Recordatório</th>
            <th className="border-l border-white/[0.08] px-3 py-3 text-center">Plano Alimentar</th>
            <th className="border-l border-white/[0.08] px-3 py-3 text-center">Diferença</th>
            <th className="border-l border-white/[0.08] px-3 py-3 text-center">% Adequação</th>
          </tr>
        </thead>
        <tbody>
          {DRI_ROWS.map((label, index) => {
            const item = byLabel.get(label) || {};
            return (
              <tr key={label} className={index % 2 ? "bg-white/[0.025]" : "bg-white/[0.055]"}>
                <td className="px-3 py-2.5 text-gray-500">{index + 1}</td>
                <td className="border-l border-white/[0.08] px-3 py-2.5 text-gray-400">{item.tipo_dri || "-"}</td>
                <th className="border-l border-white/[0.08] px-3 py-2.5 text-left font-semibold text-gray-200">{label}</th>
                <td className="border-l border-white/[0.08] px-3 py-2.5 text-center text-gray-300">{item.valor_recordatorio ?? "-"}</td>
                <td className="border-l border-white/[0.08] px-3 py-2.5 text-center text-gray-300">{item.valor_plano ?? "-"}</td>
                <td className="border-l border-white/[0.08] px-3 py-2.5 text-center text-gray-300">{item.diferenca ?? "-"}</td>
                <td className="border-l border-white/[0.08] px-3 py-2.5 text-center">
                  {item.pct_adequacao != null ? (
                    <span className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase ${BADGE[item.status] || BADGE.normal}`}>{item.pct_adequacao}%</span>
                  ) : "-"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function AnalisesDieteticas({ d }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const pid = d.patient.id;

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.get(`/patients/${pid}/adequacao`)
      .then((response) => { if (active) setData(response.data); })
      .catch(() => { if (active) setData(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [pid]);

  const plano = data?.plano;
  const recordatorio = data?.recordatorio;
  const planTotals = plano?.totais_dia || {};
  const recTotals = recordatorio?.totais_dia || {};
  const weight = patientWeight(d);
  const driRows = useMemo(() => data?.dri_relevantes || [], [data]);

  if (loading) return <div className="evo-card p-8 text-sm text-gray-400">Carregando análises...</div>;

  return (
    <div className="space-y-4" data-testid="analises-dieteticas-workspace">
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="evo-card p-5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Previsão de macros</div>
          <div className="mt-2 text-lg font-semibold text-white">{plano?.titulo || "Sem plano alimentar"}</div>
          <div className="mt-1 text-xs text-gray-500">Meta: {fmt(plano?.meta_kcal, "kcal")} · Peso atual: {fmt(weight, "kg")}</div>
        </div>
        <div className="evo-card p-5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Recordatório</div>
          <div className="mt-2 text-lg font-semibold text-white">{recordatorio?.data || "Sem recordatório"}</div>
          <div className="mt-1 text-xs text-gray-500">Energia: {fmt(recTotals.energia_kcal, "kcal")}</div>
        </div>
        <div className="evo-card p-5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Plano Alimentar</div>
          <div className="mt-2 text-lg font-semibold text-white">{fmt(planTotals.energia_kcal, "kcal")}</div>
          <div className="mt-1 text-xs text-gray-500">{(plano?.refeicoes || []).length} refeições</div>
        </div>
      </div>

      <Section title="Macronutrientes" icon={Target}>
        <MacroGrid planTotals={planTotals} recordTotals={recTotals} weight={weight} />
      </Section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Plano Alimentar" icon={BarChart3}>
          <MealDistribution meals={plano?.refeicoes || []} totalKcal={planTotals.energia_kcal} />
        </Section>
        <Section title="Meta / Recordatório" icon={ClipboardList}>
          <MealDistribution meals={recordatorio?.refeicoes?.map((meal) => ({ ...meal, totais: meal.totais || meal.totais_refeicao })) || []} totalKcal={recTotals.energia_kcal} />
        </Section>
      </div>

      <Section title="DRIs" icon={FileSpreadsheet}>
        <DriTable items={driRows} />
      </Section>
    </div>
  );
}
