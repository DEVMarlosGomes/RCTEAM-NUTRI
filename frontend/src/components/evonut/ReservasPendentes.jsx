import React, { useCallback, useEffect, useState } from "react";
import { CheckCircle2, FileText } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/evo-api";

/** Reservas de consulta (ajuste fn2): Pix com comprovante para conferir e confirmar. Cartão confirma sozinho pelo webhook. */
const ROTULO = { aguardando_pagamento: "aguardando pagamento", comprovante_enviado: "comprovante para conferir", confirmada: "confirmada", expirada: "expirou" };
const quando = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.slice(11, 16)}` : "—");

export default function ReservasPendentes({ onConfirmada }) {
  const [rows, setRows] = useState(null);
  const load = useCallback(() => { api.get("/reservas").then((r) => setRows(r.data || [])).catch(() => setRows([])); }, []);
  useEffect(() => { load(); }, [load]);

  const verComprovante = async (r) => {
    try {
      const { data } = await api.get(`/reservas/${r.id}/comprovante`);
      const w = window.open();
      if (w) w.document.write(data.data_url.startsWith("data:application/pdf") ? `<iframe src="${data.data_url}" style="border:0;width:100%;height:100vh"></iframe>` : `<img src="${data.data_url}" style="max-width:100%">`);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const confirmar = async (r) => {
    if (!window.confirm(`Confirmar o pagamento de ${r.nome} e agendar ${quando(r.data_hora)}?`)) return;
    try {
      await api.post(`/reservas/${r.id}/confirmar`);
      toast.success("Consulta confirmada, pagamento registrado e formulário enviado.");
      load(); onConfirmada?.();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const abertas = (rows || []).filter((r) => ["comprovante_enviado", "aguardando_pagamento"].includes(r.status));
  if (!rows || abertas.length === 0) return null;
  return (
    <section className="rc-card mt-5" data-testid="reservas-pendentes">
      <div className="px-5 pb-3 pt-5 sm:px-6">
        <h2 className="text-[15px] font-semibold text-white">Reservas de consulta</h2>
        <p className="text-[12.5px] text-gray-400">Só vira consulta depois do pagamento. Pix: confira o comprovante e confirme.</p>
      </div>
      <ul className="divide-y divide-white/[0.05]">
        {abertas.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3 sm:px-6">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-white">{r.nome}</div>
              <div className="text-[12.5px] text-gray-400">{quando(r.data_hora)} · {r.modalidade} · <span className={r.status === "comprovante_enviado" ? "text-rc-amber" : ""}>{ROTULO[r.status] || r.status}</span>
                {r.status === "aguardando_pagamento" && ` · ${Math.ceil(r.segundos / 60)} min restantes`}</div>
            </div>
            {r.tem_comprovante && <button type="button" className="rc-btn-ghost h-9 text-[12.5px]" onClick={() => verComprovante(r)}><FileText className="h-4 w-4" /> Ver comprovante</button>}
            {r.status === "comprovante_enviado" && <button type="button" className="rc-btn-primary h-9 text-[12.5px]" onClick={() => confirmar(r)} data-testid={`confirmar-${r.id}`}><CheckCircle2 className="h-4 w-4" /> Confirmar pagamento</button>}
          </li>
        ))}
      </ul>
    </section>
  );
}
