import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import NutriLayout from "@/components/evonut/NutriLayout";
import { api, formatApiError } from "@/lib/evo-api";
import StatusBadge from "@/components/evonut/StatusBadge";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { Activity, Brain, Utensils, FileText, Sparkles, ArrowDown, ArrowUp, Minus, Printer, FlaskConical, Upload, Trash2, Download, BellRing, Zap, ClipboardList, Plus, ChevronDown, ChevronRight, Save, X, Scale, Edit2, Search, Loader2 } from "lucide-react";
import { toast } from "sonner";
import NudgeManager from "@/components/evonut/NudgeManager";

const TABS = [
  { k: "anamnese", l: "Anamnese", icon: FileText },
  { k: "ia", l: "Análise IA", icon: Brain },
  { k: "antropometria", l: "Antropometria", icon: Activity },
  { k: "gasto", l: "Gasto Energético", icon: Zap },
  { k: "exames", l: "Exames", icon: FlaskConical },
  { k: "adequacao", l: "AnÃ¡lises", icon: Sparkles },
  { k: "plano", l: "Plano Alimentar", icon: Utensils },
  { k: "recordatorio", l: "Recordatório", icon: ClipboardList },
  { k: "lembretes", l: "Lembretes", icon: BellRing },
  { k: "comparativo", l: "Comparativo", icon: Sparkles },
];

export default function PacienteDetalhe() {
  const { id } = useParams();
  const [d, setD] = useState(null);
  const [tab, setTab] = useState("anamnese");
  const reload = () => api.get(`/patients/${id}`).then((r) => setD(r.data));
  useEffect(() => {
    api.get(`/patients/${id}`).then((r) => setD(r.data));
  }, [id]);

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
          <div className="flex flex-col gap-2 items-end">
            <div className="flex gap-2">
              <Pill l="Peso" v={p.peso ? `${p.peso} kg` : "—"} />
              <Pill l="Altura" v={p.altura ? `${p.altura} cm` : "—"} />
              <Pill l="Objetivo" v={p.objetivo || "—"} />
            </div>
            <div className="flex gap-2 flex-wrap justify-end">
              <PdfBtn pid={p.id} tipo="anamnese" label="PDF Anamnese" />
              <PdfBtn pid={p.id} tipo="antropometria" label="PDF Antrop." />
              <PdfBtn pid={p.id} tipo="exames" label="PDF Exames" />
            </div>
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

      {tab === "anamnese" && <Anamnese d={d} reload={reload} />}
      {tab === "ia" && <IATab d={d} reload={reload} />}
      {tab === "antropometria" && <Antropometria d={d} reload={reload} />}
      {tab === "gasto" && <GastoEnergetico d={d} />}
      {tab === "exames" && <Exames d={d} reload={reload} />}
      {tab === "adequacao" && <AdequacaoClinica d={d} />}
      {tab === "plano" && <PlanoAlimentar d={d} reload={reload} />}
      {tab === "recordatorio" && <Recordatorio d={d} reload={reload} />}
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

function PdfBtn({ pid, tipo, label }) {
  const [loading, setLoading] = useState(false);
  const download = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/patients/${pid}/relatorios/${tipo}`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([r.data], { type: "application/pdf" }));
      const a = document.createElement("a"); a.href = url; a.download = `${tipo}.pdf`;
      document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url);
    } catch { toast.error(`Erro ao gerar PDF de ${tipo}`); }
    finally { setLoading(false); }
  };
  return (
    <button onClick={download} disabled={loading} className="evo-btn-ghost text-xs flex items-center gap-1 px-2 py-1">
      <Download className="w-3 h-3" /> {loading ? "..." : label}
    </button>
  );
}

const ANAMNESE_SECOES = [
  { key: "dados_sociais", label: "Dados Sociais", campos: [
    ["estado_civil","Estado civil"],["ocupacao","Ocupação"],["escolaridade","Escolaridade"],
    ["naturalidade","Naturalidade"],["email","E-mail"],["telefone","Telefone"],
    ["celular","Celular"],["endereco","Endereço"],["bairro","Bairro"],
    ["cidade_uf","Cidade/UF"],["cep","CEP"],["redes_sociais","Redes sociais"],
  ]},
  { key: "habitos_vida", label: "Hábitos de Vida", campos: [
    ["restricao_alimentar","Restrição alimentar"],["alcool","Álcool"],
    ["tabagismo","Tabagismo"],["refeicoes_fora","Refeições fora"],
    ["pessoas_casa","Pessoas em casa"],["compras_casa","Compras da casa"],
    ["sal_oleo_mes","Sal/óleo/mês"],["habitos_sono","Hábitos de sono"],
  ]},
  { key: "patologias", label: "Patologias e Histórico", campos: [
    ["sintomas_gerais","Sintomas gerais"],["outros_sintomas","Outros sintomas"],
    ["lesoes","Lesões"],["cirurgias","Cirurgias"],["patologias","Patologias"],
    ["medicamentos","Medicamentos"],["historico_familiar","Histórico familiar"],
  ]},
  { key: "avaliacao_clinica", label: "Avaliação Clínica", campos: [
    ["apetite","Apetite"],["mastigacao","Mastigação"],["habito_intestinal","Hábito intestinal"],
    ["cor_fezes","Cor das fezes"],["formato_fezes","Escala de Bristol (1-7)"],
    ["habito_urinario","Hábito urinário"],["ingestao_hidrica","Ingestão hídrica"],
    ["hidratacao_urinaria","Hidratação urinária"],
  ]},
  { key: "alimentacao", label: "Alimentação", campos: [
    ["intolerancia_alimentar","Intolerância alimentar"],["preferencia_alimentar","Preferências"],
    ["aversao_alimentar","Aversões"],["alergia_alimentar","Alergias"],
    ["alteracoes_apetite","Alterações de apetite"],["inicio_obesidade","Início da obesidade"],
    ["dieta_especial","Dieta especial"],["num_refeicoes_dia","Refeições/dia"],["suplementos","Suplementos"],
  ]},
  { key: "atividade_fisica", label: "Atividade Física", campos: [
    ["atividades_praticadas","Atividades praticadas"],["intensidade_atividades","Intensidade"],
    ["horario_atividades","Horário"],["duracao_atividades","Duração"],
    ["frequencia_semana","Frequência/semana"],["sintomas_durante","Sintomas durante"],
    ["sintomas_apos","Sintomas após"],["hidratacao_atividade","Hidratação"],
    ["alimentacao_pre","Alimentação pré"],["alimentacao_durante","Alimentação durante"],
    ["alimentacao_pos","Alimentação pós"],
  ]},
  { key: "mulheres", label: "Dados Femininos", campos: [
    ["ultima_menstruacao","Última menstruação"],["tpm","TPM"],
    ["ciclo_menstrual","Ciclo menstrual"],["contraceptivo","Contraceptivo"],
    ["colicas","Cólicas"],["lactante","Lactante"],["menopausa","Menopausa"],
  ]},
];

function Anamnese({ d, reload }) {
  const [anam, setAnam] = useState(d.anamnese_v2 || {});
  const [openSec, setOpenSec] = useState(null);
  const [editSec, setEditSec] = useState(null);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [obs, setObs] = useState("");
  const [obsSecao, setObsSecao] = useState("dados_iniciais");

  const startEdit = (secKey) => {
    const sec = ANAMNESE_SECOES.find(s => s.key === secKey);
    const init = {};
    if (sec) sec.campos.forEach(([k]) => { init[k] = anam[k] || ""; });
    setDraft(init);
    setEditSec(secKey);
  };

  const save = async (secKey) => {
    setSaving(true);
    try {
      const { data } = await api.patch(`/patients/${d.patient.id}/anamnese/${secKey}`, { dados: draft });
      setAnam(data);
      setEditSec(null);
      toast.success("Seção salva!");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally { setSaving(false); }
  };

  const addObs = async () => {
    if (!obs.trim()) return;
    try {
      await api.post(`/patients/${d.patient.id}/anamnese/observacoes/${obsSecao}`, { texto: obs });
      const { data } = await api.get(`/patients/${d.patient.id}/anamnese-v2`);
      setAnam(data);
      setObs("");
      toast.success("Observação adicionada!");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  const old = d.anamneses?.[0];

  return (
    <div className="space-y-3">
      {old && !d.anamnese_v2?.criado_em && (
        <div className="evo-card p-4 border-evo-amber/30 bg-evo-amber/5">
          <div className="text-xs text-evo-amber font-semibold mb-2">Anamnese da pré-consulta (formato legado)</div>
          <div className="grid sm:grid-cols-2 gap-2">
            {Object.entries(old.respostas || {}).map(([k, v]) => (
              <div key={k} className="text-xs">
                <span className="text-gray-500">{k.replaceAll("_"," ")}: </span>
                <span className="text-gray-200">{String(v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {ANAMNESE_SECOES.map((sec) => {
        const isOpen = openSec === sec.key;
        const isEdit = editSec === sec.key;
        const filled = sec.campos.filter(([k]) => anam[k]).length;
        const obsKey = `obs_${sec.key === "dados_sociais" ? "dados_iniciais" : sec.key}`;
        const obsEntries = anam[obsKey] || [];

        return (
          <div key={sec.key} className="evo-card overflow-hidden">
            <button
              className="w-full flex items-center justify-between p-4 text-left hover:bg-white/[0.02] transition-colors"
              onClick={() => setOpenSec(isOpen ? null : sec.key)}
            >
              <div className="flex items-center gap-3">
                {isOpen ? <ChevronDown className="w-4 h-4 text-evo-purple" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                <span className="font-semibold text-sm">{sec.label}</span>
                <span className="text-[11px] text-gray-500">{filled}/{sec.campos.length} campos</span>
                {obsEntries.length > 0 && <span className="text-[10px] bg-evo-teal/15 text-evo-teal px-2 py-0.5 rounded-full">{obsEntries.length} obs.</span>}
              </div>
              {isOpen && (
                <button
                  onClick={(e) => { e.stopPropagation(); isEdit ? setEditSec(null) : startEdit(sec.key); }}
                  className="text-xs flex items-center gap-1 px-3 py-1 rounded-md border border-white/10 hover:border-evo-purple/40 transition-colors"
                >
                  {isEdit ? <><X className="w-3 h-3" /> Cancelar</> : <><Edit2 className="w-3 h-3" /> Editar</>}
                </button>
              )}
            </button>

            {isOpen && (
              <div className="px-4 pb-4 space-y-4">
                {isEdit ? (
                  <>
                    <div className="grid sm:grid-cols-2 gap-3">
                      {sec.campos.map(([k, label]) => (
                        <div key={k}>
                          <label className="evo-label">{label}</label>
                          <input
                            className="evo-input"
                            value={draft[k] || ""}
                            onChange={(e) => setDraft(prev => ({ ...prev, [k]: e.target.value }))}
                          />
                        </div>
                      ))}
                    </div>
                    <button onClick={() => save(sec.key)} disabled={saving} className="evo-btn-primary">
                      <Save className="w-4 h-4" /> {saving ? "Salvando..." : "Salvar seção"}
                    </button>
                  </>
                ) : (
                  <div className="grid sm:grid-cols-2 gap-2">
                    {sec.campos.map(([k, label]) => anam[k] ? (
                      <div key={k} className="text-sm">
                        <span className="text-gray-500 text-[11px]">{label}: </span>
                        <span className="text-gray-200">{String(anam[k])}</span>
                      </div>
                    ) : null)}
                    {filled === 0 && <div className="text-sm text-gray-500 col-span-2">Seção não preenchida. Clique em Editar.</div>}
                  </div>
                )}

                {obsEntries.length > 0 && (
                  <div className="mt-3 space-y-1">
                    <div className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">Observações</div>
                    {obsEntries.map((o, i) => (
                      <div key={i} className="text-xs p-2 rounded bg-evo-bg border border-white/[0.04]">
                        <span className="text-gray-500 mr-2">{new Date(o.data).toLocaleDateString("pt-BR")}</span>
                        {o.texto}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      <div className="evo-card p-4">
        <div className="text-sm font-semibold mb-3">Adicionar observação</div>
        <div className="flex gap-2 flex-wrap items-end">
          <div>
            <label className="evo-label">Seção</label>
            <select className="evo-input" value={obsSecao} onChange={(e) => setObsSecao(e.target.value)}>
              <option value="dados_iniciais">Dados iniciais</option>
              <option value="habitos_vida">Hábitos de vida</option>
              <option value="patologias">Patologias</option>
              <option value="avaliacao_clinica">Avaliação clínica</option>
              <option value="alimentacao">Alimentação</option>
              <option value="atividade_fisica">Atividade física</option>
              <option value="mulheres">Dados femininos</option>
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="evo-label">Observação</label>
            <input className="evo-input" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Digite a observação..." />
          </div>
          <button onClick={addObs} className="evo-btn-primary" disabled={!obs.trim()}>
            <Plus className="w-4 h-4" /> Adicionar
          </button>
        </div>
      </div>
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

function AdequacaoClinica({ d }) {
  const pid = d.patient.id;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.get(`/patients/${pid}/adequacao`)
      .then((res) => { if (active) setData(res.data); })
      .catch(() => { if (active) setData(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [pid]);

  if (loading) return <div className="evo-card p-8 text-gray-400 text-sm">Carregando anÃ¡lises...</div>;

  const plano = data?.plano;
  const recordatorio = data?.recordatorio;
  const comparativo = data?.comparativo || [];
  const dri = data?.dri_relevantes || [];

  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-2 gap-4">
        <div className="evo-card p-5">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Plano base</div>
          {plano ? (
            <>
              <div className="text-lg font-semibold mt-1">{plano.titulo || "Plano manual"}</div>
              <div className="text-xs text-gray-500 mt-1">Meta kcal: {plano.meta_kcal || "â€”"} · Energia do plano: {plano.totais_dia?.energia_kcal || 0} kcal</div>
            </>
          ) : <div className="text-sm text-gray-500 mt-2">Nenhum plano manual encontrado.</div>}
        </div>
        <div className="evo-card p-5">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">RecordatÃ³rio base</div>
          {recordatorio ? (
            <>
              <div className="text-lg font-semibold mt-1">{recordatorio.data || "â€”"}</div>
              <div className="text-xs text-gray-500 mt-1">Energia do dia: {recordatorio.totais_dia?.energia_kcal || 0} kcal · {recordatorio.finalizado ? "Finalizado" : "Rascunho"}</div>
            </>
          ) : <div className="text-sm text-gray-500 mt-2">Nenhum recordatÃ³rio encontrado.</div>}
        </div>
      </div>

      {plano && recordatorio ? (
        <div className="grid xl:grid-cols-5 gap-4">
          <div className="xl:col-span-3 evo-card p-5">
            <h3 className="evo-h3 mb-4">AdequaÃ§Ã£o do recordatÃ³rio versus plano</h3>
            <div className="grid sm:grid-cols-2 gap-3">
              {comparativo.map((item) => (
                <div key={item.codigo} className="rounded-lg border border-white/[0.06] bg-evo-bg p-3">
                  <div className="text-[10px] uppercase tracking-wider text-gray-500">{item.codigo.replaceAll("_", " ")}</div>
                  <div className="flex items-end justify-between gap-2 mt-2">
                    <div>
                      <div className="text-xs text-gray-500">Plano</div>
                      <div className="font-semibold">{item.plano}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">RecordatÃ³rio</div>
                      <div className="font-semibold">{item.recordatorio}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-gray-500">AderÃªncia</div>
                      <div className={`font-semibold ${item.delta > 0 ? "text-evo-coral" : item.delta < 0 ? "text-blue-400" : "text-evo-teal"}`}>{item.pct_vs_plano != null ? `${item.pct_vs_plano}%` : "â€”"}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="xl:col-span-2 evo-card p-5">
            <h3 className="evo-h3 mb-4">DRIs relevantes</h3>
            {dri.length === 0 ? (
              <div className="text-sm text-gray-500">Sem adequaÃ§Ãµes calculadas no Ãºltimo recordatÃ³rio.</div>
            ) : (
              <div className="space-y-2">
                {dri.map((item) => (
                  <div key={item.nutriente} className="rounded-lg border border-white/[0.06] bg-evo-bg p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold">{item.label}</div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold uppercase ${item.status === "baixo" ? BADGE.baixo : item.status === "alto" ? BADGE.alto : BADGE.normal}`}>
                        {item.status}
                      </span>
                    </div>
                    <div className="text-[11px] text-gray-500 mt-1">
                      {item.valor_recordatorio} / {item.recomendacao || "â€”"} {item.tipo_dri ? `· ${item.tipo_dri}` : ""}
                    </div>
                    <div className="text-xs mt-1 text-white">{item.pct_adequacao != null ? `${item.pct_adequacao}% de adequaÃ§Ã£o` : "Sem referÃªncia"}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="evo-card p-8 text-gray-400 text-sm">Cadastre ao menos um plano manual e um recordatÃ³rio para liberar a leitura de adequaÃ§Ã£o.</div>
      )}
    </div>
  );
}

const DOBRAS_FIELDS = {
  pollock7: ["subescapular","triceps","peitoral","axilar","suprailiaca","abdominal","coxa"],
  pollock3_M: ["peitoral","abdominal","coxa"],
  pollock3_F: ["triceps","suprailiaca","coxa"],
  faulkner: ["triceps","subescapular","suprailiaca","abdominal"],
};
const PERIM_FIELDS = [
  ["braco_relaxado_d","Braco Rel. D"],["cintura","Cintura"],["abdomen","Abdômen"],
  ["quadril","Quadril"],["coxa_d","Coxa D"],["panturrilha_d","Panturrilha D"],
  ["torax","Tórax"],["pescoco","Pescoço"],
];

function Antropometria({ d, reload }) {
  const [form, setForm] = useState({
    peso: d.patient.peso || "", altura: d.patient.altura || "",
    idade: 30, sexo: d.patient.sexo || "F", sexo_num: d.patient.sexo === "M" ? 1 : 2,
    gestante: false, ig_semanas: "",
    nivel_atividade: 1.55, objetivo: d.patient.objetivo || "manutencao",
    protocolo_dobras: "pollock3", protocolo_tmb: "mifflin_st_jeor",
    dobras: {}, perimetria: {}, bioimpedancia: {},
  });
  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));
  const setD = (k, v) => setForm((s) => ({ ...s, dobras: { ...s.dobras, [k]: v } }));
  const setP = (k, v) => setForm((s) => ({ ...s, perimetria: { ...s.perimetria, [k]: v } }));
  const setB = (k, v) => setForm((s) => ({ ...s, bioimpedancia: { ...s.bioimpedancia, [k]: v } }));

  const dobrasFields = useMemo(() => {
    if (form.protocolo_dobras === "pollock7") return DOBRAS_FIELDS.pollock7;
    if (form.protocolo_dobras === "pollock3") return form.sexo === "M" ? DOBRAS_FIELDS.pollock3_M : DOBRAS_FIELDS.pollock3_F;
    if (form.protocolo_dobras === "faulkner") return DOBRAS_FIELDS.faulkner;
    return [];
  }, [form.protocolo_dobras, form.sexo]);

  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        peso: parseFloat(form.peso), altura: parseFloat(form.altura),
        idade: parseInt(form.idade), sexo: form.sexo,
        sexo_num: form.sexo === "M" ? 1 : 2,
        gestante: form.gestante,
        ig_semanas: form.ig_semanas ? parseInt(form.ig_semanas) : null,
        nivel_atividade: parseFloat(form.nivel_atividade), objetivo: form.objetivo,
        protocolo_dobras: form.protocolo_dobras, protocolo_tmb: form.protocolo_tmb,
        dobras: Object.fromEntries(Object.entries(form.dobras).map(([k, v]) => [k, parseFloat(v) || 0])),
        perimetria: Object.fromEntries(Object.entries(form.perimetria).filter(([,v]) => v).map(([k, v]) => [k, parseFloat(v)])),
        bioimpedancia: Object.fromEntries(Object.entries(form.bioimpedancia).filter(([,v]) => v !== "" && v != null).map(([k, v]) => [k, parseFloat(v)])),
      };
      const { data } = await api.post(`/patients/${d.patient.id}/evaluations-v2`, payload);
      toast.success(`Avaliação salva. IMC: ${data.composicao.imc} (${data.composicao.imc_classificacao})`);
      reload();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally { setSaving(false); }
  };

  const evaluations = d.evaluations || [];
  const last = evaluations[0];
  const comp = last?.composicao || {};
  const chartData = [...evaluations].reverse().map((e, i) => ({
    name: `Av${i + 1}`, peso: e.peso,
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
            <Sel l="Sexo" v={form.sexo} onChange={(v) => set("sexo", v)} opts={[["M","Masculino"],["F","Feminino"]]} tid="anth-sexo" />
            <Sel l="Protocolo TMB" v={form.protocolo_tmb} onChange={(v) => set("protocolo_tmb", v)}
              opts={[["mifflin_st_jeor","Mifflin St Jeor"],["harris_benedict_1984","Harris-Benedict 1984"],["harris_benedict_1919","Harris-Benedict 1919"],["fao_who_1985","FAO/WHO 1985"],["fao_who_2004","FAO/WHO 2004"],["cunningham","Cunningham"],["tinsley_peso","Tinsley Peso"]]} tid="anth-tmb" />
            <Sel l="Nível atividade" v={form.nivel_atividade} onChange={(v) => set("nivel_atividade", v)}
              opts={[[1.2,"Sedentário"],[1.375,"Leve"],[1.55,"Moderado"],[1.725,"Intenso"],[1.9,"Atleta"]]} tid="anth-atividade" />
          </div>
          <div className="flex items-center gap-3 mt-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.gestante} onChange={(e) => set("gestante", e.target.checked)} className="w-4 h-4" />
              Gestante
            </label>
            {form.gestante && (
              <Inp l="IG (semanas)" v={form.ig_semanas} onChange={(v) => set("ig_semanas", v)} t="number" tid="anth-ig" />
            )}
          </div>

          <div className="mt-5">
            <label className="evo-label">Protocolo de dobras</label>
            <div className="flex gap-2 flex-wrap">
              {[["pollock7","Pollock 7"],["pollock3","Pollock 3"],["faulkner","Faulkner"]].map(([k, l]) => (
                <button key={k} data-testid={`proto-${k}`} onClick={() => set("protocolo_dobras", k)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${form.protocolo_dobras === k ? "bg-evo-purple/20 border-evo-purple/40 text-white" : "border-white/[0.08] text-gray-300 hover:border-white/[0.2]"}`}>
                  {l}
                </button>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
              {dobrasFields.map((k) => (
                <Inp key={k} l={`${k} (mm)`} v={form.dobras[k] || ""} onChange={(v) => setD(k, v)} t="number" tid={`dobra-${k}`} />
              ))}
            </div>
          </div>

          <div className="mt-5">
            <div className="evo-label">Perimetria (cm)</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {PERIM_FIELDS.map(([k, l]) => (
                <Inp key={k} l={l} v={form.perimetria[k] || ""} onChange={(v) => setP(k, v)} t="number" tid={`perim-${k}`} />
              ))}
            </div>
          </div>

          <div className="mt-5">
            <div className="evo-label">BioimpedÃ¢ncia (opcional)</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Inp l="% Gordura" v={form.bioimpedancia.pct_gordura || ""} onChange={(v) => setB("pct_gordura", v)} t="number" />
              <Inp l="Massa Magra (kg)" v={form.bioimpedancia.massa_magra_kg || ""} onChange={(v) => setB("massa_magra_kg", v)} t="number" />
              <Inp l="% Ãgua corporal" v={form.bioimpedancia.agua_corporal_pct || ""} onChange={(v) => setB("agua_corporal_pct", v)} t="number" />
              <Inp l="Gordura Visceral" v={form.bioimpedancia.gordura_visceral || ""} onChange={(v) => setB("gordura_visceral", v)} t="number" />
              <Inp l="% MÃºsculo Esq." v={form.bioimpedancia.musculo_esqueletico_pct || ""} onChange={(v) => setB("musculo_esqueletico_pct", v)} t="number" />
            </div>
          </div>

          <button data-testid="save-evaluation" onClick={save} disabled={saving || !form.peso || !form.altura} className="evo-btn-primary mt-6 w-full">
            {saving ? "Calculando..." : "Salvar avaliação"}
          </button>
        </div>
      </div>

      <div className="lg:col-span-2 space-y-4">
        <div className="evo-card p-5">
          <h3 className="evo-h3 mb-3">Resultados (última avaliação)</h3>
          {last ? (
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Metric l="IMC" v={comp.imc} tag={comp.imc_classificacao} />
              <Metric l="Peso Ideal" v={comp.peso_ideal_min ? `${comp.peso_ideal_min}–${comp.peso_ideal_max} kg` : "—"} />
              <Metric l="TMB" v={comp.tmb ? `${comp.tmb} kcal` : "—"} />
              <Metric l="GET" v={comp.get_kcal ? `${comp.get_kcal} kcal` : "—"} />
              <Metric l="% Gordura" v={comp.pct_gordura ?? "—"} tag={comp.pct_gordura_classificacao} />
              <Metric l="Massa Magra" v={comp.massa_magra ? `${comp.massa_magra} kg` : "—"} />
              <Metric l="Massa Gorda" v={comp.massa_gorda ? `${comp.massa_gorda} kg` : "—"} />
              <Metric l="Peso Residual" v={comp.peso_residual ? `${comp.peso_residual} kg` : "—"} />
              {comp.ic != null && <Metric l="Índice Conicidade" v={comp.ic} tag={comp.ic_classificacao} />}
              {comp.rcq != null && <Metric l="RCQ" v={comp.rcq} tag={comp.rcq_risco ? "Risco" : "Normal"} />}
              {comp.amb != null && <Metric l="AMB (cm²)" v={comp.amb} />}
              {comp.agb != null && <Metric l="AGB (cm²)" v={comp.agb} />}
              {comp.bioimpedancia?.agua_corporal_pct != null && <Metric l="% Água" v={`${comp.bioimpedancia.agua_corporal_pct}%`} />}
              {comp.bioimpedancia?.gordura_visceral != null && <Metric l="Gordura Visceral" v={comp.bioimpedancia.gordura_visceral} />}
              {comp.bioimpedancia?.musculo_esqueletico_pct != null && <Metric l="% Músculo" v={`${comp.bioimpedancia.musculo_esqueletico_pct}%`} />}
              {comp.imc_gestacional_classificacao && (
                <Metric l="IMC Gestacional" v={comp.imc_gestacional_classificacao} />
              )}
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
  const [subTab, setSubTab] = useState("manual");
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {[["manual","Plano Manual"],["ia","IA"]].map(([k,l]) => (
          <button key={k} onClick={() => setSubTab(k)}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold border transition-all ${subTab===k?"bg-evo-purple/15 text-white border-evo-purple/40":"border-white/[0.06] text-gray-400 hover:text-white"}`}>
            {l}
          </button>
        ))}
      </div>
      {subTab === "manual" && <PlanoManual d={d} reload={reload} />}
      {subTab === "ia" && <PlanoIA d={d} reload={reload} />}
    </div>
  );
}

function PlanoIA({ d, reload }) {
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

// ── Plano Manual ─────────────────────────────────────────────────

const REFEICOES_PADRAO = ["Café da manhã","Lanche da manhã","Almoço","Lanche da tarde","Jantar","Ceia"];

const GRUPOS_FILTRO = [
  "Carnes e Proteínas","Cereais, Raízes, Tubérculos e Frutos",
  "Feijão e Leguminosas","Frutas","Frutas Oleosas","Leite e Derivados",
  "Vegetais A (livres para o consumo)","Vegetais B","Fibras A","Fibras B",
  "Oleaginosas e Sementes","Óleos e Gorduras","Pães e Variedades",
  "Sucos Naturais e Integrais","Livres","Outros",
];

function FoodSearchModal({ refNome, onSelect, onClose }) {
  const [q, setQ] = useState("");
  const [grupo, setGrupo] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 60); }, []);

  useEffect(() => {
    if (q.length < 2 && !grupo) { setResults([]); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ limit: "30" });
        if (q.length >= 2) params.set("q", q);
        if (grupo) params.set("grupo", grupo);
        const { data } = await api.get(`/alimentos?${params}`);
        setResults(data.items ?? data);
      } catch {} finally { setLoading(false); }
    }, 280);
    return () => clearTimeout(t);
  }, [q, grupo]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-xl flex flex-col bg-[#0C1018] border border-white/[0.1] rounded-t-3xl sm:rounded-2xl shadow-[0_32px_80px_-8px_rgba(0,0,0,0.8)] max-h-[90vh] sm:max-h-[74vh]">
        {/* Handle mobile */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden shrink-0">
          <div className="w-10 h-1 rounded-full bg-white/[0.15]" />
        </div>

        {/* Context label */}
        <div className="px-5 pt-2 pb-1 sm:pt-4 shrink-0">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#3DA0FF]">{refNome}</p>
        </div>

        {/* Search bar */}
        <div className="px-4 pb-3 shrink-0">
          <div className="flex items-center gap-3 bg-white/[0.05] rounded-xl px-4 py-3 border border-white/[0.08] focus-within:border-[#0081FD]/50 focus-within:bg-white/[0.07] transition-all duration-200">
            <Search className="w-4 h-4 text-gray-500 shrink-0" />
            <input
              ref={inputRef}
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Buscar alimento..."
              className="flex-1 bg-transparent text-white placeholder-gray-600 text-sm outline-none"
            />
            {loading
              ? <Loader2 className="w-4 h-4 text-gray-600 animate-spin shrink-0" />
              : q && <button onClick={() => setQ("")} className="text-gray-600 hover:text-gray-300 transition-colors shrink-0"><X className="w-4 h-4" /></button>
            }
          </div>
        </div>

        {/* Group chips */}
        <div className="flex gap-1.5 px-4 pb-3 overflow-x-auto shrink-0" style={{scrollbarWidth:"none",msOverflowStyle:"none"}}>
          <button onClick={() => setGrupo("")}
            className={`shrink-0 px-3 py-1 rounded-full text-[11px] font-bold transition-all border ${!grupo ? "bg-[#0081FD] text-black border-[#0081FD]" : "bg-white/[0.05] text-gray-400 hover:bg-white/[0.09] border-white/[0.08]"}`}
          >Todos</button>
          {GRUPOS_FILTRO.map(g => (
            <button key={g} onClick={() => setGrupo(g === grupo ? "" : g)}
              className={`shrink-0 px-3 py-1 rounded-full text-[11px] font-bold transition-all border whitespace-nowrap ${grupo === g ? "bg-[#0081FD] text-black border-[#0081FD]" : "bg-white/[0.05] text-gray-400 hover:bg-white/[0.09] border-white/[0.08]"}`}
            >{g}</button>
          ))}
        </div>

        <div className="h-px bg-white/[0.06] shrink-0" />

        {/* Results */}
        <div className="overflow-y-auto flex-1">
          {results.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center py-12 text-gray-600 gap-2">
              <Search className="w-7 h-7 opacity-30" />
              <p className="text-sm">{(q.length >= 2 || grupo) ? "Nenhum resultado encontrado" : "Digite para buscar ou filtre por grupo"}</p>
            </div>
          )}
          {results.map(f => (
            <button key={f.id} onMouseDown={() => { onSelect(f); onClose(); }}
              className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-white/[0.04] border-b border-white/[0.04] text-left transition-colors group"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm text-white font-medium leading-snug truncate group-hover:text-[#3DA0FF] transition-colors">{f.nome}</div>
                <div className="text-[11px] text-gray-500 mt-0.5 truncate">
                  {f.grupo_display ?? f.grupo ?? f.categoria ?? "—"}
                  {f.fonte ? <span className="text-gray-700"> · {f.fonte}</span> : null}
                </div>
              </div>
              <div className="text-right shrink-0 pl-3">
                <div className="text-sm font-bold text-white tabular-nums">{f.energia_kcal_100g != null ? Math.round(f.energia_kcal_100g) : "—"}</div>
                <div className="text-[10px] text-gray-600">kcal/100g</div>
              </div>
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-white/[0.06] flex items-center justify-between shrink-0">
          <p className="text-[11px] text-gray-600">{results.length > 0 ? `${results.length} resultado${results.length !== 1 ? "s" : ""}` : ""}</p>
          <button onClick={onClose} className="text-xs text-gray-500 hover:text-white transition-colors font-bold uppercase tracking-wider">Fechar</button>
        </div>
      </div>
    </div>
  );
}

async function loadFoodOperationalData(alimentoId) {
  const [measuresRes, equivalentsRes] = await Promise.allSettled([
    api.get(`/alimentos/${alimentoId}/medidas`),
    api.get(`/alimentos/${alimentoId}/equivalentes`),
  ]);
  const measures = measuresRes.status === "fulfilled" ? (measuresRes.value.data?.medidas || []) : [];
  const equivalents = equivalentsRes.status === "fulfilled" ? (equivalentsRes.value.data?.equivalentes || []) : [];
  return { measures, equivalents };
}

function dedupeMeasures(measures = [], fallbackMeasure = null, fallbackGrams = null) {
  const raw = [{ nome: "Gramas", gramas: 1 }, ...measures];
  if (fallbackMeasure && fallbackGrams) raw.push({ nome: fallbackMeasure, gramas: fallbackGrams });
  const seen = new Set();
  return raw.filter((item) => {
    const key = String(item?.nome || "").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function gramsForMeasure(measures = [], measureName = "Gramas", quantity = 0, fallback = 0) {
  const qty = Number(quantity || 0);
  if (!qty) return 0;
  if (!measureName || String(measureName).toLowerCase() === "gramas") return qty;
  const found = measures.find((item) => String(item.nome || "").toLowerCase() === String(measureName).toLowerCase());
  if (!found) return fallback || qty;
  return Number(((Number(found.gramas || 0)) * qty).toFixed(2));
}

function sanitizePlanoDraft(draft) {
  return {
    titulo: draft.titulo,
    objetivo: draft.objetivo || null,
    meta_kcal: draft.meta_kcal || null,
    meta_proteina_g: draft.meta_proteina_g || null,
    meta_carboidrato_g: draft.meta_carboidrato_g || null,
    meta_lipidio_g: draft.meta_lipidio_g || null,
    orientacao_ids: draft.orientacao_ids || [],
    observacoes: draft.observacoes || "",
    refeicoes: (draft.refeicoes || []).map((ref) => ({
      nome: ref.nome,
      horario: ref.horario || "",
      meta_kcal: ref.meta_kcal || null,
      meta_pct: ref.meta_pct || null,
      alimentos: (ref.alimentos || []).map((item) => ({
        alimento_id: item.alimento_id,
        medida_nome: item.medida_nome || "Gramas",
        quantidade: Number(item.quantidade || 0),
        quantidade_g: Number(item.quantidade_g || 0),
        substituivel: item.substituivel !== false,
        observacao: item.observacao || "",
      })),
    })),
  };
}

function sanitizeRecordatorioDraft(draft) {
  return {
    data: draft.data,
    observacoes: draft.observacoes || "",
    finalizado: !!draft.finalizado,
    refeicoes: (draft.refeicoes || []).map((ref, index) => ({
      numero: ref.numero || index + 1,
      nome: ref.nome,
      horario: ref.horario || "",
      observacao: ref.observacao || "",
      itens: (ref.itens || []).map((item, itemIndex) => ({
        n: item.n || itemIndex + 1,
        alimento_id: item.alimento_id || null,
        alimento_nome: item.alimento_nome || "",
        medida_nome: item.medida_nome || "Gramas",
        quantidade: Number(item.quantidade || 0),
        quantidade_g: Number(item.quantidade_g || 0),
      })),
    })),
  };
}

function summarizeSnapshot(snapshot = {}) {
  const refeicoes = snapshot.refeicoes || [];
  const alimentos = refeicoes.reduce((acc, ref) => acc + (ref.alimentos || []).length, 0);
  return {
    titulo: snapshot.titulo || "Plano",
    meta_kcal: snapshot.meta_kcal ?? null,
    meta_proteina_g: snapshot.meta_proteina_g ?? null,
    meta_carboidrato_g: snapshot.meta_carboidrato_g ?? null,
    meta_lipidio_g: snapshot.meta_lipidio_g ?? null,
    refeicoes: refeicoes.length,
    alimentos,
    orientacoes: (snapshot.orientacao_ids || []).length,
    observacoes: snapshot.observacoes || "",
  };
}

function compareSnapshots(current = {}, previous = {}) {
  const labels = {
    titulo: "Título",
    meta_kcal: "Meta kcal",
    meta_proteina_g: "Proteína",
    meta_carboidrato_g: "Carboidratos",
    meta_lipidio_g: "Lipídios",
    refeicoes: "Refeições",
    alimentos: "Alimentos",
    orientacoes: "Orientações",
    observacoes: "Observações",
  };
  const changes = [];
  for (const key of Object.keys(labels)) {
    const a = current[key] ?? "";
    const b = previous[key] ?? "";
    if (String(a) !== String(b)) {
      changes.push({ field: labels[key], current: a || "—", previous: b || "—" });
    }
  }
  return changes;
}

function summarizeFoodItem(item = {}) {
  const nome = item.alimento_nome || item._nome || item.alimento_id || "Alimento";
  return `${nome} · ${item.quantidade_g ?? 0}g${item.medida_nome ? ` · ${item.medida_nome}` : ""}`;
}

function compareMealSnapshots(currentSnapshot = {}, previousSnapshot = {}) {
  const currentMeals = currentSnapshot.refeicoes || [];
  const previousMeals = previousSnapshot.refeicoes || [];
  const previousByMeal = new Map(previousMeals.map((meal) => [meal.nome || "", meal]));
  const diffs = [];

  for (const meal of currentMeals) {
    const prevMeal = previousByMeal.get(meal.nome || "") || { alimentos: [] };
    const currentFoods = meal.alimentos || [];
    const prevFoods = prevMeal.alimentos || [];
    const prevByFood = new Map(prevFoods.map((food) => [food.alimento_id || `${food.alimento_nome}-${food.medida_nome}`, food]));
    const currentByFood = new Map(currentFoods.map((food) => [food.alimento_id || `${food.alimento_nome}-${food.medida_nome}`, food]));

    const changes = [];
    for (const food of currentFoods) {
      const key = food.alimento_id || `${food.alimento_nome}-${food.medida_nome}`;
      const prevFood = prevByFood.get(key);
      if (!prevFood) {
        changes.push({ type: "added", label: summarizeFoodItem(food) });
        continue;
      }
      const gramsChanged = Number(food.quantidade_g || 0) !== Number(prevFood.quantidade_g || 0);
      const measureChanged = String(food.medida_nome || "") !== String(prevFood.medida_nome || "");
      if (gramsChanged || measureChanged) {
        changes.push({
          type: "changed",
          label: food.alimento_nome || food._nome || food.alimento_id,
          current: summarizeFoodItem(food),
          previous: summarizeFoodItem(prevFood),
        });
      }
    }
    for (const food of prevFoods) {
      const key = food.alimento_id || `${food.alimento_nome}-${food.medida_nome}`;
      if (!currentByFood.has(key)) {
        changes.push({ type: "removed", label: summarizeFoodItem(food) });
      }
    }
    if (changes.length > 0) {
      diffs.push({ meal: meal.nome || "Refeição", changes });
    }
  }

  for (const meal of previousMeals) {
    if (!currentMeals.find((current) => (current.nome || "") === (meal.nome || ""))) {
      diffs.push({
        meal: meal.nome || "Refeição",
        changes: [{ type: "removed_meal", label: `Refeição removida com ${(meal.alimentos || []).length} alimento(s)` }],
      });
    }
  }

  return diffs;
}

function PlanoManual({ d }) {
  const pid = d.patient.id;
  const [planos, setPlanos] = useState([]);
  const [sel, setSel] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [addTo, setAddTo] = useState(null); // refeição index
  const [eqOpen, setEqOpen] = useState(null);
  const [orientacoesCatalog, setOrientacoesCatalog] = useState([]);
  const [templates, setTemplates] = useState([]);

  const loadPlanos = async () => {
    try {
      const { data } = await api.get(`/patients/${pid}/planos-manuais`);
      setPlanos(data);
      if (data.length && !sel) setSel(data[0]);
    } catch {}
  };
  useEffect(() => {
    let active = true;
    api.get(`/patients/${pid}/planos-manuais`)
      .then(({ data }) => {
        if (!active) return;
        setPlanos(data);
        setSel((current) => current || data[0] || null);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [pid]);

  useEffect(() => {
    let active = true;
    api.get("/orientacoes")
      .then(({ data }) => {
        if (!active) return;
        setOrientacoesCatalog(data || []);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    api.get("/plano-templates")
      .then(({ data }) => {
        if (!active) return;
        setTemplates(data || []);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const newDraft = () => setDraft({
    titulo: "Plano Alimentar", objetivo: "", meta_kcal: "", meta_proteina_g: "", meta_carboidrato_g: "", meta_lipidio_g: "",
    orientacao_ids: [],
    refeicoes: REFEICOES_PADRAO.map(n => ({ nome: n, horario: "", meta_kcal: "", meta_pct: "", alimentos: [] })),
    observacoes: "",
  });

  const addFood = async (refIdx, alim) => {
    const operational = await loadFoodOperationalData(alim.id);
    const qtd = parseFloat(alim.porcao_padrao_g) || parseFloat(alim.quantidade_referencia_g) || 100;
    const measures = dedupeMeasures(operational.measures, alim.medida_caseira, qtd);
    const defaultMeasure = measures.find((item) => item.nome !== "Gramas")?.nome || "Gramas";
    const defaultQty = defaultMeasure === "Gramas"
      ? qtd
      : Math.max(1, Number((qtd / Number(measures.find((item) => item.nome === defaultMeasure)?.gramas || qtd)).toFixed(2)));
    setDraft(prev => {
      const refs = [...prev.refeicoes];
      refs[refIdx] = {
        ...refs[refIdx],
        alimentos: [...refs[refIdx].alimentos, {
          alimento_id: alim.id,
          medida_nome: defaultMeasure,
          quantidade: defaultMeasure === "Gramas" ? qtd : defaultQty,
          quantidade_g: defaultMeasure === "Gramas" ? qtd : gramsForMeasure(measures, defaultMeasure, defaultQty, qtd),
          _nome: alim.nome,
          _kcal100g: alim.energia_kcal_100g ?? null,
          _grupo: alim.grupo_display ?? alim.grupo ?? alim.categoria ?? null,
          _medidas: measures,
          _equivalentes: operational.equivalents || [],
        }],
      };
      return { ...prev, refeicoes: refs };
    });
  };

  const removeFood = (refIdx, fIdx) => {
    setDraft(prev => {
      const refs = [...prev.refeicoes];
      refs[refIdx] = { ...refs[refIdx], alimentos: refs[refIdx].alimentos.filter((_, i) => i !== fIdx) };
      return { ...prev, refeicoes: refs };
    });
  };

  const updateFoodQtd = (refIdx, fIdx, val) => {
    const v = Math.max(0, parseFloat(val) || 0);
    setDraft(prev => {
      const refs = [...prev.refeicoes];
      const alims = [...refs[refIdx].alimentos];
      const item = { ...alims[fIdx], quantidade: v };
      item.quantidade_g = gramsForMeasure(item._medidas, item.medida_nome, v, item.quantidade_g);
      alims[fIdx] = item;
      refs[refIdx] = { ...refs[refIdx], alimentos: alims };
      return { ...prev, refeicoes: refs };
    });
  };

  const updateFoodMeasure = (refIdx, fIdx, medidaNome) => {
    setDraft(prev => {
      const refs = [...prev.refeicoes];
      const alims = [...refs[refIdx].alimentos];
      const item = { ...alims[fIdx], medida_nome: medidaNome };
      const currentQty = Number(item.quantidade || item.quantidade_g || 0);
      item.quantidade_g = gramsForMeasure(item._medidas, medidaNome, currentQty, item.quantidade_g);
      alims[fIdx] = item;
      refs[refIdx] = { ...refs[refIdx], alimentos: alims };
      return { ...prev, refeicoes: refs };
    });
  };

  const applyEquivalent = async (refIdx, fIdx, eq) => {
    if (!eq?.alimento_id) {
      toast.error("Equivalente sem mapeamento para alimento do banco.");
      return;
    }
    const operational = await loadFoodOperationalData(eq.alimento_id);
    const measures = dedupeMeasures(operational.measures, eq.medida_nome, eq.quantidade);
    setDraft(prev => {
      const refs = [...prev.refeicoes];
      const alims = [...refs[refIdx].alimentos];
      const grams = gramsForMeasure(measures, eq.medida_nome || "Gramas", Number(eq.quantidade || 0), Number(eq.quantidade || 0));
      alims[fIdx] = {
        ...alims[fIdx],
        alimento_id: eq.alimento_id,
        medida_nome: eq.medida_nome || "Gramas",
        quantidade: Number(eq.quantidade || 0),
        quantidade_g: grams,
        _nome: eq.nome,
        _kcal100g: eq.energia_kcal_100g ?? null,
        _grupo: eq.grupo || null,
        _medidas: measures,
        _equivalentes: operational.equivalents || [],
      };
      refs[refIdx] = { ...refs[refIdx], alimentos: alims };
      return { ...prev, refeicoes: refs };
    });
    setEqOpen(null);
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = sanitizePlanoDraft(draft);
      let saved;
      if (editMode && sel?.id) {
        const { data } = await api.put(`/patients/${pid}/planos-manuais/${sel.id}`, payload);
        saved = data;
      } else {
        const { data } = await api.post(`/patients/${pid}/planos-manuais`, payload);
        saved = data;
      }
      toast.success("Plano salvo!");
      setDraft(null); setEditMode(false);
      await loadPlanos();
      setSel(saved);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Erro ao salvar plano");
    } finally { setSaving(false); }
  };

  const deletePlano = async (pmid) => {
    if (!window.confirm("Excluir este plano?")) return;
    await api.delete(`/patients/${pid}/planos-manuais/${pmid}`);
    toast.success("Plano excluído");
    setSel(null); await loadPlanos();
  };

  const duplicatePlano = async (pmid) => {
    try {
      const { data } = await api.post(`/patients/${pid}/planos-manuais/${pmid}/duplicar`);
      toast.success("Plano duplicado");
      await loadPlanos();
      setSel(data);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Erro ao duplicar plano");
    }
  };

  const saveAsTemplate = async (pmid, titulo) => {
    const nome = window.prompt("Nome do template", `${titulo || "Plano"} - template`);
    if (!nome) return;
    try {
      const { data } = await api.post(`/patients/${pid}/planos-manuais/${pmid}/template`, { nome });
      toast.success("Template salvo");
      setTemplates((prev) => [data, ...prev.filter((item) => item.id !== data.id)]);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Erro ao salvar template");
    }
  };

  const applyTemplate = async (templateId) => {
    try {
      const { data } = await api.post(`/patients/${pid}/plano-templates/${templateId}/aplicar`);
      toast.success("Template aplicado ao paciente");
      await loadPlanos();
      setSel(data);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Erro ao aplicar template");
    }
  };

  const downloadPdf = async (pmid, nome) => {
    try {
      const r = await api.get(`/patients/${pid}/relatorios/plano-alimentar/${pmid}`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([r.data], { type: "application/pdf" }));
      const a = document.createElement("a"); a.href = url; a.download = `plano-${(nome||"").replace(/\s+/g,"-")}.pdf`;
      document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url);
    } catch { toast.error("Erro ao gerar PDF"); }
  };

  const hydrateDraftFromPlano = async (plano) => {
    const cache = new Map();
    const hydrateItem = async (item) => {
      const key = item.alimento_id;
      if (!cache.has(key)) cache.set(key, loadFoodOperationalData(key));
      const operational = await cache.get(key);
      const measures = dedupeMeasures(
        operational.measures,
        item.medida_nome,
        item.quantidade && item.quantidade_g ? Number(item.quantidade_g) / Number(item.quantidade) : item.quantidade_g
      );
      return {
        ...item,
        quantidade: item.quantidade ?? item.quantidade_g,
        medida_nome: item.medida_nome || "Gramas",
        _nome: item.alimento_nome || item.alimento_id,
        _kcal100g: item.quantidade_g ? Math.round((Number(item.nutrientes?.energia_kcal || 0) / Number(item.quantidade_g)) * 100) : null,
        _grupo: item.grupo || null,
        _medidas: measures,
        _equivalentes: operational.equivalents || [],
      };
    };
    const refs = [];
    for (const ref of (plano.refeicoes || [])) {
      const foods = [];
      for (const item of (ref.alimentos || [])) foods.push(await hydrateItem(item));
      refs.push({
        ...ref,
        meta_kcal: ref.meta_kcal || "",
        meta_pct: ref.meta_pct || "",
        alimentos: foods,
      });
    }
    return {
      ...plano,
      refeicoes: refs,
      meta_kcal: plano.meta_kcal || "",
      meta_proteina_g: plano.meta_proteina_g || "",
      meta_carboidrato_g: plano.meta_carboidrato_g || "",
      meta_lipidio_g: plano.meta_lipidio_g || "",
      orientacao_ids: plano.orientacao_ids || [],
      observacoes: plano.observacoes || "",
    };
  };

  // — EDIT MODE —
  if (draft !== null) {
    return (
      <>
        {addTo !== null && (
          <FoodSearchModal
            refNome={draft.refeicoes[addTo]?.nome ?? "Refeição"}
            onSelect={f => addFood(addTo, f)}
            onClose={() => setAddTo(null)}
          />
        )}
        <div className="space-y-5 pb-10">
          {/* Header */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="text-base font-bold text-white">{editMode ? "Editando plano" : "Novo plano"}</h3>
              <p className="text-xs text-gray-500 mt-0.5">Preencha as metas e monte as refeições</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setDraft(null); setEditMode(false); }} className="evo-btn-ghost text-xs">Cancelar</button>
              <button onClick={save} disabled={saving} className="evo-btn-primary text-xs px-5 py-2">
                {saving ? "Salvando..." : "Salvar Plano"}
              </button>
            </div>
          </div>

          {/* Meta fields */}
          <div className="evo-card p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-3">Informações do plano</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="col-span-2 sm:col-span-3">
                <label className="evo-label">Título</label>
                <input className="evo-input" value={draft.titulo} onChange={e => setDraft(p=>({...p,titulo:e.target.value}))} />
              </div>
              <div>
                <label className="evo-label">Meta kcal/dia</label>
                <input type="number" className="evo-input" placeholder="ex: 2000" value={draft.meta_kcal} onChange={e => setDraft(p=>({...p,meta_kcal:e.target.value}))} />
              </div>
              <div>
                <label className="evo-label">Proteína (g)</label>
                <input type="number" className="evo-input" placeholder="ex: 150" value={draft.meta_proteina_g} onChange={e => setDraft(p=>({...p,meta_proteina_g:e.target.value}))} />
              </div>
              <div>
                <label className="evo-label">Carboidratos (g)</label>
                <input type="number" className="evo-input" placeholder="ex: 250" value={draft.meta_carboidrato_g} onChange={e => setDraft(p=>({...p,meta_carboidrato_g:e.target.value}))} />
              </div>
              <div>
                <label className="evo-label">Lipídios (g)</label>
                <input type="number" className="evo-input" placeholder="ex: 70" value={draft.meta_lipidio_g} onChange={e => setDraft(p=>({...p,meta_lipidio_g:e.target.value}))} />
              </div>
              <div className="col-span-2">
                <label className="evo-label">Observações / Objetivo</label>
                <input className="evo-input" value={draft.observacoes} onChange={e => setDraft(p=>({...p,observacoes:e.target.value}))} />
              </div>
            </div>
          </div>

          <div className="evo-card p-4">
            <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Orientações vinculadas</p>
                <p className="text-xs text-gray-500 mt-1">Selecione as orientações que devem acompanhar este plano.</p>
              </div>
              <a href="/orientacoes" className="evo-btn-secondary text-xs px-3 py-1.5">Abrir biblioteca</a>
            </div>
            {orientacoesCatalog.length === 0 ? (
              <p className="text-sm text-gray-500">Nenhuma orientação cadastrada.</p>
            ) : (
              <div className="grid gap-2">
                {orientacoesCatalog.map((item) => {
                  const selected = (draft.orientacao_ids || []).includes(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setDraft((prev) => ({
                        ...prev,
                        orientacao_ids: selected
                          ? (prev.orientacao_ids || []).filter((id) => id !== item.id)
                          : [...(prev.orientacao_ids || []), item.id],
                      }))}
                      className={`w-full text-left rounded-xl border px-3 py-3 transition-all ${selected ? "border-[#0081FD]/40 bg-[#0081FD]/[0.08]" : "border-white/[0.08] bg-white/[0.02] hover:border-white/[0.14]"}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-white truncate">{item.titulo}</div>
                          <div className="text-[11px] text-gray-500 mt-1">
                            {item.categoria || "Sem categoria"}
                            {!!item.objetivos?.length && ` · ${item.objetivos.join(", ")}`}
                          </div>
                        </div>
                        <span className={`text-[10px] uppercase tracking-widest font-bold ${selected ? "text-[#3DA0FF]" : "text-gray-600"}`}>
                          {selected ? "Incluída" : "Selecionar"}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mt-2 whitespace-pre-wrap line-clamp-2">{item.conteudo}</p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Refeições */}
          {draft.refeicoes.map((ref, ri) => {
            const kcalRef = ref.alimentos.reduce((s, a) => s + (a._kcal100g ? Math.round((a._kcal100g / 100) * a.quantidade_g) : 0), 0);
            return (
              <div key={ri} className="evo-card overflow-hidden">
                {/* Meal header */}
                <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-[#0081FD]/[0.07] to-transparent border-b border-white/[0.06]">
                  <div className="w-7 h-7 rounded-lg bg-[#0081FD]/15 border border-[#0081FD]/20 flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-[#3DA0FF]">{ri + 1}</span>
                  </div>
                  <input
                    className="flex-1 bg-transparent text-white font-bold text-sm focus:outline-none min-w-0 placeholder-gray-600"
                    value={ref.nome}
                    placeholder="Nome da refeição"
                    onChange={e => setDraft(p => { const rs=[...p.refeicoes]; rs[ri]={...rs[ri],nome:e.target.value}; return {...p,refeicoes:rs}; })}
                  />
                  <input
                    className="w-20 bg-white/[0.05] border border-white/[0.06] rounded-lg px-2 py-1 text-xs text-gray-400 focus:outline-none focus:border-[#0081FD]/30 text-center shrink-0"
                    placeholder="00:00"
                    value={ref.horario}
                    onChange={e => setDraft(p => { const rs=[...p.refeicoes]; rs[ri]={...rs[ri],horario:e.target.value}; return {...p,refeicoes:rs}; })}
                  />
                  <input
                    className="w-24 bg-white/[0.05] border border-white/[0.06] rounded-lg px-2 py-1 text-xs text-gray-400 focus:outline-none focus:border-[#0081FD]/30 text-center shrink-0"
                    placeholder="Meta kcal"
                    value={ref.meta_kcal || ""}
                    onChange={e => setDraft(p => { const rs=[...p.refeicoes]; rs[ri]={...rs[ri],meta_kcal:e.target.value}; return {...p,refeicoes:rs}; })}
                  />
                  {kcalRef > 0 && (
                    <span className="text-xs text-gray-500 shrink-0 tabular-nums hidden sm:block">{kcalRef}&nbsp;kcal</span>
                  )}
                </div>

                {/* Food items */}
                <div className="px-3 pt-2 pb-1 space-y-0.5">
                  {ref.alimentos.length === 0 && (
                    <p className="text-xs text-gray-700 py-3 text-center">Nenhum alimento adicionado</p>
                  )}
                  {ref.alimentos.map((a, fi) => {
                    const kcalItem = a._kcal100g ? Math.round((a._kcal100g / 100) * a.quantidade_g) : null;
                    return (
                      <React.Fragment key={fi}>
                        <div className="flex items-center gap-2 py-2 px-2 rounded-xl hover:bg-white/[0.03] group/item transition-colors">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-200 leading-tight truncate">{a._nome || a.alimento_id}</p>
                            {a._grupo && <p className="text-[10px] text-gray-600 mt-0.5">{a._grupo}</p>}
                          </div>
                          {kcalItem != null && (
                            <span className="text-[11px] text-gray-600 tabular-nums shrink-0 hidden sm:block">{kcalItem}&nbsp;kcal</span>
                          )}
                          <div className="flex items-center gap-2 shrink-0">
                            <select
                              value={a.medida_nome || "Gramas"}
                              onChange={e => updateFoodMeasure(ri, fi, e.target.value)}
                              className="bg-white/[0.05] border border-white/[0.08] rounded-lg px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-[#0081FD]/40"
                            >
                              {(a._medidas || [{ nome: "Gramas", gramas: 1 }]).map((m) => (
                                <option key={m.nome} value={m.nome}>{m.nome}</option>
                              ))}
                            </select>
                            <button
                              onClick={() => updateFoodQtd(ri, fi, Math.max(0, Number(a.quantidade || 0) - 1))}
                              className="w-6 h-6 rounded-md bg-white/[0.05] hover:bg-white/[0.1] flex items-center justify-center text-gray-500 hover:text-white transition-colors"
                            ><Minus className="w-3 h-3" /></button>
                            <input
                              type="number"
                              value={a.quantidade ?? a.quantidade_g}
                              onChange={e => updateFoodQtd(ri, fi, e.target.value)}
                              className="w-14 bg-white/[0.05] border border-white/[0.08] rounded-lg px-1 py-1 text-center text-sm text-white focus:outline-none focus:border-[#0081FD]/40 tabular-nums"
                            />
                            <button
                              onClick={() => updateFoodQtd(ri, fi, Number(a.quantidade || 0) + 1)}
                              className="w-6 h-6 rounded-md bg-white/[0.05] hover:bg-white/[0.1] flex items-center justify-center text-gray-500 hover:text-white transition-colors"
                            ><Plus className="w-3 h-3" /></button>
                            <div className="text-[11px] text-gray-600 min-w-[56px] text-right">{a.quantidade_g}g</div>
                          </div>
                          {!!(a._equivalentes || []).length && (
                            <button
                              onClick={() => setEqOpen(eqOpen === `${ri}-${fi}` ? null : `${ri}-${fi}`)}
                              className="text-[11px] text-[#3DA0FF] hover:text-white transition-colors shrink-0"
                            >
                              Eq.
                            </button>
                          )}
                          <button
                            onClick={() => removeFood(ri, fi)}
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-700 hover:text-red-400 hover:bg-red-500/10 transition-all opacity-0 group-hover/item:opacity-100 shrink-0"
                          ><X className="w-3.5 h-3.5" /></button>
                        </div>
                        {eqOpen === `${ri}-${fi}` && (a._equivalentes || []).length > 0 && (
                          <div className="ml-2 mb-2 mr-2 rounded-lg border border-[#0081FD]/20 bg-[#0081FD]/[0.05] p-2">
                            <div className="text-[10px] uppercase tracking-widest text-[#3DA0FF] font-bold mb-2">Equivalentes</div>
                            <div className="space-y-1.5">
                              {(a._equivalentes || []).map((eq, eqIdx) => (
                                <button
                                  key={`${eq.nome}-${eqIdx}`}
                                  onClick={() => applyEquivalent(ri, fi, eq)}
                                  className="w-full text-left rounded-md px-2 py-1.5 hover:bg-white/[0.05] transition-colors"
                                >
                                  <div className="text-xs text-white">{eq.nome}</div>
                                  <div className="text-[10px] text-gray-500">
                                    {(eq.medida_nome || "Gramas")} {eq.quantidade ? `· ${eq.quantidade}` : ""}
                                    {eq.grupo ? ` · ${eq.grupo}` : ""}
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>

                {/* Add food button */}
                <div className="px-3 pb-3 pt-2">
                  <button
                    onClick={() => setAddTo(ri)}
                    className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-dashed border-white/[0.1] text-xs text-gray-600 hover:border-[#0081FD]/40 hover:text-[#3DA0FF] hover:bg-[#0081FD]/[0.04] transition-all duration-200"
                  >
                    <Plus className="w-3.5 h-3.5" /> Adicionar alimento
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </>
    );
  }

  // — LIST MODE —
  return (
    <div className="grid lg:grid-cols-5 gap-5">
      <div className="lg:col-span-2 space-y-4">
        <button onClick={newDraft} className="evo-btn-primary w-full">
          <Plus className="w-4 h-4" /> Novo Plano
        </button>
        <div className="evo-card p-4">
          <h3 className="text-sm font-bold text-white mb-3">Planos salvos</h3>
          {planos.length === 0 ? (
            <p className="text-sm text-gray-600 text-center py-6">Nenhum plano criado.</p>
          ) : (
            <div className="space-y-2">
              {planos.map(p => (
                <button key={p.id} onClick={() => setSel(p)}
                  className={`w-full text-left p-3 rounded-xl border transition-all ${sel?.id===p.id ? "border-[#0081FD]/40 bg-[#0081FD]/[0.07]" : "border-white/[0.06] hover:border-white/[0.14] bg-white/[0.02] hover:bg-white/[0.04]"}`}
                >
                  <div className="font-bold text-sm truncate">{p.titulo}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">{p.criado_em ? new Date(p.criado_em).toLocaleDateString("pt-BR") : "—"}</div>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="evo-card p-4">
          <h3 className="text-sm font-bold text-white mb-3">Templates</h3>
          {templates.length === 0 ? (
            <p className="text-sm text-gray-600 text-center py-4">Nenhum template salvo.</p>
          ) : (
            <div className="space-y-2">
              {templates.slice(0, 8).map((template) => (
                <div key={template.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                  <div className="font-bold text-sm truncate text-white">{template.nome}</div>
                  <div className="text-[11px] text-gray-500 mt-1">
                    {template.categoria || "Sem categoria"} · {(template.refeicoes || []).length} refeições
                  </div>
                  <button onClick={() => applyTemplate(template.id)} className="evo-btn-secondary text-xs px-3 py-1.5 mt-3 w-full">
                    Aplicar neste paciente
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="lg:col-span-3">
        {!sel ? (
          <div className="evo-card p-14 flex flex-col items-center gap-3 text-gray-600">
            <Utensils className="w-8 h-8 opacity-25" />
            <p className="text-sm">Selecione ou crie um plano.</p>
          </div>
        ) : (
          <PlanoDetail plano={sel}
            onEdit={async () => { setDraft(await hydrateDraftFromPlano(sel)); setEditMode(true); }}
            onDelete={() => deletePlano(sel.id)}
            onPdf={() => downloadPdf(sel.id, sel.titulo)}
            onDuplicate={() => duplicatePlano(sel.id)}
            onSaveTemplate={() => saveAsTemplate(sel.id, sel.titulo)}
          />
        )}
      </div>
    </div>
  );
}

function PlanoDetail({ plano, onEdit, onDelete, onPdf, onDuplicate, onSaveTemplate }) {
  const t = plano.totais_dia || {};
  const saldo = plano.saldos_dia || {};
  const [history, setHistory] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const { data } = await api.get(`/patients/${plano.paciente_id}/planos-manuais/${plano.id}/historico`);
      setHistory(data || []);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Erro ao carregar histórico");
    } finally {
      setHistoryLoading(false);
    }
  };

  const toggleHistory = async () => {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next && history.length === 0 && !historyLoading) await loadHistory();
  };

  return (
    <div className="evo-card p-5 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-bold text-base text-white">{plano.titulo}</h3>
          {plano.objetivo && <p className="text-xs text-gray-500 mt-0.5">{plano.objetivo}</p>}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {plano.versao != null && <span className="text-[11px] px-2 py-1 rounded-full border border-white/[0.08] text-gray-400">Versão {plano.versao}</span>}
            {plano.origem_plano_id && <span className="text-[11px] px-2 py-1 rounded-full border border-[#0081FD]/20 text-[#3DA0FF]">Duplicado</span>}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={onPdf} className="evo-btn-secondary text-xs px-3 py-1.5"><Download className="w-3.5 h-3.5" /> PDF</button>
          <button onClick={toggleHistory} className="evo-btn-secondary text-xs px-3 py-1.5">{historyOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />} Histórico</button>
          <button onClick={onSaveTemplate} className="evo-btn-secondary text-xs px-3 py-1.5"><Save className="w-3.5 h-3.5" /> Salvar template</button>
          <button onClick={onDuplicate} className="evo-btn-secondary text-xs px-3 py-1.5"><Plus className="w-3.5 h-3.5" /> Duplicar</button>
          <button onClick={onEdit} className="evo-btn-secondary text-xs px-3 py-1.5"><Edit2 className="w-3.5 h-3.5" /> Editar</button>
          <button onClick={onDelete} className="evo-btn-ghost text-xs text-red-400 hover:text-red-300 px-2"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      {historyOpen && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Histórico do plano</div>
            {historyLoading && <div className="text-xs text-gray-500">Carregando...</div>}
          </div>
          {!historyLoading && history.length === 0 && (
            <p className="text-sm text-gray-500">Nenhum snapshot disponível.</p>
          )}
          {!historyLoading && history.length > 0 && (
            <div className="space-y-3">
              {history.map((row, idx) => {
                const current = summarizeSnapshot(row.snapshot || {});
                const previous = summarizeSnapshot(history[idx + 1]?.snapshot || {});
                const changes = idx < history.length - 1 ? compareSnapshots(current, previous) : [];
                const mealDiffs = idx < history.length - 1 ? compareMealSnapshots(row.snapshot || {}, history[idx + 1]?.snapshot || {}) : [];
                return (
                  <div key={row.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <div className="text-sm font-semibold text-white">{current.titulo}</div>
                        <div className="text-[11px] text-gray-500 mt-1">
                          {row.motivo || "snapshot"} · {row.criado_em ? new Date(row.criado_em).toLocaleString("pt-BR") : "—"}
                        </div>
                      </div>
                      <div className="text-[11px] text-gray-500">
                        {current.refeicoes} refeições · {current.alimentos} alimentos · {current.orientacoes} orientações
                      </div>
                    </div>
                    {changes.length > 0 ? (
                      <div className="mt-3 grid gap-2">
                        {changes.map((change, changeIdx) => (
                          <div key={`${row.id}-${change.field}-${changeIdx}`} className="rounded-lg border border-white/[0.05] bg-black/10 px-3 py-2">
                            <div className="text-[11px] uppercase tracking-wider text-gray-500">{change.field}</div>
                            <div className="text-xs text-white mt-1">Atual: {change.current}</div>
                            <div className="text-xs text-gray-500 mt-1">Anterior: {change.previous}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-500 mt-3">Snapshot base deste plano.</p>
                    )}
                    {mealDiffs.length > 0 && (
                      <div className="mt-3 space-y-2">
                        <div className="text-[11px] uppercase tracking-wider text-gray-500">Mudanças por refeição</div>
                        {mealDiffs.map((mealDiff, mealIdx) => (
                          <div key={`${row.id}-meal-${mealIdx}`} className="rounded-lg border border-white/[0.05] bg-black/10 px-3 py-2">
                            <div className="text-xs font-semibold text-white">{mealDiff.meal}</div>
                            <div className="mt-2 space-y-1.5">
                              {mealDiff.changes.map((change, changeIdx) => (
                                <div key={`${row.id}-meal-${mealIdx}-change-${changeIdx}`} className="text-xs">
                                  <span className={`font-semibold ${change.type === "added" ? "text-emerald-400" : change.type === "removed" || change.type === "removed_meal" ? "text-red-400" : "text-amber-300"}`}>
                                    {change.type === "added" ? "Incluído" : change.type === "removed" ? "Removido" : change.type === "removed_meal" ? "Refeição removida" : "Alterado"}
                                  </span>
                                  <span className="text-gray-300"> · {change.label}</span>
                                  {change.current && <div className="text-gray-400 mt-1">Atual: {change.current}</div>}
                                  {change.previous && <div className="text-gray-500 mt-1">Anterior: {change.previous}</div>}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Macro summary */}
      {(t.energia_kcal || plano.meta_kcal) && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          <MacroPill label="Energia" value={t.energia_kcal ?? "—"} unit="kcal" accent="blue" colSpan2 />
          <MacroPill label="Proteína" value={t.proteinas_g ?? t.proteina_g ?? "—"} unit="g" accent="green" />
          <MacroPill label="Carbo" value={t.carboidratos_g ?? t.carboidrato_g ?? "—"} unit="g" accent="amber" />
          <MacroPill label="Lipídios" value={t.lipidios_g ?? t.lipideos_g ?? "—"} unit="g" accent="orange" />
          <MacroPill label="Fibras" value={t.fibras_g ?? t.fibra_g ?? "—"} unit="g" accent="purple" />
          <MacroPill label="Sódio" value={t.sodio_mg ?? "—"} unit="mg" accent="slate" />
        </div>
      )}
      {(saldo.energia_kcal != null || saldo.proteinas_g != null || saldo.carboidratos_g != null || saldo.lipidios_g != null) && (
        <div className="grid sm:grid-cols-4 gap-2">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-gray-400">Saldo kcal: <span className="text-white font-semibold">{saldo.energia_kcal ?? "—"}</span></div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-gray-400">Saldo PTN: <span className="text-white font-semibold">{saldo.proteinas_g ?? "—"}</span></div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-gray-400">Saldo CHO: <span className="text-white font-semibold">{saldo.carboidratos_g ?? "—"}</span></div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-gray-400">Saldo LIP: <span className="text-white font-semibold">{saldo.lipidios_g ?? "—"}</span></div>
        </div>
      )}

      {!!plano.orientacoes?.length && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
          <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Orientações anexadas</div>
          {plano.orientacoes.map((item) => (
            <div key={item.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-sm font-semibold text-white">{item.titulo}</div>
                <div className="text-[11px] text-gray-500">{item.categoria || "Sem categoria"}</div>
              </div>
              {!!item.objetivos?.length && <div className="text-[11px] text-gray-500 mt-1">Objetivos: {item.objetivos.join(", ")}</div>}
              <p className="text-xs text-gray-400 mt-2 whitespace-pre-wrap">{item.conteudo}</p>
            </div>
          ))}
        </div>
      )}

      {/* Meals */}
      <div className="space-y-3">
        {(plano.refeicoes || []).map((ref, ri) => (
          <div key={ri} className="border border-white/[0.06] rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 bg-white/[0.025] border-b border-white/[0.04]">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-md bg-[#0081FD]/15 border border-[#0081FD]/20 flex items-center justify-center text-[10px] font-bold text-[#3DA0FF]">{ri+1}</span>
                <span className="font-bold text-sm">{ref.nome}</span>
                {ref.horario && <span className="text-xs text-gray-600">· {ref.horario}</span>}
              </div>
              <div className="text-right">
                <span className="text-xs text-gray-600 tabular-nums block">{ref.totais?.energia_kcal ?? 0} kcal</span>
                {ref.meta_kcal ? <span className="text-[10px] text-gray-500">meta {ref.meta_kcal} · saldo {ref.saldo_kcal ?? "—"}</span> : null}
              </div>
            </div>
            {(ref.alimentos || []).length > 0 ? (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-600 border-b border-white/[0.04] bg-white/[0.01]">
                    <th className="text-left px-4 py-2 font-medium">Alimento</th>
                    <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Qtd</th>
                    <th className="px-3 py-2 font-medium text-right whitespace-nowrap">kcal</th>
                    <th className="px-3 py-2 font-medium text-right whitespace-nowrap hidden sm:table-cell">PTN</th>
                    <th className="px-3 py-2 font-medium text-right whitespace-nowrap hidden sm:table-cell">CHO</th>
                    <th className="px-3 py-2 font-medium text-right whitespace-nowrap hidden sm:table-cell">LIP</th>
                  </tr>
                </thead>
                <tbody>
                  {(ref.alimentos || []).map((a, ai) => (
                    <tr key={ai} className="border-b border-white/[0.02] hover:bg-white/[0.025] transition-colors">
                      <td className="px-4 py-2.5 text-gray-200 max-w-[160px] sm:max-w-none truncate">
                        {a.alimento_nome || a._nome || a.alimento_id}
                        {a.medida_nome && (
                          <div className="text-[10px] text-gray-600 mt-0.5">
                            {a.quantidade ?? "—"} {a.medida_nome}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right text-gray-500 tabular-nums whitespace-nowrap">{a.quantidade_g}g</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-medium">{a.nutrientes?.energia_kcal != null ? Math.round(a.nutrientes.energia_kcal) : "—"}</td>
                      <td className="px-3 py-2.5 text-right text-gray-500 tabular-nums hidden sm:table-cell">{a.nutrientes?.proteinas_g ?? a.nutrientes?.proteina_g ?? "—"}</td>
                      <td className="px-3 py-2.5 text-right text-gray-500 tabular-nums hidden sm:table-cell">{a.nutrientes?.carboidratos_g ?? a.nutrientes?.carboidrato_g ?? "—"}</td>
                      <td className="px-3 py-2.5 text-right text-gray-500 tabular-nums hidden sm:table-cell">{a.nutrientes?.lipidios_g ?? a.nutrientes?.lipideos_g ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-xs text-gray-700 px-4 py-4 text-center">Sem alimentos nesta refeição.</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function MacroPill({ label, value, unit, accent, colSpan2 }) {
  const styles = {
    blue:   "text-[#3DA0FF]  bg-[#0081FD]/[0.09]  border-[#0081FD]/[0.18]",
    green:  "text-emerald-400 bg-emerald-500/[0.09] border-emerald-500/[0.18]",
    amber:  "text-amber-400  bg-amber-500/[0.09]  border-amber-500/[0.18]",
    orange: "text-orange-400 bg-orange-500/[0.09] border-orange-500/[0.18]",
    purple: "text-purple-400 bg-purple-500/[0.09] border-purple-500/[0.18]",
    slate:  "text-gray-400  bg-white/[0.04]      border-white/[0.08]",
  };
  return (
    <div className={`rounded-xl border p-3 text-center ${styles[accent] ?? styles.slate} ${colSpan2 ? "col-span-3 sm:col-span-2" : ""}`}>
      <div className="text-[9px] uppercase tracking-widest font-bold opacity-50 mb-1">{label}</div>
      <div className="font-bold text-sm sm:text-base tabular-nums leading-none">{value}</div>
      <div className="text-[9px] opacity-40 mt-1">{unit}</div>
    </div>
  );
}

// ── Gasto Energético ─────────────────────────────────────────────

const PROTOCOLOS_TMB = [
  ["mifflin_st_jeor","Mifflin St Jeor"],
  ["harris_benedict_1984","Harris-Benedict (1984)"],
  ["harris_benedict_1919","Harris-Benedict (1919)"],
  ["fao_who_1985","FAO/WHO (1985)"],
  ["fao_who_2004","FAO/WHO (2004)"],
  ["cunningham","Cunningham (requer MLG)"],
  ["tinsley_peso","Tinsley (por Peso)"],
  ["tinsley_mlg","Tinsley (por MLG)"],
];

function GastoEnergetico({ d }) {
  const p = d.patient;
  const lastEval = (d.evaluations || [])[0];
  const comp = lastEval?.composicao || {};
  const bio = comp.bioimpedancia || {};

  const [form, setForm] = useState({
    protocolo: "mifflin_st_jeor",
    peso: p.peso || lastEval?.peso || "",
    altura_cm: p.altura || lastEval?.altura || "",
    idade: 30,
    sexo_num: p.sexo === "M" ? 1 : 2,
    mlg_kg: comp.massa_magra || "",
    naf_codigo: 2,
    naf_manual: "",
    fi_codigo: "",
    fi_manual: "",
    usar_mets: false,
  });
  const set = (k, v) => setForm(s => ({ ...s, [k]: v }));
  const [atividadesMets, setAtividadesMets] = useState([{ nome: "Treino", met: "6", duracao_min: "60" }]);

  const [nafOpts, setNafOpts] = useState([]);
  const [fiOpts, setFiOpts] = useState([]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  // Venta
  const [venta, setVenta] = useState({ peso_desejado: "", prazo_dias: 30 });
  const [ventaResult, setVentaResult] = useState(null);

  useEffect(() => {
    api.get(`/referencias/naf?protocolo=${form.protocolo}&sexo=${form.sexo_num}`)
      .then(r => setNafOpts(r.data)).catch(() => {});
    api.get("/referencias/fatores-injuria")
      .then(r => setFiOpts(r.data)).catch(() => {});
  }, [form.protocolo, form.sexo_num]);

  const calcular = async () => {
    setLoading(true);
    try {
      const tmbRes = await api.post("/calculos/tmb", {
        protocolo: form.protocolo,
        peso: parseFloat(form.peso),
        altura_cm: parseFloat(form.altura_cm),
        idade: parseInt(form.idade),
        sexo_num: parseInt(form.sexo_num),
        mlg_kg: form.mlg_kg ? parseFloat(form.mlg_kg) : null,
      });
      const tmb = tmbRes.data.tmb;

      const getRes = await api.post("/calculos/get", {
        tmb,
        naf_codigo: form.naf_manual ? null : parseInt(form.naf_codigo),
        naf_manual: form.naf_manual ? parseFloat(form.naf_manual) : null,
        fi_codigo: form.fi_codigo ? parseInt(form.fi_codigo) : null,
        fi_manual: form.fi_manual ? parseFloat(form.fi_manual) : null,
        protocolo_tmb: form.protocolo,
        sexo_num: parseInt(form.sexo_num),
        peso_kg: parseFloat(form.peso),
        usar_mets: !!form.usar_mets,
        atividades_mets: form.usar_mets
          ? atividadesMets
              .filter(a => a.nome && a.met && a.duracao_min)
              .map(a => ({ nome: a.nome, met: parseFloat(a.met), duracao_min: parseInt(a.duracao_min) }))
          : [],
      });
      setResult({ ...tmbRes.data, ...getRes.data });
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally { setLoading(false); }
  };

  const calcVenta = async () => {
    if (!venta.peso_desejado || !form.peso) return;
    try {
      const r = await api.post("/calculos/venta", {
        peso_atual: parseFloat(form.peso),
        peso_desejado: parseFloat(venta.peso_desejado),
        prazo_dias: parseInt(venta.prazo_dias),
      });
      setVentaResult(r.data);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  return (
    <div className="grid lg:grid-cols-2 gap-5">
      <div className="space-y-4">
        <div className="evo-card p-5">
          <h3 className="evo-h3 mb-4">Cálculo de TMB / GET</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="evo-label">Protocolo TMB</label>
              <select className="evo-input" value={form.protocolo} onChange={e => set("protocolo", e.target.value)}>
                {PROTOCOLOS_TMB.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <Inp l="Peso (kg)" v={form.peso} onChange={v => set("peso", v)} t="number" />
            <Inp l="Altura (cm)" v={form.altura_cm} onChange={v => set("altura_cm", v)} t="number" />
            <Inp l="Idade" v={form.idade} onChange={v => set("idade", v)} t="number" />
            <div>
              <label className="evo-label">Sexo</label>
              <select className="evo-input" value={form.sexo_num} onChange={e => set("sexo_num", e.target.value)}>
                <option value={1}>Masculino</option>
                <option value={2}>Feminino</option>
              </select>
            </div>
            {(form.protocolo === "cunningham" || form.protocolo === "tinsley_mlg") && (
              <div className="col-span-2">
                <Inp l="MLG — Massa Livre de Gordura (kg)" v={form.mlg_kg} onChange={v => set("mlg_kg", v)} t="number" />
              </div>
            )}
          </div>

          <div className="mt-4 space-y-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={!!form.usar_mets} onChange={(e) => set("usar_mets", e.target.checked)} className="w-4 h-4" />
              Calcular GET por METs
            </label>
            <div>
              <label className="evo-label">NAF — Nível de Atividade Física</label>
              <select className="evo-input" value={form.naf_codigo} onChange={e => set("naf_codigo", e.target.value)}>
                {nafOpts.map(o => <option key={o.codigo} value={o.codigo}>{o.codigo} — {o.descricao} (NAF {o.naf})</option>)}
              </select>
            </div>
            <Inp l="NAF manual (sobrescreve a tabela)" v={form.naf_manual} onChange={v => set("naf_manual", v)} t="number" />
            <div>
              <label className="evo-label">Fator de Injúria (opcional)</label>
              <select className="evo-input" value={form.fi_codigo} onChange={e => set("fi_codigo", e.target.value)}>
                <option value="">Sem fator de injúria</option>
                {fiOpts.map(o => <option key={o.codigo} value={o.codigo}>{o.descricao} (FI {o.fator})</option>)}
              </select>
            </div>
            <Inp l="FI manual (sobrescreve a tabela)" v={form.fi_manual} onChange={v => set("fi_manual", v)} t="number" />
            {form.usar_mets && (
              <div className="rounded-lg border border-white/[0.06] bg-evo-bg p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">Atividades por MET</div>
                  <button onClick={() => setAtividadesMets(prev => [...prev, { nome: "", met: "", duracao_min: "" }])} className="text-xs text-evo-purple">Adicionar</button>
                </div>
                {atividadesMets.map((atividade, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-5"><Inp l="Atividade" v={atividade.nome} onChange={v => setAtividadesMets(prev => prev.map((a, i) => i === idx ? { ...a, nome: v } : a))} /></div>
                    <div className="col-span-3"><Inp l="MET" v={atividade.met} onChange={v => setAtividadesMets(prev => prev.map((a, i) => i === idx ? { ...a, met: v } : a))} t="number" /></div>
                    <div className="col-span-3"><Inp l="Min" v={atividade.duracao_min} onChange={v => setAtividadesMets(prev => prev.map((a, i) => i === idx ? { ...a, duracao_min: v } : a))} t="number" /></div>
                    <div className="col-span-1">
                      <button onClick={() => setAtividadesMets(prev => prev.length === 1 ? prev : prev.filter((_, i) => i !== idx))} className="w-9 h-10 rounded-lg border border-white/[0.08] text-gray-400 hover:text-red-400">×</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button onClick={calcular} disabled={loading || !form.peso || !form.altura_cm} className="evo-btn-primary w-full mt-4">
            <Zap className="w-4 h-4" /> {loading ? "Calculando..." : "Calcular TMB / GET"}
          </button>
        </div>

        <div className="evo-card p-5">
          <h3 className="evo-h3 mb-4">Planejamento de Meta (Venta)</h3>
          <div className="grid grid-cols-2 gap-3">
            <Inp l="Peso desejado (kg)" v={venta.peso_desejado} onChange={v => setVenta(s => ({...s, peso_desejado: v}))} t="number" />
            <Inp l="Prazo (dias)" v={venta.prazo_dias} onChange={v => setVenta(s => ({...s, prazo_dias: v}))} t="number" />
          </div>
          <button onClick={calcVenta} disabled={!venta.peso_desejado || !form.peso} className="evo-btn-primary w-full mt-3">
            <Scale className="w-4 h-4" /> Calcular venta
          </button>
          {ventaResult && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Metric l="Diferença" v={`${Math.abs(ventaResult.diferenca_kg)} kg`} tag={ventaResult.objetivo} />
              <Metric l="Total kcal" v={`${Math.abs(ventaResult.total_kcal).toLocaleString("pt-BR")} kcal`} />
              <Metric l="Saldo diário" v={`${ventaResult.saldo_diario_kcal > 0 ? "-" : "+"}${Math.abs(ventaResult.saldo_diario_kcal)} kcal/dia`} />
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4">
        {result ? (
          <div className="evo-card p-5">
            <h3 className="evo-h3 mb-4">Resultados</h3>
            <div className="grid grid-cols-2 gap-3">
              <Metric l="TMB" v={`${result.tmb} kcal`} tag={PROTOCOLOS_TMB.find(p => p[0] === result.protocolo)?.[1]} />
              <Metric l="GET" v={`${result.get} kcal`} />
              <Metric l="NAF" v={result.naf} />
              <Metric l="FI" v={result.fi} />
              {bio.agua_corporal_pct != null && <Metric l="% Água" v={`${bio.agua_corporal_pct}%`} />}
              {bio.gordura_visceral != null && <Metric l="Gordura Visceral" v={bio.gordura_visceral} />}
            </div>
            <div className="mt-4 p-3 rounded-lg bg-evo-purple/10 border border-evo-purple/20 text-sm">
              <div className="text-evo-purple font-semibold text-xs uppercase tracking-wider mb-1">VET estimado</div>
              <div className="text-2xl font-display font-bold">{result.get} <span className="text-sm text-gray-400">kcal/dia</span></div>
            </div>
          </div>
        ) : (
          <div className="evo-card p-12 text-center text-gray-500">
            <Zap className="w-7 h-7 mx-auto text-gray-600 mb-3" />
            <div className="text-sm">Preencha os dados e clique em <strong>Calcular</strong>.</div>
            {lastEval && (
              <div className="mt-4 text-xs text-gray-600">
                Última avaliação: TMB={comp.tmb_mifflin} kcal · GET={comp.get_kcal} kcal
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Recordatório ─────────────────────────────────────────────────

function Recordatorio({ d, reload }) {
  const [recs, setRecs] = useState(d.recordatorios || []);
  const [open, setOpen] = useState(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pickMealIndex, setPickMealIndex] = useState(null);
  const [draft, setDraft] = useState({ data: new Date().toISOString().split("T")[0], refeicoes: [], observacoes: "", finalizado: false });

  const addRefeicao = () => setDraft(s => ({
    ...s,
    refeicoes: [...s.refeicoes, { numero: s.refeicoes.length + 1, nome: `Refeição ${s.refeicoes.length + 1}`, horario: "", itens: [], observacao: "" }]
  }));
  const removeRefeicao = (i) => setDraft(s => ({ ...s, refeicoes: s.refeicoes.filter((_, idx) => idx !== i) }));
  const setRef = (i, k, v) => setDraft(s => {
    const r = [...s.refeicoes]; r[i] = { ...r[i], [k]: v }; return { ...s, refeicoes: r };
  });
  const addAlimento = async (ri, alim) => {
    const operational = await loadFoodOperationalData(alim.id);
    const qtd = parseFloat(alim.porcao_padrao_g) || parseFloat(alim.quantidade_referencia_g) || 100;
    const measures = dedupeMeasures(operational.measures, alim.medida_caseira, qtd);
    const defaultMeasure = measures.find((item) => item.nome !== "Gramas")?.nome || "Gramas";
    const defaultQty = defaultMeasure === "Gramas"
      ? qtd
      : Math.max(1, Number((qtd / Number(measures.find((item) => item.nome === defaultMeasure)?.gramas || qtd)).toFixed(2)));
    setDraft(s => {
      const r = [...s.refeicoes];
      const itens = [...(r[ri].itens || [])];
      itens.push({
        n: itens.length + 1,
        alimento_id: alim.id,
        alimento_nome: alim.nome,
        medida_nome: defaultMeasure,
        quantidade: defaultMeasure === "Gramas" ? qtd : defaultQty,
        quantidade_g: defaultMeasure === "Gramas" ? qtd : gramsForMeasure(measures, defaultMeasure, defaultQty, qtd),
        _grupo: alim.grupo_display ?? alim.grupo ?? alim.categoria ?? null,
        _kcal100g: alim.energia_kcal_100g ?? null,
        _medidas: measures,
      });
      r[ri] = { ...r[ri], itens };
      return { ...s, refeicoes: r };
    });
  };
  const setAlim = (ri, ai, k, v) => setDraft(s => {
    const r = [...s.refeicoes];
    const itens = [...(r[ri].itens || [])];
    const next = { ...itens[ai], [k]: v };
    if (k === "quantidade") next.quantidade_g = gramsForMeasure(next._medidas, next.medida_nome, v, next.quantidade_g);
    if (k === "medida_nome") next.quantidade_g = gramsForMeasure(next._medidas, v, next.quantidade, next.quantidade_g);
    if (k === "quantidade_g") next.quantidade = v;
    itens[ai] = next;
    r[ri] = { ...r[ri], itens };
    return { ...s, refeicoes: r };
  });
  const removeAlim = (ri, ai) => setDraft(s => {
    const r = [...s.refeicoes];
    r[ri] = { ...r[ri], itens: (r[ri].itens || []).filter((_, i) => i !== ai).map((item, idx) => ({ ...item, n: idx + 1 })) };
    return { ...s, refeicoes: r };
  });

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.post(`/patients/${d.patient.id}/recordatorios`, sanitizeRecordatorioDraft(draft));
      setRecs(s => [data, ...s]);
      setOpen(data);
      setCreating(false);
      setPickMealIndex(null);
      setDraft({ data: new Date().toISOString().split("T")[0], refeicoes: [], observacoes: "", finalizado: false });
      reload?.();
      toast.success("Recordatório salvo!");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally { setSaving(false); }
  };

  const remove = async (rid) => {
    if (!window.confirm("Remover este recordatório?")) return;
    try {
      await api.delete(`/patients/${d.patient.id}/recordatorios/${rid}`);
      setRecs(s => s.filter(r => r.id !== rid));
      if (open?.id === rid) setOpen(null);
      toast.success("Removido");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  return (
    <div className="grid lg:grid-cols-5 gap-5">
      {pickMealIndex !== null && (
        <FoodSearchModal
          refNome={draft.refeicoes[pickMealIndex]?.nome ?? "Refeição"}
          onSelect={(food) => {
            addAlimento(pickMealIndex, food);
            setPickMealIndex(null);
          }}
          onClose={() => setPickMealIndex(null)}
        />
      )}
      <div className="lg:col-span-2 space-y-4">
        <div className="evo-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="evo-h3">Recordatórios</h3>
            <button onClick={() => setCreating(c => !c)} className="evo-btn-primary text-xs">
              <Plus className="w-3 h-3" /> Novo
            </button>
          </div>
          {recs.length === 0 ? (
            <div className="text-sm text-gray-500">Nenhum recordatório registrado.</div>
          ) : (
            <div className="space-y-2">
              {recs.map(r => (
                <button key={r.id} onClick={() => setOpen(r)}
                  className={`w-full text-left p-3 rounded-lg border transition-all ${open?.id === r.id ? "border-evo-purple/50 bg-evo-purple/10" : "border-white/[0.06] hover:border-white/[0.15] bg-evo-bg"}`}>
                  <div className="font-semibold text-sm">{r.data}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">{r.refeicoes?.length || 0} refeições</div>
                </button>
              ))}
            </div>
          )}
        </div>

        {creating && (
          <div className="evo-card p-4 space-y-3">
            <h3 className="evo-h3">Novo recordatório</h3>
            <Inp l="Data" v={draft.data} onChange={v => setDraft(s => ({...s, data: v}))} t="date" />
            {draft.refeicoes.map((ref, ri) => (
              <div key={ri} className="p-3 rounded-lg bg-evo-bg border border-white/[0.06] space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <input className="evo-input flex-1 text-sm" value={ref.nome} onChange={e => setRef(ri,"nome",e.target.value)} placeholder="Nome da refeição" />
                  <input className="evo-input w-24 text-sm" type="time" value={ref.horario} onChange={e => setRef(ri,"horario",e.target.value)} />
                  <button onClick={() => removeRefeicao(ri)} className="text-evo-coral"><X className="w-4 h-4" /></button>
                </div>
                {(ref.itens || []).map((a, ai) => (
                  <div key={ai} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm text-white truncate">{a.alimento_nome}</div>
                        <div className="text-[11px] text-gray-500">
                          {a._grupo || "—"}
                          {a.medida_nome ? ` · ${a.medida_nome}` : ""}
                        </div>
                      </div>
                      <button onClick={() => removeAlim(ri, ai)} className="text-gray-500 hover:text-evo-coral"><X className="w-3 h-3" /></button>
                    </div>
                    <div className="flex gap-2 items-center">
                      <input
                        className="evo-input w-20 text-xs"
                        type="number"
                        min="0"
                        value={a.quantidade}
                        onChange={e => setAlim(ri, ai, "quantidade", e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))}
                        placeholder="Qtd"
                      />
                      <select
                        value={a.medida_nome || "Gramas"}
                        onChange={e => setAlim(ri, ai, "medida_nome", e.target.value)}
                        className="bg-white/[0.05] border border-white/[0.08] rounded-lg px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-[#0081FD]/40"
                      >
                        {(a._medidas || [{ nome: "Gramas", gramas: 1 }]).map((m) => (
                          <option key={m.nome} value={m.nome}>{m.nome}</option>
                        ))}
                      </select>
                      <span className="text-xs text-gray-500">{a.quantidade_g}g</span>
                      {a._kcal100g != null && (
                        <span className="text-[11px] text-gray-600 ml-auto">
                          {Math.round((Number(a._kcal100g) / 100) * (Number(a.quantidade_g) || 0))} kcal
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                <button onClick={() => setPickMealIndex(ri)} className="text-xs text-evo-teal flex items-center gap-1">
                  <Plus className="w-3 h-3" /> Selecionar alimento da base
                </button>
                {(ref.itens || []).length > 0 && <div className="text-[11px] text-gray-500">{(ref.itens || []).length} item(ns) na refeição</div>}
              </div>
            ))}
            <button onClick={addRefeicao} className="text-sm text-evo-purple flex items-center gap-1 w-full justify-center p-2 rounded-lg border border-dashed border-evo-purple/30 hover:border-evo-purple/60 transition-colors">
              <Plus className="w-4 h-4" /> Adicionar refeição
            </button>
            <label className="flex items-center gap-2 text-sm cursor-pointer text-gray-300">
              <input type="checkbox" checked={draft.finalizado} onChange={(e) => setDraft(s => ({ ...s, finalizado: e.target.checked }))} className="w-4 h-4" />
              Finalizar ao salvar
            </label>
            <div>
              <label className="evo-label">Observações gerais</label>
              <textarea className="evo-input h-20 resize-none" value={draft.observacoes} onChange={e => setDraft(s => ({...s, observacoes: e.target.value}))} placeholder="Observações..." />
            </div>
            <button onClick={save} disabled={saving} className="evo-btn-primary w-full">
              <Save className="w-4 h-4" /> {saving ? "Salvando..." : "Salvar recordatório"}
            </button>
          </div>
        )}
      </div>

      <div className="lg:col-span-3">
        {!open ? (
          <div className="evo-card p-12 text-center text-gray-500">
            <ClipboardList className="w-7 h-7 mx-auto text-gray-600 mb-3" />
            <div className="text-sm">Selecione um recordatório para visualizar.</div>
          </div>
        ) : (
          <div className="evo-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="evo-h3">Recordatório — {open.data}</h3>
                <div className="text-[11px] text-gray-500 mt-1">
                  {(open.refeicoes || []).length} refeições
                  {open.finalizado ? " · finalizado" : " · rascunho"}
                </div>
              </div>
              <button onClick={() => remove(open.id)} className="evo-btn-ghost text-evo-coral text-xs">
                <Trash2 className="w-3 h-3" /> Remover
              </button>
            </div>
            {open.totais_dia && (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                <MacroPill label="Energia" value={Math.round(open.totais_dia.energia_kcal || 0)} unit="kcal" accent="blue" />
                <MacroPill label="Proteína" value={open.totais_dia.proteina_g || 0} unit="g" accent="green" />
                <MacroPill label="Carbo" value={open.totais_dia.carboidrato_g || 0} unit="g" accent="amber" />
                <MacroPill label="Lipídios" value={open.totais_dia.lipideos_g || 0} unit="g" accent="orange" />
                <MacroPill label="Fibras" value={open.totais_dia.fibra_g || 0} unit="g" accent="purple" />
              </div>
            )}
            {(open.refeicoes || []).map((ref, i) => (
              <div key={i} className="p-4 rounded-lg bg-evo-bg border border-white/[0.06]">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-sm">{ref.nome}</span>
                  <div className="text-right">
                    {ref.horario && <div className="text-xs text-gray-400">{ref.horario}</div>}
                    <div className="text-[11px] text-gray-600">{Math.round(ref.total_energia_kcal || 0)} kcal</div>
                  </div>
                </div>
                {(ref.itens || []).length === 0 ? (
                  <div className="text-xs text-gray-500">Sem alimentos registrados.</div>
                ) : (
                  <table className="w-full text-xs">
                    <thead><tr className="text-gray-500">
                      <th className="text-left pb-1">Alimento</th><th className="text-right pb-1">Qtd</th><th className="text-right pb-1">kcal</th>
                    </tr></thead>
                    <tbody>
                      {ref.itens.map((a, ai) => (
                        <tr key={ai} className="border-t border-white/[0.04]">
                          <td className="py-1">
                            {a.alimento_nome}
                            <div className="text-[10px] text-gray-600">{a.quantidade ?? "—"} {a.medida_nome || "Gramas"}</div>
                          </td>
                          <td className="py-1 text-gray-400 text-right">{a.quantidade_g} g</td>
                          <td className="py-1 text-gray-400 text-right">{Math.round(a.energia_kcal || 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {ref.observacao && <div className="text-xs text-gray-400 mt-2 italic">{ref.observacao}</div>}
              </div>
            ))}
            {open.observacoes && (
              <div className="p-3 rounded-lg bg-evo-bg border border-white/[0.06] text-sm text-gray-300">
                <div className="text-[11px] text-gray-500 mb-1">Observações gerais</div>
                {open.observacoes}
              </div>
            )}
          </div>
        )}
      </div>
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
  const [subTab, setSubTab] = useState("pdf");
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {[["pdf","Exames PDF (IA)"],["manual","Entrada Manual"]].map(([k,l]) => (
          <button key={k} onClick={() => setSubTab(k)}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold border transition-all ${subTab===k?"bg-evo-purple/15 text-white border-evo-purple/40":"border-white/[0.06] text-gray-400 hover:text-white"}`}>
            {l}
          </button>
        ))}
      </div>
      {subTab === "pdf" && <ExamesPDF d={d} reload={reload} />}
      {subTab === "manual" && <ExamesManuais d={d} />}
    </div>
  );
}

function ExamesPDF({ d, reload }) {
  const [exams, setExams] = useState(d.exams || []);
  const [uploading, setUploading] = useState(false);
  const [open, setOpen] = useState(null);
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

// ── Exames Manuais ────────────────────────────────────────────────

const BADGE = { normal: "bg-evo-teal/15 text-evo-teal border-evo-teal/30", baixo: "bg-blue-500/15 text-blue-400 border-blue-500/30", alto: "bg-evo-coral/15 text-evo-coral border-evo-coral/30", sem_referencia: "bg-white/5 text-gray-400 border-white/10" };
const BADGE_LABEL = { normal: "Normal", baixo: "Abaixo", alto: "Elevado", sem_referencia: "—" };
const TREND_LABEL = { subiu: "Subiu", caiu: "Caiu", estavel: "Estável" };

function examReferenceText(ref) {
  if (!ref) return "—";
  return [ref.ref_m_min != null && `≥${ref.ref_m_min}`, ref.ref_m_max != null && `≤${ref.ref_m_max}`].filter(Boolean).join(" — ") || "—";
}

function examDeltaText(marker) {
  if (marker?.delta_abs == null) return "Sem comparação";
  const sign = marker.delta_abs > 0 ? "+" : "";
  const pct = marker.delta_pct != null ? ` (${sign}${marker.delta_pct}%)` : "";
  return `${sign}${marker.delta_abs}${pct}`;
}

function ExamesManuais({ d }) {
  const pid = d.patient.id;
  const [lotes, setLotes] = useState([]);
  const [grupos, setGrupos] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [longitudinal, setLongitudinal] = useState({ resumo: {}, grupos: [], marcadores: [], timeline: [] });
  const [showForm, setShowForm] = useState(false);
  const [grupoFiltro, setGrupoFiltro] = useState("");
  const [dataColeta, setDataColeta] = useState(new Date().toISOString().split("T")[0]);
  const [laboratorio, setLaboratorio] = useState("");
  const [itens, setItens] = useState([]);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(null);
  const [markerOpen, setMarkerOpen] = useState(null);

  const load = async () => {
    try {
      const [{ data: ls }, { data: gs }, { data: cat }, { data: long }] = await Promise.all([
        api.get(`/patients/${pid}/exames-manuais`),
        api.get("/referencias/exames-grupos"),
        api.get("/referencias/exames-catalog"),
        api.get(`/patients/${pid}/exames-manuais/longitudinal`),
      ]);
      setLotes(ls);
      setGrupos(gs);
      setCatalog(cat);
      setLongitudinal(long || { resumo: {}, grupos: [], marcadores: [], timeline: [] });
      setMarkerOpen((current) => current || long?.marcadores?.[0] || null);
    } catch {}
  };
  useEffect(() => {
    let active = true;
    Promise.all([
      api.get(`/patients/${pid}/exames-manuais`),
      api.get("/referencias/exames-grupos"),
      api.get("/referencias/exames-catalog"),
      api.get(`/patients/${pid}/exames-manuais/longitudinal`),
    ])
      .then(([{ data: ls }, { data: gs }, { data: cat }, { data: long }]) => {
        if (!active) return;
        setLotes(ls);
        setGrupos(gs);
        setCatalog(cat);
        setLongitudinal(long || { resumo: {}, grupos: [], marcadores: [], timeline: [] });
        setMarkerOpen((current) => current || long?.marcadores?.[0] || null);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [pid]);

  const filteredCat = grupoFiltro ? catalog.filter(e => e.grupo === grupoFiltro) : catalog;

  const toggleItem = (exame) => {
    setItens(prev => {
      const exists = prev.find(i => i.codigo === exame.codigo);
      if (exists) return prev.filter(i => i.codigo !== exame.codigo);
      return [...prev, { codigo: exame.codigo, nome: exame.nome, unidade: exame.unidade, grupo: exame.grupo, valor: "" }];
    });
  };

  const setValor = (codigo, val) => {
    setItens(prev => prev.map(i => i.codigo === codigo ? { ...i, valor: val } : i));
  };

  const submitExames = async () => {
    const valid = itens.filter(i => i.valor !== "" && !isNaN(parseFloat(i.valor)));
    if (!valid.length) { toast.error("Preencha ao menos um valor"); return; }
    setSaving(true);
    try {
      await api.post(`/patients/${pid}/exames-manuais`, {
        data_coleta: dataColeta,
        laboratorio: laboratorio || null,
        exames: valid.map(i => ({ ...i, valor: parseFloat(i.valor) })),
      });
      toast.success("Exames registrados!");
      setShowForm(false); setItens([]);
      await load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Erro ao salvar"); }
    finally { setSaving(false); }
  };

  const deleteLote = async (emid) => {
    if (!window.confirm("Excluir este registro?")) return;
    await api.delete(`/patients/${pid}/exames-manuais/${emid}`);
    toast.success("Excluído"); await load();
    if (open?.id === emid) setOpen(null);
  };

  const downloadPdf = async () => {
    try {
      const r = await api.get(`/patients/${pid}/relatorios/exames`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([r.data], { type: "application/pdf" }));
      const a = document.createElement("a"); a.href = url; a.download = "exames.pdf";
      document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url);
    } catch { toast.error("Erro ao gerar PDF"); }
  };

  const resumo = longitudinal?.resumo || {};
  const markerDetail = markerOpen
    ? (longitudinal?.marcadores || []).find((item) => item.codigo === markerOpen.codigo) || markerOpen
    : null;

  return (
    <div className="grid lg:grid-cols-5 gap-5">
      <div className="lg:col-span-2 space-y-4">
        <div className="evo-card p-4 space-y-2">
          <button onClick={() => setShowForm(s => !s)} className="evo-btn-primary w-full"><Plus className="w-4 h-4" /> {showForm ? "Cancelar" : "Registrar exames"}</button>
          {lotes.length > 0 && <button onClick={downloadPdf} className="evo-btn-secondary w-full"><Download className="w-4 h-4" /> PDF completo</button>}
        </div>
        <div className="evo-card p-4">
          <h3 className="evo-h3 mb-3">Histórico</h3>
          {lotes.length === 0 ? <div className="text-sm text-gray-500">Nenhum exame manual registrado.</div> : (
            <div className="space-y-2">
              {lotes.map(l => (
                <button key={l.id} onClick={() => setOpen(l)} className={`w-full text-left p-3 rounded-lg border transition-all ${open?.id===l.id?"border-evo-purple/50 bg-evo-purple/10":"border-white/[0.06] hover:border-white/20 bg-evo-bg"}`}>
                  <div className="font-semibold text-sm">{l.data_coleta}</div>
                  <div className="text-[11px] text-gray-500">{l.laboratorio || "—"} · {(l.exames||[]).length} exames</div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(l.exames||[]).filter(e => e.classificacao !== "normal").slice(0,3).map((e,i) => (
                      <span key={i} className={`text-[9px] px-1.5 py-0.5 rounded-full border ${BADGE[e.classificacao]||BADGE.sem_referencia}`}>{(e.nome||"").slice(0,12)}</span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="lg:col-span-3">
        {showForm ? (
          <div className="evo-card p-5 space-y-4">
            <h3 className="evo-h3">Novo Registro de Exames</h3>
            <div className="grid sm:grid-cols-2 gap-3">
              <div><label className="evo-label">Data da coleta</label><input type="date" className="evo-input" value={dataColeta} onChange={e => setDataColeta(e.target.value)} /></div>
              <div><label className="evo-label">Laboratório</label><input className="evo-input" value={laboratorio} onChange={e => setLaboratorio(e.target.value)} placeholder="Opcional" /></div>
            </div>
            <div>
              <label className="evo-label">Filtrar por grupo</label>
              <select className="evo-input" value={grupoFiltro} onChange={e => setGrupoFiltro(e.target.value)}>
                <option value="">Todos os grupos</option>
                {grupos.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1 border border-white/[0.06] rounded-lg p-2">
              {filteredCat.map(exame => {
                const sel = itens.find(i => i.codigo === exame.codigo);
                return (
                  <div key={exame.codigo} className={`flex items-center gap-2 p-2 rounded ${sel ? "bg-evo-purple/10" : "hover:bg-white/[0.02]"}`}>
                    <input type="checkbox" checked={!!sel} onChange={() => toggleItem(exame)} className="accent-evo-purple" />
                    <span className="flex-1 text-sm">{exame.nome}</span>
                    <span className="text-xs text-gray-500">{exame.unidade}</span>
                    {sel && <input type="number" step="0.01" className="evo-input w-24 text-xs" placeholder="Valor" value={sel.valor} onChange={e => setValor(exame.codigo, e.target.value)} />}
                  </div>
                );
              })}
            </div>
            {itens.length > 0 && (
              <div className="bg-evo-bg rounded-lg p-3">
                <div className="text-xs text-gray-500 mb-2">Selecionados com valor: {itens.filter(i=>i.valor).length}/{itens.length}</div>
                <div className="space-y-1">
                  {itens.map(i => (
                    <div key={i.codigo} className="flex items-center gap-2 text-sm">
                      <span className="flex-1">{i.nome}</span>
                      <input type="number" step="0.01" className="evo-input w-24 text-xs" placeholder="Valor" value={i.valor} onChange={e => setValor(i.codigo, e.target.value)} />
                      <span className="text-xs text-gray-500 w-12">{i.unidade}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <button onClick={submitExames} disabled={saving} className="evo-btn-primary w-full">{saving ? "Salvando..." : "Salvar Exames"}</button>
          </div>
        ) : (
          <div className="space-y-4">
            {lotes.length > 0 && (
              <>
                <div className="grid sm:grid-cols-4 gap-3">
                  <div className="evo-card p-4">
                    <div className="text-[10px] uppercase tracking-wider text-gray-500">Coletas</div>
                    <div className="font-display text-2xl mt-1">{resumo.total_coletas || 0}</div>
                  </div>
                  <div className="evo-card p-4">
                    <div className="text-[10px] uppercase tracking-wider text-gray-500">Marcadores</div>
                    <div className="font-display text-2xl mt-1">{resumo.total_marcadores || 0}</div>
                  </div>
                  <div className="evo-card p-4">
                    <div className="text-[10px] uppercase tracking-wider text-gray-500">Alterados na última</div>
                    <div className="font-display text-2xl mt-1">{resumo.marcadores_alterados_ultima_coleta || 0}</div>
                  </div>
                  <div className="evo-card p-4">
                    <div className="text-[10px] uppercase tracking-wider text-gray-500">Grupos com alteração</div>
                    <div className="font-display text-2xl mt-1">{resumo.grupos_com_alteracao || 0}</div>
                  </div>
                </div>

                <div className="grid xl:grid-cols-5 gap-4">
                  <div className="xl:col-span-2 evo-card p-4 space-y-3">
                    <div>
                      <h3 className="evo-h3">Leitura por grupo</h3>
                      <p className="text-xs text-gray-500 mt-1">Resumo clínico acumulado das coletas manuais.</p>
                    </div>
                    <div className="space-y-2">
                      {(longitudinal.grupos || []).map((grupo) => (
                        <div key={grupo.grupo} className="rounded-lg border border-white/[0.06] bg-evo-bg p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-semibold">{grupo.grupo}</div>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold uppercase ${grupo.alterados ? BADGE.alto : BADGE.normal}`}>
                              {grupo.alterados ? `${grupo.alterados} alterado(s)` : "Sem alteração"}
                            </span>
                          </div>
                          <div className="text-[11px] text-gray-500 mt-1">
                            {grupo.total_exames} medições · última coleta {grupo.ultima_data || "—"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="xl:col-span-3 evo-card p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <h3 className="evo-h3">Comparativo longitudinal</h3>
                        <p className="text-xs text-gray-500 mt-1">Variação entre as duas coletas mais recentes de cada marcador.</p>
                      </div>
                      {resumo.ultima_data_coleta && <div className="text-[11px] text-gray-500">Última coleta: {resumo.ultima_data_coleta}</div>}
                    </div>
                    <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                      {(longitudinal.marcadores || []).map((marker) => (
                        <button
                          key={marker.codigo}
                          onClick={() => setMarkerOpen(marker)}
                          className={`w-full text-left rounded-lg border p-3 transition-all ${markerDetail?.codigo === marker.codigo ? "border-evo-purple/40 bg-evo-purple/10" : "border-white/[0.06] bg-evo-bg hover:border-white/20"}`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold">{marker.nome}</div>
                              <div className="text-[11px] text-gray-500">{marker.grupo}</div>
                            </div>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold uppercase ${BADGE[marker.ultima_classificacao] || BADGE.sem_referencia}`}>
                              {BADGE_LABEL[marker.ultima_classificacao] || "—"}
                            </span>
                          </div>
                          <div className="grid sm:grid-cols-3 gap-2 mt-3 text-xs">
                            <div>
                              <div className="text-gray-500">Atual</div>
                              <div className="font-semibold text-white">{marker.ultima_coleta?.valor ?? "—"} {marker.unidade}</div>
                            </div>
                            <div>
                              <div className="text-gray-500">Anterior</div>
                              <div className="font-semibold text-white">{marker.coleta_anterior?.valor ?? "—"} {marker.unidade}</div>
                            </div>
                            <div>
                              <div className="text-gray-500">{TREND_LABEL[marker.trend] || "Variação"}</div>
                              <div className="font-semibold text-white">{examDeltaText(marker)}</div>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                    {markerDetail && (
                      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold">{markerDetail.nome}</div>
                            <div className="text-[11px] text-gray-500">{markerDetail.grupo} · {markerDetail.unidade}</div>
                          </div>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold uppercase ${BADGE[markerDetail.ultima_classificacao] || BADGE.sem_referencia}`}>
                            {BADGE_LABEL[markerDetail.ultima_classificacao] || "—"}
                          </span>
                        </div>
                        <div className="mt-3 space-y-2">
                          {(markerDetail.coletas || []).slice().reverse().map((coleta, idx) => (
                            <div key={`${markerDetail.codigo}-${idx}`} className="flex items-center justify-between gap-3 text-sm border-b border-white/[0.05] pb-2 last:border-b-0 last:pb-0">
                              <div>
                                <div className="font-medium">{coleta.data_coleta}</div>
                                <div className="text-[11px] text-gray-500">{coleta.laboratorio || "Laboratório não informado"}</div>
                              </div>
                              <div className="text-right">
                                <div className="font-semibold text-white">{coleta.valor} {markerDetail.unidade}</div>
                                <div className={`text-[11px] ${coleta.classificacao === "normal" ? "text-evo-teal" : coleta.classificacao === "baixo" ? "text-blue-400" : "text-evo-coral"}`}>
                                  {BADGE_LABEL[coleta.classificacao] || "—"}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {!open ? (
              <div className="evo-card p-12 text-center text-gray-500 text-sm"><FlaskConical className="w-7 h-7 mx-auto mb-3 text-gray-600" />Selecione um registro ou registre novos exames.</div>
            ) : (
              <div className="evo-card p-5 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h3 className="evo-h3">{open.data_coleta}</h3>
                    <div className="text-xs text-gray-500">{open.laboratorio || "Laboratório não informado"}</div>
                  </div>
                  <button onClick={() => deleteLote(open.id)} className="evo-btn-ghost text-evo-coral text-xs"><Trash2 className="w-3.5 h-3.5" /> Excluir</button>
                </div>
                {Object.entries(
                  (open.exames||[]).reduce((acc, e) => { (acc[e.grupo] = acc[e.grupo] || []).push(e); return acc; }, {})
                ).map(([grupo, exs]) => (
                  <div key={grupo}>
                    <div className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">{grupo}</div>
                    <div className="grid sm:grid-cols-2 gap-2">
                      {exs.map((e, i) => (
                        <div key={i} className="p-3 rounded-lg bg-evo-bg border border-white/[0.04]">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-semibold">{e.nome}</div>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold uppercase ${BADGE[e.classificacao]||BADGE.sem_referencia}`}>{BADGE_LABEL[e.classificacao]||"—"}</span>
                          </div>
                          <div className="text-sm mt-1"><span className="font-bold text-white">{e.valor}</span> <span className="text-gray-400">{e.unidade}</span></div>
                          <div className="text-[10px] text-gray-500 mt-1">Ref: {examReferenceText(e.referencia)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
