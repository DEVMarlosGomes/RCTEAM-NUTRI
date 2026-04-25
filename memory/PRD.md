# EvoNut — PRD

## Original Problem Statement
"com base nesse documento gere um sistema" — User uploaded `EvoNut_Prompt_Senior.docx` defining a senior-level engineering brief for **EvoNut Sistema Nutricional Inteligente**, a premium clinical SaaS for nutritionists in pt-BR.

## User Choices (collected via ask_human)
1. Scope: **1a** — Painel completo do nutricionista + formulário público com IA
2. Auth: **2a** — JWT custom (email/senha)
3. AI: **3a** — Claude Sonnet 4.5 via Emergent LLM Key
4. Integrations: **4a** — Mock WhatsApp/Calendar (agenda interna)
5. PDF: **5a** — Sim (browser print)

## Personas
- **Paciente**: Pré-consulta self-service via link público (sem login).
- **Nutricionista**: Painel CRM clínico com login (JWT cookie httpOnly).

## Architecture
- **Backend**: FastAPI + Motor (Mongo) + emergentintegrations (Claude Sonnet 4.5) + bcrypt/PyJWT auth
- **Frontend**: React 19 + Tailwind + shadcn/ui + Recharts + sonner + react-router-dom v7
- **DB**: MongoDB collections — users, patients, anamneses, consultations, evaluations, meal_plans, ai_analyses, chat_messages
- **Design system**: Outfit + Manrope, dark premium (#0D1117 / #161B22), gradient roxo→teal (#7B61FF→#1DB97E), glassmorphism

## Implemented (Iter 1 — 2026-02-XX)
- Public landing with lead-capture form, hero, features, CTA
- Auth: register / login / me / logout (JWT cookie, samesite=none, secure)
- Admin seed (admin@evonut.com / evonut123)
- Public flow: lead → 15-section anamnesis form (autosave) → adaptive AI chat (Claude Sonnet 4.5) → scheduling (internal slots Mon–Sat 9h–17h, BR) → success page
- Nutritionist CRM: dashboard (KPIs + funil), lista de pacientes, agenda
- Patient detail with 5 tabs:
  - Anamnese (read-only display)
  - Análise IA (Claude clinical report on demand)
  - Antropometria (Pollock 7/3, Faulkner; perimetria; bioimpedância manual; IMC, TMB Mifflin/Harris, GET; %gordura/MM/MG; evolution chart)
  - Plano Alimentar (auto macros + Claude meal plan + print/PDF)
  - Comparativo evolutivo (last vs previous, arrows)
- Status funnel CRM badges (LEAD_INICIADO → EM_ACOMPANHAMENTO)
- Error handling on AI calls (503 friendly message)

## Test Coverage
- Backend pytest 19/20 (single failure = LLM budget cap, not a code bug)
- Frontend e2e (testing_agent_v3): 100% on key flows

## Backlog (P0/P1/P2)
- **P0**: Multi-tenant routing for /api/leads (currently picks first nutritionist)
- **P1**: Slot generation in America/Sao_Paulo timezone (currently UTC labels)
- **P1**: Lab exam upload (PDF) + AI marker extraction
- **P1**: WhatsApp Business API real integration (Z-API/Twilio)
- **P1**: Google Calendar real integration
- **P2**: Server-side PDF generation (WeasyPrint/Puppeteer) for branded plan exports
- **P2**: Login brute-force lockout (5 fails / 15 min)
- **P2**: Refactor server.py into routers/services
- **P2**: Whitelist public lead fields (currently leaks nutricionista_id)
- **P2**: Rate limit /api/public/chat
- **P2**: Replace HTML5 date with shadcn DatePicker (pt-BR dd/mm/yyyy)
- **P2**: Versioned plan history UI (currently only latest displayed)
- **P3**: Rich charts on Comparativo with Recharts side-by-side
- **P3**: Bioimpedância PDF/CSV import

## Test Credentials
See `/app/memory/test_credentials.md`
