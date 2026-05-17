import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import NutriLayout from "@/components/evonut/NutriLayout";
import { api, formatApiError } from "@/lib/evo-api";
import StatusBadge from "@/components/evonut/StatusBadge";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { Activity, Brain, Utensils, FileText, Sparkles, ArrowDown, ArrowUp, Minus, Printer, FlaskConical, Upload, Trash2, Download, BellRing } from "lucide-react";
import { toast } from "sonner";
import NudgeManager from "@/components/evonut/NudgeManager";

const TABS = [
  { k: "anamnese", l: "Anamnese", icon: FileText },
  { k: "ia", l: "Análise IA", icon: Brain },
  { k: "antropometria", l: "Antropometria", icon: Activity },
  { k: "exames", l: "Exames", icon: FlaskConical },
  { k: "plano", l: "Plano Alimentar", icon: Utensils },
  { k: "lembretes", l: "Lembretes", icon: BellRing },
  { k: "comparativo", l: "Comparativo", icon: Sparkles },
];

export default function PacienteDetalhe() {
  const { id } = useParams();
  const [d, setD] = useState(null);
  const [tab, setTab] = useState("anamnese");
  const reload = () => api.get(`/patients/${id}`).then((r) => setD(r.data));
  useEffect(() => { reload(); }, [id]);

  if (!d) return <NutriLayout><div className="text-gray-400">Carregando paciente...</div></NutriLayout>;
  const p = d.patient;

  return (
    <NutriLayout>
      <div className="evo-card p-6 mb-6 relative overflow-hidden">
        <div className="absolute -top-10 -right-10 w-48 h-48 rounded-full bg-evo-purple/20 blur-3xl pointer-events-none" />
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-evo-purple to-evo-teal flex items-center justify-center text-xl font-display font-semibold">
              {(p.nome || "P").slice(0, 1).toUpperCase()}
            </div>
            <div>
              <h1 className="evo-h2">{p.nome}</h1>
              <div className="flex items-center gap-3 text-sm text-gray-400 mt-1">
                <span>{p.email || "—"}</span> · <span>{p.telefone}</span>
              </div>
              <div className="mt-2"><StatusBadge status={p.status_funil} /></div>
            </div>
          </div>
          <div className="flex gap-3">
            <Pill l="Peso" v={p.peso ? `${p.peso} kg` : "—"} />
            <Pill l="Altura" v={p.altura ? `${p.altura} cm` : "—"} />
            <Pill l="Objetivo" v={p.objetivo || "—"} />
          </div>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap mb-5">
        {TABS.map((t) => (
          <button
            key={t.k}
            data-testid={`tab-${t.k}`}
            onClick={() => setTab(t.k)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all border ${
              tab === t.k
                ? "bg-evo-purple/15 text-white border-evo-purple/40"
                : "border-white/[0.06] text-gray-300 hover:text-white hover:border-white/[0.15]"
            }`}
          >
            <t.icon className="w-4 h-4" /> {t.l}
          </button>
        ))}
      </div>

      {tab === "anamnese" && <Anamnese d={d} />}
      {tab === "ia" && <IATab d={d} reload={reload} />}
      {tab === "antropometria" && <Antropometria d={d} reload={reload} />}
      {tab === "exames" && <Exames d={d} reload={reload} />}
      {tab === "plano" && <PlanoAlimentar d={d} reload={reload} />}
      {tab === "lembretes" && <NudgeManager patientId={d.patient.id} />}
      {tab === "comparativo" && <Comparativo id={d.patient.id} />}
    </NutriLayout>
  );
}

function Pill({ l, v }) {
  return (
    <div className="px-3 py-2 rounded-lg bg-evo-bg border border-white/[0.06] min-w-[100px]">
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{l}</div>
      <div className="text-sm font-semibold mt-0.5">{v}</div>
    </div>
  );
}

function Anamnese({ d }) {
  const last = d.anamneses?.[0];
  if (!last) return <div className="evo-card p-8 text-gray-400">Anamnese ainda não preenchida.</div>;
  const r = last.respostas || {};
  return (
    <div className="grid md:grid-cols-2 gap-4">
      {Object.entries(r).map(([k, v]) => (
        <div key={k} className="evo-card p-4">
          <div className="text-[11px] uppercase tracking-wider text-gray-500">{k.replaceAll("_", " ")}</div>
          <div className="mt-1 text-sm whitespace-pre-wrap">{String(v) || "—"}</div>
        </div>
      ))}
    </div>
  );
}

function IATab({ d, reload }) {
  const [loading, setLoading] = useState(false);
  const last = d.ai_analyses?.[0];
  const run = async () => {
    setLoading(true);
    try {
      await api.post(`/patients/${d.patient.id}/analysis`);
      toast.success("Análise gerada!");
      reload();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-400">A IA gera um diagnóstico estruturado com base na anamnese e na avaliação mais recente.</p>
        <button data-testid="run-analysis" onClick={run} disabled={loading} className="evo-btn-primary">
          <Brain className="w-4 h-4" /> {loading ? "Analisando..." : last ? "Gerar nova análise" : "Gerar análise"}
        </button>
      </div>
      {!last && <div className="evo-card p-8 text-gray-400 text-sm">Nenhuma análise ainda. Clique em <strong>Gerar análise</strong>.</div>}
      {last && (
        <div className="evo-card p-6 prose prose-invert max-w-none">
          <div className="text-xs text-gray-500 mb-2">{new Date(last.created_at).toLocaleString("pt-BR")}</div>
          <div className="whitespace-pre-wrap text-gray-200 text-sm leading-relaxed">{last.content}</div>
        </div>
      )}
    </div>
  );
}

function Antropometria({ d, reload }) {
  const [form, setForm] = useState({
    peso: d.patient.peso || "",
    altura: d.patient.altura || "",
    idade: 30, sexo: d.patient.sexo || "F",
    nivel_atividade: 1.55, objetivo: d.patient.objetivo || "manutencao",
    protocolo_dobras: "pollock3", dobras: {}, perimetria: {},
  });
  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));
  const setD = (k, v) => setForm((s) => ({ ...s, dobras: { ...s.dobras, [k]: v } }));
  const setP = (k, v) => setForm((s) => ({ ...s, perimetria: { ...s.perimetria, [k]: v } }));

  const dobrasFields = useMemo(() => {
    if (form.protocolo_dobras === "pollock7") return ["subescapular", "triceps", "peitoral", "axilar", "suprailiaca", "abdominal", "coxa"];
    if (form.protocolo_dobras === "pollock3") return form.sexo === "M" ? ["peitoral", "abdominal", "coxa"] : ["triceps", "suprailiaca", "coxa"];
    if (form.protocolo_dobras === "faulkner") return ["triceps", "subescapular", "suprailiaca", "abdominal"];
    return [];
  }, [form.protocolo_dobras, form.sexo]);

  const perimFields = ["braco", "torax", "cintura", "abdomen", "quadril", "coxa", "panturrilha"];
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        peso: parseFloat(form.peso), altura: parseFloat(form.altura),
        idade: parseInt(form.idade), sexo: form.sexo,
        nivel_atividade: parseFloat(form.nivel_atividade), objetivo: form.objetivo,
        protocolo_dobras: form.protocolo_dobras,
        dobras: Object.fromEntries(Object.entries(form.dobras).map(([k, v]) => [k, parseFloat(v) || 0])),
        perimetria: Object.fromEntries(Object.entries(form.perimetria).map(([k, v]) => [k, parseFloat(v) || 0])),
      };
      const { data } = await api.post(`/patients/${d.patient.id}/evaluations`, payload);
      toast.success(`Avaliação salva. % Gordura: ${data.composicao.pct_gordura ?? "—"}%`);
      reload();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally { setSaving(false); }
  };

  const evaluations = d.evaluations || [];
  const chartData = [...evaluations].reverse().map((e, i) => ({
    name: `Av${i + 1}`,
    peso: e.peso,
    pct_gordura: e.composicao?.pct_gordura,
    massa_magra: e.composicao?.massa_magra,
  }));

  return (
    <div className="grid lg:grid-cols-5 gap-5">
      <div className="lg:col-span-3 space-y-4">
        <div className="evo-card p-5">
          <h3 className="evo-h3 mb-4">Nova avaliação</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Inp l="Peso (kg)" v={form.peso} onChange={(v) => set("peso", v)} t="number" tid="anth-peso" />
            <Inp l="Altura (cm)" v={form.altura} onChange={(v) => set("altura", v)} t="number" tid="anth-altura" />
            <Inp l="Idade" v={form.idade} onChange={(v) => set("idade", v)} t="number" tid="anth-idade" />
            <Sel l="Sexo" v={form.sexo} onChange={(v) => set("sexo", v)} opts={[["M", "M"], ["F", "F"]]} tid="anth-sexo" />
            <Sel l="Nível atividade" v={form.nivel_atividade} onChange={(v) => set("nivel_atividade", v)}
              opts={[[1.2, "Sedentário"], [1.375, "Leve"], [1.55, "Moderado"], [1.725, "Intenso"], [1.9, "Atleta"]]} tid="anth-atividade" />
            <Sel l="Objetivo" v={form.objetivo} onChange={(v) => set("objetivo", v)}
              opts={[["emagrecimento", "Emagrecimento"], ["manutencao", "Manutenção"], ["hipertrofia", "Hipertrofia"]]} tid="anth-objetivo" />
          </div>

          <div className="mt-5">
            <label className="evo-label">Protocolo de dobras</label>
            <div className="flex gap-2 flex-wrap">
              {[
                ["pollock7", "Pollock 7"],
                ["pollock3", "Pollock 3"],
                ["faulkner", "Faulkner"],
              ].map(([k, l]) => (
                <button
                  key={k}
                  data-testid={`proto-${k}`}
                  onClick={() => set("protocolo_dobras", k)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                    form.protocolo_dobras === k
                      ? "bg-evo-purple/20 border-evo-purple/40 text-white"
                      : "border-white/[0.08] text-gray-300 hover:border-white/[0.2]"
                  }`}
                >{l}</button>
              ))}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
            {dobrasFields.map((k) => (
              <Inp key={k} l={`${k} (mm)`} v={form.dobras[k] || ""} onChange={(v) => setD(k, v)} t="number" tid={`dobra-${k}`} />
            ))}
          </div>

          <div className="mt-5">
            <div className="evo-label">Perimetria (cm)</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {perimFields.map((k) => (
                <Inp key={k} l={k} v={form.perimetria[k] || ""} onChange={(v) => setP(k, v)} t="number" tid={`perim-${k}`} />
              ))}
            </div>
          </div>

          <button data-testid="save-evaluation" onClick={save} disabled={saving || !form.peso || !form.altura} className="evo-btn-primary mt-6 w-full">
            {saving ? "Calculando..." : "Salvar avaliação"}
          </button>
        </div>
      </div>

      <div className="lg:col-span-2 space-y-4">
        <div className="evo-card p-5">
          <h3 className="evo-h3 mb-4">Composição (última)</h3>
          {evaluations[0] ? (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Metric l="IMC" v={evaluations[0].composicao.imc} tag={evaluations[0].composicao.imc_classificacao} />
              <Metric l="TMB" v={`${evaluations[0].composicao.tmb_mifflin} kcal`} />
              <Metric l="GET" v={`${evaluations[0].composicao.get_kcal} kcal`} />
              <Metric l="% Gordura" v={evaluations[0].composicao.pct_gordura ?? "—"} />
              <Metric l="Massa Magra" v={evaluations[0].composicao.massa_magra ?? "—"} />
              <Metric l="Massa Gorda" v={evaluations[0].composicao.massa_gorda ?? "—"} />
            </div>
          ) : <div className="text-sm text-gray-500">Sem avaliação ainda.</div>}
        </div>
        <div className="evo-card p-5">
          <h3 className="evo-h3 mb-4">Evolução</h3>
          {chartData.length === 0 ? (
            <div className="text-sm text-gray-500">Adicione avaliações para ver a evolução.</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="name" stroke="#9CA3AF" fontSize={11} />
                <YAxis stroke="#9CA3AF" fontSize={11} />
                <Tooltip contentStyle={{ background: "#161B22", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="peso" stroke="#7B61FF" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="pct_gordura" stroke="#EF9F27" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="massa_magra" stroke="#1DB97E" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}

function Inp({ l, v, onChange, t = "text", tid }) {
  return (
    <div>
      <label className="evo-label">{l}</label>
      <input data-testid={tid} type={t} className="evo-input" value={v} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
function Sel({ l, v, onChange, opts, tid }) {
  return (
    <div>
      <label className="evo-label">{l}</label>
      <select data-testid={tid} className="evo-input" value={v} onChange={(e) => onChange(e.target.value)}>
        {opts.map(([val, lab]) => <option key={val} value={val}>{lab}</option>)}
      </select>
    </div>
  );
}
function Metric({ l, v, tag }) {
  return (
    <div className="p-3 rounded-lg bg-evo-bg border border-white/[0.04]">
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{l}</div>
      <div className="font-display text-xl font-semibold mt-1">{v}</div>
      {tag && <div className="text-[10px] mt-1 text-evo-teal">{tag}</div>}
    </div>
  );
}

function PlanoAlimentar({ d, reload }) {
  const [obj, setObj] = useState(d.patient.objetivo || "manutencao");
  const [restr, setRestr] = useState("");
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const last = d.meal_plans?.[0];

  const gen = async () => {
    setLoading(true);
    try {
      await api.post(`/patients/${d.patient.id}/meal-plan`, { objetivo: obj, restricoes: restr });
      toast.success("Plano gerado pela IA!");
      reload();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally { setLoading(false); }
  };

  const downloadPdf = async () => {
    if (!last) return;
    setDownloading(true);
    try {
      const r = await api.get(`/patients/${d.patient.id}/meal-plan/${last.id}/pdf`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([r.data], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `evonut-plano-${(d.patient.nome || "paciente").toLowerCase().replace(/\s+/g, "-")}-v${last.version}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
      toast.success("PDF baixado");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Falha ao gerar PDF");
    } finally { setDownloading(false); }
  };

  return (
    <div className="space-y-4">
      <div className="evo-card p-5 grid sm:grid-cols-3 gap-3 items-end">
        <div>
          <label className="evo-label">Objetivo</label>
          <select data-testid="plan-obj" className="evo-input" value={obj} onChange={(e) => setObj(e.target.value)}>
            <option value="emagrecimento">Emagrecimento</option>
            <option value="manutencao">Manutenção</option>
            <option value="hipertrofia">Hipertrofia</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="evo-label">Restrições / preferências</label>
          <input data-testid="plan-restr" className="evo-input" value={restr} onChange={(e) => setRestr(e.target.value)} placeholder="Ex.: sem lactose, vegetariano..." />
        </div>
        <div className="sm:col-span-3">
          <button data-testid="generate-plan" onClick={gen} disabled={loading} className="evo-btn-primary w-full">
            <Utensils className="w-4 h-4" /> {loading ? "Gerando plano..." : last ? "Gerar nova versão" : "Gerar plano com IA"}
          </button>
        </div>
      </div>

      {!last && <div className="evo-card p-8 text-gray-400 text-sm">Nenhum plano ainda. Cadastre uma avaliação física e clique em <strong>Gerar plano</strong>.</div>}

      {last && (
        <div className="evo-card p-6 print:bg-white print:text-black">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
            <div>
              <div className="text-xs text-gray-500">Versão {last.version} · {new Date(last.created_at).toLocaleString("pt-BR")}</div>
              <h3 className="evo-h3 mt-1">Plano alimentar — {last.kcal_total} kcal/dia</h3>
            </div>
            <div className="flex gap-2">
              <button data-testid="download-plan-pdf" onClick={downloadPdf} disabled={downloading} className="evo-btn-primary text-sm">
                <Download className="w-4 h-4" /> {downloading ? "Gerando..." : "Baixar PDF"}
              </button>
              <button data-testid="print-plan" onClick={() => window.print()} className="evo-btn-secondary text-sm">
                <Printer className="w-4 h-4" /> Imprimir
              </button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 mb-5">
            <Macro l="Proteína" v={`${last.proteina_g} g`} pct={last.ptn_pct} color="purple" />
            <Macro l="Carboidrato" v={`${last.carboidrato_g} g`} pct={last.cho_pct} color="teal" />
            <Macro l="Gordura" v={`${last.gordura_g} g`} pct={last.lip_pct} color="amber" />
          </div>
          <div className="whitespace-pre-wrap text-sm text-gray-200 leading-relaxed">{last.content}</div>
        </div>
      )}
    </div>
  );
}

function Macro({ l, v, pct, color }) {
  const map = { purple: "from-evo-purple/20 to-evo-purple/5 text-evo-purple", teal: "from-evo-teal/20 to-evo-teal/5 text-evo-teal", amber: "from-evo-amber/20 to-evo-amber/5 text-evo-amber" };
  return (
    <div className={`p-4 rounded-lg bg-gradient-to-br ${map[color]} border border-white/[0.06]`}>
      <div className="text-[10px] uppercase tracking-wider opacity-70">{l}</div>
      <div className="font-display text-2xl font-semibold mt-1 text-white">{v}</div>
      <div className="text-xs mt-1">{pct}%</div>
    </div>
  );
}

function Comparativo({ id }) {
  const [rows, setRows] = useState([]);
  useEffect(() => { api.get(`/patients/${id}/comparativo`).then((r) => setRows(r.data || [])); }, [id]);
  if (rows.length < 2) return <div className="evo-card p-8 text-gray-400 text-sm">Cadastre ao menos duas avaliações para ver o comparativo.</div>;
  const a = rows[rows.length - 2];
  const b = rows[rows.length - 1];
  const diff = (k, lower = false) => {
    const va = a.composicao?.[k]; const vb = b.composicao?.[k];
    if (va == null || vb == null) return { va, vb, dir: "—" };
    const d = +(vb - va).toFixed(2);
    if (d === 0) return { va, vb, d, dir: "eq" };
    const positive = lower ? d < 0 : d > 0;
    return { va, vb, d, dir: positive ? "up" : "down" };
  };
  const items = [
    { l: "Peso (kg)", k: "imc", get: () => ({ va: a.peso, vb: b.peso, d: +(b.peso - a.peso).toFixed(2), dir: a.peso === b.peso ? "eq" : (b.peso < a.peso ? "up" : "down") }) },
    { l: "IMC", k: "imc", lower: true },
    { l: "% Gordura", k: "pct_gordura", lower: true },
    { l: "Massa Magra", k: "massa_magra", lower: false },
    { l: "Massa Gorda", k: "massa_gorda", lower: true },
    { l: "TMB", k: "tmb_mifflin" },
  ];
  return (
    <div className="evo-card p-5">
      <h3 className="evo-h3 mb-4">Comparativo evolutivo</h3>
      <div className="grid sm:grid-cols-2 gap-4">
        {items.map((it) => {
          const r = it.get ? it.get() : diff(it.k, it.lower);
          const Icon = r.dir === "up" ? ArrowUp : r.dir === "down" ? ArrowDown : Minus;
          const cl = r.dir === "up" ? "text-evo-teal" : r.dir === "down" ? "text-evo-coral" : "text-gray-500";
          return (
            <div key={it.l} className="p-4 rounded-lg bg-evo-bg border border-white/[0.04] flex items-center justify-between">
              <div>
                <div className="text-xs text-gray-500 uppercase tracking-wide">{it.l}</div>
                <div className="text-sm text-gray-300 mt-1">{r.va ?? "—"} → <span className="font-semibold text-white">{r.vb ?? "—"}</span></div>
              </div>
              <div className={`flex items-center gap-1 ${cl} font-semibold text-sm`}>
                <Icon className="w-4 h-4" />
                {typeof r.d === "number" ? r.d : "—"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


function Exames({ d, reload }) {
  const [exams, setExams] = useState(d.exams || []);
  const [uploading, setUploading] = useState(false);
  const [open, setOpen] = useState(null); // exam being viewed in detail
  const fileRef = React.useRef(null);

  React.useEffect(() => { setExams(d.exams || []); }, [d.exams]);

  const upload = async (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Envie um arquivo PDF");
      return;
    }
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const { data } = await api.post(`/patients/${d.patient.id}/exams`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success("Exame analisado pela IA!");
      setExams((e) => [data, ...e]);
      reload();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Falha ao processar PDF");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = async (eid) => {
    if (!window.confirm("Remover este exame?")) return;
    try {
      await api.delete(`/patients/${d.patient.id}/exams/${eid}`);
      setExams((e) => e.filter((x) => x.id !== eid));
      if (open?.id === eid) setOpen(null);
      toast.success("Exame removido");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  const statusStyles = {
    normal: "bg-evo-teal/15 text-evo-teal border-evo-teal/30",
    atencao: "bg-evo-amber/15 text-evo-amber border-evo-amber/30",
    prioridade: "bg-evo-coral/15 text-evo-coral border-evo-coral/30",
  };
  const statusLabel = { normal: "Normal", atencao: "Atenção", prioridade: "Prioridade" };

  return (
    <div className="grid lg:grid-cols-5 gap-5">
      <div className="lg:col-span-2 space-y-4">
        <div className="evo-card p-5">
          <h3 className="evo-h3">Enviar exame</h3>
          <p className="text-xs text-gray-400 mt-1">PDF de até 10 MB. A IA identifica marcadores e classifica em Normal/Atenção/Prioridade.</p>
          <input
            ref={fileRef}
            data-testid="exam-file-input"
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => upload(e.target.files?.[0])}
          />
          <button
            data-testid="upload-exam"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="evo-btn-primary w-full mt-4"
          >
            <Upload className="w-4 h-4" /> {uploading ? "Analisando exame..." : "Selecionar PDF"}
          </button>
        </div>

        <div className="evo-card p-5">
          <h3 className="evo-h3 mb-4">Histórico</h3>
          {exams.length === 0 ? (
            <div className="text-sm text-gray-500">Nenhum exame enviado ainda.</div>
          ) : (
            <div className="space-y-2">
              {exams.map((ex) => (
                <button
                  key={ex.id}
                  data-testid={`exam-item-${ex.id}`}
                  onClick={() => setOpen(ex)}
                  className={`w-full text-left p-3 rounded-lg border transition-all ${
                    open?.id === ex.id ? "border-evo-purple/50 bg-evo-purple/10" : "border-white/[0.06] hover:border-white/[0.15] bg-evo-bg"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm truncate">{ex.file_name}</div>
                      <div className="text-[11px] text-gray-500 mt-0.5">{new Date(ex.created_at).toLocaleString("pt-BR")}</div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {(ex.markers || []).slice(0, 3).map((m, i) => (
                        <span key={i} className={`text-[9px] px-1.5 py-0.5 rounded-full border ${statusStyles[m.status] || "bg-white/5 text-gray-300 border-white/10"}`}>
                          {(m.nome || "").slice(0, 8)}
                        </span>
                      ))}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="lg:col-span-3">
        {!open ? (
          <div className="evo-card p-12 text-center text-gray-500">
            <FlaskConical className="w-7 h-7 mx-auto text-gray-600 mb-3" />
            <div className="text-sm">Selecione um exame para visualizar a análise.</div>
          </div>
        ) : (
          <div className="evo-card p-6">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
              <div className="min-w-0">
                <div className="text-xs text-gray-500">{new Date(open.created_at).toLocaleString("pt-BR")}</div>
                <h3 className="evo-h3 mt-1 truncate">{open.file_name}</h3>
              </div>
              <button data-testid={`delete-exam-${open.id}`} onClick={() => remove(open.id)} className="evo-btn-ghost text-evo-coral">
                <Trash2 className="w-4 h-4" /> Remover
              </button>
            </div>

            {open.resumo && (
              <div className="evo-glass rounded-lg p-4 mb-4">
                <div className="text-[10px] uppercase tracking-widest text-evo-purple font-semibold mb-1">Resumo IA</div>
                <div className="text-sm text-gray-200">{open.resumo}</div>
              </div>
            )}

            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-widest text-gray-500 font-semibold">Marcadores</div>
              {(open.markers || []).length === 0 ? (
                <div className="text-sm text-gray-500">Nenhum marcador identificado neste PDF.</div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-2">
                  {open.markers.map((m, i) => (
                    <div key={i} className="p-3 rounded-lg bg-evo-bg border border-white/[0.04]">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold text-sm capitalize">{m.nome}</div>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold uppercase ${statusStyles[m.status] || "bg-white/5 text-gray-300 border-white/10"}`}>
                          {statusLabel[m.status] || m.status}
                        </span>
                      </div>
                      <div className="text-sm mt-1">
                        <span className="font-semibold text-white">{m.valor}</span>
                        {m.unidade && <span className="text-gray-400"> {m.unidade}</span>}
                      </div>
                      {m.referencia && <div className="text-[11px] text-gray-500 mt-1">Ref.: {m.referencia}</div>}
                      {m.observacao && <div className="text-[11px] text-gray-400 mt-1 italic">{m.observacao}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {open.conduta_sugerida && (
              <div className="mt-4 p-4 rounded-lg bg-gradient-to-br from-evo-purple/10 to-evo-teal/10 border border-evo-purple/20">
                <div className="text-[10px] uppercase tracking-widest text-evo-teal font-semibold mb-1">Conduta sugerida</div>
                <div className="text-sm text-gray-200 whitespace-pre-wrap">{open.conduta_sugerida}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
