import React, { useCallback, useEffect, useState } from "react";
import NutriLayout from "@/components/evonut/NutriLayout";
import { api, formatApiError } from "@/lib/evo-api";
import { Link } from "react-router-dom";
import StatusBadge from "@/components/evonut/StatusBadge";
import { Pencil, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";

const emptyForm = {
  nome: "", telefone: "", email: "", data_nascimento: "", sexo: "",
  objetivo: "", peso: "", altura: "", status_funil: "LEAD_INICIADO",
};

const statuses = [
  "LEAD_INICIADO", "ANAMNESE_COMPLETA", "CONSULTA_AGENDADA",
  "CONSULTA_REALIZADA", "PLANO_ENTREGUE", "EM_ACOMPANHAMENTO",
];

function PatientModal({ patient, onClose, onSaved }) {
  const [form, setForm] = useState(patient ? {
    ...emptyForm,
    ...Object.fromEntries(Object.entries(patient).map(([key, value]) => [key, value ?? ""])),
  } : emptyForm);
  const [saving, setSaving] = useState(false);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        email: form.email || null,
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
            <div className="text-xs uppercase tracking-widest text-evo-purple font-semibold">Cadastro</div>
            <h2 className="evo-h3 mt-1">{patient ? "Editar paciente" : "Novo paciente"}</h2>
          </div>
          <button type="button" onClick={onClose} className="evo-btn-ghost p-2" aria-label="Fechar"><X className="w-4 h-4" /></button>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <label className="md:col-span-2"><span className="evo-label">Nome *</span><input required className="evo-input" value={form.nome} onChange={(e) => set("nome", e.target.value)} /></label>
          <label><span className="evo-label">E-mail</span><input type="email" className="evo-input" value={form.email} onChange={(e) => set("email", e.target.value)} /></label>
          <label><span className="evo-label">Telefone</span><input className="evo-input" value={form.telefone} onChange={(e) => set("telefone", e.target.value)} /></label>
          <label><span className="evo-label">Nascimento</span><input type="date" className="evo-input" value={form.data_nascimento} onChange={(e) => set("data_nascimento", e.target.value)} /></label>
          <label><span className="evo-label">Sexo</span><select className="evo-input" value={form.sexo} onChange={(e) => set("sexo", e.target.value)}><option value="">Não informado</option><option value="F">Feminino</option><option value="M">Masculino</option><option value="O">Outro</option></select></label>
          <label><span className="evo-label">Objetivo</span><input className="evo-input" value={form.objetivo} onChange={(e) => set("objetivo", e.target.value)} placeholder="Ex.: emagrecimento" /></label>
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

export default function Pacientes() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(null);
  const [loading, setLoading] = useState(true);

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

  const filtered = rows.filter((p) => !q || `${p.nome || ""} ${p.email || ""}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <NutriLayout>
      {modal && <PatientModal patient={modal === "new" ? null : modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} />}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div><div className="text-xs uppercase tracking-widest text-evo-purple font-semibold">CRM clínico</div><h1 className="evo-h2 mt-1">Pacientes</h1><p className="text-sm text-gray-400 mt-1">{rows.length} cadastrados</p></div>
        <div className="flex items-center gap-3">
          <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" /><input placeholder="Buscar paciente..." value={q} onChange={(e) => setQ(e.target.value)} className="evo-input pl-10 w-64" /></div>
          <button onClick={() => setModal("new")} className="evo-btn-primary"><Plus className="w-4 h-4" /> Novo paciente</button>
        </div>
      </div>
      <div className="evo-card overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-left">
        <thead className="bg-evo-surface text-xs uppercase tracking-wider text-gray-400"><tr><th className="px-4 py-3">Paciente</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Telefone</th><th className="px-4 py-3">Peso/Altura</th><th className="px-4 py-3">Criado</th><th className="px-4 py-3 text-right">Ações</th></tr></thead>
        <tbody>
          {!loading && filtered.length === 0 && <tr><td colSpan={6} className="text-center px-4 py-12 text-gray-500"><Sparkles className="w-6 h-6 mx-auto text-gray-600 mb-3" />Nenhum paciente encontrado.</td></tr>}
          {loading && <tr><td colSpan={6} className="text-center px-4 py-12 text-gray-500">Carregando...</td></tr>}
          {filtered.map((p, i) => <tr key={p.id} className={`${i % 2 ? "bg-evo-surfaceAlt" : "bg-evo-bg"} border-b border-white/[0.04]`}>
            <td className="px-4 py-3"><div className="font-semibold">{p.nome}</div><div className="text-xs text-gray-500">{p.email || "—"}</div></td>
            <td className="px-4 py-3"><StatusBadge status={p.status_funil} /></td><td className="px-4 py-3 text-sm text-gray-300">{p.telefone || "—"}</td>
            <td className="px-4 py-3 text-sm text-gray-300">{p.peso ? `${p.peso}kg` : "—"} / {p.altura ? `${p.altura}cm` : "—"}</td><td className="px-4 py-3 text-xs text-gray-500">{p.created_at?.split("T")[0]}</td>
            <td className="px-4 py-3"><div className="flex justify-end gap-1"><Link to={`/pacientes/${p.id}`} className="evo-btn-ghost text-xs">Abrir</Link><button onClick={() => setModal(p)} className="evo-btn-ghost p-2" title="Editar"><Pencil className="w-4 h-4" /></button><button onClick={() => remove(p)} className="evo-btn-ghost p-2 text-evo-coral" title="Excluir"><Trash2 className="w-4 h-4" /></button></div></td>
          </tr>)}
        </tbody>
      </table></div></div>
    </NutriLayout>
  );
}
