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

from ai.drhouse.knowledge_sync import sync_drhouse_documents


def line(label: str, status: str):
    print(f"{label:<42} {status}")


async def main():
    source_dir = os.environ.get("DRHOUSE_KNOWLEDGE_SOURCE_DIR") or None
    mongo_url = os.environ.get("MONGO_URL") or ""
    db_name = os.environ.get("DB_NAME") or ""

    print("DR. HOUSE Knowledge Sync\n")
    if not mongo_url or "cluster.mongodb.net" in mongo_url.lower() or "usuario:senha" in mongo_url.lower():
        line("MongoDB connection", "INVALID")
        print("\nMONGO_URL nao configurado corretamente no backend/.env.")
        print("Configure uma URL real do MongoDB antes de sincronizar a base Dr. House.")
        raise SystemExit(2)
    if not db_name:
        line("MongoDB database", "INVALID")
        print("\nDB_NAME nao configurado no backend/.env.")
        raise SystemExit(2)
    line("MongoDB config", "OK")

    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]
    result = await sync_drhouse_documents(
        db,
        datetime.now(timezone.utc).isoformat(),
        source_dir=source_dir,
    )

    print(f"Source dir: {result['source_dir']}\n")
    print("Preparing Dr. House documents...\n")
    for item in result.get("prepared", []):
        line(item.get("source_filename") or item.get("id") or "documento", item.get("action", "OK").upper())
    for item in result.get("missing", []):
        line(item.get("source_filename") or "documento", f"MISSING: {item.get('reason') or ''}".strip())
    print("\nDR. HOUSE knowledge sync completed.")
    print(f"Documents ready: {result.get('total', 0)}")


if __name__ == "__main__":
    asyncio.run(main())
