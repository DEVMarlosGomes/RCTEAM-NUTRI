"""Diagnostico somente-leitura do banco (contagens). Nao altera nada.

Uso (PowerShell), apontando para o Atlas sem alterar o .env:
    $env:MONGO_URL = "mongodb+srv://..."; python scripts/check_db.py
"""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

url = os.environ.get("MONGO_URL") or ""
db_name = os.environ.get("DB_NAME") or "rcteam_nutri"
if not url or "TROQUE" in url or "<db_password>" in url:
    print("Defina MONGO_URL com a senha real do banco antes de rodar.")
    sys.exit(2)

try:
    client = MongoClient(url, serverSelectionTimeoutMS=8000)
    client.admin.command("ping")
except Exception as exc:  # noqa: BLE001
    print(f"Nao conectou ao MongoDB: {str(exc)[:200]}")
    print("Confira a senha e, no Atlas, Network Access com 0.0.0.0/0.")
    sys.exit(1)

db = client[db_name]
print(f"Conectado. Banco: {db_name}\n")
checks = [
    ("Nutricionistas", "users", {"role": "nutritionist"}, 1),
    ("Pacientes", "patients", {}, 0),
    ("Alimentos (EVONUT)", "alimentos", {}, 6000),
    ("Medidas caseiras", "medidas_caseiras", {}, 1),
    ("Base Dr. House", "agent_documents", {"agent_code": "drhouse", "status": "approved"}, 10),
    ("Base Dr. Donatto", "agent_documents", {"agent_code": "donato", "status": "approved"}, 16),
]
for label, coll, filt, minimo in checks:
    n = db[coll].count_documents(filt)
    status = "OK" if n >= minimo else "FALTA"
    print(f"{label:<24} {n:>7}   {status}")

print("\nNutricionistas (o mais antigo recebe os leads da landing):")
for u in db.users.find({"role": "nutritionist"}, {"_id": 0, "email": 1, "created_at": 1}).sort("created_at", 1).limit(5):
    print(f"  {u.get('created_at', '')[:10]}  {u.get('email')}")
