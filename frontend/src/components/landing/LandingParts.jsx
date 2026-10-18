import React, { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";

/** Revela o conteudo uma unica vez quando entra na tela (sem bloquear interacao). */
export function Reveal({ as: Tag = "div", delay = 0, className = "", children, ...props }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { setVisible(true); return undefined; }
    const io = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); io.disconnect(); } },
      { rootMargin: "0px 0px -80px 0px", threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag ref={ref} className={`rc-reveal ${visible ? "is-in" : ""} ${className}`} style={{ transitionDelay: `${delay}ms` }} {...props}>
      {children}
    </Tag>
  );
}

/** Rotulo numerado de secao: "01 — Método". */
export function SectionLabel({ n, children }) {
  return (
    <div className="flex items-center gap-3 text-[12px] uppercase tracking-[0.2em] text-gray-400">
      <span className="rc-num text-rc-lime text-[15px] tracking-normal">{n}</span>
      <span className="h-px w-8 bg-white/15" />
      {children}
    </div>
  );
}

export function CheckItem({ children, muted }) {
  return (
    <li className="flex gap-3 text-[15px] leading-snug">
      <span className={`mt-0.5 w-5 h-5 shrink-0 rounded-md flex items-center justify-center ${muted ? "bg-white/[0.06] text-gray-300" : "bg-rc-lime/15 text-rc-lime"}`}>
        <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
      </span>
      <span className="text-gray-200">{children}</span>
    </li>
  );
}
