"""Base de alimentos: normalização de nomes e medidas caseiras + sincronização com o banco.

A base EVONUT (evonut_database.json) veio de planilhas e catálogos em PDF: tem palavras grudadas
("integralFit", "frangocongelada"), acentos faltando ("oleo"), espaços sobrando e, no seed antigo
do server.py, acentuação corrompida ("contrafilÃ©"). Aqui ficam as regras que limpam isso e a
rotina que, no boot do servidor, grava a base normalizada no banco (uma vez por versão).

As medidas caseiras de cada alimento são gravadas no próprio documento (`medidas_caseiras`), a partir
da planilha EVONUT e da Tabela de Medidas Referidas do IBGE (POF 2008-2009, medidas_ibge.json).
Assim elas não dependem do nome, que muda com a normalização (o nome antigo fica em `nome_original`).
"""
import json
import logging
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

from pymongo import UpdateOne

BASE_VERSAO = "2026-10-28.1"
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
    (r"\bmi lanesa\b", "milanesa"),
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


def tokens_casamento(texto: str) -> frozenset:
    s = _sem_acento(corrigir_mojibake(str(texto or ""))).lower()
    s = re.sub(r"\((a|as|o|os|s)\)", "", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return frozenset(_GENERO.get(t, t) for t in s.split() if t not in _VAZIAS)


# ── Medidas caseiras de cada alimento ───────────────────────────────────────

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

def _vocabulario(nomes: list) -> set:
    contagem: dict = {}
    for n in nomes:
        for w in re.findall(r"[a-zà-ÿ]+", str(n).lower()):
            contagem[w] = contagem.get(w, 0) + 1
    return {w for w, c in contagem.items() if c >= 5 and len(w) >= 3}


async def sincronizar_base(db, medidas_planilha: Callable[[str], list]) -> Optional[dict]:
    """Grava a base EVONUT normalizada (upsert por id) e corrige nomes antigos. Roda uma vez por BASE_VERSAO."""
    marcador = await db.meta_sistema.find_one({"_id": "base_alimentos"})
    if marcador and marcador.get("versao") == BASE_VERSAO:
        return None
    dados = json.loads((RAIZ / "evonut_database.json").read_text(encoding="utf-8"))
    alimentos = dados.get("alimentos", [])
    ibge = _carregar_ibge()
    vocab = _vocabulario([a.get("nome") for a in alimentos])
    ops, com_medida = [], 0
    for a in alimentos:
        aid = str(a["id"])
        original = a.get("nome") or ""
        medidas = montar_medidas(aid, original, medidas_planilha, ibge)
        com_medida += bool(medidas)
        doc = {**a, "id": aid, "nome": normalizar_nome(original, vocab), "nome_original": original,
               "medidas_caseiras": medidas}
        ops.append(UpdateOne({"id": aid}, {"$set": doc}, upsert=True))
    for i in range(0, len(ops), 500):
        await db.alimentos.bulk_write(ops[i:i + 500], ordered=False)

    # Alimentos antigos da base (seed TACO do server.py, "Meus Alimentos"): corrige nomes e medidas.
    ids_evonut = {str(a["id"]) for a in alimentos}
    corrigidos = 0
    async for d in db.alimentos.find({"nutricionista_id": {"$exists": False}}, {"_id": 0, "id": 1, "nome": 1,
                                                                                 "categoria": 1, "medida_caseira": 1}):
        if d.get("id") in ids_evonut:
            continue
        upd = {}
        for campo in ("nome", "categoria", "medida_caseira"):
            if d.get(campo):
                novo = normalizar_nome(d[campo], vocab) if campo == "nome" else corrigir_mojibake(d[campo])
                if novo != d[campo]:
                    upd[campo] = novo
        if upd:
            if "nome" in upd:
                upd["nome_original"] = d["nome"]
            await db.alimentos.update_one({"id": d["id"]}, {"$set": upd})
            corrigidos += 1
    resumo = {"alimentos": len(alimentos), "com_medida": com_medida, "antigos_corrigidos": corrigidos}
    await db.meta_sistema.update_one(
        {"_id": "base_alimentos"},
        {"$set": {"versao": BASE_VERSAO, "resumo": resumo, "atualizado_em": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    log.info("Base de alimentos sincronizada (%s): %s", BASE_VERSAO, resumo)
    return resumo
