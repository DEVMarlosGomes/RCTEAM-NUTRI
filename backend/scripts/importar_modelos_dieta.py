"""Carga inicial dos modelos de dieta do Rogério (Frente 6).

O formato das dietas que o Rogério vai enviar ainda não chegou (A CONFIRMAR). Este script lê um JSON simples;
se vier planilha, basta convertê-la para ele:

[
  {
    "nome": "Perda de gordura 1800 kcal",
    "categoria": "Perda de gordura",
    "objetivo": "Emagrecimento",                     (opcional)
    "refeicoes": [
      {
        "nome": "CAFÉ DA MANHÃ", "horario": "07:00", "observacao": "...",   (horário e observação opcionais)
        "alimentos": [
          {"alimento": "Ovo, de galinha, inteiro, cozido/10minutos", "medida": "Unidade", "quantidade": 2},
          {"alimento_id": "4762", "quantidade_g": 50}
        ],
        "opcoes": [ {"alimentos": [ ... ]} ]                                (opções "OU", opcional)
      }
    ]
  }
]

Cada alimento é procurado SÓ na TABELA ENXUTA: pelo id, ou pelo nome (igual, sem diferenciar acento e
maiúsculas). Quantidade: "quantidade_g", ou "medida" + "quantidade" (a medida precisa existir no alimento).
O que não casar entra no relatório e o modelo NÃO é criado (para não salvar dieta com alimento faltando).

Uso (na pasta backend):
  python scripts/importar_modelos_dieta.py dietas.json --email rogerio@...            (só confere: não grava)
  python scripts/importar_modelos_dieta.py dietas.json --email rogerio@... --gravar
Variáveis: MONGO_URL e DB_NAME (as mesmas do servidor).
"""
import argparse
import json
import os
import sys
import unicodedata
import uuid
from datetime import datetime, timezone
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]


def chave(nome: str) -> str:
    s = unicodedata.normalize("NFKD", str(nome or "")).encode("ascii", "ignore").decode().lower()
    return " ".join(s.replace(",", " ").split())


def carregar_base() -> tuple:
    alimentos = json.loads((BACKEND / "tabela_enxuta_alimentos.json").read_text(encoding="utf-8"))["alimentos"]
    por_id = {str(a["id"]): a for a in alimentos}
    por_nome = {chave(a["nome"]): a for a in alimentos}
    return por_id, por_nome


def converter_item(item: dict, por_id: dict, por_nome: dict, onde: str, problemas: list):
    a = por_id.get(str(item.get("alimento_id"))) if item.get("alimento_id") else por_nome.get(chave(item.get("alimento")))
    rotulo = item.get("alimento") or item.get("alimento_id")
    if not a:
        problemas.append(f"{onde}: alimento não encontrado na TABELA ENXUTA: {rotulo!r}")
        return None
    if item.get("quantidade_g") is not None:
        g = float(item["quantidade_g"])
        return {"alimento_id": str(a["id"]), "nome": a["nome"], "medida_nome": "Gramas", "quantidade": g, "quantidade_g": g}
    medidas = {chave(m["nome"]): m for m in a.get("medidas_caseiras") or []}
    m = medidas.get(chave(item.get("medida")))
    qtd = float(item.get("quantidade") or 0)
    if chave(item.get("medida")) in ("grama", "gramas", "g"):
        return {"alimento_id": str(a["id"]), "nome": a["nome"], "medida_nome": "Gramas", "quantidade": qtd, "quantidade_g": qtd}
    if not m or qtd <= 0:
        problemas.append(f"{onde}: medida {item.get('medida')!r} não existe em {a['nome']!r} (ou quantidade vazia)")
        return None
    return {"alimento_id": str(a["id"]), "nome": a["nome"], "medida_nome": m["nome"], "quantidade": qtd,
            "quantidade_g": round(m["gramas"] * qtd, 2)}


def converter_modelo(d: dict, por_id: dict, por_nome: dict) -> tuple:
    problemas, refeicoes = [], []
    for r in d.get("refeicoes") or []:
        onde = f"{d.get('nome')} › {r.get('nome')}"
        itens = [converter_item(i, por_id, por_nome, onde, problemas) for i in r.get("alimentos") or []]
        opcoes = [{"observacao": op.get("observacao"),
                   "alimentos": [x for x in (converter_item(i, por_id, por_nome, onde + " (opção)", problemas) for i in op.get("alimentos") or []) if x]}
                  for op in r.get("opcoes") or []]
        refeicoes.append({"nome": r.get("nome") or "", "horario": r.get("horario"), "observacao": r.get("observacao"),
                          "alimentos": [x for x in itens if x], "opcoes": opcoes})
    return refeicoes, problemas


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("arquivo")
    ap.add_argument("--email", required=True, help="e-mail do nutricionista dono dos modelos")
    ap.add_argument("--gravar", action="store_true", help="grava no banco (sem isso, só confere)")
    args = ap.parse_args()
    por_id, por_nome = carregar_base()
    dietas = json.loads(Path(args.arquivo).read_text(encoding="utf-8"))
    prontos, todos_problemas = [], []
    for d in dietas:
        refeicoes, problemas = converter_modelo(d, por_id, por_nome)
        if problemas:
            todos_problemas += problemas
        else:
            prontos.append((d, refeicoes))
    print(f"{len(prontos)} modelos prontos, {len(dietas) - len(prontos)} com pendência")
    for p in todos_problemas:
        print("  -", p)
    if not args.gravar or not prontos:
        print("Nada gravado." if not args.gravar else "")
        return
    from pymongo import MongoClient
    db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    nutri = db.users.find_one({"email": args.email.lower()})
    if not nutri:
        sys.exit(f"Nutricionista {args.email} não encontrado")
    agora = datetime.now(timezone.utc).isoformat()
    for d, refeicoes in prontos:
        db.plano_templates.insert_one({
            "id": str(uuid.uuid4()), "nutricionista_id": nutri["id"], "nome": d["nome"][:140],
            "categoria": (d.get("categoria") or "").strip() or None, "objetivo": d.get("objetivo"),
            "refeicoes": refeicoes, "recomendacoes": [], "listas_substituicao": [], "orientacao_ids": [],
            "origem": "importacao", "criado_em": agora, "atualizado_em": agora,
        })
    print(f"{len(prontos)} modelos gravados para {args.email}.")


if __name__ == "__main__":
    main()
