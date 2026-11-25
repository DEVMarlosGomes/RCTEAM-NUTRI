import React from "react";
import { Check, Star } from "lucide-react";

/** Objetivos pré-selecionáveis (mesma lista da pergunta 7 do formulário, em anamnese_form.py). */
export const OBJETIVOS = ["Ganho de massa muscular", "Definição muscular", "Perda de gordura", "Rendimento esportivo",
  "Manutenção de peso", "Tratamento de doenças", "Reeducação alimentar"];

/**
 * Marca mais de um objetivo e escolhe o principal (★). `valor` = lista marcada; `principal` = um deles.
 * Ao desmarcar o principal, o próximo marcado assume. Objetivos antigos em texto livre continuam aparecendo.
 */
export default function SeletorObjetivos({ valor = [], principal, onChange, grande = false }) {
  const marcados = Array.isArray(valor) ? valor : [];
  const todos = [...OBJETIVOS, ...marcados.filter((o) => !OBJETIVOS.includes(o))];
  const princ = marcados.includes(principal) ? principal : marcados[0] || "";
  const alternar = (o) => {
    const lista = marcados.includes(o) ? marcados.filter((x) => x !== o) : [...marcados, o];
    onChange(lista, lista.includes(princ) ? princ : lista[0] || "");
  };
  const tornarPrincipal = (o) => onChange(marcados.includes(o) ? marcados : [...marcados, o], o);
  return (
    <div className={grande ? "space-y-2.5" : "flex flex-wrap gap-1.5"} role="group" aria-label="Objetivos" data-testid="seletor-objetivos">
      {todos.map((o) => {
        const on = marcados.includes(o);
        const ehPrincipal = on && o === princ;
        return (
          <div key={o} className={`flex items-stretch rounded-xl border transition-colors ${on ? "bg-rc-blue/15 border-rc-blue" : "bg-white/[0.03] border-white/[0.1] hover:border-rc-blue/50"} ${grande ? "min-h-[52px]" : ""}`}>
            <button type="button" aria-pressed={on} onClick={() => alternar(o)}
              className={`flex flex-1 items-center gap-2.5 text-left ${grande ? "px-4 py-3 text-[15px]" : "px-2.5 py-1.5 text-[12.5px]"} ${on ? "text-white" : "text-gray-300"}`}>
              <span className={`shrink-0 rounded-md border flex items-center justify-center ${grande ? "w-5 h-5" : "w-4 h-4"} ${on ? "bg-rc-blue border-rc-blue" : "border-white/25"}`}>
                {on && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
              </span>
              {o}
            </button>
            <button type="button" onClick={() => tornarPrincipal(o)} aria-pressed={ehPrincipal} aria-label={`Tornar "${o}" o objetivo principal`}
              title={ehPrincipal ? "Objetivo principal" : "Tornar principal"}
              className={`flex items-center border-l ${on ? "border-rc-blue/40" : "border-white/[0.08]"} ${grande ? "px-4" : "px-2"} ${ehPrincipal ? "text-rc-lime" : "text-gray-600 hover:text-gray-300"}`}>
              <Star className={grande ? "h-5 w-5" : "h-3.5 w-3.5"} fill={ehPrincipal ? "currentColor" : "none"} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
