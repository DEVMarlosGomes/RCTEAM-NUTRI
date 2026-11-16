// Protocolos de % de gordura da planilha (espelho de backend/protocolos_dobras.py — manter os dois iguais).
// O cálculo é feito no backend; aqui ficam só o nome, a faixa etária e as medidas que cada protocolo usa.
const SETE = ["abdominal", "tricipital", "suprailiaca", "axilar", "subescapular", "peitoral", "coxa"];
const DURNIN = ["bicipital", "tricipital", "suprailiaca", "subescapular"];
const FAULKNER = ["abdominal", "tricipital", "suprailiaca", "subescapular"];
const TRI_SUB = ["tricipital", "subescapular"];

export const PROTOCOLOS_DOBRAS = [
  { id: "durnin", nome: "Durnin e Womersley (1974)", faixa: { M: [17, 72], F: [16, 68] }, dobras: { M: DURNIN, F: DURNIN } },
  { id: "guedes", nome: "Guedes (1985)", faixa: { M: [18, 30], F: [18, 30] }, dobras: { M: ["abdominal", "tricipital", "suprailiaca"], F: ["suprailiaca", "subescapular", "coxa"] } },
  { id: "pollock3", nome: "Jackson, Pollock e Ward 3D (1980)", faixa: { M: [18, 61], F: [18, 55] }, dobras: { M: ["abdominal", "peitoral", "coxa"], F: ["tricipital", "suprailiaca", "coxa"] } },
  { id: "pollock7", nome: "Jackson, Pollock e Ward 7D (1980)", faixa: { M: [18, 61], F: [18, 55] }, dobras: { M: SETE, F: SETE } },
  { id: "petroski", nome: "Petroski (1995)", faixa: { M: [18, 66], F: [18, 66] }, dobras: { M: ["tricipital", "suprailiaca", "subescapular", "panturrilha"], F: ["suprailiaca", "axilar", "coxa", "panturrilha"] } },
  { id: "faulkner", nome: "Faulkner (1968)", faixa: { M: [18, null], F: [18, null] }, dobras: { M: FAULKNER, F: FAULKNER } },
  { id: "weltman", nome: "Weltman e col. (1988) · perímetros", faixa: { M: [20, 68], F: [20, 60] }, dobras: { M: [], F: [] }, perimetros: { M: ["abdomen"], F: ["abdomen"] } },
  { id: "mcardle", nome: "McArdle (1992)", faixa: { M: [9, 16], F: [9, 16] }, dobras: { M: TRI_SUB, F: TRI_SUB } },
  { id: "slaughter", nome: "Slaughter (1988)", faixa: { M: [7, 18], F: [7, 17] }, dobras: { M: TRI_SUB, F: TRI_SUB } },
  { id: "marinha_eua", nome: "Marinha dos Estados Unidos · perímetros", faixa: { M: [null, null], F: [null, null] }, dobras: { M: [], F: [] }, perimetros: { M: ["pescoco", "abdomen"], F: ["pescoco", "cintura", "quadril"] } },
];

const sx = (sexo) => (sexo === "M" ? "M" : "F");
const protocolo = (id) => PROTOCOLOS_DOBRAS.find((p) => p.id === id);

export const dobrasDoProtocolo = (id, sexo) => protocolo(id)?.dobras[sx(sexo)] || [];
export const perimetrosDoProtocolo = (id, sexo) => protocolo(id)?.perimetros?.[sx(sexo)] || [];

/** Aviso (sem bloquear) quando a idade está fora da faixa do protocolo. */
export function avisoIdade(id, sexo, idade) {
  const p = protocolo(id);
  const n = Number(idade);
  if (!p || idade === "" || idade == null || Number.isNaN(n)) return "";
  const [mn, mx] = p.faixa[sx(sexo)];
  if ((mn != null && n < mn) || (mx != null && n > mx)) {
    const faixa = mn != null && mx != null ? `${mn} a ${mx} anos` : `a partir de ${mn} anos`;
    return `Idade (${n} anos) fora da faixa do protocolo ${p.nome.split(" · ")[0]}: ${faixa}. O cálculo é feito mesmo assim.`;
  }
  return "";
}
