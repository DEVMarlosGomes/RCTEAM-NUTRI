import React, { useCallback, useEffect, useState } from "react";
import NutriLayout from "@/components/evonut/NutriLayout";
import { api, formatApiError } from "@/lib/evo-api";
import { Link } from "react-router-dom";
import { CalendarDays, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";

const emptyForm = { paciente_id: "", date: "", time: "09:00", tipo: "Consulta inicial", status: "AGENDADA", observacoes: "" };
const consultationStatuses = ["AGENDADA", "CONFIRMADA", "REALIZADA", "CANCELADA", "FALTOU"];

function AgendaModal({ consultation, patients, onClose, onSaved }) {
  const [form, setForm] = useState(() => {
    if (!consultation) return emptyForm;
    const [date, rawTime = "09:00"] = (consultation.data_hora || "").split("T");
    return { paciente_id: consultation.paciente_id, date, time: rawTime.slice(0, 5), tipo: consultation.tipo || "", status: consultation.status || "AGENDADA", observacoes: consultation.observacoes || "" };
  });
  const [saving, setSaving] = useState(false);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const save = async (event) => {
    event.preventDefault(); setSaving(true);
    try {
      if (consultation) await api.patch(`/agenda/${consultation.id}`, form);
      else await api.post("/agenda", form);
      toast.success(consultation ? "Consulta atualizada." : "Consulta agendada.");
      onSaved();
    } catch (error) { toast.error(formatApiError(error.response?.data?.detail)); }
    finally { setSaving(false); }
  };
  return <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
    <form onSubmit={save} className="evo-card p-6 w-full max-w-2xl">
      <div className="flex justify-between items-center mb-5"><div><div className="text-xs uppercase tracking-widest text-evo-purple font-semibold">Agenda</div><h2 className="evo-h3 mt-1">{consultation ? "Editar consulta" : "Nova consulta"}</h2></div><button type="button" className="evo-btn-ghost p-2" onClick={onClose}><X className="w-4 h-4" /></button></div>
      <div className="grid md:grid-cols-2 gap-4">
        <label className="md:col-span-2"><span className="evo-label">Paciente *</span><select required disabled={Boolean(consultation)} className="evo-input" value={form.paciente_id} onChange={(e) => set("paciente_id", e.target.value)}><option value="">Selecione...</option>{patients.map((p) => <option key={p.id} value={p.id}>{p.nome} {p.email ? `— ${p.email}` : ""}</option>)}</select></label>
        <label><span className="evo-label">Data *</span><input required type="date" className="evo-input" value={form.date} onChange={(e) => set("date", e.target.value)} /></label>
        <label><span className="evo-label">Horário *</span><input required type="time" className="evo-input" value={form.time} onChange={(e) => set("time", e.target.value)} /></label>
        <label><span className="evo-label">Tipo</span><input className="evo-input" value={form.tipo} onChange={(e) => set("tipo", e.target.value)} /></label>
        <label><span className="evo-label">Status</span><select className="evo-input" value={form.status} onChange={(e) => set("status", e.target.value)}>{consultationStatuses.map((status) => <option key={status}>{status}</option>)}</select></label>
        <label className="md:col-span-2"><span className="evo-label">Observações</span><textarea rows={3} className="evo-input" value={form.observacoes} onChange={(e) => set("observacoes", e.target.value)} /></label>
      </div>
      <div className="flex justify-end gap-3 mt-6"><button type="button" onClick={onClose} className="evo-btn-secondary">Cancelar</button><button disabled={saving} className="evo-btn-primary">{saving ? "Salvando..." : "Salvar consulta"}</button></div>
    </form>
  </div>;
}

export default function Agenda() {
  const [rows, setRows] = useState([]);
  const [patients, setPatients] = useState([]);
  const [modal, setModal] = useState(null);
  const load = useCallback(async () => {
    try {
      const [agendaResponse, patientsResponse] = await Promise.all([api.get("/agenda"), api.get("/patients")]);
      setRows(agendaResponse.data || []); setPatients(patientsResponse.data || []);
    } catch (error) { toast.error(formatApiError(error.response?.data?.detail)); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const remove = async (item) => {
    if (!window.confirm(`Excluir a consulta de ${item.paciente_nome}?`)) return;
    try { await api.delete(`/agenda/${item.id}`); toast.success("Consulta excluída."); load(); }
    catch (error) { toast.error(formatApiError(error.response?.data?.detail)); }
  };
  const groups = rows.reduce((acc, item) => { const date = item.data_hora?.split("T")[0] || "—"; (acc[date] ||= []).push(item); return acc; }, {});
  return <NutriLayout>
    {modal && <AgendaModal consultation={modal === "new" ? null : modal} patients={patients} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} />}
    <div className="flex items-center justify-between mb-6"><div><div className="text-xs uppercase tracking-widest text-evo-purple font-semibold">Calendário</div><h1 className="evo-h2 mt-1">Agenda</h1></div><button className="evo-btn-primary" onClick={() => setModal("new")}><Plus className="w-4 h-4" /> Nova consulta</button></div>
    <div className="space-y-4">
      {Object.keys(groups).length === 0 && <div className="evo-card p-12 text-center text-gray-500"><Sparkles className="w-6 h-6 mx-auto mb-3 text-gray-600" />Nenhuma consulta cadastrada.</div>}
      {Object.entries(groups).map(([date, list]) => <div key={date} className="evo-card p-5"><div className="flex items-center gap-2 mb-3"><CalendarDays className="w-4 h-4 text-evo-purple" /><span className="font-semibold">{new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}</span></div><div className="space-y-2">
        {list.map((item) => <div key={item.id} className="flex items-center gap-4 p-3 rounded-lg bg-evo-bg border border-white/[0.04]"><div className="font-display text-lg font-semibold w-16 text-evo-teal">{item.data_hora?.split("T")[1]?.slice(0, 5)}</div><div className="flex-1"><Link to={`/pacientes/${item.paciente_id}`} className="font-semibold hover:text-evo-purple">{item.paciente_nome}</Link><div className="text-xs text-gray-400">{item.tipo}{item.observacoes ? ` · ${item.observacoes}` : ""}</div></div><div className="text-xs px-2 py-1 rounded-full bg-evo-amber/15 text-evo-amber font-semibold uppercase">{item.status}</div><button onClick={() => setModal(item)} className="evo-btn-ghost p-2" title="Editar"><Pencil className="w-4 h-4" /></button><button onClick={() => remove(item)} className="evo-btn-ghost p-2 text-evo-coral" title="Excluir"><Trash2 className="w-4 h-4" /></button></div>)}
      </div></div>)}
    </div>
  </NutriLayout>;
}
