import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Lista suspensa presa a um campo, renderizada no <body>: nao e cortada pela rolagem horizontal do
 * editor nem deslocada por ancestrais com transform (animacoes das abas). Abre para cima se faltar espaco.
 */
export default function Flutuante({ ancora, aberto, largura, listaRef, children, className = "" }) {
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    if (!aberto) { setPos(null); return undefined; }
    const atualizar = () => {
      const r = ancora.current?.getBoundingClientRect();
      if (r) setPos({ top: r.top, bottom: r.bottom, left: r.left, width: r.width });
    };
    atualizar();
    window.addEventListener("scroll", atualizar, true);
    window.addEventListener("resize", atualizar);
    return () => {
      window.removeEventListener("scroll", atualizar, true);
      window.removeEventListener("resize", atualizar);
    };
  }, [aberto, ancora]);

  if (!aberto || !pos) return null;
  const w = Math.max(pos.width, largura || 0);
  const espacoAbaixo = window.innerHeight - pos.bottom;
  const acima = espacoAbaixo < 220 && pos.top > espacoAbaixo;
  const style = {
    position: "fixed",
    zIndex: 80,
    width: w,
    left: Math.max(8, Math.min(pos.left, window.innerWidth - w - 8)),
    maxHeight: Math.min(320, (acima ? pos.top : espacoAbaixo) - 12),
    ...(acima ? { bottom: window.innerHeight - pos.top + 4 } : { top: pos.bottom + 4 }),
  };
  return createPortal(
    <div ref={listaRef} style={style} className={`overflow-y-auto rounded-xl bg-rc-raised shadow-[var(--shadow-pop)] py-1 animate-fade-in ${className}`}>
      {children}
    </div>,
    document.body,
  );
}
