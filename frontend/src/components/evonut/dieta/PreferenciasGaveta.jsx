import React, { createContext, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Pin, PinOff, Send, Utensils, X } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/evo-api";
import { respostasPlanas, textoResposta, vazio } from "@/lib/anamnese";
import { termosRestritos } from "./grupos";
import { normalizar } from "./calculos";

/**
 * Aba Preferências (item p1 dos ajustes): respostas do bloco Alimentação do formulário numa gaveta lateral por cima
 * da tela, em blocos por cor — NÃO COME / EVITA (vermelho), GOSTA / PREFERE (verde), ROTINA (azul), OUTROS (cinza).
 * "Fixar" deixa a gaveta aberta ao lado. Os termos alimentam os selos dos alimentos (não gosta / preferida).
 */
export const PreferenciasContext = createContext({ evita: [], gosta: [] });

const CHAVE = "rc_gaveta_preferencias";
const ler = () => { try { return JSON.parse(localStorage.getItem(CHAVE) || "{}"); } catch { return {}; } };
const gravar = (v) => { try { localStorage.setItem(CHAVE, JSON.stringify({ ...ler(), ...v })); } catch { /* sem armazenamento */ } };

/** Termos de preferência do paciente a partir das respostas do formulário. */
export function preferenciasDe(anamnese) {
  const p = respostasPlanas(anamnese?.formulario);
  return { evita: termosRestritos(p.alergias, p.nao_gosta), gosta: termosRestritos(p.frutas_preferidas) };
}

/** Selo do alimento: "cliente não gosta" (laranja) ou "preferida" (verde). Só aviso, não bloqueia. */
export function seloPreferencia(nome, pref) {
  const n = normalizar(nome);
  if (!n) return null;
  const bate = (t) => n.includes(t) || n.includes(t.replace(/s$/, ""));
  if ((pref?.evita || []).some(bate)) return "evita";
  if ((pref?.gosta || []).some(bate)) return "gosta";
  return null;
}

export function usePreferenciasGaveta() {
  const [estado, setEstado] = useState(() => ({ aberta: Boolean(ler().fixada), fixada: Boolean(ler().fixada) }));
  const abrir = useCallback((v) => setEstado((s) => ({ ...s, aberta: v ?? !s.aberta })), []);
  const fixar = useCallback((v) => { gravar({ fixada: v }); setEstado({ aberta: true, fixada: v }); }, []);
  return { ...estado, abrir, fixar };
}

const BLOCOS = [
  ["evita", "Não come / evita", "bg-rc-coral/[0.08] ring-rc-coral/30", "text-rc-coral", ["alergias", "nao_gosta"]],
  ["gosta", "Gosta / prefere", "bg-[#4ADE80]/[0.08] ring-[#4ADE80]/30", "text-[#4ADE80]", ["frutas_preferidas"]],
  ["rotina", "Rotina", "bg-rc-blue/[0.08] ring-rc-blue/30", "text-rc-blueLight", ["rotina_alimentar", "horario_fome", "beliscos", "quem_prepara", "marmita", "plano_anterior", "plano_anterior_experiencia"]],
  ["outros", "Outros", "bg-white/[0.03] ring-white/[0.08]", "text-gray-400", ["agua", "intestino"]],
];

export default function PreferenciasGaveta({ paciente, anamnese, estrutura, estado, onEnviarFormulario }) {
  const planas = useMemo(() => respostasPlanas(anamnese?.formulario), [anamnese]);
  const perguntas = useMemo(() => Object.fromEntries((estrutura?.blocos || []).flatMap((b) => b.perguntas).map((p) => [p.id, p])), [estrutura]);
  const respondeu = Boolean(anamnese?.enviado_em) || Object.keys(planas).length > 3;
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!estado.aberta || estado.fixada) return undefined;
    const esc = (e) => { if (e.key === "Escape") estado.abrir(false); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [estado]);

  const enviarFormulario = async () => {
    setEnviando(true);
    try {
      const { data } = await api.post(`/patients/${paciente.id}/formulario/enviar`, { tipo: "inicial" });
      const link = `${window.location.origin}/pre-consulta/${data.token}`;
      try { await navigator.clipboard.writeText(link); } catch { /* sem área de transferência */ }
      toast.success("Formulário liberado. Link copiado.");
      onEnviarFormulario?.();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); } finally { setEnviando(false); }
  };

  const valor = (id) => {
    const p = perguntas[id];
    if (!p || vazio(planas[id])) return null;
    return textoResposta(p, planas[id]);
  };

  const conteudo = (
    <aside className={`flex h-full w-[340px] max-w-[92vw] flex-col bg-rc-raised shadow-[var(--shadow-pop)] ring-1 ring-white/[0.08] ${estado.fixada ? "rounded-2xl" : ""}`}
      role="dialog" aria-label="Preferências do paciente" data-testid="gaveta-preferencias">
      <header className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
        <Utensils className="h-4 w-4 text-rc-lime" />
        <h2 className="flex-1 text-[14px] font-semibold text-white">Preferências</h2>
        <button type="button" onClick={() => estado.fixar(!estado.fixada)} className="rc-btn-ghost h-8 text-[12px]" data-testid="fixar-preferencias"
          title={estado.fixada ? "Soltar (abre por cima da tela)" : "Fixar ao lado das refeições"}>
          {estado.fixada ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}{estado.fixada ? "Soltar" : "Fixar"}
        </button>
        <button type="button" onClick={() => { estado.fixar(false); estado.abrir(false); }} className="rc-btn-ghost p-1.5" aria-label="Fechar"><X className="h-4 w-4" /></button>
      </header>
      <div className="flex-1 space-y-3 overflow-y-auto p-4 text-[13px]">
        {!respondeu ? (
          <div className="space-y-3 rounded-xl bg-white/[0.03] p-4 text-center ring-1 ring-white/[0.06]">
            <p className="text-gray-300">Formulário não respondido.</p>
            <button type="button" onClick={enviarFormulario} disabled={enviando} className="rc-btn-primary h-9"><Send className="h-4 w-4" /> Enviar formulário</button>
          </div>
        ) : BLOCOS.map(([k, rot, cls, cor, ids]) => {
          const itens = ids.map((id) => [id, valor(id)]).filter(([, v]) => v);
          return (
            <section key={k} className={`rounded-xl p-3 ring-1 ${cls}`} data-testid={`pref-${k}`}>
              <h3 className={`mb-1.5 text-[11px] font-bold uppercase tracking-[0.14em] ${cor}`}>{rot}</h3>
              {itens.length ? (
                <dl className="space-y-2">
                  {itens.map(([id, v]) => (
                    <div key={id}>
                      <dt className="text-[11px] text-gray-500">{perguntas[id]?.titulo}</dt>
                      <dd className="whitespace-pre-line text-gray-100">{v}</dd>
                    </div>
                  ))}
                </dl>
              ) : <p className="text-gray-500">Nada informado.</p>}
            </section>
          );
        })}
      </div>
    </aside>
  );

  if (estado.fixada) return <div className="sticky top-28 h-[calc(100vh-8rem)]">{conteudo}</div>;
  return createPortal(
    <>
      {!estado.aberta && (
        <button type="button" onClick={() => estado.abrir(true)} data-testid="aba-preferencias"
          className="fixed right-0 top-1/2 z-40 -translate-y-1/2 rounded-l-xl bg-rc-raised px-1.5 py-4 text-[11.5px] font-semibold text-gray-300 shadow-[var(--shadow-pop)] ring-1 ring-white/[0.08] hover:text-white [writing-mode:vertical-rl]">
          🍽 Preferências
        </button>
      )}
      {estado.aberta && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button type="button" aria-label="Fechar preferências" className="absolute inset-0 bg-black/40 animate-fade-in" onClick={() => estado.abrir(false)} />
          <div className="relative h-full animate-fade-in">{conteudo}</div>
        </div>
      )}
    </>,
    document.body,
  );
}
