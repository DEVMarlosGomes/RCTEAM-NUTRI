/**
 * Classificação e meta de % de gordura (ajuste gor1 do Rogério).
 * Atleta → tabela Off-season / Cutting (com ou sem esteroides); não atleta 18–65 → Pollock & Wilmore (1993);
 * 7–17 anos → Lohman (1987). Peso-alvo mantendo a massa magra = MM ÷ (1 − % alvo).
 */
import { classificarGordura, classificarImc, classificarRcq } from "./donatto";

const n = (v) => (v === "" || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

/** Tabela Off/Cutting do Rogério (foto anexada ao item). */
export const OFF_CUTTING = {
  M: { sem: { off: [12, 14], cutting: [8, 10] }, com: { off: [10, 12], cutting: [6, 8] } },
  F: { sem: { off: [16, 20], cutting: [12, 14] }, com: { off: [12, 16], cutting: [8, 11] } },
};

/** Faixa "Bom" de Pollock & Wilmore (meta padrão do não atleta), por sexo e idade. */
const PW_BOM = {
  M: [[25, [8, 11]], [35, [12, 15]], [45, [16, 18]], [55, [18, 20]], [Infinity, [20, 21]]],
  F: [[25, [17, 19]], [35, [18, 20]], [45, [20, 23]], [55, [23, 25]], [Infinity, [24, 26]]],
};
const LOHMAN_ADEQUADA = { M: [10, 20], F: [15, 25] };

export const FASES = { off: "Off-season", cutting: "Cutting" };

/** Qual tabela vale para o paciente e a faixa-alvo padrão. */
export function referenciaGordura({ sexo, idade, atleta, fase, esteroides }) {
  const s = sexo === "M" ? "M" : sexo === "F" ? "F" : null;
  const id = n(idade);
  if (!s) return null;
  if (atleta && fase && OFF_CUTTING[s]) {
    const faixa = OFF_CUTTING[s][esteroides ? "com" : "sem"][fase];
    return { tabela: `Atleta · ${FASES[fase]} · ${esteroides ? "com" : "sem"} esteroides`, faixa, atleta: true };
  }
  if (id != null && id < 18) return { tabela: "Lohman, 1987 (7 a 17 anos)", faixa: LOHMAN_ADEQUADA[s] };
  const faixa = PW_BOM[s].find(([max]) => (id ?? 30) <= max)[1];
  return { tabela: "Pollock & Wilmore, 1993 · faixa “Bom”", faixa };
}

/** Classe do % atual. Atleta: abaixo / dentro / acima da faixa da fase. */
export function classeGordura({ sexo, idade, atleta, fase, esteroides, pct }) {
  const g = n(pct);
  if (g == null) return null;
  const ref = referenciaGordura({ sexo, idade, atleta, fase, esteroides });
  if (ref?.atleta) {
    const [a, b] = ref.faixa;
    return { nivel: g < a ? "Abaixo da faixa" : g <= b ? "Na faixa" : "Acima da faixa", tabela: ref.tabela };
  }
  return classificarGordura(sexo, idade, g);
}

/** Peso-alvo mantendo a massa magra, gordura a perder e prazo pelo ritmo semanal (% do peso). */
export function pesoAlvo({ peso, pct, massaMagra, faixa, ritmo = 0.7 }) {
  const p = n(peso);
  const mm = n(massaMagra) ?? (p != null && n(pct) != null ? p * (1 - n(pct) / 100) : null);
  if (mm == null || !faixa) return null;
  const [baixo, alto] = faixa.map(Number);
  const pesoMin = mm / (1 - baixo / 100);
  const pesoMax = mm / (1 - alto / 100);
  const perderMin = p != null ? p - pesoMax : null;
  const perderMax = p != null ? p - pesoMin : null;
  const porSemana = p != null && n(ritmo) ? (p * n(ritmo)) / 100 : null;
  const semanas = porSemana && perderMin != null && perderMin > 0 ? [Math.ceil(perderMin / porSemana), Math.ceil(perderMax / porSemana)] : null;
  return { massaMagra: mm, pesoMin, pesoMax, perderMin, perderMax, porSemana, semanas };
}

/** Selos da avaliação: % gordura, IMC (OMS) e cintura ÷ quadril (Bray & Gray). */
export function selosAvaliacao({ sexo, idade, atleta, fase, esteroides, avaliacao }) {
  const c = avaliacao?.composicao || {};
  const per = avaliacao?.perimetria || {};
  const imc = n(c.imc) ?? (n(avaliacao?.peso) && n(avaliacao?.altura) ? n(avaliacao.peso) / (n(avaliacao.altura) / 100) ** 2 : null);
  const rcq = classificarRcq(sexo, idade, per.cintura, per.quadril);
  return {
    gordura: classeGordura({ sexo, idade, atleta, fase, esteroides, pct: c.pct_gordura }),
    imc: imc != null ? { valor: imc, nivel: classificarImc(imc) } : null,
    rcq,
  };
}

/** Fase sugere o objetivo da Previsão de Macros. */
export const objetivoDaFase = (fase) => (fase === "cutting" ? "reducao" : fase === "off" ? "ganho" : null);
