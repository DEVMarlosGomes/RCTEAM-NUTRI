// Calculos da prescricao dietetica, nas mesmas formulas do NutriDiet:
// kcal = 4*CHO + 4*PTN + 9*LIP; opcoes "OU" nao entram no total do dia;
// kcal nao proteica/gN = (kcal CHO + kcal LIP) / (PTN / 6,25).

export const nf = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
export const nf0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

export const num = (v) => {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

export const ZERO = { kcal: 0, cho: 0, ptn: 0, lip: 0, fib: 0 };

export const macrosDoItem = (item) => {
  const m = item?._m100;
  const g = num(item?.quantidade_g);
  if (!m || !g) return ZERO;
  const f = g / 100;
  const cho = (m.cho || 0) * f;
  const ptn = (m.ptn || 0) * f;
  const lip = (m.lip || 0) * f;
  return { kcal: cho * 4 + ptn * 4 + lip * 9, cho, ptn, lip, fib: (m.fib || 0) * f };
};

export const somar = (lista) => lista.reduce((acc, m) => ({
  kcal: acc.kcal + m.kcal, cho: acc.cho + m.cho, ptn: acc.ptn + m.ptn, lip: acc.lip + m.lip, fib: acc.fib + m.fib,
}), ZERO);

export const totaisBloco = (bloco) => somar((bloco?.alimentos || []).map(macrosDoItem));
export const totaisDia = (refeicoes) => somar((refeicoes || []).map(totaisBloco));

export function indicadores(t, peso) {
  const p = num(peso);
  const pct = (g, f) => (t.kcal > 0 ? (g * f * 100) / t.kcal : 0);
  const gN = t.ptn / 6.25;
  return {
    pct_cho: pct(t.cho, 4),
    pct_ptn: pct(t.ptn, 4),
    pct_lip: pct(t.lip, 9),
    kcal_kg: p ? t.kcal / p : null,
    cho_gkg: p ? t.cho / p : null,
    ptn_gkg: p ? t.ptn / p : null,
    lip_gkg: p ? t.lip / p : null,
    kcal_nao_ptn_gn: gN > 0 ? (t.cho * 4 + t.lip * 9) / gN : 0,
  };
}

const ADJETIVOS = new Set(["pequeno", "pequena", "médio", "média", "grande", "cheio", "cheia", "raso", "rasa",
  "americano", "fundo", "fino", "fina", "grosso", "grossa", "duplo"]);

const pluralPalavra = (p) => {
  if (p.endsWith("ão")) return `${p.slice(0, -2)}ões`;
  if (/[rz]$/.test(p)) return `${p}es`;
  if (p.endsWith("l")) return `${p.slice(0, -1)}is`;
  if (p.endsWith("s")) return p;
  return `${p}s`;
};

/** "Colher de Sopa" -> "colher de sopa" ou "colheres de sopa", como o NutriDiet mostra. */
export function textoMedida(medida, qtd = 1) {
  const base = String(medida || "").trim().toLowerCase().replace(/^file\b/, "filé");
  if (!base || num(qtd) <= 1) return base;
  const palavras = base.split(/\s+/);
  palavras[0] = pluralPalavra(palavras[0]);
  for (let i = 1; i < palavras.length; i += 1) {
    if (ADJETIVOS.has(palavras[i]) && palavras[i - 1] !== "de") palavras[i] = pluralPalavra(palavras[i]);
  }
  return palavras.join(" ");
}

export const ehGramas = (medida) => !medida || String(medida).toLowerCase() === "gramas";

/** Gramas de 1 unidade da medida escolhida (1 para "Gramas"; null se a medida nao estiver no cadastro). */
export function gramasDaMedida(item) {
  if (ehGramas(item?.medida_nome)) return 1;
  const m = (item?._medidas || []).find((x) => x.nome === item.medida_nome);
  return m ? num(m.gramas) : null;
}

// Medidas mais usadas na prescricao primeiro; "porcao" e generica, fica por ultimo.
const PREFERENCIA_MEDIDA = ["unidade", "fatia", "colher de sopa", "filé", "bife", "pedaço", "colher de arroz",
  "concha", "copo americano", "xícara de chá", "folha", "escumadeira", "pegador", "unidade pequena", "colher de chá"];

/** Medida padrao ao escolher um alimento: a mais usada entre as de porcao plausivel (3 a 400 g). */
export function medidaPadrao(medidas) {
  const plausiveis = (medidas || []).filter((m) => !ehGramas(m.nome) && num(m.gramas) >= 3 && num(m.gramas) <= 400);
  const rank = (m) => {
    const i = PREFERENCIA_MEDIDA.indexOf(String(m.nome).toLowerCase());
    if (i >= 0) return i;
    return String(m.nome).toLowerCase().startsWith("porção") ? 99 : 50;
  };
  return [...plausiveis].sort((a, b) => rank(a) - rank(b))[0] || null;
}

export const novoItem = () => ({ alimento_id: null, nome: "", quantidade: "", medida_nome: "", quantidade_g: "", observacao: "", substitutos: [] });

export const novaRefeicao = (nome = "", horario = "") => ({ nome, horario, observacao: "", alimentos: [novoItem()], opcoes: [] });

/** Macros por 100 g de um item vindo do backend (usa macros_100g; senao deriva da porcao calculada). */
export function m100DoItemSalvo(item) {
  if (item?.macros_100g) {
    const m = item.macros_100g;
    return { kcal: m.kcal || 0, ptn: m.ptn || 0, cho: m.cho || 0, lip: m.lip || 0, fib: m.fib || 0 };
  }
  const g = num(item?.quantidade_g);
  const n = item?.nutrientes;
  if (!n || !g || !item?.alimento_id) return null;
  const f = 100 / g;
  return { kcal: (n.energia_kcal || 0) * f, ptn: (n.proteinas_g || 0) * f, cho: (n.carboidratos_g || 0) * f, lip: (n.lipidios_g || 0) * f, fib: (n.fibras_g || 0) * f };
}

/** Item salvo (enriquecido pelo backend) -> item do editor. */
export const itemDoSalvo = (item) => ({
  alimento_id: item.alimento_id || null,
  nome: item.nome || item.alimento_nome || "",
  alimento_nome: item.alimento_nome || item.nome || "",
  quantidade: item.quantidade ?? "",
  medida_nome: item.medida_nome ?? "Gramas",
  quantidade_g: item.quantidade_g ?? "",
  observacao: item.observacao || "",
  substitutos: item.substitutos || [],
  _m100: m100DoItemSalvo(item),
  _medidas: item.medidas || [],
});

export const blocoDoSalvo = (bloco) => {
  const alimentos = (bloco.alimentos || []).map(itemDoSalvo);
  return { ...bloco, alimentos: alimentos.length ? alimentos : [novoItem()] };
};

/** Item do editor -> payload do backend (linhas vazias sao descartadas). */
export const itemParaSalvar = (item) => ({
  alimento_id: item.alimento_id || null,
  nome: (item.nome || "").trim() || null,
  medida_nome: item.medida_nome || "Gramas",
  quantidade: num(item.quantidade),
  quantidade_g: num(item.quantidade_g),
  observacao: item.observacao || "",
  substituivel: true,
  substitutos: (item.substitutos || []).filter((s) => s.alimento_id).map((s) => ({
    alimento_id: s.alimento_id,
    nome: s.nome || s.alimento_nome,
    medida_nome: s.medida_nome || "Gramas",
    quantidade: num(s.quantidade),
    quantidade_g: num(s.quantidade_g),
  })),
});

export const itensParaSalvar = (alimentos) => (alimentos || []).filter((i) => i.alimento_id || (i.nome || "").trim()).map(itemParaSalvar);

/** Quando a quantidade do alimento muda, os substitutos acompanham na mesma proporcao (como no NutriDiet). */
export function escalarSubstitutos(substitutos, fator) {
  if (!fator || !Number.isFinite(fator) || fator === 1) return substitutos;
  const r = (v) => Math.round(num(v) * fator * 10) / 10;
  return (substitutos || []).map((s) => ({ ...s, quantidade: r(s.quantidade), quantidade_g: r(s.quantidade_g) }));
}

/** Texto curto de quantidade: "2 fatias (50 g)". */
export function textoQuantidade(item) {
  const g = num(item.quantidade_g);
  if (ehGramas(item.medida_nome)) return `${nf.format(g)} g`;
  return `${nf.format(num(item.quantidade))} ${textoMedida(item.medida_nome, item.quantidade)} (${nf.format(g)} g)`;
}

const COPIA_KEY = "rc_dieta_refeicao_copiada";

export function copiarRefeicao(bloco) {
  const limpar = (b) => ({ observacao: b.observacao || "", alimentos: (b.alimentos || []).filter((i) => i.alimento_id || (i.nome || "").trim()) });
  const dados = { ...limpar(bloco), opcoes: (bloco.opcoes || []).map(limpar) };
  try { localStorage.setItem(COPIA_KEY, JSON.stringify(dados)); return true; } catch { return false; }
}

export function refeicaoCopiada() {
  try { return JSON.parse(localStorage.getItem(COPIA_KEY) || "null"); } catch { return null; }
}

export const normalizar = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
