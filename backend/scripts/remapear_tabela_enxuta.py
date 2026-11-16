"""Remapeia padroes_sugeridos.json e equivalentes_evonut.json para a TABELA ENXUTA.

Regra: um alimento que saiu da base só é trocado por um da nova base quando é o MESMO alimento
(mesmas palavras do nome, desconsiderando a tabela de origem e o nome científico, ou no máximo uma
palavra a mais que não muda a forma nem o preparo) E os macros por 100 g batem:
  - energia: diferença de até 15% (ou até 15 kcal em alimentos de baixa caloria);
  - proteína, carboidrato e gordura: diferença de até 2 g ou até 20%.
O que não casar fica como está e entra no relatório para o Rogério decidir.

A base antiga é lida de evonut_database.json; se a lista `alimentos` já tiver sido removida,
vem do git (commit 0befb3b).

Uso (na pasta backend):  python scripts/remapear_tabela_enxuta.py
Saída: padroes_sugeridos.json e equivalentes_evonut.json atualizados +
       relatorios/remapeamento_tabela_enxuta.md
"""
import json
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from alimentos_base import PREPAROS, _MUDAM_FORMA, _RUIDO_NOME, normalizar_nome, tokens_casamento  # noqa: E402

MACROS = ("energia_kcal", "proteina_g", "carboidrato_g", "lipideos_g")


def base_antiga() -> list:
    dados = json.loads((BACKEND / "evonut_database.json").read_text(encoding="utf-8"))
    if dados.get("alimentos"):
        return dados["alimentos"]
    bruto = subprocess.run(["git", "show", "0befb3b:backend/evonut_database.json"], cwd=BACKEND,
                           capture_output=True, check=True).stdout
    return json.loads(bruto.decode("utf-8"))["alimentos"]


def macros(a: dict) -> dict:
    n = a.get("nutrientes") or {}
    return {k: float(n.get(k) or 0) for k in MACROS}


def macros_batem(x: dict, y: dict) -> bool:
    a, b = macros(x), macros(y)
    kcal = abs(a["energia_kcal"] - b["energia_kcal"])
    if kcal > max(15.0, 0.15 * max(a["energia_kcal"], b["energia_kcal"])):
        return False
    for k in ("proteina_g", "carboidrato_g", "lipideos_g"):
        if abs(a[k] - b[k]) > max(2.0, 0.2 * max(a[k], b[k])):
            return False
    return True


def distancia(x: dict, y: dict) -> float:
    a, b = macros(x), macros(y)
    return abs(a["energia_kcal"] - b["energia_kcal"]) / 10 + sum(abs(a[k] - b[k]) for k in MACROS[1:])


def main():
    nova = json.loads((BACKEND / "tabela_enxuta_alimentos.json").read_text(encoding="utf-8"))["alimentos"]
    antiga = base_antiga()
    ids_novos = {str(a["id"]) for a in nova}
    por_id_antigo = {str(a["id"]): a for a in antiga}

    # vocabulário "comum" para tirar nome científico dos nomes TBCA ("Persea americana")
    voc = set()
    for a in antiga:
        if a.get("fonte") in ("TACO", "IBGE", "Tucunduva"):
            voc |= tokens_casamento(a.get("nome"))

    def nucleo(a: dict) -> frozenset:
        t = tokens_casamento(normalizar_nome(a.get("nome") or ""))
        if a.get("fonte") == "TBCA":
            t = {x for x in t if x in voc}
        return frozenset(t - _RUIDO_NOME)

    nucleos_novos = [(nucleo(a), a) for a in nova]

    def equivalente(velho: dict):
        k = nucleo(velho)
        if not k:
            return None
        cands = []
        for kn, a in nucleos_novos:
            dif = k ^ kn
            if not dif or (len(dif) == 1 and not (dif & _MUDAM_FORMA) and not (dif & PREPAROS) and len(k & kn) >= 2):
                if macros_batem(velho, a):
                    cands.append(a)
        return min(cands, key=lambda a: distancia(velho, a)) if cands else None

    def chave_nome(nome: str) -> str:
        return " ".join(sorted(tokens_casamento(normalizar_nome(nome or ""))))

    por_nome_antigo = {}
    for a in antiga:
        por_nome_antigo.setdefault(chave_nome(a.get("nome")), a)
        por_nome_antigo.setdefault(chave_nome(a.get("nome") + f" ({a.get('fonte')})"), a)
    nomes_novos = {chave_nome(a["nome"]) for a in nova}

    remapeados, sem_par = [], []

    # ── padroes_sugeridos.json ──
    caminho_p = BACKEND / "padroes_sugeridos.json"
    padroes = json.loads(caminho_p.read_text(encoding="utf-8"))
    for secao in ("modelos_refeicao", "listas_substituicao"):
        for bloco in padroes.get(secao) or []:
            for item in bloco.get("alimentos") or []:
                aid = str(item.get("alimento_id") or "")
                if not aid or aid in ids_novos:
                    continue
                velho = por_id_antigo.get(aid)
                novo = equivalente(velho) if velho else None
                onde = f"padrões › {secao} › {bloco.get('nome')}"
                if not novo:
                    sem_par.append((onde, item.get("nome"), aid, velho.get("fonte") if velho else "?"))
                    continue
                remapeados.append((onde, item.get("nome"), aid, novo["nome"], str(novo["id"])))
                item["alimento_id"] = str(novo["id"])
                item["nome"] = novo["nome"]
                medidas = {m["nome"].lower(): m["gramas"] for m in novo.get("medidas_caseiras") or []}
                if (item.get("medida_nome") or "").lower() not in medidas:
                    # medida antiga não existe no alimento novo: mantém o peso em gramas
                    item["medida_nome"] = "Gramas"
                    item["quantidade"] = item.get("quantidade_g")
    caminho_p.write_text(json.dumps(padroes, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    # ── equivalentes_evonut.json (por nome) ──
    caminho_e = BACKEND / "equivalentes_evonut.json"
    equiv = json.loads(caminho_e.read_text(encoding="utf-8"))

    def trocar_nome(nome: str, onde: str) -> str:
        if chave_nome(nome) in nomes_novos:
            return nome
        velho = por_nome_antigo.get(chave_nome(nome))
        novo = equivalente(velho) if velho else None
        if not novo:
            sem_par.append((onde, nome, str(velho["id"]) if velho else "-", velho.get("fonte") if velho else "não encontrado"))
            return nome
        remapeados.append((onde, nome, str(velho["id"]), novo["nome"], str(novo["id"])))
        return novo["nome"]

    for e in equiv:
        onde = f"equivalentes › lista {e.get('codigo')}"
        novo_base = trocar_nome(e.get("base_nome") or "", onde + " (alimento-base)")
        if novo_base != e.get("base_nome"):
            e["base_nome"] = novo_base
        for op in e.get("opcoes") or []:
            op["nome"] = trocar_nome(op.get("nome") or "", onde + " (opção)")
    caminho_e.write_text(json.dumps(equiv, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # ── relatório ──
    rel = BACKEND / "relatorios"
    rel.mkdir(exist_ok=True)
    linhas = ["# Remapeamento para a TABELA ENXUTA", "",
              "Critério: mesmo alimento (mesmas palavras do nome, sem a tabela de origem e sem nome científico) "
              "e macros por 100 g conferidos (energia ±15%, P/C/G ±2 g ou ±20%).", "",
              f"## Remapeados ({len(remapeados)})", "", "| Onde | Antes | id antigo | Depois | id novo |", "|---|---|---|---|---|"]
    linhas += [f"| {o} | {a} | {ia} | {d} | {idn} |" for o, a, ia, d, idn in remapeados]
    linhas += ["", f"## Sem correspondente na nova base ({len(sem_par)}) — Rogério decide", "",
               "Ficaram como estavam. Enquanto não forem trocados, o item aponta para um alimento arquivado: "
               "continua calculando, mas não aparece na busca.", "",
               "| Onde | Alimento | id | Tabela de origem |", "|---|---|---|---|"]
    linhas += [f"| {o} | {n} | {i} | {f} |" for o, n, i, f in sem_par]
    (rel / "remapeamento_tabela_enxuta.md").write_text("\n".join(linhas) + "\n", encoding="utf-8")
    print(f"remapeados: {len(remapeados)} | sem correspondente: {len(sem_par)}")


if __name__ == "__main__":
    main()
