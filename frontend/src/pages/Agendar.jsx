import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, formatApiError } from "@/lib/evo-api";
import Brand from "@/components/evonut/Brand";
import { CalendarDays, CheckCircle2, Clock, Copy, CreditCard, Loader2, QrCode, Upload } from "lucide-react";
import { toast } from "sonner";

/**
 * Agendamento com pagamento (ajuste fn2): só agenda se pagar.
 * 1) horários livres da Agenda (1 h, com folga de deslocamento das presenciais)
 * 2) o horário fica reservado 15 min com contador; se não pagar, volta a ficar livre
 * 3) Pix (comprovante) ou cartão (quando o provedor estiver ligado, o webhook confirma sozinho)
 * 4) confirmado → mensagem + link do formulário pré-consulta
 */
const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const RESERVA_KEY = "rc_reserva_atual";

function rotuloDia(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return `${DIAS[dt.getDay()]} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
const moeda = (v) => (v == null ? null : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const quandoBR = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)} às ${iso.slice(11, 16)}` : "");

export default function Agendar() {
  const { token } = useParams();
  const [busca] = useSearchParams();
  const [slots, setSlots] = useState(null);
  const [dia, setDia] = useState(null);
  const [sel, setSel] = useState(null);
  const [modalidade, setModalidade] = useState("online");
  const [dados, setDados] = useState({ nome: "", telefone: "", email: "" });
  const [reserva, setReserva] = useState(null);
  const [restante, setRestante] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const [arquivo, setArquivo] = useState(null);
  const [forma, setForma] = useState("pix");
  const fileRef = useRef(null);

  const carregarSlots = useCallback(() => {
    api.get("/public/agenda/horarios").then((r) => {
      setSlots(r.data || []);
      setDia((d) => d || (r.data || []).find((s) => s.livre)?.data || null);
    }).catch(() => { setSlots([]); toast.error("Não foi possível carregar os horários"); });
  }, []);

  useEffect(() => {
    carregarSlots();
    if (token) api.get(`/public/lead/${token}`).then((r) => setDados((d) => ({ ...d, nome: r.data.nome || "", telefone: r.data.telefone || "", email: r.data.email || "" }))).catch(() => {});
    let salvo = null;
    try { salvo = sessionStorage.getItem(RESERVA_KEY); } catch { /* sem armazenamento */ }
    if (salvo) api.get(`/public/reservas/${salvo}`).then((r) => { if (r.data.status !== "expirada") setReserva(r.data); }).catch(() => {});
  }, [token, carregarSlots]);

  // contador da reserva + acompanhamento do pagamento (o webhook confirma do outro lado)
  useEffect(() => {
    if (!reserva || reserva.status !== "aguardando_pagamento") return undefined;
    const fim = Date.now() + reserva.segundos * 1000;
    setRestante(reserva.segundos);
    const t = setInterval(() => {
      const s = Math.max(0, Math.round((fim - Date.now()) / 1000));
      setRestante(s);
      if (s === 0) { clearInterval(t); setReserva((r) => ({ ...r, status: "expirada" })); }
    }, 1000);
    return () => clearInterval(t);
  }, [reserva?.id, reserva?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!reserva || !["aguardando_pagamento", "comprovante_enviado"].includes(reserva.status)) return undefined;
    const t = setInterval(() => {
      api.get(`/public/reservas/${reserva.id}`).then((r) => {
        if (r.data.status !== reserva.status && r.data.status !== "expirada") setReserva(r.data);
      }).catch(() => {});
    }, 6000);
    return () => clearInterval(t);
  }, [reserva]);

  const reservar = async () => {
    if (!sel) { toast.error("Escolha um horário"); return; }
    if (dados.nome.trim().length < 2 || dados.telefone.replace(/\D/g, "").length < 10) { toast.error("Preencha nome e WhatsApp com DDD"); return; }
    setEnviando(true);
    try {
      const { data } = await api.post("/public/reservas", {
        nome: dados.nome, telefone: dados.telefone, email: dados.email || null, data_hora: sel.datetime, modalidade,
        plano: busca.get("plano") || null, token: token || null,
      });
      setReserva(data);
      try { sessionStorage.setItem(RESERVA_KEY, data.id); } catch { /* sem armazenamento */ }
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
      if (e.response?.status === 409) { setSel(null); carregarSlots(); }
    } finally { setEnviando(false); }
  };

  const enviarComprovante = async () => {
    if (!arquivo) { toast.error("Anexe o comprovante do Pix"); return; }
    setEnviando(true);
    try {
      const fd = new FormData();
      fd.append("file", arquivo);
      await api.post(`/public/reservas/${reserva.id}/comprovante`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      setReserva((r) => ({ ...r, status: "comprovante_enviado" }));
      toast.success("Comprovante enviado. Assim que for conferido, sua consulta é confirmada.");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); } finally { setEnviando(false); }
  };

  const recomecar = () => {
    try { sessionStorage.removeItem(RESERVA_KEY); } catch { /* sem armazenamento */ }
    setReserva(null); setSel(null); setArquivo(null); carregarSlots();
  };

  const dias = [...new Set((slots || []).map((s) => s.data))];
  const doDia = (slots || []).filter((s) => s.data === dia);

  return (
    <div className="min-h-screen bg-rc-ink">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-4 pb-4 pt-6 sm:px-6">
        <Link to="/" aria-label="Início"><Brand size="sm" /></Link>
        <div className="text-[11px] uppercase tracking-widest text-gray-500">Horário de Brasília</div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-16 sm:px-6">
        <ol className="mb-6 flex gap-2 text-[12px]" aria-label="Etapas">
          {["Horário", "Pagamento", "Confirmação"].map((e, i) => {
            const passo = !reserva ? 0 : reserva.status === "confirmada" ? 2 : 1;
            return <li key={e} className={`flex-1 border-b-2 pb-1.5 ${i <= passo ? "border-rc-blue text-white" : "border-white/[0.08] text-gray-500"}`}>{i + 1}. {e}</li>;
          })}
        </ol>

        {!reserva && (
          <>
            <h1 className="rc-h2">Escolha seu horário</h1>
            <p className="mt-1 text-sm text-gray-400">Consulta de 1 hora. O horário fica reservado por 15 minutos enquanto você paga.</p>

            <div className="mt-5 flex gap-2 overflow-x-auto pb-2" role="tablist" aria-label="Dias">
              {slots === null && <div className="text-sm text-gray-500"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Carregando horários…</div>}
              {dias.map((d) => {
                const livres = slots.filter((s) => s.data === d && s.livre).length;
                return (
                  <button key={d} type="button" role="tab" aria-selected={dia === d} disabled={!livres} onClick={() => { setDia(d); setSel(null); }}
                    className={`min-w-[78px] shrink-0 border px-3 py-2 text-center text-[13px] ${dia === d ? "border-rc-blue bg-rc-blue/15 text-white" : livres ? "border-white/[0.08] text-gray-200 hover:border-rc-blue/60" : "border-white/[0.04] text-gray-600"}`}>
                    <div className="font-semibold capitalize">{rotuloDia(d)}</div>
                    <div className="text-[11px] text-gray-400">{livres ? `${livres} livres` : "lotado"}</div>
                  </button>
                );
              })}
            </div>

            {dia && (
              <div className="rc-card mt-3 p-5">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><CalendarDays className="h-4 w-4 text-rc-blue" /> <span className="capitalize">{rotuloDia(dia)}</span></div>
                <div className="flex flex-wrap gap-2">
                  {doDia.map((s) => (
                    <button key={s.datetime} type="button" data-testid={`slot-${s.hora}`} disabled={!s.livre} onClick={() => setSel(s)}
                      className={`h-11 min-w-[84px] border px-4 text-sm font-semibold ${!s.livre ? "cursor-not-allowed border-white/[0.04] text-gray-600 line-through" : sel?.datetime === s.datetime ? "border-transparent bg-rc-blue text-white" : "border-white/[0.1] text-gray-200 hover:border-rc-blue/60"}`}>
                      <Clock className="-mt-0.5 mr-1.5 inline h-3.5 w-3.5" />{s.hora}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="rc-card mt-4 grid gap-3 p-5 sm:grid-cols-2">
              <label className="text-[13px] text-gray-300">Nome completo
                <input className="rc-input mt-1" value={dados.nome} onChange={(e) => setDados({ ...dados, nome: e.target.value })} data-testid="reserva-nome" /></label>
              <label className="text-[13px] text-gray-300">WhatsApp com DDD
                <input className="rc-input mt-1" inputMode="tel" value={dados.telefone} onChange={(e) => setDados({ ...dados, telefone: e.target.value })} data-testid="reserva-telefone" /></label>
              <label className="text-[13px] text-gray-300">E-mail (opcional)
                <input className="rc-input mt-1" type="email" value={dados.email} onChange={(e) => setDados({ ...dados, email: e.target.value })} /></label>
              <div className="text-[13px] text-gray-300">Atendimento
                <div className="mt-1 flex gap-2">
                  {[["online", "Online"], ["presencial", "Presencial"]].map(([k, l]) => (
                    <button key={k} type="button" onClick={() => setModalidade(k)} aria-pressed={modalidade === k}
                      className={`h-11 flex-1 border text-sm ${modalidade === k ? "border-rc-blue bg-rc-blue/15 text-white" : "border-white/[0.1] text-gray-300"}`}>{l}</button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-col items-center justify-between gap-3 sm:flex-row">
              <div className="text-sm text-gray-300">{sel ? <>Selecionado: <b className="text-white capitalize">{rotuloDia(sel.data)} às {sel.hora}</b></> : "Escolha um horário acima"}</div>
              <button type="button" data-testid="reservar" onClick={reservar} disabled={!sel || enviando} className="rc-btn-primary h-11">
                {enviando ? "Reservando…" : "Reservar e pagar"}
              </button>
            </div>
          </>
        )}

        {reserva && ["aguardando_pagamento", "comprovante_enviado", "expirada"].includes(reserva.status) && (
          <div className="space-y-4" data-testid="tela-pagamento">
            <div className="rc-card flex flex-wrap items-center justify-between gap-3 p-5">
              <div>
                <div className="text-[12px] text-gray-400">Seu horário</div>
                <div className="text-lg font-semibold text-white">{quandoBR(reserva.data_hora)} · {reserva.modalidade}</div>
                {moeda(reserva.valor) && <div className="text-sm text-gray-300">Valor: {moeda(reserva.valor)}</div>}
              </div>
              {reserva.status === "aguardando_pagamento" && (
                <div className="text-right" data-testid="contador">
                  <div className="text-[12px] text-gray-400">Reservado por</div>
                  <div className={`rc-num text-[32px] leading-none ${restante < 120 ? "text-rc-coral" : "text-white"}`}>{mmss(restante)}</div>
                </div>
              )}
            </div>

            {reserva.status === "expirada" && (
              <div className="rc-card p-6 text-center">
                <p className="text-sm text-gray-300">O tempo da reserva acabou e o horário voltou a ficar livre.</p>
                <button type="button" onClick={recomecar} className="rc-btn-primary mt-4 h-11">Escolher horário de novo</button>
              </div>
            )}

            {reserva.status === "comprovante_enviado" && (
              <div className="rc-card p-6 text-center" data-testid="aguardando-conferencia">
                <Loader2 className="mx-auto h-6 w-6 animate-spin text-rc-blue" />
                <p className="mt-3 text-sm text-gray-200">Comprovante recebido. Seu horário está guardado enquanto conferimos o pagamento.</p>
                <p className="mt-1 text-[12px] text-gray-500">Esta tela atualiza sozinha quando a consulta for confirmada.</p>
              </div>
            )}

            {reserva.status === "aguardando_pagamento" && (
              <div className="rc-card p-5">
                <div className="mb-4 flex gap-2">
                  {[["pix", "Pix", QrCode], ["cartao", "Cartão", CreditCard]].map(([k, l, Icone]) => (
                    <button key={k} type="button" onClick={() => setForma(k)} aria-pressed={forma === k}
                      className={`flex h-11 flex-1 items-center justify-center gap-2 border text-sm ${forma === k ? "border-rc-blue bg-rc-blue/15 text-white" : "border-white/[0.1] text-gray-300"}`}><Icone className="h-4 w-4" /> {l}</button>
                  ))}
                </div>
                {forma === "pix" ? (
                  <div className="space-y-4">
                    <div>
                      <div className="text-[12px] text-gray-400">Chave Pix (CNPJ) · {reserva.pix_nome}</div>
                      <div className="mt-1 flex items-center gap-2">
                        <code className="flex-1 border border-white/[0.08] bg-black/40 px-3 py-2.5 text-[15px] text-white">{reserva.pix_chave}</code>
                        <button type="button" className="rc-btn-ghost h-11" onClick={() => navigator.clipboard?.writeText(reserva.pix_chave).then(() => toast.success("Chave copiada"))}><Copy className="h-4 w-4" /> Copiar</button>
                      </div>
                    </div>
                    <div>
                      <div className="text-[12px] text-gray-400">Depois de pagar, anexe o comprovante</div>
                      <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => setArquivo(e.target.files?.[0] || null)} data-testid="arquivo-comprovante" />
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <button type="button" className="rc-btn-ghost h-11" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" /> {arquivo ? arquivo.name : "Escolher arquivo"}</button>
                        <button type="button" className="rc-btn-primary h-11" disabled={!arquivo || enviando} onClick={enviarComprovante} data-testid="enviar-comprovante">{enviando ? "Enviando…" : "Enviar comprovante"}</button>
                      </div>
                    </div>
                  </div>
                ) : reserva.checkout_url ? (
                  <a href={reserva.checkout_url} className="rc-btn-primary h-11 w-full justify-center">Pagar com cartão</a>
                ) : (
                  <p className="text-sm text-gray-400">O pagamento com cartão estará disponível em breve. Por enquanto, use o Pix.</p>
                )}
              </div>
            )}
          </div>
        )}

        {reserva?.status === "confirmada" && (
          <div className="rc-card p-8 text-center" data-testid="confirmada">
            <CheckCircle2 className="mx-auto h-10 w-10 text-rc-lime" />
            <h1 className="rc-h2 mt-3">Consulta confirmada</h1>
            <p className="mt-2 text-sm text-gray-300">{quandoBR(reserva.data_hora)} · {reserva.modalidade}. Você também recebe a confirmação no WhatsApp.</p>
            <p className="mt-4 text-sm text-gray-300">Agora preencha o formulário pré-consulta. Ele deixa a consulta mais rápida e certeira.</p>
            {reserva.token && <Link to={`/pre-consulta/${reserva.token}`} className="rc-btn-primary mt-4 h-11" data-testid="ir-formulario">Preencher formulário</Link>}
          </div>
        )}
      </main>
    </div>
  );
}
