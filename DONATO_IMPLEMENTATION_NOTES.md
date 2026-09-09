# DONATO implementation notes

Reference files used as product material only:

- `C:\Users\MARLOS\Downloads\DONATORCTEAMNUTRI\RCTEAM_DONATO_CODEX_SPEC_V1.md`
- `C:\Users\MARLOS\Downloads\DONATORCTEAMNUTRI\donato_output_schema_v1.json`
- `C:\Users\MARLOS\Downloads\DONATORCTEAMNUTRI\donato_knowledge_manifest_v1.json`
- `C:\Users\MARLOS\Downloads\DONATORCTEAMNUTRI\CODEX_EXECUTION_PROMPT_DONATO_V1.md`

Audit summary before implementation:

- Agents are stored in Mongo collections `agents` and `agent_documents`.
- Current agent allowlist was `agent1`, `agent2`, `agent3`; endpoints live in `backend/server.py` under `/api/agents`.
- Existing agent knowledge is prompt concatenation via `build_agent_system_prompt()`. DONATO should not rely on that for final RAG behavior.
- Current AI plan endpoint `/patients/{pid}/meal-plan` generates Markdown in `meal_plans`.
- Manual prescription uses `planos_manuais` and is already enriched through EVONUT food records by `_enrich_plano()`.
- The manual plan model supports meals, foods, substitutes, goals, strategy and PDF generation.
- Recordatorio and adequacy calculations are deterministic and reusable.
- Frontend patient detail now renders `PrescricaoDietetica` and `AnalisesDieteticas` components in EVONUT-style tabs.
- Frontend API client is `frontend/src/lib/evo-api.js`.
- Existing upload extraction handled PDF, JSON and plain text. DOCX needed explicit extraction.

Implemented in this increment:

- Adds `donato` as a configurable agent without renumbering existing agents.
- Adds DOCX text extraction for agent documents.
- Adds DONATO feature flag and status metadata.
- Adds backend draft generation in `donato_plan_generations`, marked as AI draft and requiring human approval.
- Adds approval endpoint that converts an approved draft into the existing `planos_manuais` flow.
- Keeps patient publishing blocked until the nutritionist approves the draft.
- Adds `backend/scripts/sync_donato_knowledge.py`, which reads the DONATO manifest/source directory, creates `rcteam_donato_knowledge_v1` when no vector store id is configured, indexes approved manifest documents, and prints the resulting `OPENAI_DONATO_VECTOR_STORE_ID`.

Release gates still pending for a production-grade DONATO:

- OpenAI Responses API + File Search/Vector Store sync.
- Prompt Mestre source document.
- Guia Mestre Alimentar source document.
- Full clinical validator and protocol conflict resolver test suite.
