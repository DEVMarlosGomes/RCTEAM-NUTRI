import io
import json
import hashlib
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

from .manifest import DONATO_KNOWLEDGE_MANIFEST
from .openai_client import DonatoProviderUnavailable, get_openai_client
from .settings import DonatoSettings


def _doc_filename(doc: dict[str, Any]) -> str:
    name = doc.get("source_filename") or doc.get("filename") or doc.get("title") or doc.get("id") or "documento"
    safe = "".join(ch if ch.isalnum() or ch in ("-", "_", ".") else "_" for ch in str(name))
    if not safe.lower().endswith((".txt", ".md")):
        safe = f"{safe}.txt"
    return safe[:180]


def default_source_dir() -> Path:
    candidate = Path.home() / "Downloads" / "DONATORCTEAMNUTRI"
    return candidate if candidate.exists() else Path.cwd()


def load_manifest(source_dir: str | Path | None = None) -> dict[str, Any]:
    base = Path(source_dir) if source_dir else default_source_dir()
    manifest_path = base / "donato_knowledge_manifest_v1.json"
    if manifest_path.exists():
        return json.loads(manifest_path.read_text(encoding="utf-8"))
    return DONATO_KNOWLEDGE_MANIFEST


def extract_docx_text(raw: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        xml = zf.read("word/document.xml")
    root = ET.fromstring(xml)
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    lines = []
    for paragraph in root.findall(".//w:p", ns):
        parts = [node.text for node in paragraph.findall(".//w:t", ns) if node.text]
        line = "".join(parts).strip()
        if line:
            lines.append(line)
    return "\n".join(lines).strip()


def extract_source_text(path: Path) -> str:
    raw = path.read_bytes()
    suffix = path.suffix.lower()
    if suffix == ".docx":
        return extract_docx_text(raw)
    if suffix == ".json":
        return json.dumps(json.loads(raw.decode("utf-8-sig")), ensure_ascii=False, indent=2)
    return raw.decode("utf-8-sig", errors="ignore")


async def prepare_manifest_documents(db, source_dir: str | Path | None, now_iso: str) -> dict[str, Any]:
    base = Path(source_dir) if source_dir else default_source_dir()
    manifest = load_manifest(base)
    prepared = []
    missing = []
    skipped = []
    for item in manifest.get("documents", []):
        if not item.get("index_in_vector_store", True):
            skipped.append({"source_document_id": item.get("source_document_id"), "reason": "index_in_vector_store=false"})
            continue
        source_filename = item.get("source_filename")
        source_path = base / source_filename if source_filename else None
        if not source_path or not source_path.exists():
            missing.append({"source_document_id": item.get("source_document_id"), "source_filename": source_filename})
            continue
        text = extract_source_text(source_path).strip()
        if not text:
            missing.append({"source_document_id": item.get("source_document_id"), "source_filename": source_filename, "reason": "empty"})
            continue
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
        query = {
            "agent_code": "donato",
            "source_document_id": item.get("source_document_id"),
            "sha256": digest,
        }
        existing = await db.agent_documents.find_one(query, {"_id": 0})
        doc_update = {
            "agent_code": "donato",
            "title": item.get("title") or source_filename,
            "filename": source_filename,
            "source_filename": source_filename,
            "content_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" if source_path.suffix.lower() == ".docx" else "text/plain",
            "size": source_path.stat().st_size,
            "chars": len(text),
            "content": text,
            "normalized_content": text,
            "sha256": digest,
            "status": "approved",
            "document_type": item.get("document_type") or "scientific_evidence",
            "topic": item.get("topic"),
            "clinical_condition": item.get("clinical_condition"),
            "source_document_id": item.get("source_document_id"),
            "version": item.get("version") or manifest.get("version") or "1.0",
            "priority_class": item.get("priority_class"),
            "tags": item.get("tags") or [],
            "indexed": bool((existing or {}).get("indexed")),
            "approved_at": (existing or {}).get("approved_at") or now_iso,
            "updated_at": now_iso,
        }
        if existing:
            await db.agent_documents.update_one({"id": existing["id"]}, {"$set": doc_update})
            prepared.append({"id": existing["id"], "source_document_id": item.get("source_document_id"), "action": "updated"})
            continue
        await db.agent_documents.update_many(
            {"agent_code": "donato", "source_document_id": item.get("source_document_id"), "sha256": {"$ne": digest}},
            {"$set": {"status": "inactive", "updated_at": now_iso}},
        )
        doc = {
            "id": hashlib.sha256(f"donato:{item.get('source_document_id')}:{digest}".encode("utf-8")).hexdigest()[:32],
            **doc_update,
            "openai_file_id": None,
            "vector_store_id": None,
            "vector_store_file_status": None,
            "approved_by": "manifest",
            "created_at": now_iso,
        }
        await db.agent_documents.insert_one(doc)
        prepared.append({"id": doc["id"], "source_document_id": item.get("source_document_id"), "action": "inserted"})
    return {
        "source_dir": str(base),
        "manifest_version": manifest.get("version"),
        "prepared": prepared,
        "missing": missing,
        "skipped": skipped,
    }


async def ensure_vector_store(client, settings: DonatoSettings, db, now_iso: str) -> str:
    if settings.vector_store_id:
        return settings.vector_store_id
    agent = await db.agents.find_one({"code": "donato"}, {"_id": 0})
    if agent and agent.get("vector_store_id"):
        return agent["vector_store_id"]
    vector_store = await client.beta.vector_stores.create(
        name=DONATO_KNOWLEDGE_MANIFEST["vector_store_name"],
    )
    await db.agents.update_one(
        {"code": "donato"},
        {"$set": {"vector_store_id": vector_store.id, "updated_at": now_iso}},
    )
    return vector_store.id


async def sync_approved_documents(
    settings: DonatoSettings,
    db,
    now_iso: str,
    source_dir: str | Path | None = None,
    prepare_manifest: bool = False,
) -> dict[str, Any]:
    if not settings.openai_api_key:
        raise DonatoProviderUnavailable("OPENAI_API_KEY nao configurada")
    client = get_openai_client(settings)
    vector_store_id = await ensure_vector_store(client, settings, db, now_iso)
    prepared = await prepare_manifest_documents(db, source_dir, now_iso) if prepare_manifest else None
    docs = await db.agent_documents.find(
        {
            "agent_code": "donato",
            "status": "approved",
            "$or": [{"indexed": {"$ne": True}}, {"vector_store_id": {"$ne": vector_store_id}}],
        },
        {"_id": 0},
    ).sort("created_at", 1).to_list(100)
    results = []
    for doc in docs:
        content = (doc.get("normalized_content") or doc.get("content") or "").strip()
        if not content:
            results.append({"id": doc.get("id"), "status": "skipped", "error": "conteudo vazio"})
            continue
        file_bytes = io.BytesIO(content.encode("utf-8"))
        file_bytes.name = _doc_filename(doc)
        uploaded = await client.files.create(file=file_bytes, purpose="assistants")
        vector_file = await client.beta.vector_stores.files.create_and_poll(
            vector_store_id=vector_store_id,
            file_id=uploaded.id,
            attributes={
                "agent": "donato",
                "status": "approved",
                "document_type": doc.get("document_type") or "scientific_evidence",
                "topic": doc.get("topic") or "general",
                "source_document_id": doc.get("source_document_id") or doc.get("id"),
                "version": doc.get("version") or "1.0",
                "language": "pt-BR",
            },
        )
        status = getattr(vector_file, "status", None) or "completed"
        await db.agent_documents.update_one(
            {"id": doc["id"]},
            {
                "$set": {
                    "indexed": status == "completed",
                    "openai_file_id": uploaded.id,
                    "vector_store_id": vector_store_id,
                    "vector_store_file_status": status,
                    "indexed_at": now_iso,
                    "updated_at": now_iso,
                    "index_error": None,
                }
            },
        )
        results.append({"id": doc.get("id"), "status": status, "openai_file_id": uploaded.id})
    return {
        "ok": True,
        "vector_store_id": vector_store_id,
        "manifest": prepared,
        "synced": len([r for r in results if r.get("status") == "completed"]),
        "total": len(results),
        "results": results,
    }
