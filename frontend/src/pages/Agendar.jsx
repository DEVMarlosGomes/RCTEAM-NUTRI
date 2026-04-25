import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, formatApiError } from "@/lib/evo-api";
import GlowOrb from "@/components/evonut/GlowOrb";
import Brand from "@/components/evonut/Brand";
import { CalendarDays, Clock } from "lucide-react";
import { toast } from "sonner";

// Parse "2025-04-26T09:00:00-03:00" → { date: "2025-04-26", time: "09:00" } without TZ shift
function splitIsoLocal(iso) {
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (!m) return { date: "", time: "" };
  return { date: m[1], time: m[2] };
}

export default function Agendar() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [slots, setSlots] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get(`/public/slots/${token}`).then((r) => setSlots(r.data || []))
      .catch(() => toast.error("Erro ao carregar horários"));
  }, [token]);

  const submit = async () => {
    if (!selected) {
      toast.error("Escolha um horário");
      return;
    }
    setLoading(true);
    try {
      const { date, time } = splitIsoLocal(selected.datetime);
      await api.post("/public/schedule", { token, date, time });
      toast.success("Consulta agendada!");
      navigate(`/sucesso/${token}`);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  };

  // group by day. Label format: "DD/MM · HH:00 (BRT)"
  const byDay = slots.reduce((acc, s) => {
    const dayPart = s.label.split(" · ")[0];
    acc[dayPart] = acc[dayPart] || [];
    acc[dayPart].push(s);
    return acc;
  }, {});

  return (
    <div className="min-h-screen relative bg-rc-ink overflow-hidden">
      <GlowOrb color="#0081FD" size={400} top="0%" left="80%" opacity={0.18} />

      <header className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 pt-6 pb-4 flex items-center justify-between">
        <Link to="/" aria-label="Voltar"><Brand size="sm" /></Link>
        <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">America/São Paulo (BRT)</div>
      </header>

      <main className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 pb-16">
        <div className="text-xs uppercase tracking-[0.25em] text-rc-blue font-bold mb-2">Agendamento</div>
        <h1 className="rc-h2">Escolha seu horário</h1>
        <p className="text-sm text-gray-400 mt-1">Slots em tempo real, em horário de Brasília. Escolha o melhor para você.</p>

        <div className="mt-8 space-y-5">
          {Object.entries(byDay).map(([day, list]) => (
            <div key={day} className="rc-card p-5 animate-fade-up">
              <div className="flex items-center gap-2 mb-4">
                <CalendarDays className="w-4 h-4 text-rc-blue" />
                <span className="font-display font-bold uppercase tracking-wider text-sm">{day}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {list.map((s) => {
                  const { time } = splitIsoLocal(s.datetime);
                  const isSel = selected?.datetime === s.datetime;
                  return (
                    <button
                      key={s.datetime}
                      data-testid={`slot-${s.datetime}`}
                      onClick={() => s.available && setSelected(s)}
                      disabled={!s.available}
                      className={`px-4 py-2 rounded-full text-sm font-bold uppercase tracking-wider border transition-all ${
                        !s.available
                          ? "border-white/[0.05] text-gray-600 line-through cursor-not-allowed"
                          : isSel
                            ? "bg-rc-blue text-black border-transparent shadow-[0_4px_14px_rgba(0,129,253,0.5)]"
                            : "border-white/[0.08] text-gray-200 hover:border-rc-blue/60 hover:text-rc-blue"
                      }`}
                    >
                      <Clock className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
                      {time}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {Object.keys(byDay).length === 0 && (
            <div className="rc-card p-10 text-center text-sm text-gray-500">Carregando horários disponíveis…</div>
          )}
        </div>

        <div className="mt-8 flex flex-col sm:flex-row items-center justify-between gap-3 rc-glass rounded-xl p-5">
          <div className="text-sm text-gray-300">
            {selected ? <>Selecionado: <span className="text-white font-bold">{selected.label}</span></> : "Escolha um horário acima"}
          </div>
          <button data-testid="confirm-schedule" onClick={submit} disabled={!selected || loading} className="rc-btn-primary">
            {loading ? "Confirmando..." : "Confirmar agendamento"}
          </button>
        </div>
      </main>
    </div>
  );
}
