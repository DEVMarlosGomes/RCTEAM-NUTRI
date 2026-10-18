import React from "react";

// Cabecalho padrao das telas internas: sobretitulo + titulo atletico + descricao + acoes.
export default function PageHeader({ eyebrow, title, description, actions, className = "" }) {
  return (
    <header className={`flex items-end justify-between flex-wrap gap-4 mb-7 ${className}`}>
      <div className="min-w-0">
        {eyebrow && <div className="rc-eyebrow">{eyebrow}</div>}
        <h1 className="rc-h2 mt-2.5">{title}</h1>
        {description && <p className="text-[14px] text-gray-400 mt-2.5 max-w-[68ch]">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </header>
  );
}
