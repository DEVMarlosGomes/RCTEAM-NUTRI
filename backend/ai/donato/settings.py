from dataclasses import dataclass
import os


def _truthy(name: str, default: str = "false") -> bool:
    return os.environ.get(name, default).lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class DonatoSettings:
    enabled: bool
    openai_api_key: str | None
    model: str
    vector_store_id: str | None
    require_human_approval: bool
    strict_source_gate: bool
    max_file_results: int
    file_search_score_threshold: float
    schema_version: str


def get_donato_settings() -> DonatoSettings:
    return DonatoSettings(
        enabled=_truthy("DONATO_ENABLED", "true"),
        openai_api_key=os.environ.get("OPENAI_API_KEY") or None,
        model=os.environ.get("OPENAI_DONATO_MODEL") or "gpt-5.6-terra",
        vector_store_id=os.environ.get("OPENAI_DONATO_VECTOR_STORE_ID") or None,
        require_human_approval=_truthy("DONATO_REQUIRE_HUMAN_APPROVAL", "true"),
        strict_source_gate=_truthy("DONATO_STRICT_SOURCE_GATE", "true"),
        max_file_results=int(os.environ.get("DONATO_MAX_FILE_RESULTS", "8")),
        file_search_score_threshold=float(os.environ.get("DONATO_FILE_SEARCH_SCORE_THRESHOLD", "0.55")),
        schema_version=os.environ.get("DONATO_SCHEMA_VERSION", "1.1"),
    )
