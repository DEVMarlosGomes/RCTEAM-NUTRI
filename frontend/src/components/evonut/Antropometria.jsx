import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Baby, ChevronLeft, ChevronRight, ClipboardPlus, HeartPulse, LineChart as IconeGrafico, Pencil, Ruler, ScanLine,
  Trash2, UserRound,
} from "lucide-react";
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/evo-api";
import { CORES, COR_NOME_PROTOCOLO, LEGENDA, corDobra } from "./dobrasCores";
import { PROTOCOLOS_DOBRAS, avisoIdade, dobrasDoProtocolo, perimetrosDoProtocolo } from "./protocolosDobras";
import SeletorAvaliacoes, { numerarAvaliacoes, useAvaliacoesExibidas } from "./SeletorAvaliacoes";
import NovaAvaliacao, { corDelta } from "./NovaAvaliacao";
import ModeloAvaliacao, { useModeloAvaliacao } from "./ModeloAvaliacao";
import useDietaConfig from "./dieta/useDietaConfig";

const MAX_RESULT_COLUMNS = 4;
const EMPTY_EVALUATIONS = [];

// Abas: as de crianças e gestação só aparecem quando se aplicam (idade / sexo)
const SECTIONS = [
  ["nova", "Nova avaliação", ClipboardPlus],
  ["adultos", "Resultado", UserRound],
  ["medidas", "Medidas lado a lado", Ruler],
  ["bio", "Bioimpedância", ScanLine],
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

const emptyForm = (patient, protocoloPadrao = "pollock7") => ({
  data_avaliacao: today(),
  retorno: false,
  peso: patient?.peso ?? "",
  altura: patient?.altura ?? "",
  idade: patientAge(patient),
  sexo: patient?.sexo || "F",
  nivel_atividade: 1.55,
  objetivo: patient?.objetivo || "manutencao",
  protocolo_dobras: protocoloPadrao,
  protocolo_tmb: "mifflin_st_jeor",
  gestante: false,
  ig_semanas: "",
  dobras: {},
  perimetria: {},
  diametros_osseos: {},
  bioimpedancia: {},
  gestacional: { peso_pre_gestacional: "", dum: "", idade_gestacional: "", dpp: "" },
});

const toNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(",", ".").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const numericObject = (source = {}) => Object.fromEntries(
  Object.entries(source)
    .map(([key, value]) => [key, toNumber(value)])
    .filter(([, value]) => value !== null),
);

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

// colunas só para as avaliações cadastradas (sem colunas vazias)
const withFixedColumns = (evaluations) => (evaluations.length ? [...evaluations] : [null]);

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

function SheetTable({ title, description, evaluations, rows, seletor }) {
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
      {seletor && <div className="-mt-3 mb-2">{seletor}</div>}
      <div className="overflow-x-auto rounded-lg border border-white/[0.08]">
        <table className="w-full border-collapse text-xs" style={{ minWidth: 200 + active.length * 96 + 380 }} data-testid="tabela-resultado">
          <thead>
            <tr className="bg-white/[0.05] text-[11px] uppercase text-gray-400">
              <th className="w-[220px] px-3 py-3 text-left font-bold">Indicador</th>
              {active.map((evaluation, index) => (
                <th key={evaluation?.id || index} className="border-l border-white/[0.08] px-2 py-3 text-center font-bold">
                  <div className="text-rc-blue">{evaluation ? `${evaluation._numero}ª Avaliação` : "—"}</div>
                  <div className="mt-0.5 normal-case text-gray-500">{formatDate(evaluationDate(evaluation))}</div>
                </th>
              ))}
              <th className="w-[110px] border-l border-white/[0.08] px-2 py-3 text-center font-bold">Evolução</th>
              <th className="w-[150px] border-l border-white/[0.08] px-2 py-3 text-center font-bold">Recomendação</th>
              <th className="w-[120px] border-l border-white/[0.08] px-2 py-3 text-center font-bold">Situação</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={row.label} className={rowIndex % 2 ? "bg-white/[0.025]" : "bg-white/[0.055]"}>
                <th className="w-[200px] px-3 py-2.5 text-left font-semibold text-gray-200">{row.label}</th>
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
  { label: "Peso Ósseo (kg)", unit: "kg", get: (e, c) => getBio(e, "peso_osseo_kg") ?? c.peso_osseo },
  { label: "Peso Residual (kg)", unit: "kg", get: (e, c) => getBio(e, "peso_residual_kg") ?? c.peso_residual },
  { label: "Peso Muscular (kg)", unit: "kg", get: (e, c) => getBio(e, "peso_muscular_kg") ?? c.peso_muscular },
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
  { label: "* Peso ósseo", unit: "kg", get: (e, c) => getBio(e, "peso_osseo_kg") ?? c.peso_osseo },
  { label: "* Peso residual", unit: "kg", get: (e, c) => c.peso_residual },
  { label: "* Peso muscular", unit: "kg", get: (e, c) => getBio(e, "peso_muscular_kg") ?? c.peso_muscular },
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

const fmtMedida = (value) => {
  const n = toNumber(value);
  return n === null ? "" : n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
};

// `cor`: hex da cor de resultado (só no número); `apagada`: dobra fora do protocolo.
function GridCell({ editable, value, onChange, cor, apagada, label }) {
  const style = cor ? { color: cor } : undefined;
  if (!editable) {
    return <span style={style} className={`block text-center tabular ${cor ? "font-semibold" : apagada ? "text-gray-600" : "text-gray-300"}`}>{fmtMedida(value)}</span>;
  }
  return (
    <input
      aria-label={label}
      inputMode="decimal"
      style={style}
      className={`w-full h-8 rounded-md bg-rc-surfaceAlt text-center tabular outline-none shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] focus:shadow-[inset_0_0_0_1px_#0081FD,0_0_0_3px_rgba(0,129,253,0.22)] ${cor ? "font-semibold" : apagada ? "text-gray-400 opacity-40 focus:opacity-100" : "text-gray-50"}`}
      value={typeof value === "number" ? String(value).replace(".", ",") : value ?? ""}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function ColumnHeader({ col, onPick }) {
  const body = (
    <>
      <div className={col.editable ? "text-rc-lime" : "text-rc-blueLight"}>{col.numero}ª Avaliação</div>
      <div className="mt-0.5 font-normal normal-case tracking-normal text-gray-500">
        {col.editable ? (col.novo ? "nova" : "editando") : formatDate(evaluationDate(col.data))}
      </div>
    </>
  );
  if (col.editable) return <div className="px-1">{body}</div>;
  return (
    <button type="button" onClick={() => onPick(col.data)} title="Editar esta avaliação" className="w-full rounded-md px-1 py-0.5 hover:bg-white/[0.05]">
      {body}
    </button>
  );
}

function DeltaCelula({ a, b, chave, tipo, objetivo }) {
  const va = toNumber(a); const vb = toNumber(b);
  if (va == null || vb == null) return <td className="px-1.5 py-1 text-center text-gray-600">—</td>;
  const d = vb - va;
  return (
    <td className="px-1.5 py-1 text-center tabular font-semibold" style={{ color: corDelta(chave, d, objetivo, tipo) }}>
      {Math.abs(d) < 0.05 ? "=" : `${d > 0 ? "+" : "−"}${fmtMedida(Math.abs(d))}`}
    </td>
  );
}

function PerimetriaAdipometria({ form, setForm, columns, onPick, atleta, exibidas, objetivo }) {
  const [inicio, setInicio] = useState(null);
  const maxInicio = Math.max(0, columns.length - MAX_RESULT_COLUMNS);
  const editIndex = columns.findIndex((col) => col.editable);
  const autoInicio = editIndex < 0 ? maxInicio : Math.min(Math.max(0, editIndex - (MAX_RESULT_COLUMNS - 1)), maxInicio);
  const start = Math.min(Math.max(0, inicio ?? autoInicio), maxInicio);
  // "Avaliações exibidas": com escolha manual, mostra as escolhidas + a coluna em edição (sempre visível)
  const visible = exibidas?.manual
    ? columns.filter((c) => c.editable || exibidas.ids.includes(c.key)).slice(-MAX_RESULT_COLUMNS)
    : columns.slice(start, start + MAX_RESULT_COLUMNS);
  while (visible.length < MAX_RESULT_COLUMNS) visible.push(null);
  const exigidas = dobrasDoProtocolo(form.protocolo_dobras, form.sexo);
  const perimetrosProtocolo = perimetrosDoProtocolo(form.protocolo_dobras, form.sexo);
  const aviso = avisoIdade(form.protocolo_dobras, form.sexo, form.idade);

  const setValor = (grupo, key, value) => setForm((current) => ({
    ...current,
    [grupo]: { ...(current[grupo] || {}), [key]: value },
  }));
  const valor = (col, grupo, key) => (col?.editable ? form[grupo]?.[key] : col?.data?.[grupo]?.[key]);
  // Total da avaliação: só as dobras do protocolo.
  const somaColuna = (col) => exigidas.reduce((acc, key) => acc + (toNumber(valor(col, "dobras", key)) ?? 0), 0);
  const completa = (col) => Boolean(col) && exigidas.length > 0 && exigidas.every((key) => toNumber(valor(col, "dobras", key)) != null);
  const preenchidas = visible.filter(Boolean);
  const ultimasDuas = preenchidas.length >= 2 ? preenchidas.slice(-2) : [null, null];
  // Avaliação anterior na ordem cronológica completa (não só nas colunas visíveis).
  const anteriorDe = (col) => {
    const i = columns.findIndex((c) => c.key === col.key);
    return i > 0 ? columns[i - 1] : null;
  };
  const sexo = form.sexo === "M" || form.sexo === "F" ? form.sexo : null;
  const hex = (nome) => (nome ? CORES[nome] : undefined);
  const corCelula = (col, key) => {
    const ant = anteriorDe(col);
    return hex(corDobra({
      atleta, sexo, chave: key,
      valor: toNumber(valor(col, "dobras", key)),
      anterior: ant ? toNumber(valor(ant, "dobras", key)) : null,
    }));
  };
  const corTotal = (col) => {
    if (!completa(col)) return undefined;
    if (atleta) {
      // As faixas de total valem só para o protocolo de 7 dobras.
      if (form.protocolo_dobras !== "pollock7") return undefined;
      return hex(corDobra({ atleta, sexo, chave: "total", valor: somaColuna(col) }));
    }
    const ant = anteriorDe(col);
    if (!ant) return CORES.cinza;
    if (!completa(ant)) return undefined;
    return hex(corDobra({ atleta, sexo, chave: "total", valor: somaColuna(col), anterior: somaColuna(ant) }));
  };
  const nomeProtocolo = PROTOCOLOS_DOBRAS.find((p) => p.id === form.protocolo_dobras)?.nome || "";
  const legenda = atleta ? LEGENDA.atleta : LEGENDA.naoAtleta;
  const editavel = (col) => (col?.editable ? "bg-rc-lime/[0.06]" : "");

  const headCells = visible.map((col, i) => (
    <th key={col?.key || `vazio-${i}`} className={`w-[92px] px-1.5 py-2 text-center text-[11px] font-bold ${editavel(col)}`}>
      {col ? <ColumnHeader col={col} onPick={onPick} /> : <span className="text-gray-600">{start + i + 1}ª Avaliação</span>}
    </th>
  ));

  return (
    <section className="evo-card p-5" data-testid="perimetria-adipometria">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="evo-h3">Perimetria & Adipometria</h3>
          <p className="mt-1 text-xs text-gray-500">As avaliações ficam lado a lado, com a diferença (Δ) entre as duas últimas. Clique no título de uma avaliação para editá-la na Nova avaliação.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block w-[270px] max-w-full">
            <span className="evo-label">Protocolo de dobras</span>
            <select data-testid="anth-protocolo" className="evo-input h-10" value={form.protocolo_dobras} onChange={(e) => setForm((c) => ({ ...c, protocolo_dobras: e.target.value }))}>
              {PROTOCOLOS_DOBRAS.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </label>

        </div>
      </div>

      {aviso && <p role="status" className="mb-3 rounded-lg bg-rc-amber/10 px-3 py-2 text-[12px] text-rc-amber" data-testid="aviso-protocolo">{aviso}</p>}
      {exibidas && <div className="mb-1">{<SeletorAvaliacoes estado={exibidas} />}</div>}
      {!exibidas?.manual && columns.length > MAX_RESULT_COLUMNS && (
        <div className="mb-2 flex items-center justify-end gap-1 text-[11px] text-gray-500">
          <button type="button" aria-label="Avaliações anteriores" disabled={start === 0} onClick={() => setInicio(start - 1)} className="evo-btn-ghost p-1.5 disabled:opacity-30">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="tabular">{start + 1}ª a {Math.min(start + MAX_RESULT_COLUMNS, columns.length)}ª de {columns.length}</span>
          <button type="button" aria-label="Próximas avaliações" disabled={start >= maxInicio} onClick={() => setInicio(start + 1)} className="evo-btn-ghost p-1.5 disabled:opacity-30">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-white/[0.08]">
                <th className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-rc-blueLight">Perímetros (cm)</th>
                {headCells}
                <th className="w-[60px] px-1.5 py-2 text-center text-[11px] font-bold text-gray-300">Δ</th>
              </tr>
            </thead>
            <tbody>
              {PERIMETRIA.map(([key, label]) => (
                <tr key={key} className="border-b border-white/[0.04]">
                  <th style={perimetrosProtocolo.includes(key) ? { color: COR_NOME_PROTOCOLO } : undefined}
                    className={`px-2 py-1 text-left ${perimetrosProtocolo.includes(key) ? "font-bold" : "font-medium text-gray-300"}`}>{label}</th>
                  {visible.map((col, i) => (
                    <td key={col?.key || `vazio-${i}`} className={`px-1.5 py-1 ${editavel(col)}`}>
                      {col && <GridCell editable={col.editable} value={valor(col, "perimetria", key)} onChange={(v) => setValor("perimetria", key, v)} label={`${label} - ${col.numero}ª avaliação`} />}
                    </td>
                  ))}
                  <DeltaCelula a={ultimasDuas[0] ? valor(ultimasDuas[0], "perimetria", key) : null} b={ultimasDuas[1] ? valor(ultimasDuas[1], "perimetria", key) : null} chave={key} objetivo={objetivo} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-5">
          <div className="overflow-x-auto">
            <p className="px-2 pb-2 text-[11.5px] text-gray-500">
              <span className="font-semibold text-gray-200">{sexo === "M" ? "Homem" : sexo === "F" ? "Mulher" : "Sexo não informado"}</span>
              {" · "}{atleta ? "Atleta" : "Não atleta"}{" · "}{exigidas.length ? `${exigidas.length} dobras` : "protocolo por perímetros"} ({nomeProtocolo})
            </p>
            <table className="w-full min-w-[540px] border-collapse text-xs">
              <thead>
                <tr className="border-b border-white/[0.08]">
                  <th className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-rc-blueLight">Dobras (mm)</th>
                  {headCells}
                  <th className="w-[60px] px-1.5 py-2 text-center text-[11px] font-bold text-gray-300" title="Diferença entre as duas últimas avaliações exibidas">Δ</th>
                </tr>
              </thead>
              <tbody>
                {DOBRAS.map(([key, label]) => {
                  const noProtocolo = exigidas.includes(key);
                  return (
                    <tr key={key} className="border-b border-white/[0.04]">
                      <th style={noProtocolo ? { color: COR_NOME_PROTOCOLO } : undefined} className={`px-2 py-1 text-left ${noProtocolo ? "font-bold" : "font-medium text-gray-600"}`}>{label}</th>
                      {visible.map((col, i) => (
                        <td key={col?.key || `vazio-${i}`} className={`px-1.5 py-1 ${editavel(col)}`}>
                          {col && <GridCell editable={col.editable} cor={noProtocolo ? corCelula(col, key) : undefined} apagada={!noProtocolo} value={valor(col, "dobras", key)} onChange={(v) => setValor("dobras", key, v)} label={`Dobra ${label} - ${col.numero}ª avaliação`} />}
                        </td>
                      ))}
                      <DeltaCelula a={ultimasDuas[0] ? valor(ultimasDuas[0], "dobras", key) : null} b={ultimasDuas[1] ? valor(ultimasDuas[1], "dobras", key) : null} chave={key} tipo="dobra" />
                    </tr>
                  );
                })}
                <tr className="border-t border-white/[0.1]">
                  <th className="px-2 py-2 text-left font-bold text-gray-200">Soma ({exigidas.length} dobras)</th>
                  {visible.map((col, i) => {
                    const cor = col ? corTotal(col) : undefined;
                    return (
                      <td key={col?.key || `vazio-${i}`} style={cor ? { color: cor } : undefined} className={`px-1.5 py-2 text-center tabular font-semibold ${cor ? "" : "text-gray-200"} ${editavel(col)}`}>
                        {col ? fmtMedida(somaColuna(col)) : ""}
                      </td>
                    );
                  })}
                  <DeltaCelula a={ultimasDuas[0] && completa(ultimasDuas[0]) ? somaColuna(ultimasDuas[0]) : null} b={ultimasDuas[1] && completa(ultimasDuas[1]) ? somaColuna(ultimasDuas[1]) : null} chave="soma_dobras" tipo="dobra" />
                </tr>
              </tbody>
            </table>
          </div>
          <div className="rc-well px-3 py-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11.5px] text-gray-400" data-testid="legenda-dobras">
            <span><span className="font-bold" style={{ color: COR_NOME_PROTOCOLO }}>Nome azul</span> entra no protocolo</span>
            {legenda.map(([cor, texto]) => (
              <span key={cor}><span className="font-semibold" style={{ color: CORES[cor] }}>{cor[0].toUpperCase() + cor.slice(1)}</span> {texto}</span>
            ))}
            {atleta && !sexo && <span className="text-rc-amber">Informe o sexo do paciente para colorir pelas faixas de atleta.</span>}
          </div>
        </div>
      </div>
    </section>
  );
}

function MiniGrafico({ rotulo, valores, unidade, chave, objetivo }) {
  const pts = valores.filter((v) => v != null);
  const ultimo = pts[pts.length - 1];
  const delta = pts.length >= 2 ? pts[pts.length - 1] - pts[pts.length - 2] : null;
  const W = 120; const H = 34;
  const min = Math.min(...pts); const max = Math.max(...pts);
  const caminho = pts.map((v, i) => `${i ? "L" : "M"}${(pts.length === 1 ? W / 2 : (i / (pts.length - 1)) * W).toFixed(1)},${(H - 4 - (max === min ? 0.5 : (v - min) / (max - min)) * (H - 8)).toFixed(1)}`).join(" ");
  return (
    <div className="rounded-xl bg-white/[0.03] px-4 py-3 ring-1 ring-white/[0.06]">
      <div className="text-[10.5px] uppercase tracking-[0.12em] text-gray-500">{rotulo}</div>
      <div className="mt-1 flex items-end justify-between gap-3">
        <div>
          <div className="rc-num text-[20px] text-white">{ultimo != null ? `${numberFmt.format(ultimo)}${unidade}` : "—"}</div>
          {delta != null && <div className="text-[11.5px] font-semibold tabular" style={{ color: corDelta(chave, delta, objetivo) }}>{delta > 0 ? "+" : delta < 0 ? "−" : ""}{numberFmt.format(Math.abs(delta))}{unidade}</div>}
        </div>
        {pts.length > 0 && <svg width={W} height={H} aria-hidden><path d={caminho} fill="none" stroke="#4DA6FF" strokeWidth="2" strokeLinejoin="round" /></svg>}
      </div>
    </div>
  );
}

export default function Antropometria({ d, reload }) {
  const patient = d.patient;
  const { config } = useDietaConfig();
  const modelo = useModeloAvaliacao(patient);
  const evaluations = d.evaluations || EMPTY_EVALUATIONS;
  const orderedEvaluations = useMemo(() => numerarAvaliacoes(evaluations), [evaluations]);
  const ultimaAval = orderedEvaluations[orderedEvaluations.length - 1];
  const protocoloInicial = ultimaAval?.protocolo_dobras || config.protocolo_dobras_padrao || "pollock7";
  const [section, setSection] = useState("nova");
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => emptyForm(patient, protocoloInicial));
  const [fotos, setFotos] = useState([]);
  const [pendentes, setPendentes] = useState({});
  const [graficoCompleto, setGraficoCompleto] = useState(false);

  const idade = patientAge(patient);
  const mostraCriancas = idade < 18 || orderedEvaluations.some((e) => Number(e.idade) < 18);
  const mostraGestacao = patient.sexo === "F" && (patient.gestante || orderedEvaluations.some((e) => e.gestante));
  const temBio = orderedEvaluations.some((e) => Object.values(e.bioimpedancia || {}).some((v) => v != null && v !== ""));
  const secoes = SECTIONS.filter(([k]) => (k !== "criancas" || mostraCriancas) && (k !== "gestacional" || mostraGestacao) && (k !== "bio" || temBio));

  const exibidas = useAvaliacoesExibidas(orderedEvaluations, 6);
  const resultEvaluations = exibidas.visiveis;
  const gridColumns = useMemo(() => orderedEvaluations.map((evaluation, index) => ({
    key: evaluation.id, numero: index + 1, data: evaluation, editable: false,
  })), [orderedEvaluations]);

  const recarregarFotos = useCallback(() => {
    api.get(`/patients/${patient.id}/fotos-avaliacoes`).then((r) => setFotos(r.data || [])).catch(() => {});
  }, [patient.id]);
  useEffect(() => { recarregarFotos(); }, [recarregarFotos]);

  // avaliação anterior à que está sendo feita/editada
  const anterior = useMemo(() => {
    if (!editingId) return ultimaAval || null;
    const i = orderedEvaluations.findIndex((e) => e.id === editingId);
    return i > 0 ? orderedEvaluations[i - 1] : null;
  }, [editingId, orderedEvaluations, ultimaAval]);

  const chartData = useMemo(() => orderedEvaluations.map((evaluation, index) => ({
    name: `Av. ${index + 1}`,
    peso: evaluation.peso,
    gordura: evaluation.composicao?.pct_gordura,
    muscular: evaluation.composicao?.massa_magra,
  })), [orderedEvaluations]);

  const reset = () => {
    setEditingId(null);
    setForm(emptyForm(patient, protocoloInicial));
    setPendentes({});
  };

  const editEvaluation = (evaluation) => {
    setEditingId(evaluation.id);
    setPendentes({});
    setForm({
      ...emptyForm(patient, protocoloInicial),
      ...evaluation,
      data_avaliacao: evaluation.data_avaliacao || evaluation.created_at?.slice(0, 10) || today(),
      retorno: Boolean(evaluation.retorno),
      dobras: evaluation.dobras || {},
      perimetria: evaluation.perimetria || {},
      diametros_osseos: evaluation.diametros_osseos || {},
      bioimpedancia: evaluation.bioimpedancia || {},
      gestacional: { ...emptyForm(patient).gestacional, ...(evaluation.gestacional || {}) },
    });
    setSection("nova");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const removeEvaluation = async (evaluation) => {
    if (!window.confirm("Excluir esta avaliação antropométrica?")) return;
    try {
      await api.delete(`/patients/${patient.id}/evaluations/${evaluation.id}`);
      toast.success("Avaliação excluída.");
      if (editingId === evaluation.id) reset();
      reload();
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail));
    }
  };

  const save = async ({ donatto } = {}) => {
    if (!toNumber(form.peso) || !toNumber(form.altura) || !toNumber(form.idade)) {
      toast.error("Preencha peso, altura e idade.");
      return;
    }
    setSaving(true);
    try {
      const igSemanas = form.gestacional.idade_gestacional || form.ig_semanas;
      const gestante = Boolean(form.gestante || igSemanas || form.gestacional.peso_pre_gestacional);
      const payload = {
        ...form,
        peso: toNumber(form.peso),
        altura: toNumber(form.altura),
        idade: Math.round(toNumber(form.idade)),
        sexo_num: form.sexo === "M" ? 1 : 2,
        gestante,
        ig_semanas: gestante && igSemanas ? Number(igSemanas) : null,
        nivel_atividade: Number(form.nivel_atividade) || 1.55,
        dobras: numericObject(form.dobras),
        perimetria: numericObject(form.perimetria),
        diametros_osseos: numericObject(form.diametros_osseos),
        bioimpedancia: numericObject(form.bioimpedancia),
        gestacional: {
          ...form.gestacional,
          peso_pre_gestacional: toNumber(form.gestacional.peso_pre_gestacional),
          idade_gestacional: igSemanas ? Number(igSemanas) : null,
        },
        // cada avaliação grava o modelo usado (etiqueta)
        modelo_avaliacao: modelo,
        donatto: modelo === "donatto" ? donatto : null,
      };
      delete payload.composicao; delete payload._numero; delete payload.id; delete payload.created_at;
      const response = editingId
        ? await api.put(`/patients/${patient.id}/evaluations/${editingId}`, payload)
        : await api.post(`/patients/${patient.id}/evaluations-v2`, payload);
      const eid = response.data.evaluation_id || editingId;
      // fotos escolhidas antes de salvar a avaliação nova
      for (const [pose, dataUrl] of Object.entries(pendentes)) {
        await api.put(`/patients/${patient.id}/evaluations/${eid}/fotos`, { pose, data_url: dataUrl }).catch(() => toast.error(`Não foi possível enviar a foto de ${pose}.`));
      }
      toast.success(`${editingId ? "Avaliação atualizada" : "Avaliação salva"}. IMC: ${response.data.composicao.imc}`);
      reset();
      recarregarFotos();
      reload();
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="anthropometry-workspace">
      <div className="rc-card px-5 py-4"><ModeloAvaliacao patient={patient} reload={reload} /></div>
      <div className="evo-card p-2 overflow-x-auto">
        <div className="flex min-w-max gap-1.5">
          {secoes.map(([key, label, Icon]) => (
            <button key={key} type="button" onClick={() => setSection(key)} data-testid={`anth-aba-${key}`}
              className={`flex h-10 items-center gap-2 rounded-lg px-3.5 text-xs font-semibold transition-colors ${section === key ? "bg-evo-purple text-white" : "text-gray-400 hover:bg-white/[0.05] hover:text-white"}`}>
              <Icon className="h-3.5 w-3.5" />{key === "nova" && editingId ? "Editando avaliação" : label}
            </button>
          ))}
        </div>
      </div>

      {section === "nova" && (
        <NovaAvaliacao key={`${editingId || "nova"}-${modelo}`} d={d} form={form} setForm={setForm} editingId={editingId} anterior={anterior} avaliacoes={orderedEvaluations}
          modelo={modelo} saving={saving} onSalvar={save} onCancelar={reset} fotos={fotos} recarregarFotos={recarregarFotos} pendentes={pendentes} setPendentes={setPendentes} />
      )}

      {section === "medidas" && (
        <PerimetriaAdipometria exibidas={exibidas} atleta={Boolean(patient?.atleta)} objetivo={patient.objetivo}
          form={{ ...form, protocolo_dobras: ultimaAval?.protocolo_dobras || form.protocolo_dobras }} setForm={setForm} columns={gridColumns}
          onPick={(evaluation) => editEvaluation(evaluation)} />
      )}

      {section === "bio" && (
        <SheetTable title="Resultado - bioimpedância" description="Avaliações lado a lado (escolha quais em Avaliações exibidas), com evolução e situação."
          evaluations={resultEvaluations} seletor={<SeletorAvaliacoes estado={exibidas} />} rows={BIO_ROWS} />
      )}

      {section === "adultos" && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="mini-graficos">
            <MiniGrafico rotulo="Peso" unidade=" kg" chave="peso" objetivo={patient.objetivo} valores={orderedEvaluations.map((e) => toNumber(e.peso))} />
            <MiniGrafico rotulo="% Gordura" unidade="%" chave="pct_gordura" objetivo={patient.objetivo} valores={orderedEvaluations.map((e) => toNumber(e.composicao?.pct_gordura))} />
            <MiniGrafico rotulo="Massa magra" unidade=" kg" chave="massa_magra" objetivo={patient.objetivo} valores={orderedEvaluations.map((e) => toNumber(e.composicao?.massa_magra))} />
            <MiniGrafico rotulo="Massa gorda" unidade=" kg" chave="massa_gorda" objetivo={patient.objetivo} valores={orderedEvaluations.map((e) => toNumber(e.composicao?.massa_gorda))} />
          </div>
          <div className="flex justify-end">
            <button type="button" onClick={() => setGraficoCompleto((v) => !v)} className="rc-btn-ghost text-[12.5px]" data-testid="ver-grafico"><IconeGrafico className="h-4 w-4" /> {graficoCompleto ? "Esconder gráfico" : "Ver gráfico completo"}</button>
          </div>
          {graficoCompleto && (
            <div className="evo-card p-5">
              {chartData.length ? (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis dataKey="name" stroke="#4C5766" tick={{ fill: "#8A97A6" }} tickLine={false} axisLine={false} fontSize={11} />
                    <YAxis stroke="#4C5766" tick={{ fill: "#8A97A6" }} tickLine={false} axisLine={false} fontSize={11} width={40} />
                    <Tooltip contentStyle={{ background: "#161C25", border: "none", boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 16px 40px -16px rgba(0,0,0,0.8)", borderRadius: 10, fontSize: 12 }} labelStyle={{ color: "#AEB8C4" }} cursor={{ stroke: "rgba(255,255,255,0.12)" }} />
                    <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: "#AEB8C4" }} />
                    <Line type="monotone" dataKey="peso" stroke="#4DA6FF" strokeWidth={2.5} dot={{ r: 3, strokeWidth: 0, fill: "#4DA6FF" }} activeDot={{ r: 5, strokeWidth: 0 }} />
                    <Line type="monotone" dataKey="gordura" stroke="#FFA53B" strokeWidth={2.5} dot={{ r: 3, strokeWidth: 0, fill: "#FFA53B" }} activeDot={{ r: 5, strokeWidth: 0 }} />
                    <Line type="monotone" dataKey="muscular" stroke="#3DDC84" strokeWidth={2.5} dot={{ r: 3, strokeWidth: 0, fill: "#3DDC84" }} activeDot={{ r: 5, strokeWidth: 0 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <p className="text-sm text-gray-500">Adicione avaliações para visualizar a evolução.</p>}
            </div>
          )}
          <SheetTable title="Resultado - adultos e idosos" description="Uma coluna por avaliação cadastrada, com evolução, recomendação e situação."
            evaluations={resultEvaluations} seletor={<SeletorAvaliacoes estado={exibidas} />} rows={ADULT_ROWS} />
        </div>
      )}

      {section === "criancas" && (
        <SheetTable title="Resultado - crianças e adolescentes" description="Campos iguais ao resultado infantil da planilha."
          evaluations={resultEvaluations} seletor={<SeletorAvaliacoes estado={exibidas} />} rows={CHILD_ROWS} />
      )}

      {section === "gestacional" && (
        <SheetTable title="Resultado gestacional" description="Peso pré-gestacional, IMC pré-gestacional e evolução do ganho de peso."
          evaluations={resultEvaluations} seletor={<SeletorAvaliacoes estado={exibidas} />} rows={GESTATIONAL_ROWS} />
      )}

      <SectionCard title="Histórico de avaliações" description={`${evaluations.length} avaliação(ões) cadastrada(s).`}>
        {orderedEvaluations.length ? (
          <div className="overflow-x-auto rounded-lg border border-white/[0.08]">
            <table className="min-w-[760px] w-full text-xs">
              <thead className="bg-white/[0.05] text-[11px] uppercase text-gray-400">
                <tr>
                  <th className="px-3 py-3 text-left">Avaliação</th>
                  <th className="px-3 py-3 text-left">Data</th>
                  <th className="px-3 py-3 text-left">Modelo</th>
                  <th className="px-3 py-3 text-left">Peso</th>
                  <th className="px-3 py-3 text-left">% Gordura</th>
                  <th className="px-3 py-3 text-left">Fotos</th>
                  <th className="px-3 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {orderedEvaluations.map((evaluation, index) => (
                  <tr key={evaluation.id} className={index % 2 ? "bg-white/[0.025]" : "bg-white/[0.055]"}>
                    <td className="px-3 py-2.5 font-semibold text-white">{index + 1}ª Avaliação{evaluation.retorno ? " · retorno" : ""}</td>
                    <td className="px-3 py-2.5 text-gray-300">{formatDate(evaluationDate(evaluation))}</td>
                    <td className="px-3 py-2.5"><span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-gray-300">{evaluation.modelo_avaliacao === "donatto" ? "Donatto" : "RC"}</span></td>
                    <td className="px-3 py-2.5 text-gray-300">{valueOrBlank(evaluation.peso, "kg")}</td>
                    <td className="px-3 py-2.5 text-gray-300">{valueOrBlank(evaluation.composicao?.pct_gordura, "%")}</td>
                    <td className="px-3 py-2.5 text-gray-300">{fotos.filter((f) => f.avaliacao_id === evaluation.id).length || "—"}</td>
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
