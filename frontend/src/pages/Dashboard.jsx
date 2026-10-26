import React, { useCallback, useEffect, useState } from "react";
import NutriLayout from "@/components/evonut/NutriLayout";
import { api } from "@/lib/evo-api";
import { useAuth } from "@/contexts/AuthContext";
import { Link } from "react-router-dom";
import { ArrowUpRight, ChevronRight, Stethoscope, UserPlus, CalendarDays, Wallet } from "lucide-react";
import StatusBadge, { STATUS_LABELS } from "@/components/evonut/StatusBadge";
import { CobrarButton, PagamentoModal, PlanoStatusBadge, dataBR, moeda } from "@/components/evonut/Financeiro";

const FUNIL_ORDEM = [
  "LEAD_INICIADO",
  "ANAMNESE_COMPLETA",
  "CONSULTA_AGENDADA",
  "CONSULTA_REALIZADA",
  "PLANO_ENTREGUE",
  "EM_ACOMPANHAMENTO",
];
const FUNIL_COR = {
  LEAD_INICIADO: "bg-gray-600",
  ANAMNESE_COMPLETA: "bg-rc-blueDark",
  CONSULTA_AGENDADA: "bg-rc-amber",
  CONSULTA_REALIZADA: "bg-rc-blue",
  PLANO_ENTREGUE: "bg-rc-limeDark",
  EM_ACOMPANHAMENTO: "bg-rc-lime",
};

function saudacao() {
  const h = new Date().getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

function Skeleton({ className = "" }) {
  return <div className={`rounded-md bg-white/[0.05] animate-pulse-soft ${className}`} />;
}

function Kpi({ testid, label, value, hint, accent, delay }) {
  const loading = value === undefined;
  return (
    <div data-testid={testid} className="p-5 sm:p-6 animate-fade-up" style={{ animationDelay: `${delay}ms` }}>
      <div className="text-[12px] text-gray-400">{label}</div>
      {loading ? (
        <Skeleton className="h-11 w-16 mt-3" />
      ) : (
        <div className={`rc-num text-[44px] sm:text-[52px] leading-none mt-2 ${accent ? "text-rc-lime" : "text-white"}`}>{value ?? 0}</div>
      )}
      <div className="text-[12px] text-gray-500 mt-2 h-4">{hint}</div>
    </div>
  );
}

function Initials({ nome }) {
  const parts = (nome || "?").trim().split(/\s+/);
  const ini = (parts[0]?.[0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "");
  return (
    <div className="w-9 h-9 shrink-0 rounded-[10px] bg-rc-raised text-gray-200 flex items-center justify-center text-[12px] font-semibold uppercase shadow-[0_0_0_1px_rgba(255,255,255,0.07)]">
      {ini}
    </div>
  );
}

function PlanosVencendo() {
  const [resumo, setResumo] = useState(null);
  const [pagando, setPagando] = useState(null);
  const load = useCallback(() => {
    api.get("/financeiro/resumo", { params: { janela: 7 } }).then((r) => setResumo(r.data)).catch(() => setResumo({ cobrar: [] }));
  }, []);
  useEffect(() => { load(); }, [load]);

  const lista = resumo?.cobrar || [];
  const vencidos = lista.filter((a) => a.status === "vencido").length;
  return (
    <section className="rc-card mt-5" data-testid="planos-vencendo">
      <div className="flex items-center justify-between gap-3 px-5 sm:px-6 pt-5 pb-3">
        <div>
          <h2 className="rc-h3">Planos vencendo</h2>
          <p className="text-[12.5px] text-gray-500 mt-1">
            {resumo === null ? "Carregando..." : lista.length
              ? `${lista.length} ${lista.length === 1 ? "aluno" : "alunos"} para cobrar${vencidos ? `, ${vencidos} já ${vencidos === 1 ? "vencido" : "vencidos"}` : ""}`
              : "Nenhum plano vence nos próximos 7 dias"}
          </p>
        </div>
        <Link to="/pagamentos" className="rc-btn-ghost -mr-2"><Wallet className="w-3.5 h-3.5" /> Pagamentos</Link>
      </div>
      {resumo === null && <div className="px-5 sm:px-6 pb-5 space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-10" />)}</div>}
      {lista.length > 0 && (
        <ul className="pb-2">
          {lista.slice(0, 8).map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 sm:px-6 py-3 border-t border-white/[0.04]">
              <Initials nome={a.nome} />
              <Link to={`/pacientes/${a.id}`} className="flex-1 min-w-[160px]">
                <div className="text-[14px] font-medium text-gray-100 truncate">{a.nome}</div>
                <div className="text-[12px] text-gray-500 truncate">
                  {a.assinatura?.plano} · {moeda(a.assinatura?.valor)} · vence {dataBR(a.assinatura?.vencimento)}
                </div>
              </Link>
              <PlanoStatusBadge aluno={a} />
              <div className="flex gap-1.5">
                <CobrarButton aluno={a} onDone={load} compact />
                <button type="button" onClick={() => setPagando(a)} className="rc-btn-primary px-2.5 py-1.5 text-[12.5px]">
                  <Wallet className="w-3.5 h-3.5" strokeWidth={1.75} /> Pago
                </button>
              </div>
            </li>
          ))}
          {lista.length > 8 && (
            <li className="px-5 sm:px-6 py-3 border-t border-white/[0.04]">
              <Link to="/pagamentos" className="text-[13px] text-rc-blueLight hover:text-white">Ver mais {lista.length - 8} na tela de pagamentos</Link>
            </li>
          )}
        </ul>
      )}
      {pagando && <PagamentoModal aluno={pagando} onClose={() => setPagando(null)} onSaved={load} />}
    </section>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [patients, setPatients] = useState(null);
  const [agenda, setAgenda] = useState(null);

  useEffect(() => {
    api.get("/dashboard").then((r) => setStats(r.data)).catch(() => setStats({}));
    api.get("/patients").then((r) => setPatients((r.data || []).slice(0, 6))).catch(() => setPatients([]));
    api.get("/agenda")
      .then((r) => {
        const agora = Date.now();
        setAgenda(
          (r.data || [])
            .filter((c) => c.status === "AGENDADA" && new Date(c.data_hora).getTime() >= agora)
            .sort((a, b) => new Date(a.data_hora) - new Date(b.data_hora))
            .slice(0, 5)
        );
      })
      .catch(() => setAgenda([]));
  }, []);

  const s = stats || {};
  const total = s.total_pacientes;
  const pctAcomp = total ? Math.round(((s.em_acompanhamento || 0) / total) * 100) : null;
  const funil = FUNIL_ORDEM.map((k) => ({ k, v: (s.funil || {})[k] || 0 }));
  const funilTotal = funil.reduce((acc, f) => acc + f.v, 0);
  const funilMax = Math.max(1, ...funil.map((f) => f.v));
  const primeiroNome = (user?.name || "").split(" ")[0];
  const hoje = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });

  return (
    <NutriLayout>
      {/* Cabecalho */}
      <header className="flex items-end justify-between flex-wrap gap-5 mb-8">
        <div>
          <div className="rc-eyebrow first-letter:uppercase">{hoje}</div>
          <h1 className="rc-h1 mt-3">
            {saudacao()}{primeiroNome ? <>, <span className="text-rc-blue">{primeiroNome}</span></> : ""}
          </h1>
          <p className="text-gray-400 mt-3 max-w-[52ch]">
            {s.consultas_hoje
              ? `Você tem ${s.consultas_hoje} ${s.consultas_hoje === 1 ? "consulta" : "consultas"} hoje.`
              : "Nenhuma consulta para hoje. Bom momento para revisar planos e exames."}
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/pacientes" className="rc-btn-secondary"><UserPlus className="w-4 h-4" strokeWidth={1.75} /> Pacientes</Link>
          <Link to="/consultorio" className="rc-btn-primary"><Stethoscope className="w-4 h-4" strokeWidth={2} /> Abrir consultório</Link>
        </div>
      </header>

      {/* Indicadores */}
      <section className="rc-card grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-white/[0.05] overflow-hidden" aria-label="Indicadores">
        <Kpi testid="stat-total_pacientes" label="Pacientes na base" value={stats ? total : undefined} hint="Todos os cadastros" delay={0} />
        <Kpi testid="stat-consultas_hoje" label="Consultas hoje" value={stats ? s.consultas_hoje : undefined} hint="Agenda do dia" delay={40} />
        <Kpi testid="stat-novos_7d" label="Novos em 7 dias" value={stats ? s.novos_7d : undefined} hint="Leads e cadastros" delay={80} />
        <Kpi
          testid="stat-em_acompanhamento"
          label="Em acompanhamento"
          value={stats ? s.em_acompanhamento : undefined}
          hint={pctAcomp !== null ? `${pctAcomp}% da base` : ""}
          accent
          delay={120}
        />
      </section>

      <PlanosVencendo />

      <div className="grid lg:grid-cols-3 gap-5 mt-5">
        <div className="lg:col-span-2 space-y-5">
          {/* Jornada */}
          <section className="rc-card p-5 sm:p-6">
            <div className="flex items-baseline justify-between gap-3 mb-5">
              <div>
                <h2 className="rc-h3">Jornada dos pacientes</h2>
                <p className="text-[12.5px] text-gray-500 mt-1">Do primeiro contato ao acompanhamento</p>
              </div>
              <div className="text-[12px] text-gray-500 tabular">{funilTotal} no funil</div>
            </div>

            {/* barra segmentada */}
            <div className="flex h-2.5 rounded-full overflow-hidden bg-white/[0.04] mb-6">
              {funilTotal > 0 && funil.filter((f) => f.v).map((f) => (
                <div key={f.k} className={`${FUNIL_COR[f.k]} h-full first:rounded-l-full last:rounded-r-full`} style={{ width: `${(f.v / funilTotal) * 100}%` }} title={`${STATUS_LABELS[f.k]}: ${f.v}`} />
              ))}
            </div>

            <div className="space-y-3">
              {funil.map((f, i) => (
                <div key={f.k} className="grid grid-cols-[minmax(0,140px)_1fr_40px] items-center gap-3">
                  <div className="text-[13px] text-gray-300 truncate">{STATUS_LABELS[f.k]}</div>
                  <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                    <div
                      className={`h-full rounded-full origin-left animate-bar-grow ${FUNIL_COR[f.k]}`}
                      style={{ width: `${(f.v / funilMax) * 100}%`, animationDelay: `${120 + i * 50}ms` }}
                    />
                  </div>
                  <div className="rc-num text-lg text-right text-white">{stats ? f.v : "–"}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Pacientes recentes */}
          <section className="rc-card">
            <div className="flex items-center justify-between px-5 sm:px-6 pt-5 pb-3">
              <h2 className="rc-h3">Pacientes recentes</h2>
              <Link to="/pacientes" data-testid="goto-patients" className="rc-btn-ghost -mr-2">
                Ver todos <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </div>
            <ul className="pb-2">
              {patients === null && [0, 1, 2].map((i) => (
                <li key={i} className="flex items-center gap-3 px-5 sm:px-6 py-3">
                  <Skeleton className="w-9 h-9 rounded-[10px]" />
                  <div className="flex-1 space-y-2"><Skeleton className="h-3 w-40" /><Skeleton className="h-2.5 w-24" /></div>
                </li>
              ))}
              {patients?.length === 0 && (
                <li className="px-6 py-10 text-center">
                  <p className="text-gray-300">Nenhum paciente ainda.</p>
                  <p className="text-[13px] text-gray-500 mt-1">Compartilhe o link da pré-consulta para receber os primeiros leads.</p>
                </li>
              )}
              {patients?.map((p) => (
                <li key={p.id}>
                  <Link
                    to={`/pacientes/${p.id}`}
                    data-testid={`patient-row-${p.id}`}
                    className="group flex items-center gap-3 px-5 sm:px-6 py-3 hover:bg-white/[0.025] transition-colors"
                  >
                    <Initials nome={p.nome} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-medium text-gray-100 truncate">{p.nome}</div>
                      <div className="text-[12px] text-gray-500 truncate">{p.email || p.telefone || "Sem contato"}</div>
                    </div>
                    <div className="hidden sm:block"><StatusBadge status={p.status_funil} /></div>
                    <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-gray-300 transition-colors" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* Agenda */}
        <section className="rc-card p-5 sm:p-6 self-start">
          <div className="flex items-center justify-between mb-5">
            <h2 className="rc-h3">Próximas consultas</h2>
            <Link to="/agenda" className="rc-btn-ghost -mr-2"><CalendarDays className="w-3.5 h-3.5" /> Agenda</Link>
          </div>
          {agenda === null && <div className="space-y-4">{[0, 1].map((i) => <Skeleton key={i} className="h-14" />)}</div>}
          {agenda?.length === 0 && (
            <div className="rc-well px-4 py-8 text-center">
              <p className="text-gray-300 text-[14px]">Agenda livre</p>
              <p className="text-[12.5px] text-gray-500 mt-1">As consultas agendadas aparecem aqui.</p>
            </div>
          )}
          <ol className="relative">
            {agenda?.map((c, i) => {
              const d = new Date(c.data_hora);
              return (
                <li key={c.id} className="relative pl-6 pb-5 last:pb-0">
                  <span className={`absolute left-0 top-1.5 w-2.5 h-2.5 rounded-[3px] ${i === 0 ? "bg-rc-lime" : "bg-gray-600"}`} />
                  {i < agenda.length - 1 && <span className="absolute left-[4.5px] top-5 bottom-0 w-px bg-white/[0.07]" />}
                  <div className="flex items-baseline gap-2">
                    <span className="rc-num text-xl text-white">{d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                    <span className="text-[12px] text-gray-500">{d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" })}</span>
                  </div>
                  <div className="text-[14px] text-gray-100 mt-0.5 truncate">{c.paciente_nome}</div>
                  {c.tipo && <div className="text-[12px] text-rc-lime/80 mt-0.5">{c.tipo}</div>}
                </li>
              );
            })}
          </ol>
        </section>
      </div>
    </NutriLayout>
  );
}
