import React, { useEffect, useState } from "react";
import NutriLayout from "@/components/evonut/NutriLayout";
import { api } from "@/lib/evo-api";
import { Link } from "react-router-dom";
import StatusBadge from "@/components/evonut/StatusBadge";
import { Search, Sparkles } from "lucide-react";

export default function Pacientes() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    api.get("/patients").then((r) => setRows(r.data || []));
  }, []);

  const filtered = rows.filter((p) =>
    !q ||
    (p.nome || "").toLowerCase().includes(q.toLowerCase()) ||
    (p.email || "").toLowerCase().includes(q.toLowerCase())
  );

  return (
    <NutriLayout>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <div className="text-xs uppercase tracking-widest text-evo-purple font-semibold">CRM clínico</div>
          <h1 className="evo-h2 mt-1">Pacientes</h1>
          <p className="text-sm text-gray-400 mt-1">{rows.length} cadastrados</p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            data-testid="search-patient"
            placeholder="Buscar paciente..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="evo-input pl-10 w-64"
          />
        </div>
      </div>

      <div className="evo-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-evo-surface text-xs uppercase tracking-wider text-gray-400">
              <tr>
                <th className="px-4 py-3 font-semibold">Paciente</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Telefone</th>
                <th className="px-4 py-3 font-semibold">Peso/Altura</th>
                <th className="px-4 py-3 font-semibold">Criado</th>
                <th className="px-4 py-3 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="text-center px-4 py-12 text-gray-500">
                  <Sparkles className="w-6 h-6 mx-auto text-gray-600 mb-3" />
                  Nenhum paciente encontrado.
                </td></tr>
              )}
              {filtered.map((p, i) => (
                <tr key={p.id} className={`${i % 2 ? "bg-evo-surfaceAlt" : "bg-evo-bg"} hover:bg-white/[0.03] transition-colors border-b border-white/[0.04]`}>
                  <td className="px-4 py-3">
                    <div className="font-semibold">{p.nome}</div>
                    <div className="text-xs text-gray-500">{p.email || "—"}</div>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={p.status_funil} /></td>
                  <td className="px-4 py-3 text-sm text-gray-300">{p.telefone}</td>
                  <td className="px-4 py-3 text-sm text-gray-300">
                    {p.peso ? `${p.peso}kg` : "—"} / {p.altura ? `${p.altura}cm` : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{p.created_at?.split("T")[0]}</td>
                  <td className="px-4 py-3 text-right">
                    <Link data-testid={`open-patient-${p.id}`} to={`/pacientes/${p.id}`} className="evo-btn-ghost text-xs">Abrir</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </NutriLayout>
  );
}
