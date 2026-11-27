import React, { useCallback, useEffect, useState } from "react";
import { Bell, Eye, Loader2, Pencil, Play, Plus, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/evo-api";

/**
 * Lembretes (ajuste lem1 do Rogério): modelos com um clique, "antes de cada refeição" pelos horários da Prescrição,
 * prévia da mensagem da IA, repetição (todo dia, dias da semana, a cada X dias, data única, até o fim do plano),
 * horário num campo só, silêncio, canal e lista com liga/desliga, último envio e se o paciente respondeu.
 */
const MODELOS = [
  { modelo: "agua", label: "Água", trigger_text: "Lembrar de beber água agora e da meta do dia do plano.", horario: "10:00", repeticao: "diario" },
  { modelo: "pre_treino", label: "Pré-treino", trigger_text: "Lembrar da refeição pré-treino do plano, 1 hora antes do treino.", horario: "17:00", repeticao: "semanal", weekdays: [0, 1, 2, 3, 4] },
  { modelo: "pesagem", label: "Pesagem semanal", trigger_text: "Pedir a pesagem em jejum, logo após acordar, e que mande o peso aqui.", horario: "07:30", repeticao: "semanal", weekdays: [0] },
  { modelo: "foto", label: "Foto de evolução", trigger_text: "Pedir as fotos de evolução (frente, lado e costas) seguindo o protocolo de fotos.", horario: "08:00", repeticao: "intervalo", intervalo_dias: 15 },
  { modelo: "checkin", label: "Check-in de adesão", trigger_text: "Perguntar de 0 a 10 quanto conseguiu seguir o plano esta semana e o que foi mais difícil.", horario: "19:00", repeticao: "semanal", weekdays: [6] },
  { modelo: "vencendo", label: "Plano vencendo", trigger_text: "Avisar que o plano está perto de vencer e convidar para agendar o retorno.", horario: "10:00", repeticao: "unica" },
];
const DIAS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const vazio = { label: "", trigger_text: "", horario: "08:00", repeticao: "diario", weekdays: [], intervalo_dias: 7, data_unica: "", ate: "", canal: "app", silencio_inicio: "22:00", silencio_fim: "07:00", modelo: null };
const dataHora = (v) => (v ? new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
const diasDesde = (v) => (v ? Math.floor((Date.now() - new Date(v).getTime()) / 86400000) : null);
const hh = (n) => `${String(n.hour).padStart(2, "0")}:${String(n.minute).padStart(2, "0")}`;

function descricaoRepeticao(n) {
  if (n.repeticao === "unica") return `uma vez em ${n.data_unica ? n.data_unica.split("-").reverse().join("/") : "—"}`;
  if (n.repeticao === "intervalo") return `a cada ${n.intervalo_dias} dias`;
  if (n.repeticao === "semanal" && n.weekdays?.length) return n.weekdays.map((d) => DIAS[d]).join(", ");
  return "todo dia";
}

export default function NudgeManager({ patientId }) {
  const [lista, setLista] = useState(null);
  const [form, setForm] = useState(null);
  const [editId, setEditId] = useState(null);
  const [previa, setPrevia] = useState("");
  const [carregandoPrevia, setCarregandoPrevia] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [refeicoes, setRefeicoes] = useState({ ativo: false, minutos_antes: 15, canal: "app" });

  const carregar = useCallback(async () => {
    try {
      const [{ data: ls }, { data: d }] = await Promise.all([api.get(`/patients/${patientId}/nudges`), api.get(`/patients/${patientId}`)]);
      setLista(ls || []);
      if (d?.patient?.lembretes_refeicao) setRefeicoes((s) => ({ ...s, ...d.patient.lembretes_refeicao }));
    } catch { setLista([]); }
  }, [patientId]);
  useEffect(() => { carregar(); }, [carregar]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const abrirNovo = (m) => { setEditId(null); setPrevia(""); setForm({ ...vazio, ...(m || {}) }); };
  const editar = (n) => {
    setEditId(n.id); setPrevia("");
    setForm({ ...vazio, ...n, horario: hh(n), weekdays: n.weekdays || [], data_unica: n.data_unica || "", ate: n.ate || "", silencio_inicio: n.silencio_inicio || "", silencio_fim: n.silencio_fim || "" });
  };
  const payload = () => {
    const [h, m] = String(form.horario || "08:00").split(":").map(Number);
    return {
      label: form.label.trim(), trigger_text: form.trigger_text.trim(), hour: h || 0, minute: m || 0,
      weekdays: form.repeticao === "semanal" && form.weekdays.length ? form.weekdays : null,
      repeticao: form.repeticao, intervalo_dias: form.repeticao === "intervalo" ? Number(form.intervalo_dias) || 7 : null,
      data_unica: form.repeticao === "unica" ? form.data_unica || null : null, ate: form.ate || null,
      canal: form.canal, silencio_inicio: form.silencio_inicio || null, silencio_fim: form.silencio_fim || null, modelo: form.modelo || null,
    };
  };
  const salvar = async () => {
    if (!form.label.trim() || form.trigger_text.trim().length < 3) { toast.error("Dê um nome e escreva a instrução da mensagem."); return; }
    if (form.repeticao === "unica" && !form.data_unica) { toast.error("Escolha a data do envio."); return; }
    setSalvando(true);
    try {
      if (editId) await api.patch(`/patients/${patientId}/nudges/${editId}`, payload());
      else await api.post(`/patients/${patientId}/nudges`, { ...payload(), active: true });
      toast.success("Lembrete salvo."); setForm(null); carregar();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); } finally { setSalvando(false); }
  };
  const verPrevia = async () => {
    setCarregandoPrevia(true); setPrevia("");
    try { const { data } = await api.post(`/patients/${patientId}/nudges-previa`, { trigger_text: form.trigger_text }); setPrevia(data.mensagem); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); } finally { setCarregandoPrevia(false); }
  };
  const alternar = async (n) => { await api.patch(`/patients/${patientId}/nudges/${n.id}`, { active: !n.active }).catch(() => {}); carregar(); };
  const apagar = async (n) => { if (!window.confirm(`Apagar o lembrete "${n.label}"?`)) return; await api.delete(`/patients/${patientId}/nudges/${n.id}`).catch(() => {}); carregar(); };
  const enviarAgora = async (n) => {
    try { await api.post(`/patients/${patientId}/nudges/${n.id}/run-now`); toast.success("Enviado agora."); carregar(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const salvarRefeicoes = async (novo) => {
    const v = { ...refeicoes, ...novo };
    setRefeicoes(v);
    try { const { data } = await api.put(`/patients/${patientId}/nudges-refeicoes`, v); toast.success(v.ativo ? `${data.criados} lembretes antes das refeições do plano.` : "Lembretes das refeições desligados."); carregar(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const manuais = (lista || []).filter((n) => n.origem !== "plano");
  const doPlano = (lista || []).filter((n) => n.origem === "plano");

  return (
    <div className="space-y-4" data-testid="lembretes">
      <section className="rc-card p-5">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h3 className="font-display font-bold uppercase text-[16px] text-white" style={{ fontStretch: "86%" }}>Modelos prontos</h3>
          <button type="button" onClick={() => abrirNovo()} className="rc-btn-ghost ml-auto h-9"><Plus className="h-4 w-4" /> Lembrete em branco</button>
        </div>
        <div className="flex flex-wrap gap-2">
          {MODELOS.map((m) => (
            <button key={m.modelo} type="button" onClick={() => abrirNovo(m)} className="rounded-xl bg-white/[0.04] px-3.5 py-2 text-[13px] text-gray-200 ring-1 ring-white/[0.08] hover:ring-rc-blue/60" data-testid={`modelo-lembrete-${m.modelo}`}>
              <Bell className="mr-1.5 inline h-3.5 w-3.5 text-rc-lime" />{m.label}
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-white/[0.03] px-4 py-3 ring-1 ring-white/[0.06]" data-testid="antes-refeicoes">
          <label className="flex cursor-pointer items-center gap-2 text-[13.5px] text-gray-100">
            <input type="checkbox" className="h-4 w-4 accent-[#0081FD]" checked={Boolean(refeicoes.ativo)} onChange={(e) => salvarRefeicoes({ ativo: e.target.checked })} />
            Antes de cada refeição
          </label>
          <input className="rc-input h-9 w-20 tabular" inputMode="numeric" value={refeicoes.minutos_antes} onChange={(e) => setRefeicoes((s) => ({ ...s, minutos_antes: e.target.value }))}
            onBlur={() => refeicoes.ativo && salvarRefeicoes({ minutos_antes: Number(refeicoes.minutos_antes) || 15 })} aria-label="Minutos antes" />
          <span className="text-[13px] text-gray-400">min antes, pelos horários da Prescrição. Se o plano mudar, os lembretes mudam juntos.</span>
          {doPlano.length > 0 && <span className="text-[12px] text-gray-500">{doPlano.map((n) => `${hh(n)} ${n.refeicao}`).join(" · ")}</span>}
        </div>
      </section>

      {form && (
        <section className="rc-card p-5" data-testid="form-lembrete">
          <div className="mb-4 flex items-center gap-2">
            <h3 className="text-[15px] font-semibold text-white flex-1">{editId ? "Editar lembrete" : "Novo lembrete"}</h3>
            <button type="button" onClick={() => setForm(null)} className="rc-btn-ghost p-1.5" aria-label="Fechar"><X className="h-4 w-4" /></button>
          </div>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_120px_160px]">
            <label className="block"><span className="rc-label">Nome</span><input className="rc-input h-10" value={form.label} onChange={(e) => set("label", e.target.value)} /></label>
            <label className="block"><span className="rc-label">Horário</span><input type="time" className="rc-input h-10" value={form.horario} onChange={(e) => set("horario", e.target.value)} data-testid="horario-lembrete" /></label>
            <label className="block"><span className="rc-label">Canal</span>
              <select className="rc-input h-10" value={form.canal} onChange={(e) => set("canal", e.target.value)}><option value="app">App do aluno</option><option value="whatsapp">WhatsApp</option></select>
            </label>
          </div>
          <label className="mt-3 block"><span className="rc-label">O que a IA deve dizer</span>
            <textarea className="rc-input min-h-[70px] py-2" value={form.trigger_text} onChange={(e) => { set("trigger_text", e.target.value); setPrevia(""); }} />
          </label>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="block"><span className="rc-label">Repetir</span>
              <select className="rc-input h-10" value={form.repeticao} onChange={(e) => set("repeticao", e.target.value)} data-testid="repeticao">
                <option value="diario">Todo dia</option><option value="semanal">Dias da semana</option><option value="intervalo">A cada X dias</option><option value="unica">Data única</option>
              </select>
            </label>
            {form.repeticao === "semanal" && (
              <div className="flex gap-1">{DIAS.map((d, i) => (
                <button key={d} type="button" aria-pressed={form.weekdays.includes(i)} onClick={() => set("weekdays", form.weekdays.includes(i) ? form.weekdays.filter((x) => x !== i) : [...form.weekdays, i].sort())}
                  className={`h-10 w-11 rounded-lg text-[12.5px] font-semibold ${form.weekdays.includes(i) ? "bg-rc-blue text-white" : "bg-white/[0.05] text-gray-400"}`}>{d}</button>
              ))}</div>
            )}
            {form.repeticao === "intervalo" && <label className="block"><span className="rc-label">A cada (dias)</span><input className="rc-input h-10 w-24" inputMode="numeric" value={form.intervalo_dias} onChange={(e) => set("intervalo_dias", e.target.value)} /></label>}
            {form.repeticao === "unica" && <label className="block"><span className="rc-label">Data</span><input type="date" className="rc-input h-10" value={form.data_unica} onChange={(e) => set("data_unica", e.target.value)} /></label>}
            {form.repeticao !== "unica" && <label className="block"><span className="rc-label">Até (fim do plano)</span><input type="date" className="rc-input h-10" value={form.ate} onChange={(e) => set("ate", e.target.value)} /></label>}
            <label className="block"><span className="rc-label">Silêncio</span>
              <span className="flex items-center gap-1.5"><input type="time" className="rc-input h-10 w-28" value={form.silencio_inicio} onChange={(e) => set("silencio_inicio", e.target.value)} aria-label="Início do silêncio" /><span className="text-gray-500">às</span><input type="time" className="rc-input h-10 w-28" value={form.silencio_fim} onChange={(e) => set("silencio_fim", e.target.value)} aria-label="Fim do silêncio" /></span>
            </label>
          </div>
          {previa && <div className="mt-4 rounded-xl bg-rc-blue/10 px-4 py-3 text-[13.5px] text-gray-100 ring-1 ring-rc-blue/30" data-testid="previa-lembrete"><div className="mb-1 text-[11px] uppercase tracking-[0.12em] text-rc-blueLight">Prévia da mensagem</div>{previa}</div>}
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={verPrevia} disabled={carregandoPrevia || form.trigger_text.trim().length < 3} className="rc-btn-secondary h-10" data-testid="ver-previa">
              {carregandoPrevia ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />} Prévia
            </button>
            <button type="button" onClick={salvar} disabled={salvando} className="rc-btn-primary h-10" data-testid="salvar-lembrete"><Save className="h-4 w-4" /> Salvar lembrete</button>
          </div>
        </section>
      )}

      <section className="rc-card p-5">
        <h3 className="mb-3 font-display font-bold uppercase text-[16px] text-white" style={{ fontStretch: "86%" }}>Ativos</h3>
        {lista === null ? <Loader2 className="h-4 w-4 animate-spin text-gray-400" /> : !manuais.length ? <p className="text-[13px] text-gray-500">Nenhum lembrete. Comece por um modelo acima.</p> : (
          <ul className="divide-y divide-white/[0.05]">
            {manuais.map((n) => {
              const semResposta = n.last_fired_at && !n.respondeu_em ? diasDesde(n.last_fired_at) : null;
              return (
                <li key={n.id} className="flex flex-wrap items-center gap-3 py-3" data-testid={`lembrete-${n.id}`}>
                  <button type="button" role="switch" aria-checked={n.active} onClick={() => alternar(n)} aria-label={n.active ? "Desligar" : "Ligar"}
                    className={`relative h-6 w-11 rounded-full transition-colors ${n.active ? "bg-rc-lime" : "bg-white/[0.12]"}`}>
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-rc-ink transition-[left] ${n.active ? "left-[22px]" : "left-0.5"}`} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold text-white">{n.label} <span className="font-normal text-gray-400">· {hh(n)} · {descricaoRepeticao(n)} · {n.canal === "whatsapp" ? "WhatsApp" : "app"}</span></div>
                    <div className="text-[12px] text-gray-500">
                      Último envio {dataHora(n.last_fired_at)}
                      {n.respondeu_em && <span className="text-[#3DDC84]"> · respondeu {dataHora(n.respondeu_em)}</span>}
                      {semResposta != null && <span className={semResposta >= 3 ? "text-rc-amber" : ""}> · sem resposta há {semResposta} {semResposta === 1 ? "dia" : "dias"}</span>}
                    </div>
                  </div>
                  <button type="button" onClick={() => enviarAgora(n)} className="rc-btn-ghost h-8 text-[12.5px]" title="Enviar agora"><Play className="h-3.5 w-3.5" /> Agora</button>
                  <button type="button" onClick={() => editar(n)} className="rc-btn-ghost p-2" aria-label="Editar"><Pencil className="h-4 w-4" /></button>
                  <button type="button" onClick={() => apagar(n)} className="rc-btn-ghost p-2 text-rc-coral" aria-label="Apagar"><Trash2 className="h-4 w-4" /></button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
