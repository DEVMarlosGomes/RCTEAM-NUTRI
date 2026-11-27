import { classeGordura, pesoAlvo } from "@/lib/gordura";
import { contextoGordura } from "./MetaGordura";
import React, { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Download, Loader2, Minus, Send } from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { linhaDoTempo } from "@/lib/ciclos";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/evo-api";

/**
 * Comparativo (item cmp1 dos ajustes): escolhe as 2 avaliações, seta segue o número e a cor segue o objetivo
 * (IMC neutro), formato brasileiro, mais indicadores (medidas, soma das dobras, cintura/quadril, meta calórica,
 * exames), gráfico por indicador com todas as avaliações, fotos lado a lado e o relatório "Sua evolução" em PDF.
 */
const n1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const n0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const n2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v) => { const x = Number(String(v ?? "").replace(",", ".")); return v === null || v === undefined || v === "" || !Number.isFinite(x) ? null : x; };
const dataBR = (e) => { const v = String(e?.data_avaliacao || e?.created_at || "").slice(0, 10); const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v); return m ? `${m[3]}/${m[2]}/${m[1]}` : "—"; };
const soma = (vals) => (vals.every((v) => v != null) && vals.length ? vals.reduce((a, b) => a + b, 0) : null);
const DOBRAS = ["peitoral", "axilar", "tricipital", "subescapular", "abdominal", "suprailiaca", "coxa"];

const hipertrofia = (o) => /hipertrof|ganho|massa|bulking/i.test(o || "");

/** Indicadores: [rótulo, valor(e), unidade, formato, sentido bom: "sobe" | "desce" | "objetivo" | null] */
function indicadores() {
  return [
    ["Peso", (e) => num(e.peso), "kg", n1, "objetivo"],
    ["IMC", (e) => num(e.composicao?.imc), "", n1, null],
    ["% Gordura", (e) => num(e.composicao?.pct_gordura), "%", n1, "desce"],
    ["Massa magra", (e) => num(e.composicao?.massa_magra), "kg", n1, "sobe"],
    ["Massa gorda", (e) => num(e.composicao?.massa_gorda), "kg", n1, "desce"],
    ["Soma das dobras (7)", (e) => soma(DOBRAS.map((k) => num(e.dobras?.[k] ?? (k === "tricipital" ? e.dobras?.triceps : null)))), "mm", n1, "desce"],
    ["Cintura", (e) => num(e.perimetria?.cintura), "cm", n1, "desce"],
    ["Abdômen", (e) => num(e.perimetria?.abdomen), "cm", n1, "desce"],
    ["Quadril", (e) => num(e.perimetria?.quadril), "cm", n1, null],
    ["Braço contraído (D)", (e) => num(e.perimetria?.braco_contraido_d), "cm", n1, "sobe"],
    ["Coxa (D)", (e) => num(e.perimetria?.coxa_d), "cm", n1, "sobe"],
    ["Cintura ÷ quadril", (e) => { const c = num(e.perimetria?.cintura); const q = num(e.perimetria?.quadril); return c && q ? c / q : null; }, "", n2, "desce"],
    ["GET da avaliação", (e) => num(e.composicao?.get_kcal), "kcal", n0, null],
  ];
}

function Seta({ d, bom }) {
  if (d == null) return <span className="text-gray-500">não medido</span>;
  const Icone = d > 0 ? ArrowUp : d < 0 ? ArrowDown : Minus;
  const cor = bom === true ? "text-[#3DDC84]" : bom === false ? "text-rc-coral" : "text-gray-400";
  return <span className={`inline-flex items-center gap-1 font-semibold ${cor}`} data-dir={d > 0 ? "up" : d < 0 ? "down" : "eq"}><Icone className="h-4 w-4" /></span>;
}

export default function Comparativo({ d }) {
  const p = d.patient;
  const [rows, setRows] = useState(null);
  const [fotos, setFotos] = useState([]);
  const [exames, setExames] = useState([]);
  const [ia, setIa] = useState("");
  const [ib, setIb] = useState("");
  const [grafico, setGrafico] = useState("Peso");
  const [acao, setAcao] = useState("");

  useEffect(() => {
    api.get(`/patients/${p.id}/comparativo`).then((r) => {
      const lista = r.data || [];
      setRows(lista);
      if (lista.length >= 2) { setIa(lista[0].id); setIb(lista[lista.length - 1].id); }
    }).catch(() => setRows([]));
    api.get(`/patients/${p.id}/fotos-avaliacoes`).then((r) => setFotos(r.data || [])).catch(() => {});
    api.get(`/patients/${p.id}/exames-manuais`).then((r) => setExames(r.data || [])).catch(() => {});
  }, [p.id]);

  const inds = useMemo(() => indicadores(), []);
  if (rows === null) return <div className="evo-card p-8 text-gray-400 text-sm"><Loader2 className="inline h-4 w-4 animate-spin" /> Carregando…</div>;
  if (rows.length < 2) return <div className="evo-card p-8 text-gray-400 text-sm">Cadastre ao menos duas avaliações para ver o comparativo.</div>;

  const a = rows.find((r) => r.id === ia) || rows[0];
  const b = rows.find((r) => r.id === ib) || rows[rows.length - 1];
  const numero = (e) => rows.findIndex((r) => r.id === e.id) + 1;
  const bomPara = (sentido, dlt) => {
    if (dlt == null || dlt === 0 || !sentido) return null;
    if (sentido === "objetivo") return hipertrofia(p.objetivo) ? dlt > 0 : dlt < 0;
    return sentido === "sobe" ? dlt > 0 : dlt < 0;
  };
  const modelos = new Set([a, b].map((r) => r.modelo_avaliacao || "rc"));
  const rotModelo = (e) => (e.modelo_avaliacao === "donatto" ? "Donatto" : "RC");
  const fotosDe = (e) => Object.fromEntries(fotos.filter((f) => f.avaliacao_id === e.id).map((f) => [f.pose, f.data_url]));
  const fa = fotosDe(a); const fb = fotosDe(b);

  // exames principais: coleta mais próxima de cada avaliação
  const coletaPerto = (e) => {
    const alvo = String(e.data_avaliacao || e.created_at || "").slice(0, 10);
    return [...exames].sort((x, y) => Math.abs(new Date(x.data_coleta) - new Date(alvo)) - Math.abs(new Date(y.data_coleta) - new Date(alvo)))[0];
  };
  const ca = exames.length ? coletaPerto(a) : null; const cb = exames.length ? coletaPerto(b) : null;
  const marcadores = ca && cb && ca.id !== cb.id
    ? (cb.exames || []).filter((x) => (ca.exames || []).some((y) => y.codigo === x.codigo)).slice(0, 8)
    : [];

  const [rotG, fnG, unG] = inds.find((i) => i[0] === grafico) || inds[0];
  const dadosGrafico = rows.map((e, i) => ({ nome: `${i + 1}ª`, data: dataBR(e), v: fnG(e), iso: String(e.data_avaliacao || e.created_at || "").slice(0, 10) }));
  // cic1: fases do ciclo de carboidratos ao fundo do gráfico (avaliações dentro de cada fase)
  const fasesGrafico = linhaDoTempo(p.ciclo_carbo).map((f) => {
    const dentro = dadosGrafico.filter((x) => x.iso >= f.inicio && x.iso < f.fim);
    return dentro.length ? { ...f, x1: dentro[0].nome, x2: dentro[dentro.length - 1].nome } : null;
  }).filter(Boolean);

  const baixarPdf = async (enviar) => {
    setAcao(enviar ? "app" : "pdf");
    try {
      if (enviar) {
        await api.post(`/patients/${p.id}/evolucao/enviar-app`, { a: a.id, b: b.id });
        toast.success("Relatório enviado ao app do aluno.");
        return;
      }
      const r = await api.get(`/patients/${p.id}/relatorios/evolucao`, { params: { a: a.id, b: b.id }, responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([r.data], { type: "application/pdf" }));
      const l = document.createElement("a"); l.href = url; l.download = "sua-evolucao.pdf"; document.body.appendChild(l); l.click(); l.remove();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Não foi possível gerar o relatório."); } finally { setAcao(""); }
  };

  return (
    <div className="space-y-4" data-testid="comparativo">
      <section className="rc-card p-5">
        <div className="flex flex-wrap items-end gap-3">
          <h3 className="evo-h3 mr-auto">Comparativo evolutivo</h3>
          {[["De", ia, setIa], ["Para", ib, setIb]].map(([rot, val, set]) => (
            <label key={rot} className="block">
              <span className="rc-label">{rot}</span>
              <select className="rc-input h-10 w-auto" value={val} onChange={(e) => set(e.target.value)} data-testid={`comp-${rot === "De" ? "a" : "b"}`}>
                {rows.map((e, i) => <option key={e.id} value={e.id}>{i + 1}ª · {dataBR(e)} · {rotModelo(e)}</option>)}
              </select>
            </label>
          ))}
          <button type="button" onClick={() => baixarPdf(false)} disabled={!!acao} className="rc-btn-secondary h-10"><Download className="h-4 w-4" /> Relatório PDF</button>
          <button type="button" onClick={() => baixarPdf(true)} disabled={!!acao} className="rc-btn-primary h-10" data-testid="evolucao-app"><Send className="h-4 w-4" /> Enviar ao app</button>
        </div>
        {modelos.size > 1 && (
          <p className="mt-3 rounded-lg bg-rc-amber/10 px-3 py-2 text-[12.5px] text-rc-amber" data-testid="aviso-modelos">
            As avaliações usaram modelos diferentes (RC e Donatto): o % de gordura pode mudar só pela forma de calcular.
          </p>
        )}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-[13.5px] tabular" data-testid="tabela-comparativo">
            <thead>
              <tr className="text-[10.5px] uppercase tracking-[0.12em] text-gray-500">
                <th className="py-2 text-left font-medium">Indicador</th>
                <th className="py-2 text-right font-medium">{numero(a)}ª · {dataBR(a)} <span className="normal-case">({rotModelo(a)})</span></th>
                <th className="py-2 text-right font-medium">{numero(b)}ª · {dataBR(b)} <span className="normal-case">({rotModelo(b)})</span></th>
                <th className="py-2 text-right font-medium">Diferença</th>
              </tr>
            </thead>
            <tbody>
              {inds.map(([rot, fn, un, fmt, sentido]) => {
                const va = fn(a); const vb = fn(b);
                const dlt = va != null && vb != null ? Math.round((vb - va) * 100) / 100 : null;
                const bom = bomPara(sentido, dlt);
                const fmtV = (v) => (v == null ? <span className="text-gray-500">não medido</span> : `${fmt.format(v)}${un ? ` ${un}` : ""}`);
                return (
                  <tr key={rot} className="border-t border-white/[0.05]" data-testid={`comp-${rot}`}>
                    <td className="py-2 text-gray-300"><button type="button" className="hover:text-white hover:underline" onClick={() => setGrafico(rot)}>{rot}</button></td>
                    <td className="py-2 text-right text-gray-200">{fmtV(va)}</td>
                    <td className="py-2 text-right font-semibold text-white">{fmtV(vb)}</td>
                    <td className="py-2 text-right">
                      {dlt == null ? <span className="text-gray-500">—</span> : (
                        <span className={`inline-flex items-center gap-1.5 ${bom === true ? "text-[#3DDC84]" : bom === false ? "text-rc-coral" : "text-gray-300"}`}>
                          <Seta d={dlt} bom={bom} />{dlt > 0 ? "+" : dlt < 0 ? "−" : ""}{fmt.format(Math.abs(dlt))}{un ? ` ${un}` : ""}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {(() => {
                // gor1: classe do % de gordura em cada avaliação e quanto falta até a meta
                const ctx = contextoGordura(p);
                const ca2 = classeGordura({ ...ctx, pct: a.composicao?.pct_gordura });
                const cb2 = classeGordura({ ...ctx, pct: b.composicao?.pct_gordura });
                const mg = p.meta_gordura;
                const alvo = mg?.min != null ? pesoAlvo({ peso: b.peso, pct: b.composicao?.pct_gordura, massaMagra: b.composicao?.massa_magra, faixa: [mg.min, mg.max] }) : null;
                if (!ca2 && !cb2) return null;
                return (
                  <tr className="border-t border-white/[0.05]" data-testid="cmp-classe-gordura">
                    <td className="py-2 text-gray-300">Classe do % de gordura</td>
                    <td className="py-2 text-right text-gray-300">{ca2?.nivel || "não medido"}</td>
                    <td className="py-2 text-right font-semibold text-white">{cb2?.nivel || "não medido"}{ca2 && cb2 && ca2.nivel !== cb2.nivel ? " ↺" : ""}</td>
                    <td className="py-2 text-right text-[12px] text-gray-400">{alvo ? (alvo.perderMin > 0 ? `faltam ${n1.format(alvo.perderMin)}–${n1.format(alvo.perderMax)} kg de gordura` : "meta atingida") : mg ? "" : "sem meta de % de gordura"}</td>
                  </tr>
                );
              })()}
              <tr className="border-t border-white/[0.05]">
                <td className="py-2 text-gray-300">Meta calórica atual</td>
                <td className="py-2" />
                <td className="py-2 text-right font-semibold text-white">{num(p.meta_energetica?.kcal_final) != null ? `${n0.format(p.meta_energetica.kcal_final)} kcal` : <span className="text-gray-500">não definida</span>}</td>
                <td />
              </tr>
              {marcadores.map((x) => {
                const ant = (ca.exames || []).find((y) => y.codigo === x.codigo);
                const dlt = Math.round((x.valor - ant.valor) * 100) / 100;
                return (
                  <tr key={x.codigo} className="border-t border-white/[0.05]">
                    <td className="py-2 text-gray-300">Exame · {x.nome}</td>
                    <td className="py-2 text-right text-gray-200">{n1.format(ant.valor)} {x.unidade}</td>
                    <td className={`py-2 text-right font-semibold ${["alto", "baixo"].includes(x.classificacao) ? "text-rc-amber" : "text-white"}`}>{n1.format(x.valor)} {x.unidade}</td>
                    <td className="py-2 text-right text-gray-300"><Seta d={dlt} bom={null} /> {dlt > 0 ? "+" : dlt < 0 ? "−" : ""}{n1.format(Math.abs(dlt))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {ca && cb && ca.id === cb.id && <p className="mt-2 text-[12px] text-gray-500">Exames: só há uma coleta perto dessas datas.</p>}
        </div>
      </section>

      <section className="rc-card p-5">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h4 className="text-[13px] font-semibold text-white">Evolução · {rotG}</h4>
          <select className="rc-input h-9 w-auto ml-auto text-[12.5px]" value={grafico} onChange={(e) => setGrafico(e.target.value)} aria-label="Indicador do gráfico">
            {inds.map(([r]) => <option key={r}>{r}</option>)}
          </select>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={dadosGrafico}>
            <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey="nome" stroke="#4C5766" tick={{ fill: "#8A97A6" }} tickLine={false} axisLine={false} fontSize={11} />
            <YAxis stroke="#4C5766" tick={{ fill: "#8A97A6" }} tickLine={false} axisLine={false} fontSize={11} width={44} domain={["auto", "auto"]} />
            <Tooltip formatter={(v) => [`${n1.format(v)} ${unG}`, rotG]} labelFormatter={(l, pl) => `${l} · ${pl?.[0]?.payload?.data || ""}`}
              contentStyle={{ background: "#161C25", border: "none", borderRadius: 10, fontSize: 12 }} />
            {fasesGrafico.map((f) => (
              <ReferenceArea key={f.chave} x1={f.x1} x2={f.x2} fill={f.tipo === "high" ? "#0081FD" : "#FFFFFF"} fillOpacity={0.08} ifOverflow="extendDomain"
                label={{ value: f.nome, position: "insideTop", fill: "#9AA3AE", fontSize: 10 }} />
            ))}
            <Line type="monotone" dataKey="v" stroke="#0081FD" strokeWidth={2.5} connectNulls dot={{ r: 3.5, fill: "#0081FD", strokeWidth: 0 }} />
          </LineChart>
        </ResponsiveContainer>
        {fasesGrafico.length > 0 && <p className="mt-1 text-[11.5px] text-gray-500" data-testid="fases-grafico">Fases do ciclo ao fundo: {fasesGrafico.map((f) => f.nome).join(" · ")}</p>}
      </section>

      {(Object.keys(fa).length > 0 || Object.keys(fb).length > 0) && (
        <section className="rc-card p-5" data-testid="fotos-comparativo">
          <h4 className="mb-3 text-[13px] font-semibold text-white">Fotos lado a lado</h4>
          <div className="grid gap-4 sm:grid-cols-3">
            {[["frente", "Frente"], ["lado", "Lado"], ["costas", "Costas"]].map(([pose, rot]) => (
              <div key={pose}>
                <div className="mb-1.5 text-[11px] uppercase tracking-[0.12em] text-gray-500">{rot}</div>
                <div className="grid grid-cols-2 gap-2">
                  {[[a, fa], [b, fb]].map(([e, f]) => (
                    <figure key={e.id} className="overflow-hidden rounded-xl bg-white/[0.03] ring-1 ring-white/[0.06]">
                      {f[pose] ? <img src={f[pose]} alt={`${rot} em ${dataBR(e)}`} className="aspect-[3/4] w-full object-cover" /> : <div className="flex aspect-[3/4] items-center justify-center text-[11px] text-gray-600">sem foto</div>}
                      <figcaption className="px-2 py-1 text-[11px] text-gray-500">{dataBR(e)}</figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
