import React, { useState } from "react";
import { Download, Eye, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/evo-api";
import Dialogo from "./Dialogo";

/**
 * "Gerar PDF do plano" (item 8 dos ajustes): marca o que entra no PDF, pré-visualiza, baixa ou envia ao app do
 * aluno (lá ele toca em "Baixar plano em PDF" e recebe sempre a versão mais nova).
 */
const OPCOES = [
  ["ou", "Alternativas (OU)", "Trocas de cada alimento em pílulas e as opções da refeição"],
  ["macros", "Kcal e macros por refeição", "Ao lado do nome de cada refeição"],
  ["orientacoes", "Página de orientações", "Cartões por tema com PODE / EVITE / ATÉ 100 G"],
  ["total", "Total do dia", "Faixa preta no fim das refeições"],
];

export default function GerarPdfDialogo({ pid, garantirSalvo, titulo, onClose }) {
  const [op, setOp] = useState({ ou: true, macros: true, orientacoes: true, total: true });
  const [acao, setAcao] = useState("");
  const query = new URLSearchParams(Object.fromEntries(Object.entries(op).map(([k, v]) => [k, v ? "true" : "false"]))).toString();

  const gerar = async (modo) => {
    const janela = modo === "ver" ? window.open("", "_blank") : null;
    setAcao(modo);
    try {
      const plano = await garantirSalvo();
      if (modo === "app") {
        await api.post(`/patients/${pid}/planos-manuais/${plano.id}/enviar-app`, op);
        toast.success("Plano enviado ao app do aluno.");
        onClose();
        return;
      }
      const r = await api.get(`/patients/${pid}/relatorios/dieta/${plano.id}?${query}`, { responseType: "blob" });
      const href = window.URL.createObjectURL(new Blob([r.data], { type: "application/pdf" }));
      if (modo === "ver" && janela && !janela.closed) { janela.location.href = href; return; }
      const a = document.createElement("a");
      a.href = href; a.download = `plano-${(titulo || "alimentar").replace(/\s+/g, "-")}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) {
      if (janela) janela.close();
      toast.error(formatApiError(e.response?.data?.detail) || "Não foi possível gerar o PDF.");
    } finally { setAcao(""); }
  };

  return (
    <Dialogo eyebrow="Prescrição" titulo="Gerar PDF do plano" onClose={onClose}
      rodape={(
        <>
          <button type="button" className="rc-btn-ghost mr-auto" onClick={() => gerar("ver")} disabled={!!acao} data-testid="pdf-ver">
            {acao === "ver" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />} Pré-visualizar
          </button>
          <button type="button" className="rc-btn-secondary" onClick={() => gerar("baixar")} disabled={!!acao} data-testid="pdf-baixar">
            {acao === "baixar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Baixar PDF
          </button>
          <button type="button" className="rc-btn-primary" onClick={() => gerar("app")} disabled={!!acao} data-testid="pdf-app">
            {acao === "app" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enviar ao app do aluno
          </button>
        </>
      )}>
      <p className="mb-4 text-[13px] text-gray-400">Padrão da marca: topo preto com logo, resumo, cartões por refeição e rodapé com @rogeriocostatreinador. Nomes saem limpos (sem tabela nem marca).</p>
      <div className="space-y-2" data-testid="pdf-opcoes">
        {OPCOES.map(([k, rot, desc]) => (
          <label key={k} className="flex cursor-pointer items-start gap-3 rounded-xl bg-white/[0.03] px-4 py-3 ring-1 ring-white/[0.06]">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#0081FD]" checked={op[k]} onChange={(e) => setOp((s) => ({ ...s, [k]: e.target.checked }))} />
            <span><span className="block text-[14px] font-semibold text-white">{rot}</span><span className="block text-[12px] text-gray-500">{desc}</span></span>
          </label>
        ))}
      </div>
    </Dialogo>
  );
}
