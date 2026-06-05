"""
RCTEAM-NUTRI — Recordatorio Alimentar de 24h
Schema baseado fielmente na aba Recordatorio da PLANILHA EVONUT

Estrutura:
  - Ate 8 refeicoes por dia
  - Ate 12 alimentos por refeicao (igual a planilha)
  - Totais por refeicao: kcal, PTN, LIP, CHO, fibra
  - Totais do dia (36 nutrientes)
  - Adequacao as DRIs (36 nutrientes, igual a planilha)
  - Vinculado ao paciente + data
"""

from typing import Optional, List
from pydantic import BaseModel


# ── NOMES PADRAO DE REFEICOES (igual a planilha) ───────────────
NOMES_REFEICAO_PADRAO = {
    1: "Cafe da Manha",
    2: "Lanche da Manha",
    3: "Almoco",
    4: "Lanche da Tarde",
    5: "Jantar",
    6: "Ceia",
    7: "Refeicao 7",
    8: "Refeicao 8",
}


# ── DRIs DE REFERENCIA (igual a planilha — por sexo/faixa etaria) ──
# Valores RDA/AI conforme exibidos na aba Recordatorio
DRI_REFERENCIA = {
    "energia_kcal":    {"rda": None,   "tipo": None},
    "proteina_g":      {"rda": 56,     "tipo": "RDA",  "obs": "Homens adultos"},
    "carboidrato_g":   {"rda": 130,    "tipo": "RDA"},
    "fibra_g":         {"rda": 38,     "tipo": "AI",   "obs": "Homens; 25g mulheres"},
    "sodio_mg":        {"rda": 1500,   "tipo": "AI"},
    "potassio_mg":     {"rda": 4700,   "tipo": "AI"},
    "calcio_mg":       {"rda": 1000,   "tipo": "AI"},
    "magnesio_mg":     {"rda": 400,    "tipo": "RDA",  "obs": "Homens 19-30 anos"},
    "manganes_mg":     {"rda": 2.3,    "tipo": "AI"},
    "fosforo_mg":      {"rda": 700,    "tipo": "RDA"},
    "ferro_mg":        {"rda": 8,      "tipo": "RDA",  "obs": "Homens; 18mg mulheres"},
    "cobre_mg":        {"rda": 0.9,    "tipo": "RDA"},
    "zinco_mg":        {"rda": 11,     "tipo": "RDA",  "obs": "Homens; 8mg mulheres"},
    "selenio_mcg":     {"rda": 55,     "tipo": "RDA"},
    "vitamina_a_mcg":  {"rda": 900,    "tipo": "RDA",  "obs": "Homens; 700 mulheres"},
    "vit_b1_mg":       {"rda": 1.2,    "tipo": "RDA"},
    "vit_b2_mg":       {"rda": 1.3,    "tipo": "RDA"},
    "niacina_mg":      {"rda": 16,     "tipo": "RDA",  "obs": "Homens; 14 mulheres"},
    "vit_b6_mg":       {"rda": 1.3,    "tipo": "RDA"},
    "vit_b12_mcg":     {"rda": 2.4,    "tipo": "RDA"},
    "folato_mcg":      {"rda": 400,    "tipo": "RDA"},
    "vit_d_mcg":       {"rda": 5.0,    "tipo": "AI"},
    "vit_e_mg":        {"rda": 15,     "tipo": "RDA"},
    "vit_c_mg":        {"rda": 90,     "tipo": "RDA",  "obs": "Homens; 75 mulheres"},
    "ag_18_2_g":       {"rda": 17,     "tipo": "AI",   "obs": "Homens; 12 mulheres"},
    "ag_18_3_g":       {"rda": 1.6,    "tipo": "AI",   "obs": "Homens; 1.1 mulheres"},
    # Sem DRI definida na planilha:
    "lipideos_g":      {"rda": None,   "tipo": None},
    "sodio_adicao_mg": {"rda": None,   "tipo": None},
    "retinol_mcg":     {"rda": None,   "tipo": None},
    "niacina_equiv_mg":{"rda": None,   "tipo": None},
    "colesterol_mg":   {"rda": None,   "tipo": None},
    "ag_saturados_g":  {"rda": None,   "tipo": None},
    "ag_monoinsat_g":  {"rda": None,   "tipo": None},
    "ag_poliinsat_g":  {"rda": None,   "tipo": None},
    "ag_trans_g":      {"rda": None,   "tipo": None},
    "acucar_total_g":  {"rda": None,   "tipo": None},
    "acucar_adicao_g": {"rda": None,   "tipo": None},
}


# ── ITEM DO RECORDATORIO ───────────────────────────────────────

class ItemRecordatorio(BaseModel):
    """
    Linha dentro de uma refeicao do recordatorio.
    Ate 12 itens por refeicao (n = 1 a 12), igual a planilha.
    """
    n:               int
    alimento_id:     Optional[str] = None   # ID string na colecao alimentos (None = nao identificado)
    alimento_nome:   str
    medida_nome:     str = "Gramas"
    quantidade:      float
    quantidade_g:    float

    # Nutrientes calculados proporcionalmente para esta porcao
    energia_kcal:    float = 0.0
    proteina_g:      float = 0.0
    lipideos_g:      float = 0.0
    carboidrato_g:   float = 0.0
    fibra_g:         float = 0.0
    calcio_mg:       float = 0.0
    magnesio_mg:     float = 0.0
    manganes_mg:     float = 0.0
    fosforo_mg:      float = 0.0
    ferro_mg:        float = 0.0
    sodio_mg:        float = 0.0
    sodio_adicao_mg: float = 0.0
    potassio_mg:     float = 0.0
    cobre_mg:        float = 0.0
    zinco_mg:        float = 0.0
    selenio_mcg:     float = 0.0
    retinol_mcg:     float = 0.0
    vitamina_a_mcg:  float = 0.0
    vit_b1_mg:       float = 0.0
    vit_b2_mg:       float = 0.0
    niacina_mg:      float = 0.0
    niacina_equiv_mg:float = 0.0
    vit_b6_mg:       float = 0.0
    vit_b12_mcg:     float = 0.0
    folato_mcg:      float = 0.0
    vit_d_mcg:       float = 0.0
    vit_e_mg:        float = 0.0
    vit_c_mg:        float = 0.0
    colesterol_mg:   float = 0.0
    ag_saturados_g:  float = 0.0
    ag_monoinsat_g:  float = 0.0
    ag_poliinsat_g:  float = 0.0
    ag_18_2_g:       float = 0.0
    ag_18_3_g:       float = 0.0
    ag_trans_g:      float = 0.0
    acucar_total_g:  float = 0.0
    acucar_adicao_g: float = 0.0


# ── REFEICAO DO RECORDATORIO ───────────────────────────────────

class RefeicaoRecordatorio(BaseModel):
    """
    Uma refeicao dentro do recordatorio de 24h.
    Estrutura identica a planilha: n=1..8, ate 12 alimentos.
    """
    numero:               int
    nome:                 str
    horario:              Optional[str] = None
    itens:                List[ItemRecordatorio] = []

    # Totais calculados da refeicao — todos os 37 nutrientes (igual a planilha)
    total_energia_kcal:    float = 0.0
    total_proteina_g:      float = 0.0
    total_lipideos_g:      float = 0.0
    total_carboidrato_g:   float = 0.0
    total_fibra_g:         float = 0.0
    total_calcio_mg:       float = 0.0
    total_magnesio_mg:     float = 0.0
    total_manganes_mg:     float = 0.0
    total_fosforo_mg:      float = 0.0
    total_ferro_mg:        float = 0.0
    total_sodio_mg:        float = 0.0
    total_sodio_adicao_mg: float = 0.0
    total_potassio_mg:     float = 0.0
    total_cobre_mg:        float = 0.0
    total_zinco_mg:        float = 0.0
    total_selenio_mcg:     float = 0.0
    total_retinol_mcg:     float = 0.0
    total_vitamina_a_mcg:  float = 0.0
    total_vit_b1_mg:       float = 0.0
    total_vit_b2_mg:       float = 0.0
    total_niacina_mg:      float = 0.0
    total_niacina_equiv_mg:float = 0.0
    total_vit_b6_mg:       float = 0.0
    total_vit_b12_mcg:     float = 0.0
    total_folato_mcg:      float = 0.0
    total_vit_d_mcg:       float = 0.0
    total_vit_e_mg:        float = 0.0
    total_vit_c_mg:        float = 0.0
    total_colesterol_mg:   float = 0.0
    total_ag_saturados_g:  float = 0.0
    total_ag_monoinsat_g:  float = 0.0
    total_ag_poliinsat_g:  float = 0.0
    total_ag_18_2_g:       float = 0.0
    total_ag_18_3_g:       float = 0.0
    total_ag_trans_g:      float = 0.0
    total_acucar_total_g:  float = 0.0
    total_acucar_adicao_g: float = 0.0
    # % macros e kcal por macro
    pct_ptn:               float = 0.0
    pct_lip:               float = 0.0
    pct_cho:               float = 0.0
    ptn_kcal:              float = 0.0
    lip_kcal:              float = 0.0
    cho_kcal:              float = 0.0
    observacao:            Optional[str] = None


# ── ADEQUACAO DRI ──────────────────────────────────────────────

class AdequacaoDRI(BaseModel):
    """Comparacao de cada nutriente com a DRI, igual a planilha."""
    nutriente:           str
    label:               str
    valor_recordatorio:  float
    recomendacao:        Optional[float]
    tipo_dri:            Optional[str]
    diferenca:           Optional[float]
    pct_adequacao:       Optional[float]


# ── TOTAIS DO DIA ──────────────────────────────────────────────

class TotaisDia(BaseModel):
    """Soma de todos os nutrientes de todas as refeicoes do dia."""
    energia_kcal:    float = 0.0
    proteina_g:      float = 0.0
    lipideos_g:      float = 0.0
    carboidrato_g:   float = 0.0
    fibra_g:         float = 0.0
    pct_ptn:         float = 0.0
    pct_lip:         float = 0.0
    pct_cho:         float = 0.0
    ptn_kcal:        float = 0.0
    lip_kcal:        float = 0.0
    cho_kcal:        float = 0.0
    calcio_mg:       float = 0.0
    magnesio_mg:     float = 0.0
    manganes_mg:     float = 0.0
    fosforo_mg:      float = 0.0
    ferro_mg:        float = 0.0
    sodio_mg:        float = 0.0
    sodio_adicao_mg: float = 0.0
    potassio_mg:     float = 0.0
    cobre_mg:        float = 0.0
    zinco_mg:        float = 0.0
    selenio_mcg:     float = 0.0
    retinol_mcg:     float = 0.0
    vitamina_a_mcg:  float = 0.0
    vit_b1_mg:       float = 0.0
    vit_b2_mg:       float = 0.0
    niacina_mg:      float = 0.0
    niacina_equiv_mg:float = 0.0
    vit_b6_mg:       float = 0.0
    vit_b12_mcg:     float = 0.0
    folato_mcg:      float = 0.0
    vit_d_mcg:       float = 0.0
    vit_e_mg:        float = 0.0
    vit_c_mg:        float = 0.0
    colesterol_mg:   float = 0.0
    ag_saturados_g:  float = 0.0
    ag_monoinsat_g:  float = 0.0
    ag_poliinsat_g:  float = 0.0
    ag_18_2_g:       float = 0.0
    ag_18_3_g:       float = 0.0
    ag_trans_g:      float = 0.0
    acucar_total_g:  float = 0.0
    acucar_adicao_g: float = 0.0


# ── RECORDATORIO COMPLETO ──────────────────────────────────────

class Recordatorio(BaseModel):
    """Colecao MongoDB: recordatorios"""
    paciente_id:          str
    nutricionista_id:     str
    data:                 str             # "2025-11-15" (dia avaliado)
    data_registro:        str             # ISO datetime do registro
    # Dados do paciente no momento (desnormalizados para historico)
    paciente_nome:        Optional[str] = None
    paciente_idade:       Optional[int] = None
    paciente_sexo:        Optional[str] = None
    paciente_peso_kg:     Optional[float] = None
    paciente_altura_cm:   Optional[float] = None
    paciente_imc:         Optional[float] = None
    paciente_gordura_pct: Optional[float] = None
    paciente_objetivo:    Optional[str] = None
    # Refeicoes: 1 a 8, cada uma com ate 12 alimentos
    refeicoes:            List[RefeicaoRecordatorio] = []
    # Totais do dia (calculados ao salvar)
    totais_dia:           TotaisDia = TotaisDia()
    # Adequacao DRI (calculada ao salvar, igual a planilha)
    adequacao_dri:        List[AdequacaoDRI] = []
    observacoes:          Optional[str] = None
    finalizado:           bool = False
