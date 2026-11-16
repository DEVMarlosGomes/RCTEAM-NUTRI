// Estrutura do formulário pré-consulta (5 blocos, 37 perguntas). A fonte é o backend (anamnese_form.py):
// o formulário público e a aba Anamnese leem a mesma lista.
import { api } from "@/lib/evo-api";

let cache = null;

export function carregarEstrutura() {
  if (!cache) {
    cache = api.get("/public/preconsulta/estrutura").then((r) => r.data).catch((e) => { cache = null; throw e; });
  }
  return cache;
}

export const vazio = (v) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

export function visivel(pergunta, respostas) {
  const se = pergunta.se;
  if (!se) return true;
  const valor = respostas[se.campo];
  if ("igual" in se) return valor === se.igual;
  if ("diferente" in se) return valor !== se.diferente;
  return true;
}

export const perguntasVisiveis = (estrutura, respostas) =>
  estrutura.blocos.flatMap((b, i) => b.perguntas.filter((p) => visivel(p, respostas)).map((p) => ({ ...p, bloco: b.key, blocoIndex: i })));

export function textoResposta(pergunta, valor) {
  if (vazio(valor)) return "";
  if (pergunta.tipo === "arquivo") return (valor || []).map((a) => a.nome).join(", ");
  if (Array.isArray(valor)) return valor.join(", ");
  if (pergunta.tipo === "data") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valor));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(valor);
  }
  return String(valor);
}

/** Respostas de todos os blocos num só objeto ({pergunta: valor}). */
export const respostasPlanas = (formulario) =>
  Object.values(formulario || {}).reduce((acc, bloco) => ({ ...acc, ...(bloco || {}) }), {});

/** Abre um anexo do paciente (exame, plano anterior) numa nova aba, com a autenticação da API. */
export async function abrirAnexo(pacienteId, anexoId) {
  const r = await api.get(`/patients/${pacienteId}/anexos/${anexoId}`, { responseType: "blob" });
  const url = window.URL.createObjectURL(r.data);
  window.open(url, "_blank", "noopener");
  setTimeout(() => window.URL.revokeObjectURL(url), 60000);
}

export function idadeAnos(data) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data || "");
  if (!m) return null;
  const hoje = new Date();
  let anos = hoje.getFullYear() - Number(m[1]);
  const mes = hoje.getMonth() + 1;
  if (mes < Number(m[2]) || (mes === Number(m[2]) && hoje.getDate() < Number(m[3]))) anos -= 1;
  return anos >= 0 && anos <= 120 ? anos : null;
}
