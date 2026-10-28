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

BASE_VERSAO = "2026-10-28.2"
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
# grupos em que a mesma medida serve para quase todos os alimentos (colher de óleo, copo de suco...)
_GRUPOS_UNIFORMES = {"Óleos e Gorduras", "Sucos Naturais e Integrais", "Oleaginosas e Sementes", "Fibras A", "Fibras B",
                     "Feijão e Leguminosas"}
# medidas de "item inteiro" variam de alimento para alimento: nunca são estimadas por semelhança
_MEDIDAS_DO_ITEM = {"unidade", "unidade pequena", "metade", "banda", "posta", "espiga", "cacho", "asa", "coxa",
                    "sobrecoxa", "peito", "pescoço", "costela", "bife", "filé"}
_PRIORIDADE = {"TACO": 0, "IBGE": 1, "Tucunduva": 2, "TBCA": 3}
_VAZIAS_CHAVE = {"de", "da", "do", "das", "dos", "e", "com", "em", "a", "o", "ao", "c", "s"}


def _porcao_do_rotulo(a: dict) -> Optional[list]:
    """Produtos de marca: '15Uni/32G' -> unidade de 32 g; 'Lata, 480G, 15Doses' -> dose de 32 g;
    'Meus Alimentos' guardam a porção do rótulo em quantidade_referencia_g."""
    nome = a.get("nome") or ""
    m = re.search(r"(\d+)\s*Uni\s*/\s*(\d+(?:[.,]\d+)?)\s*G\b", nome, re.I)
    if m:
        return [{"nome": "Unidade", "gramas": float(m.group(2).replace(",", "."))}]
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*G\s*,\s*(\d+)\s*Doses", nome, re.I)
    if m:
        return [{"nome": "Dose", "gramas": round(float(m.group(1).replace(",", ".")) / int(m.group(2)), 1)}]
    ref = a.get("quantidade_referencia_g")
    if ref and float(ref) != 100.0:
        return [{"nome": "Porção", "gramas": float(ref)}]
    return None


def completar_medidas(alimentos: list, medidas: dict) -> dict:
    """Para alimentos ainda sem medida caseira, em ordem de confiança:
    1. o mesmo alimento em outra tabela (mesmas palavras, ou uma a mais que não muda a forma);
    2. a porção do rótulo (produtos de marca);
    3. a medida típica de alimentos do mesmo tipo (duas primeiras palavras) - marcada como estimada;
    4. a medida típica do grupo, só em grupos uniformes - estimada.
    Devolve {id: (medidas, origem)}."""
    voc_comum = set()
    for a in alimentos:
        if a.get("fonte") in ("TACO", "IBGE", "Tucunduva"):
            voc_comum |= tokens_casamento(a.get("nome"))

    def nucleo(a):
        t = tokens_casamento(a.get("nome"))
        if a.get("fonte") == "TBCA":  # descarta o nome científico ("Mangifera indica L.")
            t = {x for x in t if x in voc_comum}
        return frozenset(t - _RUIDO_NOME)

    def chave_tipo(a):
        palavras = [w for w in re.findall(r"[a-z]+", _sem_acento(normalizar_nome(a.get("nome"))).lower()) if w not in _VAZIAS_CHAVE]
        return " ".join(palavras[:2])

    com = [a for a in alimentos if medidas.get(str(a["id"]))]
    por_nucleo: dict = {}
    for a in com:
        por_nucleo.setdefault(nucleo(a), []).append(a)
    melhor = lambda lista: sorted(lista, key=lambda x: _PRIORIDADE.get(x.get("fonte"), 9))[0]

    def tipicas(grupos: dict, minimo: int, cv_max: float) -> dict:
        import statistics
        saida = {}
        for k, lista in grupos.items():
            if len(lista) < minimo:
                continue
            gramas: dict = {}
            for a in lista:
                for m in medidas[str(a["id"])]:
                    gramas.setdefault(m["nome"], []).append(m["gramas"])
            sel = []
            for nome, gs in gramas.items():
                if nome.lower() in _MEDIDAS_DO_ITEM:
                    continue
                if len(gs) >= max(4, 0.5 * len(lista)):
                    med = statistics.median(gs)
                    if med and statistics.pstdev(gs) / med <= cv_max:
                        sel.append((len(gs), {"nome": nome, "gramas": round(med, 1), "estimada": True}))
            if sel:
                saida[k] = [m for _, m in sorted(sel, key=lambda x: -x[0])[:3]]
        return saida

    por_tipo: dict = {}
    por_grupo: dict = {}
    for a in com:
        por_tipo.setdefault(chave_tipo(a), []).append(a)
        if a.get("grupo") in _GRUPOS_UNIFORMES:
            por_grupo.setdefault(a["grupo"], []).append(a)
    tipicas_tipo = tipicas(por_tipo, 5, 0.3)
    tipicas_grupo = tipicas(por_grupo, 10, 0.35)

    resultado = {}
    for a in alimentos:
        aid = str(a["id"])
        if medidas.get(aid):
            continue
        k = nucleo(a)
        forma = bool(k & _MUDAM_FORMA)
        if k and k in por_nucleo:
            resultado[aid] = ([dict(m) for m in medidas[str(melhor(por_nucleo[k])["id"])]], "outra_tabela")
            continue
        if len(k) >= 3:
            cands = [b for x in k if x not in _MUDAM_FORMA for b in por_nucleo.get(k - {x}, []) if len(k - {x}) >= 2]
            if cands:
                resultado[aid] = ([dict(m) for m in medidas[str(melhor(cands)["id"])]], "outra_tabela")
                continue
        rotulo = _porcao_do_rotulo(a)
        if rotulo:
            resultado[aid] = (rotulo, "rotulo")
            continue
        if forma:
            continue  # pó, suco, farinha... só com dado específico
        if chave_tipo(a) in tipicas_tipo:
            resultado[aid] = ([dict(m) for m in tipicas_tipo[chave_tipo(a)]], "semelhantes")
        elif a.get("grupo") in tipicas_grupo:
            resultado[aid] = ([dict(m) for m in tipicas_grupo[a["grupo"]]], "grupo")
    return resultado

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
    diretas = {str(a["id"]): montar_medidas(str(a["id"]), a.get("nome") or "", medidas_planilha, ibge) for a in alimentos}
    completadas = completar_medidas(alimentos, diretas)
    ops, com_medida, origens = [], 0, {}
    for a in alimentos:
        aid = str(a["id"])
        original = a.get("nome") or ""
        medidas, origem = (diretas[aid], "tabela") if diretas[aid] else completadas.get(aid, ([], None))
        com_medida += bool(medidas)
        if origem:
            origens[origem] = origens.get(origem, 0) + 1
        doc = {**a, "id": aid, "nome": normalizar_nome(original, vocab), "nome_original": original,
               "medidas_caseiras": medidas, "medidas_origem": origem}
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
    resumo = {"alimentos": len(alimentos), "com_medida": com_medida, "origem_medidas": origens, "antigos_corrigidos": corrigidos}
    await db.meta_sistema.update_one(
        {"_id": "base_alimentos"},
        {"$set": {"versao": BASE_VERSAO, "resumo": resumo, "atualizado_em": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    log.info("Base de alimentos sincronizada (%s): %s", BASE_VERSAO, resumo)
    return resumo
