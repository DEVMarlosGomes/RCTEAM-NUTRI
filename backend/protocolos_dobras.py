"""Protocolos de % de gordura da planilha EVONUT/TABELA ENXUTA (aba oculta BD ANTROPOMETRIA, linhas 15 a 50).

Fórmulas copiadas da planilha (densidade corporal -> % gordura por Siri, 1961: %G = (4,95/D - 4,5) x 100),
com as mesmas dobras e perímetros de cada protocolo. Como na planilha, o protocolo só calcula quando TODAS as
medidas dele estão preenchidas.

Divergência conhecida (A CONFIRMAR com o Rogério): na planilha, Petroski (1995) masculino usa
0,00000212 x (S x 2); a fórmula publicada usa S² (soma ao quadrado). Aqui está a publicada (S²). Ver
PETROSKI_M_COMO_PLANILHA para reproduzir a planilha, se for decidido assim.
"""
import math
from typing import Optional

PETROSKI_M_COMO_PLANILHA = False

# id -> nome, faixa etária (M/F) da planilha, dobras e perímetros usados (chaves do app)
PROTOCOLOS = {
    "durnin": {"nome": "Durnin e Womersley (1974)", "faixa": {"M": (17, 72), "F": (16, 68)},
               "dobras": {"M": ["bicipital", "tricipital", "suprailiaca", "subescapular"],
                          "F": ["bicipital", "tricipital", "suprailiaca", "subescapular"]}},
    "guedes": {"nome": "Guedes (1985)", "faixa": {"M": (18, 30), "F": (18, 30)},
               "dobras": {"M": ["abdominal", "tricipital", "suprailiaca"], "F": ["suprailiaca", "subescapular", "coxa"]}},
    "pollock3": {"nome": "Jackson, Pollock e Ward 3D (1980)", "faixa": {"M": (18, 61), "F": (18, 55)},
                 "dobras": {"M": ["abdominal", "peitoral", "coxa"], "F": ["tricipital", "suprailiaca", "coxa"]}},
    "pollock7": {"nome": "Jackson, Pollock e Ward 7D (1980)", "faixa": {"M": (18, 61), "F": (18, 55)},
                 "dobras": {s: ["abdominal", "tricipital", "suprailiaca", "axilar", "subescapular", "peitoral", "coxa"] for s in "MF"}},
    "petroski": {"nome": "Petroski (1995)", "faixa": {"M": (18, 66), "F": (18, 66)},
                 "dobras": {"M": ["tricipital", "suprailiaca", "subescapular", "panturrilha"],
                            "F": ["suprailiaca", "axilar", "coxa", "panturrilha"]}},
    "faulkner": {"nome": "Faulkner (1968)", "faixa": {"M": (18, None), "F": (18, None)},
                 "dobras": {s: ["abdominal", "tricipital", "suprailiaca", "subescapular"] for s in "MF"}},
    "weltman": {"nome": "Weltman e col. (1988)", "faixa": {"M": (20, 68), "F": (20, 60)},
                "dobras": {"M": [], "F": []}, "perimetros": {"M": ["abdomen"], "F": ["abdomen"]}},
    "mcardle": {"nome": "McArdle (1992)", "faixa": {"M": (9, 16), "F": (9, 16)},
                "dobras": {s: ["tricipital", "subescapular"] for s in "MF"}},
    "slaughter": {"nome": "Slaughter (1988)", "faixa": {"M": (7, 18), "F": (7, 17)},
                  "dobras": {s: ["tricipital", "subescapular"] for s in "MF"}},
    "marinha_eua": {"nome": "Marinha dos Estados Unidos", "faixa": {"M": (None, None), "F": (None, None)},
                    "dobras": {"M": [], "F": []}, "perimetros": {"M": ["pescoco", "abdomen"], "F": ["pescoco", "cintura", "quadril"]}},
}


def _num(v) -> Optional[float]:
    try:
        f = float(str(v).replace(",", "."))
        return f if f > 0 else None
    except (TypeError, ValueError):
        return None


def _siri(d: Optional[float]) -> Optional[float]:
    return None if not d or d <= 0 else (4.95 / d - 4.5) * 100


def _roundup2(x: float) -> float:
    """ARREDONDAR.PARA.CIMA(x; 2) do Excel (afasta do zero)."""
    return math.copysign(math.ceil(abs(x) * 100 - 1e-9) / 100, x)


def aviso_idade(protocolo: str, sexo: str, idade: Optional[float]) -> Optional[str]:
    p = PROTOCOLOS.get(protocolo)
    if not p or idade is None:
        return None
    mn, mx = p["faixa"]["M" if sexo == "M" else "F"]
    if (mn is not None and idade < mn) or (mx is not None and idade > mx):
        faixa = f"{mn} a {mx} anos" if mn is not None and mx is not None else (f"a partir de {mn} anos" if mn is not None else "")
        return f"Idade fora da faixa do protocolo {p['nome']} ({faixa})."
    return None


def calcular(protocolo: str, sexo: str, idade: Optional[float], peso: Optional[float], altura: Optional[float],
             dobras: dict, perimetria: Optional[dict] = None) -> dict:
    """{'pct_gordura', 'densidade', 'soma_dobras', 'faltando', 'aviso_idade'} — pct None se faltar medida."""
    sexo = "M" if str(sexo).upper().startswith("M") or sexo == 1 else "F"
    p = PROTOCOLOS.get(protocolo)
    out = {"pct_gordura": None, "densidade": None, "soma_dobras": None, "faltando": [], "aviso_idade": aviso_idade(protocolo, sexo, idade)}
    if not p:
        return out
    dobras = dict(dobras or {})
    if dobras.get("tricipital") is None and dobras.get("triceps") is not None:
        dobras["tricipital"] = dobras["triceps"]
    perimetria = perimetria or {}
    d = {k: _num(dobras.get(k)) for k in p["dobras"][sexo]}
    per = {k: _num(perimetria.get(k)) for k in (p.get("perimetros") or {}).get(sexo, [])}
    out["faltando"] = [k for k, v in {**d, **per}.items() if v is None]
    if out["faltando"]:
        return out
    s = sum(d.values()) if d else None
    out["soma_dobras"] = round(s, 2) if s is not None else None
    log = math.log10
    dens = pct = None
    idade = float(idade or 0)

    if protocolo == "durnin":
        dens = (1.1765 - 0.0744 * log(s)) if sexo == "M" else (1.1567 - 0.0717 * log(s))
    elif protocolo == "guedes":
        dens = (1.17136 - 0.06706 * log(s)) if sexo == "M" else (1.1665 - 0.07063 * log(s))
    elif protocolo == "pollock3":
        dens = (1.10938 - 0.0008267 * s + 0.0000016 * s * s - 0.0002574 * idade) if sexo == "M" \
            else (1.0994921 - 0.0009929 * s + 0.0000023 * s * s - 0.0001392 * idade)
    elif protocolo == "pollock7":
        dens = (1.112 - 0.00043499 * s + 0.00000055 * s * s - 0.00028826 * idade) if sexo == "M" \
            else (1.097 - 0.00046971 * s + 0.00000056 * s * s - 0.00012828 * idade)
    elif protocolo == "petroski":
        if sexo == "M":
            termo = s * 2 if PETROSKI_M_COMO_PLANILHA else s * s
            dens = 1.10726863 - 0.00081201 * s + 0.00000212 * termo - 0.00041761 * idade
        else:
            dens = 1.1954713 - 0.07513507 * log(s) - 0.00041072 * idade
    elif protocolo == "faulkner":
        pct = s * 0.153 + 5.783
    elif protocolo == "weltman":
        if not (peso and (altura or sexo == "M")):
            out["faltando"] = ["peso" if not peso else "altura"]
            return out
        abd = per["abdomen"]
        pct = (0.31457 * abd - 0.10969 * peso + 10.8336) if sexo == "M" \
            else (0.11077 * abd - 0.17666 * altura + 0.14354 * peso + 51.03301)
    elif protocolo == "mcardle":
        tri, sub = d["tricipital"], d["subescapular"]
        if 9 <= idade <= 12:
            dens = (1.108 - 0.027 * log(tri) - 0.038 * log(sub)) if sexo == "M" else (1.088 - 0.014 * log(tri) - 0.036 * log(sub))
        elif 13 <= idade <= 16:
            dens = (1.13 - 0.055 * log(tri) - 0.026 * log(sub)) if sexo == "M" else (1.114 - 0.031 * log(tri) - 0.041 * log(sub))
    elif protocolo == "slaughter":
        if sexo == "M":
            if s > 35:
                pct = 0.783 * s + 1.6
            else:
                # média branca/negra por estágio (como na planilha): pré-púbere 7-12, púbere 13-14, pós-púbere 15-17
                base = 1.21 * s - 0.008 * s * s
                if 7 <= idade <= 12:
                    pct = base - (1.7 + 3.5) / 2
                elif 13 <= idade <= 14:
                    pct = base - (3.4 + 5.2) / 2
                elif 15 <= idade <= 17:
                    pct = base - (5.5 + 6.8) / 2
        else:
            pct = (0.546 * s + 9.7) if s > 35 else (1.33 * s - 0.013 * s * s - 2.5)
    elif protocolo == "marinha_eua":
        if not altura:
            out["faltando"] = ["altura"]
            return out
        if sexo == "M":
            dif = per["abdomen"] - per["pescoco"]
            pct = _roundup2(495 / (1.0324 - 0.19077 * log(dif) + 0.15456 * log(altura)) - 450) if dif > 0 else None
        else:
            soma = per["cintura"] + per["quadril"] - per["pescoco"]
            pct = _roundup2(495 / (1.29579 - 0.35004 * log(soma) + 0.221 * log(altura)) - 450) if soma > 0 else None

    if dens is not None:
        out["densidade"] = round(dens, 5)
        pct = _siri(dens)
    out["pct_gordura"] = round(pct, 2) if pct is not None else None
    return out


def lista_publica() -> list:
    return [{"id": k, "nome": v["nome"], "faixa": v["faixa"], "dobras": v["dobras"], "perimetros": v.get("perimetros", {"M": [], "F": []})}
            for k, v in PROTOCOLOS.items()]


# ── Cor das dobras (doc "Critérios de cor das dobras cutâneas", 02/11/2026) — igual a frontend dobrasCores.js ──
DOBRAS_ORDEM = [("bicipital", "Bicipital"), ("abdominal", "Abdominal"), ("tricipital", "Tricipital"),
                ("suprailiaca", "Suprailíaca"), ("axilar", "Axilar média"), ("subescapular", "Subescapular"),
                ("peitoral", "Peitoral"), ("coxa", "Coxa"), ("panturrilha", "Panturrilha")]

# [mínimo, máximo] em mm: mínimo = máximo Pré-contest, máximo = máximo Off-season. Total feminino limitado a 86.
FAIXAS_ATLETA = {
    "M": {"tricipital": (3, 6), "peitoral": (3, 6), "axilar": (4, 8), "subescapular": (8, 12), "abdominal": (5, 12),
          "suprailiaca": (4, 10), "coxa": (5, 10), "total": (32, 64)},
    "F": {"tricipital": (10, 14), "peitoral": (3, 6), "axilar": (7, 10), "subescapular": (9, 14), "abdominal": (6, 14),
          "suprailiaca": (6, 12), "coxa": (14, 20), "total": (55, 86)},
}


def cor_dobra(atleta: bool, sexo: Optional[str], chave: str, valor: Optional[float], anterior: Optional[float] = None) -> Optional[str]:
    """'vermelho' | 'branco' | 'verde' | 'cinza' | None (sem cor)."""
    if valor is None:
        return None
    if atleta:
        faixa = FAIXAS_ATLETA.get(sexo or "", {}).get(chave)
        if not faixa:
            return None
        return "vermelho" if valor > faixa[1] else "verde" if valor < faixa[0] else "branco"
    if anterior is None:
        return "cinza"
    d = valor - anterior
    variacao = math.copysign(round(abs(d) * 10 + 1e-9) / 10, d)  # 1 casa, simétrico
    return "vermelho" if variacao > 0.5 else "verde" if variacao < -0.5 else "branco"
