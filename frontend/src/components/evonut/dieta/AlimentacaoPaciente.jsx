import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, FileText, GripHorizontal, Loader2, Minus, Plus, Utensils, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/evo-api";
import { abrirAnexo, carregarEstrutura, respostasPlanas, textoResposta, vazio, visivel } from "@/lib/anamnese";

const CHAVE = "rc_painel_alimentacao";
const LARGURA = 380;

function lerSessao() {
  try { return JSON.parse(sessionStorage.getItem(CHAVE) || "null") || {}; } catch { return {}; }
}
function gravarSessao(dados) {
  try { sessionStorage.setItem(CHAVE, JSON.stringify({ ...lerSessao(), ...dados })); } catch { /* sem sessão: só não lembra */ }
}

/** Painel aberto/fechado lembrado por sessão (fica aberto ao trocar de refeição ou de dieta). */
export function usePainelAlimentacao() {
  const [aberto, setAberto] = useState(() => Boolean(lerSessao().aberto));
  const definir = useCallback((v) => { setAberto(v); gravarSessao({ aberto: v }); }, []);
  return [aberto, definir];
}

const limitar = (x, y) => ({
  x: Math.max(8, Math.min(x, window.innerWidth - LARGURA - 8)),
  y: Math.max(8, Math.min(y, window.innerHeight - 56)),
});

/**
 * Janela flutuante com o Bloco 5 (Alimentação) da anamnese, para consultar "o que o paciente come no café da
 * manhã?" sem sair da Prescrição. Só leitura, arrastável, minimizável, não bloqueia o editor; fecha só no X.
 * Em tela pequena abre como gaveta inferior.
 */
export default function AlimentacaoPaciente({ pacienteId, onClose, onEditar }) {
  const [estrutura, setEstrutura] = useState(null);
  const [anam, setAnam] = useState(null);
  const [mini, setMini] = useState(() => Boolean(lerSessao().mini));
  const [pos, setPos] = useState(() => {
    const s = lerSessao();
    return s.x != null ? limitar(s.x, s.y) : limitar(window.innerWidth - LARGURA - 24, 96);
  });
  const [movel, setMovel] = useState(() => window.matchMedia("(min-width: 640px)").matches);
  const arraste = useRef(null);

  useEffect(() => {
    let ativo = true;
    setAnam(null);
    Promise.all([carregarEstrutura(), api.get(`/patients/${pacienteId}/anamnese-v2`).then((r) => r.data || {})])
      .then(([est, a]) => { if (ativo) { setEstrutura(est); setAnam(a); } })
      .catch(() => { if (ativo) setAnam({}); });
    return () => { ativo = false; };
  }, [pacienteId]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const mudar = () => { setMovel(mq.matches); setPos((p) => limitar(p.x, p.y)); };
    mq.addEventListener("change", mudar);
    window.addEventListener("resize", mudar);
    return () => { mq.removeEventListener("change", mudar); window.removeEventListener("resize", mudar); };
  }, []);

  const iniciarArraste = (e) => {
    if (!movel || e.button !== 0 || e.target.closest("button")) return;
    arraste.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const mover = (e) => {
    if (!arraste.current) return;
    setPos(limitar(e.clientX - arraste.current.dx, e.clientY - arraste.current.dy));
  };
  const soltar = () => {
    if (!arraste.current) return;
    arraste.current = null;
    gravarSessao({ x: pos.x, y: pos.y });
  };
  const alternarMini = () => { setMini((m) => { gravarSessao({ mini: !m }); return !m; }); };

  const bloco = estrutura?.blocos.find((b) => b.key === "alimentacao");
  const planas = respostasPlanas(anam?.formulario);
  const perguntas = bloco ? bloco.perguntas.filter((p) => visivel(p, planas) || !vazio(planas[p.id])) : [];
  const respondeu = perguntas.some((p) => !vazio(planas[p.id]));
  const outras = Object.entries(anam?.formulario_outras?.alimentacao || {});

  const estilo = movel ? { left: pos.x, top: pos.y, width: LARGURA } : undefined;
  return createPortal(
    <section
      role="dialog" aria-modal="false" aria-label="Alimentação do paciente" data-testid="painel-alimentacao"
      style={estilo}
      className={`fixed z-50 flex flex-col bg-rc-raised text-gray-100 shadow-[var(--shadow-pop)] ring-1 ring-white/[0.08] animate-fade-in ${
        movel ? "rounded-2xl max-h-[min(70vh,640px)]" : "inset-x-0 bottom-0 rounded-t-2xl max-h-[60vh]"}`}
    >
      <header
        onPointerDown={iniciarArraste} onPointerMove={mover} onPointerUp={soltar} onPointerCancel={soltar}
        className={`flex items-center gap-2 px-3.5 py-2.5 border-b border-white/[0.06] select-none ${movel ? "cursor-grab active:cursor-grabbing" : ""}`}
      >
        {movel ? <GripHorizontal className="w-4 h-4 text-gray-500" /> : <Utensils className="w-4 h-4 text-rc-lime" />}
        <h2 className="text-[13.5px] font-semibold flex-1">Alimentação do paciente</h2>
        <button type="button" onClick={alternarMini} className="rc-btn-ghost p-1.5" aria-label={mini ? "Expandir" : "Minimizar"} title={mini ? "Expandir" : "Minimizar"}>
          {mini ? <Plus className="w-4 h-4" /> : <Minus className="w-4 h-4" />}
        </button>
        <button type="button" onClick={onClose} className="rc-btn-ghost p-1.5" aria-label="Fechar" title="Fechar"><X className="w-4 h-4" /></button>
      </header>

      {!mini && (
        <div className="overflow-y-auto px-4 py-3 space-y-4 text-[13px]">
          {!anam || !estrutura ? (
            <div className="flex items-center gap-2 text-gray-400 py-4"><Loader2 className="w-4 h-4 animate-spin" />Carregando…</div>
          ) : !respondeu && !outras.length ? (
            <p className="text-gray-400 py-2">O paciente ainda não respondeu o bloco de alimentação.</p>
          ) : (
            <>
              {perguntas.filter((p) => p.id === "rotina_alimentar").map((p) => (
                <div key={p.id} className="rounded-xl bg-rc-lime/[0.07] ring-1 ring-rc-lime/20 p-3">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-rc-lime mb-1.5">Rotina alimentar</div>
                  <p className="whitespace-pre-line leading-relaxed text-gray-100">{vazio(planas[p.id]) ? "Não respondida." : planas[p.id]}</p>
                </div>
              ))}
              <dl className="space-y-3">
                {perguntas.filter((p) => p.id !== "rotina_alimentar").map((p) => (
                  <div key={p.id}>
                    <dt className="text-[11.5px] text-gray-500 leading-snug">{p.titulo}</dt>
                    <dd className="mt-0.5 text-gray-100 whitespace-pre-line">
                      {p.tipo === "arquivo" && Array.isArray(planas[p.id]) && planas[p.id].length ? (
                        <span className="flex flex-wrap gap-1.5">
                          {planas[p.id].map((a) => (
                            <button key={a.id} type="button" onClick={() => abrirAnexo(pacienteId, a.id).catch(() => toast.error("Não foi possível abrir o arquivo."))}
                              className="inline-flex items-center gap-1 rounded-md bg-white/[0.05] hover:bg-white/[0.1] px-2 py-1 text-[12px]">
                              <FileText className="w-3.5 h-3.5 text-rc-blue" />{a.nome}
                            </button>
                          ))}
                        </span>
                      ) : (textoResposta(p, planas[p.id]) || <span className="text-gray-600">—</span>)}
                    </dd>
                  </div>
                ))}
                {outras.map(([rotulo, valor]) => (
                  <div key={rotulo}>
                    <dt className="text-[11.5px] text-gray-500">{rotulo}</dt>
                    <dd className="mt-0.5 text-gray-100 whitespace-pre-line">{String(valor)}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
          <button type="button" onClick={onEditar} className="inline-flex items-center gap-1.5 text-[12.5px] text-rc-blue hover:underline">
            Editar na anamnese <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </section>,
    document.body,
  );
}
