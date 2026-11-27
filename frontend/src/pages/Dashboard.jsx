import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle, CalendarDays, Check, ChevronRight, ClipboardList, FlaskConical, MessageCircle, Send, Stethoscope,
  UserPlus, Utensils, Wallet,
} from "lucide-react";
import { toast } from "sonner";
import NutriLayout from "@/components/evonut/NutriLayout";
import { api, formatApiError } from "@/lib/evo-api";
import { useAuth } from "@/contexts/AuthContext";
import StatusBadge from "@/components/evonut/StatusBadge";

/**
 * Painel "o que fazer hoje" (ajuste pain1 do Rogério): saudação com resumo do dia e ações rápidas, linha do tempo
 * das consultas de hoje, pendências automáticas com botão de ação (somem ao resolver), jornada compacta e clicável,
 * números do mês e próximos passos. Sem quadros vazios grandes.
 */
const moeda = (v) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
function saudacao() {
  const h = new Date().getHours();
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}
const ICONE_PEND = { formulario: ClipboardList, sem_plano: Utensils, exame: FlaskConical, sem_resposta: MessageCircle, plano_vencendo: Wallet, pagamento_atrasado: Wallet, lead_parado: Send };
const COR_PEND = { pagamento_atrasado: "text-rc-coral", sem_resposta: "text-rc-amber", lead_parado: "text-rc-amber", plano_vencendo: "text-rc-amber" };
const ROTULO_ACAO = { revisar: "Revisar", prescricao: "Montar plano", exames: "Ver exames", whatsapp: "WhatsApp", renovar: "Renovar", cobrar: "Cobrar", proposta: "Enviar formulário", conversa: "Responder" };

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [dados, setDados] = useState(null);
  const [etapaAberta, setEtapaAberta] = useState(null);
  const carregar = useCallback(() => api.get("/painel").then((r) => setDados(r.data)).catch(() => setDados({ hoje: [], pendencias: [], jornada: [], mes: {}, proximos_passos: [] })), []);
  useEffect(() => { carregar(); }, [carregar]);

  const resolver = async (p) => {
    await api.post(`/patients/${p.paciente_id}/pendencias/resolver`, { tipo: p.tipo }).catch(() => {});
    setDados((d) => ({ ...d, pendencias: d.pendencias.filter((x) => !(x.paciente_id === p.paciente_id && x.tipo === p.tipo)) }));
  };
  const agir = async (p) => {
    const fone = String(p.telefone || "").replace(/\D/g, "");
    const zap = fone ? `https://wa.me/${fone.length <= 11 ? `55${fone}` : fone}` : null;
    if (p.acao === "revisar") { await resolver(p); navigate(`/pacientes/${p.paciente_id}?aba=anamnese`); return; }
    if (p.acao === "prescricao") { navigate(`/pacientes/${p.paciente_id}?aba=plano`); return; }
    if (p.acao === "exames") { await resolver(p); navigate(`/pacientes/${p.paciente_id}?aba=exames`); return; }
    if (p.acao === "whatsapp") { if (zap) window.open(`${zap}?text=${encodeURIComponent(`Oi, ${(p.nome || "").split(" ")[0]}! Tudo certo? Me conta como está indo o plano.`)}`, "_blank", "noopener"); await resolver(p); return; }
    if (p.acao === "renovar" || p.acao === "cobrar") { navigate("/pagamentos"); return; }
    if (p.acao === "conversa") { navigate(`/acompanhamento/conversas?c=${p.paciente_id}`); return; }
    if (p.acao === "proposta") {
      try {
        const { data } = await api.post(`/patients/${p.paciente_id}/formulario/enviar`, { tipo: "inicial" });
        const url = `${window.location.origin}/pre-consulta/${data.token}`;
        if (zap) window.open(`${zap}?text=${encodeURIComponent(`Oi, ${(p.nome || "").split(" ")[0]}! Para começarmos, preencha o formulário pré-consulta: ${url}`)}`, "_blank", "noopener");
        await resolver(p);
        toast.success("Formulário enviado.");
      } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    }
  };

  const nome = (user?.name || "").split(" ")[0];
  const nHoje = dados?.hoje?.length ?? 0;
  const nPend = dados?.pendencias?.length ?? 0;
  const mes = dados?.mes || {};
  const conversao = mes.leads ? Math.round((mes.convertidos / mes.leads) * 100) : null;

  return (
    <NutriLayout>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4" data-testid="painel-topo">
        <div>
          <div className="rc-eyebrow">Painel</div>
          <h1 className="rc-h1 mt-2">{saudacao()}{nome ? `, ${nome}` : ""}</h1>
          <p className="mt-1 text-[15px] text-gray-400" data-testid="resumo-dia">
            {dados ? `${nHoje} ${nHoje === 1 ? "consulta" : "consultas"} hoje e ${nPend} ${nPend === 1 ? "pendência" : "pendências"}` : "…"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/pacientes?novo=1" className="rc-btn-primary"><UserPlus className="h-4 w-4" /> Novo paciente</Link>
          <Link to="/acompanhamento/formularios" className="rc-btn-secondary"><Send className="h-4 w-4" /> Enviar formulário</Link>
          <Link to="/consultorio" className="rc-btn-secondary"><Stethoscope className="h-4 w-4" /> Abrir consultório</Link>
        </div>
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5 min-w-0">
          <section className="rc-card p-5" data-testid="painel-hoje">
            <h2 className="rc-h3 mb-3">Hoje</h2>
            {!dados ? <div className="h-10 animate-pulse-soft rounded bg-white/[0.05]" /> : nHoje === 0 ? (
              <p className="text-[14px] text-gray-400"><CalendarDays className="mr-2 inline h-4 w-4" />Dia livre.{dados.proxima ? ` Próxima consulta: ${dados.proxima.data.split("-").reverse().join("/")} às ${dados.proxima.hora} com ${dados.proxima.nome}.` : " Nenhuma consulta marcada."}</p>
            ) : (
              <ol className="relative space-y-2 border-l border-white/[0.08] pl-5">
                {dados.hoje.map((c) => (
                  <li key={c.id || `${c.hora}-${c.paciente_id}`} className="relative flex flex-wrap items-center gap-3">
                    <span className="absolute -left-[25px] h-2.5 w-2.5 rounded-full bg-rc-blue" />
                    <span className="rc-num w-14 text-[17px] text-white tabular">{c.hora}</span>
                    <span className="min-w-0 flex-1"><span className="font-semibold text-white">{c.nome || "Paciente"}</span> <span className="text-[12.5px] text-gray-500">{c.tipo || ""}</span></span>
                    <span className="text-[12px] text-gray-400">{c.status}</span>
                    {c.paciente_id && <Link to={`/pacientes/${c.paciente_id}`} className="rc-btn-ghost h-8 text-[12.5px]">Abrir ficha <ChevronRight className="h-3.5 w-3.5" /></Link>}
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="rc-card p-5" data-testid="painel-pendencias">
            <h2 className="rc-h3 mb-3">Pendências <span className="ml-1 rounded-full bg-white/[0.08] px-2 py-0.5 text-[12px] font-semibold tabular text-gray-200">{nPend}</span></h2>
            {!dados ? <div className="h-10 animate-pulse-soft rounded bg-white/[0.05]" /> : !nPend ? <p className="text-[14px] text-gray-400"><Check className="mr-2 inline h-4 w-4 text-[#4ADE80]" />Tudo em dia.</p> : (
              <ul className="divide-y divide-white/[0.05]">
                {dados.pendencias.map((p) => {
                  const Ic = ICONE_PEND[p.tipo] || AlertTriangle;
                  return (
                    <li key={`${p.paciente_id}-${p.tipo}`} className="flex flex-wrap items-center gap-3 py-2.5" data-testid={`pendencia-${p.tipo}`}>
                      <Ic className={`h-4 w-4 shrink-0 ${COR_PEND[p.tipo] || "text-rc-blueLight"}`} />
                      <span className="min-w-0 flex-1 text-[13.5px]"><Link to={`/pacientes/${p.paciente_id}`} className="font-semibold text-white hover:underline">{p.nome}</Link> <span className="text-gray-400">· {p.texto}</span></span>
                      <button type="button" onClick={() => agir(p)} className="rc-btn-secondary h-8 text-[12.5px]">{ROTULO_ACAO[p.acao] || "Abrir"}</button>
                      <button type="button" onClick={() => resolver(p)} className="rc-btn-ghost h-8 text-[12px]" title="Marcar como resolvida" aria-label="Resolvida"><Check className="h-3.5 w-3.5" /></button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {dados?.proximos_passos?.length > 0 && (
            <section className="rc-card p-5" data-testid="painel-passos">
              <h2 className="rc-h3 mb-3">Próximos passos</h2>
              <ul className="divide-y divide-white/[0.05]">
                {dados.proximos_passos.map((x) => (
                  <li key={x.paciente_id} className="flex flex-wrap items-center gap-3 py-2.5 text-[13.5px]">
                    <Link to={`/pacientes/${x.paciente_id}`} className="min-w-0 flex-1 font-semibold text-white hover:underline">{x.nome}</Link>
                    <StatusBadge status={x.etapa} />
                    <span className="text-gray-400">última {x.ultima} · falta: <b className="font-medium text-gray-200">{x.falta}</b></span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="space-y-5">
          <section className="rc-card p-5" data-testid="painel-jornada">
            <h2 className="rc-h3 mb-3">Jornada</h2>
            <div className="flex flex-wrap gap-1.5">
              {(dados?.jornada || []).map((j, i) => (
                <button key={j.key} type="button" onClick={() => setEtapaAberta(etapaAberta === j.key ? null : j.key)} aria-pressed={etapaAberta === j.key}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] ${etapaAberta === j.key ? "bg-rc-blue text-white" : "bg-white/[0.05] text-gray-300 hover:text-white"}`}>
                  {i > 0 && <ChevronRight className="-ml-1 h-3 w-3 opacity-50" />}{j.rotulo} <b className="tabular">{j.total}</b>
                </button>
              ))}
            </div>
            {etapaAberta && (
              <ul className="mt-3 space-y-1 text-[13px]">
                {(dados.jornada.find((j) => j.key === etapaAberta)?.pacientes || []).map((p) => (
                  <li key={p.id}><Link to={`/pacientes/${p.id}`} className="text-gray-200 hover:underline">{p.nome}</Link></li>
                ))}
                {!dados.jornada.find((j) => j.key === etapaAberta)?.pacientes?.length && <li className="text-gray-500">Ninguém nesta etapa.</li>}
              </ul>
            )}
            {dados?.perdidos > 0 && <p className="mt-3 text-[12px] text-gray-500">{dados.perdidos} perdidos no histórico</p>}
          </section>

          <section className="rc-card p-5" data-testid="painel-mes">
            <h2 className="rc-h3 mb-3">Este mês</h2>
            <dl className="grid grid-cols-2 gap-3">
              {[["Consultas", mes.consultas], ["Novos pacientes", mes.novos_pacientes], ["Renovações", mes.renovacoes], ["Conversão", conversao != null ? `${conversao}%` : "—"]].map(([l, v]) => (
                <div key={l}><dt className="text-[10.5px] uppercase tracking-[0.14em] text-gray-500">{l}</dt><dd className="rc-num text-[24px] text-white">{v ?? "…"}</dd></div>
              ))}
              <div className="col-span-2 border-t border-white/[0.05] pt-3">
                <dt className="text-[10.5px] uppercase tracking-[0.14em] text-gray-500">Recebido / a receber</dt>
                <dd className="text-[16px] font-semibold text-white tabular">{moeda(mes.recebido)} <span className="text-gray-500">/ {moeda(mes.a_receber)}</span></dd>
              </div>
              {mes.leads > 0 && <p className="col-span-2 text-[12px] text-gray-500">{mes.leads} leads, {mes.convertidos} fecharam.</p>}
            </dl>
          </section>
        </aside>
      </div>
    </NutriLayout>
  );
}
