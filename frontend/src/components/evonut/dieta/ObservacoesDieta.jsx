import React from "react";
import { ChevronDown, ChevronUp, MinusCircle, PlusCircle } from "lucide-react";
import Combobox from "./Combobox";

/**
 * "Observações da dieta" do NutriDiet: blocos de título + texto no fim do plano.
 * O título sugere as orientações cadastradas; escolher uma preenche o texto.
 */
export default function ObservacoesDieta({ itens, onChange, orientacoes = [] }) {
  const lista = itens?.length ? itens : [{ titulo: "", texto: "" }];
  const set = (i, patch) => onChange(lista.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const inserir = (i) => onChange([...lista.slice(0, i + 1), { titulo: "", texto: "" }, ...lista.slice(i + 1)]);
  const remover = (i) => {
    const x = lista[i];
    if ((x.titulo || x.texto) && !window.confirm(`Remover a observação "${x.titulo || "sem título"}"?`)) return;
    const resto = lista.filter((_, k) => k !== i);
    onChange(resto.length ? resto : [{ titulo: "", texto: "" }]);
  };
  const mover = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= lista.length) return;
    const nova = [...lista];
    [nova[i], nova[j]] = [nova[j], nova[i]];
    onChange(nova);
  };

  return (
    <section className="mt-8">
      <h3 className="font-display font-bold uppercase text-[18px] text-white" style={{ fontStretch: "82%" }}>Observações da dieta</h3>
      <p className="text-[12.5px] text-gray-500 mt-1">Saem no final do PDF. Escolha uma orientação cadastrada pelo título ou escreva livremente.</p>
      <div className="mt-3 space-y-4">
        {lista.map((x, i) => (
          <div key={i} className="grid grid-cols-[38px_1fr] gap-1">
            <div className="flex items-start gap-0.5 pt-2">
              <button type="button" onClick={() => inserir(i)} title="Adicionar observação" aria-label="Adicionar observação" className="text-gray-500 hover:text-rc-lime"><PlusCircle className="h-[17px] w-[17px]" strokeWidth={1.6} /></button>
              <button type="button" onClick={() => remover(i)} title="Remover observação" aria-label="Remover observação" className="text-gray-500 hover:text-rc-coral"><MinusCircle className="h-[17px] w-[17px]" strokeWidth={1.6} /></button>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <Combobox
                  value={x.titulo || ""}
                  onChange={(v) => set(i, { titulo: v })}
                  opcoes={orientacoes}
                  rotulo={(o) => o.titulo || ""}
                  valorDe={(o) => o.titulo || ""}
                  onSelect={(o) => set(i, { titulo: o.titulo || "", texto: o.conteudo || "" })}
                  placeholder="Título da observação (ex.: Hidratação)"
                  inputClassName="rc-input h-9 px-3 text-[13px]"
                  className="w-full max-w-[420px]"
                  larguraLista="420px"
                />
                <button type="button" onClick={() => mover(i, 1)} disabled={i === lista.length - 1} title="Mover abaixo" className="rc-btn-ghost p-1.5 disabled:opacity-25"><ChevronDown className="h-4 w-4" /></button>
                <button type="button" onClick={() => mover(i, -1)} disabled={i === 0} title="Mover acima" className="rc-btn-ghost p-1.5 disabled:opacity-25"><ChevronUp className="h-4 w-4" /></button>
              </div>
              <textarea
                className="rc-input min-h-[110px] text-[13.5px] leading-relaxed"
                value={x.texto || ""}
                onChange={(e) => set(i, { texto: e.target.value })}
                placeholder="Texto que o paciente vai ler"
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
