"""Base de alimentos: normalização de nomes e medidas caseiras + sincronização com o banco.

A única base de alimentos do sistema é a TABELA ENXUTA do Rogério (tabela_enxuta_alimentos.json, 262
alimentos, mesmos ids da base EVONUT antiga). No boot do servidor ela é gravada no banco (uma vez por
versão) e o restante da base antiga é ARQUIVADO: some da busca, mas segue resolvido por id para não
quebrar dietas antigas.

As medidas caseiras vêm da própria tabela (aba "Cadastro de Medidas"); só quando um alimento não tem
nenhuma, entra a Tabela de Medidas Referidas do IBGE (medidas_ibge.json), marcada como estimada.
"""
import json
import logging
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

from pymongo import UpdateOne

BASE_VERSAO = "2026-11-15.1"
RAIZ = Path(__file__).parent
log = logging.getLogger("alimentos_base")

# ── Correções de texto ──────────────────────────────────────────────────────

# Palavra sem acento -> forma correta. Curado a partir das palavras que aparecem das duas formas na
# base; ficaram de fora as ambíguas ("para", "pre", "roma"), as que já estão certas pela ortografia
# atual ("caju", "geleia", "pera", "fluido") e marcas ("Kibon", "Ducoco", "Senior", "Cacao").
ACENTOS = {
    "oleo": "óleo", "hamburguer": "hambúrguer", "figado": "fígado", "moida": "moída", "moido": "moído",
    "mocoto": "mocotó", "jilo": "jiló", "musculo": "músculo", "chicoria": "chicória", "tonica": "tônica",
    "soluvel": "solúvel", "po": "pó", "cha": "chá", "fuba": "fubá", "guarana": "guaraná",
    "instantaneo": "instantâneo", "ananas": "ananás", "cuxa": "cuxá", "lactea": "láctea", "limao": "limão",
    "cupuacu": "cupuaçu", "nao": "não", "organico": "orgânico", "organica": "orgânica",
    "nestle": "Nestlé", "tubaina": "tubaína", "liquido": "líquido", "liquida": "líquida", "amendoa": "amêndoa",
    "araca": "araçá", "avela": "avelã", "alcoolica": "alcoólica", "bobo": "bobó", "braco": "braço",
    "caja": "cajá", "lingua": "língua", "chines": "chinês", "salvia": "sálvia", "hortela": "hortelã",
    "inga": "ingá", "jucara": "juçara", "macadamia": "macadâmia", "manicoba": "maniçoba", "nectar": "néctar",
    "mungunza": "mungunzá", "bufala": "búfala", "bufalo": "búfalo", "nespera": "nêspera", "dende": "dendê",
    "oregano": "orégano", "pascoa": "Páscoa", "gluten": "glúten", "pate": "patê", "pave": "pavê",
    "colonia": "colônia", "requeijao": "requeijão", "dietetico": "dietético", "dietetica": "dietética",
    "rucula": "rúcula", "sufle": "suflê", "tacaca": "tacacá", "tapereba": "taperebá", "tucuma": "tucumã",
    "uisque": "uísque", "feijao": "feijão", "file": "filé", "cara": "cará", "role": "rolê", "rose": "rosé",
    "maca": "maçã", "acucar": "açúcar", "cafe": "café", "agua": "água", "grao": "grão", "graos": "grãos",
    "camarao": "camarão", "salmao": "salmão", "mamao": "mamão", "melao": "melão", "pao": "pão", "paes": "pães",
    "macarrao": "macarrão", "pessego": "pêssego", "abobora": "abóbora", "brocolis": "brócolis",
    "pimentao": "pimentão", "acai": "açaí", "maracuja": "maracujá", "xicara": "xícara", "pedaco": "pedaço",
    "porcao": "porção", "medio": "médio", "media": "média", "pescoco": "pescoço", "maco": "maço",
    "sache": "sachê", "taca": "taça", "cafezinho": "cafezinho", "espaguete": "espaguete",
}

# Erros pontuais de digitação/extração encontrados na base.
CORRECOES = [
    (r"\bPullnnan\b", "Pullman"), (r"\bintegrallinhaça\b", "integral linhaça"), (r"\balhoe\b", "alho e"),
    (r"\bleitee\b", "leite e"), (r"\btomateseco\b", "tomate seco"), (r"\bchocolatebranco\b", "chocolate branco"),
    (r"\bcreamcheese\b", "cream cheese"), (r"\blightpullman\b", "light Pullman"), (r"\bbananabrasil\b", "banana Brasil"),
    (r"\bchocolatenutry\b", "chocolate Nutry"), (r"\bnestléetapa\b", "Nestlé etapa"), (r"\bintegralde\b", "integral de"),
    (r"\bqueijoao\b", "queijo ao"), (r"\bameixaem\b", "ameixa em"), (r"\bbovinamolho\b", "bovina molho"),
    (r"\bintegralorgânica\b", "integral orgânica"), (r"\borgânica(banana|cupuaçu)\b", r"orgânica \1"),
    (r"\bdechocolate\b", "de chocolate"), (r"\bcompedaços\b", "com pedaços"), (r"\bchocolatecom\b", "chocolate com"),
    (r"\bmi lanesa\b", "milanesa"), (r"\bNestlê\b", "Nestlé"), (r"\bdemanteiga\b", "de manteiga"),
    (r"^Pa com osso", "Pá com osso"), (r"\b([Pp])ure de\b", r"\1urê de"), (r"\b(castanha|Castanha)[ -]do[ -]para\b", r"\1-do-pará"),
    (r"\b(castanha|Castanha)[ -]da[ -]india\b", r"\1-da-índia"),
    (r"\ba (milanesa|passarinho|grega|parmegiana|moda|bolonhesa|carbonara|francesa|portuguesa|baiana|mineira|caipira|primavera|piamontese|brasileira|cubana|dorê)\b", r"à \1"),
]

# Palavras que costumam vir grudadas na anterior/posterior nos catálogos em PDF ("frangocongelada").
_DEPOIS = ("congelada", "congelado", "congelados", "papinhas", "nestlé", "original", "tradicional", "light",
           "crocante", "recheado", "recheada", "desidratada", "desidratado", "industrializado", "com", "sem", "sabor")
_ANTES = ("com", "sabor", "de", "do", "da")
_LEGITIMAS = {"composta", "composto", "compota", "comum", "completo", "completa", "combinado", "combinada",
              "comprimido", "comestível", "goiabada", "laranjada", "galinhada", "marmelada", "cocada", "limonada",
              "bananada", "vitaminada", "sementes", "presente"}

_MEDIDAS_IGNORADAS = {"", "grama", "gramas", "quilo", "mililitro", "litro"}
_MEDIDAS_UNIFICAR = {
    "colher de arroz/servir": "Colher de arroz", "colher de arroz": "Colher de arroz",
    "prato sobremesa": "Prato de sobremesa", "garrafa (n. e.)": "Garrafa", "lata (n. e.)": "Lata",
    "file": "Filé", "copo de cafezinho": "Copo de cafezinho",
}


def corrigir_mojibake(texto: str) -> str:
    """'contrafilÃ©' -> 'contrafilé' (UTF-8 lido como Latin-1/CP1252, às vezes duas vezes)."""
    for _ in range(2):
        # "Ã" seguido de outro caractere não ASCII ("Ã©", "Ã“", "Ã§"): sinal de UTF-8 lido como CP1252
        if not texto or not re.search("[ÃÂ][^\x00-\x7f]", texto):
            break
        for codec in ("cp1252", "latin-1"):
            try:
                texto = texto.encode(codec).decode("utf-8")
                break
            except (UnicodeEncodeError, UnicodeDecodeError):
                continue
        else:
            break
    return texto


def _sem_acento(s: str) -> str:
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")


def _trocar_palavra(m: re.Match) -> str:
    palavra = m.group(0)
    certo = ACENTOS.get(palavra.lower())
    if not certo:
        return palavra
    if certo[0].isupper():
        return certo
    if palavra.isupper() and len(palavra) > 1:
        return certo.upper()
    return certo[0].upper() + certo[1:] if palavra[0].isupper() else certo


def _separar_grudadas(m: re.Match, vocab: set) -> str:
    w = m.group(0)
    lw = w.lower()
    # palavra comum na base (aparece 5+ vezes) nao e grudada
    if len(lw) < 7 or lw in _LEGITIMAS or lw in vocab:
        return w
    for suf in _DEPOIS:
        if lw.endswith(suf) and len(lw) - len(suf) >= 3 and lw[:-len(suf)] in vocab:
            return f"{w[:-len(suf)]} {w[-len(suf):]}"
    for pre in _ANTES:
        minimo = 5 if len(pre) == 2 else 4
        if lw.startswith(pre) and len(lw) - len(pre) >= minimo and lw[len(pre):] in vocab:
            return f"{w[:len(pre)]} {w[len(pre):]}"
    return w


def normalizar_nome(nome: str, vocab: Optional[set] = None) -> str:
    s = unicodedata.normalize("NFC", corrigir_mojibake(str(nome or "")))
    s = s.replace(" ", " ").replace("´", "'").replace("`", "'")
    for padrao, troca in CORRECOES:
        s = re.sub(padrao, troca, s)
    # simbolo de marca que o PDF extraiu errado: "-Nestlé0", "Pullman0*", "NutrellaS)"
    s = re.sub(r"(-\s*[^-]*?[A-Za-zÀ-ÿ])0(\*?)$", r"\1®\2", s)
    s = re.sub(r"(?<=[a-zà-ÿ])S\)$", "®", s)
    s = re.sub(r"\s*\(\s*\)", "", s)
    # "integralFit" -> "integral Fit" (só depois de 2+ minúsculas, para não quebrar "mL", "McCain", "DeMarchi")
    s = re.sub(r"(?<=[a-zà-ÿ]{2})(?=[A-ZÀ-Ý])", " ", s)
    if vocab:
        s = re.sub(r"[a-zà-ÿ]{7,}", lambda m: _separar_grudadas(m, vocab), s)
    s = re.sub(r"[A-Za-zÀ-ÿ]+", _trocar_palavra, s)
    s = re.sub(r"\s+-\s*|\s*-\s+", " - ", s)               # "congelado -DeMarchi" -> "congelado - DeMarchi"
    s = re.sub(r"\s+,", ",", s)
    s = re.sub(r",(?=[^\s\d])", ", ", s)                   # "a,b" -> "a, b" (mas "0,5" fica)
    s = re.sub(r"\(\s+", "(", s)
    s = re.sub(r"\s+\)", ")", s)
    s = re.sub(r"(?<=[A-Za-zÀ-ÿ])\((?!(?:a|as|o|os|s)\))", " (", s)   # "manga(polpa)" -> "manga (polpa)"; mantém "cozido(a)"
    s = re.sub(r"\b(\w+(?: \w+){0,2}),? \1\b", r"\1", s)    # "em conserva em conserva", "fundido, fundido"
    # a tabela de origem aparece separada na busca; no nome ela iria para o PDF do paciente
    s = SUFIXO_TABELA.sub("", s)
    s = re.sub(r"\s{2,}", " ", s).strip(" ,-")
    if s and s[0].islower():
        s = s[0].upper() + s[1:]
    return s


def normalizar_medida(nome: str) -> Optional[str]:
    """'COLHER DE SOPA' / 'Colher de Sopa' -> 'Colher de sopa'; 'GARRAFA (200 ML)' -> 'Garrafa (200 mL)'."""
    s = re.sub(r"\s{2,}", " ", corrigir_mojibake(str(nome or "")).strip())
    chave = s.lower()
    if chave in _MEDIDAS_IGNORADAS or chave.startswith("nova medida"):
        return None
    if chave in _MEDIDAS_UNIFICAR:
        return _MEDIDAS_UNIFICAR[chave]
    s = re.sub(r"[A-Za-zÀ-ÿ]+", lambda m: ACENTOS.get(m.group(0).lower(), m.group(0).lower()), chave)
    s = re.sub(r"(\d)\s*ml\b", r"\1 mL", s)
    s = re.sub(r"(\d)\s*l\b", r"\1 L", s)
    s = re.sub(r"^garrafa (\d)", r"garrafa (\1", s) if re.match(r"^garrafa \d", s) and "(" not in s else s
    if s.startswith("garrafa (") and not s.endswith(")"):
        s += ")"
    return s[0].upper() + s[1:] if s else None


# ── Chave para cruzar nomes (base x IBGE) ───────────────────────────────────

_GENERO = {"crua": "cru", "cozida": "cozido", "crozido": "cozido", "assada": "assado", "frita": "frito",
           "grelhada": "grelhado", "refogada": "refogado", "empanada": "empanado", "ensopada": "ensopado",
           "torrada": "torrado", "inteira": "inteiro", "picada": "picado"}
_VAZIAS = {"de", "da", "do", "das", "dos", "e", "com", "em", "a", "o", "ao", "na", "no", "as", "os"}
PREPAROS = {"cru", "cozido", "assado", "frito", "grelhado", "refogado", "empanado", "ensopado", "brasa",
            "churrasco", "milanesa", "natura", "in"}


SUFIXO_TABELA = re.compile(r"\s*\((IBGE|TACO|TBCA|Tucunduva)\)\s*$")


def tokens_casamento(texto: str) -> frozenset:
    s = SUFIXO_TABELA.sub("", corrigir_mojibake(str(texto or "")))
    s = _sem_acento(s).lower()
    s = re.sub(r"\((a|as|o|os|s)\)", "", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return frozenset(_GENERO.get(t, t) for t in s.split() if t not in _VAZIAS)


# ── Medidas caseiras de cada alimento ───────────────────────────────────────

# Palavras que mudam a forma do alimento: "farinha de grão-de-bico" não herda a medida do grão.
_MUDAM_FORMA = {"farinha", "sopa", "clara", "gema", "suco", "polpa", "po", "molho", "doce", "extrato", "bebida",
                "oleo", "creme", "pasta", "caldo", "salada", "farelo", "fuba", "xarope", "geleia", "compota",
                "desidratado", "desidratada", "liofilizado", "concentrado", "enlatado", "conserva", "mistura",
                "ralado", "ralada", "flocos", "picado", "picada", "moido", "moida", "liquido", "liquida", "nectar",
                "vitamina", "iogurte", "sorvete", "pudim", "bolo", "torta", "biscoito", "pao", "barra"}
_RUIDO_NOME = {"natura", "in", "media", "diferentes", "amostras", "varias", "tipo", "l", "s", "c",
               "industrializado", "industrializada", "marcas", "sabores", "qualquer", "marca"}


def _carregar_ibge() -> dict:
    caminho = RAIZ / "medidas_ibge.json"
    if not caminho.exists():
        return {}
    return json.loads(caminho.read_text(encoding="utf-8")).get("por_alimento", {})


def montar_medidas(alimento_id: str, nome_original: str, medidas_planilha: Callable[[str], list], ibge: dict) -> list:
    """Planilha EVONUT primeiro; o IBGE completa as que faltam (mesma medida não repete)."""
    saida, vistos = [], set()
    candidatos = [(m.get("nome"), m.get("gramas")) for m in medidas_planilha(nome_original)]
    candidatos += [(m.get("nome"), m.get("gramas")) for m in ibge.get(str(alimento_id), [])]
    for nome, gramas in candidatos:
        nome_n = normalizar_medida(nome)
        try:
            g = round(float(gramas), 2)
        except (TypeError, ValueError):
            continue
        if not nome_n or g <= 0 or nome_n.lower() in vistos:
            continue
        vistos.add(nome_n.lower())
        saida.append({"nome": nome_n, "gramas": g})
    return saida


# ── Sincronização no boot ───────────────────────────────────────────────────

TABELA_ENXUTA = RAIZ / "tabela_enxuta_alimentos.json"
# documentos que guardam alimentos escolhidos (dietas, modelos, recordatórios...): usados no relatório de impacto
_COLECOES_COM_ALIMENTOS = ("planos_manuais", "plano_templates", "recordatorios", "modelos_refeicao",
                           "listas_substituicao", "meal_plans")
# só a base do sistema é arquivada; o que o nutricionista cadastrou nunca é tocado
_FILTRO_BASE = {"nutricionista_id": {"$exists": False}, "fonte": {"$ne": "CUSTOM"}}


def carregar_tabela_enxuta() -> list:
    """A única base de alimentos do sistema: TABELA ENXUTA do Rogério (262 alimentos)."""
    return json.loads(TABELA_ENXUTA.read_text(encoding="utf-8"))["alimentos"]


def medidas_da_tabela(a: dict, ibge: dict) -> tuple:
    """Medidas da aba 'Cadastro de Medidas' da planilha. Sem nenhuma lá, usa a do IBGE marcada como estimada."""
    saida, vistos = [], set()
    for m in a.get("medidas_caseiras") or []:
        nome = normalizar_medida(m.get("nome"))
        try:
            g = round(float(m.get("gramas")), 2)
        except (TypeError, ValueError):
            continue
        if nome and g > 0 and nome.lower() not in vistos:
            vistos.add(nome.lower())
            saida.append({"nome": nome, "gramas": g})
    if saida:
        return saida, "tabela_enxuta"
    estimadas = [{**m, "estimada": True} for m in montar_medidas(str(a["id"]), "", lambda _n: [], ibge)]
    return estimadas, ("ibge_estimada" if estimadas else None)


def _ids_citados(valor, achados: set) -> None:
    if isinstance(valor, dict):
        for k, v in valor.items():
            if k == "alimento_id" and v is not None:
                achados.add(str(v))
            else:
                _ids_citados(v, achados)
    elif isinstance(valor, list):
        for v in valor:
            _ids_citados(v, achados)


async def relatorio_impacto(db, arquivar: set) -> dict:
    """Quantas dietas, modelos e recordatórios usam alimentos que vão ser arquivados (e quais os mais usados)."""
    por_colecao, frequencia = {}, {}
    for col in _COLECOES_COM_ALIMENTOS:
        docs = 0
        async for d in db[col].find({}, {"_id": 0}):
            ids = set()
            _ids_citados(d, ids)
            usados = ids & arquivar
            if usados:
                docs += 1
                for i in usados:
                    frequencia[i] = frequencia.get(i, 0) + 1
        por_colecao[col] = docs
    top = sorted(frequencia.items(), key=lambda kv: -kv[1])[:20]
    nomes = {d["id"]: d.get("nome") async for d in db.alimentos.find({"id": {"$in": [i for i, _ in top]}}, {"_id": 0, "id": 1, "nome": 1})}
    return {"documentos_afetados": por_colecao,
            "mais_usados": [{"id": i, "nome": nomes.get(i), "documentos": n} for i, n in top]}


async def sincronizar_base(db) -> Optional[dict]:
    """Grava a TABELA ENXUTA (upsert por id) e arquiva o resto da base antiga. Roda uma vez por BASE_VERSAO.

    Arquivar não apaga: o alimento some da busca, mas continua sendo encontrado por id, para dietas antigas
    abrirem e calcularem igual. Para desfazer: db.alimentos.update_many({"arquivado": True}, {"$unset": {"arquivado": ""}}).
    """
    marcador = await db.meta_sistema.find_one({"_id": "base_alimentos"})
    if marcador and marcador.get("versao") == BASE_VERSAO:
        return None
    alimentos = carregar_tabela_enxuta()
    ids_novos = {str(a["id"]) for a in alimentos}
    ibge = _carregar_ibge()
    agora = datetime.now(timezone.utc).isoformat()

    # relatório de impacto ANTES de arquivar
    arquivar = {d["id"] async for d in db.alimentos.find({**_FILTRO_BASE, "id": {"$nin": list(ids_novos)}}, {"_id": 0, "id": 1})}
    impacto = await relatorio_impacto(db, arquivar)
    log.info("Impacto do arquivamento (%d alimentos): %s", len(arquivar), impacto)

    ops, origens = [], {}
    for a in alimentos:
        aid = str(a["id"])
        original = a.get("nome") or ""
        medidas, origem = medidas_da_tabela(a, ibge)
        origens[origem or "sem_medida"] = origens.get(origem or "sem_medida", 0) + 1
        doc = {k: v for k, v in a.items() if k != "medidas_caseiras"}
        doc.update(id=aid, nome=normalizar_nome(original), nome_original=original,
                   medidas_caseiras=medidas, medidas_origem=origem, base="tabela_enxuta")
        ops.append(UpdateOne({"id": aid}, {"$set": doc, "$unset": {"arquivado": "", "arquivado_em": "", "arquivado_motivo": ""}},
                             upsert=True))
    await db.alimentos.bulk_write(ops, ordered=False)

    res = await db.alimentos.update_many(
        {**_FILTRO_BASE, "id": {"$nin": list(ids_novos)}, "arquivado": {"$ne": True}},
        {"$set": {"arquivado": True, "arquivado_em": agora, "arquivado_motivo": "fora da TABELA ENXUTA"}},
    )
    resumo = {"base": "TABELA ENXUTA", "alimentos": len(alimentos), "origem_medidas": origens,
              "arquivados": res.modified_count, "impacto_arquivamento": impacto}
    await db.meta_sistema.update_one(
        {"_id": "base_alimentos"},
        {"$set": {"versao": BASE_VERSAO, "resumo": resumo, "atualizado_em": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    log.info("Base de alimentos sincronizada (%s): %s", BASE_VERSAO, resumo)
    return resumo
