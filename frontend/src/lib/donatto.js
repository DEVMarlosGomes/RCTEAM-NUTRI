/**
 * Modelo de avaliação Donatto (item 17 dos ajustes do Rogério), a partir da planilha Donatto CORRIGIDA:
 * todos os protocolos de dobras lado a lado, classificações (Pollock & Wilmore, Lohman, OMS, Bray & Gray),
 * % de gordura alvo → peso ideal e as equações de gasto (IOM/EER, massa muscular, Mifflin com peso ideal).
 * Dobras: chaves do app (peitoral, axilar_media, subescapular, tricipital, bicipital, suprailiaca, abdominal, coxa, panturrilha).
 */
const n = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(String(v).replace(",", "."));
  return Number.isFinite(x) ? x : null;
};
const soma = (d, chaves) => {
  const vals = chaves.map((k) => n(d[k]));
  return vals.every((v) => v != null) ? vals.reduce((a, b) => a + b, 0) : null;
};
const log10 = Math.log10;
const siri = (dc) => (4.95 / dc - 4.5) * 100;

/** Lê as dobras da avaliação aceitando os nomes antigos (triceps, supra_iliaca…). */
export function dobrasDonatto(dobras = {}) {
  const d = dobras || {};
  const pega = (...ks) => ks.map((k) => d[k]).find((v) => v !== undefined && v !== null && v !== "");
  return {
    peitoral: pega("peitoral", "torax", "toracica"),
    axilar_media: pega("axilar_media", "axilar"),
    subescapular: pega("subescapular", "sub_escapular"),
    tricipital: pega("tricipital", "triceps"),
    bicipital: pega("bicipital", "biceps"),
    suprailiaca: pega("suprailiaca", "supra_iliaca", "suprailiaca_media"),
    abdominal: pega("abdominal", "abdomen"),
    coxa: pega("coxa", "coxa_medial"),
    panturrilha: pega("panturrilha", "panturrilha_medial"),
  };
}

const DURNIN = {
  M: [[17, 19, 1.162, 0.063], [20, 29, 1.1631, 0.0632], [30, 39, 1.1422, 0.0544], [40, 49, 1.162, 0.07], [50, 72, 1.1715, 0.0779]],
  F: [[16, 19, 1.1549, 0.0678], [20, 29, 1.1599, 0.0717], [30, 39, 1.1423, 0.0632], [40, 49, 1.1333, 0.0612], [50, 68, 1.1339, 0.0645]],
};
const DURNIN_GERAL = { M: [1.1765, 0.0744], F: [1.1567, 0.0717] };

/**
 * Densidade corporal (ou %G direto, no Faulkner) por protocolo. Retorna lista com o que dá para calcular:
 * { id, nome, dobras: [...], dc, pct }.
 */
export function protocolosDonatto(sexo, idade, dobrasBrutas) {
  const d = dobrasDonatto(dobrasBrutas);
  const id = n(idade) ?? 30;
  const M = sexo === "M";
  const lista = [];
  const add = (pid, nome, dobras, fn, direto = false) => {
    const s = soma(d, dobras);
    if (s == null || s <= 0) { lista.push({ id: pid, nome, dobras, dc: null, pct: null, falta: dobras.filter((k) => n(d[k]) == null) }); return; }
    const v = fn(s);
    lista.push({ id: pid, nome, dobras, dc: direto ? null : v, pct: direto ? v : siri(v), soma: s });
  };
  // Faulkner (mesma fórmula para homens e mulheres): tricipital + subescapular + suprailíaca + abdominal
  add("faulkner", "Faulkner", ["tricipital", "subescapular", "suprailiaca", "abdominal"], (s) => 5.783 + 0.153 * s, true);
  if (M) {
    const p7 = ["peitoral", "axilar_media", "tricipital", "subescapular", "abdominal", "suprailiaca", "coxa"];
    add("pollock7", "Pollock 7D", p7, (s) => 1.112 - 0.00043499 * s + 0.00000055 * s * s - 0.00028826 * id);
    add("guedes", "Guedes", ["tricipital", "suprailiaca", "abdominal"], (s) => 1.1714 - 0.0671 * log10(s));
    add("petroski", "Petroski", ["subescapular", "tricipital", "suprailiaca", "panturrilha"], (s) => 1.10726863 - 0.00081201 * s + 0.00000212 * s * s - 0.00041761 * id);
    add("thorland7", "Thorland 7D", ["tricipital", "subescapular", "axilar_media", "suprailiaca", "abdominal", "coxa", "panturrilha"], (s) => 1.1091 - 0.00052 * s + 0.00000032 * s * s);
    add("thorland3", "Thorland 3D", ["tricipital", "subescapular", "axilar_media"], (s) => 1.1136 - 0.00154 * s + 0.00000516 * s * s);
  } else {
    const p7 = ["peitoral", "axilar_media", "tricipital", "subescapular", "abdominal", "suprailiaca", "coxa"];
    add("pollock7", "Pollock 7D", p7, (s) => 1.097 - 0.00046971 * s + 0.00000056 * s * s - 0.00012828 * id);
    add("pollock3", "Pollock 3D", ["tricipital", "suprailiaca", "coxa"], (s) => 1.0994921 - 0.0009929 * s + 0.0000023 * s * s - 0.0001392 * id);
    add("guedes", "Guedes", ["coxa", "suprailiaca", "subescapular"], (s) => 1.1665 - 0.0706 * log10(s));
    add("petroski", "Petroski", ["axilar_media", "suprailiaca", "coxa", "panturrilha"], (s) => 1.1954713 - 0.07513507 * log10(s) - 0.00041072 * id);
    add("thorland7", "Thorland 7D", ["tricipital", "subescapular", "axilar_media", "suprailiaca", "abdominal", "coxa", "panturrilha"], (s) => 1.1046 - 0.00059 * s + 0.0000006 * s * s);
    add("thorland3", "Thorland 3D", ["tricipital", "subescapular", "suprailiaca"], (s) => 1.0987 - 0.00122 * s + 0.00000263 * s * s);
  }
  // Durnin & Womersley pela faixa de idade (e a equação geral)
  const dw = ["tricipital", "bicipital", "subescapular", "suprailiaca"];
  const faixa = DURNIN[M ? "M" : "F"].find(([a, b]) => id >= a && id <= b);
  if (faixa) add("durnin", `Durnin & Womersley (${faixa[0]} a ${faixa[1]} anos)`, dw, (s) => faixa[2] - faixa[3] * log10(s));
  const [ga, gb] = DURNIN_GERAL[M ? "M" : "F"];
  add("durnin_geral", `Durnin & Womersley (${M ? "17 a 72" : "16 a 68"} anos)`, dw, (s) => ga - gb * log10(s));
  return lista;
}

/** Massa gorda e magra a partir do % de gordura. */
export const fracionar = (peso, pct) => {
  const p = n(peso); const g = n(pct);
  if (p == null || g == null) return { mg: null, mm: null };
  const mg = (g / 100) * p;
  return { mg, mm: p - mg };
};

/** % de gordura alvo → peso ideal (massa magra mantida) e peso em excesso. */
export function pesoIdeal(peso, pctAtual, pctAlvo) {
  const { mm } = fracionar(peso, pctAtual);
  const alvo = n(pctAlvo);
  if (mm == null || alvo == null || alvo >= 100) return null;
  const pi = mm / (1 - alvo / 100);
  return { massa_magra: mm, massa_gorda: n(peso) - mm, peso_ideal: pi, excesso: n(peso) - pi };
}

// ── Classificações ─────────────────────────────────────────────────────────
// Pollock & Wilmore corrigida (ajuste gor1): ordem Excelente, Bom, Acima da média, Média, Abaixo da média, Ruim,
// Muito ruim (a planilha tinha "Acima"/"Abaixo" invertidos); homens 18–25 "Bom" cobre até 11% (buraco 10–12%);
// homens 26–35 "Ruim" 25–27% (planilha dizia 20–24%, sobreposto — A CONFIRMAR); acima de 65 usa 56–65.
const PW = {
  F: { idades: [[18, 25], [26, 35], [36, 45], [46, 55], [56, 65]], niveis: [
    ["Excelente", [[13, 16], [14, 16], [16, 19], [17, 21], [18, 22]]],
    ["Bom", [[17, 19], [18, 20], [20, 23], [23, 25], [24, 26]]],
    ["Acima da média", [[20, 22], [21, 23], [24, 26], [26, 28], [27, 29]]],
    ["Média", [[23, 25], [24, 25], [27, 29], [29, 31], [30, 32]]],
    ["Abaixo da média", [[26, 28], [27, 29], [30, 32], [32, 34], [33, 35]]],
    ["Ruim", [[29, 31], [31, 33], [33, 36], [35, 38], [36, 38]]],
    ["Muito ruim", [[33, 43], [36, 49], [38, 48], [39, 50], [39, 49]]],
  ] },
  M: { idades: [[18, 25], [26, 35], [36, 45], [46, 55], [56, 65]], niveis: [
    ["Excelente", [[4, 6], [8, 11], [10, 14], [12, 16], [13, 18]]],
    ["Bom", [[8, 11], [12, 15], [16, 18], [18, 20], [20, 21]]],
    ["Acima da média", [[12, 13], [16, 18], [19, 21], [21, 23], [22, 23]]],
    ["Média", [[14, 16], [18, 20], [21, 23], [24, 25], [24, 25]]],
    ["Abaixo da média", [[17, 20], [22, 24], [24, 25], [26, 27], [26, 27]]],
    ["Ruim", [[21, 25], [25, 27], [27, 29], [28, 30], [28, 30]]],
    ["Muito ruim", [[26, 36], [28, 36], [30, 39], [32, 38], [32, 38]]],
  ] },
};
const LOHMAN = {
  M: [["Excessivamente baixa", 6], ["Baixa", 10], ["Adequada", 20], ["Moderadamente alta", 25], ["Alta", 31], ["Excessivamente alta", Infinity]],
  F: [["Excessivamente baixa", 12], ["Baixa", 15], ["Adequada", 25], ["Moderadamente alta", 30], ["Alta", 36], ["Excessivamente alta", Infinity]],
};

/** Classificação do % de gordura: Lohman (7 a 17 anos) ou Pollock & Wilmore (18 a 65; acima usa 56–65). */
export function classificarGordura(sexo, idade, pct) {
  const g = n(pct); const id = n(idade);
  if (g == null || id == null) return null;
  const s = sexo === "M" ? "M" : "F";
  if (id < 18) {
    const nivel = LOHMAN[s].find(([, max]) => g <= max);
    return { tabela: "Lohman, 1987", nivel: nivel[0] };
  }
  const t = PW[s];
  let col = t.idades.findIndex(([a, b]) => id >= a && id <= b);
  if (col < 0) col = id > 65 ? 4 : 0;
  // faixas da tabela têm buracos (ex.: 16→17); fica no nível cuja faixa contém o valor ou o mais próximo acima
  let escolhido = t.niveis[t.niveis.length - 1][0];
  for (const [nome, faixas] of t.niveis) {
    const [, max] = faixas[col];
    if (g <= max + 0.999) { escolhido = nome; break; }
  }
  if (g < t.niveis[0][1][col][0]) escolhido = "Excelente";
  return { tabela: "Pollock & Wilmore, 1993", nivel: escolhido };
}

const OMS = [[16, "Magreza grau III"], [17, "Magreza grau II"], [18.5, "Magreza grau I"], [25, "Eutrofia"], [30, "Pré-obeso"], [35, "Obesidade grau I"], [40, "Obesidade grau II"], [Infinity, "Obesidade grau III"]];
export function classificarImc(imc) {
  const v = n(imc);
  if (v == null) return null;
  return OMS.find(([lim]) => v < lim)[1];
}

const BRAY = {
  M: [[29, 0.83, 0.88, 0.94], [39, 0.84, 0.91, 0.96], [49, 0.88, 0.95, 1.0], [59, 0.9, 0.96, 1.02], [Infinity, 0.91, 0.98, 1.03]],
  F: [[29, 0.71, 0.77, 0.82], [39, 0.72, 0.78, 0.84], [49, 0.73, 0.79, 0.87], [59, 0.74, 0.81, 0.88], [Infinity, 0.76, 0.83, 0.9]],
};
/** Relação cintura ÷ quadril (Bray & Gray, 1988). */
export function classificarRcq(sexo, idade, cintura, quadril) {
  const c = n(cintura); const q = n(quadril);
  if (!c || !q) return null;
  const rcq = c / q;
  const [, baixo, moderado, alto] = BRAY[sexo === "M" ? "M" : "F"].find(([max]) => (n(idade) ?? 30) <= max);
  const risco = rcq < baixo ? "Baixo" : rcq <= moderado ? "Moderado" : rcq <= alto ? "Alto" : "Muito alto";
  return { rcq, risco };
}

// ── Gasto energético ───────────────────────────────────────────────────────
/**
 * Equações do modelo Donatto. FA na conta inteira; exercício somado depois.
 * IOM/EER (2005) com o peso atual: H 662 − 9,53·idade + FA·(15,91·peso + 539,6·altura);
 * M 354 − 6,91·idade + FA·(9,36·peso + 726·altura).
 * Massa muscular: (370 + 21,6·MM) × FA. Mifflin-St Jeor (1990) com o peso ideal × FA.
 */
export function equacoesDonatto({ sexo, idade, peso, altura_m, massa_magra, peso_ideal, fa = 1.2, exercicio = 0 }) {
  const id = n(idade); const p = n(peso); const h = n(altura_m); const mm = n(massa_magra); const pi = n(peso_ideal);
  const f = n(fa) || 1.2; const ex = n(exercicio) || 0;
  const M = sexo === "M";
  const lista = [];
  if (id != null && p && h) {
    const kcal = M ? 662 - 9.53 * id + f * (15.91 * p + 539.6 * h) : 354 - 6.91 * id + f * (9.36 * p + 726 * h);
    lista.push({ id: "iom", nome: "IOM / EER (2005)", base: "peso atual", kcal: kcal + ex, kcal_kg: (kcal + ex) / p });
  }
  if (mm) {
    const kcal = (370 + 21.6 * mm) * f;
    lista.push({ id: "massa_muscular", nome: "Massa muscular (370 + 21,6 × MM)", base: "massa magra", kcal: kcal + ex, kcal_kg: (kcal + ex) / p });
  }
  if (pi && h && id != null) {
    const tmb = 9.99 * pi + 6.25 * h * 100 - 4.92 * id + (M ? 5 : -161);
    lista.push({ id: "mifflin_pi", nome: "Mifflin-St Jeor (1990) com peso ideal", base: "peso ideal", tmb, kcal: tmb * f + ex, kcal_kg: (tmb * f + ex) / pi });
  }
  return lista;
}

/** Ajuste por prazo: gordura em excesso × 7.700 kcal ÷ dias. */
export function ajustePorPrazo(excessoKg, dias) {
  const e = n(excessoKg); const d = n(dias);
  if (e == null || !d) return null;
  return (e * 7700) / d;
}
