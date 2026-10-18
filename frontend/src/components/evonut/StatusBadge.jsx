import React from "react";

// Jornada do paciente: neutro (lead) -> azul (em processo) -> ambar (agendado) -> lima (resultado)
const styles = {
  LEAD_INICIADO: "bg-white/[0.06] text-gray-300",
  ANAMNESE_COMPLETA: "bg-rc-blue/[0.14] text-rc-blueLight",
  CONSULTA_AGENDADA: "bg-rc-amber/[0.13] text-rc-amber",
  CONSULTA_REALIZADA: "bg-rc-blue/[0.14] text-rc-blueLight",
  PLANO_ENTREGUE: "bg-rc-lime/[0.12] text-rc-lime",
  EM_ACOMPANHAMENTO: "bg-rc-lime/[0.12] text-rc-lime",
};

const labels = {
  LEAD_INICIADO: "Lead",
  ANAMNESE_COMPLETA: "Anamnese ok",
  CONSULTA_AGENDADA: "Agendada",
  CONSULTA_REALIZADA: "Consulta feita",
  PLANO_ENTREGUE: "Plano entregue",
  EM_ACOMPANHAMENTO: "Acompanhamento",
};

export const STATUS_LABELS = labels;

export default function StatusBadge({ status, ...props }) {
  const cls = styles[status] || "bg-white/[0.06] text-gray-300";
  return (
    <span
      data-testid={`status-badge-${status}`}
      className={`rc-chip whitespace-nowrap ${cls}`}
      {...props}
    >
      <span className="w-1.5 h-1.5 rounded-[2px] bg-current" />
      {labels[status] || status}
    </span>
  );
}
