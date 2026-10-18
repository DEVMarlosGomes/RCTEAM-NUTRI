import React from "react";

export const MACRO_COLORS = { ptn: "#4DA6FF", cho: "#C3F53C", lip: "#FFB547" };

/**
 * Aneis concentricos de macronutrientes (proteina / carboidrato / gordura).
 * `values` em fracao 0..1 (ex.: % das kcal). Desenha com animacao de entrada.
 */
export default function MacroRings({ values = { ptn: 0.72, cho: 0.58, lip: 0.41 }, stroke = 14, className = "", children }) {
  const rings = [
    { key: "ptn", r: 132 },
    { key: "cho", r: 104 },
    { key: "lip", r: 76 },
  ];
  return (
    <div className={`${/\b(absolute|fixed)\b/.test(className) ? "" : "relative"} ${className}`}>
      <svg viewBox="0 0 300 300" className="w-full h-full" aria-hidden>
        {rings.map((ring, i) => {
          const c = 2 * Math.PI * ring.r;
          const pct = Math.max(0, Math.min(1, values[ring.key] || 0));
          return (
            <g key={ring.key} transform="rotate(-90 150 150)">
              <circle cx="150" cy="150" r={ring.r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={stroke} />
              {pct > 0 && (
                <circle
                  cx="150" cy="150" r={ring.r} fill="none" stroke={MACRO_COLORS[ring.key]} strokeWidth={stroke} strokeLinecap="round"
                  strokeDasharray={`${c * pct} ${c}`}
                  className="rc-ring-draw"
                  style={{ "--c": c, animationDelay: `${200 + i * 120}ms` }}
                />
              )}
            </g>
          );
        })}
      </svg>
      {children && <div className="absolute inset-0 flex items-center justify-center">{children}</div>}
    </div>
  );
}
