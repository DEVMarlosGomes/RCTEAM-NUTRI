import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, formatApiError } from "@/lib/evo-api";
import GlowOrb from "@/components/evonut/GlowOrb";
import { CalendarDays, Sparkles, Clock } from "lucide-react";
import { toast } from "sonner";

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
      const dt = new Date(selected.datetime);
      const date = dt.toISOString().split("T")[0];
      const time = dt.toISOString().split("T")[1].slice(0, 5);
      await api.post("/public/schedule", { token, date, time });
      toast.success("Consulta agendada!");
      navigate(`/sucesso/${token}`);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  };

  // group by day
  const byDay = slots.reduce((acc, s) => {
    const day = s.label.split(" ")[0];
    acc[day] = acc[day] || [];
    acc[day].push(s);
    return acc;
  }, {});

  return (
    <div className="min-h-screen relative bg-evo-bg overflow-hidden">
      <GlowOrb color="#1DB97E" size={400} top="0%" left="80%" opacity={0.25} />

      <header className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 pt-6 pb-4 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-evo-purple to-evo-teal flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <span className="font-display font-semibold">EvoNut</span>
        </Link>
      </header>

      <main className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 pb-16">
        <div className="text-xs uppercase tracking-widest text-evo-purple font-semibold mb-2">Agendamento</div>
        <h1 className="evo-h2">Escolha o melhor horário</h1>
        <p className="text-sm text-gray-400 mt-1">Os slots são atualizados em tempo real conforme a agenda da sua nutricionista.</p>

        <div className="mt-8 space-y-5">
          {Object.entries(byDay).map(([day, list]) => (
            <div key={day} className="evo-card p-5 animate-fade-up">
              <div className="flex items-center gap-2 mb-4">
                <CalendarDays className="w-4 h-4 text-evo-purple" />
                <span className="font-semibold">{day}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {list.map((s) => {
                  const time = s.label.split(" ")[1];
                  const isSel = selected?.datetime === s.datetime;
                  return (
                    <button
                      key={s.datetime}
                      data-testid={`slot-${s.datetime}`}
                      onClick={() => s.available && setSelected(s)}
                      disabled={!s.available}
                      className={`px-4 py-2 rounded-full text-sm font-semibold border transition-all ${
                        !s.available
                          ? "border-white/[0.05] text-gray-600 line-through cursor-not-allowed"
                          : isSel
                            ? "bg-gradient-to-br from-evo-purple to-evo-teal text-white border-transparent shadow-[0_4px_14px_rgba(123,97,255,0.4)]"
                            : "border-white/[0.08] text-gray-200 hover:border-evo-purple/50 hover:text-white"
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
        </div>

        <div className="mt-8 flex flex-col sm:flex-row items-center justify-between gap-3 evo-glass rounded-xl p-5">
          <div className="text-sm text-gray-300">
            {selected ? <>Selecionado: <span className="text-white font-semibold">{selected.label}</span></> : "Escolha um horário acima"}
          </div>
          <button data-testid="confirm-schedule" onClick={submit} disabled={!selected || loading} className="evo-btn-primary">
            {loading ? "Confirmando..." : "Confirmar agendamento"}
          </button>
        </div>
      </main>
    </div>
  );
}
