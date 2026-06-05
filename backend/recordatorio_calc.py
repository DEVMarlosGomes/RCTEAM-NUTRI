"""
RCTEAM-NUTRI — Motor de calculo do Recordatorio
Replica exatamente as formulas da aba BD CALC_DIETA da planilha EVONUT.

Formula base (identica a planilha):
  valor_nutriente_porcao = (valor_100g / 100) * quantidade_g
"""

from recordatorio_schema import (
    ItemRecordatorio, RefeicaoRecordatorio,
    TotaisDia, AdequacaoDRI, Recordatorio, DRI_REFERENCIA
)

NUTRIENTES = [
    "energia_kcal", "proteina_g", "lipideos_g", "carboidrato_g", "fibra_g",
    "calcio_mg", "magnesio_mg", "manganes_mg", "fosforo_mg", "ferro_mg",
    "sodio_mg", "sodio_adicao_mg", "potassio_mg", "cobre_mg", "zinco_mg",
    "selenio_mcg", "retinol_mcg", "vitamina_a_mcg", "vit_b1_mg", "vit_b2_mg",
    "niacina_mg", "niacina_equiv_mg", "vit_b6_mg", "vit_b12_mcg", "folato_mcg",
    "vit_d_mcg", "vit_e_mg", "vit_c_mg", "colesterol_mg", "ag_saturados_g",
    "ag_monoinsat_g", "ag_poliinsat_g", "ag_18_2_g", "ag_18_3_g", "ag_trans_g",
    "acucar_total_g", "acucar_adicao_g",
]

LABELS_DRI = {
    "energia_kcal":    "Energia (kcal)",
    "proteina_g":      "Proteinas (g)",
    "lipideos_g":      "Lipideos (g)",
    "carboidrato_g":   "Carboidratos (g)",
    "fibra_g":         "Fibra alimentar (g)",
    "sodio_mg":        "Sodio (mg)",
    "sodio_adicao_mg": "Sodio de adicao (mg)",
    "potassio_mg":     "Potassio (mg)",
    "calcio_mg":       "Calcio (mg)",
    "magnesio_mg":     "Magnesio (mg)",
    "manganes_mg":     "Manganes (mg)",
    "fosforo_mg":      "Fosforo (mg)",
    "ferro_mg":        "Ferro (mg)",
    "cobre_mg":        "Cobre (mg)",
    "zinco_mg":        "Zinco (mg)",
    "selenio_mcg":     "Selenio (mcg)",
    "retinol_mcg":     "Retinol (mcg)",
    "vitamina_a_mcg":  "Vitamina A (mcg)",
    "vit_b1_mg":       "Vitamina B1 - Tiamina (mg)",
    "vit_b2_mg":       "Vitamina B2 - Riboflavina (mg)",
    "niacina_mg":      "Vitamina B3 - Niacina (mg)",
    "niacina_equiv_mg":"Equivalente de Vitamina B3 (mg)",
    "vit_b6_mg":       "Vitamina B6 - Piridoxina (mg)",
    "vit_b12_mcg":     "Vitamina B12 - Cobalamina (mcg)",
    "folato_mcg":      "Folato (mcg)",
    "vit_d_mcg":       "Vitamina D - Calciferol (mcg)",
    "vit_e_mg":        "Vitamina E (mg)",
    "vit_c_mg":        "Vitamina C (mg)",
    "colesterol_mg":   "Colesterol (mg)",
    "ag_saturados_g":  "Ac. graxos saturados (g)",
    "ag_monoinsat_g":  "Ac. graxos monoinsaturados (g)",
    "ag_poliinsat_g":  "Ac. graxos poliinsaturados (g)",
    "ag_18_2_g":       "Ac. graxo 18:2 Linoleico (g)",
    "ag_18_3_g":       "Ac. graxo 18:3 Linolenico (g)",
    "ag_trans_g":      "Acidos graxos trans (g)",
    "acucar_total_g":  "Acucar total (g)",
    "acucar_adicao_g": "Acucar de adicao (g)",
}


def calcular_item(alimento_nutrientes: dict, quantidade_g: float) -> dict:
    """
    Replica: valor = (nutriente_100g / 100) * quantidade_g
    Mesmo calculo usado nas colunas de BD CALC_DIETA.

    Aceita o documento completo do alimento OU somente o sub-dict de nutrientes.
    Se o doc tiver chave "nutrientes", usa esse sub-dict (formato evonut).
    Se nao, tenta usar o proprio dict como nutrientes (formato legado).
    Retorna dict com todos os 37 nutrientes calculados para a porcao.
    """
    ref = alimento_nutrientes.get("quantidade_referencia_g", 100) or 100
    fator = quantidade_g / ref
    nuts = alimento_nutrientes.get("nutrientes", alimento_nutrientes)
    result = {}
    for campo in NUTRIENTES:
        v = nuts.get(campo)
        result[campo] = round(float(v) * fator, 4) if v is not None else 0.0
    return result


def calcular_totais_refeicao(refeicao: RefeicaoRecordatorio) -> RefeicaoRecordatorio:
    """Soma todos os itens da refeicao. Calcula %PTN/%LIP/%CHO."""
    totais = {c: 0.0 for c in NUTRIENTES}
    for item in refeicao.itens:
        for campo in NUTRIENTES:
            totais[campo] += getattr(item, campo, 0.0)

    # Aplica todos os totais de volta ao modelo (campo total_* para cada nutriente)
    for campo in NUTRIENTES:
        total_field = f"total_{campo}"
        if hasattr(refeicao, total_field):
            setattr(refeicao, total_field, round(totais[campo], 2))

    # Kcal por macro (4-4-9)
    refeicao.ptn_kcal = round(totais["proteina_g"] * 4, 2)
    refeicao.lip_kcal = round(totais["lipideos_g"] * 9, 2)
    refeicao.cho_kcal = round(totais["carboidrato_g"] * 4, 2)

    total_kcal_macros = refeicao.ptn_kcal + refeicao.lip_kcal + refeicao.cho_kcal
    if total_kcal_macros > 0:
        refeicao.pct_ptn = round(refeicao.ptn_kcal / total_kcal_macros * 100, 1)
        refeicao.pct_lip = round(refeicao.lip_kcal / total_kcal_macros * 100, 1)
        refeicao.pct_cho = round(refeicao.cho_kcal / total_kcal_macros * 100, 1)

    return refeicao


def calcular_totais_dia(refeicoes: list) -> TotaisDia:
    """Soma todas as refeicoes. Mesmo total exibido na planilha."""
    totais = {c: 0.0 for c in NUTRIENTES}
    for ref in refeicoes:
        for campo in NUTRIENTES:
            totais[campo] += getattr(ref, f"total_{campo}", 0.0) or 0.0

    t = TotaisDia(**{c: round(totais[c], 4) for c in NUTRIENTES})

    ptn_kcal = totais["proteina_g"] * 4
    lip_kcal = totais["lipideos_g"] * 9
    cho_kcal = totais["carboidrato_g"] * 4
    total_macro_kcal = ptn_kcal + lip_kcal + cho_kcal
    if total_macro_kcal > 0:
        t.pct_ptn = round(ptn_kcal / total_macro_kcal * 100, 1)
        t.pct_lip = round(lip_kcal / total_macro_kcal * 100, 1)
        t.pct_cho = round(cho_kcal / total_macro_kcal * 100, 1)
    return t


def calcular_adequacao_dri(totais: TotaisDia) -> list:
    """
    Compara totais do dia com DRIs.
    Replica a tabela de adequacao da planilha (diferenca e % adequacao).
    """
    resultado = []
    for campo, dri in DRI_REFERENCIA.items():
        valor_rec = getattr(totais, campo, 0.0) or 0.0
        rec = dri.get("rda")
        diferenca = None
        pct = None
        if rec is not None and rec > 0:
            diferenca = round(valor_rec - rec, 3)
            pct = round((valor_rec / rec) * 100, 1)
        resultado.append(AdequacaoDRI(
            nutriente=campo,
            label=LABELS_DRI.get(campo, campo),
            valor_recordatorio=round(valor_rec, 3),
            recomendacao=rec,
            tipo_dri=dri.get("tipo"),
            diferenca=diferenca,
            pct_adequacao=pct,
        ))
    return resultado


def finalizar_recordatorio(rec: Recordatorio) -> Recordatorio:
    """
    Pipeline completo — chame antes de salvar no MongoDB.
    1. Calcula totais de cada refeicao
    2. Calcula totais do dia
    3. Calcula adequacao DRI
    """
    rec.refeicoes = [calcular_totais_refeicao(r) for r in rec.refeicoes]
    rec.totais_dia = calcular_totais_dia(rec.refeicoes)
    rec.adequacao_dri = calcular_adequacao_dri(rec.totais_dia)
    return rec
