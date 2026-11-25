import { createContext, useCallback, useEffect, useState } from "react";
import { api } from "@/lib/evo-api";
import { ehGramas, num, rankMedida } from "./calculos";

/**
 * Grupos de substituição (itens 9 a 12 dos ajustes): cada grupo troca por um critério (kcal ou macro principal),
 * tem porção de referência, opções padrão com medida caseira e tolerância (±10%).
 */
export const CRITERIOS = [["kcal", "Calorias (kcal)"], ["cho", "Carboidrato (CHO)"], ["ptn", "Proteína (PTN)"], ["lip", "Lipídio (LIP)"]];
export const ROTULO_CRITERIO = { kcal: "kcal", cho: "g CHO", ptn: "g PTN", lip: "g LIP" };

export const GruposContext = createContext([]);

let cache = null;
export function useGruposSubstituicao() {
  const [grupos, setGrupos] = useState(cache || []);
  const recarregar = useCallback(async () => {
    try {
      const { data } = await api.get("/dieta/grupos-substituicao");
      cache = data || [];
      setGrupos(cache);
    } catch { /* sem grupos: equivalentes automáticos ficam desligados */ }
    return cache || [];
  }, []);
  useEffect(() => { if (!cache) recarregar(); }, [recarregar]);
  const salvar = useCallback(async (lista) => {
    const { data } = await api.put("/dieta/grupos-substituicao", { grupos: lista });
    cache = data || [];
    setGrupos(cache);
    return cache;
  }, []);
  const restaurar = useCallback(async () => {
    const { data } = await api.post("/dieta/grupos-substituicao/restaurar");
    cache = data || [];
    setGrupos(cache);
    return cache;
  }, []);
  return { grupos, recarregar, salvar, restaurar };
}

/** Quantidade do critério em `gramas` do alimento (kcal pela regra 4/4/9, como o resto do editor). */
export function valorCriterio(m100, gramas, criterio) {
  if (!m100) return 0;
  const f = num(gramas) / 100;
  if (criterio === "kcal") return (num(m100.cho) * 4 + num(m100.ptn) * 4 + num(m100.lip) * 9) * f;
  return num(m100[criterio]) * f;
}

/** Arredonda para a medida caseira (meias unidades, erro até 5%) ou para 5 g (1 g abaixo de 20 g). */
export function arredondarPorcao(gramas, medidas, preferida) {
  const g = num(gramas);
  if (g <= 0) return null;
  // a medida preferida do grupo vem primeiro; depois as mais usadas na prescrição (unidade, fatia, colher de sopa…)
  const caseiras = (medidas || []).filter((m) => !ehGramas(m.nome) && num(m.gramas) >= 3)
    .sort((a, b) => (b.nome === preferida) - (a.nome === preferida) || rankMedida(a) - rankMedida(b));
  let melhor = null;
  caseiras.some((m) => {
    const q = Math.round((g / num(m.gramas)) * 2) / 2;
    if (q < 0.5 || q > 6) return false;
    if (g > 15 && /colher(es)? de (chá|café)/i.test(m.nome)) return false; // colher pequena só para porções pequenas
    const erro = Math.abs(q * num(m.gramas) - g) / g;
    if (erro > 0.06) return false;
    melhor = { medida_nome: m.nome, quantidade: q, quantidade_g: Math.round(q * num(m.gramas) * 10) / 10 };
    return true;
  });
  if (melhor) return melhor;
  const r = g >= 20 ? Math.max(5, Math.round(g / 5) * 5) : Math.max(1, Math.round(g));
  return { medida_nome: "Gramas", quantidade: r, quantidade_g: r };
}

export const grupoPorId = (grupos, id) => (grupos || []).find((g) => g.id === id) || null;

/** Grupo de um alimento pelo cadastro do grupo (referência ou opção); `pista` é o grupo que o backend sugeriu. */
export function grupoDoItem(grupos, item, pista) {
  const id = String(item?.alimento_id || "");
  if (!id) return null;
  const direto = (grupos || []).find((g) => String(g.referencia?.alimento_id) === id || (g.opcoes || []).some((o) => String(o.alimento_id) === id));
  return direto || grupoPorId(grupos, pista || item?._grupo) || null;
}

/** Todas as opções do grupo (referência + opções) com os dados para calcular. */
export function opcoesDoGrupo(grupo) {
  if (!grupo) return [];
  const lista = [...(grupo.referencia ? [grupo.referencia] : []), ...(grupo.opcoes || [])];
  const vistos = new Set();
  return lista.filter((o) => o?.alimento_id && o.macros_100g && !vistos.has(String(o.alimento_id)) && vistos.add(String(o.alimento_id)));
}

/** Porção equivalente de uma opção para o mesmo valor do critério; desvio em % depois de arredondar. */
export function porcaoEquivalente(grupo, opcao, alvo) {
  const porGrama = valorCriterio(opcao.macros_100g, 1, grupo.criterio);
  if (!porGrama || !alvo) return null;
  const p = arredondarPorcao(alvo / porGrama, opcao.medidas, opcao.medida_nome);
  if (!p) return null;
  const desvio = ((valorCriterio(opcao.macros_100g, p.quantidade_g, grupo.criterio) - alvo) / alvo) * 100;
  return { ...p, desvio_pct: Math.round(desvio * 10) / 10, fora: Math.abs(desvio) > num(grupo.tolerancia_pct || 10) };
}

/** "OU" automáticos: as outras opções do grupo na porção equivalente ao item. */
export function substitutosDoGrupo(grupo, item, limite = 6) {
  if (!grupo || !item?._m100) return [];
  const alvo = valorCriterio(item._m100, item.quantidade_g, grupo.criterio);
  if (!alvo) return [];
  return opcoesDoGrupo(grupo)
    .filter((o) => String(o.alimento_id) !== String(item.alimento_id))
    .slice(0, limite)
    .map((o) => {
      const p = porcaoEquivalente(grupo, o, alvo);
      return p && { alimento_id: o.alimento_id, nome: o.nome, medida_nome: p.medida_nome, quantidade: p.quantidade, quantidade_g: p.quantidade_g, desvio_pct: p.desvio_pct, automatico: true };
    })
    .filter(Boolean);
}

/** Porção de referência do grupo como item do editor (para montar refeição por porções). */
export function itemDaReferencia(grupo, porcoes = 1) {
  const ref = grupo?.referencia;
  if (!ref?.macros_100g) return null;
  const p = arredondarPorcao(num(ref.quantidade_g) * porcoes, ref.medidas, ref.medida_nome) || { medida_nome: "Gramas", quantidade: ref.quantidade_g, quantidade_g: ref.quantidade_g };
  return {
    alimento_id: ref.alimento_id, nome: ref.nome, alimento_nome: ref.nome, _m100: ref.macros_100g, _medidas: ref.medidas || [],
    _grupo: grupo.id, observacao: "", ajustavel: false, ...p,
  };
}

/** Macros de 1 porção de referência do grupo. */
export function macrosDaPorcao(grupo) {
  const ref = grupo?.referencia;
  if (!ref?.macros_100g) return { cho: 0, ptn: 0, lip: 0, kcal: 0 };
  const f = num(ref.quantidade_g) / 100;
  const m = ref.macros_100g;
  const cho = num(m.cho) * f; const ptn = num(m.ptn) * f; const lip = num(m.lip) * f;
  return { cho, ptn, lip, kcal: cho * 4 + ptn * 4 + lip * 9 };
}

/**
 * "Ajustar porções": quantas porções de cada grupo fecham a meta da refeição (CHO, PTN e LIP em kcal),
 * em meias porções. Grupos com 0 porções e sem "travar" podem entrar; vegetais ficam como estão.
 */
export function sugerirPorcoes(grupos, atuais, meta) {
  const usaveis = (grupos || []).filter((g) => g.referencia?.macros_100g && g.criterio !== "kcal");
  if (!meta?.kcal || !usaveis.length) return atuais;
  const fixos = (grupos || []).filter((g) => g.criterio === "kcal").reduce((a, g) => {
    const m = macrosDaPorcao(g); const n = num(atuais[g.id]);
    return { cho: a.cho + m.cho * n, ptn: a.ptn + m.ptn * n, lip: a.lip + m.lip * n };
  }, { cho: 0, ptn: 0, lip: 0 });
  const alvo = meta.cho != null
    ? [["cho", 4], ["ptn", 4], ["lip", 9]].map(([k, w]) => ({ alvo: (meta[k] - fixos[k]) * w, coef: usaveis.map((g) => macrosDaPorcao(g)[k] * w) }))
    : [{ alvo: meta.kcal, coef: usaveis.map((g) => macrosDaPorcao(g).kcal) }];
  // só mexe nos grupos que o nutricionista escolheu (porções > 0); se nenhum, usa todos
  const ativos = usaveis.map((g) => num(atuais[g.id]) > 0);
  const algum = ativos.some(Boolean);
  const x = usaveis.map((g) => num(atuais[g.id]) || (algum ? 0 : 1));
  for (let it = 0; it < 600; it += 1) {
    for (let j = 0; j < x.length; j += 1) {
      if (algum && !ativos[j]) continue;
      let grad = 0; let h = 0;
      alvo.forEach((e) => { const r = e.coef.reduce((a, c, k) => a + c * x[k], 0) - e.alvo; grad += e.coef[j] * r; h += e.coef[j] ** 2; });
      if (h > 0) x[j] = Math.max(0, x[j] - grad / h);
    }
  }
  const saida = { ...atuais };
  usaveis.forEach((g, j) => { saida[g.id] = Math.round(x[j] * 2) / 2; });
  return saida;
}
