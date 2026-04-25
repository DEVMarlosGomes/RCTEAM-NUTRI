import React, { useEffect, useState } from "react";
import NutriLayout from "@/components/evonut/NutriLayout";
import { api } from "@/lib/evo-api";
import { Link } from "react-router-dom";
import { Users, CalendarCheck, Sparkles, TrendingUp, ArrowUpRight } from "lucide-react";
import StatusBadge from "@/components/evonut/StatusBadge";

const STATS = [
  { k: "total_pacientes", l: "Total de pacientes", icon: Users, color: "from-evo-purple/30 to-evo-purple/10" },
  { k: "consultas_hoje", l: "Consultas hoje", icon: CalendarCheck, color: "from-evo-teal/30 to-evo-teal/10" },
  { k: "novos_7d", l: "Novos (7 dias)", icon: TrendingUp, color: "from-evo-amber/30 to-evo-amber/10" },
  { k: "em_acompanhamento", l: "Em acompanhamento", icon: Sparkles, color: "from-evo-coral/30 to-evo-coral/10" },
];

export default function Dashboard() {
  const [stats, setStats] = useState({});
  const [patients, setPatients] = useState([]);
  const [agenda, setAgenda] = useState([]);

  useEffect(() => {
    api.get("/dashboard").then((r) => setStats(r.data));
    api.get("/patients").then((r) => setPatients((r.data || []).slice(0, 6)));
    api.get("/agenda").then((r) => setAgenda((r.data || []).filter((c) => c.status === "AGENDADA").slice(0, 5)));
  }, []);

  return (
    <NutriLayout>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <div className="text-xs uppercase tracking-widest text-evo-purple font-semibold">Painel clínico</div>
          <h1 className="evo-h2 mt-1">Dashboard</h1>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {STATS.map((s) => (
          <div key={s.k} data-testid={`stat-${s.k}`} className="evo-card evo-card-hover p-5 relative overflow-hidden">
            <div className={`absolute -top-8 -right-8 w-32 h-32 rounded-full bg-gradient-to-br ${s.color} blur-2xl opacity-60 pointer-events-none`} />
            <s.icon className="w-5 h-5 text-evo-purple" />
            <div className="font-display text-3xl font-semibold mt-4">{stats[s.k] ?? "—"}</div>
            <div className="text-xs text-gray-400 mt-1">{s.l}</div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-5 mt-8">
        <div className="lg:col-span-2 evo-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="evo-h3">Pacientes recentes</h3>
              <p className="text-xs text-gray-400 mt-1">Os 6 mais recentes</p>
            </div>
            <Link to="/pacientes" data-testid="goto-patients" className="evo-btn-ghost text-sm">Ver todos <ArrowUpRight className="w-3.5 h-3.5" /></Link>
          </div>
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-gray-400">
                  <th className="px-3 py-2 font-semibold">Paciente</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Telefone</th>
                  <th className="px-3 py-2 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {patients.length === 0 && (
                  <tr><td colSpan={4} className="px-3 py-8 text-center text-gray-500 text-sm">Nenhum paciente ainda. Compartilhe seu link público.</td></tr>
                )}
                {patients.map((p, i) => (
                  <tr key={p.id} data-testid={`patient-row-${p.id}`} className={`${i % 2 ? "bg-evo-surfaceAlt" : "bg-evo-bg"} hover:bg-white/[0.03] transition-colors border-b border-white/[0.04]`}>
                    <td className="px-3 py-3">
                      <div className="font-semibold">{p.nome}</div>
                      <div className="text-xs text-gray-500">{p.email || "—"}</div>
                    </td>
                    <td className="px-3 py-3"><StatusBadge status={p.status_funil} /></td>
                    <td className="px-3 py-3 text-sm text-gray-300">{p.telefone}</td>
                    <td className="px-3 py-3 text-right">
                      <Link to={`/pacientes/${p.id}`} className="evo-btn-ghost text-xs">Abrir</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="evo-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="evo-h3">Próximas consultas</h3>
            <Link to="/agenda" className="evo-btn-ghost text-sm">Ver agenda</Link>
          </div>
          <div className="space-y-3">
            {agenda.length === 0 && <div className="text-sm text-gray-500 py-6 text-center">Nenhuma consulta agendada.</div>}
            {agenda.map((c) => (
              <div key={c.id} className="p-3 rounded-lg border border-white/[0.06] bg-evo-bg">
                <div className="text-xs text-gray-400">{new Date(c.data_hora).toLocaleString("pt-BR")}</div>
                <div className="font-semibold mt-1">{c.paciente_nome}</div>
                <div className="text-xs text-evo-teal mt-1">{c.tipo}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-8 evo-card p-5">
        <h3 className="evo-h3 mb-4">Funil CRM</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {Object.entries(stats.funil || {}).map(([k, v]) => (
            <div key={k} className="p-4 rounded-lg bg-evo-bg border border-white/[0.06]">
              <div className="text-xs text-gray-400 uppercase tracking-wide">{k.replaceAll("_", " ")}</div>
              <div className="font-display text-2xl font-semibold mt-1">{v}</div>
            </div>
          ))}
        </div>
      </div>
    </NutriLayout>
  );
}
