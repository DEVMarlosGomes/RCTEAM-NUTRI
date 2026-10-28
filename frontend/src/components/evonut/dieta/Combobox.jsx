import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import Flutuante from "./Flutuante";
import { normalizar } from "./calculos";

/**
 * Campo de texto livre com sugestoes (como os autocompletes do NutriDiet): filtra enquanto digita,
 * abre a lista toda ao clicar e aceita setas. Enter so escolhe a sugestao se a pessoa navegou nela;
 * senao mantem o texto digitado.
 */
export default function Combobox({
  value, onChange, opcoes = [], placeholder, className = "", inputClassName = "", onEnter, onSelect,
  id, ariaLabel, autoFocus, rotulo = (o) => o, valorDe = (o) => o, renderOpcao, larguraLista,
}) {
  const [aberto, setAberto] = useState(false);
  const [mostrarTudo, setMostrarTudo] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const [navegou, setNavegou] = useState(false);
  const ref = useRef(null);
  const listaRef = useRef(null);
  const listaId = useId();

  const filtradas = useMemo(() => {
    const q = normalizar(value);
    const lista = mostrarTudo || !q ? opcoes : opcoes.filter((o) => normalizar(rotulo(o)).includes(q));
    return lista.slice(0, 60);
  }, [opcoes, value, mostrarTudo, rotulo]);

  useEffect(() => {
    const fora = (e) => {
      if (ref.current?.contains(e.target) || listaRef.current?.contains(e.target)) return;
      setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, []);

  const escolher = (o) => {
    setAberto(false);
    onChange(valorDe(o));
    onSelect?.(o);
  };

  const visivel = aberto && filtradas.length > 0;

  return (
    <div ref={ref} className={`relative min-w-0 ${className}`}>
      <input
        id={id}
        className={inputClassName}
        value={value ?? ""}
        placeholder={placeholder}
        title={value || undefined}
        autoFocus={autoFocus}
        autoComplete="off"
        aria-label={ariaLabel || placeholder}
        role="combobox"
        aria-expanded={visivel}
        aria-controls={listaId}
        onClick={() => { setMostrarTudo(true); setAberto(true); setNavegou(false); }}
        onChange={(e) => { onChange(e.target.value); setMostrarTudo(false); setAberto(true); setAtivo(0); setNavegou(false); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!aberto) { setAberto(true); setAtivo(0); } else setAtivo((i) => (navegou ? Math.min(i + 1, filtradas.length - 1) : 0));
            setNavegou(true);
            return;
          }
          if (e.key === "ArrowUp") { e.preventDefault(); setNavegou(true); setAtivo((i) => Math.max(i - 1, 0)); return; }
          if (e.key === "Escape") { setAberto(false); return; }
          if (e.key === "Enter") {
            e.preventDefault();
            if (visivel && navegou && filtradas[ativo] !== undefined) escolher(filtradas[ativo]);
            else { setAberto(false); onEnter?.(); }
          }
          if (e.key === "Tab") setAberto(false);
        }}
      />
      <Flutuante ancora={ref} aberto={visivel} largura={larguraLista} listaRef={listaRef}>
        <div id={listaId} role="listbox">
          {filtradas.map((o, i) => (
            <button
              key={`${rotulo(o)}-${i}`}
              type="button"
              role="option"
              aria-selected={i === ativo && navegou}
              onMouseDown={(e) => { e.preventDefault(); escolher(o); }}
              className={`block w-full text-left px-3 py-1.5 text-[13px] leading-snug ${i === ativo && navegou ? "bg-rc-blue/20 text-white" : "text-gray-200 hover:bg-white/[0.05]"}`}
            >
              {renderOpcao ? renderOpcao(o) : rotulo(o)}
            </button>
          ))}
        </div>
      </Flutuante>
    </div>
  );
}
