import React from "react";

const styles = {
  LEAD_INICIADO: "bg-white/10 text-white",
  ANAMNESE_COMPLETA: "bg-rc-blue/15 text-rc-blue",
  CONSULTA_AGENDADA: "bg-amber-400/15 text-amber-300",
  CONSULTA_REALIZADA: "bg-emerald-400/15 text-emerald-300",
  PLANO_ENTREGUE: "bg-rc-blue/20 text-rc-blue",
  EM_ACOMPANHAMENTO: "bg-rc-blueLight/15 text-rc-blueLight",
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
      className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.15em] inline-flex items-center gap-1.5 ${cls}`}
      {...props}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {labels[status] || status}
    </span>
  );
}
