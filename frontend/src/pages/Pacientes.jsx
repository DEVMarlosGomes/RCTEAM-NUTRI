import React, { useCallback, useEffect, useState } from "react";
import NutriLayout from "@/components/evonut/NutriLayout";
import { api, formatApiError } from "@/lib/evo-api";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, CalendarPlus, MessageCircle, Pencil, Plus, Search, Send, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import SeletorObjetivos from "@/components/evonut/SeletorObjetivos";

const emptyForm = {
  nome: "", telefone: "", email: "", data_nascimento: "", sexo: "",
  objetivo: "", objetivos: [], peso: "", altura: "", status_funil: "LEAD_INICIADO", origem: "",
};

const statuses = [
  "LEAD_INICIADO", "PROPOSTA_ACEITA", "ANAMNESE_COMPLETA", "CONSULTA_AGENDADA",
  "CONSULTA_REALIZADA", "PLANO_ENTREGUE", "EM_ACOMPANHAMENTO", "INATIVO", "PERDIDO",
];

function PatientModal({ patient, onClose, onSaved, onAbrir }) {
  const [form, setForm] = useState(patient ? {
    ...emptyForm,
    ...Object.fromEntries(Object.entries(patient).map(([key, value]) => [key, value ?? ""])),
    objetivos: patient.objetivos?.length ? patient.objetivos : patient.objetivo ? [patient.objetivo] : [],
    sexo: ["F", "M"].includes(patient.sexo) ? patient.sexo : "",
  } : emptyForm);
  const [saving, setSaving] = useState(false);
  const [duplicados, setDuplicados] = useState([]);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  // aviso de duplicado ao cadastrar (nome ou telefone parecido)
  useEffect(() => {
    if (patient) return undefined;
    const t = setTimeout(() => {
      if ((form.nome || "").trim().length < 4 && String(form.telefone || "").replace(/\D/g, "").length < 8) { setDuplicados([]); return; }
      api.get("/patients/duplicados", { params: { nome: form.nome, telefone: form.telefone } }).then((r) => setDuplicados(r.data || [])).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [form.nome, form.telefone, patient]);
  const juntar = async (dup) => {
    const extra = Object.fromEntries(Object.entries({ email: form.email || null, telefone: form.telefone, data_nascimento: form.data_nascimento, sexo: form.sexo || null,
      objetivo: form.objetivo, objetivos: form.objetivos?.length ? form.objetivos : undefined, origem: form.origem || undefined })
      .filter(([, v]) => v !== undefined && v !== null && v !== ""));
    try { await api.patch(`/patients/${dup.id}`, extra); toast.success(`Dados juntados no cadastro de ${dup.nome}.`); onSaved(); }
    catch (error) { toast.error(formatApiError(error.response?.data?.detail)); }
  };

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        email: form.email || null,
        origem: form.origem || null,
        sexo: form.sexo || null,
        objetivos: form.objetivos,
        objetivo: form.objetivo || form.objetivos[0] || null,
        peso: form.peso === "" ? null : Number(form.peso),
        altura: form.altura === "" ? null : Number(form.altura),
      };
      if (patient?.id) await api.patch(`/patients/${patient.id}`, payload);
      else await api.post("/patients", payload);
      toast.success(patient ? "Paciente atualizado." : "Paciente adicionado.");
      onSaved();
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <form onSubmit={save} className="evo-card p-6 w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="rc-eyebrow">Cadastro</div>
            <h2 className="evo-h3 mt-1">{patient ? "Editar paciente" : "Novo paciente"}</h2>
          </div>
          <button type="button" onClick={onClose} className="evo-btn-ghost p-2" aria-label="Fechar"><X className="w-4 h-4" /></button>
        </div>
        {duplicados.length > 0 && (
          <div className="mb-4 space-y-2 rounded-xl bg-rc-amber/10 p-3 text-[13px] text-rc-amber ring-1 ring-rc-amber/30" data-testid="aviso-duplicado">
            <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" /> Parece que já existe esse cadastro:</p>
            {duplicados.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center gap-2 text-gray-200">
                <span className="flex-1">{d.nome}{d.telefone ? ` · ${d.telefone}` : ""} <span className="text-gray-500">({d.motivo === "telefone" ? "mesmo telefone" : "nome parecido"})</span></span>
                <button type="button" className="evo-btn-ghost text-xs" onClick={() => onAbrir?.(d.id)}>Abrir cadastro</button>
                <button type="button" className="evo-btn-secondary text-xs" onClick={() => juntar(d)}>Juntar</button>
              </div>
            ))}
          </div>
        )}
        <div className="grid md:grid-cols-2 gap-4">
          <label className="md:col-span-2"><span className="evo-label">Nome *</span><input required className="evo-input" value={form.nome} onChange={(e) => set("nome", e.target.value)} /></label>
          <label><span className="evo-label">E-mail</span><input type="email" className="evo-input" value={form.email} onChange={(e) => set("email", e.target.value)} /></label>
          <label><span className="evo-label">Telefone</span><input className="evo-input" value={form.telefone} onChange={(e) => set("telefone", e.target.value)} /></label>
          <label><span className="evo-label">Nascimento</span><input type="date" className="evo-input" value={form.data_nascimento} onChange={(e) => set("data_nascimento", e.target.value)} /></label>
          <label><span className="evo-label">Sexo biológico</span><select className="evo-input" value={form.sexo} onChange={(e) => set("sexo", e.target.value)} data-testid="novo-sexo"><option value="">Vem do formulário (ou escolha)</option><option value="F">Feminino</option><option value="M">Masculino</option></select></label>
          <div className="md:col-span-2">
            <span className="evo-label">Objetivos <span className="normal-case tracking-normal text-gray-500 font-normal">· normalmente vêm do formulário; marque aqui só em consulta sem formulário (★ = principal)</span></span>
            <SeletorObjetivos valor={form.objetivos} principal={form.objetivo} onChange={(lista, princ) => setForm((f) => ({ ...f, objetivos: lista, objetivo: princ }))} />
          </div>
          <label><span className="evo-label">Origem do contato</span><select className="evo-input" value={form.origem || ""} onChange={(e) => set("origem", e.target.value)}>
            <option value="">—</option><option value="instagram">Instagram</option><option value="site">Site</option><option value="whatsapp">WhatsApp</option><option value="indicacao">Indicação</option><option value="outro">Outro</option></select></label>
          <label><span className="evo-label">Status</span><select className="evo-input" value={form.status_funil} onChange={(e) => set("status_funil", e.target.value)}>{statuses.map((status) => <option key={status}>{status}</option>)}</select></label>
          <label><span className="evo-label">Peso (kg)</span><input min="0" step="0.1" type="number" className="evo-input" value={form.peso} onChange={(e) => set("peso", e.target.value)} /></label>
          <label><span className="evo-label">Altura (cm)</span><input min="0" step="0.1" type="number" className="evo-input" value={form.altura} onChange={(e) => set("altura", e.target.value)} /></label>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button type="button" onClick={onClose} className="evo-btn-secondary">Cancelar</button>
          <button disabled={saving} className="evo-btn-primary">{saving ? "Salvando..." : "Salvar paciente"}</button>
        </div>
      </form>
    </div>
  );
}

const ETAPAS = [
  ["todos", "Todos"], ["lead", "Leads"], ["atendimento", "Em atendimento"], ["acompanhamento", "Acompanhamento"], ["inativo", "Inativos"],
];
const ROTULO_ETAPA = { lead: "Lead", atendimento: "Em atendimento", acompanhamento: "Acompanhamento", inativo: "Inativo", perdido: "Perdido" };
const ORIGENS = { instagram: "Instagram", site: "Site", whatsapp: "WhatsApp", indicacao: "Indicação", outro: "Outro" };
const dataBR = (v) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || "")); return m ? `${m[3]}/${m[2]}/${m[1]}` : "—"; };
const foneBR = (v) => {
  const d = String(v || "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  if (d.length === 11) return `${d.slice(0, 2)} ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 2)} ${d.slice(2, 6)}-${d.slice(6)}`;
  return v || "";
};
const zap = (fone, msg = "") => {
  const d = String(fone || "").replace(/\D/g, "");
  return d ? `https://wa.me/${d.length <= 11 ? `55${d}` : d}${msg ? `?text=${encodeURIComponent(msg)}` : ""}` : null;
};
function textoPlano(pl) {
  if (!pl || pl.status === "sem_plano") return ["sem plano", "text-gray-500"];
  if (pl.status === "cancelado") return ["cancelado", "text-gray-500"];
  if (pl.status === "vencido") return [`vencido há ${Math.abs(pl.dias)} ${Math.abs(pl.dias) === 1 ? "dia" : "dias"}`, "text-rc-coral"];
  if (pl.status === "vencendo") return [`vence em ${pl.dias} ${pl.dias === 1 ? "dia" : "dias"}`, "text-rc-amber"];
  return [`ativo · ${pl.dias} dias`, "text-[#4ADE80]"];
}

export default function Pacientes() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [etapa, setEtapa] = useState("todos");
  const [ordem, setOrdem] = useState("proxima");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/patients");
      setRows(data || []);
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (new URLSearchParams(window.location.search).get("novo")) setModal("new"); }, []);

  const remove = async (patient) => {
    const confirmed = window.confirm(`Excluir ${patient.nome}? Esta ação também remove consultas, avaliações, planos, exames e a conta vinculada.`);
    if (!confirmed) return;
    try {
      await api.delete(`/patients/${patient.id}`);
      toast.success("Paciente e dados relacionados excluídos.");
      load();
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail));
    }
  };
  const enviarFormulario = async (p) => {
    try {
      const { data } = await api.post(`/patients/${p.id}/formulario/enviar`, { tipo: "inicial" });
      const url = `${window.location.origin}/pre-consulta/${data.token}`;
      try { await navigator.clipboard.writeText(url); } catch { /* sem área de transferência */ }
      const link = zap(p.telefone, `Oi, ${(p.nome || "").split(" ")[0]}! Segue o formulário pré-consulta: ${url}`);
      if (link) window.open(link, "_blank", "noopener");
      toast.success("Formulário enviado. Link copiado.");
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const perdido = async (p) => {
    if (!window.confirm(`Marcar ${p.nome} como perdido? Sai da jornada e fica no histórico.`)) return;
    try { await api.patch(`/patients/${p.id}`, { status_funil: "PERDIDO" }); load(); } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const etapaDe = (p) => p.etapa || "atendimento";
  const contar = (k) => rows.filter((p) => (k === "todos" ? !["lead", "perdido"].includes(etapaDe(p)) : k === "inativo" ? ["inativo", "perdido"].includes(etapaDe(p)) : etapaDe(p) === k)).length;
  const termo = q.trim().toLowerCase();
  const digitos = q.replace(/\D/g, "");
  const filtered = rows
    .filter((p) => (etapa === "todos" ? !["lead", "perdido"].includes(etapaDe(p)) : etapa === "inativo" ? ["inativo", "perdido"].includes(etapaDe(p)) : etapaDe(p) === etapa))
    .filter((p) => !termo || (p.nome || "").toLowerCase().includes(termo) || (digitos.length >= 3 && String(p.telefone || "").replace(/\D/g, "").includes(digitos)))
    .sort((a, b) => {
      if (ordem === "nome") return (a.nome || "").localeCompare(b.nome || "", "pt-BR");
      if (ordem === "vencimento") return (a.plano?.dias ?? 9999) - (b.plano?.dias ?? 9999);
      return String(a.proxima_consulta || "9999").localeCompare(String(b.proxima_consulta || "9999"));
    });

  return (
    <NutriLayout>
      {modal && <PatientModal patient={modal === "new" ? null : modal} pacientes={rows} onAbrir={(id) => navigate(`/pacientes/${id}`)} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} />}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
        <div><div className="rc-eyebrow">CRM clínico</div><h1 className="evo-h2 mt-1">Pacientes</h1>
          <p className="text-sm text-gray-400 mt-1">{loading ? "…" : `${contar("todos")} pacientes · ${contar("lead")} leads`}</p></div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input placeholder="Buscar por nome ou telefone" value={q} onChange={(e) => setQ(e.target.value)} className="evo-input pl-10 w-64" data-testid="busca-pacientes" /></div>
          <select className="evo-input w-auto" value={ordem} onChange={(e) => setOrdem(e.target.value)} aria-label="Ordenar">
            <option value="proxima">Próxima consulta</option><option value="vencimento">Vencimento do plano</option><option value="nome">Nome</option>
          </select>
          <button onClick={() => setModal("new")} className="evo-btn-primary"><Plus className="w-4 h-4" /> Novo paciente</button>
        </div>
      </div>
      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Etapas">
        {ETAPAS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={etapa === k} onClick={() => setEtapa(k)} data-testid={`etapa-${k}`}
            className={`h-9 rounded-lg px-3.5 text-[13px] font-semibold ${etapa === k ? "bg-rc-blue text-white" : "bg-white/[0.05] text-gray-300 hover:text-white"}`}>
            {l} <span className="tabular opacity-80">{loading ? "…" : contar(k)}</span>
          </button>
        ))}
      </div>
      <div className="evo-card overflow-hidden">
        <table className="w-full table-fixed text-left" data-testid="tabela-pacientes">
          <thead className="bg-evo-surface text-[11px] uppercase tracking-wider text-gray-400">
            {etapa === "lead" ? (
              <tr><th className="w-[34%] px-4 py-3">Lead</th><th className="px-4 py-3">Origem</th><th className="px-4 py-3">Contato</th><th className="px-4 py-3">Situação</th><th className="w-[260px] px-4 py-3 text-right">Ações</th></tr>
            ) : (
              <tr><th className="w-[30%] px-4 py-3">Paciente</th><th className="px-4 py-3">Etapa</th><th className="px-4 py-3">Última consulta</th><th className="px-4 py-3">Próxima consulta</th><th className="px-4 py-3">Plano</th><th className="w-[150px] px-4 py-3 text-right">Ações</th></tr>
            )}
          </thead>
          <tbody>
            {loading && [0, 1, 2, 3].map((i) => (
              <tr key={i} className="border-b border-white/[0.04]"><td colSpan={6} className="px-4 py-4"><div className="h-4 w-2/3 rounded bg-white/[0.06] animate-pulse-soft" /></td></tr>
            ))}
            {!loading && filtered.length === 0 && <tr><td colSpan={6} className="text-center px-4 py-12 text-gray-500"><Sparkles className="w-6 h-6 mx-auto text-gray-600 mb-3" />Nenhum paciente nesta etapa.</td></tr>}
            {!loading && filtered.map((p) => {
              const [plano, corPlano] = textoPlano(p.plano);
              const link = zap(p.telefone);
              const parar = (e) => e.stopPropagation();
              return (
                <tr key={p.id} onClick={() => navigate(`/pacientes/${p.id}`)} className="cursor-pointer border-b border-white/[0.04] hover:bg-white/[0.03]" data-testid={`paciente-${p.id}`}>
                  <td className="px-4 py-3">
                    <div className="truncate font-semibold text-white">{p.nome}</div>
                    <div className="truncate text-xs text-gray-500">{[p.objetivo, foneBR(p.telefone)].filter(Boolean).join(" · ") || "—"}</div>
                  </td>
                  {etapa === "lead" ? (
                    <>
                      <td className="px-4 py-3 text-sm text-gray-300">{ORIGENS[p.origem] || "—"}</td>
                      <td className="px-4 py-3 text-sm tabular text-gray-300">{dataBR(p.created_at)}</td>
                      <td className="px-4 py-3 text-sm text-gray-300">{p.status_funil === "PROPOSTA_ACEITA" ? "proposta aceita" : p.formulario?.enviado_em ? "formulário enviado" : "novo contato"}</td>
                      <td className="px-4 py-3" onClick={parar}><div className="flex justify-end gap-1">
                        <button type="button" onClick={() => enviarFormulario(p)} className="evo-btn-ghost text-xs"><Send className="h-3.5 w-3.5" /> Enviar formulário</button>
                        <button type="button" onClick={() => perdido(p)} className="evo-btn-ghost text-xs text-evo-coral">Perdido</button>
                      </div></td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3 text-sm text-gray-300">{ROTULO_ETAPA[etapaDe(p)]}</td>
                      <td className="px-4 py-3 text-sm tabular text-gray-300">{dataBR(p.ultima_consulta)}</td>
                      <td className="px-4 py-3 text-sm tabular text-gray-300">{p.proxima_consulta ? `${dataBR(p.proxima_consulta)} ${String(p.proxima_consulta).slice(11, 16)}` : "—"}</td>
                      <td className={`px-4 py-3 text-sm ${corPlano}`}>{plano}</td>
                      <td className="px-4 py-3" onClick={parar}><div className="flex justify-end gap-0.5">
                        {link && <a href={link} target="_blank" rel="noopener noreferrer" className="evo-btn-ghost p-2" title="WhatsApp" aria-label={`WhatsApp de ${p.nome}`}><MessageCircle className="w-4 h-4" /></a>}
                        <Link to="/agenda" className="evo-btn-ghost p-2" title="Agendar retorno" aria-label="Agendar retorno"><CalendarPlus className="w-4 h-4" /></Link>
                        <button type="button" onClick={() => enviarFormulario(p)} className="evo-btn-ghost p-2" title="Enviar formulário" aria-label="Enviar formulário"><Send className="w-4 h-4" /></button>
                        <button type="button" onClick={() => setModal(p)} className="evo-btn-ghost p-2" title="Editar" aria-label="Editar"><Pencil className="w-4 h-4" /></button>
                        <button type="button" onClick={() => remove(p)} className="evo-btn-ghost p-2 text-evo-coral" title="Excluir" aria-label="Excluir"><Trash2 className="w-4 h-4" /></button>
                      </div></td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </NutriLayout>
  );
}
