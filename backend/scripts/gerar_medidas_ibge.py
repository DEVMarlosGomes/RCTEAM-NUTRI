#!/usr/bin/env python3
"""Gera backend/medidas_ibge.json a partir da Tabela de Medidas Referidas para os Alimentos Consumidos
no Brasil (IBGE, POF 2008-2009), cruzando com os alimentos da base EVONUT pelo nome.

Fonte (dados públicos do IBGE, reprodução permitida citando a fonte):
https://ftp.ibge.gov.br/Orcamentos_Familiares/Pesquisa_de_Orcamentos_Familiares_2008_2009/Tabela_de_Medidas_Referidas_para_os_Alimentos_Consumidos_no_Brasil/tabelamedidas_bd.zip

Uso: python scripts/gerar_medidas_ibge.py caminho/tabelamedidas_bd.xls
Cruzamento conservador: mesmo conjunto de palavras (sem acento, sem "de/com", cru/crua iguais) para
alimento + preparo; ou, se não houver, mesmo alimento sem a palavra de preparo.
"""
import json
import sys
from pathlib import Path

import xlrd

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
from alimentos_base import PREPAROS, normalizar_medida, tokens_casamento  # noqa: E402

FONTE = ("IBGE. Pesquisa de Orçamentos Familiares 2008-2009: Tabela de Medidas Referidas para os Alimentos "
         "Consumidos no Brasil. Rio de Janeiro: IBGE, 2011.")
SEM_PREPARO = {"NAO SE APLICA", ""}


def ler_ibge(xls: str) -> tuple[dict, dict]:
    sh = xlrd.open_workbook(xls).sheet_by_index(0)
    com_preparo: dict = {}   # tokens(alimento + preparo) -> medidas
    so_alimento: dict = {}   # tokens(alimento) -> medidas do preparo "não se aplica" ou cru
    for r in range(sh.nrows):
        codigo = sh.cell_value(r, 0)
        if not isinstance(codigo, float):
            continue
        alimento, preparo = str(sh.cell_value(r, 1)), str(sh.cell_value(r, 3)).strip()
        medida, gramas = normalizar_medida(sh.cell_value(r, 5)), sh.cell_value(r, 8)
        if not medida or not isinstance(gramas, float) or gramas <= 0:
            continue
        chave = tokens_casamento(alimento if preparo in SEM_PREPARO else f"{alimento} {preparo}")
        lista = com_preparo.setdefault(chave, [])
        if medida.lower() not in {m["nome"].lower() for m in lista}:
            lista.append({"nome": medida, "gramas": round(gramas, 1)})
        if preparo in SEM_PREPARO or preparo.startswith("CRU"):
            base = so_alimento.setdefault(tokens_casamento(alimento), [])
            if medida.lower() not in {m["nome"].lower() for m in base}:
                base.append({"nome": medida, "gramas": round(gramas, 1)})
    return com_preparo, so_alimento


def main(xls: str):
    com_preparo, so_alimento = ler_ibge(xls)
    alimentos = json.loads((BACKEND / "evonut_database.json").read_text(encoding="utf-8"))["alimentos"]
    por_alimento, exatos, sem_preparo = {}, 0, 0
    for a in alimentos:
        if a.get("fonte") in ("Danone", "Essential") or "®" in (a.get("nome") or ""):
            continue  # produtos de marca têm porção própria no rótulo
        t = tokens_casamento(a.get("nome"))
        if t in com_preparo:
            por_alimento[str(a["id"])] = com_preparo[t]
            exatos += 1
        elif (t - PREPAROS) and (t - PREPAROS) in so_alimento:
            por_alimento[str(a["id"])] = so_alimento[t - PREPAROS]
            sem_preparo += 1
    saida = {"fonte": FONTE, "por_alimento": por_alimento}
    (BACKEND / "medidas_ibge.json").write_text(json.dumps(saida, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"IBGE: {len(com_preparo)} alimento+preparo; base: {len(alimentos)} alimentos")
    print(f"com medidas do IBGE: {len(por_alimento)} (nome igual: {exatos}; sem o preparo: {sem_preparo})")


if __name__ == "__main__":
    main(sys.argv[1])
