import React, { useEffect, useMemo, useState } from "react";
import { Save, Target } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/evo-api";
import { FASES, pesoAlvo, referenciaGordura, selosAvaliacao } from "@/lib/gordura";

/**
 * Classificação e meta de % de gordura (ajuste gor1): selos (% gordura, IMC, cintura÷quadril), meta pela tabela certa
 * (Off/Cutting para atleta, Pollock & Wilmore ou Lohman), barra atual × alvo, peso-alvo mantendo a massa magra,
 * gordura a perder e prazo pelo ritmo semanal. A meta fica em patients.meta_gordura.
 */
const f1 = (v) => (v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 }));
const idadeDe = (nasc) => {
  if (!nasc) return null;
  const d = new Date(`${String(nasc).slice(0, 10)}T12:00:00`);
  const h = new Date();
  return h.getFullYear() - d.getFullYear() - ((h.getMonth() < d.getMonth() || (h.getMonth() === d.getMonth() && h.getDate() < d.getDate())) ? 1 : 0);
};
const COR_NIVEL = (nivel = "") => (/excelente|bom|na faixa|eutrofia|adequada|baixo$/i.test(nivel) ? "text-[#3DDC84] border-[#3DDC84]/40"
  : /ruim|obesidade|muito alto|excessivamente|alta$|acima da faixa/i.test(nivel) ? "text-[#FF5A5F] border-[#FF5A5F]/40" : "text-[#FFA53B] border-[#FFA53B]/40");

export function contextoGordura(patient) {
  return { sexo: patient.sexo, idade: idadeDe(patient.data_nascimento), atleta: !!patient.atleta, fase: patient.fase_treino || null, esteroides: !!patient.usa_esteroides };
}

export default function MetaGordura({ patient, avaliacao, reload }) {
  const ctx = contextoGordura(patient);
  const ref = referenciaGordura(ctx);
  const salva = patient.meta_gordura || {};
  const [faixa, setFaixa] = useState(() => (salva.min != null ? [salva.min, salva.max] : ref?.faixa || null));
  const [ritmo, setRitmo] = useState(salva.ritmo ?? 0.7);
  useEffect(() => { if (salva.min == null && ref?.faixa) setFaixa(ref.faixa); }, [ref?.tabela]); // eslint-disable-line react-hooks/exhaustive-deps
  const comp = avaliacao?.composicao || {};
  const pct = Number(comp.pct_gordura);
  const selos = useMemo(() => selosAvaliacao({ ...ctx, avaliacao }), [ctx.sexo, ctx.idade, ctx.atleta, ctx.fase, ctx.esteroides, avaliacao]); // eslint-disable-line react-hooks/exhaustive-deps
  const alvo = useMemo(() => (faixa ? pesoAlvo({ peso: avaliacao?.peso, pct, massaMagra: comp.massa_magra, faixa, ritmo }) : null), [faixa, avaliacao, pct, comp.massa_magra, ritmo]);

  if (!avaliacao || !Number.isFinite(pct)) {
    return <div className="rc-card px-5 py-4 text-[13px] text-gray-400" data-testid="meta-gordura">Meta de % de gordura: faça uma avaliação com % de gordura para ver a classificação e o peso-alvo.</div>;
  }
  const salvar = async () => {
    try {
      await api.patch(`/patients/${patient.id}`, { meta_gordura: { min: Number(faixa[0]), max: Number(faixa[1]), ritmo: Number(ritmo), tabela: ref?.tabela,
        peso_alvo_min: alvo ? Math.round(alvo.pesoMin * 10) / 10 : null, peso_alvo_max: alvo ? Math.round(alvo.pesoMax * 10) / 10 : null, atualizado_em: new Date().toISOString() } });
      toast.success("Meta de % de gordura salva."); reload?.();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  // barra 0–40%: posição do atual e da faixa-alvo
  const escala = (v) => `${Math.max(0, Math.min(100, (Number(v) / 40) * 100))}%`;
  const selo = (rot, val, nivel, extra) => nivel && (
    <div className={`border px-3 py-2 ${COR_NIVEL(nivel)}`}>
      <div className="text-[10.5px] uppercase tracking-[0.14em] text-gray-500">{rot}</div>
      <div className="text-[13.5px] font-semibold">{val} · {nivel}</div>
      {extra && <div className="text-[11px] text-gray-500">{extra}</div>}
    </div>
  );

  return (
    <section className="rc-card p-5" data-testid="meta-gordura">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="rc-h3"><Target className="-mt-0.5 mr-1.5 inline h-4 w-4 text-rc-blue" />Classificação e meta de gordura</h3>
        <span className="text-[12px] text-gray-500">{ref?.tabela}{ctx.atleta && !ctx.fase ? " · informe a fase (Off/Cutting) nos Dados pessoais para usar a tabela de atleta" : ""}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-3" data-testid="selos-avaliacao">
        {selo("% de gordura", `${f1(pct)}%`, selos.gordura?.nivel, selos.gordura?.tabela)}
        {selos.imc && selo("IMC (OMS)", f1(selos.imc.valor), selos.imc.nivel)}
        {selos.rcq && selo("Cintura ÷ quadril (Bray & Gray)", selos.rcq.rcq.toLocaleString("pt-BR", { maximumFractionDigits: 2 }), `risco ${selos.rcq.risco.toLowerCase()}`)}
      </div>

      {faixa && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-[12px] text-gray-400">Meta de % de gordura
                <span className="mt-1 flex items-center gap-1.5">
                  <input className="rc-input h-9 w-20 py-1" type="number" step="0.5" value={faixa[0]} onChange={(e) => setFaixa([e.target.value, faixa[1]])} aria-label="Meta mínima" data-testid="meta-min" />
                  <span>a</span>
                  <input className="rc-input h-9 w-20 py-1" type="number" step="0.5" value={faixa[1]} onChange={(e) => setFaixa([faixa[0], e.target.value])} aria-label="Meta máxima" data-testid="meta-max" />
                  <span>%</span>
                </span></label>
              {ref?.faixa && (Number(faixa[0]) !== ref.faixa[0] || Number(faixa[1]) !== ref.faixa[1]) && (
                <button type="button" className="rc-btn-ghost h-9 text-[12px]" onClick={() => setFaixa(ref.faixa)}>Usar a da tabela ({ref.faixa[0]}–{ref.faixa[1]}%)</button>
              )}
            </div>
            <div className="relative mt-5 h-3 bg-white/[0.06]" aria-label="% atual e faixa-alvo">
              <div className="absolute inset-y-0 bg-[#3DDC84]/40" style={{ left: escala(faixa[0]), width: `calc(${escala(faixa[1])} - ${escala(faixa[0])})` }} />
              <div className="absolute -top-1.5 h-6 w-[3px] bg-white" style={{ left: escala(pct) }} title={`Atual ${f1(pct)}%`} />
            </div>
            <div className="mt-1.5 flex justify-between text-[11px] text-gray-500"><span>0%</span><span>atual {f1(pct)}% · alvo {faixa[0]}–{faixa[1]}%</span><span>40%</span></div>
          </div>
          {alvo && (
            <div className="border border-[#1A1F26] bg-black p-4 text-[13px]" data-testid="peso-alvo">
              <div className="text-[10.5px] uppercase tracking-[0.14em] text-gray-500">Peso-alvo (massa magra {f1(alvo.massaMagra)} kg mantida)</div>
              <div className="rc-num mt-1 text-[20px] text-white">{f1(alvo.pesoMin)}–{f1(alvo.pesoMax)} kg</div>
              <div className="mt-1 text-gray-300">{alvo.perderMin > 0 ? `Perder ${f1(Math.max(0, alvo.perderMin))}–${f1(alvo.perderMax)} kg de gordura` : alvo.perderMax > 0 ? `Já perto da meta: até ${f1(alvo.perderMax)} kg` : "Já dentro ou abaixo da meta"}</div>
              <label className="mt-3 flex items-center gap-2 text-[12px] text-gray-400">Ritmo
                <input className="rc-input h-8 w-16 py-0.5" type="number" step="0.1" value={ritmo} onChange={(e) => setRitmo(e.target.value)} aria-label="Ritmo semanal" />% do peso/semana</label>
              {alvo.semanas && <div className="mt-1 text-[12.5px] text-gray-300" data-testid="prazo">≈ {f1(alvo.porSemana)} kg/semana → {alvo.semanas[0]}–{alvo.semanas[1]} semanas</div>}
            </div>
          )}
        </div>
      )}
      <div className="mt-4 flex items-center gap-3">
        <button type="button" onClick={salvar} className="rc-btn-secondary h-9" data-testid="salvar-meta-gordura"><Save className="h-4 w-4" /> Salvar meta</button>
        {salva.min != null && <span className="text-[12px] text-gray-500">Meta salva: {salva.min}–{salva.max}% · usada no Comparativo, na Previsão de Macros e no Dr. Donatto.</span>}
        {ctx.fase && <span className="text-[12px] text-gray-500">Fase: {FASES[ctx.fase]}</span>}
      </div>
    </section>
  );
}
