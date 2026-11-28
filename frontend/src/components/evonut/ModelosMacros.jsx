import React, { useMemo, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import useDietaConfig from "./dieta/useDietaConfig";
import { objetivoDaFase } from "@/lib/gordura";

/**
 * Modelos de macros com um clique (ajuste mac1, regra atualizada).
 * As CALORIAS DA DIETA ficam fixas (vêm do Gasto Energético); o modelo NUNCA muda as calorias, só divide entre os macros.
 * • Regras em %: direto sobre a meta. • g/kg: pelo peso; o "restante" completa a meta.
 * • Faixa de kcal/kg do modelo = só referência (aviso verde/laranja).
 * • Modelos 100% em g/kg (3:2:1): mantém a proporção e ajusta à meta (× fator).
 * • Se os fixos passarem da meta (restante negativo): alerta, sem calcular.
 */
const fx = (min, max, padrao) => ({ faixa: [min, max], padrao });
export const MODELOS_MACROS = {
  reducao: [
    { id: "keto", nome: "Keto", kcal: fx(20, 35, 30), ptn: { tipo: "pct", ...fx(25, 25, 25) }, cho: { tipo: "pct", ...fx(10, 10, 10) }, lip: { tipo: "restante" } },
    { id: "hipo", nome: "Hipocalórica", kcal: fx(20, 25, 22), ptn: { tipo: "gkg", ...fx(2, 2, 2) }, lip: { tipo: "gkg", ...fx(0.8, 0.8, 0.8) }, cho: { tipo: "restante" } },
    { id: "333", nome: "33:33:33", kcal: fx(30, 40, 30), ptn: { tipo: "pct", ...fx(33, 33, 33) }, cho: { tipo: "pct", ...fx(33, 33, 33) }, lip: { tipo: "restante" } },
    { id: "321", nome: "3:2:1", kcal: null, cho: { tipo: "gkg", ...fx(3, 3, 3) }, ptn: { tipo: "gkg", ...fx(2, 2, 2) }, lip: { tipo: "gkg", ...fx(1, 1, 1) } },
    { id: "low", nome: "Low Carb", kcal: fx(20, 40, 30), ptn: { tipo: "gkg", ...fx(2.5, 3, 2.5) }, cho: { tipo: "gkg", ...fx(1, 2, 1.5) }, lip: { tipo: "restante" } },
  ],
  ganho: [
    { id: "normo", nome: "Normocalórica", kcal: fx(30, 35, 32), ptn: { tipo: "gkg", ...fx(1.5, 1.8, 1.6) }, cho: { tipo: "pct", ...fx(40, 50, 45) }, lip: { tipo: "restante" } },
    { id: "hchp", nome: "High Carb + High Protein", kcal: fx(40, 60, 45), ptn: { tipo: "gkg", ...fx(2.5, 3, 2.5) }, lip: { tipo: "pct", ...fx(20, 20, 20) }, cho: { tipo: "restante" } },
    { id: "442", nome: "40:40:20", kcal: fx(30, 50, 40), ptn: { tipo: "pct", ...fx(40, 40, 40) }, cho: { tipo: "pct", ...fx(40, 40, 40) }, lip: { tipo: "restante" } },
  ],
};
const OBJETIVOS = [["reducao", "Redução de gordura e manutenção de massa"], ["ganho", "Ganho de massa e rendimento esportivo"]];
const FATOR = { ptn: 4, cho: 4, lip: 9 };
const NOME = { ptn: "Proteína", cho: "Carboidrato", lip: "Gordura" };
const MACROS = ["ptn", "cho", "lip"];
const fmt = (v, c = 0) => (v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("pt-BR", { maximumFractionDigits: c, minimumFractionDigits: c }));

/** Divide a META de calorias entre os macros pela regra do modelo (o modelo nunca muda as calorias). */
export function calcularModelo(modelo, peso, meta, valores = {}) {
  const v = (k) => valores[k] ?? modelo[k]?.padrao;
  const g = {};
  MACROS.forEach((k) => { if (modelo[k].tipo === "gkg") g[k] = v(k) * peso; });
  MACROS.forEach((k) => { if (modelo[k].tipo === "pct") g[k] = (v(k) / 100) * meta / FATOR[k]; });
  let fator = null;
  const todosGkg = MACROS.every((k) => modelo[k].tipo === "gkg");
  if (todosGkg) {
    // ex.: 3:2:1 com meta 2.180 kcal → × 0,86 = CHO 2,6 · PTN 1,7 · LIP 0,9 g/kg
    const soma = MACROS.reduce((a, k) => a + g[k] * FATOR[k], 0);
    fator = soma ? meta / soma : null;
    if (fator) MACROS.forEach((k) => { g[k] *= fator; });
  }
  let erro = null;
  const resto = MACROS.find((k) => modelo[k].tipo === "restante");
  if (resto) {
    const usado = MACROS.filter((x) => x !== resto).reduce((a, x) => a + (g[x] || 0) * FATOR[x], 0);
    const sobra = meta - usado;
    if (sobra < 0) erro = `${MACROS.filter((x) => x !== resto).map((x) => NOME[x]).join(" + ")} já somam ${fmt(usado)} kcal, acima da meta de ${fmt(meta)} kcal. Diminua os valores fixos.`;
    g[resto] = Math.max(0, sobra / FATOR[resto]);
  } else if (!todosGkg) {
    const soma = MACROS.reduce((a, k) => a + g[k] * FATOR[k], 0);
    if (soma > meta * 1.01) erro = `Os macros somam ${fmt(soma)} kcal, acima da meta de ${fmt(meta)} kcal.`;
  }
  const linhas = MACROS.map((k) => ({ k, g: g[k], kcal: g[k] * FATOR[k], pct: meta ? (g[k] * FATOR[k] * 100) / meta : 0, gkg: peso ? g[k] / peso : null }));
  return { kcal: meta, kcalKg: peso ? meta / peso : null, linhas, fator, erro };
}

/** Faixas de referência do Rogério (foto "Informações adicionais"). */
function alertas(objetivo, res) {
  const l = Object.fromEntries(res.linhas.map((x) => [x.k, x]));
  const out = [];
  const [pmin, pmax] = objetivo === "ganho" ? [1.6, 2.2] : [2.3, 3.5];
  if (l.ptn.gkg < pmin || l.ptn.gkg > pmax) out.push(`Proteína ${fmt(l.ptn.gkg, 1)} g/kg fora de ${fmt(pmin, 1)}–${fmt(pmax, 1)} g/kg (${objetivo === "ganho" ? "hipertrofia" : "dietas restritivas"})`);
  const [cmin, cmax] = objetivo === "ganho" ? [3, 7] : [1, 5];
  if (l.cho.gkg < cmin || l.cho.gkg > cmax) out.push(`Carboidrato ${fmt(l.cho.gkg, 1)} g/kg fora de ${cmin}–${cmax} g/kg`);
  if (l.lip.pct < 15 || l.lip.pct > 30) out.push(`Gordura ${fmt(l.lip.pct)}% do VET fora de 15–30%`);
  return out;
}

export default function ModelosMacros({ peso, meta, get, objetivoPaciente, fase, onAplicar, onIrGasto }) {
  const { config, salvar } = useDietaConfig();
  // a fase do atleta sugere o objetivo (Cutting → redução de gordura; Off-season → ganho de massa)
  const [objetivo, setObjetivo] = useState(objetivoDaFase(fase) || (/hipertrof|ganho|massa|rendimento|esport/i.test(objetivoPaciente || "") ? "ganho" : "reducao"));
  const proprios = (config.modelos_macros || []).filter((m) => m.objetivo === objetivo);
  const lista = [...MODELOS_MACROS[objetivo], ...proprios];
  const [selId, setSelId] = useState(null);
  const [valores, setValores] = useState({});
  const modelo = lista.find((m) => m.id === selId) || null;
  const res = useMemo(() => (modelo && peso && meta ? calcularModelo(modelo, peso, meta, valores) : null), [modelo, peso, meta, valores]);

  if (!peso) return <p className="bg-rc-amber/10 px-3 py-2 text-[12.5px] text-rc-amber">Informe o peso do paciente para usar os modelos de macros.</p>;

  const salvarMeu = async () => {
    const nome = window.prompt("Nome do seu modelo:", `${modelo.nome} (meu)`);
    if (!nome) return;
    const l = Object.fromEntries(res.linhas.map((x) => [x.k, x]));
    const r2 = (x) => Math.round(x * 100) / 100;
    const novo = { id: `meu-${Date.now()}`, nome, objetivo, proprio: true, kcal: null,
      ptn: { tipo: "gkg", ...fx(r2(l.ptn.gkg), r2(l.ptn.gkg), r2(l.ptn.gkg)) }, cho: { tipo: "gkg", ...fx(r2(l.cho.gkg), r2(l.cho.gkg), r2(l.cho.gkg)) }, lip: { tipo: "restante" } };
    try { await salvar({ modelos_macros: [...(config.modelos_macros || []), novo] }); toast.success("Modelo salvo."); } catch { toast.error("Não foi possível salvar o modelo."); }
  };
  const excluir = async (m) => {
    if (!window.confirm(`Excluir o modelo "${m.nome}"?`)) return;
    try { await salvar({ modelos_macros: (config.modelos_macros || []).filter((x) => x.id !== m.id) }); setSelId(null); } catch { toast.error("Não foi possível excluir."); }
  };
  const regraTexto = (r) => (r.tipo === "restante" ? "restante" : r.faixa[0] === r.faixa[1] ? `${fmt(r.padrao, r.tipo === "gkg" ? 1 : 0)}${r.tipo === "pct" ? "%" : " g/kg"}` : `${fmt(r.faixa[0], 1)}–${fmt(r.faixa[1], 1)}${r.tipo === "pct" ? "%" : " g/kg"}`);
  const kcalKg = meta && peso ? meta / peso : null;
  const faixaKcal = modelo?.kcal?.faixa;
  const dentroFaixa = faixaKcal && kcalKg != null ? kcalKg >= faixaKcal[0] - 0.05 && kcalKg <= faixaKcal[1] + 0.05 : null;
  const editaveis = modelo ? MACROS.filter((k) => modelo[k].tipo !== "restante" && modelo[k].faixa[0] !== modelo[k].faixa[1]) : [];

  return (
    <section className="rc-card p-5" data-testid="modelos-macros">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h3 className="rc-h3">Modelos de macros</h3>
        <div role="radiogroup" aria-label="Objetivo" className="grid w-full grid-cols-2 bg-white/[0.04] p-0.5 ring-1 ring-white/[0.06] sm:ml-auto sm:inline-flex sm:w-auto">
          {OBJETIVOS.map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={objetivo === k} onClick={() => { setObjetivo(k); setSelId(null); setValores({}); }}
              className={`min-h-9 px-3 py-1.5 text-[12.5px] font-semibold leading-tight ${objetivo === k ? "bg-rc-blue text-black" : "text-gray-400 hover:text-white"}`}>{l}</button>
          ))}
        </div>
      </div>

      {/* calorias fixas no topo: vêm do Gasto Energético */}
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 border border-[#1A1F26] bg-black px-4 py-3" data-testid="calorias-fixas">
        <div><div className="text-[10.5px] uppercase tracking-[0.14em] text-gray-500">Calorias da dieta</div>
          <div className="rc-num text-[22px] text-white">{meta ? `${fmt(meta)} kcal` : "—"}</div></div>
        <div className="text-[12.5px] text-gray-400">{kcalKg != null ? `${fmt(kcalKg, 1)} kcal/kg` : ""}{get ? ` · GET ${fmt(get)} kcal (referência)` : ""}</div>
        <div className="ml-auto text-[12px] text-gray-500">Vêm do Gasto Energético (meta com déficit/superávit). O modelo só divide entre os macros.
          {onIrGasto && <button type="button" onClick={onIrGasto} className="ml-1 text-rc-blueLight underline">Editar no Gasto</button>}</div>
      </div>

      {!meta ? (
        <p className="text-[13px] text-rc-amber">Defina as calorias da dieta no Gasto Energético para usar os modelos.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {lista.map((m) => (
            <button key={m.id} type="button" onClick={() => { setSelId(m.id); setValores({}); }} aria-pressed={selId === m.id} data-testid={`modelo-${m.id}`}
              className={`px-3.5 py-3 text-left ring-1 transition-colors ${selId === m.id ? "bg-rc-blue/15 ring-rc-blue" : "bg-white/[0.03] ring-white/[0.06] hover:ring-white/20"}`}>
              <div className="flex items-center justify-between gap-2"><span className="text-[13.5px] font-semibold text-white">{m.nome}</span>{m.proprio && <span className="text-[10px] text-rc-blueLight">meu</span>}</div>
              <div className="mt-1 text-[11.5px] leading-snug text-gray-400">
                {m.kcal ? `ref. ${fmt(m.kcal.faixa[0])}–${fmt(m.kcal.faixa[1])} kcal/kg · ` : ""}P {regraTexto(m.ptn)} · C {regraTexto(m.cho)} · G {regraTexto(m.lip)}
              </div>
            </button>
          ))}
        </div>
      )}

      {modelo && res && (
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div>
            {faixaKcal && (
              <p className={`mb-3 flex items-start gap-1.5 text-[12.5px] ${dentroFaixa ? "text-[#3DDC84]" : "text-rc-amber"}`} data-testid="aviso-kcalkg">
                {dentroFaixa ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                {fmt(meta)} kcal = {fmt(kcalKg, 1)} kcal/kg · {modelo.nome} sugere {fmt(faixaKcal[0])}–{fmt(faixaKcal[1])} kcal/kg{dentroFaixa ? "" : " (só referência: as calorias não mudam)"}.
              </p>
            )}
            {res.fator && Math.abs(res.fator - 1) > 0.005 && (
              <p className="mb-3 text-[12.5px] text-gray-300" data-testid="fator-proporcao">Proporção {modelo.nome} ajustada à meta: × {fmt(res.fator, 2)} = {res.linhas.map((x) => `${{ cho: "CHO", ptn: "PTN", lip: "LIP" }[x.k]} ${fmt(x.gkg, 1)}`).join(" · ")} g/kg.</p>
            )}
            {editaveis.length > 0 && (
              <div className="mb-3 grid gap-3 sm:grid-cols-3">
                {editaveis.map((k) => {
                  const r = modelo[k];
                  const suf = r.tipo === "pct" ? "%" : "g/kg";
                  return (
                    <label key={k} className="block">
                      <span className="text-[12px] text-gray-400">{NOME[k]} <span className="text-gray-500">(faixa {fmt(r.faixa[0], 1)}–{fmt(r.faixa[1], 1)} {suf})</span></span>
                      <span className="mt-1 flex items-center gap-1"><input type="number" step={r.tipo === "pct" ? 1 : 0.1} className="rc-input h-9 py-1" value={valores[k] ?? r.padrao}
                        onChange={(e) => setValores((s) => ({ ...s, [k]: e.target.value === "" ? r.padrao : Number(e.target.value) }))} data-testid={`valor-${k}`} />
                        <span className="text-[12px] text-gray-500">{suf}</span></span>
                    </label>
                  );
                })}
              </div>
            )}
            {res.erro ? (
              <p className="flex items-start gap-1.5 border border-rc-coral/40 bg-rc-coral/10 px-3 py-2 text-[13px] text-rc-coral" data-testid="erro-modelo"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{res.erro}</p>
            ) : (
              <table className="w-full text-[13.5px] tabular" data-testid="resultado-modelo">
                <thead><tr className="text-[10.5px] uppercase tracking-[0.12em] text-gray-500"><th className="py-1.5 text-left font-medium">Macro</th><th className="text-right font-medium">g</th><th className="text-right font-medium">kcal</th><th className="text-right font-medium">%</th><th className="text-right font-medium">g/kg</th></tr></thead>
                <tbody>
                  {res.linhas.map((x) => (
                    <tr key={x.k} className="border-t border-white/[0.05]">
                      <td className="py-1.5 text-gray-200">{NOME[x.k]}{modelo[x.k].tipo === "restante" && <span className="ml-1 text-[11px] text-gray-500">(restante)</span>}</td>
                      <td className="text-right text-white">{fmt(x.g)}</td><td className="text-right text-gray-300">{fmt(x.kcal)}</td>
                      <td className="text-right font-bold text-white">{fmt(x.pct)}%</td><td className="text-right text-gray-300">{fmt(x.gkg, 2)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-white/[0.1] font-semibold"><td className="py-1.5 text-white">Total</td><td /><td className="text-right text-white" data-testid="kcal-modelo">{fmt(res.linhas.reduce((t, x) => t + x.kcal, 0))} kcal</td><td className="text-right text-gray-400">{fmt(res.linhas.reduce((t, x) => t + x.pct, 0))}%</td><td className="text-right text-gray-400">{fmt(res.kcalKg, 1)} kcal/kg</td></tr>
                </tbody>
              </table>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => onAplicar(res, modelo, false)} disabled={!!res.erro} className="rc-btn-secondary h-9" data-testid="aplicar-modelo"><Check className="h-4 w-4" /> Aplicar aqui</button>
              <button type="button" onClick={() => onAplicar(res, modelo, true)} disabled={!!res.erro} className="rc-btn-primary h-9" data-testid="usar-na-prescricao">Usar na Prescrição</button>
              <button type="button" onClick={salvarMeu} disabled={!!res.erro} className="rc-btn-ghost h-9"><Save className="h-4 w-4" /> Salvar como meu modelo</button>
              {modelo.proprio && <button type="button" onClick={() => excluir(modelo)} className="rc-btn-ghost h-9 text-rc-coral"><Trash2 className="h-4 w-4" /> Excluir</button>}
            </div>
          </div>
          <aside className="bg-white/[0.03] p-4 text-[12.5px] ring-1 ring-white/[0.06]">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400">Referência</div>
            <ul className="space-y-1 text-gray-300">
              <li>PTN hipertrofia: 1,6–2,2 g/kg</li>
              <li>PTN dietas restritas: 2,3–3,5 g/kg</li>
              <li>CHO hipertrofia: 3–7 g/kg</li>
              <li>CHO restritas: 1–4 (estética), 2–5 (fisiculturistas), 5–8 g/kg (performance)</li>
              <li>LIP: 15–30% do VET</li>
            </ul>
            {!res.erro && alertas(objetivo, res).length > 0 && (
              <div className="mt-3 space-y-1.5" data-testid="alertas-modelo">
                {alertas(objetivo, res).map((a) => <p key={a} className="flex gap-1.5 text-rc-amber"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{a}</p>)}
              </div>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}
