import React, { useEffect, useState } from "react";
import NutriLayout from "@/components/evonut/NutriLayout";
import { api, formatApiError } from "@/lib/evo-api";
import { Link } from "react-router-dom";
import { CalendarDays, Sparkles } from "lucide-react";
import { toast } from "sonner";

export default function Agenda() {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    api.get("/agenda").then((r) => setRows(r.data || []))
      .catch((e) => toast.error(formatApiError(e.response?.data?.detail)));
  }, []);

  // group by date
  const groups = rows.reduce((acc, r) => {
    const d = r.data_hora?.split("T")[0] || "—";
    acc[d] = acc[d] || [];
    acc[d].push(r);
    return acc;
  }, {});

  return (
    <NutriLayout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="text-xs uppercase tracking-widest text-evo-purple font-semibold">Calendário</div>
          <h1 className="evo-h2 mt-1">Agenda</h1>
        </div>
      </div>

      <div className="space-y-4">
        {Object.entries(groups).length === 0 && (
          <div className="evo-card p-12 text-center text-gray-500">
            <Sparkles className="w-6 h-6 mx-auto mb-3 text-gray-600" /> Nenhuma consulta agendada.
          </div>
        )}
        {Object.entries(groups).map(([d, list]) => (
          <div key={d} className="evo-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <CalendarDays className="w-4 h-4 text-evo-purple" />
              <span className="font-semibold">{new Date(d).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}</span>
            </div>
            <div className="space-y-2">
              {list.map((c) => (
                <div key={c.id} data-testid={`appointment-${c.id}`} className="flex items-center gap-4 p-3 rounded-lg bg-evo-bg border border-white/[0.04]">
                  <div className="font-display text-lg font-semibold w-16 text-evo-teal">{c.data_hora?.split("T")[1]?.slice(0, 5)}</div>
                  <div className="flex-1">
                    <Link to={`/pacientes/${c.paciente_id}`} className="font-semibold hover:text-evo-purple">{c.paciente_nome}</Link>
                    <div className="text-xs text-gray-400">{c.tipo}</div>
                  </div>
                  <div className="text-xs px-2 py-1 rounded-full bg-evo-amber/15 text-evo-amber font-semibold uppercase">{c.status}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </NutriLayout>
  );
}
