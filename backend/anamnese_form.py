"""Formulário pré-consulta (5 blocos, 37 perguntas) e a anamnese organizada pelos mesmos blocos.

Fonte única das perguntas: o formulário público (PreConsulta.jsx), a aba Anamnese, o PDF da anamnese e o
contexto dos agentes de IA leem daqui. As opções e as condições seguem o protótipo do Rogério
(artifact "Formulário Pré-consulta", 15/11/2026).

Respostas ficam em `anamnese.formulario = {bloco: {pergunta: valor}}`. O que veio do formato antigo e não tem
pergunta equivalente vai para `anamnese.formulario_outras = {bloco: {rótulo: valor}}` (nada é descartado).
"""
from typing import Optional

SN = ["Sim", "Não"]

BLOCOS = [
    {
        "key": "dados_pessoais", "titulo": "Dados pessoais", "transicao": "Vamos começar pelo básico.",
        "perguntas": [
            {"id": "email", "n": 1, "titulo": "E-mail", "tipo": "email", "obrig": True},
            {"id": "nome", "n": 2, "titulo": "Nome completo", "tipo": "texto", "obrig": True},
            {"id": "data_nascimento", "n": 3, "titulo": "Data de nascimento", "tipo": "data", "obrig": True},
            {"id": "sexo", "n": 4, "titulo": "Sexo biológico", "tipo": "unica", "obrig": True, "opcoes": ["Feminino", "Masculino"]},
            {"id": "estatura", "n": 5, "titulo": "Estatura (em cm)", "tipo": "numero", "obrig": True},
            {"id": "peso_atual", "n": 6, "titulo": "Peso atual (em kg)", "tipo": "numero", "obrig": True},
        ],
    },
    {
        "key": "objetivos_treinamento", "titulo": "Objetivos e treinamento",
        "transicao": "Prazer, {nome}! Agora, sobre o seu treino.",
        "perguntas": [
            {"id": "objetivo", "n": 7, "titulo": "Quais objetivos você quer alcançar?", "tipo": "longo"},
            {"id": "condicionamento", "n": 8, "titulo": "Como está seu condicionamento físico atual?", "tipo": "unica", "obrig": True, "opcoes": [
                "Sem experiência (sedentário, sem nenhuma experiência com treinamento)",
                "Inativo (já treinou, mas está sem treinar atualmente)",
                "Ativo 1 (treina com certa frequência)",
                "Ativo 2 (treina com frequência e regularidade, não costuma faltar e tem certo condicionamento físico)",
                "Atleta (treina com objetivos competitivos)"]},
            {"id": "dias_treino", "n": 9, "titulo": "Quais dias você tem disponíveis para treinar?", "tipo": "multipla",
             "opcoes": ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"]},
            {"id": "horario_treino", "n": 10, "titulo": "Em qual horário você treina e quanto tempo tem por sessão?", "tipo": "texto"},
            {"id": "local_treino", "n": 11, "titulo": "Onde você vai treinar?", "tipo": "unica", "obrig": True,
             "opcoes": ["Academia completa", "Academia de condomínio", "Outro"]},
            {"id": "foco_corporal", "n": 12, "titulo": "Tem alguma parte do corpo que você gostaria de trabalhar mais?", "tipo": "multipla",
             "exclusivo": "Sem preferência",
             "opcoes": ["Peito", "Costas", "Ombros", "Braços", "Abdômen", "Coxas", "Glúteos", "Panturrilhas", "Sem preferência"]},
            {"id": "desempenho_treino", "n": 13, "titulo": "Como está seu desempenho nas atividades físicas?", "tipo": "unica", "obrig": True, "opcoes": [
                "Ruim (sinto-me cansado, sem força ou potência para fazer os exercícios)",
                "Boa (faço a atividade normalmente, mas poderia me sair melhor)",
                "Excelente",
                "Não estou treinando no momento"]},
        ],
    },
    {
        "key": "saude", "titulo": "Saúde", "transicao": "Boa! Agora, um pouco sobre a sua saúde.",
        "perguntas": [
            {"id": "doencas", "n": 14, "titulo": "Você tem alguma doença ou queixa de saúde? Se sim, qual?", "tipo": "texto"},
            {"id": "lesoes", "n": 15, "titulo": "Você tem lesão, dor, cirurgia ou restrição médica que limite os exercícios? Se sim, descreva e diga quais movimentos causam dor.", "tipo": "longo"},
            {"id": "gestante_lactante", "n": 16, "titulo": "Você está gestante ou amamentando?", "tipo": "unica", "obrig": True,
             "opcoes": ["Sim", "Não", "Não se aplica"], "se": {"campo": "sexo", "diferente": "Masculino"}},
            {"id": "medicacao", "n": 17, "titulo": "Você usa medicação contínua ou suplementos? Se sim, quais?", "tipo": "texto"},
            {"id": "esteroides", "n": 18, "titulo": "Você usa ou já usou esteroides anabolizantes? Se sim, quais e por quanto tempo?", "tipo": "texto"},
            {"id": "exames_recentes", "n": 19, "titulo": "Você fez exames de sangue nos últimos 6 meses?", "tipo": "unica", "obrig": True,
             "opcoes": SN, "desc": "Se sim, anexe os resultados no campo abaixo."},
            {"id": "exames_arquivos", "n": 20, "titulo": "Anexe seus exames (opcional)", "tipo": "arquivo", "destino": "exame",
             "se": {"campo": "exames_recentes", "igual": "Sim"}},
            {"id": "fumo", "n": 21, "titulo": "Você é fumante? Se sim, quantos cigarros por dia?", "tipo": "texto"},
            {"id": "alcool", "n": 22, "titulo": "Você consome bebidas alcoólicas? Se sim, com que frequência?", "tipo": "unica", "obrig": True, "opcoes": [
                "Não consumo", "Apenas em fins de semana", "Apenas em eventos comemorativos (socialmente)",
                "Às vezes durante a semana e também no fim de semana", "Praticamente todos os dias"]},
            {"id": "libido", "n": 23, "titulo": "Como você classificaria seu desejo sexual (libido)?", "tipo": "unica", "obrig": True, "opcoes": [
                "Baixo na maior parte do tempo", "Varia ao longo do tempo (por exemplo, de acordo com o ciclo menstrual)",
                "Excelente na maior parte do tempo", "Prefiro não responder"]},
        ],
    },
    {
        "key": "rotina_sono_energia", "titulo": "Rotina, sono e energia", "transicao": "Passou da metade. Vamos à sua rotina.",
        "perguntas": [
            {"id": "profissao", "n": 24, "titulo": "Qual é a sua profissão?", "tipo": "texto"},
            {"id": "tipo_trabalho", "n": 25, "titulo": "No trabalho, você passa a maior parte do tempo:", "tipo": "unica", "obrig": True,
             "opcoes": ["Sentado", "Caminhando", "Em pé", "Subindo e descendo escadas", "Carregando pesos", "Não trabalho no momento"]},
            {"id": "estrutura_alimentacao", "n": 26, "titulo": "No local de trabalho há geladeira, micro-ondas ou lugar para preparar ou guardar refeições?",
             "tipo": "unica", "obrig": True, "opcoes": ["Sim", "Não", "Não trabalho no momento"]},
            {"id": "horario_sono", "n": 27, "titulo": "Em que horário você costuma acordar e dormir?", "tipo": "texto"},
            {"id": "sono", "n": 28, "titulo": "Como é a qualidade do seu sono?", "tipo": "multipla", "exclusivo": "Tenho uma boa qualidade de sono", "opcoes": [
                "Tenho insônia (passo mais de 30 minutos para conseguir dormir)", "Tenho despertares noturnos",
                "Tenho o sono leve ou agitado", "Levo o celular para a cama e mexo nele até tarde",
                "Acordo quase sempre cansado", "Tenho uma boa qualidade de sono"]},
            {"id": "disposicao", "n": 29, "titulo": "Como você classificaria sua disposição para as atividades do dia a dia?", "tipo": "escala",
             "obrig": True, "min": 0, "max": 10, "desc": "0 = muito ruim, 10 = excelente"},
        ],
    },
    {
        "key": "alimentacao", "titulo": "Alimentação", "transicao": "Última parte: a sua alimentação.",
        "perguntas": [
            {"id": "agua", "n": 30, "titulo": "Como você classificaria seu consumo de água?", "tipo": "unica", "obrig": True, "opcoes": [
                "Menos de 1 L (menos de 5 copos de 200 ml)", "Entre 1 L e 2 L (entre 5 e 10 copos de 200 ml)",
                "Entre 2 L e 3 L (entre 10 e 15 copos de 200 ml)", "Mais de 3 L (mais de 15 copos de 200 ml)"]},
            {"id": "alergias", "n": 31, "titulo": "Você tem alergia ou intolerância alimentar? Se sim, a quê?", "tipo": "texto"},
            {"id": "frutas_preferidas", "n": 32, "titulo": "Quais alimentos você não gosta e quais são suas frutas preferidas?", "tipo": "longo"},
            {"id": "intestino", "n": 33, "titulo": "Como está o funcionamento do seu intestino?", "tipo": "unica", "obrig": True, "opcoes": [
                "Bem, com evacuações regulares todos os dias",
                "Mais ou menos: normal na maior parte do tempo, mas às vezes tenho constipação ou diarreia",
                "Ruim: costumo ter constipação", "Ruim: costumo ter diarreia", "Ruim: alterno entre constipação e diarreia"]},
            {"id": "rotina_alimentar", "n": 34, "titulo": "Descreva brevemente sua rotina alimentar.", "tipo": "longo", "rows": 8,
             "desc": "Se souber as quantidades, melhor. Se não, sem problemas. Exemplo:\n7:00, café da manhã: 2 fatias de pão + 1 ovo + 1 fruta\n10:00, lanche da manhã: 1 iogurte + 1 fruta + whey protein\n12:00, almoço: arroz + feijão + carne + salada de legumes\n16:00, lanche da tarde: 2 fatias de pão + 1 ovo + 1 fruta\n19:00, jantar: arroz + feijão + carne + salada de legumes"},
            {"id": "plano_anterior", "n": 35, "titulo": "Você seguiu algum planejamento alimentar nos últimos 6 meses?", "tipo": "unica", "obrig": True, "opcoes": SN},
            {"id": "plano_anterior_arquivo", "n": 36, "titulo": "Anexe seu plano alimentar (opcional)", "tipo": "arquivo", "destino": "plano_anterior",
             "se": {"campo": "plano_anterior", "igual": "Sim"}},
            {"id": "plano_anterior_experiencia", "n": 37, "titulo": "Como foi seguir esse plano? O que funcionou e o que não funcionou?", "tipo": "longo",
             "se": {"campo": "plano_anterior", "igual": "Sim"}},
        ],
    },
]

UPLOAD_TIPOS = {"application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png"}
UPLOAD_MAX_BYTES = 10 * 1024 * 1024

PERGUNTAS = {p["id"]: {**p, "bloco": b["key"]} for b in BLOCOS for p in b["perguntas"]}
BLOCO_TITULO = {b["key"]: b["titulo"] for b in BLOCOS}


def estrutura_publica() -> dict:
    return {"blocos": BLOCOS, "upload": {"tipos": list(UPLOAD_TIPOS), "max_mb": UPLOAD_MAX_BYTES // (1024 * 1024)}}


def _vazio(v) -> bool:
    return v in (None, "", [], {})


def visivel(pergunta: dict, respostas: dict) -> bool:
    cond = pergunta.get("se")
    if not cond:
        return True
    valor = respostas.get(cond["campo"])
    if "igual" in cond:
        return valor == cond["igual"]
    if "diferente" in cond:
        return valor != cond["diferente"]
    return True


def respostas_planas(formulario: dict) -> dict:
    return {k: v for bloco in (formulario or {}).values() for k, v in (bloco or {}).items()}


def agrupar(respostas: dict) -> dict:
    """{pergunta: valor} -> {bloco: {pergunta: valor}} (só perguntas conhecidas)."""
    out = {b["key"]: {} for b in BLOCOS}
    for k, v in (respostas or {}).items():
        p = PERGUNTAS.get(k)
        if p and not _vazio(v):
            out[p["bloco"]][k] = v
    return out


def obrigatorias_faltando(respostas: dict) -> list:
    return [p["id"] for b in BLOCOS for p in b["perguntas"]
            if p.get("obrig") and visivel(p, respostas) and _vazio(respostas.get(p["id"]))]


# ── Migração do formato antigo (7 seções + respostas soltas da pré-consulta antiga) ──

_COND_ANTIGO = {
    "sem_experiencia": 0, "inativo": 1, "ativo_1": 2, "ativo_2": 3, "atleta": 4,
}

# campo antigo -> pergunta nova (mesmo significado)
_EQUIVALENTES = {
    "email": "email", "ocupacao": "profissao", "alcool": "alcool", "tabagismo": "fumo", "habitos_sono": "sono",
    "lesoes": "lesoes", "patologias": "doencas", "medicamentos": "medicacao", "habito_intestinal": "intestino",
    "ingestao_hidrica": "agua", "alergia_alimentar": "alergias", "preferencia_alimentar": "frutas_preferidas",
    "atividades_praticadas": "condicionamento", "frequencia_semana": "dias_treino", "horario_atividades": "horario_treino",
}

# campo antigo sem pergunta equivalente -> (bloco mais próximo, rótulo)
_OUTRAS = {
    "estado_civil": ("dados_pessoais", "Estado civil"), "escolaridade": ("dados_pessoais", "Escolaridade"),
    "naturalidade": ("dados_pessoais", "Naturalidade"), "redes_sociais": ("dados_pessoais", "Redes sociais"),
    "telefone": ("dados_pessoais", "Telefone"), "celular": ("dados_pessoais", "Celular"),
    "endereco": ("dados_pessoais", "Endereço"), "bairro": ("dados_pessoais", "Bairro"),
    "cidade_uf": ("dados_pessoais", "Cidade/UF"), "cep": ("dados_pessoais", "CEP"),
    "motivo": ("dados_pessoais", "Motivo da consulta"), "motivo_outro": ("dados_pessoais", "Motivo (outro)"),
    "restricao_alimentar": ("alimentacao", "Restrição alimentar"), "refeicoes_fora": ("alimentacao", "Refeições fora de casa"),
    "pessoas_casa": ("alimentacao", "Pessoas em casa"), "compras_casa": ("alimentacao", "Quem faz as compras"),
    "sal_oleo_mes": ("alimentacao", "Sal/óleo por mês"),
    "sintomas_gerais": ("saude", "Sintomas gerais"), "outros_sintomas": ("saude", "Outros sintomas"),
    "cirurgias": ("saude", "Cirurgias"), "historico_familiar": ("saude", "Histórico familiar"),
    "apetite": ("alimentacao", "Apetite"), "mastigacao": ("alimentacao", "Mastigação"),
    "cor_fezes": ("saude", "Cor das fezes"), "formato_fezes": ("saude", "Escala de Bristol"),
    "habito_urinario": ("saude", "Hábito urinário"), "hidratacao_urinaria": ("saude", "Hidratação urinária"),
    "intolerancia_alimentar": ("alimentacao", "Intolerância alimentar"), "aversao_alimentar": ("alimentacao", "Aversões alimentares"),
    "alteracoes_apetite": ("alimentacao", "Alterações de apetite"), "inicio_obesidade": ("alimentacao", "Início do excesso de peso"),
    "dieta_especial": ("alimentacao", "Dieta especial"), "num_refeicoes_dia": ("alimentacao", "Refeições por dia"),
    "suplementos": ("saude", "Suplementos"),
    "intensidade_atividades": ("objetivos_treinamento", "Intensidade do treino"),
    "duracao_atividades": ("objetivos_treinamento", "Duração do treino"),
    "sintomas_durante": ("objetivos_treinamento", "Sintomas durante o treino"),
    "sintomas_apos": ("objetivos_treinamento", "Sintomas após o treino"),
    "hidratacao_atividade": ("objetivos_treinamento", "Hidratação no treino"),
    "alimentacao_pre": ("objetivos_treinamento", "Alimentação pré-treino"),
    "alimentacao_durante": ("objetivos_treinamento", "Alimentação durante o treino"),
    "alimentacao_pos": ("objetivos_treinamento", "Alimentação pós-treino"),
    "ultima_menstruacao": ("saude", "Última menstruação"), "tpm": ("saude", "TPM"),
    "ciclo_menstrual": ("saude", "Ciclo menstrual"), "contraceptivo": ("saude", "Contraceptivo"),
    "colicas": ("saude", "Cólicas"), "lactante": ("saude", "Lactante"), "menopausa": ("saude", "Menopausa"),
}
_OBS_BLOCO = {
    "obs_dados_iniciais": "dados_pessoais", "obs_habitos_vida": "rotina_sono_energia", "obs_patologias": "saude",
    "obs_avaliacao_clinica": "saude", "obs_alimentacao": "alimentacao", "obs_atividade_fisica": "objetivos_treinamento",
    "obs_mulheres": "saude",
}
# chaves da pré-consulta antiga com outro nome
_RESPOSTAS_RENOMEADAS = {"altura": "estatura", "peso": "peso_atual", "suplementacao": "medicacao",
                         "lesao": "lesoes", "cirurgia": "lesoes"}
_IGNORAR = {"idade", "fotos", "id", "paciente_id", "nutricionista_id", "created_at", "criado_em", "atualizado_em",
            "respostas", "formulario", "formulario_outras", "formulario_versao", "respostas_historico"}


def _texto(v) -> str:
    if isinstance(v, list):
        return ", ".join(str(x) for x in v if not _vazio(x))
    return str(v)


def _normalizar_valor(pid: str, v):
    p = PERGUNTAS[pid]
    if pid == "condicionamento" and isinstance(v, str) and v in _COND_ANTIGO:
        return p["opcoes"][_COND_ANTIGO[v]]
    if p["tipo"] == "multipla" and isinstance(v, str):
        return [v]  # texto livre antigo: guardado como está, numa lista
    if p["tipo"] == "arquivo":
        return v if isinstance(v, list) else None
    return v


def migrar_legado(anam: dict) -> tuple:
    """Formato antigo -> (formulario, outras). Não perde dado: o que não tem pergunta vai para 'outras'."""
    form = {b["key"]: {} for b in BLOCOS}
    outras = {b["key"]: {} for b in BLOCOS}

    def por(pid, v, rotulo_origem):
        v = _normalizar_valor(pid, v)
        if _vazio(v):
            return
        bloco = PERGUNTAS[pid]["bloco"]
        atual = form[bloco].get(pid)
        if _vazio(atual):
            form[bloco][pid] = v
        elif _texto(atual) != _texto(v):
            outras[bloco][rotulo_origem] = _texto(v)  # conflito: os dois valores ficam

    # 1) respostas soltas da pré-consulta antiga (chaves já parecidas com as novas)
    for k, v in ((anam or {}).get("respostas") or {}).items():
        if _vazio(v) or k in _IGNORAR or k.startswith("_"):
            continue
        k2 = _RESPOSTAS_RENOMEADAS.get(k, k)
        if k2 in PERGUNTAS:
            por(k2, v, f"Pré-consulta antiga: {k}")
        else:
            outras["dados_pessoais"][f"Pré-consulta antiga: {k.replace('_', ' ')}"] = _texto(v)
    # 2) seções antigas da aba Anamnese
    for campo, v in (anam or {}).items():
        if _vazio(v) or campo in _IGNORAR:
            continue
        if campo in _EQUIVALENTES:
            por(_EQUIVALENTES[campo], v, f"Anamnese antiga: {campo.replace('_', ' ')}")
        elif campo in _OUTRAS:
            bloco, rotulo = _OUTRAS[campo]
            outras[bloco][rotulo] = _texto(v)
        elif campo in _OBS_BLOCO and isinstance(v, list):
            linhas = [f"{str(o.get('data', ''))[:10]}: {o.get('texto', '')}" for o in v if isinstance(o, dict)]
            if linhas:
                outras[_OBS_BLOCO[campo]]["Observações"] = "\n".join(linhas)
    return form, outras


def montar_documento(anam: Optional[dict]) -> dict:
    """Garante `formulario` e `formulario_outras` no documento (migrando o antigo na primeira leitura)."""
    anam = dict(anam or {})
    if anam.get("formulario_versao") == 2:
        anam.setdefault("formulario", {})
        anam.setdefault("formulario_outras", {})
        return anam
    form, outras = migrar_legado(anam)
    anam.update(formulario=form, formulario_outras=outras, formulario_versao=2)
    return anam


def legiveis(anam: Optional[dict], incluir_dados_pessoais: bool = False) -> dict:
    """{Bloco: {Pergunta: resposta legível}} na ordem do formulário — para PDF e agentes de IA."""
    anam = montar_documento(anam)
    form, outras = anam["formulario"], anam["formulario_outras"]
    planas = respostas_planas(form)
    saida = {}
    for b in BLOCOS:
        if b["key"] == "dados_pessoais" and not incluir_dados_pessoais:
            continue
        itens = {}
        for p in b["perguntas"]:
            v = planas.get(p["id"])
            if _vazio(v):
                continue
            if p["tipo"] == "arquivo":
                v = ", ".join(a.get("nome", "arquivo") for a in v if isinstance(a, dict))
            itens[p["titulo"]] = _texto(v)
        for rotulo, v in (outras.get(b["key"]) or {}).items():
            if not _vazio(v):
                itens[f"Outras informações · {rotulo}"] = _texto(v)
        if itens:
            saida[b["titulo"]] = itens
    return saida


def com_campos_antigos(anam: Optional[dict]) -> dict:
    """Documento novo + os nomes de campo antigos (patologias, medicamentos, alergia_alimentar...) preenchidos
    a partir dos blocos, para o código que ainda lê o formato antigo (Donato, chat, análise clínica)."""
    doc = montar_documento(anam)
    planas = respostas_planas(doc["formulario"])
    for antigo, novo in _EQUIVALENTES.items():
        if not _vazio(planas.get(novo)):
            doc[antigo] = _texto(planas[novo])
    rotulo_para_campo = {(b, r): c for c, (b, r) in _OUTRAS.items()}
    for bloco, itens in doc["formulario_outras"].items():
        for rotulo, v in (itens or {}).items():
            campo = rotulo_para_campo.get((bloco, rotulo))
            if campo and _vazio(doc.get(campo)):
                doc[campo] = v
    doc["respostas"] = {**(doc.get("respostas") or {}), **planas}
    return doc


# perguntas que interessam ao Dr. House (exames) e ao contexto clínico
PERGUNTAS_CLINICAS = ("condicionamento", "desempenho_treino", "doencas", "lesoes", "gestante_lactante", "medicacao",
                      "esteroides", "exames_recentes", "fumo", "alcool", "libido", "sono", "disposicao", "agua",
                      "alergias", "intestino", "rotina_alimentar")


def contexto_clinico(anam: Optional[dict]) -> dict:
    anam = montar_documento(anam)
    planas = respostas_planas(anam["formulario"])
    out = {PERGUNTAS[k]["titulo"]: _texto(planas[k]) for k in PERGUNTAS_CLINICAS if not _vazio(planas.get(k))}
    for rotulo, v in (anam["formulario_outras"].get("saude") or {}).items():
        if not _vazio(v):
            out[f"Saúde · {rotulo}"] = _texto(v)
    return out
