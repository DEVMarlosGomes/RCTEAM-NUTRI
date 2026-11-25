import React, { useState } from "react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/evo-api";
import useDietaConfig from "./dieta/useDietaConfig";

/** Modelo de avaliação ativo do paciente: o escolhido na ficha ou o padrão das configurações. */
export function useModeloAvaliacao(patient) {
  const { config } = useDietaConfig();
  return patient?.modelo_avaliacao || config.modelo_avaliacao_padrao || "rc";
}

export const ROTULO_MODELO = { rc: "RC", donatto: "Donatto" };

/**
 * Chave "Modelo de avaliação: RC | Donatto" (item 17). Vale por paciente e muda Antropometria e Gasto juntos;
 * as medidas são as mesmas, muda só a forma de calcular. Só um modelo ativo por vez.
 */
export default function ModeloAvaliacao({ patient, reload }) {
  const modelo = useModeloAvaliacao(patient);
  const [salvando, setSalvando] = useState(false);
  const trocar = async (novo) => {
    if (novo === modelo || salvando) return;
    setSalvando(true);
    try {
      await api.patch(`/patients/${patient.id}`, { modelo_avaliacao: novo });
      toast.success(`Modelo de avaliação: ${ROTULO_MODELO[novo]}. Avaliações antigas ficam como foram feitas.`);
      await reload?.();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally { setSalvando(false); }
  };
  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="modelo-avaliacao">
      <span className="text-[11px] uppercase tracking-[0.14em] text-gray-500">Modelo de avaliação</span>
      <div role="radiogroup" aria-label="Modelo de avaliação" className="inline-flex rounded-lg bg-white/[0.04] p-0.5 ring-1 ring-white/[0.06]">
        {["rc", "donatto"].map((m) => (
          <button key={m} type="button" role="radio" aria-checked={modelo === m} onClick={() => trocar(m)} disabled={salvando}
            className={`h-8 px-4 rounded-md text-[13px] font-semibold transition-colors ${modelo === m ? "bg-rc-blue text-white" : "text-gray-400 hover:text-white"}`}>
            {ROTULO_MODELO[m]}
          </button>
        ))}
      </div>
      <span className="text-[12px] text-gray-500">{modelo === "rc" ? "Planilha RC: um protocolo de dobras, equação de TMB e calculadora do GET." : "Planilha Donatto: todos os protocolos lado a lado, % de gordura alvo e equações IOM / massa muscular."}</span>
    </div>
  );
}
