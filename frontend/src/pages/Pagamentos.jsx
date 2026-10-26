import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Pencil, Plus, Search, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import NutriLayout from "@/components/evonut/NutriLayout";
import PageHeader from "@/components/evonut/PageHeader";
import { api, formatApiError } from "@/lib/evo-api";
import {
  CobrarButton, FORMA_LABEL, PagamentoModal, PlanoModal, PlanoStatusBadge, dataBR, moeda,
} from "@/components/evonut/Financeiro";

const FILTROS = [
  ["cobrar", "A cobrar"],
  ["em_dia", "Em dia"],
  ["sem_plano", "Sem plano"],
  ["todos", "Todos"],
];

function Kpi({ label, value, hint, tone = "text-white" }) {
  return (
    <div className="p-5 sm:p-6">
      <div className="text-[12px] text-gray-400">{label}</div>
      <div className={`rc-num text-[34px] sm:text-[40px] leading-none mt-2 ${tone}`}>{value ?? "–"}</div>
      <div className="text-[12px] text-gray-500 mt-2 h-4">{hint}</div>
    </div>
  );
}

export default function Pagamentos() {
  const [janela, setJanela] = useState(7);
  const [resumo, setResumo] = useState(null);
  const [alunos, setAlunos] = useState(null);
  const [pagamentos, setPagamentos] = useState(null);
  const [filtro, setFiltro] = useState("cobrar");
  const [busca, setBusca] = useState("");
  const [modal, setModal] = useState(null); // { tipo: "plano" | "pagamento", aluno }

  const load = useCallback(() => {
    api.get("/financeiro/resumo", { params: { janela } }).then((r) => setResumo(r.data)).catch(() => setResumo(null));
    api.get("/financeiro/alunos", { params: { janela } }).then((r) => setAlunos(r.data)).catch(() => setAlunos([]));
    api.get("/financeiro/pagamentos", { params: { limit: 30 } }).then((r) => setPagamentos(r.data)).catch(() => setPagamentos([]));
  }, [janela]);

  useEffect(() => { load(); }, [load]);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (alunos || []).filter((a) => {
      if (filtro === "cobrar" && !["vencido", "vencendo"].includes(a.status)) return false;
      if (filtro === "em_dia" && a.status !== "em_dia") return false;
      if (filtro === "sem_plano" && !["sem_plano", "cancelado"].includes(a.status)) return false;
      if (!termo) return true;
      return [a.nome, a.email, a.telefone, a.assinatura?.plano].some((v) => String(v || "").toLowerCase().includes(termo));
    });
  }, [alunos, filtro, busca]);

  const excluirPagamento = async (pg) => {
    if (!window.confirm(`Excluir o pagamento de ${moeda(pg.valor)} de ${pg.paciente_nome}?`)) return;
    try {
      const { data } = await api.delete(`/patients/${pg.paciente_id}/pagamentos/${pg.id}`);
      toast.success(data.vencimento_revertido ? "Pagamento excluído e vencimento restaurado." : "Pagamento excluído.");
      load();
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail));
    }
  };

  const c = resumo?.contagem || {};

  return (
    <NutriLayout>
      <PageHeader
        eyebrow="Financeiro"
        title="Pagamentos e cobrança"
        description="Planos dos alunos, vencimentos e histórico de pagamentos. Cobre pelo WhatsApp com a mensagem pronta e registre o pagamento para renovar o plano."
        actions={(
          <label className="flex items-center gap-2 text-[13px] text-gray-400">
            Avisar com
            <select className="rc-input h-9 py-0 w-auto" value={janela} onChange={(e) => setJanela(Number(e.target.value))}>
              {[3, 7, 15, 30].map((d) => <option key={d} value={d}>{d} dias</option>)}
            </select>
            de antecedência
          </label>
        )}
      />

      <section className="rc-card grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-white/[0.05] overflow-hidden" aria-label="Resumo financeiro">
        <Kpi label="Vencidos" value={resumo ? c.vencido : undefined} hint="Cobrar agora" tone={c.vencido ? "text-rc-coral" : "text-white"} />
        <Kpi label={`Vencendo em ${janela} dias`} value={resumo ? c.vencendo : undefined} hint="Avisar antes de vencer" tone={c.vencendo ? "text-rc-amber" : "text-white"} />
        <Kpi label="Recebido no mês" value={resumo ? moeda(resumo.recebido_mes) : undefined} hint="Pagamentos registrados" tone="text-rc-lime" />
        <Kpi label="A receber no mês" value={resumo ? moeda(resumo.a_receber_mes) : undefined} hint={`${c.em_dia ?? 0} ${c.em_dia === 1 ? "aluno" : "alunos"} em dia`} />
      </section>

      <section className="rc-card mt-5">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 sm:px-6 pt-5 pb-4">
          <div role="tablist" className="flex flex-wrap gap-1">
            {FILTROS.map(([k, l]) => {
              const n = k === "cobrar" ? (c.vencido || 0) + (c.vencendo || 0) : k === "em_dia" ? c.em_dia : k === "sem_plano" ? (c.sem_plano || 0) + (c.cancelado || 0) : alunos?.length;
              return (
                <button
                  key={k}
                  role="tab"
                  aria-selected={filtro === k}
                  onClick={() => setFiltro(k)}
                  className={`h-9 px-3 rounded-lg text-[13px] transition-colors ${filtro === k ? "bg-white/[0.07] text-white font-medium" : "text-gray-400 hover:text-gray-100 hover:bg-white/[0.035]"}`}
                >
                  {l} <span className="tabular text-gray-500 ml-1">{n ?? ""}</span>
                </button>
              );
            })}
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input className="rc-input pl-9 h-9 py-0" placeholder="Buscar aluno ou plano" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
        </div>

        {alunos === null && <div className="px-6 pb-6 text-[13px] text-gray-500">Carregando...</div>}
        {alunos !== null && visiveis.length === 0 && (
          <div className="px-6 pb-10 pt-4 text-center">
            <p className="text-gray-300">{filtro === "cobrar" ? "Nenhum plano vencido ou vencendo." : "Nenhum aluno neste filtro."}</p>
            <p className="text-[13px] text-gray-500 mt-1">
              {filtro === "cobrar" ? "Tudo em dia por aqui." : "Cadastre o plano dos alunos para acompanhar os vencimentos."}
            </p>
          </div>
        )}

        {visiveis.length > 0 && (
          <div className="border-t border-white/[0.05]">
            <div className="hidden lg:grid grid-cols-[minmax(0,1.5fr)_minmax(0,1.3fr)_100px_140px_minmax(0,1fr)_260px] gap-4 px-6 py-2.5 text-[11px] uppercase tracking-[0.12em] text-gray-500">
              <div>Aluno</div><div>Plano</div><div>Vencimento</div><div>Situação</div><div>Última cobrança</div><div className="text-right">Ações</div>
            </div>
            <ul className="divide-y divide-white/[0.05]">
              {visiveis.map((a) => {
                const ass = a.assinatura || {};
                const ativo = ass.plano && ass.ativo !== false;
                return (
                  <li key={a.id} className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1.3fr)_100px_140px_minmax(0,1fr)_260px] gap-x-4 gap-y-2 items-center px-5 sm:px-6 py-3.5">
                    <div className="min-w-0">
                      <Link to={`/pacientes/${a.id}`} className="text-[14px] font-medium text-gray-100 hover:text-white truncate block">{a.nome}</Link>
                      <div className="text-[12px] text-gray-500 truncate">{a.telefone || a.email || "Sem contato"}</div>
                    </div>
                    <div className="min-w-0 text-[13px]">
                      {ativo ? <><span className="text-gray-200">{ass.plano}</span> <span className="text-gray-500 tabular">· {moeda(ass.valor)}</span></> : <span className="text-gray-500">–</span>}
                    </div>
                    <div className="text-[13px] text-gray-300 tabular"><span className="lg:hidden text-gray-500">Vencimento </span>{ativo ? dataBR(ass.vencimento) : "–"}</div>
                    <div><PlanoStatusBadge aluno={a} /></div>
                    <div className="text-[12px] text-gray-500">
                      {ass.ultima_cobranca
                        ? `Cobrado ${dataBR(ass.ultima_cobranca.data)} · ${ass.ultima_cobranca.canal === "whatsapp" ? "WhatsApp" : ass.ultima_cobranca.canal}`
                        : <span className="hidden lg:inline">–</span>}
                    </div>
                    <div className="flex flex-wrap gap-1.5 lg:justify-end">
                      {["vencido", "vencendo"].includes(a.status) && <CobrarButton aluno={a} onDone={load} compact />}
                      <button type="button" onClick={() => setModal({ tipo: "pagamento", aluno: a })} className="rc-btn-primary px-2.5 py-1.5 text-[12.5px]">
                        <Wallet className="w-3.5 h-3.5" strokeWidth={1.75} /> Pagamento
                      </button>
                      <button type="button" aria-label={ativo ? "Editar plano" : "Cadastrar plano"} onClick={() => setModal({ tipo: "plano", aluno: a })} className="rc-btn-ghost px-2.5 py-1.5 text-[12.5px]">
                        {ativo ? <Pencil className="w-3.5 h-3.5" /> : <><Plus className="w-3.5 h-3.5" /> Plano</>}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      <section className="rc-card mt-5">
        <div className="px-5 sm:px-6 pt-5 pb-3">
          <h2 className="rc-h3">Pagamentos recentes</h2>
        </div>
        {pagamentos?.length === 0 && <p className="px-6 pb-6 text-[13px] text-gray-500">Nenhum pagamento registrado ainda.</p>}
        {pagamentos?.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead className="text-[11px] uppercase tracking-[0.12em] text-gray-500">
                <tr className="border-t border-white/[0.05]">
                  <th className="text-left font-medium px-6 py-2.5">Data</th>
                  <th className="text-left font-medium px-3 py-2.5">Aluno</th>
                  <th className="text-left font-medium px-3 py-2.5">Plano</th>
                  <th className="text-left font-medium px-3 py-2.5">Forma</th>
                  <th className="text-left font-medium px-3 py-2.5">Renovou até</th>
                  <th className="text-right font-medium px-3 py-2.5">Valor</th>
                  <th className="px-6 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {pagamentos.map((pg) => (
                  <tr key={pg.id}>
                    <td className="px-6 py-3 tabular text-gray-300">{dataBR(pg.data_pagamento)}</td>
                    <td className="px-3 py-3 text-gray-100">{pg.paciente_nome}</td>
                    <td className="px-3 py-3 text-gray-400">{pg.plano || "–"}</td>
                    <td className="px-3 py-3 text-gray-400">{FORMA_LABEL[pg.forma] || pg.forma}</td>
                    <td className="px-3 py-3 tabular text-gray-400">{dataBR(pg.novo_vencimento)}</td>
                    <td className="px-3 py-3 text-right rc-num text-[16px] text-rc-lime">{moeda(pg.valor)}</td>
                    <td className="px-6 py-3 text-right">
                      <button type="button" aria-label="Excluir pagamento" onClick={() => excluirPagamento(pg)} className="rc-btn-ghost p-2 text-rc-coral"><Trash2 className="w-3.5 h-3.5" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modal?.tipo === "plano" && <PlanoModal aluno={modal.aluno} onClose={() => setModal(null)} onSaved={load} />}
      {modal?.tipo === "pagamento" && <PagamentoModal aluno={modal.aluno} onClose={() => setModal(null)} onSaved={load} />}
    </NutriLayout>
  );
}
