import hashlib
import io
import json
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import pdfplumber

DRHOUSE_AGENT_CODE = "drhouse"
DRHOUSE_SOURCE_ENV = "DRHOUSE_KNOWLEDGE_SOURCE_DIR"
DRHOUSE_DEFAULT_FOLDER = "DRHOUSERCTEAMNUTRI"
DRHOUSE_VERSION = "1.0"


def default_source_dir() -> Path:
    candidate = Path.home() / "Downloads" / DRHOUSE_DEFAULT_FOLDER
    return candidate if candidate.exists() else Path.cwd()


def source_files(source_dir: str | Path | None = None) -> list[Path]:
    base = Path(source_dir) if source_dir else default_source_dir()
    if not base.exists():
        return []
    return sorted(
        [
            p
            for p in base.iterdir()
            if p.is_file() and p.suffix.lower() in {".pdf", ".docx", ".txt", ".md", ".json"}
        ],
        key=lambda p: p.name.lower(),
    )


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


def extract_pdf_text(path: Path) -> str:
    with pdfplumber.open(path) as pdf:
        return "\n".join((page.extract_text() or "") for page in pdf.pages).strip()


def extract_source_text(path: Path) -> str:
    raw = path.read_bytes()
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return extract_pdf_text(path)
    if suffix == ".docx":
        return extract_docx_text(raw)
    if suffix == ".json":
        return json.dumps(json.loads(raw.decode("utf-8-sig")), ensure_ascii=False, indent=2)
    return raw.decode("utf-8-sig", errors="ignore")


def content_type_for(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return "application/pdf"
    if suffix == ".docx":
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    if suffix == ".json":
        return "application/json"
    return "text/plain"


async def sync_drhouse_documents(db, now_iso: str, source_dir: str | Path | None = None) -> dict[str, Any]:
    base = Path(source_dir) if source_dir else default_source_dir()
    prepared = []
    missing = []
    for path in source_files(base):
        try:
            text = extract_source_text(path).strip()
        except Exception as exc:
            missing.append({"source_filename": path.name, "reason": str(exc)[:160]})
            continue
        if not text:
            missing.append({"source_filename": path.name, "reason": "empty"})
            continue
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
        source_document_id = path.stem.lower().replace(" ", "_")
        existing = await db.agent_documents.find_one(
            {
                "agent_code": DRHOUSE_AGENT_CODE,
                "source_filename": path.name,
                "sha256": digest,
            },
            {"_id": 0},
        )
        doc_update = {
            "agent_code": DRHOUSE_AGENT_CODE,
            "title": path.stem,
            "filename": path.name,
            "source_filename": path.name,
            "content_type": content_type_for(path),
            "size": path.stat().st_size,
            "chars": len(text),
            "content": text[:200_000],
            "normalized_content": text[:200_000],
            "sha256": digest,
            "status": "approved",
            "document_type": "lab_biomarker_knowledge" if path.suffix.lower() == ".pdf" else "base_prompt",
            "topic": source_document_id,
            "source_document_id": source_document_id,
            "version": DRHOUSE_VERSION,
            "indexed": True,
            "approved_by": "drhouse_sync",
            "approved_at": now_iso,
            "updated_at": now_iso,
        }
        if existing:
            await db.agent_documents.update_one({"id": existing["id"]}, {"$set": doc_update})
            prepared.append({"id": existing["id"], "source_filename": path.name, "action": "updated"})
            continue
        await db.agent_documents.update_many(
            {
                "agent_code": DRHOUSE_AGENT_CODE,
                "source_filename": path.name,
                "sha256": {"$ne": digest},
            },
            {"$set": {"status": "inactive", "updated_at": now_iso}},
        )
        doc = {
            "id": hashlib.sha256(f"drhouse:{path.name}:{digest}".encode("utf-8")).hexdigest()[:32],
            **doc_update,
            "openai_file_id": None,
            "vector_store_id": None,
            "created_at": now_iso,
        }
        await db.agent_documents.insert_one(doc)
        prepared.append({"id": doc["id"], "source_filename": path.name, "action": "inserted"})
    return {
        "ok": True,
        "agent_code": DRHOUSE_AGENT_CODE,
        "source_dir": str(base),
        "prepared": prepared,
        "missing": missing,
        "total": len(prepared),
    }
