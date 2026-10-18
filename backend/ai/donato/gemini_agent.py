"""Dr. Donatto com Gemini: base de conhecimento no prompt + cardapio EVONUT fechado.

Sem File Search (exclusivo da OpenAI), a base aprovada vai inteira no prompt
(cabe com folga no contexto da Gemini) e a IA so pode escolher alimentos de um
cardapio com IDs reais da EVONUT. Os nutrientes finais sao sempre recalculados
pelo backend; a IA nunca define os numeros que o nutricionista ve.
"""
import json
import re
import unicodedata
from typing import Any

from .schemas import DONATO_PLAN_DRAFT_SCHEMA

# Ordem de leitura da base: normas e motor primeiro, protocolos depois.
_PRIORITY_ORDER = {"critical": 0, "high": 1, "support": 2}

# Itens comuns na pratica esportiva que nao existem na TACO.
_EXTRA_FOOD_PATTERNS = [
    "^whey", "til[aá]pia", "peito de peru", "pasta de amendoim", "^tapioca", "^chia",
    "cottage", "^tofu", "^granola", "^quinoa", "^cuscuz", "^atum",
]

RUNTIME_PROMPT = """Você é o Dr. Donatto AI, agente interno de apoio ao nutricionista Rogério Costa.
Sua tarefa é gerar um RASCUNHO estruturado de plano alimentar para revisão humana obrigatória.

REGRAS INEGOCIÁVEIS
1. Siga a BASE DE CONHECIMENTO abaixo (protocolos clínicos, motor nutricional, biblioteca e manual de saída). Ela tem prioridade sobre o seu conhecimento geral.
2. Use SOMENTE alimentos do CARDÁPIO EVONUT fornecido, copiando exatamente o "id" no campo alimento_id e o nome no campo nome. Nunca invente alimentos ou IDs. Alternativas também precisam vir do cardápio.
3. Respeite alergias, intolerâncias, aversões e restrições do paciente em TODOS os alimentos E TODAS as alternativas (ex.: quem não come peixe não pode receber atum ou sardinha como substituto). Considere a rotina (horário de treino), os sintomas e os exames laboratoriais ao escolher alimentos.
3a. Mantenha a proteína dentro da faixa do motor nutricional para o objetivo (em geral 1,6 a 2,2 g/kg para emagrecimento com treino de força); varie as fontes proteicas entre as refeições.
3b. Enzimas hepáticas (TGO/TGP) elevadas em quem treina intensamente podem ter origem muscular; não afirme esteatose com base apenas nelas.
4. Defina a meta energética a partir do gasto energético total informado e do objetivo, seguindo o motor nutricional da base. Informe essa meta em resumo_nutricional.valor_energetico_total_kcal e explique o cálculo em justificativa_tecnica.
5. Escolha quantidades em gramas (quantidade.peso_g) para que a soma do plano atinja a meta e a distribuição de macronutrientes definida. Use as kcal/100 g e macros do cardápio para calcular. Inclua medida caseira legível.
6. Não prescreva medicamentos nem suplementos com doses; se houver suplemento em uso, apenas registre em observacoes.
7. Use null para dados ausentes e liste o que falta em dados_pendentes. Nunca invente dados clínicos.
8. Em evidencias, cite os documentos da base usados (source_document_id e título).
9. status deve ser "draft_ai" (ou "needs_data" se faltarem dados essenciais). versao_schema "1.1". tipo_resposta "plano_alimentar".
10. Responda APENAS com um objeto JSON válido no CONTRATO JSON abaixo, sem markdown e sem texto fora do JSON.
"""


async def load_knowledge(db) -> list[dict[str, Any]]:
    docs = await db.agent_documents.find(
        {"agent_code": "donato", "status": "approved"},
        {"_id": 0, "title": 1, "content": 1, "source_document_id": 1, "priority_class": 1, "document_type": 1},
    ).to_list(100)
    docs = [d for d in docs if (d.get("content") or "").strip()]
    docs.sort(key=lambda d: (_PRIORITY_ORDER.get(d.get("priority_class") or "", 3), str(d.get("source_document_id") or "")))
    return docs


def _food_row(food: dict[str, Any]) -> dict[str, Any] | None:
    n = food.get("nutrientes") or {}
    kcal = n.get("energia_kcal")
    if kcal is None:
        return None
    r = lambda v: round(float(v), 1) if isinstance(v, (int, float)) else None  # noqa: E731
    return {
        "id": str(food.get("id")),
        "nome": food.get("nome"),
        "grupo": food.get("grupo"),
        "kcal": r(kcal),
        "ptn": r(n.get("proteina_g")),
        "cho": r(n.get("carboidrato_g")),
        "lip": r(n.get("lipideos_g")),
        "fib": r(n.get("fibra_g")),
    }


async def build_food_catalog(db) -> list[dict[str, Any]]:
    """Cardapio fechado: toda a TACO (generica, nomes padronizados) + essenciais esportivos de outras fontes."""
    catalog: dict[str, dict[str, Any]] = {}
    async for food in db.alimentos.find({"fonte": "TACO"}, {"_id": 0}):
        row = _food_row(food)
        if row:
            catalog[row["id"]] = row
    for pattern in _EXTRA_FOOD_PATTERNS:
        candidates = await db.alimentos.find({"nome": {"$regex": pattern, "$options": "i"}}, {"_id": 0}).to_list(40)
        rows = [r for r in (_food_row(c) for c in candidates) if r]
        rows.sort(key=lambda r: len(r["nome"] or ""))  # nome mais curto tende a ser o item generico
        for row in rows[:2]:
            catalog.setdefault(row["id"], row)
    return sorted(catalog.values(), key=lambda r: (r.get("grupo") or "", r.get("nome") or ""))


def build_prompt(context: dict[str, Any], knowledge: list[dict[str, Any]], catalog: list[dict[str, Any]]) -> tuple[str, str]:
    """Retorna (system_prompt, user_prompt)."""
    kb = "\n\n".join(
        f"### [{d.get('source_document_id')}] {d.get('title')}\n{d['content'].strip()}" for d in knowledge
    )
    cardapio = "\n".join(
        f"{f['id']} | {f['nome']} | {f['kcal']} kcal | P {f['ptn']} | C {f['cho']} | G {f['lip']} | fibra {f['fib']}"
        for f in catalog
    )
    system = (
        RUNTIME_PROMPT
        + "\n--- BASE DE CONHECIMENTO (Dr. Donatto) ---\n" + kb
        + "\n\n--- CONTRATO JSON (schema obrigatório da resposta) ---\n"
        + json.dumps(DONATO_PLAN_DRAFT_SCHEMA, ensure_ascii=False)
    )
    user = (
        "CARDÁPIO EVONUT PERMITIDO (id | nome | valores por 100 g):\n" + cardapio
        + "\n\nCONTEXTO CLÍNICO DO PACIENTE:\n" + json.dumps(context, ensure_ascii=False, default=str)
        + "\n\nGere o rascunho do plano alimentar em JSON seguindo o contrato."
    )
    return system, user


def build_correction_prompt(draft: dict[str, Any], problemas: list[str]) -> str:
    lista = "\n".join(f"- {p}" for p in problemas)
    return (
        "O backend recalculou o plano com os valores reais da base EVONUT e encontrou estes problemas:\n"
        + lista
        + "\n\nCorrija-os ajustando quantidades e, se necessario, trocando alimentos ou alternativas por outros do "
        "CARDAPIO EVONUT. Mantenha a meta energetica que voce definiu. Os nutrientes de cada item abaixo ja sao os "
        "valores reais da base. Responda com o JSON completo e corrigido.\n\n"
        + json.dumps(draft, ensure_ascii=False, default=str)
    )


def parse_json(raw: str) -> dict[str, Any]:
    text = (raw or "").strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text
        text = text.rsplit("```", 1)[0]
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start : end + 1])
        raise


# Restricao declarada -> padroes de alimentos que a violam (checagem deterministica no backend)
_RESTRICOES = [
    (r"peixe|frutos do mar", r"peixe|atum|sardinha|til[aá]pia|salm[aã]o|pescada|merluza|bacalhau|manjuba|camar[aã]o|lula|polvo"),
    (r"carne vermelha|carne bovina|carnes vermelhas", r"bovin|patinho|ac[eé]m|alcatra|contrafil|cupim|maminha|fraldinha|picanha|cox[aã]o|lagarto|carne, |su[ií]n|porco|lombo|cordeiro|carneiro"),
    (r"f[ií]gado", r"f[ií]gado"),
    (r"lactose|leite", r"leite|queijo|iogurte|requeij|creme de leite|whey"),
    (r"gl[uú]ten|celiac", r"trigo|p[aã]o|macarr|biscoito|cevada|centeio"),
    (r"ovo", r"\bovo"),
    (r"amendoim", r"amendoim"),
]


def _norm(text: str) -> str:
    return unicodedata.normalize("NFC", (text or "").lower())


def quality_warnings(draft: dict[str, Any]) -> list[str]:
    """Checagens clinicas deterministicas que nao dependem da obediencia da IA."""
    avisos: list[str] = []
    paciente = draft.get("paciente") or {}
    declarado = _norm(" ".join(
        str(x) for k in ("restricoes_alimentares", "alergias", "intolerancias") for x in (paciente.get(k) or [])
    ))
    proibidos = [(rest, pat) for rest, pat in _RESTRICOES if re.search(rest, declarado)]
    for meal in draft.get("refeicoes") or []:
        for item in meal.get("alimentos") or []:
            candidatos = [("alimento", item.get("nome"))] + [("alternativa", a.get("nome")) for a in item.get("alternativas") or []]
            for tipo, nome in candidatos:
                for rest, pat in proibidos:
                    if nome and re.search(pat, _norm(nome)):
                        avisos.append(f"Restricao '{rest.split('|')[0]}' violada: {tipo} '{nome}' em {meal.get('nome')}.")
    ptn = ((draft.get("resumo_nutricional") or {}).get("proteinas") or {}).get("gramas_por_kg")
    if isinstance(ptn, (int, float)) and (ptn > 2.5 or ptn < 1.0):
        avisos.append(f"Proteina em {ptn} g/kg, fora da faixa usual (1,0 a 2,5 g/kg). Revisar.")
    return avisos


def schema_errors(draft: dict[str, Any], limit: int = 8) -> list[str]:
    try:
        from jsonschema import Draft202012Validator
    except Exception:  # noqa: BLE001
        return []
    errors = sorted(Draft202012Validator(DONATO_PLAN_DRAFT_SCHEMA).iter_errors(draft), key=lambda e: list(e.path))
    return [f"Contrato JSON: {'/'.join(str(p) for p in e.path) or 'raiz'}: {e.message[:140]}" for e in errors[:limit]]
