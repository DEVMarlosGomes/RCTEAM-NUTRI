"""Prescrição dietética no formato do NutriDiet.

Tudo o que a tela de dieta usa além do CRUD de planos (que fica em server.py):
- configurações da dieta do nutricionista (listas de autocompletar, forma de cálculo, layout do PDF);
- modelos de refeição e listas de substituição reutilizáveis;
- análise de vitaminas e minerais da dieta/refeição contra as DRIs por idade, sexo e gestação;
- PDF do plano (layout do paciente) e PDF do relatório de nutrientes.
"""
import uuid
from datetime import date, datetime
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

# ── Configurações padrão ────────────────────────────────────────────────────

TABELAS_ALIMENTOS = ("TACO", "IBGE", "TBCA", "Tucunduva", "Marcas", "Meus")

CONFIG_PADRAO: dict = {
    "refeicoes_iniciais": 6,
    "tabelas_alimentos": [],              # vazio = todas as tabelas + meus alimentos
    "forma_calculo": "medida",            # medida | gramas
    "layout_calculos": "medida_gramas",   # medida | gramas | medida_gramas
    "layout_linhas": "iguais",            # iguais | alternadas
    "incluir_observacoes": True,
    "layout_lista_substituicao": "lista",  # nome_obs | obs | lista
    "incluir_macros_pdf": False,
    "objetivos": [
        "Emagrecimento",
        "Ganho de massa muscular",
        "Ganho de massa muscular e queima de gordura corporal",
        "Queima de gordura corporal",
        "Qualidade de vida",
        "Saúde e desempenho esportivo",
        "Saúde na gestação",
        "Manutenção do peso",
    ],
    "titulos": ["Dieta padrão", "Dieta para os dias COM treino", "Dieta para os dias SEM treino"],
    "nomes_refeicao": [
        "CAFÉ DA MANHÃ", "COLAÇÃO", "LANCHE DA MANHÃ", "ALMOÇO", "LANCHE DA TARDE",
        "PRÉ-TREINO", "INTRA-TREINO", "PÓS-TREINO", "JANTAR", "CEIA",
    ],
    "refeicoes_padrao": [
        {"nome": "CAFÉ DA MANHÃ", "horario": "07:00"},
        {"nome": "LANCHE DA MANHÃ", "horario": "10:00"},
        {"nome": "ALMOÇO", "horario": "12:30"},
        {"nome": "LANCHE DA TARDE", "horario": "16:00"},
        {"nome": "JANTAR", "horario": "19:30"},
        {"nome": "CEIA", "horario": "22:00"},
    ],
    "observacoes_refeicao": [
        "Temperar com ervas naturais (alho, cebola, salsa, manjericão, açafrão)",
        "Não coar o suco verde",
        "Beber água entre as refeições, evitando durante",
    ],
    "observacoes_alimento": [
        "ou Grupo de Carnes e Ovos",
        "ou Grupo de Cereais integrais, Raízes e Derivados",
        "ou Grupo de Frutas",
        "ou Grupo de Gorduras Boas",
        "ou Grupo de Leguminosas",
        "ou Grupo de Leite e Derivados",
        "Sem açúcar",
        "Cozido(a) ou grelhado(a)",
    ],
}
_LISTAS_CONFIG = ("objetivos", "titulos", "nomes_refeicao", "observacoes_refeicao", "observacoes_alimento")
_ENUMS_CONFIG = {
    "forma_calculo": {"medida", "gramas"},
    "layout_calculos": {"medida", "gramas", "medida_gramas"},
    "layout_linhas": {"iguais", "alternadas"},
    "layout_lista_substituicao": {"nome_obs", "obs", "lista"},
}


class DietaConfigIn(BaseModel):
    refeicoes_iniciais: Optional[int] = Field(default=None, ge=1, le=12)
    tabelas_alimentos: Optional[List[str]] = None
    forma_calculo: Optional[str] = None
    layout_calculos: Optional[str] = None
    layout_linhas: Optional[str] = None
    incluir_observacoes: Optional[bool] = None
    layout_lista_substituicao: Optional[str] = None
    incluir_macros_pdf: Optional[bool] = None
    objetivos: Optional[List[str]] = None
    titulos: Optional[List[str]] = None
    nomes_refeicao: Optional[List[str]] = None
    refeicoes_padrao: Optional[List[dict]] = None
    observacoes_refeicao: Optional[List[str]] = None
    observacoes_alimento: Optional[List[str]] = None


class ItemModeloIn(BaseModel):
    alimento_id: Optional[str] = None
    nome: Optional[str] = None
    medida_nome: Optional[str] = None
    quantidade: Optional[float] = None
    quantidade_g: Optional[float] = None
    observacao: Optional[str] = None
    substitutos: List[dict] = []


class ModeloRefeicaoIn(BaseModel):
    nome: str = Field(min_length=1, max_length=140)
    observacao: Optional[str] = Field(default=None, max_length=1000)
    alimentos: List[ItemModeloIn] = []


class ListaSubstituicaoIn(BaseModel):
    nome: str = Field(min_length=1, max_length=140)
    alimentos: List[ItemModeloIn] = []


class AnaliseItemIn(BaseModel):
    alimento_id: Optional[str] = None
    quantidade_g: Optional[float] = None


class AnaliseIn(BaseModel):
    itens: List[AnaliseItemIn] = []


class OrdemPlanosIn(BaseModel):
    ids: List[str]


# ── DRIs (IOM/NASEM) por faixa etária, sexo e gestação ──────────────────────
# Valores RDA ou AI. Potássio e sódio seguem a revisão de 2019.

_VIT = ("vitamina_a", "vitamina_c", "vitamina_d", "vitamina_e", "vitamina_k", "vitamina_b1", "vitamina_b2",
        "vitamina_b3", "vitamina_b5", "vitamina_b6", "vitamina_b7", "colina", "vitamina_b9", "vitamina_b12")
_MIN = ("calcio", "cloro", "cromo", "cobre", "fluoreto", "iodo", "ferro", "magnesio", "manganes", "molibdenio",
        "fosforo", "selenio", "zinco", "potassio", "sodio", "fibras")


def _faixa(vit: tuple, mins: tuple) -> dict:
    return {**dict(zip(_VIT, vit)), **dict(zip(_MIN, mins))}


#                 A    C   D   E   K    B1   B2   B3  B5  B6   B7  Col  B9   B12
#                 Ca    Cl    Cr  Cu    F    I    Fe  Mg   Mn   Mo  P     Se  Zn  K     Na    Fibra
_DRI = {
    ("1-3", "*"): _faixa((300, 15, 15, 6, 30, 0.5, 0.5, 6, 2, 0.5, 8, 200, 150, 0.9),
                         (700, 1500, 11, 0.34, 0.7, 90, 7, 80, 1.2, 17, 460, 20, 3, 2000, 800, 19)),
    ("4-8", "*"): _faixa((400, 25, 15, 7, 55, 0.6, 0.6, 8, 3, 0.6, 12, 250, 200, 1.2),
                         (1000, 1900, 15, 0.44, 1, 90, 10, 130, 1.5, 22, 500, 30, 5, 2300, 1000, 25)),
    ("9-13", "M"): _faixa((600, 45, 15, 11, 60, 0.9, 0.9, 12, 4, 1.0, 20, 375, 300, 1.8),
                          (1300, 2300, 25, 0.7, 2, 120, 8, 240, 1.9, 34, 1250, 40, 8, 2500, 1200, 31)),
    ("9-13", "F"): _faixa((600, 45, 15, 11, 60, 0.9, 0.9, 12, 4, 1.0, 20, 375, 300, 1.8),
                          (1300, 2300, 21, 0.7, 2, 120, 8, 240, 1.6, 34, 1250, 40, 8, 2300, 1200, 26)),
    ("14-18", "M"): _faixa((900, 75, 15, 15, 75, 1.2, 1.3, 16, 5, 1.3, 25, 550, 400, 2.4),
                           (1300, 2300, 35, 0.89, 3, 150, 11, 410, 2.2, 43, 1250, 55, 11, 3000, 1500, 38)),
    ("14-18", "F"): _faixa((700, 65, 15, 15, 75, 1.0, 1.0, 14, 5, 1.2, 25, 400, 400, 2.4),
                           (1300, 2300, 24, 0.89, 3, 150, 15, 360, 1.6, 43, 1250, 55, 9, 2300, 1500, 26)),
    ("19-30", "M"): _faixa((900, 90, 15, 15, 120, 1.2, 1.3, 16, 5, 1.3, 30, 550, 400, 2.4),
                           (1000, 2300, 35, 0.9, 4, 150, 8, 400, 2.3, 45, 700, 55, 11, 3400, 1500, 38)),
    ("31-50", "M"): _faixa((900, 90, 15, 15, 120, 1.2, 1.3, 16, 5, 1.3, 30, 550, 400, 2.4),
                           (1000, 2300, 35, 0.9, 4, 150, 8, 420, 2.3, 45, 700, 55, 11, 3400, 1500, 38)),
    ("51-70", "M"): _faixa((900, 90, 15, 15, 120, 1.2, 1.3, 16, 5, 1.7, 30, 550, 400, 2.4),
                           (1000, 2000, 30, 0.9, 4, 150, 8, 420, 2.3, 45, 700, 55, 11, 3400, 1500, 30)),
    ("70+", "M"): _faixa((900, 90, 20, 15, 120, 1.2, 1.3, 16, 5, 1.7, 30, 550, 400, 2.4),
                         (1200, 1800, 30, 0.9, 4, 150, 8, 420, 2.3, 45, 700, 55, 11, 3400, 1500, 30)),
    ("19-30", "F"): _faixa((700, 75, 15, 15, 90, 1.1, 1.1, 14, 5, 1.3, 30, 425, 400, 2.4),
                           (1000, 2300, 25, 0.9, 3, 150, 18, 310, 1.8, 45, 700, 55, 8, 2600, 1500, 25)),
    ("31-50", "F"): _faixa((700, 75, 15, 15, 90, 1.1, 1.1, 14, 5, 1.3, 30, 425, 400, 2.4),
                           (1000, 2300, 25, 0.9, 3, 150, 18, 320, 1.8, 45, 700, 55, 8, 2600, 1500, 25)),
    ("51-70", "F"): _faixa((700, 75, 15, 15, 90, 1.1, 1.1, 14, 5, 1.5, 30, 425, 400, 2.4),
                           (1200, 2000, 20, 0.9, 3, 150, 8, 320, 1.8, 45, 700, 55, 8, 2600, 1500, 21)),
    ("70+", "F"): _faixa((700, 75, 20, 15, 90, 1.1, 1.1, 14, 5, 1.5, 30, 425, 400, 2.4),
                         (1200, 1800, 20, 0.9, 3, 150, 8, 320, 1.8, 45, 700, 55, 8, 2600, 1500, 21)),
    ("gestante-14-18", "F"): _faixa((750, 80, 15, 15, 75, 1.4, 1.4, 18, 6, 1.9, 30, 450, 600, 2.6),
                                    (1300, 2300, 29, 1.0, 3, 220, 27, 400, 2.0, 50, 1250, 60, 12, 2600, 1500, 28)),
    ("gestante-19-30", "F"): _faixa((770, 85, 15, 15, 90, 1.4, 1.4, 18, 6, 1.9, 30, 450, 600, 2.6),
                                    (1000, 2300, 30, 1.0, 3, 220, 27, 350, 2.0, 50, 700, 60, 11, 2900, 1500, 28)),
    ("gestante-31-50", "F"): _faixa((770, 85, 15, 15, 90, 1.4, 1.4, 18, 6, 1.9, 30, 450, 600, 2.6),
                                    (1000, 2300, 30, 1.0, 3, 220, 27, 360, 2.0, 50, 700, 60, 11, 2900, 1500, 28)),
}

# (código, rótulo, unidade, chave no banco EVONUT por 100 g ou None se a tabela não traz o nutriente)
VITAMINAS = [
    ("vitamina_a", "Vitamina A", "mcg", "vitamina_a_mcg"),
    ("vitamina_b1", "Vitamina B1 (tiamina)", "mg", "vit_b1_mg"),
    ("vitamina_b2", "Vitamina B2 (riboflavina)", "mg", "vit_b2_mg"),
    ("vitamina_b3", "Vitamina B3 (niacina)", "mg", "niacina_mg"),
    ("vitamina_b5", "Vitamina B5 (ácido pantotênico)", "mg", None),
    ("vitamina_b6", "Vitamina B6", "mg", "vit_b6_mg"),
    ("vitamina_b7", "Vitamina B7 (biotina)", "mcg", None),
    ("colina", "Colina", "mg", None),
    ("vitamina_b9", "Vitamina B9 (folato)", "mcg", "folato_mcg"),
    ("vitamina_b12", "Vitamina B12", "mcg", "vit_b12_mcg"),
    ("vitamina_c", "Vitamina C", "mg", "vit_c_mg"),
    ("vitamina_d", "Vitamina D", "mcg", "vit_d_mcg"),
    ("vitamina_e", "Vitamina E", "mg", "vit_e_mg"),
    ("vitamina_k", "Vitamina K", "mcg", None),
]
MINERAIS = [
    ("calcio", "Cálcio", "mg", "calcio_mg"),
    ("cloro", "Cloro", "mg", None),
    ("cobre", "Cobre", "mg", "cobre_mg"),
    ("cromo", "Cromo", "mcg", None),
    ("ferro", "Ferro", "mg", "ferro_mg"),
    ("fluoreto", "Flúor", "mg", None),
    ("fosforo", "Fósforo", "mg", "fosforo_mg"),
    ("iodo", "Iodo", "mcg", None),
    ("magnesio", "Magnésio", "mg", "magnesio_mg"),
    ("manganes", "Manganês", "mg", "manganes_mg"),
    ("molibdenio", "Molibdênio", "mcg", None),
    ("potassio", "Potássio", "mg", "potassio_mg"),
    ("selenio", "Selênio", "mcg", "selenio_mcg"),
    ("sodio", "Sódio", "mg", "sodio_mg"),
    ("zinco", "Zinco", "mg", "zinco_mg"),
]
OUTROS = [
    ("fibras", "Fibras", "g", "fibra_g"),
    ("colesterol", "Colesterol", "mg", "colesterol_mg"),
    ("ag_saturados", "Gorduras saturadas", "g", "ag_saturados_g"),
    ("ag_mono", "Gorduras monoinsaturadas", "g", "ag_monoinsat_g"),
    ("ag_poli", "Gorduras poli-insaturadas", "g", "ag_poliinsat_g"),
    ("ag_trans", "Gorduras trans", "g", "ag_trans_g"),
    ("acucar_total", "Açúcares totais", "g", "acucar_total_g"),
]
# Alimentos cadastrados pelo nutricionista ("Meus Alimentos") usam o formato antigo por_100g.
_LEGADO = {
    "calcio_mg": "calcio_mg", "ferro_mg": "ferro_mg", "vit_c_mg": "vitamina_c_mg", "sodio_mg": "sodio_mg",
    "potassio_mg": "potassio_mg", "magnesio_mg": "magnesio_mg", "colesterol_mg": "colesterol_mg",
    "fibra_g": "fibras_g", "ag_saturados_g": "acidos_graxos_saturados_g", "ag_monoinsat_g": "acidos_graxos_mono_g",
    "ag_poliinsat_g": "acidos_graxos_poli_g",
}


def idade_de(data_nascimento: Any) -> Optional[int]:
    if not data_nascimento:
        return None
    try:
        nasc = date.fromisoformat(str(data_nascimento)[:10])
    except ValueError:
        return None
    hoje = date.today()
    return hoje.year - nasc.year - ((hoje.month, hoje.day) < (nasc.month, nasc.day))


def sexo_de(valor: Any) -> str:
    return "F" if str(valor or "").strip().upper().startswith("F") else "M"


def dri_referencia(idade: Optional[int], sexo: str, gestante: bool = False) -> tuple[str, dict]:
    """Devolve (rótulo da faixa, valores de referência). Sem idade, assume adulto de 31-50 anos."""
    i = idade if idade is not None else 35
    if gestante and sexo == "F" and i >= 14:
        chave = "gestante-14-18" if i < 19 else "gestante-19-30" if i < 31 else "gestante-31-50"
        return f"Gestante, {chave.split('-', 1)[1]} anos", _DRI[(chave, "F")]
    if i < 4:
        faixa, s = "1-3", "*"
    elif i < 9:
        faixa, s = "4-8", "*"
    elif i < 14:
        faixa, s = "9-13", sexo
    elif i < 19:
        faixa, s = "14-18", sexo
    elif i < 31:
        faixa, s = "19-30", sexo
    elif i < 51:
        faixa, s = "31-50", sexo
    elif i < 71:
        faixa, s = "51-70", sexo
    else:
        faixa, s = "70+", sexo
    rotulo_sexo = "" if s == "*" else (" (feminino)" if s == "F" else " (masculino)")
    return f"{faixa} anos{rotulo_sexo}", _DRI[(faixa, s)]


def build_dieta_router(db, require_nutritionist, h) -> APIRouter:
    """`h` traz helpers do server.py: enrich_plano, coerce_float, macros_100g, pdf_escape, pdf_nl2br, HTML, TZ_BR, iso, now_utc."""
    router = APIRouter()

    async def _config(user_id: str) -> dict:
        salvo = await db.dieta_config.find_one({"nutricionista_id": user_id}, {"_id": 0}) or {}
        return {**CONFIG_PADRAO, **{k: v for k, v in salvo.items() if k in CONFIG_PADRAO and v is not None}}

    async def _paciente(pid: str, user: dict) -> dict:
        p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]}, {"_id": 0})
        if not p:
            raise HTTPException(404, "Paciente não encontrado")
        return p

    # ── Configurações ──
    @router.get("/dieta/config")
    async def get_config(user=Depends(require_nutritionist)):
        return await _config(user["id"])

    @router.put("/dieta/config")
    async def put_config(payload: DietaConfigIn, user=Depends(require_nutritionist)):
        upd = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
        for campo, validos in _ENUMS_CONFIG.items():
            if campo in upd and upd[campo] not in validos:
                raise HTTPException(400, f"Valor inválido para {campo}")
        if "tabelas_alimentos" in upd:
            upd["tabelas_alimentos"] = [t for t in TABELAS_ALIMENTOS if t in set(upd["tabelas_alimentos"])]
        for campo in _LISTAS_CONFIG:
            if campo in upd:
                vistos, limpos = set(), []
                for item in upd[campo]:
                    txt = str(item or "").strip()[:200]
                    if txt and txt.lower() not in vistos:
                        vistos.add(txt.lower())
                        limpos.append(txt)
                upd[campo] = limpos[:200]
        if "refeicoes_padrao" in upd:
            upd["refeicoes_padrao"] = [
                {"nome": str(r.get("nome") or "").strip()[:80], "horario": str(r.get("horario") or "").strip()[:20]}
                for r in upd["refeicoes_padrao"][:12] if str(r.get("nome") or "").strip()
            ]
        upd["atualizado_em"] = h.iso(h.now_utc())
        await db.dieta_config.update_one({"nutricionista_id": user["id"]}, {"$set": upd}, upsert=True)
        return await _config(user["id"])

    # ── Itens reutilizáveis (modelos de refeição e listas de substituição) ──
    async def _enriquecer_itens(itens: list) -> list:
        """Anexa macros por 100 g e medidas caseiras para o editor calcular sem ida extra ao servidor."""
        ids = [i.get("alimento_id") for i in itens if i.get("alimento_id")]
        docs = {d["id"]: d async for d in db.alimentos.find({"id": {"$in": ids}}, {"_id": 0})} if ids else {}
        saida = []
        for item in itens:
            doc = docs.get(item.get("alimento_id"))
            extra = {}
            if doc:
                extra = {
                    "nome": item.get("nome") or doc.get("nome"),
                    "alimento_nome": doc.get("nome"),
                    "macros_100g": h.macros_100g(doc),
                    "medidas": h.medidas_do_alimento(doc),
                }
            saida.append({**item, **extra})
        return saida

    def _limpar_itens(itens: List[ItemModeloIn]) -> list:
        return [i.model_dump() for i in itens if i.alimento_id or (i.nome or "").strip()]

    def _crud_itens(colecao: str, rota: str, modelo, campos_extra: tuple):
        @router.get(rota)
        async def listar(user=Depends(require_nutritionist)):
            docs = [d async for d in db[colecao].find({"nutricionista_id": user["id"]}, {"_id": 0}).sort("nome", 1)]
            return [{**d, "alimentos": await _enriquecer_itens(d.get("alimentos") or [])} for d in docs]

        @router.post(rota, status_code=201)
        async def criar(payload: modelo, user=Depends(require_nutritionist)):
            agora = h.iso(h.now_utc())
            doc = {
                "id": str(uuid.uuid4()), "nutricionista_id": user["id"], "nome": payload.nome.strip(),
                **{c: getattr(payload, c) for c in campos_extra},
                "alimentos": _limpar_itens(payload.alimentos), "criado_em": agora, "atualizado_em": agora,
            }
            await db[colecao].insert_one(doc)
            doc.pop("_id", None)
            return {**doc, "alimentos": await _enriquecer_itens(doc["alimentos"])}

        @router.put(rota + "/{mid}")
        async def atualizar(mid: str, payload: modelo, user=Depends(require_nutritionist)):
            upd = {
                "nome": payload.nome.strip(), **{c: getattr(payload, c) for c in campos_extra},
                "alimentos": _limpar_itens(payload.alimentos), "atualizado_em": h.iso(h.now_utc()),
            }
            res = await db[colecao].update_one({"id": mid, "nutricionista_id": user["id"]}, {"$set": upd})
            if res.matched_count == 0:
                raise HTTPException(404, "Registro não encontrado")
            doc = await db[colecao].find_one({"id": mid}, {"_id": 0})
            return {**doc, "alimentos": await _enriquecer_itens(doc.get("alimentos") or [])}

        @router.delete(rota + "/{mid}")
        async def apagar(mid: str, user=Depends(require_nutritionist)):
            res = await db[colecao].delete_one({"id": mid, "nutricionista_id": user["id"]})
            if res.deleted_count == 0:
                raise HTTPException(404, "Registro não encontrado")
            return {"ok": True}

    _crud_itens("modelos_refeicao", "/dieta/modelos-refeicao", ModeloRefeicaoIn, ("observacao",))
    _crud_itens("listas_substituicao", "/dieta/listas-substituicao", ListaSubstituicaoIn, ())

    # ── Modelos de dieta: o CRUD de criação/aplicação já existe em server.py ──
    @router.delete("/plano-templates/{tid}")
    async def apagar_modelo_dieta(tid: str, user=Depends(require_nutritionist)):
        res = await db.plano_templates.delete_one({"id": tid, "nutricionista_id": user["id"]})
        if res.deleted_count == 0:
            raise HTTPException(404, "Modelo não encontrado")
        return {"ok": True}

    @router.put("/patients/{pid}/planos-manuais-ordem")
    async def ordenar_planos(pid: str, payload: OrdemPlanosIn, user=Depends(require_nutritionist)):
        await _paciente(pid, user)
        for pos, pmid in enumerate(payload.ids):
            await db.planos_manuais.update_one({"id": pmid, "paciente_id": pid}, {"$set": {"ordem": pos}})
        return {"ok": True}

    # ── Análise de vitaminas e minerais ──
    async def _analisar(itens: list[dict], paciente: dict) -> dict:
        ids = list({i["alimento_id"] for i in itens if i.get("alimento_id")})
        docs = {d["id"]: d async for d in db.alimentos.find({"id": {"$in": ids}}, {"_id": 0})} if ids else {}
        totais: dict[str, float] = {}
        sem_dado: dict[str, int] = {}
        contados = 0
        for item in itens:
            doc = docs.get(item.get("alimento_id"))
            g = h.coerce_float(item.get("quantidade_g")) or 0
            if not doc or g <= 0:
                continue
            contados += 1
            if "nutrientes" in doc:
                n100, fator = doc.get("nutrientes") or {}, g / 100.0
            else:
                p = doc.get("por_100g") or {}
                n100 = {k: p.get(v) for k, v in _LEGADO.items()}
                fator = g / (h.coerce_float(doc.get("quantidade_referencia_g")) or 100.0)
            for _, _, _, chave in VITAMINAS + MINERAIS + OUTROS:
                if not chave:
                    continue
                valor = h.coerce_float(n100.get(chave))
                if valor is None:
                    sem_dado[chave] = sem_dado.get(chave, 0) + 1
                    continue
                totais[chave] = totais.get(chave, 0.0) + valor * fator
        idade = idade_de(paciente.get("data_nascimento"))
        sexo = sexo_de(paciente.get("sexo"))
        faixa, ref = dri_referencia(idade, sexo, bool(paciente.get("gestante")))

        def linhas(catalogo):
            out = []
            for codigo, rotulo, unidade, chave in catalogo:
                referencia = ref.get(codigo)
                valor = round(totais.get(chave, 0.0), 2) if chave else None
                out.append({
                    "codigo": codigo, "nome": rotulo, "unidade": unidade, "valor": valor,
                    "referencia": referencia, "disponivel": chave is not None,
                    "alimentos_sem_dado": sem_dado.get(chave, 0) if chave else 0,
                    "adequacao": round(valor / referencia * 100, 1) if (valor is not None and referencia) else None,
                })
            return out

        return {
            "referencia": {"idade": idade, "sexo": sexo, "gestante": bool(paciente.get("gestante")), "faixa": faixa},
            "alimentos_considerados": contados,
            "vitaminas": linhas(VITAMINAS),
            "minerais": linhas(MINERAIS),
            "outros": linhas(OUTROS),
        }

    @router.post("/patients/{pid}/dieta/analise")
    async def analisar(pid: str, payload: AnaliseIn, user=Depends(require_nutritionist)):
        paciente = await _paciente(pid, user)
        return await _analisar([i.model_dump() for i in payload.itens], paciente)

    # ── PDFs ──
    def _plural(medida: str, qtd: float) -> str:
        """'Colher de Sopa' -> 'colher de sopa' / 'colheres de sopa' (como no NutriDiet)."""
        texto = (medida or "").strip().lower().replace("file", "filé") if medida else ""
        if not texto or qtd is None or qtd <= 1:
            return texto
        palavras = texto.split()
        adjetivos = {"pequeno", "pequena", "médio", "média", "medio", "media", "grande", "cheio", "cheia", "raso",
                     "rasa", "americano", "fundo", "fino", "fina", "grosso", "grossa", "duplo"}

        def pl(p: str) -> str:
            if p.endswith("ão"):
                return p[:-2] + "ões"
            if p.endswith(("r", "z")):
                return p + "es"
            if p.endswith("l"):
                return p[:-1] + "is"
            if p.endswith("s"):
                return p
            return p + "s"

        palavras[0] = pl(palavras[0])
        for i in range(1, len(palavras)):
            if palavras[i] in adjetivos and palavras[i - 1] != "de":
                palavras[i] = pl(palavras[i])
        return " ".join(palavras)

    def _num(v: Any, casas: int = 1) -> str:
        n = h.coerce_float(v)
        if n is None:
            return "0"
        if abs(n - round(n)) < 0.05:
            return str(int(round(n)))
        return f"{n:.{casas}f}".replace(".", ",")

    def _quantidade(item: dict, layout: str) -> str:
        medida = item.get("medida_nome") or ""
        tem_medida = medida and medida.lower() != "gramas"
        g = h.coerce_float(item.get("quantidade_g")) or 0
        unidade = item.get("unidade") or ("mL" if "ml" in medida.lower() else "g")
        gramas = f"{_num(g)}{unidade}" if g else ""
        if not tem_medida or layout == "gramas":
            return gramas
        qtd = h.coerce_float(item.get("quantidade")) or 0
        caseira = f"{_num(qtd)} {_plural(medida, qtd)}".strip()
        if layout == "medida":
            return caseira
        return f"{caseira} ({gramas})" if gramas else caseira

    def _nome_item(item: dict) -> str:
        return item.get("nome") or item.get("alimento_nome") or ""

    def _texto_substitutos(item: dict, layout: str) -> list[str]:
        return [f"{_quantidade(s, layout)} de {s.get('nome') or s.get('alimento_nome') or ''}".strip()
                for s in (item.get("substitutos") or [])]

    def _linhas_alimentos(alimentos: list, cfg: dict) -> str:
        layout = cfg["layout_calculos"]
        html_out = ""
        for idx, item in enumerate(alimentos):
            nome = _nome_item(item)
            if not nome:
                continue
            subs = _texto_substitutos(item, layout)
            obs = (item.get("observacao") or "").strip()
            modo = cfg["layout_lista_substituicao"]
            if subs and modo == "nome_obs":
                nome = " ou ".join([nome] + [s.get("nome") or "" for s in item.get("substitutos") or []])
            if subs and modo in ("nome_obs", "obs"):
                obs = " ".join(filter(None, [obs] + [f"ou {s}" for s in subs]))
            alt = " alt" if cfg["layout_linhas"] == "alternadas" and idx % 2 else ""
            html_out += (f'<tr class="food{alt}"><td>{h.pdf_escape(nome)}'
                         + (f'<div class="obs">{h.pdf_escape(obs)}</div>' if obs else "")
                         + (("".join(f'<div class="sub">ou {h.pdf_escape(s)}</div>' for s in subs)) if subs and modo == "lista" else "")
                         + f'</td><td class="qtd">{h.pdf_escape(_quantidade(item, layout))}</td></tr>')
        return html_out

    def _macros_txt(totais: dict) -> str:
        return (f'<p class="macros">Kcal {_num(totais.get("energia_kcal"), 0)} · CHO {_num(totais.get("carboidratos_g"))}g'
                f' · PTN {_num(totais.get("proteinas_g"))}g · LIP {_num(totais.get("lipidios_g"))}g</p>')

    def _cabecalho(nutri: dict, titulo: str, paciente: dict, extra_linha: str = "") -> str:
        logo = nutri.get("logo_url") or ""
        logo_html = f'<img src="{logo}" class="logo"/>' if logo else ""
        info = [nutri.get("clinica_nome"), nutri.get("name") or nutri.get("nome"),
                f'CRN {nutri.get("crn")}' if nutri.get("crn") else None,
                nutri.get("telefone_clinica") or nutri.get("telefone"), nutri.get("site")]
        info_html = "<br/>".join(h.pdf_escape(i) for i in info if i)
        idade = idade_de(paciente.get("data_nascimento"))
        dados = []
        if idade is not None:
            dados.append(f"Idade: {idade} anos")
        if paciente.get("peso"):
            dados.append(f"Peso: {_num(paciente.get('peso'))} kg")
        if paciente.get("altura"):
            dados.append(f"Altura: {_num(paciente.get('altura'))} cm")
        return (f'<div class="top"><div>{logo_html}</div><div class="info">{info_html}</div></div>'
                f'<div class="bar">{h.pdf_escape(titulo)}</div>'
                f'<table class="pac"><tr><td><b>Nome: {h.pdf_escape(paciente.get("nome") or "")}</b></td>'
                f'<td class="r"><b>Data: {datetime.now(h.TZ_BR).strftime("%d/%m/%Y")}</b></td></tr>'
                + (f'<tr><td colspan="2"><b>{" &nbsp;&nbsp; ".join(dados)}</b></td></tr>' if dados else "")
                + f'</table>{extra_linha}')

    def _documento(corpo: str, nutri: dict, cor: str) -> str:
        rodape = " · ".join(h.pdf_escape(x) for x in [nutri.get("name") or nutri.get("nome"),
                                                       f'CRN {nutri.get("crn")}' if nutri.get("crn") else None,
                                                       nutri.get("clinica_endereco")] if x)
        return f"""<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"/><style>
@page {{ size: A4; margin: 1.6cm 1.7cm 2cm 1.7cm;
  @bottom-center {{ content: "{rodape}  ·  " counter(page); font-size: 8pt; color: #888; }} }}
body {{ font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; color: #222; }}
.top {{ display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #333; padding-top: 10px; }}
.logo {{ max-height: 70px; max-width: 200px; object-fit: contain; }}
.info {{ text-align: right; font-size: 9pt; color: #444; line-height: 1.4; }}
.bar {{ border-top: 1px solid #333; border-bottom: 1px solid #333; margin-top: 10px; padding: 4px 0;
  text-align: center; font-weight: bold; color: {cor}; font-size: 11pt; }}
table {{ width: 100%; border-collapse: collapse; }}
.pac td {{ padding: 3px 4px; font-size: 10pt; }} .pac {{ border-bottom: 1px solid #333; margin-bottom: 12px; }}
.r {{ text-align: right; }}
.obj {{ font-weight: bold; margin: 10px 0 4px 2px; }}
.titulo {{ text-align: center; font-weight: bold; color: {cor}; margin: 14px 0 8px; font-size: 11pt; }}
.ref {{ page-break-inside: avoid; margin-bottom: 14px; }}
.ref h3 {{ font-size: 10.5pt; margin: 0 0 4px 2px; text-transform: uppercase; }}
.food td {{ padding: 4px 2px; vertical-align: top; }} .food .qtd {{ width: 45%; }}
.food.alt td {{ background: #f3f3f3; }}
.obs {{ font-size: 9pt; color: #555; font-style: italic; margin-top: 1px; }}
.sub {{ font-size: 9pt; color: #444; margin-top: 1px; padding-left: 10px; }}
.ou {{ font-weight: bold; color: {cor}; margin: 6px 0 2px 2px; font-size: 9.5pt; }}
.refobs {{ font-size: 9pt; color: #444; font-style: italic; margin: 3px 2px 0; }}
.macros {{ font-size: 8.5pt; color: #666; margin: 3px 2px 0; }}
.sec {{ font-weight: bold; color: {cor}; margin: 18px 0 6px; font-size: 11pt; border-bottom: 1px solid #ddd; padding-bottom: 3px; }}
.rec h4 {{ margin: 8px 0 2px; font-size: 10pt; }} .rec p {{ margin: 0 0 6px; white-space: pre-wrap; }}
.tab th {{ text-align: left; font-size: 9.5pt; border-bottom: 1px solid #999; padding: 4px; }}
.tab td {{ font-size: 9.5pt; padding: 3px 4px; border-bottom: 1px solid #eee; }}
.baixo {{ color: #c0392b; }} .ok {{ color: #1f6fb2; }}
.nota {{ font-size: 8.5pt; color: #666; margin-top: 6px; }}
</style></head><body>{corpo}</body></html>"""

    async def _carregar(pid: str, pmid: str, user: dict):
        paciente = await _paciente(pid, user)
        doc = await db.planos_manuais.find_one({"id": pmid, "paciente_id": pid}, {"_id": 0})
        if not doc:
            raise HTTPException(404, "Plano não encontrado")
        plano = await h.enrich_plano(doc)
        nutri = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0}) or {}
        return paciente, plano, nutri

    def _pdf(html_str: str, nome: str) -> Response:
        if h.HTML is None:
            raise HTTPException(503, "Gerador de PDF indisponível no servidor")
        pdf = h.HTML(string=html_str).write_pdf()
        return Response(content=pdf, media_type="application/pdf",
                        headers={"Content-Disposition": f'inline; filename="{nome}"'})

    @router.get("/patients/{pid}/relatorios/dieta/{pmid}")
    async def pdf_dieta(pid: str, pmid: str, user=Depends(require_nutritionist)):
        paciente, plano, nutri = await _carregar(pid, pmid, user)
        cfg = await _config(user["id"])
        cor = (nutri.get("cor_relatorio") or "#0068D1").strip() or "#0068D1"
        peso_plano = (plano.get("prescricao_dietetica") or {}).get("peso")
        pac = {**paciente, "peso": h.coerce_float(peso_plano) or paciente.get("peso")}
        corpo = _cabecalho(nutri, "Plano Alimentar", pac)
        if plano.get("objetivo"):
            corpo += f'<div class="obj">{h.pdf_escape(plano["objetivo"])}</div>'
        corpo += f'<div class="titulo">{h.pdf_escape(plano.get("titulo") or "Plano Alimentar")}</div>'
        for ref in plano.get("refeicoes") or []:
            nome = (ref.get("nome") or "").strip()
            horario = (ref.get("horario") or "").strip()
            alimentos = _linhas_alimentos(ref.get("alimentos") or [], cfg)
            opcoes_html = ""
            for op in ref.get("opcoes") or []:
                linhas = _linhas_alimentos(op.get("alimentos") or [], cfg)
                if not linhas and not (op.get("observacao") or "").strip():
                    continue
                opcoes_html += (f'<div class="ou">OU</div><table>{linhas}</table>'
                                + (f'<p class="refobs">{h.pdf_nl2br(op["observacao"])}</p>' if (op.get("observacao") or "").strip() else "")
                                + (_macros_txt(op.get("totais") or {}) if cfg["incluir_macros_pdf"] else ""))
            if not (nome or alimentos or opcoes_html):
                continue
            titulo_ref = h.pdf_escape(nome) + (f" ({h.pdf_escape(horario)})" if horario else "")
            corpo += (f'<div class="ref"><h3>{titulo_ref}</h3><table>{alimentos}</table>'
                      + (f'<p class="refobs">{h.pdf_nl2br(ref["observacao"])}</p>' if (ref.get("observacao") or "").strip() else "")
                      + (_macros_txt(ref.get("totais") or {}) if cfg["incluir_macros_pdf"] else "")
                      + opcoes_html + "</div>")
        if cfg["incluir_macros_pdf"]:
            t = plano.get("totais_dia") or {}
            corpo += f'<div class="sec">Total da dieta</div>{_macros_txt(t)}'
        listas = [ls for ls in (plano.get("listas_substituicao") or []) if ls.get("alimentos")]
        if listas:
            corpo += '<div class="sec">Lista de substituição</div>'
            for ls in listas:
                corpo += f'<div class="ref"><h3>{h.pdf_escape(ls.get("nome") or "")}</h3><table>{_linhas_alimentos(ls["alimentos"], {**cfg, "layout_lista_substituicao": "lista"})}</table></div>'
        if cfg["incluir_observacoes"]:
            recs = [r for r in (plano.get("recomendacoes") or []) if (r.get("titulo") or r.get("texto") or "").strip()]
            orientacoes = plano.get("orientacoes") or []
            legado = (plano.get("observacoes") or "").strip()
            if recs or orientacoes or legado:
                corpo += '<div class="sec">Observações</div><div class="rec">'
                for r in recs:
                    corpo += (f'<h4>{h.pdf_escape(r.get("titulo") or "")}</h4>' if (r.get("titulo") or "").strip() else "") + f'<p>{h.pdf_nl2br(r.get("texto") or "")}</p>'
                for o in orientacoes:
                    corpo += f'<h4>{h.pdf_escape(o.get("titulo") or "")}</h4><p>{h.pdf_nl2br(o.get("conteudo") or "")}</p>'
                if legado:
                    corpo += f"<p>{h.pdf_nl2br(legado)}</p>"
                corpo += "</div>"
        nome_arq = f"dieta_{(paciente.get('nome') or 'paciente').replace(' ', '_')}.pdf"
        return _pdf(_documento(corpo, nutri, cor), nome_arq)

    @router.get("/patients/{pid}/relatorios/dieta/{pmid}/nutrientes")
    async def pdf_nutrientes(pid: str, pmid: str, user=Depends(require_nutritionist)):
        paciente, plano, nutri = await _carregar(pid, pmid, user)
        cor = (nutri.get("cor_relatorio") or "#0068D1").strip() or "#0068D1"
        itens = [a for ref in plano.get("refeicoes") or [] for a in ref.get("alimentos") or []]
        analise = await _analisar(itens, paciente)
        t = plano.get("totais_dia") or {}
        kcal = t.get("energia_kcal") or 0
        peso = h.coerce_float((plano.get("prescricao_dietetica") or {}).get("peso")) or h.coerce_float(paciente.get("peso"))
        ptn, cho, lip = t.get("proteinas_g") or 0, t.get("carboidratos_g") or 0, t.get("lipidios_g") or 0
        pct = lambda g, f: f"{round(g * f / kcal * 100) if kcal else 0}%"
        gn = ptn / 6.25
        linhas = [
            ("Kcal", _num(kcal, 0)), ("CHO", f"{_num(cho)} g ({pct(cho, 4)})"), ("PTN", f"{_num(ptn)} g ({pct(ptn, 4)})"),
            ("LIP", f"{_num(lip)} g ({pct(lip, 9)})"),
        ]
        if peso:
            linhas += [("Kcal/kg", _num(kcal / peso)), ("g de CHO/kg", _num(cho / peso)), ("g de PTN/kg", _num(ptn / peso)),
                       ("g de LIP/kg", _num(lip / peso))]
        linhas += [("Kcal não proteica/gN", _num((cho * 4 + lip * 9) / gn) if gn else "0"), ("Fibras", f"{_num(t.get('fibras_g'))} g")]
        corpo = _cabecalho(nutri, "Relatório de nutrientes", paciente)
        corpo += f'<div class="titulo">{h.pdf_escape(plano.get("titulo") or "Plano Alimentar")}</div>'
        corpo += '<div class="sec">Total da dieta</div><table class="tab">' + "".join(
            f"<tr><td><b>{h.pdf_escape(a)}</b></td><td>{b}</td></tr>" for a, b in linhas) + "</table>"

        def tabela(titulo: str, rows: list) -> str:
            out = f'<div class="sec">{titulo}</div><table class="tab"><tr><th>Nutriente</th><th>Dieta</th><th>Referência</th><th>Adequação</th></tr>'
            for r in rows:
                if not r["disponivel"]:
                    out += f'<tr><td>{h.pdf_escape(r["nome"])} *</td><td>—</td><td>{_num(r["referencia"])} {r["unidade"]}</td><td>—</td></tr>'
                    continue
                classe = "ok" if (r["adequacao"] or 0) >= 100 else "baixo"
                marca = " **" if r["alimentos_sem_dado"] else ""
                out += (f'<tr><td>{h.pdf_escape(r["nome"])}{marca}</td><td>{_num(r["valor"])} {r["unidade"]}</td>'
                        f'<td>{_num(r["referencia"])} {r["unidade"]}</td>'
                        f'<td class="{classe}">{_num(r["adequacao"]) + "%" if r["adequacao"] is not None else "—"}</td></tr>')
            return out + "</table>"

        corpo += tabela("Vitaminas", analise["vitaminas"]) + tabela("Minerais", analise["minerais"])
        corpo += (f'<p class="nota"><b>Referência (DRI): {h.pdf_escape(analise["referencia"]["faixa"])}</b><br/>'
                  "* Nutriente não presente na tabela de alimentos utilizada.<br/>"
                  "** Algum alimento da dieta não tem este nutriente informado na tabela (valor pode estar subestimado).</p>")
        nome_arq = f"nutrientes_{(paciente.get('nome') or 'paciente').replace(' ', '_')}.pdf"
        return _pdf(_documento(corpo, nutri, cor), nome_arq)

    return router
