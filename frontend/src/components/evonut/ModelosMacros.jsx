import React, { useMemo, useState } from "react";
import { AlertTriangle, Check, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import useDietaConfig from "./dieta/useDietaConfig";

/**
 * Modelos de macros com um clique (ajuste mac1 do Rogério). Cada macro tem uma regra: % das kcal, g/kg ou
 * "restante das kcal". Faixas viram controle deslizante com valor padrão; ao mexer, o restante se ajusta.
 * Aplica com o peso real do paciente. Painel de referência ao lado com alerta quando sai da faixa.
 */
const fx = (min, max, padrao) => ({ faixa: [min, max], padrao });
export const MODELOS_MACROS = {
  reducao: [
    { id: "keto", nome: "Keto", kcal: fx(20, 35, 30), ptn: { tipo: "pct", ...fx(25, 25, 25) }, cho: { tipo: "pct", ...fx(10, 10, 10) }, lip: { tipo: "restante" } },
    { id: "hipo", nome: "Hipocalórica", kcal: fx(20, 25, 22), ptn: { tipo: "gkg", ...fx(2, 2, 2) }, lip: { tipo: "gkg", ...fx(0.8, 0.8, 0.8) }, cho: { tipo: "restante" } },
    { id: "333", nome: "33:33:33", kcal: fx(30, 40, 30), ptn: { tipo: "pct", ...fx(33, 33, 33) }, cho: { tipo: "pct", ...fx(33, 33, 33) }, lip: { tipo: "pct", ...fx(33, 33, 33) } },
    { id: "321", nome: "3:2:1", kcal: { soma: true }, cho: { tipo: "gkg", ...fx(3, 3, 3) }, ptn: { tipo: "gkg", ...fx(2, 2, 2) }, lip: { tipo: "gkg", ...fx(1, 1, 1) } },
    { id: "low", nome: "Low Carb", kcal: fx(20, 40, 30), ptn: { tipo: "gkg", ...fx(2.5, 3, 2.5) }, cho: { tipo: "gkg", ...fx(1, 2, 1.5) }, lip: { tipo: "restante" } },
  ],
  ganho: [
    { id: "normo", nome: "Normocalórica", kcal: fx(30, 35, 32), ptn: { tipo: "gkg", ...fx(1.5, 1.8, 1.6) }, cho: { tipo: "pct", ...fx(40, 50, 45) }, lip: { tipo: "restante" } },
    { id: "hchp", nome: "High Carb + High Protein", kcal: fx(40, 60, 45), ptn: { tipo: "gkg", ...fx(2.5, 3, 2.5) }, lip: { tipo: "pct", ...fx(20, 20, 20) }, cho: { tipo: "restante", alvo: [60, 70] } },
    { id: "442", nome: "40:40:20", kcal: fx(30, 50, 40), ptn: { tipo: "pct", ...fx(40, 40, 40) }, cho: { tipo: "pct", ...fx(40, 40, 40) }, lip: { tipo: "restante" } },
  ],
};
const OBJETIVOS = [["reducao", "Redução de gordura e manutenção de massa"], ["ganho", "Ganho de massa e rendimento esportivo"]];
const FATOR = { ptn: 4, cho: 4, lip: 9 };
const NOME = { ptn: "Proteína", cho: "Carboidrato", lip: "Gordura" };
const fmt = (v, c = 0) => (v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("pt-BR", { maximumFractionDigits: c, minimumFractionDigits: c }));

/** Conta do modelo com o peso real: kcal, e g/%/g·kg de cada macro. */
export function calcularModelo(modelo, peso, valores = {}) {
  const v = (k) => valores[k] ?? modelo[k]?.padrao;
  const g = {};
  let kcal = modelo.kcal.soma ? null : v("kcal") * peso;
  ["ptn", "cho", "lip"].forEach((k) => {
    const r = modelo[k];
    if (r.tipo === "gkg") g[k] = v(k) * peso;
  });
  if (kcal == null) kcal = ["ptn", "cho", "lip"].reduce((a, k) => a + (g[k] || 0) * FATOR[k], 0);
  ["ptn", "cho", "lip"].forEach((k) => {
    const r = modelo[k];
    if (r.tipo === "pct") g[k] = (v(k) / 100) * kcal / FATOR[k];
  });
  ["ptn", "cho", "lip"].forEach((k) => {
    if (modelo[k].tipo === "restante") {
      const usado = ["ptn", "cho", "lip"].filter((x) => x !== k).reduce((a, x) => a + (g[x] || 0) * FATOR[x], 0);
      g[k] = Math.max(0, (kcal - usado) / FATOR[k]);
    }
  });
  const linhas = ["ptn", "cho", "lip"].map((k) => ({ k, g: g[k], kcal: g[k] * FATOR[k], pct: kcal ? (g[k] * FATOR[k] * 100) / kcal : 0, gkg: peso ? g[k] / peso : null }));
  return { kcal, kcalKg: peso ? kcal / peso : null, linhas };
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

export default function ModelosMacros({ peso, objetivoPaciente, onAplicar }) {
  const { config, salvar } = useDietaConfig();
  const [objetivo, setObjetivo] = useState(/hipertrof|ganho|massa|rendimento|esport/i.test(objetivoPaciente || "") ? "ganho" : "reducao");
  const proprios = (config.modelos_macros || []).filter((m) => m.objetivo === objetivo);
  const lista = [...MODELOS_MACROS[objetivo], ...proprios];
  const [selId, setSelId] = useState(null);
  const [valores, setValores] = useState({});
  const modelo = lista.find((m) => m.id === selId) || null;
  const res = useMemo(() => (modelo && peso ? calcularModelo(modelo, peso, valores) : null), [modelo, peso, valores]);

  if (!peso) return <p className="rounded-lg bg-rc-amber/10 px-3 py-2 text-[12.5px] text-rc-amber">Informe o peso do paciente para usar os modelos de macros.</p>;

  const salvarMeu = async () => {
    const nome = window.prompt("Nome do seu modelo:", `${modelo.nome} (meu)`);
    if (!nome) return;
    const l = Object.fromEntries(res.linhas.map((x) => [x.k, x]));
    const novo = { id: `meu-${Date.now()}`, nome, objetivo, proprio: true, kcal: fx(res.kcalKg, res.kcalKg, Math.round(res.kcalKg * 10) / 10),
      ptn: { tipo: "gkg", ...fx(l.ptn.gkg, l.ptn.gkg, Math.round(l.ptn.gkg * 100) / 100) }, cho: { tipo: "gkg", ...fx(l.cho.gkg, l.cho.gkg, Math.round(l.cho.gkg * 100) / 100) }, lip: { tipo: "restante" } };
    try { await salvar({ modelos_macros: [...(config.modelos_macros || []), novo] }); toast.success("Modelo salvo."); } catch { toast.error("Não foi possível salvar o modelo."); }
  };
  const excluir = async (m) => {
    if (!window.confirm(`Excluir o modelo "${m.nome}"?`)) return;
    try { await salvar({ modelos_macros: (config.modelos_macros || []).filter((x) => x.id !== m.id) }); setSelId(null); } catch { toast.error("Não foi possível excluir."); }
  };
  const regraTexto = (r) => (r.tipo === "restante" ? "restante" : r.faixa[0] === r.faixa[1] ? `${fmt(r.padrao, r.tipo === "gkg" ? 1 : 0)}${r.tipo === "pct" ? "%" : " g/kg"}` : `${fmt(r.faixa[0], 1)}–${fmt(r.faixa[1], 1)}${r.tipo === "pct" ? "%" : " g/kg"}`);

  const deslizante = ({ k, rot, faixa, passo, sufixo }) => (
    <label className="block">
      <span className="flex justify-between text-[12px] text-gray-400"><span>{rot}</span><b className="tabular text-white">{fmt(valores[k] ?? modelo[k].padrao ?? modelo.kcal.padrao, 1)}{sufixo}</b></span>
      <input type="range" min={faixa[0]} max={faixa[1]} step={passo} value={valores[k] ?? (k === "kcal" ? modelo.kcal.padrao : modelo[k].padrao)}
        onChange={(e) => setValores((s) => ({ ...s, [k]: Number(e.target.value) }))} className="w-full accent-[#0081FD]" aria-label={rot} data-testid={`faixa-${k}`} />
    </label>
  );

  return (
    <section className="rc-card p-5" data-testid="modelos-macros">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h3 className="font-display font-bold uppercase text-[16px] text-white" style={{ fontStretch: "86%" }}>Modelos de macros</h3>
        <div role="radiogroup" aria-label="Objetivo" className="ml-auto inline-flex rounded-lg bg-white/[0.04] p-0.5 ring-1 ring-white/[0.06]">
          {OBJETIVOS.map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={objetivo === k} onClick={() => { setObjetivo(k); setSelId(null); setValores({}); }}
              className={`h-8 px-3 rounded-md text-[12.5px] font-semibold ${objetivo === k ? "bg-rc-blue text-white" : "text-gray-400 hover:text-white"}`}>{l}</button>
          ))}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {lista.map((m) => (
          <button key={m.id} type="button" onClick={() => { setSelId(m.id); setValores({}); }} aria-pressed={selId === m.id} data-testid={`modelo-${m.id}`}
            className={`rounded-xl px-3.5 py-3 text-left ring-1 transition-colors ${selId === m.id ? "bg-rc-blue/15 ring-rc-blue" : "bg-white/[0.03] ring-white/[0.06] hover:ring-white/20"}`}>
            <div className="flex items-center justify-between gap-2"><span className="text-[13.5px] font-semibold text-white">{m.nome}</span>{m.proprio && <span className="text-[10px] text-rc-lime">meu</span>}</div>
            <div className="mt-1 text-[11.5px] leading-snug text-gray-400">
              {m.kcal.soma ? "kcal = soma" : `${fmt(m.kcal.faixa[0])}–${fmt(m.kcal.faixa[1])} kcal/kg`} · P {regraTexto(m.ptn)} · C {regraTexto(m.cho)} · G {regraTexto(m.lip)}
            </div>
          </button>
        ))}
      </div>

      {modelo && res && (
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div>
            <div className="mb-3 grid gap-3 sm:grid-cols-3">
              {!modelo.kcal.soma && modelo.kcal.faixa[0] !== modelo.kcal.faixa[1] && deslizante({ k: "kcal", rot: "kcal/kg", faixa: modelo.kcal.faixa, passo: 0.5, sufixo: " kcal/kg" })}
              {["ptn", "cho", "lip"].filter((k) => modelo[k].tipo !== "restante" && modelo[k].faixa[0] !== modelo[k].faixa[1]).map((k) => (
                <React.Fragment key={k}>{deslizante({ k, rot: NOME[k], faixa: modelo[k].faixa, passo: modelo[k].tipo === "pct" ? 1 : 0.1, sufixo: modelo[k].tipo === "pct" ? "%" : " g/kg" })}</React.Fragment>
              ))}
            </div>
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
                <tr className="border-t border-white/[0.1] font-semibold"><td className="py-1.5 text-white">Total</td><td /><td className="text-right text-rc-lime" data-testid="kcal-modelo">{fmt(res.kcal)} kcal</td><td className="text-right text-gray-400">{fmt(res.linhas.reduce((t, x) => t + x.pct, 0))}%</td><td className="text-right text-gray-400">{fmt(res.kcalKg, 1)} kcal/kg</td></tr>
              </tbody>
            </table>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => onAplicar(res, modelo, false)} className="rc-btn-secondary h-9" data-testid="aplicar-modelo"><Check className="h-4 w-4" /> Aplicar aqui</button>
              <button type="button" onClick={() => onAplicar(res, modelo, true)} className="rc-btn-primary h-9" data-testid="usar-na-prescricao">Usar na Prescrição</button>
              <button type="button" onClick={salvarMeu} className="rc-btn-ghost h-9"><Save className="h-4 w-4" /> Salvar como meu modelo</button>
              {modelo.proprio && <button type="button" onClick={() => excluir(modelo)} className="rc-btn-ghost h-9 text-rc-coral"><Trash2 className="h-4 w-4" /> Excluir</button>}
            </div>
          </div>
          <aside className="rounded-xl bg-white/[0.03] p-4 text-[12.5px] ring-1 ring-white/[0.06]">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400">Referência</div>
            <ul className="space-y-1 text-gray-300">
              <li>PTN hipertrofia: 1,6–2,2 g/kg</li>
              <li>PTN dietas restritas: 2,3–3,5 g/kg</li>
              <li>CHO hipertrofia: 3–7 g/kg</li>
              <li>CHO restritas: 1–4 (estética), 2–5 (fisiculturistas), 5–8 g/kg (performance)</li>
              <li>LIP: 15–30% do VET</li>
            </ul>
            {alertas(objetivo, res).length > 0 && (
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
