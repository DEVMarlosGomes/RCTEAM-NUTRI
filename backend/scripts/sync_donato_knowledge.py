import asyncio
import os
import sys
from pathlib import Path
from datetime import datetime, timezone

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

from ai.donato.knowledge_sync import sync_approved_documents
from ai.donato.settings import get_donato_settings


def line(label: str, status: str):
    print(f"{label:<42} {status}")


async def main():
    settings = get_donato_settings()
    source_dir = os.environ.get("DONATO_KNOWLEDGE_SOURCE_DIR") or None
    mongo_url = os.environ.get("MONGO_URL") or ""
    db_name = os.environ.get("DB_NAME") or ""
    print("DONATO Knowledge Sync\n")
    line("OpenAI connection", "PENDING" if not settings.openai_api_key else "OK")
    if not settings.openai_api_key:
        print("\nOPENAI_API_KEY nao configurada no ambiente. Nenhuma secret foi gravada.")
        raise SystemExit(2)
    if not mongo_url or "cluster.mongodb.net" in mongo_url or "USUARIO:SENHA" in mongo_url:
        line("MongoDB connection", "INVALID")
        print("\nMONGO_URL nao configurado corretamente no backend/.env.")
        print("Configure uma URL real do MongoDB antes de sincronizar a base DONATO.")
        raise SystemExit(2)
    if not db_name:
        line("MongoDB database", "INVALID")
        print("\nDB_NAME nao configurado no backend/.env.")
        raise SystemExit(2)
    line("MongoDB config", "OK")
    if settings.vector_store_id:
        line("Vector Store configured", settings.vector_store_id)
    else:
        print("\nVector Store not configured.\n")
        print("Creating:")
        print("rcteam_donato_knowledge_v1\n")
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]
    result = await sync_approved_documents(
        settings,
        db,
        datetime.now(timezone.utc).isoformat(),
        source_dir=source_dir,
        prepare_manifest=True,
    )
    vector_store_id = result["vector_store_id"]
    if not settings.vector_store_id:
        print("Vector Store created:")
        print(f"{vector_store_id}\n")
    manifest = result.get("manifest") or {}
    print("Preparing manifest documents...")
    for item in manifest.get("prepared", []):
        line(item.get("source_document_id") or item.get("id") or "documento", "READY")
    for item in manifest.get("skipped", []):
        line(item.get("source_document_id") or "documento", "SKIPPED")
    for item in manifest.get("missing", []):
        line(item.get("source_document_id") or item.get("source_filename") or "documento", "MISSING")
    print("\nIndexing knowledge...\n")
    indexed_by_id = {item.get("id"): item for item in result.get("results", [])}
    for item in manifest.get("prepared", []):
        res = indexed_by_id.get(item.get("id"))
        status = "OK" if res and res.get("status") == "completed" else ("UNCHANGED" if not res else res.get("status", "UNKNOWN"))
        line(item.get("source_document_id") or item.get("id") or "documento", status)
    print("\nKnowledge sync completed.\n")
    print(f"Synced this run: {result.get('synced', 0)}/{result.get('total', 0)}")
    print(f"\nOPENAI_DONATO_VECTOR_STORE_ID={vector_store_id}")


if __name__ == "__main__":
    asyncio.run(main())
