"""Carrega a base do Dr. Donatto no MongoDB (provedor Gemini, sem OpenAI).

Uso (PowerShell), apontando para o banco de producao sem alterar o .env:
    $env:MONGO_URL = "mongodb+srv://..."; python scripts/prepare_donato_knowledge.py
"""
import asyncio
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

from ai.donato.knowledge_sync import prepare_manifest_documents


def line(label: str, status: str):
    print(f"{label:<42} {status}")


async def main():
    source_dir = os.environ.get("DONATO_KNOWLEDGE_SOURCE_DIR") or None
    mongo_url = os.environ.get("MONGO_URL") or ""
    db_name = os.environ.get("DB_NAME") or ""

    print("DR. DONATTO Knowledge Prepare (Gemini)\n")
    if not mongo_url or "cluster.mongodb.net" in mongo_url.lower() or "usuario:senha" in mongo_url.lower():
        line("MongoDB connection", "INVALID")
        print("\nMONGO_URL nao configurado. Defina a URL real do MongoDB antes de carregar a base.")
        raise SystemExit(2)
    if not db_name:
        line("MongoDB database", "INVALID")
        raise SystemExit(2)
    line("MongoDB config", "OK")

    db = AsyncIOMotorClient(mongo_url)[db_name]
    result = await prepare_manifest_documents(
        db, source_dir, datetime.now(timezone.utc).isoformat(), include_non_indexed=True,
    )
    print(f"Source dir: {result['source_dir']}\n")
    for item in result.get("prepared", []):
        line(str(item.get("source_document_id")), item.get("action", "OK").upper())
    for item in result.get("missing", []):
        line(str(item.get("source_document_id")), f"MISSING {item.get('source_filename') or ''}".strip())
    print(f"\nDocumentos prontos: {len(result.get('prepared', []))} | faltando: {len(result.get('missing', []))}")


if __name__ == "__main__":
    asyncio.run(main())
