import React, { useState } from "react";

// Protocolo e padrão de fotos do Rogério (mesmo texto da página de boas-vindas).
const POSES = [
  ["frente", "Frente"],
  ["costas", "Costas"],
  ["perfil-direito", "Perfil direito"],
  ["perfil-esquerdo", "Perfil esquerdo"],
];

const REGRAS = [
  {
    t: "Roupa",
    itens: [
      "De preferência biquíni ou sunga, para vermos sua forma física com precisão.",
      "Se preferir, top e shorts com o umbigo aparente. Use a mesma roupa em todas as fotos.",
    ],
  },
  {
    t: "Lugar",
    itens: ["Sempre o mesmo local, com fundo neutro, para comparar a evolução com consistência."],
  },
  {
    t: "Luz e ângulo",
    itens: [
      "Corpo inteiro, dos pés à cabeça, sem cortes. Fotos cortadas serão pedidas de novo.",
      "Câmera na altura do abdômen. Se outra pessoa fotografar, peça que se sente.",
      "Prefira luz natural.",
    ],
  },
];

export default function ProtocoloFotos() {
  const [grupo, setGrupo] = useState("homem");
  return (
    <div className="space-y-6" data-testid="protocolo-fotos">
      <p className="text-sm text-gray-300 leading-relaxed">
        Nosso objetivo é oferecer suporte, não fazer julgamentos. Analisamos fotos de todos os tipos de corpo todos os dias:
        aqui o único propósito é entender como te ajudar melhor e acompanhar sua transformação.
      </p>

      <div className="grid sm:grid-cols-3 gap-x-6 gap-y-5">
        {REGRAS.map((r) => (
          <div key={r.t} className="border-t-2 border-rc-blue pt-3">
            <div className="text-[11px] uppercase tracking-[0.14em] text-rc-blue font-semibold">{r.t}</div>
            <ul className="mt-2 space-y-1.5 text-[13px] text-gray-300 leading-relaxed">
              {r.itens.map((i) => <li key={i}>{i}</li>)}
            </ul>
          </div>
        ))}
      </div>

      <div>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-[11px] uppercase tracking-[0.14em] text-gray-500">Padrão de fotos</div>
          <div role="tablist" className="inline-flex p-0.5 rounded-lg bg-white/[0.04] border border-white/[0.06]">
            {[["homem", "Homens"], ["mulher", "Mulheres"]].map(([k, l]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={grupo === k}
                onClick={() => setGrupo(k)}
                className={`px-3 h-8 rounded-md text-[12.5px] transition-colors ${grupo === k ? "bg-rc-raised text-white" : "text-gray-400 hover:text-white"}`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-3">
          {POSES.map(([k, l]) => (
            <figure key={k} className="rounded-xl overflow-hidden bg-rc-surfaceAlt border border-white/[0.06]">
              <img
                src={`/protocolo-fotos/${grupo}-${k}.jpg`}
                alt={`${grupo === "homem" ? "Homem" : "Mulher"}: ${l.toLowerCase()}`}
                loading="lazy"
                className="w-full aspect-[3/4] object-cover"
              />
              <figcaption className="px-2.5 py-2 text-[12px] text-gray-400">{l}</figcaption>
            </figure>
          ))}
        </div>
      </div>

      <p className="text-[13px] text-gray-400 leading-relaxed">
        Depois da primeira consulta, mande toda semana seu peso e as fotos padrão. Pese-se em jejum, logo ao acordar.
      </p>
    </div>
  );
}
