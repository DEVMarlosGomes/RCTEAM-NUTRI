import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Copy, Loader2, MessageCircle, RotateCcw, Send } from "lucide-react";
import { toast } from "sonner";
import NutriLayout from "@/components/evonut/NutriLayout";
import PageHeader from "@/components/evonut/PageHeader";
import { api, formatApiError } from "@/lib/evo-api";

/** Acompanhamento (menu novo, ajuste sb1): central de lembretes e de formulários de todos os pacientes. */
const dataHora = (v) => (v ? new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const diasDesde = (v) => (v ? Math.floor((Date.now() - new Date(v).getTime()) / 86400000) : null);
const zap = (fone, msg) => {
  const f = String(fone || "").replace(/\D/g, "");
  return f ? `https://wa.me/${f.length <= 11 ? `55${f}` : f}?text=${encodeURIComponent(msg)}` : null;
};

export function MensagensLembretes() {
  const [lista, setLista] = useState(null);
  const [filtro, setFiltro] = useState("todos");
  useEffect(() => { api.get("/acompanhamento/lembretes").then((r) => setLista(r.data || [])).catch(() => setLista([])); }, []);
  const vis = (lista || []).filter((x) => filtro === "todos" || (filtro === "sem" ? x.sem_resposta : !x.sem_resposta));
  return (
    <NutriLayout>
      <PageHeader eyebrow="Acompanhamento" title="Mensagens e lembretes" description="Lembretes enviados a todos os pacientes, respostas e quem está sem responder." />
      <div className="mb-4 flex gap-2">
        {[["todos", "Todos"], ["sem", "Sem resposta"], ["ok", "Responderam"]].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setFiltro(k)} aria-pressed={filtro === k}
            className={`h-9 rounded-lg px-3.5 text-[13px] font-semibold ${filtro === k ? "bg-rc-blue text-white" : "bg-white/[0.05] text-gray-300"}`}>
            {l}{lista && k === "sem" ? ` · ${lista.filter((x) => x.sem_resposta).length}` : ""}
          </button>
        ))}
      </div>
      <section className="rc-card" data-testid="central-lembretes">
        {lista === null ? <div className="p-6"><Loader2 className="h-4 w-4 animate-spin text-gray-400" /></div> : !vis.length ? <p className="p-6 text-[13px] text-gray-500">Nenhum paciente com lembretes neste filtro.</p> : (
          <ul className="divide-y divide-white/[0.05]">
            {vis.map((x) => {
              const dias = x.sem_resposta ? diasDesde(x.ultimo_envio) : null;
              const link = zap(x.telefone, `Oi, ${(x.nome || "").split(" ")[0]}! Tudo certo por aí? Me conta como está indo o plano.`);
              return (
                <li key={x.paciente_id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <Link to={`/pacientes/${x.paciente_id}`} className="text-[14px] font-semibold text-white hover:underline">{x.nome}</Link>
                    <div className="text-[12px] text-gray-500">
                      {x.ativos} lembrete{x.ativos === 1 ? "" : "s"} ativo{x.ativos === 1 ? "" : "s"} · último envio {dataHora(x.ultimo_envio)}
                      {x.ultima_resposta && <> · respondeu {dataHora(x.ultima_resposta)}</>}
                    </div>
                  </div>
                  {x.sem_resposta ? <span className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${dias >= 3 ? "bg-rc-amber/15 text-rc-amber" : "bg-white/[0.06] text-gray-300"}`}>sem resposta há {dias} {dias === 1 ? "dia" : "dias"}</span>
                    : <span className="rounded-full bg-[#3DDC84]/15 px-2.5 py-0.5 text-[11.5px] font-semibold text-[#3DDC84]">respondeu</span>}
                  {link && <a href={link} target="_blank" rel="noopener noreferrer" className="rc-btn-ghost h-8 text-[12.5px]"><MessageCircle className="h-4 w-4" /> WhatsApp</a>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </NutriLayout>
  );
}

export function Formularios() {
  const [lista, setLista] = useState(null);
  const [filtro, setFiltro] = useState("pendentes");
  const carregar = () => api.get("/acompanhamento/formularios").then((r) => setLista(r.data || [])).catch(() => setLista([]));
  useEffect(() => { carregar(); }, []);
  const reenviar = async (x, tipo) => {
    try {
      const { data } = await api.post(`/patients/${x.paciente_id}/formulario/enviar`, { tipo });
      const url = `${window.location.origin}/pre-consulta/${data.token}`;
      try { await navigator.clipboard.writeText(url); } catch { /* sem área de transferência */ }
      const link = zap(x.telefone, tipo === "retorno" ? `Oi, ${(x.nome || "").split(" ")[0]}! Antes da reavaliação, responde o questionário de retorno: ${url}` : `Oi, ${(x.nome || "").split(" ")[0]}! Segue o formulário pré-consulta: ${url}`);
      if (link) window.open(link, "_blank", "noopener");
      toast.success("Formulário liberado e link copiado.");
      carregar();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const vis = (lista || []).filter((x) => filtro === "todos" || (filtro === "pendentes" ? x.estado !== "respondido" : x.estado === "respondido"));
  return (
    <NutriLayout>
      <PageHeader eyebrow="Acompanhamento" title="Formulários" description="Pré-consultas e questionários de retorno enviados, respondidos e pendentes." />
      <div className="mb-4 flex gap-2">
        {[["pendentes", "Pendentes"], ["respondidos", "Respondidos"], ["todos", "Todos"]].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setFiltro(k)} aria-pressed={filtro === k}
            className={`h-9 rounded-lg px-3.5 text-[13px] font-semibold ${filtro === k ? "bg-rc-blue text-white" : "bg-white/[0.05] text-gray-300"}`}>
            {l}{lista && k === "pendentes" ? ` · ${lista.filter((x) => x.estado !== "respondido").length}` : ""}
          </button>
        ))}
      </div>
      <section className="rc-card overflow-x-auto md:overflow-x-auto" data-testid="central-formularios">
        {lista === null ? <div className="p-6"><Loader2 className="h-4 w-4 animate-spin text-gray-400" /></div> : (
          <table className="tabela-responsiva w-full min-w-[720px] text-[13.5px]">
            <thead><tr className="text-[10.5px] uppercase tracking-[0.12em] text-gray-500"><th className="px-5 py-3 text-left font-medium">Paciente</th><th className="text-left font-medium">Formulário</th><th className="text-left font-medium">Situação</th><th className="text-left font-medium">Data</th><th className="px-5 text-right font-medium">Ações</th></tr></thead>
            <tbody>
              {vis.map((x) => (
                <tr key={x.paciente_id} className="border-t border-white/[0.05]">
                  <td className="px-5 py-3"><Link to={`/pacientes/${x.paciente_id}`} className="font-semibold text-white hover:underline">{x.nome}</Link></td>
                  <td data-rot="Formulário" className="text-gray-300">{x.tipo === "retorno" ? "Retorno" : "Pré-consulta"}</td>
                  <td data-rot="Situação">{x.estado === "respondido" ? <span className="text-[#3DDC84]">respondido</span> : <span className="text-rc-amber">aguardando</span>}</td>
                  <td data-rot="Data" className="tabular text-gray-400">{dataHora(x.estado === "respondido" ? x.respondido_em : x.enviado_em)}</td>
                  <td className="px-5">
                    <div className="flex justify-end gap-1">
                      {x.lead_token && <button type="button" className="rc-btn-ghost p-2" title="Copiar link" aria-label={`Copiar link de ${x.nome}`}
                        onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/pre-consulta/${x.lead_token}`).then(() => toast.success("Link copiado."), () => {})}><Copy className="h-4 w-4" /></button>}
                      <button type="button" className="rc-btn-ghost h-8 text-[12.5px]" onClick={() => reenviar(x, "inicial")}><RotateCcw className="h-3.5 w-3.5" /> Reenviar</button>
                      <button type="button" className="rc-btn-ghost h-8 text-[12.5px]" onClick={() => reenviar(x, "retorno")}><Send className="h-3.5 w-3.5" /> Retorno</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!vis.length && <tr><td colSpan={5} className="px-5 py-6 text-[13px] text-gray-500">Nada neste filtro.</td></tr>}
            </tbody>
          </table>
        )}
      </section>
    </NutriLayout>
  );
}
