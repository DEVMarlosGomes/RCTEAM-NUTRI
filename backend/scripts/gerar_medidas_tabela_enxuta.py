"""Gera frontend/public/data/cadastro_medidas_caseiras_evonut_wide.csv a partir da TABELA ENXUTA.

Mesmo cabeçalho do arquivo anterior (aba "Cadastro de Medidas" da planilha), uma linha por alimento
dos 262, gramas por 1 medida. É o índice por nome que o backend usa para alimentos cadastrados pelo
nutricionista; os alimentos da base já trazem as medidas no próprio documento.

Uso (na pasta backend):  python scripts/gerar_medidas_tabela_enxuta.py
"""
import csv
import json
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
DESTINO = BACKEND.parent / "frontend" / "public" / "data" / "cadastro_medidas_caseiras_evonut_wide.csv"

CABECALHO = (["Descrição do Alimento", "GRUPO", "File", "Bife", "Fatia", "Pedaço", "Porção", "Colher de Arroz",
              "Colher de Sopa", "Concha", "Escumadeira", "Colher de Chá", "Colher de Café", "Colher de Sobremesa",
              "Copo Americano", "Copo Médio", "Copo Grande", "Pegador", "Pote", "Prato Sobremesa", "Prato Fundo",
              "Prato Raso", "Tigela", "Xícara de Chá", "Asa", "Peito", "Coxa", "Sobrecoxa", "Costela", "Pescoço",
              "Unidade", "Unidade Pequena", "Metade", "Banda", "Punhado", "Garrafa 200ml", "Caneca", "Folha"]
             + [f"Nova Medida {i}" for i in range(1, 13)])


def fmt(g: float) -> str:
    return str(int(g)) if float(g).is_integer() else str(g)


def main():
    alimentos = json.loads((BACKEND / "tabela_enxuta_alimentos.json").read_text(encoding="utf-8"))["alimentos"]
    fora = set()
    with DESTINO.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(CABECALHO)
        for a in sorted(alimentos, key=lambda x: x["ordem_planilha"]):
            linha = {"Descrição do Alimento": a["nome"], "GRUPO": a.get("grupo") or ""}
            for m in a.get("medidas_caseiras") or []:
                if m["nome"] in CABECALHO:
                    linha[m["nome"]] = fmt(m["gramas"])
                else:
                    fora.add(m["nome"])
            w.writerow([linha.get(c, "") for c in CABECALHO])
    print(f"{len(alimentos)} alimentos -> {DESTINO}")
    if fora:
        print("medidas sem coluna no cabeçalho:", sorted(fora))


if __name__ == "__main__":
    main()
