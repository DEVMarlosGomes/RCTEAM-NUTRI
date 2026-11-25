"""Formulário pré-consulta (5 blocos, 37 perguntas) e a anamnese organizada pelos mesmos blocos.

Fonte única das perguntas: o formulário público (PreConsulta.jsx), a aba Anamnese, o PDF da anamnese e o
contexto dos agentes de IA leem daqui. As opções e as condições seguem o protótipo do Rogério
(artifact "Formulário Pré-consulta", 15/11/2026).

Respostas ficam em `anamnese.formulario = {bloco: {pergunta: valor}}`. O que veio do formato antigo e não tem
pergunta equivalente vai para `anamnese.formulario_outras = {bloco: {rótulo: valor}}` (nada é descartado).
"""
from typing import Optional

SN = ["Sim", "Não"]
FEM = {"campo": "sexo", "igual": "Feminino"}

# Objetivos pré-selecionáveis (pode marcar mais de um; o principal fica com ★ em `objetivo_principal`)
OBJETIVOS = ["Ganho de massa muscular", "Definição muscular", "Perda de gordura", "Rendimento esportivo",
             "Manutenção de peso", "Tratamento de doenças", "Reeducação alimentar"]
DOENCAS = ["Nenhuma", "Diabetes ou pré-diabetes", "Pressão alta", "Colesterol ou triglicerídeos altos", "Hipotireoidismo",
           "Hipertireoidismo", "Gastrite ou refluxo", "Esteatose hepática (gordura no fígado)", "Síndrome dos ovários policísticos (SOP)",
           "Ansiedade ou depressão", "Doença renal", "Outra"]

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
            {"id": "objetivo", "n": 7, "titulo": "Quais objetivos você quer alcançar?", "tipo": "objetivos", "obrig": True,
             "opcoes": OBJETIVOS, "desc": "Pode marcar mais de um. Toque na ★ para escolher o principal."},
            {"id": "objetivo_principal", "titulo": "Objetivo principal", "tipo": "interno"},
            {"id": "peso_desejado", "n": 7.1, "titulo": "Qual peso você gostaria de alcançar? (em kg)", "tipo": "numero",
             "desc": "Se não tiver um número em mente, pode pular."},
            {"id": "historico_peso", "n": 7.2, "titulo": "Como foi o seu peso nos últimos anos?", "tipo": "longo",
             "desc": "Maior e menor peso que já teve, dietas que já fez, se costuma ganhar e perder peso (efeito sanfona)."},
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
            {"id": "local_treino_outro", "n": 11.1, "titulo": "Onde você vai treinar?", "tipo": "texto", "obrig": True,
             "desc": "Ex.: em casa, ao ar livre, estúdio, crossfit…", "se": {"campo": "local_treino", "igual": "Outro"}},
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
            {"id": "doencas", "n": 14, "titulo": "Você tem alguma doença ou condição de saúde?", "tipo": "multipla", "obrig": True,
             "exclusivo": "Nenhuma", "opcoes": DOENCAS},
            {"id": "doencas_outras", "n": 14.1, "titulo": "Qual outra doença ou queixa de saúde?", "tipo": "texto",
             "se": {"campo": "doencas", "contem": "Outra"}},
            {"id": "lesoes", "n": 15, "titulo": "Você tem lesão, dor, cirurgia ou restrição médica que limite os exercícios? Se sim, descreva e diga quais movimentos causam dor.", "tipo": "longo"},
            {"id": "gestante_lactante", "n": 16, "titulo": "Você está gestante ou amamentando?", "tipo": "unica", "obrig": True,
             "opcoes": ["Sim", "Não", "Não se aplica"], "se": FEM},
            {"id": "ciclo_menstrual", "n": 16.1, "titulo": "Como está o seu ciclo menstrual?", "tipo": "unica", "se": FEM,
             "opcoes": ["Regular (todo mês, mais ou menos no mesmo período)", "Irregular", "Não menstruo (menopausa, DIU hormonal, uso contínuo…)"]},
            {"id": "anticoncepcional", "n": 16.2, "titulo": "Usa anticoncepcional ou reposição hormonal? Se sim, qual?", "tipo": "texto", "se": FEM},
            {"id": "medicacao", "n": 17, "titulo": "Você usa alguma medicação contínua? Se sim, qual e a dose?", "tipo": "texto"},
            {"id": "suplementos", "n": 17.1, "titulo": "Você usa suplementos? Se sim, quais?", "tipo": "texto"},
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
                "Excelente na maior parte do tempo", "Prefiro não responder"],
             # a opção do ciclo menstrual só aparece para mulher
             "opcoes_se": {"Varia ao longo do tempo (por exemplo, de acordo com o ciclo menstrual)": FEM}},
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
            {"id": "nao_gosta", "n": 32, "titulo": "Quais alimentos você não gosta ou não come de jeito nenhum?", "tipo": "longo"},
            {"id": "frutas_preferidas", "n": 32.1, "titulo": "Quais são as suas frutas preferidas?", "tipo": "texto"},
            {"id": "intestino", "n": 33, "titulo": "Como está o funcionamento do seu intestino?", "tipo": "unica", "obrig": True, "opcoes": [
                "Bem, com evacuações regulares todos os dias",
                "Mais ou menos: normal na maior parte do tempo, mas às vezes tenho constipação ou diarreia",
                "Ruim: costumo ter constipação", "Ruim: costumo ter diarreia", "Ruim: alterno entre constipação e diarreia"]},
            {"id": "horario_fome", "n": 33.1, "titulo": "Em que horário do dia você sente mais fome?", "tipo": "texto"},
            {"id": "beliscos", "n": 33.2, "titulo": "Costuma beliscar entre as refeições? O quê e em que momento?", "tipo": "texto"},
            {"id": "quem_prepara", "n": 33.3, "titulo": "Quem prepara a sua comida?", "tipo": "unica",
             "opcoes": ["Eu mesmo(a)", "Alguém da família", "Funcionária ou cozinheira", "Compro comida pronta ou marmita", "Como fora na maior parte das vezes"]},
            {"id": "marmita", "n": 33.4, "titulo": "Você consegue levar marmita para o trabalho?", "tipo": "unica",
             "opcoes": ["Sim", "Não", "Não preciso (como em casa)"]},
            {"id": "rotina_alimentar", "n": 34, "titulo": "Como é a sua rotina alimentar em um dia comum?", "tipo": "rotina",
             "desc": "Uma linha por refeição: horário, refeição e o que você come. Se souber as quantidades, melhor (ex.: 2 fatias de pão + 1 ovo + 1 fruta)."},
            {"id": "plano_anterior", "n": 35, "titulo": "Você seguiu algum planejamento alimentar nos últimos 6 meses?", "tipo": "unica", "obrig": True, "opcoes": SN},
            {"id": "plano_anterior_arquivo", "n": 36, "titulo": "Anexe seu plano alimentar (opcional)", "tipo": "arquivo", "destino": "plano_anterior",
             "se": {"campo": "plano_anterior", "igual": "Sim"}},
            {"id": "plano_anterior_experiencia", "n": 37, "titulo": "Como foi seguir esse plano? O que funcionou e o que não funcionou?", "tipo": "longo",
             "se": {"campo": "plano_anterior", "igual": "Sim"}},
        ],
    },
    {
        "key": "fotos", "titulo": "Fotos de avaliação", "transicao": "Por último, as fotos (seguindo o protocolo).",
        "perguntas": [
            {"id": "fotos_avaliacao", "n": 38, "titulo": "Envie as 3 fotos de avaliação: frente, lado e costas.", "tipo": "fotos",
             "desc": "Fundo neutro, boa luz, roupa de banho ou top e short. Se não puder agora, pode enviar depois pelo atendimento."},
        ],
    },
]

# Questionário de retorno (antes da reavaliação)
RETORNO_BLOCOS = [
    {
        "key": "retorno", "titulo": "Retorno", "transicao": "Que bom te ver de novo! Como foram estas semanas?",
        "perguntas": [
            {"id": "ret_peso", "n": 1, "titulo": "Qual é o seu peso hoje? (em kg, em jejum)", "tipo": "numero", "obrig": True},
            {"id": "ret_adesao", "n": 2, "titulo": "De 0 a 10, quanto você conseguiu seguir o plano alimentar?", "tipo": "escala", "obrig": True, "min": 0, "max": 10},
            {"id": "ret_treino", "n": 3, "titulo": "De 0 a 10, quanto você conseguiu seguir o treino?", "tipo": "escala", "obrig": True, "min": 0, "max": 10},
            {"id": "ret_dificuldades", "n": 4, "titulo": "O que foi mais difícil de seguir?", "tipo": "longo"},
            {"id": "ret_fome", "n": 5, "titulo": "Como está a sua fome?", "tipo": "unica", "obrig": True,
             "opcoes": ["Tranquila, sem fome fora de hora", "Fome em alguns horários", "Muita fome na maior parte do dia", "Pouca fome, sobra comida"]},
            {"id": "ret_intestino", "n": 6, "titulo": "Como está o intestino?", "tipo": "unica",
             "opcoes": ["Bem, regular", "Preso", "Solto", "Alternando"]},
            {"id": "ret_sono", "n": 7, "titulo": "Como está o sono e a disposição?", "tipo": "unica",
             "opcoes": ["Bem", "Mais ou menos", "Ruim"]},
            {"id": "ret_mudancas", "n": 8, "titulo": "Mudou algo na saúde, medicação, suplementos ou rotina?", "tipo": "longo"},
            {"id": "ret_gostaria", "n": 9, "titulo": "O que você gostaria de mudar ou trocar no plano?", "tipo": "longo"},
            {"id": "ret_fotos", "n": 10, "titulo": "Envie as fotos de hoje: frente, lado e costas.", "tipo": "fotos"},
        ],
    },
]

UPLOAD_TIPOS = {"application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png"}
UPLOAD_MAX_BYTES = 10 * 1024 * 1024

PERGUNTAS = {p["id"]: {**p, "bloco": b["key"]} for b in BLOCOS for p in b["perguntas"]}
PERGUNTAS_RETORNO = {p["id"]: {**p, "bloco": b["key"]} for b in RETORNO_BLOCOS for p in b["perguntas"]}
BLOCO_TITULO = {b["key"]: b["titulo"] for b in BLOCOS}


def estrutura_publica(tipo: str = "inicial") -> dict:
    return {"tipo": tipo, "blocos": RETORNO_BLOCOS if tipo == "retorno" else BLOCOS,
            "upload": {"tipos": list(UPLOAD_TIPOS), "max_mb": UPLOAD_MAX_BYTES // (1024 * 1024)}}


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
    if "contem" in cond:
        return isinstance(valor, list) and cond["contem"] in valor
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


def obrigatorias_faltando(respostas: dict, blocos: Optional[list] = None) -> list:
    return [p["id"] for b in (blocos or BLOCOS) for p in b["perguntas"]
            if p.get("obrig") and visivel(p, respostas) and _vazio(respostas.get(p["id"]))]


def objetivos_da_resposta(valor) -> list:
    """Objetivos marcados (lista); texto antigo vira os objetivos que ele menciona (ou o próprio texto)."""
    if isinstance(valor, list):
        return [str(x) for x in valor if not _vazio(x)]
    if _vazio(valor):
        return []
    t = str(valor).lower()
    chaves = {"Ganho de massa muscular": ("hipertrof", "massa", "ganh"), "Definição muscular": ("defini",),
              "Perda de gordura": ("emagre", "perd", "gordura", "secar"), "Rendimento esportivo": ("rendimento", "performance", "esport"),
              "Manutenção de peso": ("manut", "manter"), "Tratamento de doenças": ("doen", "tratamento", "saúde"),
              "Reeducação alimentar": ("reeduca", "alimentação saud")}
    achados = [o for o, ks in chaves.items() if any(k in t for k in ks)]
    return achados or [str(valor)]


def rotina_texto(valor) -> str:
    if isinstance(valor, list):
        return "\n".join(f"{(r or {}).get('horario', '')} · {(r or {}).get('refeicao', '')}: {(r or {}).get('alimentos', '')}".strip(" ·:")
                         for r in valor if isinstance(r, dict) and any((r or {}).values()))
    return _texto(valor)


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
_RESPOSTAS_RENOMEADAS = {"altura": "estatura", "peso": "peso_atual", "suplementacao": "suplementos",
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
    if p["tipo"] == "objetivos":
        return objetivos_da_resposta(v)
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
            if _vazio(v) or p["tipo"] == "interno":
                continue
            if p["tipo"] == "arquivo":
                v = ", ".join(a.get("nome", "arquivo") for a in v if isinstance(a, dict))
            elif p["tipo"] == "fotos":
                v = f"{len(v) if isinstance(v, list) else 0} foto(s) enviada(s)"
            elif p["tipo"] == "rotina":
                v = rotina_texto(v)
            elif p["tipo"] == "objetivos":
                principal = planas.get("objetivo_principal")
                v = ", ".join(f"{o} ★" if o == principal else o for o in objetivos_da_resposta(v))
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
PERGUNTAS_CLINICAS = ("condicionamento", "desempenho_treino", "doencas", "doencas_outras", "lesoes", "gestante_lactante",
                      "ciclo_menstrual", "anticoncepcional", "medicacao", "suplementos", "esteroides", "exames_recentes",
                      "fumo", "alcool", "libido", "sono", "disposicao", "agua", "alergias", "intestino", "rotina_alimentar")


def contexto_clinico(anam: Optional[dict]) -> dict:
    anam = montar_documento(anam)
    planas = respostas_planas(anam["formulario"])
    out = {PERGUNTAS[k]["titulo"]: (rotina_texto(planas[k]) if k == "rotina_alimentar" else _texto(planas[k]))
           for k in PERGUNTAS_CLINICAS if not _vazio(planas.get(k))}
    for rotulo, v in (anam["formulario_outras"].get("saude") or {}).items():
        if not _vazio(v):
            out[f"Saúde · {rotulo}"] = _texto(v)
    return out
