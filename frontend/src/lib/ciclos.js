/**
 * Ciclos de carboidrato (ajustes cid1 e cic1 do Rogério). Fica em patients.ciclo_carbo.
 *
 * cid1 · "nivel": 3 tipos de dia (alto / médio / baixo) com CHO e PTN em g/kg; gordura "completa" as calorias
 *        (todos os dias na meta) ou "fixa" em g/kg (só o carboidrato muda as calorias do dia).
 *        Unidade "dia" (cada dia da semana tem um tipo) ou "semana" (sequência de semanas, troca pela data).
 * cic1 · "haluch": 4 fases low/high carb de várias semanas (Haluch, cap. 8.4.2.2, tabelas 8.4 e 8.5), % de CHO/PTN/LIP
 *        sobre as calorias da fase (= meta, ou ajustadas por fase).
 */
const n = (v) => (v === "" || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
export const DIAS = [["seg", "Seg"], ["ter", "Ter"], ["qua", "Qua"], ["qui", "Qui"], ["sex", "Sex"], ["sab", "Sáb"], ["dom", "Dom"]];
export const NIVEIS = [["alto", "Carbo alto"], ["medio", "Carbo médio"], ["baixo", "Carbo baixo"]];
export const ROTULO_NIVEL = Object.fromEntries(NIVEIS);

/** Padrões do caderno do Rogério (contas conferidas: batem com o caderno). */
export const PADROES_NIVEL = {
  hipo_inicial: { nome: "Hipocalórica · semanas iniciais (manter)", gordura_modo: "completa",
    niveis: { alto: { cho: 3, ptn: 3, lip: 0.8 }, medio: { cho: 2, ptn: 3.5, lip: 1.02 }, baixo: { cho: 1, ptn: 3.5, lip: 1.47 } } },
  hipo_final: { nome: "Hipocalórica · semanas finais (reduzir)", gordura_modo: "fixa",
    niveis: { alto: { cho: 3, ptn: 3, lip: 0.8 }, medio: { cho: 2, ptn: 3, lip: 0.8 }, baixo: { cho: 1, ptn: 3, lip: 0.8 } } },
  hiper: { nome: "Hipercalórica (manter calorias nos dias de carbo mais baixo)", gordura_modo: "completa",
    niveis: { alto: { cho: 5, ptn: 2.5, lip: 1.52 }, medio: { cho: 4, ptn: 3.5, lip: 1.52 }, baixo: { cho: 3, ptn: 3.5, lip: 1.97 } } },
};

/** Faixas e padrões do Haluch (livro, tabelas 8.4 e 8.5). */
export const FAIXA_HALUCH = { low: { cho: [10, 45], ptn: [25, 45], lip: [20, 35] }, high: { cho: [30, 60], ptn: [20, 40], lip: [15, 30] } };
export const PADRAO_HALUCH = [
  { nome: "Fase 1", tipo: "low", semanas: 8, faixa_semanas: [6, 10], cho: 32, ptn: 38, lip: 30 },
  { nome: "Fase 2", tipo: "high", semanas: 3, faixa_semanas: [2, 4], cho: 57, ptn: 28, lip: 15 },
  { nome: "Fase 3", tipo: "low", semanas: 3, faixa_semanas: [2, 4], cho: 30, ptn: 45, lip: 25 },
  { nome: "Fase 4", tipo: "high", semanas: 3, faixa_semanas: [2, 4], cho: 53, ptn: 29, lip: 18 },
];

export function cicloNivelPadrao(padrao = "hipo_inicial") {
  const p = PADROES_NIVEL[padrao];
  return { tipo: "nivel", unidade: "dia", padrao, gordura_modo: p.gordura_modo, niveis: JSON.parse(JSON.stringify(p.niveis)),
    semana: { seg: "alto", ter: "medio", qua: "alto", qui: "medio", sex: "alto", sab: "baixo", dom: "baixo" },
    sequencia: ["alto", "medio", "baixo"], inicio: hojeISO() };
}
export function cicloHaluchPadrao() {
  return { tipo: "haluch", inicio: hojeISO(), trocar_pela_data: true, fase_manual: 0, fases: PADRAO_HALUCH.map((f) => ({ ...f, kcal: null })) };
}

export function hojeISO(d = new Date()) {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}
const dataDe = (iso) => new Date(`${String(iso).slice(0, 10)}T12:00:00`);
const semanasEntre = (a, b) => Math.floor((dataDe(b) - dataDe(a)) / (7 * 86400000));
const somarDias = (iso, dias) => hojeISO(new Date(dataDe(iso).getTime() + dias * 86400000));

/** g, kcal, g/kg e % de cada macro de um tipo de dia (cid1). */
export function macrosDoNivel(nivel, peso, metaKcal, gorduraModo) {
  const p = n(peso);
  if (!p || !nivel) return null;
  const cho = n(nivel.cho) * p;
  const ptn = n(nivel.ptn) * p;
  let lip; let aviso = null; let erro = null;
  if (gorduraModo === "completa") {
    const meta = n(metaKcal);
    if (!meta) return { erro: "Defina as calorias da dieta no Gasto Energético." };
    lip = (meta - cho * 4 - ptn * 4) / 9;
    if (lip < 0) { erro = `CHO + PTN passam da meta (${Math.round(cho * 4 + ptn * 4)} kcal > ${Math.round(meta)} kcal). Diminua o carboidrato ou a proteína.`; lip = 0; }
  } else {
    lip = n(nivel.lip) * p;
  }
  const lipGkg = lip / p;
  if (!erro && lipGkg < 0.5) aviso = `Gordura muito baixa: ${lipGkg.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} g/kg. Sugestão: reduza CHO ou PTN para a gordura ficar em pelo menos 0,5 g/kg.`;
  const kcal = cho * 4 + ptn * 4 + lip * 9;
  return { cho, ptn, lip, kcal, gkg: { cho: n(nivel.cho), ptn: n(nivel.ptn), lip: lipGkg },
    pct: { cho: (cho * 400) / kcal, ptn: (ptn * 400) / kcal, lip: (lip * 900) / kcal }, aviso, erro };
}

/** Macros de uma fase do Haluch (cic1): % sobre as calorias da fase (= meta, salvo ajuste). */
export function macrosDaFase(fase, metaKcal, peso) {
  const kcal = n(fase.kcal) || n(metaKcal);
  if (!kcal) return null;
  const g = { cho: (kcal * n(fase.cho)) / 400, ptn: (kcal * n(fase.ptn)) / 400, lip: (kcal * n(fase.lip)) / 900 };
  const soma = n(fase.cho) + n(fase.ptn) + n(fase.lip);
  const fora = ["cho", "ptn", "lip"].filter((k) => { const [a, b] = FAIXA_HALUCH[fase.tipo][k]; return n(fase[k]) < a || n(fase[k]) > b; });
  return { kcal, ...g, ajustada: n(fase.kcal) && n(metaKcal) ? Math.round(n(fase.kcal) - n(metaKcal)) : null,
    gkg: peso ? { cho: g.cho / peso, ptn: g.ptn / peso, lip: g.lip / peso } : null, soma, fora };
}

/** Onde o paciente está hoje no ciclo: fase/semana (Haluch e cid1 por semana) ou tipo do dia (cid1 por dia). */
export function situacaoDoCiclo(ciclo, hoje = hojeISO()) {
  if (!ciclo) return null;
  if (ciclo.tipo === "haluch") {
    const fases = ciclo.fases || [];
    const total = fases.reduce((a, f) => a + (n(f.semanas) || 0), 0);
    let idx = n(ciclo.fase_manual) || 0;
    let semanaNaFase = null; let fimFase = null;
    if (ciclo.trocar_pela_data && ciclo.inicio) {
      const s = semanasEntre(ciclo.inicio, hoje);
      if (s < 0) return { antesDoInicio: true, idx: 0, fase: fases[0], inicio: ciclo.inicio, total };
      let acc = 0; idx = fases.length - 1;
      for (let i = 0; i < fases.length; i += 1) { if (s < acc + n(fases[i].semanas)) { idx = i; break; } acc += n(fases[i].semanas); }
      if (s >= total) return { terminou: true, idx: fases.length - 1, fase: fases[fases.length - 1], total };
      const inicioFase = fases.slice(0, idx).reduce((a, f) => a + n(f.semanas), 0);
      semanaNaFase = s - inicioFase + 1;
      fimFase = somarDias(ciclo.inicio, (inicioFase + n(fases[idx].semanas)) * 7);
    }
    return { idx, fase: fases[idx], semanaNaFase, semanasFase: n(fases[idx]?.semanas), semanaTotal: ciclo.inicio ? semanasEntre(ciclo.inicio, hoje) + 1 : null, total,
      proximaTroca: fimFase, proxima: fases[idx + 1] || null, chave: `fase${idx + 1}` };
  }
  if (ciclo.tipo === "nivel") {
    if (ciclo.unidade === "semana") {
      const seq = ciclo.sequencia?.length ? ciclo.sequencia : ["alto", "medio", "baixo"];
      const s = Math.max(0, semanasEntre(ciclo.inicio || hoje, hoje));
      const nivel = seq[s % seq.length];
      return { nivel, chave: nivel, semana: s + 1, posicao: (s % seq.length) + 1, tamanho: seq.length,
        proximaTroca: somarDias(ciclo.inicio || hoje, (s + 1) * 7), proximo: seq[(s + 1) % seq.length] };
    }
    const dow = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"][dataDe(hoje).getDay()];
    const nivel = (ciclo.semana || {})[dow] || "medio";
    return { nivel, chave: nivel, dia: dow };
  }
  return null;
}

/** Média de kcal da semana (cid1 por dia). */
export function mediaSemana(ciclo, peso, metaKcal) {
  const vals = DIAS.map(([k]) => macrosDoNivel(ciclo.niveis[(ciclo.semana || {})[k] || "medio"], peso, metaKcal, ciclo.gordura_modo)?.kcal).filter((v) => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

/** Linha do tempo (datas de início/fim de cada fase) para gráficos e avisos. */
export function linhaDoTempo(ciclo) {
  if (!ciclo?.inicio) return [];
  if (ciclo.tipo === "haluch") {
    let acc = 0;
    return (ciclo.fases || []).map((f, i) => {
      const ini = somarDias(ciclo.inicio, acc * 7); acc += n(f.semanas) || 0;
      return { chave: `fase${i + 1}`, nome: `${f.nome} · ${f.tipo === "low" ? "low" : "high"} carb`, tipo: f.tipo, inicio: ini, fim: somarDias(ciclo.inicio, acc * 7) };
    });
  }
  return [];
}

/** Quantas semanas o plano Haluch cobre × semanas estimadas para chegar à meta de % de gordura. */
export function bastaParaMeta(ciclo, metaGordura) {
  if (ciclo?.tipo !== "haluch" || !metaGordura?.semanas) return null;
  const total = (ciclo.fases || []).reduce((a, f) => a + (n(f.semanas) || 0), 0);
  const [a, b] = metaGordura.semanas;
  return { total, a, b, basta: total >= b, texto: total >= b ? `As ${total} semanas do ciclo cobrem o prazo estimado (${a}–${b} semanas).`
    : total >= a ? `As ${total} semanas cobrem o prazo mínimo (${a}) mas não o máximo (${b} semanas).`
      : `As ${total} semanas do ciclo não bastam: a meta pede ${a}–${b} semanas no ritmo escolhido.` };
}
