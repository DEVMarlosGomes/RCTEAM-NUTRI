// Critérios de cor das dobras cutâneas (doc "Critérios de cor das dobras cutâneas", 02/11/2026).
// Não atleta: compara com a avaliação anterior. Atleta: compara com faixas por dobra e sexo.

export const CORES = {
  vermelho: "#F87171",
  branco: "#FFFFFF",
  verde: "#22C55E",
  cinza: "#A3ADB8",
};

export const COR_NOME_PROTOCOLO = "#4DA3FF";

// [mínimo, máximo] em mm. Mínimo = máximo Pré-contest; máximo = máximo Off-season.
// O total feminino fica em 86 mm (tabela de origem), embora a soma dos máximos dê 90.
export const FAIXAS_ATLETA = {
  M: { tricipital: [3, 6], peitoral: [3, 6], axilar: [4, 8], subescapular: [8, 12], abdominal: [5, 12], suprailiaca: [4, 10], coxa: [5, 10], total: [32, 64] },
  F: { tricipital: [10, 14], peitoral: [3, 6], axilar: [7, 10], subescapular: [9, 14], abdominal: [6, 14], suprailiaca: [6, 12], coxa: [14, 20], total: [55, 86] },
};

// Arredonda para 1 casa decimal de forma simétrica (−0,55 vira −0,6, não −0,5).
const arred1 = (n) => Math.sign(n) * Math.round(Math.abs(n) * 10 + 1e-9) / 10;

/**
 * Nome da cor do valor, ou null quando não recebe cor.
 * @param {object} p
 * @param {boolean} p.atleta
 * @param {"M"|"F"|string} p.sexo
 * @param {string} p.chave  chave da dobra (ex.: "tricipital") ou "total"
 * @param {number|null} p.valor
 * @param {number|null} p.anterior  valor da avaliação anterior (só não atleta)
 */
export function corDobra({ atleta, sexo, chave, valor, anterior }) {
  if (valor == null || Number.isNaN(valor)) return null;
  if (atleta) {
    const faixa = FAIXAS_ATLETA[sexo]?.[chave];
    if (!faixa) return null;
    if (valor > faixa[1]) return "vermelho";
    if (valor < faixa[0]) return "verde";
    return "branco";
  }
  if (anterior == null || Number.isNaN(anterior)) return "cinza";
  const variacao = arred1(valor - anterior);
  if (variacao > 0.5) return "vermelho";
  if (variacao < -0.5) return "verde";
  return "branco";
}

export const LEGENDA = {
  naoAtleta: [
    ["vermelho", "aumentou"],
    ["branco", "igual (até 0,5 mm)"],
    ["verde", "diminuiu"],
    ["cinza", "1ª avaliação"],
  ],
  atleta: [
    ["vermelho", "acima da faixa"],
    ["branco", "dentro da faixa"],
    ["verde", "abaixo da faixa (perfil atleta)"],
  ],
};
