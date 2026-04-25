import React from "react";

const styles = {
  LEAD_INICIADO: "bg-white/10 text-white",
  ANAMNESE_COMPLETA: "bg-evo-purple/15 text-evo-purple",
  CONSULTA_AGENDADA: "bg-evo-amber/15 text-evo-amber",
  CONSULTA_REALIZADA: "bg-evo-teal/15 text-evo-teal",
  PLANO_ENTREGUE: "bg-evo-teal/15 text-evo-teal",
  EM_ACOMPANHAMENTO: "bg-evo-purple/15 text-evo-purple",
};

const labels = {
  LEAD_INICIADO: "Lead",
  ANAMNESE_COMPLETA: "Anamnese OK",
  CONSULTA_AGENDADA: "Agendada",
  CONSULTA_REALIZADA: "Realizada",
  PLANO_ENTREGUE: "Plano Entregue",
  EM_ACOMPANHAMENTO: "Acompanhamento",
};

export default function StatusBadge({ status, ...props }) {
  const cls = styles[status] || "bg-white/10 text-white";
  return (
    <span
      data-testid={`status-badge-${status}`}
      className={`px-3 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wide inline-flex items-center gap-1.5 ${cls}`}
      {...props}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {labels[status] || status}
    </span>
  );
}
