import React, { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, ChevronDown, Download, FileText, Loader2, Minus, Send, Stethoscope, Utensils } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/evo-api";
import MarkdownView from "./MarkdownView";

/**
 * Saída da análise de exames do Dr. House (item 14 dos ajustes): topo com resumo e contagens, raciocínio em 3
 * colunas (Pistas · Hipóteses · Perguntar na consulta), cards de prioridade com faixa de referência e evolução,
 * demais marcadores por sistema (fechados; clique mostra o histórico), conduta marcável que vai para as
 * Observações da dieta e o laudo em linguagem simples (só sai depois da revisão).
 */
const nf = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const dataBR = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v || "—");
};
const SISTEMAS = [
  ["Hemograma", /hemo|hemat|leuc|plaq|neutr|linf|eritr|vcm|hcm|ferrit|ferro|transf/i],
  ["Lipídico", /colest|ldl|hdl|trigl|lipid/i],
  ["Tireoide", /tsh|t3|t4|tireo/i],
  ["Glicemia, renal e hepático", /glic|insul|hba1c|homa|ureia|creat|tgo|tgp|ast|alt|ggt|bilirr|fosfat|album|acido urico|ácido úrico/i],
  ["Hormônios", /testost|estrad|progest|cortis|prolact|lh|fsh|shbg|dhea/i],
  ["Vitaminas e minerais", /vitamin|b12|folato|zinco|magn|calcio|cálcio|sodio|sódio|potass/i],
];
const sistemaDe = (m) => (SISTEMAS.find(([, rx]) => rx.test(`${m.nome} ${m.grupo}`))?.[0]) || m.grupo || "Outros";
const STATUS_HIP = { provavel: ["Provável", "bg-rc-coral/15 text-rc-coral"], investigar: ["Investigar", "bg-rc-amber/15 text-rc-amber"], descartado: ["Descartado", "bg-white/[0.06] text-gray-400"] };

function faixa(ref, sexo) {
  if (!ref) return [null, null];
  return sexo === "M" ? [ref.ref_m_min, ref.ref_m_max] : [ref.ref_f_min, ref.ref_f_max];
}

/** Barra com a faixa de referência (verde) e o valor (bolinha). */
function BarraReferencia({ valor, min, max }) {
  if (valor == null || (min == null && max == null)) return null;
  const lo = min ?? max * 0.5; const hi = max ?? min * 1.5;
  const span = hi - lo || 1;
  const ini = lo - span * 0.6; const fim = hi + span * 0.6;
  const pos = (v) => Math.min(100, Math.max(0, ((v - ini) / (fim - ini)) * 100));
  const fora = (min != null && valor < min) || (max != null && valor > max);
  return (
    <div className="relative mt-2 h-2 rounded-full bg-white/[0.06]" aria-hidden>
      <div className="absolute inset-y-0 rounded-full bg-[#3DDC84]/35" style={{ left: `${pos(lo)}%`, width: `${pos(hi) - pos(lo)}%` }} />
      <div className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-rc-ink ${fora ? "bg-rc-coral" : "bg-[#3DDC84]"}`} style={{ left: `${pos(valor)}%` }} />
    </div>
  );
}

function Evolucao({ coletas }) {
  if (!coletas || coletas.length < 2) return <span className="text-[11.5px] text-gray-500">1ª coleta</span>;
  const [a, b] = coletas.slice(-2);
  const d = Number(b.valor) - Number(a.valor);
  const Icone = d > 0 ? ArrowUp : d < 0 ? ArrowDown : Minus;
  return <span className="inline-flex items-center gap-1 text-[11.5px] text-gray-300 tabular"><Icone className="h-3.5 w-3.5" />{nf.format(a.valor)} → {nf.format(b.valor)} <span className="text-gray-500">({dataBR(a.data_coleta)})</span></span>;
}

export default function DrHouseResultado({ pid, sexo, analise, lotes, longitudinal }) {
  const est = analise?.estruturado;
  const ultimo = lotes[lotes.length - 1];
  const anterior = lotes.length > 1 ? lotes[lotes.length - 2] : null;
  const marcadores = useMemo(() => Object.fromEntries((longitudinal?.marcadores || []).map((m) => [m.codigo, m])), [longitudinal]);
  const exames = ultimo?.exames || [];
  const prioridades = est?.prioridades || [];
  const codPrior = new Set(prioridades.map((p) => p.codigo));
  const contagem = {
    prioridade: exames.filter((e) => codPrior.has(e.codigo)).length || prioridades.length,
    atencao: exames.filter((e) => ["alto", "baixo"].includes(e.classificacao) && !codPrior.has(e.codigo)).length,
    normal: exames.filter((e) => e.classificacao === "normal").length,
  };
  const porSistema = useMemo(() => {
    const g = {};
    exames.filter((e) => !codPrior.has(e.codigo)).forEach((e) => { (g[sistemaDe(e)] ||= []).push(e); });
    return Object.entries(g);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exames, prioridades]);
  const [sistemaAberto, setSistemaAberto] = useState(null);
  const [historico, setHistorico] = useState(null);
  const [marcadas, setMarcadas] = useState(() => new Set((est?.condutas || []).map((_, i) => i)));
  const [repetir, setRepetir] = useState(est?.repetir_em_dias ? String(est.repetir_em_dias) : "90");
  const [aplicando, setAplicando] = useState(false);
  const [laudo, setLaudo] = useState(est?.laudo_paciente || "");
  const [revisado, setRevisado] = useState(false);
  const [laudoAcao, setLaudoAcao] = useState("");
  const [completa, setCompleta] = useState(!est);

  const aplicar = async () => {
    setAplicando(true);
    try {
      const { data } = await api.post(`/patients/${pid}/exames-manuais/aplicar-conduta`, {
        condutas: (est?.condutas || []).filter((_, i) => marcadas.has(i)), repetir_em_dias: Number(repetir) || null,
      });
      toast.success(`Conduta aplicada nas Observações da dieta "${data.titulo || "atual"}".`);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); } finally { setAplicando(false); }
  };
  const baixarLaudo = async () => {
    setLaudoAcao("pdf");
    try {
      const r = await api.post(`/patients/${pid}/exames-manuais/laudo-pdf`, { texto: laudo }, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([r.data], { type: "application/pdf" }));
      const a = document.createElement("a"); a.href = url; a.download = "laudo_exames.pdf"; document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch { toast.error("Não foi possível gerar o PDF."); } finally { setLaudoAcao(""); }
  };
  const enviarLaudo = async () => {
    setLaudoAcao("app");
    try { await api.post(`/patients/${pid}/exames-manuais/laudo-enviar`, { texto: laudo }); toast.success("Laudo enviado ao app do aluno."); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); } finally { setLaudoAcao(""); }
  };

  return (
    <div className="space-y-4" data-testid="drhouse-resultado">
      {/* topo */}
      <section className="rc-card p-5">
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
          <div>
            <div className="text-[10.5px] uppercase tracking-[0.16em] text-cyan-300 font-semibold">Dr. House · análise de exames</div>
            <div className="mt-1 text-[15px] font-semibold text-white">Exame de {dataBR(ultimo?.data_coleta)}{ultimo?.laboratorio ? ` · ${ultimo.laboratorio}` : ""}</div>
            <div className="text-[12.5px] text-gray-400">{exames.length} marcadores{anterior ? ` · comparado com ${dataBR(anterior.data_coleta)}` : " · primeiro exame registrado"}</div>
          </div>
          <div className="ml-auto flex gap-2" data-testid="contagem-exames">
            {[["Prioridade", contagem.prioridade, "bg-rc-coral/15 text-rc-coral"], ["Atenção", contagem.atencao, "bg-rc-amber/15 text-rc-amber"], ["Normal", contagem.normal, "bg-[#3DDC84]/15 text-[#3DDC84]"]].map(([l, n, c]) => (
              <div key={l} className={`rounded-xl px-4 py-2 text-center ${c}`}><div className="rc-num text-[22px] leading-none">{n}</div><div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.1em]">{l}</div></div>
            ))}
          </div>
        </div>
        {est?.resumo && <p className="mt-4 text-[14px] leading-relaxed text-gray-200" data-testid="drhouse-resumo">{est.resumo}</p>}
      </section>

      {est && (
        <section className="grid gap-4 lg:grid-cols-3" data-testid="drhouse-colunas">
          <div className="rc-card p-4">
            <h4 className="mb-3 text-[12px] font-bold uppercase tracking-[0.14em] text-gray-400">Pistas</h4>
            <ul className="space-y-2">{(est.pistas || []).map((p, i) => (
              <li key={i} className="text-[13px] text-gray-100"><span className="mr-1.5 rounded bg-white/[0.06] px-1.5 py-0.5 text-[10.5px] uppercase text-gray-400">{p.fonte || "exame"}</span>{p.texto}</li>
            ))}</ul>
          </div>
          <div className="rc-card p-4">
            <h4 className="mb-3 text-[12px] font-bold uppercase tracking-[0.14em] text-gray-400">Hipóteses</h4>
            <ul className="space-y-3">{(est.hipoteses || []).map((h, i) => {
              const [rot, cls] = STATUS_HIP[h.status] || STATUS_HIP.investigar;
              return (
                <li key={i}>
                  <div className="flex items-start justify-between gap-2"><span className="text-[13px] font-semibold text-white">{h.texto}</span><span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${cls}`}>{rot}</span></div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-rc-blue" style={{ width: `${Math.max(0, Math.min(100, Number(h.certeza) || 0))}%` }} /></div>
                  <div className="mt-1 text-[11.5px] text-gray-500">{Number(h.certeza) || 0}% de certeza{h.porque ? ` · ${h.porque}` : ""}</div>
                </li>
              );
            })}</ul>
          </div>
          <div className="rc-card p-4">
            <h4 className="mb-3 text-[12px] font-bold uppercase tracking-[0.14em] text-gray-400">Perguntar na consulta</h4>
            <ul className="space-y-2 list-disc pl-4">{(est.perguntar || []).map((q, i) => <li key={i} className="text-[13px] text-gray-100">{q}</li>)}</ul>
          </div>
        </section>
      )}

      {prioridades.length > 0 && (
        <section className="space-y-3" data-testid="prioridades">
          <h4 className="px-1 text-[12px] font-bold uppercase tracking-[0.14em] text-gray-400">Prioridades</h4>
          <div className="grid gap-3 lg:grid-cols-2">
            {prioridades.map((pr) => {
              const ex = exames.find((e) => e.codigo === pr.codigo || e.nome === pr.nome) || {};
              const [mn, mx] = faixa(ex.referencia, sexo);
              const medico = pr.acao?.tipo === "medico";
              return (
                <div key={pr.codigo || pr.nome} className="rc-card p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[14px] font-semibold text-white">{pr.nome || ex.nome}</span>
                    <span className="rc-num text-[20px] text-rc-coral">{ex.valor != null ? nf.format(ex.valor) : "—"} <span className="text-[11px] text-gray-500 font-sans">{ex.unidade}</span></span>
                  </div>
                  <BarraReferencia valor={ex.valor} min={mn} max={mx} />
                  <div className="mt-1.5 flex flex-wrap justify-between gap-2 text-[11.5px] text-gray-500">
                    <span>Referência {mn != null ? nf.format(mn) : "—"} a {mx != null ? nf.format(mx) : "—"}</span>
                    <Evolucao coletas={marcadores[ex.codigo]?.coletas} />
                  </div>
                  <p className="mt-2 text-[13px] text-gray-200">{pr.interpretacao}</p>
                  {pr.acao?.texto && (
                    <p className={`mt-2 flex items-start gap-2 rounded-lg px-3 py-2 text-[12.5px] ${medico ? "bg-rc-amber/10 text-rc-amber" : "bg-rc-blue/10 text-rc-blueLight"}`}>
                      {medico ? <Stethoscope className="mt-0.5 h-4 w-4 shrink-0" /> : <Utensils className="mt-0.5 h-4 w-4 shrink-0" />}
                      <span><b>{medico ? "Encaminhar ao médico: " : "Conduta: "}</b>{pr.acao.texto}</span>
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="rc-card divide-y divide-white/[0.05]" data-testid="sistemas">
        {porSistema.map(([sistema, itens]) => {
          const alterados = itens.filter((e) => ["alto", "baixo"].includes(e.classificacao)).length;
          const aberto = sistemaAberto === sistema;
          return (
            <div key={sistema}>
              <button type="button" onClick={() => setSistemaAberto(aberto ? null : sistema)} aria-expanded={aberto} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02]">
                <span className="flex-1 text-[14px] font-semibold text-white">{sistema}</span>
                <span className="text-[12px] text-gray-500">{itens.length} marcadores{alterados ? ` · ${alterados} em atenção` : ""}</span>
                <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${aberto ? "rotate-180" : ""}`} />
              </button>
              {aberto && (
                <div className="px-4 pb-3">
                  {itens.map((e) => {
                    const [mn, mx] = faixa(e.referencia, sexo);
                    const hist = historico === e.codigo;
                    return (
                      <div key={e.codigo} className="border-t border-white/[0.04] py-2">
                        <button type="button" onClick={() => setHistorico(hist ? null : e.codigo)} className="flex w-full items-center gap-3 text-left text-[13px]">
                          <span className="flex-1 text-gray-200">{e.nome}</span>
                          <span className={`tabular font-semibold ${["alto", "baixo"].includes(e.classificacao) ? "text-rc-amber" : "text-gray-100"}`}>{nf.format(e.valor)} {e.unidade}</span>
                          <span className="w-28 text-right text-[11.5px] text-gray-500">{mn != null || mx != null ? `${mn != null ? nf.format(mn) : "—"} a ${mx != null ? nf.format(mx) : "—"}` : ""}</span>
                        </button>
                        {hist && (
                          <ul className="mt-2 space-y-1 rounded-lg bg-white/[0.03] px-3 py-2 text-[12px]" data-testid="historico-marcador">
                            {(marcadores[e.codigo]?.coletas || []).map((c, i) => (
                              <li key={i} className="flex justify-between tabular"><span className="text-gray-400">{dataBR(c.data_coleta)}{c.laboratorio ? ` · ${c.laboratorio}` : ""}</span><span className="text-gray-100">{nf.format(c.valor)} {e.unidade}</span></li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </section>

      {est?.condutas?.length > 0 && (
        <section className="rc-card p-5" data-testid="conduta">
          <h4 className="mb-3 text-[12px] font-bold uppercase tracking-[0.14em] text-gray-400">Conduta nutricional</h4>
          <ul className="space-y-1.5">
            {est.condutas.map((c, i) => (
              <li key={i}>
                <label className="flex cursor-pointer items-start gap-2.5 text-[13.5px] text-gray-100">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#0081FD]" checked={marcadas.has(i)}
                    onChange={() => setMarcadas((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; })} />
                  {c}
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-[13px] text-gray-300">Repetir exames em
              <input className="rc-input h-9 w-20 tabular" inputMode="numeric" value={repetir} onChange={(e) => setRepetir(e.target.value)} aria-label="Repetir exames em dias" /> dias
            </label>
            <button type="button" onClick={aplicar} disabled={aplicando || (!marcadas.size && !Number(repetir))} className="rc-btn-primary h-9 ml-auto" data-testid="aplicar-prescricao">
              {aplicando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Aplicar na prescrição
            </button>
          </div>
          <p className="mt-2 text-[11.5px] text-gray-500">Vai para as Observações da dieta; os alimentos não mudam sozinhos.</p>
        </section>
      )}

      {est && (
        <section className="rc-card p-5" data-testid="laudo">
          <h4 className="mb-1 text-[12px] font-bold uppercase tracking-[0.14em] text-gray-400"><FileText className="mr-1.5 inline h-4 w-4" />Laudo para o paciente</h4>
          <p className="mb-3 text-[12px] text-gray-500">Linguagem simples. Revise e edite antes de enviar.</p>
          <textarea className="rc-input min-h-[140px] py-2 leading-relaxed" value={laudo} onChange={(e) => { setLaudo(e.target.value); setRevisado(false); }} aria-label="Laudo para o paciente" />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-[13px] text-gray-200"><input type="checkbox" className="h-4 w-4 accent-[#0081FD]" checked={revisado} onChange={(e) => setRevisado(e.target.checked)} data-testid="laudo-revisado" /> Revisei o laudo</label>
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={baixarLaudo} disabled={!revisado || laudo.trim().length < 10 || !!laudoAcao} className="rc-btn-secondary h-9"><Download className="h-4 w-4" /> Baixar PDF</button>
              <button type="button" onClick={enviarLaudo} disabled={!revisado || laudo.trim().length < 10 || !!laudoAcao} className="rc-btn-primary h-9" data-testid="laudo-enviar"><Send className="h-4 w-4" /> Enviar no app do aluno</button>
            </div>
          </div>
        </section>
      )}

      {analise?.content && (
        <section className="rc-card">
          <button type="button" onClick={() => setCompleta((v) => !v)} className="flex w-full items-center gap-2 px-5 py-4 text-[13px] text-gray-300 hover:text-white" aria-expanded={completa}>
            <ChevronDown className={`h-4 w-4 transition-transform ${completa ? "rotate-180" : ""}`} /> Análise completa do Dr. House
          </button>
          {completa && <div className="px-5 pb-5"><MarkdownView content={analise.content} /></div>}
        </section>
      )}
    </div>
  );
}
