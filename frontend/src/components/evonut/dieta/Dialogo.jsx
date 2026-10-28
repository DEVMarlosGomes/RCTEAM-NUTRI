import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import Combobox from "./Combobox";

/**
 * Janela modal padrao da tela de dieta (fecha com Esc ou clicando fora). Vai para o <body> porque as
 * abas do paciente animam com transform, o que deslocaria um position:fixed renderizado dentro delas.
 */
export default function Dialogo({ eyebrow, titulo, onClose, children, rodape, largura = "sm:max-w-lg" }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6" role="dialog" aria-modal="true" aria-label={titulo}>
      <button className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in" onClick={onClose} aria-label="Fechar" />
      <div className={`relative w-full ${largura} max-h-[92dvh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-rc-ink shadow-[var(--shadow-pop)] animate-fade-up`}>
        <div className="px-5 sm:px-6 pt-5 pb-4 border-b border-white/[0.06] flex items-start justify-between gap-4">
          <div className="min-w-0">
            {eyebrow && <div className="rc-eyebrow">{eyebrow}</div>}
            <h3 className="font-display font-bold uppercase text-[20px] text-white mt-1.5 leading-tight" style={{ fontStretch: "82%" }}>{titulo}</h3>
          </div>
          <button onClick={onClose} className="rc-btn-ghost p-2 -mr-2" aria-label="Fechar"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5">{children}</div>
        {rodape && <div className="px-5 sm:px-6 py-4 border-t border-white/[0.06] flex flex-wrap justify-end gap-2">{rodape}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Pergunta um titulo (duplicar dieta, salvar modelo...), com sugestoes opcionais. */
export function PromptDialogo({ titulo, rotulo, valorInicial = "", opcoes = [], confirmar = "Salvar", onConfirmar, onClose }) {
  const [valor, setValor] = useState(valorInicial);
  const [enviando, setEnviando] = useState(false);
  const ok = async () => {
    if (!valor.trim() || enviando) return;
    setEnviando(true);
    try { await onConfirmar(valor.trim()); } finally { setEnviando(false); }
  };
  return (
    <Dialogo
      titulo={titulo}
      onClose={onClose}
      rodape={(
        <>
          <button type="button" onClick={onClose} className="rc-btn-secondary">Cancelar</button>
          <button type="button" onClick={ok} disabled={!valor.trim() || enviando} className="rc-btn-primary">{enviando ? "Salvando…" : confirmar}</button>
        </>
      )}
    >
      <label className="rc-label" htmlFor="prompt-dieta">{rotulo}</label>
      <Combobox id="prompt-dieta" value={valor} onChange={setValor} opcoes={opcoes} autoFocus onEnter={ok} inputClassName="rc-input h-10" />
    </Dialogo>
  );
}
