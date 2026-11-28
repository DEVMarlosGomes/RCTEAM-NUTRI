import React, { useMemo, useState } from "react";
import { AlertTriangle, CalendarRange, Plus, Save, Utensils, X } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/evo-api";
import {
  DIAS, FAIXA_HALUCH, NIVEIS, PADROES_NIVEL, ROTULO_NIVEL, bastaParaMeta, cicloHaluchPadrao, cicloNivelPadrao,
  macrosDaFase, macrosDoNivel, mediaSemana, situacaoDoCiclo,
} from "@/lib/ciclos";
import { pesoAlvo } from "@/lib/gordura";

/**
 * Ciclos de carboidrato na Previsão de Macros (ajustes cid1 e cic1).
 * cid1: carbo alto / médio / baixo por DIA da semana ou por SEMANA. cic1: Haluch, 4 fases low ⇄ high carb.
 * As calorias da dieta vêm do Gasto Energético; "Criar dietas do ciclo" abre uma dieta por tipo na Prescrição.
 */
const f0 = (v) => (v == null || !Number.isFinite(v) ? "—" : Math.round(v).toLocaleString("pt-BR"));
const f1 = (v) => (v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 }));
const numero = (v) => (v === "" ? "" : Number(v));

export default function CicloCarbo({ d, peso, meta, reload, onIrPrescricao }) {
  const p = d.patient;
  const [ciclo, setCiclo] = useState(() => p.ciclo_carbo || null);
  const [salvando, setSalvando] = useState(false);
  const sit = useMemo(() => (ciclo ? situacaoDoCiclo(ciclo) : null), [ciclo]);
  const set = (patch) => setCiclo((c) => ({ ...c, ...patch }));
  const sujo = JSON.stringify(ciclo || null) !== JSON.stringify(p.ciclo_carbo || null);

  const salvar = async () => {
    setSalvando(true);
    try { await api.patch(`/patients/${p.id}`, { ciclo_carbo: ciclo }); toast.success(ciclo ? "Ciclo salvo." : "Ciclo removido."); reload?.(); return true; }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); return false; } finally { setSalvando(false); }
  };

  /** Uma dieta por tipo do ciclo, com as metas certas; copia as refeições da dieta mais recente. */
  const criarDietas = async () => {
    if (sujo && !(await salvar())) return;
    try {
      const { data: planos } = await api.get(`/patients/${p.id}/planos-manuais`);
      const base = [...(planos || [])].filter((x) => !x.ciclo_tipo).sort((a, b) => String(b.atualizado_em || "").localeCompare(String(a.atualizado_em || "")))[0];
      const tipos = ciclo.tipo === "haluch"
        ? ciclo.fases.map((f, i) => { const m = macrosDaFase(f, meta, peso); return { chave: `fase${i + 1}`, titulo: `${f.nome} · ${f.tipo === "low" ? "low" : "high"} carb`, m: m && { kcal: m.kcal, pct_cho: f.cho, pct_ptn: f.ptn, pct_lip: f.lip } }; })
        : NIVEIS.map(([k, rot]) => { const m = macrosDoNivel(ciclo.niveis[k], peso, meta, ciclo.gordura_modo); return { chave: k, titulo: rot, m: m && !m.erro && { kcal: m.kcal, pct_cho: m.pct.cho, pct_ptn: m.pct.ptn, pct_lip: m.pct.lip } }; });
      let criadas = 0;
      for (const t of tipos) {
        if ((planos || []).some((x) => x.ciclo_tipo === t.chave) || !t.m) continue;
        const r1 = (x) => Math.round(x * 10) / 10;
        await api.post(`/patients/${p.id}/planos-manuais`, {
          titulo: t.titulo, objetivo: base?.objetivo || p.objetivo || null, ciclo_tipo: t.chave,
          meta_kcal: Math.round(t.m.kcal),
          planejamento: { kcal: Math.round(t.m.kcal), pct_cho: Math.round(t.m.pct_cho), pct_ptn: Math.round(t.m.pct_ptn), pct_lip: Math.round(t.m.pct_lip),
            kcal_kg: peso ? r1(t.m.kcal / peso) : "", distribuicao: (p.meta_energetica?.distribuicao || []) },
          refeicoes: (base?.refeicoes || []).map((r) => ({ nome: r.nome, horario: r.horario, meta_pct: r.meta_pct ?? null, observacao: r.observacao || "",
            alimentos: (r.alimentos || []).map((a) => ({ alimento_id: a.alimento_id, nome: a.nome || a.alimento_nome, quantidade: a.quantidade, medida_nome: a.medida_nome, quantidade_g: a.quantidade_g, observacao: a.observacao, substitutos: a.substitutos || [] })),
            opcoes: [] })),
          recomendacoes: base?.recomendacoes || [], orientacao_ids: base?.orientacao_ids || [],
        });
        criadas += 1;
      }
      toast.success(criadas ? `${criadas} dieta(s) do ciclo criada(s) na Prescrição${base ? `, a partir de "${base.titulo}"` : ""}. Ajuste cada uma à sua meta.` : "As dietas do ciclo já existem na Prescrição.");
      onIrPrescricao?.();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  const tipoAtual = !ciclo ? "nenhum" : ciclo.tipo;
  return (
    <section className="rc-card p-5" data-testid="ciclo-carbo">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h3 className="rc-h3"><CalendarRange className="-mt-0.5 mr-1.5 inline h-4 w-4 text-rc-blue" />Ciclo de carboidratos</h3>
        <div role="radiogroup" aria-label="Tipo de ciclo" className="grid w-full grid-cols-3 bg-white/[0.04] p-0.5 ring-1 ring-white/[0.06] sm:ml-auto sm:inline-flex sm:w-auto">
          {[["nenhum", "Sem ciclo"], ["nivel", "Alto · médio · baixo"], ["haluch", "Haluch (4 fases)"]].map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={tipoAtual === k} data-testid={`ciclo-${k}`}
              onClick={() => setCiclo(k === "nenhum" ? null : k === "nivel" ? cicloNivelPadrao() : cicloHaluchPadrao())}
              className={`min-h-9 px-2 py-1.5 text-[12.5px] font-semibold leading-tight sm:px-3 ${tipoAtual === k ? "bg-rc-blue text-black" : "text-gray-400 hover:text-white"}`}>{l}</button>
          ))}
        </div>
      </div>
      {!meta && ciclo && <p className="mb-3 text-[13px] text-rc-amber">Defina as calorias da dieta no Gasto Energético: os ciclos dividem essa meta.</p>}
      {ciclo?.tipo === "nivel" && <EditorNivel ciclo={ciclo} set={set} peso={peso} meta={meta} sit={sit} />}
      {ciclo?.tipo === "haluch" && <EditorHaluch ciclo={ciclo} set={set} peso={peso} meta={meta} sit={sit} p={p} avaliacoes={d.evaluations || []} />}
      {!ciclo && <p className="text-[13px] text-gray-400">Use um ciclo para alternar dias ou fases de carboidrato. Cada tipo vira uma dieta na Prescrição, e o app e o PDF do paciente mostram a do dia.</p>}
      {(ciclo || p.ciclo_carbo) && (
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" onClick={salvar} disabled={salvando || !sujo} className="rc-btn-secondary h-9" data-testid="salvar-ciclo"><Save className="h-4 w-4" /> {ciclo ? "Salvar ciclo" : "Remover ciclo"}</button>
          {ciclo && <button type="button" onClick={criarDietas} disabled={!meta || !peso} className="rc-btn-primary h-9" data-testid="criar-dietas-ciclo"><Utensils className="h-4 w-4" /> Criar dietas do ciclo na Prescrição</button>}
        </div>
      )}
    </section>
  );
}

function EditorNivel({ ciclo, set, peso, meta, sit }) {
  const media = mediaSemana(ciclo, peso, meta);
  const setNivel = (k, campo, v) => set({ niveis: { ...ciclo.niveis, [k]: { ...ciclo.niveis[k], [campo]: numero(v) } } });
  const girar = (dia) => { const ordem = ["alto", "medio", "baixo"]; const atual = (ciclo.semana || {})[dia] || "medio"; set({ semana: { ...ciclo.semana, [dia]: ordem[(ordem.indexOf(atual) + 1) % 3] } }); };
  const cor = { alto: "bg-rc-blue text-black", medio: "bg-[#7FC0FF] text-black", baixo: "bg-white/[0.08] text-gray-200" };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-[12px] text-gray-400">Padrão do caderno
          <select className="rc-input mt-1 h-9 w-auto py-1" value={ciclo.padrao || ""} onChange={(e) => { const pd = PADROES_NIVEL[e.target.value]; if (pd) set({ padrao: e.target.value, gordura_modo: pd.gordura_modo, niveis: JSON.parse(JSON.stringify(pd.niveis)) }); }} data-testid="padrao-nivel">
            {Object.entries(PADROES_NIVEL).map(([k, v]) => <option key={k} value={k}>{v.nome}</option>)}
          </select></label>
        <div className="text-[12px] text-gray-400">Gordura
          <div className="mt-1 inline-flex bg-white/[0.04] p-0.5 ring-1 ring-white/[0.06]">
            {[["completa", "Completa as calorias"], ["fixa", "Fixa em g/kg"]].map(([k, l]) => (
              <button key={k} type="button" onClick={() => set({ gordura_modo: k })} aria-pressed={ciclo.gordura_modo === k} className={`h-8 px-3 text-[12px] font-semibold ${ciclo.gordura_modo === k ? "bg-rc-blue text-black" : "text-gray-400"}`}>{l}</button>
            ))}
          </div></div>
        <div className="text-[12px] text-gray-400">Ciclo por
          <div className="mt-1 inline-flex bg-white/[0.04] p-0.5 ring-1 ring-white/[0.06]">
            {[["dia", "Dia"], ["semana", "Semana"]].map(([k, l]) => (
              <button key={k} type="button" onClick={() => set({ unidade: k })} aria-pressed={ciclo.unidade === k} data-testid={`unidade-${k}`} className={`h-8 px-3 text-[12px] font-semibold ${ciclo.unidade === k ? "bg-rc-blue text-black" : "text-gray-400"}`}>{l}</button>
            ))}
          </div></div>
      </div>
      <p className="text-[12px] text-gray-500">{ciclo.gordura_modo === "completa" ? "Semanas iniciais / manter: todos os dias na meta; a gordura é o restante." : "Semanas finais / reduzir: gordura e proteína fixas; só o carboidrato muda as calorias do dia."}</p>

      <table className="w-full text-[13px] tabular" data-testid="tabela-niveis">
        <thead><tr className="text-[10.5px] uppercase tracking-[0.12em] text-gray-500"><th className="py-1.5 text-left font-medium">Dia</th><th className="text-right font-medium">CHO g/kg</th><th className="text-right font-medium">PTN g/kg</th><th className="text-right font-medium">LIP g/kg</th><th className="text-right font-medium">CHO · PTN · LIP (g)</th><th className="text-right font-medium">kcal</th></tr></thead>
        <tbody>
          {NIVEIS.map(([k, rot]) => {
            const m = macrosDoNivel(ciclo.niveis[k], peso, meta, ciclo.gordura_modo);
            const campo = (c) => <input className="rc-input h-8 w-16 py-0.5 text-right" type="number" step="0.1" value={ciclo.niveis[k][c]} onChange={(e) => setNivel(k, c, e.target.value)} aria-label={`${rot} ${c}`} data-testid={`nivel-${k}-${c}`} />;
            return (
              <React.Fragment key={k}>
                <tr className="border-t border-white/[0.05]">
                  <td className="py-1.5 font-semibold text-white">{rot}</td>
                  <td className="text-right">{campo("cho")}</td><td className="text-right">{campo("ptn")}</td>
                  <td className="text-right">{ciclo.gordura_modo === "fixa" ? campo("lip") : <span className="text-gray-300">{f1(m?.gkg?.lip)} <span className="text-[11px] text-gray-500">(restante)</span></span>}</td>
                  <td className="text-right text-gray-300">{m && !m.erro ? `${f0(m.cho)} · ${f0(m.ptn)} · ${f0(m.lip)}` : "—"}</td>
                  <td className="text-right font-semibold text-white" data-testid={`kcal-${k}`}>{m && !m.erro ? f0(m.kcal) : "—"}</td>
                </tr>
                {(m?.erro || m?.aviso) && <tr><td colSpan={6} className={`pb-1.5 text-[12px] ${m.erro ? "text-rc-coral" : "text-rc-amber"}`} data-testid={`trava-${k}`}><AlertTriangle className="-mt-0.5 mr-1 inline h-3.5 w-3.5" />{m.erro || m.aviso}</td></tr>}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>

      {ciclo.unidade === "dia" ? (
        <div>
          <div className="mb-1.5 text-[12px] text-gray-400">Semana do paciente (um clique troca o tipo) · sugestão: treino pesado = alto, treino leve = médio, descanso = baixo</div>
          <div className="grid grid-cols-7 gap-1" data-testid="semana-ciclo">
            {DIAS.map(([k, rot]) => (
              <button key={k} type="button" onClick={() => girar(k)} className={`h-14 text-[12px] font-semibold ${cor[(ciclo.semana || {})[k] || "medio"]} ${sit?.dia === k ? "outline outline-2 outline-white" : ""}`} data-testid={`dia-${k}`}>
                {rot}<div className="text-[10.5px] font-normal">{ROTULO_NIVEL[(ciclo.semana || {})[k] || "medio"].replace("Carbo ", "")}</div>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[12.5px] text-gray-300" data-testid="media-semana">Média da semana: {f0(media)} kcal/dia{meta ? ` · meta ${f0(meta)} kcal` : ""}{sit ? ` · hoje: ${ROTULO_NIVEL[sit.nivel]}` : ""}</p>
        </div>
      ) : (
        <div>
          <div className="mb-1.5 flex flex-wrap items-end gap-3 text-[12px] text-gray-400">
            <label>Início<input type="date" className="rc-input mt-1 h-8 w-auto py-0.5" value={ciclo.inicio || ""} onChange={(e) => set({ inicio: e.target.value })} /></label>
            <span>Sequência de semanas (repete):</span>
          </div>
          <div className="flex flex-wrap items-center gap-1" data-testid="sequencia-semanas">
            {(ciclo.sequencia || []).map((nv, i) => (
              <span key={i} className={`inline-flex h-9 items-center gap-1 px-2.5 text-[12px] font-semibold ${cor[nv]} ${sit && sit.posicao === i + 1 ? "outline outline-2 outline-white" : ""}`}>
                Sem. {i + 1}
                <select className="bg-transparent text-[12px]" value={nv} onChange={(e) => set({ sequencia: ciclo.sequencia.map((x, j) => (j === i ? e.target.value : x)) })} aria-label={`Semana ${i + 1}`}>
                  {NIVEIS.map(([k, r]) => <option key={k} value={k} className="text-black">{r.replace("Carbo ", "")}</option>)}
                </select>
                {ciclo.sequencia.length > 1 && <button type="button" onClick={() => set({ sequencia: ciclo.sequencia.filter((_, j) => j !== i) })} aria-label="Remover semana"><X className="h-3 w-3" /></button>}
              </span>
            ))}
            <button type="button" onClick={() => set({ sequencia: [...(ciclo.sequencia || []), "medio"] })} className="rc-btn-ghost h-9 text-[12px]"><Plus className="h-3.5 w-3.5" /> semana</button>
          </div>
          {sit && <p className="mt-2 text-[12.5px] text-gray-300">Hoje · semana {sit.semana}: {ROTULO_NIVEL[sit.nivel]}{sit.proximaTroca && sit.proximo !== sit.nivel ? ` · troca para ${ROTULO_NIVEL[sit.proximo]} em ${sit.proximaTroca.split("-").reverse().join("/")}` : ""}</p>}
        </div>
      )}
    </div>
  );
}

function EditorHaluch({ ciclo, set, peso, meta, sit, p, avaliacoes }) {
  const setFase = (i, patch) => set({ fases: ciclo.fases.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const mg = p.meta_gordura;
  const alvo = mg?.min != null ? (() => {
    const ult = [...avaliacoes].sort((a, b) => String(a.data_avaliacao || a.created_at || "").localeCompare(String(b.data_avaliacao || b.created_at || ""))).pop();
    return pesoAlvo({ peso: ult?.peso, pct: ult?.composicao?.pct_gordura, massaMagra: ult?.composicao?.massa_magra, faixa: [mg.min, mg.max], ritmo: mg.ritmo ?? 0.7 });
  })() : null;
  const basta = alvo ? bastaParaMeta(ciclo, alvo) : null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4 text-[12px] text-gray-400">
        <label>Início<input type="date" className="rc-input mt-1 h-8 w-auto py-0.5" value={ciclo.inicio || ""} onChange={(e) => set({ inicio: e.target.value })} data-testid="haluch-inicio" /></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={!!ciclo.trocar_pela_data} onChange={(e) => set({ trocar_pela_data: e.target.checked })} /> Trocar fase pela data</label>
        <span className="text-gray-500">Base: Haluch, cap. 8.4.2.2 (tabelas 8.4 e 8.5)</span>
      </div>
      {/* linha do tempo */}
      <div className="flex h-9 w-full overflow-hidden" data-testid="haluch-linha">
        {ciclo.fases.map((f, i) => (
          <div key={i} style={{ flex: Number(f.semanas) || 1 }} className={`flex items-center justify-center border-r border-black text-[11.5px] font-semibold ${f.tipo === "low" ? "bg-white/[0.1] text-gray-200" : "bg-rc-blue text-black"} ${sit?.idx === i ? "outline outline-2 -outline-offset-2 outline-white" : ""}`}>
            {f.nome} · {f.semanas} sem{sit?.idx === i && sit.semanaNaFase ? ` · hoje sem. ${sit.semanaNaFase}` : ""}
          </div>
        ))}
      </div>
      {!ciclo.trocar_pela_data && (
        <div className="flex gap-1">{ciclo.fases.map((f, i) => (
          <button key={i} type="button" onClick={() => set({ fase_manual: i })} aria-pressed={Number(ciclo.fase_manual) === i} className={`h-9 px-3 text-[12.5px] font-semibold ${Number(ciclo.fase_manual) === i ? "bg-rc-blue text-black" : "bg-white/[0.05] text-gray-300"}`} data-testid={`fase-btn-${i}`}>{f.nome}</button>
        ))}</div>
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {ciclo.fases.map((f, i) => {
          const m = macrosDaFase(f, meta, peso);
          const fx = FAIXA_HALUCH[f.tipo];
          const pctCampo = (k, rot) => {
            const fora = Number(f[k]) < fx[k][0] || Number(f[k]) > fx[k][1];
            return (
              <label className="block text-[11.5px] text-gray-400">{rot} <span className="text-gray-500">{fx[k][0]}–{fx[k][1]}%</span>
                <input className={`rc-input mt-0.5 h-8 py-0.5 ${fora ? "text-rc-amber" : ""}`} type="number" value={f[k]} onChange={(e) => setFase(i, { [k]: numero(e.target.value) })} data-testid={`fase${i + 1}-${k}`} /></label>
            );
          };
          return (
            <div key={i} className={`border p-3 ${sit?.idx === i ? "border-rc-blue" : "border-[#1A1F26]"}`} data-testid={`fase-${i + 1}`}>
              <div className="flex items-center justify-between"><span className="text-[13.5px] font-semibold text-white">{f.nome} · {f.tipo === "low" ? "low" : "high"} carb</span>
                {sit?.idx === i && <span className="bg-rc-blue px-1.5 text-[10.5px] font-semibold text-black">hoje</span>}</div>
              <label className="mt-2 flex items-center gap-2 text-[12px] text-gray-400">Semanas
                <input className="rc-input h-8 w-16 py-0.5" type="number" min={1} value={f.semanas} onChange={(e) => setFase(i, { semanas: numero(e.target.value) })} />
                <span className="text-gray-500">({f.faixa_semanas[0]}–{f.faixa_semanas[1]})</span></label>
              <div className="mt-2 grid grid-cols-3 gap-1.5">{pctCampo("cho", "CHO")}{pctCampo("ptn", "PTN")}{pctCampo("lip", "LIP")}</div>
              {m && Math.round(m.soma) !== 100 && <p className="mt-1 text-[11.5px] text-rc-coral">Soma {Math.round(m.soma)}% (precisa dar 100%)</p>}
              <label className="mt-2 flex items-center gap-2 text-[12px] text-gray-400">Calorias
                <input className="rc-input h-8 w-28 py-0.5" type="number" placeholder={meta ? `= ${Math.round(meta)}` : ""} value={f.kcal ?? ""} onChange={(e) => setFase(i, { kcal: e.target.value === "" ? null : Number(e.target.value) })} data-testid={`fase${i + 1}-kcal`} /></label>
              {m && (
                <div className="mt-2 text-[12px] text-gray-300">
                  {m.ajustada ? <span className="text-rc-amber">ajustada ({m.ajustada > 0 ? "+" : ""}{m.ajustada} vs meta) · </span> : <span className="text-gray-500">= meta · </span>}
                  {f0(m.kcal)} kcal<br />CHO {f0(m.cho)} g · PTN {f0(m.ptn)} g · LIP {f0(m.lip)} g
                  {m.gkg && <div className="text-gray-500">{f1(m.gkg.cho)} · {f1(m.gkg.ptn)} · {f1(m.gkg.lip)} g/kg</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {basta && <p className={`text-[12.5px] ${basta.basta ? "text-[#3DDC84]" : "text-rc-amber"}`} data-testid="haluch-meta">{basta.texto}</p>}
      {!mg && <p className="text-[12px] text-gray-500">Salve a meta de % de gordura na Antropometria para o app estimar se as semanas planejadas bastam.</p>}
    </div>
  );
}
