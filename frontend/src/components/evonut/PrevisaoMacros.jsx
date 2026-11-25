import React, { useMemo, useState } from "react";
import { Plus, Save, Scale, X } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/evo-api";
import { pesoDoPaciente } from "./dieta/plano";
import useDietaConfig from "./dieta/useDietaConfig";

/**
 * Previsão de Macros (itens 1 e 3 dos ajustes do Rogério):
 * - proteína e carboidrato são digitados; o lipídio SEMPRE completa a meta;
 * - seletor g/kg | %: ao trocar, a distribuição é a mesma (tudo é guardado em g/kg);
 * - distribuição calórica em 1 a 8 refeições (nome editável, %, kcal e P/C/L na hora), salva com a meta e
 *   levada para o planejamento da dieta (e daí para o modelo de dieta).
 */
const COR = { ptn: "#4DA6FF", cho: "#C3F53C", lip: "#FFB547" };
// Limite mínimo de lipídio: sugestão 0,5 g/kg — A CONFIRMAR com o Rogério.
export const LIP_MIN_GKG = 0.5;
const MAX_REFEICOES = 8;

const num = (v) => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const fmt = (v, casas = 1) => (v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("pt-BR", { maximumFractionDigits: casas, minimumFractionDigits: 0 }));
const r1 = (v) => Math.round(v * 10) / 10;

function distribuirIgual(nomes) {
  const n = nomes.length;
  const base = Math.floor((100 / n) * 10) / 10;
  return nomes.map((nome, i) => ({ nome, pct: i === n - 1 ? r1(100 - base * (n - 1)) : base }));
}

export function Pizza({ partes, tamanho = 150 }) {
  const total = partes.reduce((a, p) => a + Math.max(0, p.valor), 0);
  if (!total) return <div style={{ width: tamanho, height: tamanho }} className="rounded-full bg-white/[0.04]" />;
  const r = tamanho / 2;
  let ang = -Math.PI / 2;
  return (
    <svg width={tamanho} height={tamanho} viewBox={`0 0 ${tamanho} ${tamanho}`} role="img" aria-label="Distribuição dos macronutrientes">
      {partes.map((p) => {
        const frac = Math.max(0, p.valor) / total;
        const a0 = ang;
        const a1 = ang + frac * Math.PI * 2;
        ang = a1;
        const grande = frac > 0.5 ? 1 : 0;
        const x0 = r + r * Math.cos(a0), y0 = r + r * Math.sin(a0), x1 = r + r * Math.cos(a1), y1 = r + r * Math.sin(a1);
        const meio = (a0 + a1) / 2;
        const tx = r + r * 0.6 * Math.cos(meio), ty = r + r * 0.6 * Math.sin(meio);
        const d = frac >= 0.9999 ? `M ${r} 0 A ${r} ${r} 0 1 1 ${r - 0.01} 0 Z` : `M ${r} ${r} L ${x0} ${y0} A ${r} ${r} 0 ${grande} 1 ${x1} ${y1} Z`;
        return (
          <g key={p.key}>
            <path d={d} fill={p.cor} stroke="#0b0f14" strokeWidth="1.5" />
            {frac >= 0.06 && (
              <text x={tx} y={ty} textAnchor="middle" dominantBaseline="central" fontSize="12" fontWeight="700" fill="#0b0f14">
                {Math.round(frac * 100)}%
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function CampoMacro({ rotulo, cor, valor, onChange, modo, equivalencia, somenteLeitura, aviso }) {
  return (
    <label className="block">
      <span className="evo-label flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-[2px]" style={{ background: cor }} />{rotulo}</span>
      <div className="relative">
        <input type="text" inputMode="decimal" readOnly={somenteLeitura} value={valor} onChange={(e) => onChange?.(e.target.value)}
          className={`evo-input h-11 pr-14 tabular ${somenteLeitura ? "bg-white/[0.02] text-gray-300 cursor-not-allowed" : ""}`}
          aria-label={`${rotulo} em ${modo === "pct" ? "%" : "g/kg"}`} />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-gray-500">{modo === "pct" ? "%" : "g/kg"}</span>
      </div>
      <span className="block mt-1 text-[11.5px] text-gray-500 tabular">{equivalencia}</span>
      {somenteLeitura && <span className="block text-[11px] text-gray-500">Completa a meta automaticamente.</span>}
      {aviso}
    </label>
  );
}

export default function PrevisaoMacros({ d, reload, onIrGasto }) {
  const patient = d.patient;
  const meta = useMemo(() => patient.meta_energetica || {}, [patient.meta_energetica]);
  const { config } = useDietaConfig();
  const kcal = num(meta.kcal_final);
  const peso = num(pesoDoPaciente(d));

  // valores guardados em g/kg (compatível com metas antigas: carboidrato vinha de macros_g)
  const [modo, setModo] = useState(meta.modo_macros === "pct" ? "pct" : "gkg");
  const [ptnGkg, setPtnGkg] = useState(() => num(meta.ptn_gkg) ?? 2);
  const [choGkg, setChoGkg] = useState(() => {
    if (num(meta.cho_gkg) != null && meta.cho_modo !== "restante") return num(meta.cho_gkg);
    const g = num(meta.macros_g?.carboidratos);
    return g && peso ? r1(g / peso) : 4;
  });
  const [textos, setTextos] = useState({});
  const [dist, setDist] = useState(() => {
    if (Array.isArray(meta.distribuicao) && meta.distribuicao.length) return meta.distribuicao.map((r) => ({ nome: r.nome, pct: num(r.pct) ?? 0 }));
    return null;
  });
  const [salvando, setSalvando] = useState(false);

  const refeicoesPadrao = (config.refeicoes_padrao || []).map((r) => r.nome).filter(Boolean);
  const distribuicao = dist || distribuirIgual((refeicoesPadrao.length ? refeicoesPadrao : ["Café da manhã", "Lanche da manhã", "Almoço", "Lanche da tarde", "Jantar"]).slice(0, MAX_REFEICOES));

  // conta: P e C digitados (g/kg), lipídio = o que falta para a meta
  const ptnG = peso ? ptnGkg * peso : null;
  const choG = peso ? choGkg * peso : null;
  const kcalPC = ptnG != null && choG != null ? ptnG * 4 + choG * 4 : null;
  const lipG = kcal != null && kcalPC != null ? (kcal - kcalPC) / 9 : null;
  const lipGkg = lipG != null && peso ? lipG / peso : null;
  const passou = kcal != null && kcalPC != null && kcalPC > kcal;
  const lipBaixo = !passou && lipGkg != null && lipGkg < LIP_MIN_GKG;
  const pct = (g, f) => (kcal && g != null ? (g * f * 100) / kcal : null);
  const macros = [
    { key: "ptn", label: "Proteínas", g: ptnG, gkg: ptnGkg, kcal: ptnG != null ? ptnG * 4 : null, pct: pct(ptnG, 4) },
    { key: "cho", label: "Carboidratos", g: choG, gkg: choGkg, kcal: choG != null ? choG * 4 : null, pct: pct(choG, 4) },
    { key: "lip", label: "Lipídios", g: lipG, gkg: lipGkg, kcal: lipG != null ? lipG * 9 : null, pct: pct(lipG, 9) },
  ];

  // exibição no modo escolhido (o que é digitado é convertido para g/kg na hora)
  const exibir = (key, gkg) => {
    if (textos[key] != null) return textos[key];
    if (gkg == null) return "";
    if (modo === "gkg") return fmt(gkg, 2);
    const p = pct(gkg * (peso || 0), key === "lip" ? 9 : 4);
    return p == null ? "" : fmt(p, 1);
  };
  const digitar = (key, set) => (txt) => {
    setTextos((t) => ({ ...t, [key]: txt }));
    const v = num(txt);
    if (v == null) return;
    if (modo === "gkg") set(v);
    else if (kcal && peso) set((v / 100) * kcal / 4 / peso);
  };
  const trocarModo = (m) => { setModo(m); setTextos({}); };
  const equivalencia = (m) => {
    if (m.g == null) return "Informe a meta e o peso";
    const outra = modo === "gkg" ? `${fmt(m.pct, 1)}%` : `${fmt(m.gkg, 2)} g/kg`;
    return `= ${outra} · ${fmt(m.g, 0)} g`;
  };

  // distribuição nas refeições
  const somaPct = r1(distribuicao.reduce((a, r) => a + (num(r.pct) || 0), 0));
  const fechou = Math.abs(somaPct - 100) < 0.05;
  const setRefeicao = (i, campo, valor) => setDist(distribuicao.map((r, k) => (k === i ? { ...r, [campo]: valor } : r)));
  const linhaMacros = (p) => {
    const f = (num(p) || 0) / 100;
    return { kcal: kcal != null ? kcal * f : null, ptn: ptnG != null ? ptnG * f : null, cho: choG != null ? choG * f : null, lip: lipG != null ? lipG * f : null };
  };

  const salvar = async () => {
    if (passou) { toast.error("Proteína + carboidrato passam da meta: ajuste antes de salvar."); return; }
    setSalvando(true);
    try {
      await api.patch(`/patients/${patient.id}`, {
        meta_energetica: {
          ...meta,
          modo_macros: modo,
          ptn_gkg: r1(ptnGkg * 100) / 100,
          cho_gkg: r1(choGkg * 100) / 100,
          cho_modo: "gkg",
          lip_gkg: lipGkg != null ? Math.round(lipGkg * 100) / 100 : null,
          lip_completa: true,
          macros_g: { proteinas: ptnG != null ? r1(ptnG) : null, carboidratos: choG != null ? r1(choG) : null, lipidios: lipG != null ? r1(lipG) : null },
          distribuicao: distribuicao.map((r) => ({ nome: String(r.nome || "").trim(), pct: num(r.pct) || 0 })),
          atualizado_em: new Date().toISOString(),
        },
      });
      toast.success("Macros e distribuição salvos. A Prescrição usa essa meta por refeição.");
      reload?.();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setSalvando(false);
    }
  };

  if (kcal == null) {
    return (
      <div className="evo-card p-8 text-center text-sm text-gray-400" data-testid="macros-sem-meta">
        Defina a meta calórica em Gasto Energético para prever os macros.
        {onIrGasto && <div className="mt-4"><button type="button" className="evo-btn-primary" onClick={onIrGasto}>Ir para Gasto Energético</button></div>}
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="previsao-macros">
      <section className="evo-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
          <div>
            <h3 className="evo-h3">Previsão de macros</h3>
            <p className="mt-1 text-xs text-gray-500">
              Meta {fmt(kcal, 0)} kcal/dia (Gasto Energético){peso ? ` · peso ${fmt(peso)} kg` : ""}. Proteína e carboidrato são digitados; o lipídio completa a meta.
            </p>
          </div>
          <div role="group" aria-label="Unidade" className="inline-flex p-0.5 rounded-lg bg-white/[0.04] ring-1 ring-white/[0.08]">
            {[["gkg", "g/kg"], ["pct", "%"]].map(([k, l]) => (
              <button key={k} type="button" aria-pressed={modo === k} onClick={() => trocarModo(k)}
                className={`px-4 h-9 rounded-md text-[13px] font-semibold transition-colors ${modo === k ? "bg-rc-blue text-white" : "text-gray-400 hover:text-white"}`}>{l}</button>
            ))}
          </div>
        </div>
        {!peso && <p className="mb-4 rounded-lg bg-rc-amber/10 px-3 py-2 text-[12.5px] text-rc-amber">Sem peso do paciente: cadastre na ficha ou numa avaliação de Antropometria.</p>}

        <div className="grid gap-4 sm:grid-cols-3">
          <CampoMacro rotulo="Proteínas" cor={COR.ptn} modo={modo} valor={exibir("ptn", ptnGkg)} onChange={digitar("ptn", setPtnGkg)} equivalencia={equivalencia(macros[0])} />
          <CampoMacro rotulo="Carboidratos" cor={COR.cho} modo={modo} valor={exibir("cho", choGkg)} onChange={digitar("cho", setChoGkg)} equivalencia={equivalencia(macros[1])} />
          <CampoMacro rotulo="Lipídios" cor={COR.lip} modo={modo} somenteLeitura valor={lipGkg == null ? "" : modo === "gkg" ? fmt(lipGkg, 2) : fmt(macros[2].pct, 1)}
            equivalencia={equivalencia(macros[2])}
            aviso={lipBaixo && <span role="status" className="block mt-1 text-[12px] font-semibold text-rc-amber" data-testid="aviso-lip-baixo">Lipídio abaixo do mínimo ({fmt(LIP_MIN_GKG, 1)} g/kg).</span>} />
        </div>
        {passou && (
          <p role="alert" className="mt-4 rounded-lg bg-rc-coral/10 px-3 py-2 text-[13px] font-semibold text-rc-coral" data-testid="aviso-passou-meta">
            Proteína + carboidrato somam {fmt(kcalPC, 0)} kcal e passam da meta em {fmt(kcalPC - kcal, 0)} kcal. Reduza um deles.
          </p>
        )}

        <div className="mt-6 flex flex-col md:flex-row gap-5 items-start">
          <div className="flex-1 w-full overflow-x-auto rounded-lg border border-white/[0.08]">
            <table className="w-full min-w-[460px] border-collapse text-sm">
              <thead>
                <tr className="bg-white/[0.05] text-[11px] uppercase text-gray-400">
                  <th className="px-3 py-2.5 text-left">Macronutriente</th>
                  <th className="px-3 py-2.5 text-center">%</th>
                  <th className="px-3 py-2.5 text-center">g</th>
                  <th className="px-3 py-2.5 text-center">g/kg</th>
                  <th className="px-3 py-2.5 text-center">kcal</th>
                </tr>
              </thead>
              <tbody>
                {macros.map((m) => (
                  <tr key={m.key} className="border-t border-white/[0.05]">
                    <th className="px-3 py-2.5 text-left font-medium text-gray-200"><span className="mr-2 inline-block h-2 w-2 rounded-[2px]" style={{ background: COR[m.key] }} />{m.label}</th>
                    <td className="px-3 py-2.5 text-center tabular font-bold text-white">{fmt(m.pct, 1)}%</td>
                    <td className="px-3 py-2.5 text-center tabular text-gray-300">{fmt(m.g, 0)}</td>
                    <td className="px-3 py-2.5 text-center tabular text-gray-300">{fmt(m.gkg, 2)}</td>
                    <td className="px-3 py-2.5 text-center tabular text-gray-300">{fmt(m.kcal, 0)}</td>
                  </tr>
                ))}
                <tr className="border-t border-white/[0.1]">
                  <th className="px-3 py-2.5 text-left font-bold text-gray-100">Total</th>
                  <td className="px-3 py-2.5 text-center tabular font-bold text-white">100%</td>
                  <td colSpan={2} />
                  <td className="px-3 py-2.5 text-center tabular font-semibold text-rc-lime">{fmt(kcal, 0)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="shrink-0 mx-auto md:mx-0">
            <Pizza partes={macros.map((m) => ({ key: m.key, cor: COR[m.key], valor: m.kcal || 0 }))} />
          </div>
        </div>
      </section>

      <section className="evo-card p-5" data-testid="distribuicao-refeicoes">
        <h3 className="evo-h3">Distribuição calórica nas refeições</h3>
        <p className="mt-1 mb-4 text-xs text-gray-500 tabular">
          Meta {fmt(kcal, 0)} kcal/dia · P {fmt(ptnG, 0)} g · C {fmt(choG, 0)} g · L {fmt(lipG, 0)} g
        </p>
        <div className="overflow-x-auto rounded-lg border border-white/[0.08]">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="bg-white/[0.04] text-[12px] text-gray-400">
                <th className="px-3 py-2.5 text-left font-medium">Refeição</th>
                <th className="px-3 py-2.5 text-right font-medium w-[110px]">%</th>
                <th className="px-3 py-2.5 text-center font-medium">Kcal</th>
                <th className="px-3 py-2.5 text-center font-medium" style={{ color: COR.ptn }}>P (g)</th>
                <th className="px-3 py-2.5 text-center font-medium" style={{ color: COR.cho }}>C (g)</th>
                <th className="px-3 py-2.5 text-center font-medium" style={{ color: COR.lip }}>L (g)</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {distribuicao.map((r, i) => {
                const m = linhaMacros(r.pct);
                return (
                  <tr key={i} className="border-t border-white/[0.05]">
                    <td className="px-2 py-1.5"><input className="evo-input h-10" value={r.nome} aria-label={`Nome da refeição ${i + 1}`} onChange={(e) => setRefeicao(i, "nome", e.target.value)} /></td>
                    <td className="px-2 py-1.5">
                      <div className="relative">
                        <input className="evo-input h-10 pr-7 text-right tabular" inputMode="decimal" aria-label={`% da refeição ${r.nome || i + 1}`}
                          value={String(r.pct).replace(".", ",")} onChange={(e) => setRefeicao(i, "pct", e.target.value.replace(",", "."))} />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-gray-500">%</span>
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-center tabular font-semibold text-white">{fmt(m.kcal, 0)}</td>
                    <td className="px-3 py-1.5 text-center tabular text-gray-300">{fmt(m.ptn, 0)}</td>
                    <td className="px-3 py-1.5 text-center tabular text-gray-300">{fmt(m.cho, 0)}</td>
                    <td className="px-3 py-1.5 text-center tabular text-gray-300">{fmt(m.lip, 0)}</td>
                    <td className="px-1 py-1.5 text-center">
                      <button type="button" disabled={distribuicao.length <= 1} onClick={() => setDist(distribuicao.filter((_, k) => k !== i))}
                        className="evo-btn-ghost p-1.5 disabled:opacity-25" aria-label={`Remover ${r.nome || "refeição"}`}><X className="w-4 h-4" /></button>
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t border-white/[0.1]" data-testid="total-distribuicao">
                <th className="px-3 py-2.5 text-left font-bold text-gray-100">Total</th>
                <td className={`px-3 py-2.5 text-right tabular font-bold ${fechou ? "text-white" : "text-rc-coral"}`}>{fmt(somaPct, 1)}%</td>
                <td className={`px-3 py-2.5 text-center tabular font-bold ${fechou ? "text-rc-lime" : "text-rc-coral"}`}>{fmt(kcal * somaPct / 100, 0)}</td>
                <td className="px-3 py-2.5 text-center tabular text-gray-300">{fmt(ptnG != null ? ptnG * somaPct / 100 : null, 0)}</td>
                <td className="px-3 py-2.5 text-center tabular text-gray-300">{fmt(choG != null ? choG * somaPct / 100 : null, 0)}</td>
                <td className="px-3 py-2.5 text-center tabular text-gray-300">{fmt(lipG != null ? lipG * somaPct / 100 : null, 0)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-white/[0.04]">
          {distribuicao.map((r, i) => (
            <div key={i} title={`${r.nome}: ${fmt(num(r.pct), 1)}%`} style={{ width: `${Math.max(0, num(r.pct) || 0)}%`, background: `hsl(${212 + i * 9} 95% ${52 + (i % 4) * 7}%)` }} />
          ))}
        </div>
        {fechou ? (
          <p className="mt-3 text-[13px] text-rc-lime">Distribuição completa: 100% da meta dividida em {distribuicao.length} refeições.</p>
        ) : (
          <p role="alert" className="mt-3 text-[13px] font-semibold text-rc-coral" data-testid="aviso-distribuicao">
            {somaPct < 100
              ? `Faltam ${fmt(100 - somaPct, 1)}% (${fmt(kcal * (100 - somaPct) / 100, 0)} kcal) para fechar a meta.`
              : `Passou ${fmt(somaPct - 100, 1)}% (${fmt(kcal * (somaPct - 100) / 100, 0)} kcal) da meta.`}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="evo-btn-secondary" disabled={distribuicao.length >= MAX_REFEICOES}
            onClick={() => setDist([...distribuicao, { nome: `Refeição ${distribuicao.length + 1}`, pct: 0 }])}>
            <Plus className="w-4 h-4" /> Adicionar refeição
          </button>
          <button type="button" className="evo-btn-secondary" onClick={() => setDist(distribuirIgual(distribuicao.map((r) => r.nome)))}>
            <Scale className="w-4 h-4" /> Distribuir igualmente
          </button>
        </div>
      </section>

      <div className="flex justify-end">
        <button type="button" onClick={salvar} disabled={salvando || !peso} className="evo-btn-primary" data-testid="salvar-macros">
          <Save className="h-4 w-4" />{salvando ? "Salvando…" : "Salvar macros e distribuição"}
        </button>
      </div>
    </div>
  );
}
