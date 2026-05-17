import React, { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/evo-api";
import { BellRing, Plus, Trash2, Send, Power, PowerOff, Loader2, Clock } from "lucide-react";
import { toast } from "sonner";

const WEEKDAYS = [
  { v: 0, l: "Seg" }, { v: 1, l: "Ter" }, { v: 2, l: "Qua" },
  { v: 3, l: "Qui" }, { v: 4, l: "Sex" }, { v: 5, l: "Sáb" }, { v: 6, l: "Dom" },
];

export default function NudgeManager({ patientId }) {
  const [nudges, setNudges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [firing, setFiring] = useState(null);
  const [form, setForm] = useState({
    label: "",
    trigger_text: "",
    hour: 9,
    minute: 0,
    weekdays: null,
  });

  const reload = () => {
    setLoading(true);
    api.get(`/patients/${patientId}/nudges`)
      .then((r) => setNudges(r.data || []))
      .catch((e) => toast.error(formatApiError(e.response?.data?.detail)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { reload(); }, [patientId]);

  const onCreate = async (e) => {
    e.preventDefault();
    if (!form.label.trim() || !form.trigger_text.trim()) {
      toast.error("Preencha rótulo e instrução");
      return;
    }
    setCreating(true);
    try {
      await api.post(`/patients/${patientId}/nudges`, {
        label: form.label,
        trigger_text: form.trigger_text,
        hour: Number(form.hour),
        minute: Number(form.minute),
        weekdays: form.weekdays && form.weekdays.length ? form.weekdays : null,
        active: true,
      });
      toast.success("Lembrete criado");
      setForm({ label: "", trigger_text: "", hour: 9, minute: 0, weekdays: null });
      reload();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setCreating(false);
    }
  };

  const onToggle = async (n) => {
    try {
      await api.patch(`/patients/${patientId}/nudges/${n.id}`, { active: !n.active });
      reload();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  const onDelete = async (n) => {
    if (!window.confirm(`Remover "${n.label}"?`)) return;
    try {
      await api.delete(`/patients/${patientId}/nudges/${n.id}`);
      toast.success("Lembrete removido");
      reload();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  const onFireNow = async (n) => {
    setFiring(n.id);
    try {
      const { data } = await api.post(`/patients/${patientId}/nudges/${n.id}/run-now`);
      toast.success("Mensagem enviada ao paciente");
      // Show the generated message briefly
      console.log("Generated:", data.message);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setFiring(null);
    }
  };

  const toggleWeekday = (v) => {
    setForm((f) => {
      const wd = f.weekdays || [];
      if (wd.includes(v)) return { ...f, weekdays: wd.filter((x) => x !== v) };
      return { ...f, weekdays: [...wd, v].sort() };
    });
  };

  return (
    <div className="space-y-5" data-testid="nudge-manager">
      <div className="evo-card p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-lg bg-emerald-400/15 border border-emerald-400/30 flex items-center justify-center">
            <BellRing className="w-4 h-4 text-emerald-300" />
          </div>
          <div>
            <h3 className="font-display font-black text-lg tracking-wide">Lembretes pró-ativos (Agente 3)</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Configure mensagens automáticas que a IA enviará ao paciente nos horários definidos (BRT).
            </p>
          </div>
        </div>

        <form onSubmit={onCreate} className="grid sm:grid-cols-2 gap-3" data-testid="nudge-form">
          <div className="sm:col-span-2">
            <label className="rc-label">Rótulo (uso interno)</label>
            <input
              data-testid="nudge-label"
              className="rc-input"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="Ex: Hidratação 14h"
              maxLength={120}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="rc-label">Instrução para a IA</label>
            <textarea
              data-testid="nudge-trigger-text"
              className="rc-input min-h-[70px] text-sm"
              value={form.trigger_text}
              onChange={(e) => setForm({ ...form, trigger_text: e.target.value })}
              placeholder="Ex: Lembre o paciente de tomar 500ml de água e perguntar como está a fome."
              maxLength={1000}
            />
            <p className="text-[11px] text-gray-500 mt-1">
              Isto NÃO é o texto enviado ao paciente — é a diretriz interna. A IA compõe uma mensagem natural baseada nela.
            </p>
          </div>
          <div>
            <label className="rc-label flex items-center gap-1"><Clock className="w-3 h-3" /> Hora</label>
            <select data-testid="nudge-hour" className="rc-input" value={form.hour} onChange={(e) => setForm({ ...form, hour: e.target.value })}>
              {Array.from({ length: 24 }).map((_, i) => <option key={i} value={i}>{i.toString().padStart(2, "0")}h</option>)}
            </select>
          </div>
          <div>
            <label className="rc-label">Minuto</label>
            <select data-testid="nudge-minute" className="rc-input" value={form.minute} onChange={(e) => setForm({ ...form, minute: e.target.value })}>
              {[0, 15, 30, 45].map((m) => <option key={m} value={m}>{m.toString().padStart(2, "0")}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="rc-label">Dias da semana <span className="text-gray-500 font-normal">(vazio = todos os dias)</span></label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {WEEKDAYS.map((w) => {
                const on = (form.weekdays || []).includes(w.v);
                return (
                  <button
                    key={w.v}
                    type="button"
                    data-testid={`nudge-wd-${w.v}`}
                    onClick={() => toggleWeekday(w.v)}
                    className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all border ${
                      on
                        ? "bg-emerald-400/20 text-emerald-300 border-emerald-400/40"
                        : "border-white/10 text-gray-400 hover:text-white hover:border-white/20"
                    }`}
                  >
                    {w.l}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="sm:col-span-2 flex justify-end">
            <button
              data-testid="nudge-create-submit"
              type="submit"
              disabled={creating}
              className="rc-btn-primary"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Criar lembrete
            </button>
          </div>
        </form>
      </div>

      <div className="evo-card p-5" data-testid="nudge-list">
        <h4 className="font-bold uppercase tracking-wider text-xs text-gray-300 mb-3">
          Lembretes ativos · {nudges.length}
        </h4>
        {loading ? (
          <div className="text-center py-6 text-gray-500 text-sm">
            <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Carregando…
          </div>
        ) : nudges.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-6">Nenhum lembrete configurado ainda.</p>
        ) : (
          <ul className="space-y-2">
            {nudges.map((n) => (
              <li
                key={n.id}
                data-testid={`nudge-row-${n.id}`}
                className={`flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-lg border ${
                  n.active ? "bg-white/[0.02] border-white/5" : "bg-white/[0.01] border-white/[0.03] opacity-60"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <BellRing className={`w-3.5 h-3.5 ${n.active ? "text-emerald-300" : "text-gray-500"} flex-shrink-0`} />
                    <span className="font-bold text-sm truncate">{n.label}</span>
                    <span className="text-[10px] uppercase tracking-wider text-gray-500 font-bold whitespace-nowrap">
                      {n.hour.toString().padStart(2, "0")}:{n.minute.toString().padStart(2, "0")} BRT
                    </span>
                    {n.weekdays && n.weekdays.length > 0 && (
                      <span className="text-[10px] text-gray-500">
                        · {n.weekdays.map((v) => WEEKDAYS[v].l).join(" ")}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-400 mt-1 line-clamp-2 pl-5">{n.trigger_text}</div>
                  {n.last_fired_at && (
                    <div className="text-[10px] text-gray-500 mt-1 pl-5">
                      Último envio: {new Date(n.last_fired_at).toLocaleString("pt-BR")}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    data-testid={`nudge-fire-${n.id}`}
                    onClick={() => onFireNow(n)}
                    disabled={firing === n.id}
                    title="Enviar agora"
                    className="rc-btn-ghost p-2"
                  >
                    {firing === n.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                  <button
                    data-testid={`nudge-toggle-${n.id}`}
                    onClick={() => onToggle(n)}
                    title={n.active ? "Pausar" : "Ativar"}
                    className="rc-btn-ghost p-2"
                  >
                    {n.active ? <Power className="w-4 h-4 text-emerald-300" /> : <PowerOff className="w-4 h-4 text-gray-500" />}
                  </button>
                  <button
                    data-testid={`nudge-delete-${n.id}`}
                    onClick={() => onDelete(n)}
                    title="Remover"
                    className="rc-btn-ghost p-2 hover:text-red-400"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
