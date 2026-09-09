MACRO_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["quantidade_g", "percentual_energetico", "gramas_por_kg"],
    "properties": {
        "quantidade_g": {"type": ["number", "null"]},
        "percentual_energetico": {"type": ["number", "null"]},
        "gramas_por_kg": {"type": ["number", "null"]},
    },
}

QUANTIDADE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["peso_g", "unidade", "medida_caseira"],
    "properties": {
        "peso_g": {"type": ["number", "null"]},
        "unidade": {"type": ["string", "null"]},
        "medida_caseira": {"type": ["string", "null"]},
    },
}

NUTRIENTES_ITEM_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["energia_kcal", "proteinas_g", "carboidratos_g", "gorduras_g", "fibras_g"],
    "properties": {
        "energia_kcal": {"type": ["number", "null"]},
        "proteinas_g": {"type": ["number", "null"]},
        "carboidratos_g": {"type": ["number", "null"]},
        "gorduras_g": {"type": ["number", "null"]},
        "fibras_g": {"type": ["number", "null"]},
    },
}

ALTERNATIVA_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["alimento_id", "nome", "categoria", "quantidade"],
    "properties": {
        "alimento_id": {"type": ["string", "null"]},
        "nome": {"type": "string"},
        "categoria": {"type": "string"},
        "quantidade": QUANTIDADE_SCHEMA,
    },
}

ALIMENTO_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["alimento_id", "nome", "categoria", "quantidade", "modo_preparo", "nutrientes", "alternativas"],
    "properties": {
        "alimento_id": {"type": ["string", "null"]},
        "nome": {"type": "string"},
        "categoria": {"type": "string"},
        "quantidade": QUANTIDADE_SCHEMA,
        "modo_preparo": {"type": ["string", "null"]},
        "nutrientes": NUTRIENTES_ITEM_SCHEMA,
        "alternativas": {"type": "array", "items": ALTERNATIVA_SCHEMA},
    },
}

DONATO_PLAN_DRAFT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "tipo_resposta", "versao_schema", "status", "paciente", "estrategia_nutricional",
        "protocolos_aplicados", "dados_pendentes", "resumo_nutricional", "refeicoes",
        "hidratacao", "orientacoes_gerais", "observacoes", "justificativa_tecnica",
        "evidencias", "validacao",
    ],
    "properties": {
        "tipo_resposta": {"const": "plano_alimentar"},
        "versao_schema": {"const": "1.1"},
        "status": {"type": "string", "enum": ["draft_ai", "needs_data", "needs_review"]},
        "paciente": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "nome", "idade_anos", "sexo", "peso_kg", "altura_cm", "percentual_gordura",
                "objetivo_nutricional", "condicoes_clinicas", "medicamentos",
                "nivel_atividade_fisica", "alergias", "intolerancias",
                "restricoes_alimentares", "preferencias_alimentares",
            ],
            "properties": {
                "nome": {"type": ["string", "null"]},
                "idade_anos": {"type": ["integer", "null"]},
                "sexo": {"type": ["string", "null"]},
                "peso_kg": {"type": ["number", "null"]},
                "altura_cm": {"type": ["number", "null"]},
                "percentual_gordura": {"type": ["number", "null"]},
                "objetivo_nutricional": {"type": ["string", "null"]},
                "condicoes_clinicas": {"type": "array", "items": {"type": "string"}},
                "medicamentos": {"type": "array", "items": {"type": "string"}},
                "nivel_atividade_fisica": {"type": ["string", "null"]},
                "alergias": {"type": "array", "items": {"type": "string"}},
                "intolerancias": {"type": "array", "items": {"type": "string"}},
                "restricoes_alimentares": {"type": "array", "items": {"type": "string"}},
                "preferencias_alimentares": {"type": "array", "items": {"type": "string"}},
            },
        },
        "estrategia_nutricional": {
            "type": "object",
            "additionalProperties": False,
            "required": ["tipo_plano", "objetivo_principal", "numero_refeicoes", "distribuicao_refeicoes", "observacao_estrategica"],
            "properties": {
                "tipo_plano": {"type": ["string", "null"]},
                "objetivo_principal": {"type": ["string", "null"]},
                "numero_refeicoes": {"type": ["integer", "null"]},
                "distribuicao_refeicoes": {"type": ["string", "null"]},
                "observacao_estrategica": {"type": ["string", "null"]},
            },
        },
        "protocolos_aplicados": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["codigo", "titulo", "motivo", "prioridade", "source_document_id"],
                "properties": {
                    "codigo": {"type": "string"},
                    "titulo": {"type": "string"},
                    "motivo": {"type": "string"},
                    "prioridade": {"type": "integer"},
                    "source_document_id": {"type": "string"},
                },
            },
        },
        "dados_pendentes": {"type": "array", "items": {"type": "string"}},
        "resumo_nutricional": {
            "type": "object",
            "additionalProperties": False,
            "required": ["valor_energetico_total_kcal", "peso_utilizado_calculo_kg", "proteinas", "carboidratos", "gorduras", "fibras_g", "agua_recomendada_ml"],
            "properties": {
                "valor_energetico_total_kcal": {"type": ["number", "null"]},
                "peso_utilizado_calculo_kg": {"type": ["number", "null"]},
                "proteinas": MACRO_SCHEMA,
                "carboidratos": MACRO_SCHEMA,
                "gorduras": MACRO_SCHEMA,
                "fibras_g": {"type": ["number", "null"]},
                "agua_recomendada_ml": {"type": ["number", "null"]},
            },
        },
        "refeicoes": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["ordem", "nome", "horario", "resumo_refeicao", "alimentos"],
                "properties": {
                    "ordem": {"type": "integer"},
                    "nome": {"type": "string"},
                    "horario": {"type": ["string", "null"]},
                    "resumo_refeicao": NUTRIENTES_ITEM_SCHEMA,
                    "alimentos": {"type": "array", "items": ALIMENTO_SCHEMA},
                },
            },
        },
        "hidratacao": {
            "type": "object",
            "additionalProperties": False,
            "required": ["quantidade_diaria_ml", "orientacao"],
            "properties": {"quantidade_diaria_ml": {"type": ["number", "null"]}, "orientacao": {"type": ["string", "null"]}},
        },
        "orientacoes_gerais": {"type": "array", "items": {"type": "string"}},
        "observacoes": {"type": "array", "items": {"type": "string"}},
        "justificativa_tecnica": {
            "anyOf": [
                {"type": "null"},
                {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["titulo", "texto"],
                    "properties": {"titulo": {"const": "Justificativa Técnica"}, "texto": {"type": "string"}},
                },
            ]
        },
        "evidencias": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["source_document_id", "titulo", "file_id", "relevancia"],
                "properties": {
                    "source_document_id": {"type": "string"},
                    "titulo": {"type": "string"},
                    "file_id": {"type": ["string", "null"]},
                    "relevancia": {"type": "string"},
                },
            },
        },
        "validacao": {
            "type": "object",
            "additionalProperties": False,
            "required": ["status", "erros", "avisos"],
            "properties": {
                "status": {"type": "string", "enum": ["pending_backend_validation", "needs_data"]},
                "erros": {"type": "array", "items": {"type": "string"}},
                "avisos": {"type": "array", "items": {"type": "string"}},
            },
        },
    },
}
