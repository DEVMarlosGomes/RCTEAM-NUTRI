import { blocoDoSalvo, itensParaSalvar, novaRefeicao, novoItem, num } from "./calculos";

const idadeDe = (dataNascimento) => {
  const nasc = dataNascimento ? new Date(`${String(dataNascimento).slice(0, 10)}T12:00:00`) : null;
  if (!nasc || Number.isNaN(nasc.getTime())) return "";
  const hoje = new Date();
  let idade = hoje.getFullYear() - nasc.getFullYear();
  if (hoje < new Date(hoje.getFullYear(), nasc.getMonth(), nasc.getDate())) idade -= 1;
  return Math.max(idade, 0);
};

const ultimaAvaliacao = (d) => [...(d.evaluations || [])]
  .sort((a, b) => String(b.data_avaliacao || b.created_at || "").localeCompare(String(a.data_avaliacao || a.created_at || "")))[0];

const r1 = (v) => Math.round(v * 10) / 10;

/** Planejamento (aba Outras opcoes) a partir da meta salva em Gasto Energetico. */
export function planejamentoDaMeta(meta, peso) {
  const kcal = num(meta?.kcal_final);
  if (!kcal) return null;
  const p = num(peso);
  const g = meta.macros_g || {};
  const ptn = num(g.proteinas) || (p ? num(meta.ptn_gkg) * p : 0);
  const lip = num(g.lipidios) || (p ? num(meta.lip_gkg) * p : 0);
  const cho = num(g.carboidratos) || (p && meta.cho_modo === "gkg" ? num(meta.cho_gkg) * p : (kcal - ptn * 4 - lip * 9) / 4);
  return {
    kcal: Math.round(kcal),
    pct_cho: Math.round((cho * 4 * 100) / kcal),
    pct_ptn: Math.round((ptn * 4 * 100) / kcal),
    pct_lip: Math.round((lip * 9 * 100) / kcal),
    kcal_kg: p ? r1(kcal / p) : "",
    cho_gkg: p ? r1(cho / p) : "",
    ptn_gkg: p ? r1(ptn / p) : "",
    lip_gkg: p ? r1(lip / p) : "",
  };
}

/** Metas em gramas (usadas pela aba Analises e pelo PDF) derivadas do planejamento. */
export function metasDoPlanejamento(pl, peso) {
  const kcal = num(pl?.kcal);
  const p = num(peso);
  const grama = (gkg, pct, f) => {
    if (num(gkg) && p) return r1(num(gkg) * p);
    if (num(pct) && kcal) return r1((num(pct) / 100) * kcal / f);
    return null;
  };
  return {
    meta_kcal: kcal || null,
    meta_carboidrato_g: grama(pl?.cho_gkg, pl?.pct_cho, 4),
    meta_proteina_g: grama(pl?.ptn_gkg, pl?.pct_ptn, 4),
    meta_lipidio_g: grama(pl?.lip_gkg, pl?.pct_lip, 9),
  };
}

export function pesoDoPaciente(d) {
  return d.patient?.peso || ultimaAvaliacao(d)?.peso || "";
}

/** Dieta nova em branco, com as refeicoes iniciais das configuracoes. */
export function draftNovo(d, config, titulo) {
  const patient = d.patient || {};
  const avaliacao = ultimaAvaliacao(d);
  const peso = pesoDoPaciente(d);
  const qtd = Math.max(1, num(config.refeicoes_iniciais) || 6);
  const padrao = config.refeicoes_padrao || [];
  const refeicoes = Array.from({ length: qtd }, (_, i) => novaRefeicao(padrao[i]?.nome || "", padrao[i]?.horario || ""));
  const get = avaliacao?.composicao?.get_kcal;
  return {
    id: null,
    titulo: titulo || config.titulos?.[0] || "Dieta padrão",
    objetivo: patient.objetivo || "",
    estrategia: "",
    prescricao_dietetica: {
      nome: patient.nome || "",
      peso,
      altura: patient.altura || avaliacao?.altura || "",
      idade: idadeDe(patient.data_nascimento) || avaliacao?.idade || "",
      get: get ? Math.round(get) : "",
      agua_min_ml: peso ? Math.round(num(peso) * 35) : "",
      agua_max_ml: peso ? Math.round(num(peso) * 50) : "",
    },
    planejamento: planejamentoDaMeta(patient.meta_energetica, peso) || {},
    refeicoes,
    recomendacoes: [{ titulo: "", texto: "" }],
    listas_substituicao: [],
    orientacao_ids: [],
    observacoes: "",
  };
}

/** Plano salvo (enriquecido pelo backend) -> rascunho do editor. */
export function draftDoPlano(plano, d) {
  const peso = pesoDoPaciente(d);
  const refeicoes = (plano.refeicoes || [])
    // planos antigos tinham 10 refeicoes fixas ("Refeicao 1..10"); as vazias sem nome proprio sao descartadas
    .filter((r) => (r.alimentos || []).length > 0 || !/^Refeição \d+$/.test(r.nome || ""))
    .map((r) => ({
      ...blocoDoSalvo(r),
      nome: r.nome || "",
      horario: r.horario || "",
      observacao: r.observacao || "",
      opcoes: (r.opcoes || []).map((op) => ({ ...blocoDoSalvo(op), observacao: op.observacao || "" })),
    }));
  const recomendacoes = (plano.recomendacoes || []).length
    ? plano.recomendacoes
    : plano.observacoes ? [{ titulo: "", texto: plano.observacoes }] : [{ titulo: "", texto: "" }];
  return {
    id: plano.id,
    titulo: plano.titulo || "Dieta",
    objetivo: plano.objetivo || "",
    estrategia: plano.estrategia || "",
    prescricao_dietetica: { peso, ...(plano.prescricao_dietetica || {}) },
    planejamento: plano.planejamento || planejamentoDaMeta(d.patient?.meta_energetica, peso) || {},
    refeicoes: refeicoes.length ? refeicoes : [novaRefeicao()],
    recomendacoes,
    listas_substituicao: (plano.listas_substituicao || []).map((l) => ({ ...blocoDoSalvo(l), nome: l.nome || "" })),
    orientacao_ids: plano.orientacao_ids || [],
    // o texto antigo de "Orientacoes" migra para a primeira observacao da dieta
    observacoes: (plano.recomendacoes || []).length ? plano.observacoes || "" : "",
  };
}

/** Rascunho -> payload do backend (POST/PUT de planos-manuais). */
export function payloadDoDraft(draft) {
  const peso = draft.prescricao_dietetica?.peso;
  const bloco = (b) => ({ observacao: b.observacao || "", alimentos: itensParaSalvar(b.alimentos) });
  return {
    titulo: (draft.titulo || "").trim() || "Sem título",
    objetivo: draft.objetivo || null,
    estrategia: draft.estrategia || null,
    ...metasDoPlanejamento(draft.planejamento, peso),
    prescricao_dietetica: { ...(draft.prescricao_dietetica || {}), estrategia: draft.estrategia || null },
    planejamento: draft.planejamento || {},
    orientacao_ids: draft.orientacao_ids || [],
    observacoes: draft.observacoes || "",
    refeicoes: (draft.refeicoes || []).map((r) => ({
      nome: r.nome || "",
      horario: r.horario || "",
      ...bloco(r),
      opcoes: (r.opcoes || []).map(bloco),
    })),
    recomendacoes: (draft.recomendacoes || [])
      .filter((x) => (x.titulo || "").trim() || (x.texto || "").trim())
      .map((x) => ({ titulo: x.titulo || "", texto: x.texto || "" })),
    listas_substituicao: (draft.listas_substituicao || [])
      .map((l) => ({ nome: l.nome || "", alimentos: itensParaSalvar(l.alimentos) }))
      .filter((l) => l.nome.trim() || l.alimentos.length),
  };
}

/** Copia o plano de outro paciente: refeicoes e textos vem dele; peso, altura e metas sao do paciente atual. */
export function payloadDoPlanoSalvo(plano, d) {
  const atual = draftNovo(d, {});
  const meta = planejamentoDaMeta(d.patient?.meta_energetica, atual.prescricao_dietetica.peso);
  const origem = plano.planejamento || {};
  return payloadDoDraft({
    ...draftDoPlano(plano, d),
    prescricao_dietetica: atual.prescricao_dietetica,
    // sem meta propria, aproveita so a distribuicao percentual (kcal e g/kg eram do outro paciente)
    planejamento: meta || { pct_cho: origem.pct_cho, pct_ptn: origem.pct_ptn, pct_lip: origem.pct_lip },
  });
}

/** Recordatorio 24h -> payload de dieta (importar recordatorio, como no NutriDiet). */
export function payloadDoRecordatorio(rec) {
  const data = rec.data ? new Date(`${String(rec.data).slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "";
  return {
    titulo: `Recordatório ${data}`.trim(),
    refeicoes: (rec.refeicoes || []).map((r) => ({
      nome: r.nome || "",
      horario: r.horario || "",
      observacao: r.observacao || "",
      alimentos: (r.itens || []).map((it) => ({
        alimento_id: it.alimento_id || null,
        nome: it.alimento_nome || null,
        medida_nome: it.medida_nome || "Gramas",
        quantidade: num(it.quantidade),
        quantidade_g: num(it.quantidade_g),
        observacao: "",
        substitutos: [],
      })),
      opcoes: [],
    })),
  };
}

export const blocoVazio = () => ({ observacao: "", alimentos: [novoItem()] });
