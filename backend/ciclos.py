"""Ciclos de carboidrato (ajustes cid1 e cic1): onde o paciente está hoje e quando troca.

Espelha frontend/src/lib/ciclos.js. O ciclo fica em patients.ciclo_carbo:
- tipo "nivel": dias de carbo alto/médio/baixo, por dia da semana (unidade "dia") ou por semana (unidade "semana");
- tipo "haluch": 4 fases low/high carb de várias semanas, a partir de `inicio`.
Cada dieta do ciclo é um plano com `ciclo_tipo` = "alto" | "medio" | "baixo" | "fase1".."fase4".
"""
from datetime import date, timedelta
from typing import Optional

ROTULO_NIVEL = {"alto": "Carbo alto", "medio": "Carbo médio", "baixo": "Carbo baixo"}
DIAS = ["seg", "ter", "qua", "qui", "sex", "sab", "dom"]
NOME_DIA = {"seg": "segunda", "ter": "terça", "qua": "quarta", "qui": "quinta", "sex": "sexta", "sab": "sábado", "dom": "domingo"}


def _d(v) -> Optional[date]:
    try:
        return date.fromisoformat(str(v)[:10])
    except (TypeError, ValueError):
        return None


def _n(v, padrao=0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return padrao


def rotulo_tipo(ciclo: dict, chave: Optional[str]) -> Optional[str]:
    if not chave:
        return None
    if chave in ROTULO_NIVEL:
        return ROTULO_NIVEL[chave]
    if chave.startswith("fase") and ciclo and ciclo.get("tipo") == "haluch":
        i = int(chave[4:]) - 1
        fases = ciclo.get("fases") or []
        if 0 <= i < len(fases):
            return f"{fases[i].get('nome') or f'Fase {i + 1}'} · {'low' if fases[i].get('tipo') == 'low' else 'high'} carb"
    return chave


def situacao(ciclo: Optional[dict], hoje: date) -> Optional[dict]:
    """{chave, rotulo, texto, proxima_troca, proximo_rotulo} ou None."""
    if not ciclo or not ciclo.get("ativo", True):
        return None
    if ciclo.get("tipo") == "haluch":
        fases = ciclo.get("fases") or []
        if not fases:
            return None
        total = int(sum(_n(f.get("semanas")) for f in fases))
        inicio = _d(ciclo.get("inicio"))
        if not ciclo.get("trocar_pela_data", True) or not inicio:
            i = int(_n(ciclo.get("fase_manual"), 0))
            i = max(0, min(i, len(fases) - 1))
            return {"chave": f"fase{i + 1}", "rotulo": rotulo_tipo(ciclo, f"fase{i + 1}"), "texto": rotulo_tipo(ciclo, f"fase{i + 1}"), "proxima_troca": None}
        s = (hoje - inicio).days // 7
        if s < 0:
            return {"chave": "fase1", "rotulo": rotulo_tipo(ciclo, "fase1"), "texto": f"Ciclo começa em {inicio.strftime('%d/%m')}",
                    "proxima_troca": inicio, "proximo_rotulo": rotulo_tipo(ciclo, "fase1")}
        acc = 0
        for i, f in enumerate(fases):
            sem = int(_n(f.get("semanas")))
            if s < acc + sem:
                fim = inicio + timedelta(days=(acc + sem) * 7)
                prox = f"fase{i + 2}" if i + 1 < len(fases) else None
                return {"chave": f"fase{i + 1}", "rotulo": rotulo_tipo(ciclo, f"fase{i + 1}"),
                        "texto": f"{rotulo_tipo(ciclo, f'fase{i + 1}')} · semana {s - acc + 1} de {sem}",
                        "proxima_troca": fim if prox else None, "proximo_rotulo": rotulo_tipo(ciclo, prox) if prox else None,
                        "fim_ciclo": inicio + timedelta(days=total * 7)}
            acc += sem
        return {"chave": f"fase{len(fases)}", "rotulo": rotulo_tipo(ciclo, f"fase{len(fases)}"), "texto": "Ciclo terminado", "proxima_troca": None, "terminou": True}
    if ciclo.get("tipo") == "nivel":
        if ciclo.get("unidade") == "semana":
            seq = ciclo.get("sequencia") or ["alto", "medio", "baixo"]
            inicio = _d(ciclo.get("inicio")) or hoje
            s = max(0, (hoje - inicio).days // 7)
            chave = seq[s % len(seq)]
            prox = seq[(s + 1) % len(seq)]
            return {"chave": chave, "rotulo": ROTULO_NIVEL.get(chave), "texto": f"{ROTULO_NIVEL.get(chave)} · semana {s + 1}",
                    "proxima_troca": inicio + timedelta(days=(s + 1) * 7) if prox != chave else None, "proximo_rotulo": ROTULO_NIVEL.get(prox)}
        dia = DIAS[hoje.weekday()]
        chave = (ciclo.get("semana") or {}).get(dia) or "medio"
        return {"chave": chave, "rotulo": ROTULO_NIVEL.get(chave), "texto": f"Hoje ({NOME_DIA[dia]}): {ROTULO_NIVEL.get(chave)}", "proxima_troca": None}
    return None


def dias_do_tipo(ciclo: Optional[dict], chave: Optional[str]) -> list:
    """Dias da semana em que a dieta deste tipo é usada (cid1 por dia)."""
    if not ciclo or ciclo.get("tipo") != "nivel" or ciclo.get("unidade") == "semana" or not chave:
        return []
    return [d for d in DIAS if (ciclo.get("semana") or {}).get(d) == chave]
