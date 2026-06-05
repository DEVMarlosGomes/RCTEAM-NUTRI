"""
RCTEAM-NUTRI — Prescricao Dietetica
Schema completo baseado na PLANILHA EVONUT
MongoDB + Pydantic models
"""

from typing import Optional, List
from pydantic import BaseModel
from enum import Enum


# ── ENUMS ──────────────────────────────────────────────────────

class Sexo(str, Enum):
    masculino = "M"
    feminino  = "F"

class ModoTotalCalorico(str, Enum):
    avaliacao = "avaliacao"   # usa total calculado na avaliacao
    manual    = "manual"      # nutricionista define manualmente


# ── NUTRIENTES (per 100g reference) ────────────────────────────

class NutrientesBase(BaseModel):
    """36 nutrientes conforme tabela EVONUT/TACO/IBGE/Tucunduva"""
    energia_kcal:      Optional[float] = None
    proteina_g:        Optional[float] = None
    lipideos_g:        Optional[float] = None
    carboidrato_g:     Optional[float] = None
    fibra_g:           Optional[float] = None
    # Minerais
    calcio_mg:         Optional[float] = None
    magnesio_mg:       Optional[float] = None
    manganes_mg:       Optional[float] = None
    fosforo_mg:        Optional[float] = None
    ferro_mg:          Optional[float] = None
    sodio_mg:          Optional[float] = None
    sodio_adicao_mg:   Optional[float] = None
    potassio_mg:       Optional[float] = None
    cobre_mg:          Optional[float] = None
    zinco_mg:          Optional[float] = None
    selenio_mcg:       Optional[float] = None
    # Vitaminas
    retinol_mcg:       Optional[float] = None
    vitamina_a_mcg:    Optional[float] = None
    vit_b1_mg:         Optional[float] = None
    vit_b2_mg:         Optional[float] = None
    niacina_mg:        Optional[float] = None
    niacina_equiv_mg:  Optional[float] = None
    vit_b6_mg:         Optional[float] = None
    vit_b12_mcg:       Optional[float] = None
    folato_mcg:        Optional[float] = None
    vit_d_mcg:         Optional[float] = None
    vit_e_mg:          Optional[float] = None
    vit_c_mg:          Optional[float] = None
    # Lipidios detalhados
    colesterol_mg:     Optional[float] = None
    ag_saturados_g:    Optional[float] = None
    ag_monoinsat_g:    Optional[float] = None
    ag_poliinsat_g:    Optional[float] = None
    ag_18_2_g:         Optional[float] = None
    ag_18_3_g:         Optional[float] = None
    ag_trans_g:        Optional[float] = None
    # Acucares
    acucar_total_g:    Optional[float] = None
    acucar_adicao_g:   Optional[float] = None


# ── ALIMENTO (tabela nutricional) ───────────────────────────────

class Alimento(BaseModel):
    """Colecao: alimentos"""
    id:                      str                   # string (seed converte int -> str)
    nome:                    str
    fonte:                   str                   # IBGE/TACO/TBCA/Tucunduva/Manual
    quantidade_referencia_g: float = 100.0
    grupo:                   str                   # Grupo alimentar (16 valores)
    nutrientes:              NutrientesBase


# ── MEDIDA CASEIRA ──────────────────────────────────────────────

class MedidaCaseira(BaseModel):
    """Colecao: medidas_caseiras"""
    id:       int
    nome:     str                                  # "Colher de sopa", "Unidade", etc.
    fator_g:  float                                # 0 = depende do alimento especifico


# ── ITEM DE REFEICAO ────────────────────────────────────────────

class ItemRefeicao(BaseModel):
    """Embedded in PlanoAlimentar.refeicoes[].itens"""
    n:              int                            # Numero sequencial na refeicao (1-12)
    alimento_id:    str                            # Referencia ao alimento (string)
    alimento_nome:  str                            # Desnormalizado p/ performance
    medida_nome:    str                            # "Gramas", "Unidade", etc.
    quantidade:     float                          # Quantidade na medida escolhida
    quantidade_g:   float                          # Quantidade em gramas (calculada)
    # Nutrientes calculados para esta porcao
    energia_kcal:   float = 0
    proteina_g:     float = 0
    lipideos_g:     float = 0
    carboidrato_g:  float = 0
    fibra_g:        float = 0
    # Percentuais do total da refeicao
    pct_ptn:        float = 0
    pct_lip:        float = 0
    pct_cho:        float = 0
    # Kcal por macro
    ptn_kcal:       float = 0
    lip_kcal:       float = 0
    cho_kcal:       float = 0
    equivalente_id: Optional[str] = None


# ── REFEICAO ────────────────────────────────────────────────────

class Refeicao(BaseModel):
    """Embedded in PlanoAlimentar"""
    numero:              int                       # 1-8
    nome:                str                       # "Cafe da manha", "Almoco", etc.
    horario:             Optional[str] = None      # "07:00"
    meta_kcal:           float = 0
    meta_pct:            float = 0                 # % do total calorico
    itens:               List[ItemRefeicao] = []
    # Totais calculados
    total_energia_kcal:  float = 0
    total_proteina_g:    float = 0
    total_lipideos_g:    float = 0
    total_carboidrato_g: float = 0
    total_fibra_g:       float = 0
    total_qtde_g:        float = 0
    pct_ptn:             float = 0
    pct_lip:             float = 0
    pct_cho:             float = 0
    observacao:          Optional[str] = None


# ── PREVISAO DIETETICA (metas de macros) ────────────────────────

class PrevisaoDietetica(BaseModel):
    """Metas de macronutrientes do plano"""
    total_calorico:         float
    modo:                   ModoTotalCalorico = ModoTotalCalorico.avaliacao
    proteina_g:             float
    proteina_g_por_kg:      float
    proteina_pct:           float
    lipideos_g:             float
    lipideos_g_por_kg:      float
    lipideos_pct:           float
    carboidrato_g:          float
    carboidrato_g_por_kg:   float
    carboidrato_pct:        float
    distribuicao_refeicoes: List[dict] = []        # [{num, nome, kcal, pct}]


# ── PLANO ALIMENTAR COMPLETO ────────────────────────────────────

class PlanoAlimentar(BaseModel):
    """Colecao: planos_alimentares"""
    paciente_id:             str
    nutricionista_id:        str
    avaliacao_id:            Optional[str] = None
    titulo:                  str = "Plano Alimentar"
    data_prescricao:         str                   # ISO date
    ativo:                   bool = True
    previsao:                PrevisaoDietetica
    refeicoes:               List[Refeicao] = []
    # Totais do dia (calculados)
    total_dia_energia_kcal:  float = 0
    total_dia_proteina_g:    float = 0
    total_dia_lipideos_g:    float = 0
    total_dia_carboidrato_g: float = 0
    total_dia_fibra_g:       float = 0
    pct_ptn:                 float = 0
    pct_lip:                 float = 0
    pct_cho:                 float = 0
    # Micronutrientes do dia (soma de todos os itens)
    micronutrientes_dia:     Optional[NutrientesBase] = None
    observacoes:             Optional[str] = None
    orientacoes_gerais:      Optional[str] = None


# ── PLANO SALVO (historico de versoes) ──────────────────────────

class PlanoSalvo(BaseModel):
    """Colecao: planos_salvos — historico de versoes"""
    plano_id:         str
    paciente_id:      str
    nutricionista_id: str
    numero_versao:    int
    snapshot:         PlanoAlimentar
    data_salvamento:  str


# ── GASTO ENERGETICO ────────────────────────────────────────────

class GastoEnergetico(BaseModel):
    """Colecao: gastos_energeticos"""
    paciente_id:       str
    avaliacao_id:      str
    data:              str
    peso_kg:           float
    altura_cm:         float
    idade_anos:        int
    sexo:              Sexo
    mlg_kg:            Optional[float] = None      # Massa livre de gordura (Cunningham/Tinsley)
    protocolo_tmb_id:  int
    protocolo_nome:    str
    tmb_calculada:     float                       # kcal/dia
    naf_id:            int
    naf_label:         str
    naf_fator:         float
    fator_injuria_id:  Optional[int] = None
    fator_injuria:     Optional[float] = 1.0
    get_kcal:          float                       # GET = TMB x NAF x FI
    observacoes:       Optional[str] = None


# ── ANALISE DE ADEQUACAO ─────────────────────────────────────────

class AnaliseAdequacao(BaseModel):
    """Colecao: analises — compara plano vs metas/DRI"""
    plano_id:        str
    paciente_id:     str
    data:            str
    energia_meta:    float
    energia_real:    float
    energia_saldo:   float
    proteina_meta_g: float
    proteina_real_g: float
    lipideos_meta_g: float
    lipideos_real_g: float
    cho_meta_g:      float
    cho_real_g:      float
    por_refeicao:    List[dict] = []


# ── ORIENTACOES NUTRICIONAIS ─────────────────────────────────────

class OrientacaoNutricional(BaseModel):
    """Colecao: orientacoes"""
    paciente_id: str
    plano_id:    Optional[str] = None
    data:        str
    titulo:      str
    conteudo:    str                               # HTML ou Markdown
    categoria:   str                               # "hidratacao", "suplementacao", etc.
