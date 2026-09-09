import json
from typing import Any

from .openai_client import DonatoProviderUnavailable, get_openai_client
from .schemas import DONATO_PLAN_DRAFT_SCHEMA
from .settings import DonatoSettings


def _response_text(response: Any) -> str:
    output_text = getattr(response, "output_text", None)
    if output_text:
        return output_text
    chunks = []
    for item in getattr(response, "output", []) or []:
        for content in getattr(item, "content", []) or []:
            text = getattr(content, "text", None)
            if text:
                chunks.append(text)
    return "\n".join(chunks).strip()


def build_runtime_prompt(schema_version: str) -> str:
    return (
        "Voce e o Dr. Donatto AI, agente interno de apoio ao nutricionista. "
        "Gere somente rascunhos estruturados de plano alimentar para revisao humana. "
        "Nao publique ao paciente, nao invente dados clinicos e use null para campos ausentes. "
        "Use a base recuperada pelo File Search como conhecimento aprovado. "
        "Alimentos e nutrientes finais serao validados pelo backend/EVONUT; preserve alimento_id quando houver. "
        f"Retorne JSON estrito no schema DONATO {schema_version}."
    )


def build_generation_request(context: dict[str, Any], protocols: list[dict[str, Any]]) -> str:
    return json.dumps(
        {
            "tarefa": "Gerar rascunho estruturado de prescricao dietetica DONATO.",
            "clinical_context": context,
            "protocolos_selecionados": protocols,
            "restricoes": [
                "draft_ai apenas",
                "aprovacao humana obrigatoria",
                "dados ausentes como null",
                "nao inventar evidencias",
                "alternativas vinculadas ao alimento original",
            ],
        },
        ensure_ascii=False,
        default=str,
    )


async def generate_donato_plan_with_openai(
    settings: DonatoSettings,
    context: dict[str, Any],
    protocols: list[dict[str, Any]],
    vector_store_id: str | None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    if not vector_store_id:
        raise DonatoProviderUnavailable("OPENAI_DONATO_VECTOR_STORE_ID nao configurado")
    client = get_openai_client(settings)
    response = await client.responses.create(
        model=settings.model,
        input=[
            {"role": "system", "content": build_runtime_prompt(settings.schema_version)},
            {"role": "user", "content": build_generation_request(context, protocols)},
        ],
        tools=[
            {
                "type": "file_search",
                "vector_store_ids": [vector_store_id],
                "max_num_results": settings.max_file_results,
                "filters": {"type": "eq", "key": "agent", "value": "donato"},
            }
        ],
        include=["file_search_call.results"],
        text={
            "format": {
                "type": "json_schema",
                "name": "donato_plan_draft",
                "strict": True,
                "schema": DONATO_PLAN_DRAFT_SCHEMA,
            }
        },
        store=False,
    )
    raw_text = _response_text(response)
    if not raw_text:
        raise DonatoProviderUnavailable("Resposta OpenAI vazia")
    return json.loads(raw_text), {
        "response_id": getattr(response, "id", None),
        "model": settings.model,
        "vector_store_id": vector_store_id,
    }
