# Rogério Costa — PRD (formerly EvoNut)

> **Rebrand (Iter 1):** EvoNut → **Rogério Costa · Treinador e Nutricionista**
> Paleta: `#0081FD` (azul) + `#000000` (preto). Tipografia: Orbitron (display, substituto web do Pirulen) + Rajdhani (texto). Logo: bracketed "P" mark, variantes blue/dark.

## Visão
Sistema clínico premium ponta-a-ponta para o treinador e nutricionista: do lead ao plano alimentar, com IA embarcada e UX dark com identidade Rogério Costa.

## Stack
- Backend: FastAPI + Mongo + JWT cookie auth + Claude Sonnet via SDK oficial da Anthropic + WeasyPrint (PDF) + pdfplumber (OCR exames).
- Frontend: React 19 + Tailwind v3 + shadcn/ui + lucide-react + sonner + Orbitron/Rajdhani Google Fonts.
- Hosting: Kubernetes + supervisor.

## Pipeline (6 etapas)
Lead → Pré-consulta (15 seções) → Chat IA → Agendamento → Análise IA + Plano → Acompanhamento

## Stories Concluídas (até Iter 1)

### Já entregues no projeto antes da rebranding
- Auth (login + register + me + logout) com cookie httpOnly
- Multi-tenant via slug + fallback (Iter 1 reforço)
- Lead público + token + flow anamnese
- Anamnese 15 seções (autosave localStorage)
- Chat IA adaptativo com Claude Sonnet 4.5
- Agendamento (slots por nutricionista) — agora em **America/Sao_Paulo** (Iter 1)
- Dashboard, Pacientes, Detalhe (antropometria, comparativo, plano, exames)
- Geração de plano alimentar IA (server-side)
- Upload de exame laboratorial (PDF) + extração de marcadores via IA
- Geração de PDF do plano (WeasyPrint, server-side) — agora com **brand Rogério Costa** (Iter 1)

### Iter 1 — Rebrand + Backend reinforcement
- **Rebrand visual completo:**
  - `evo-*` → `rc-*` Tailwind tokens (com aliases de retrocompatibilidade)
  - Cores: `#0081FD` (azul) + `#000000` (preto), substituindo purple/teal
  - Tipografia: Orbitron (display) + Rajdhani (texto)
  - Brand component (logo + wordmark) reutilizável
  - RCLogo component (SVG, 4 variantes: blue, dark, ghost, mono)
  - Strings: "EvoNut" → "Rogério Costa" em todas as páginas e PDFs
  - Email seed: `admin@rogeriocosta.com.br` / `rogerio2025`
  - Logo PNGs em `/public/brand/`
- **Backend P0/P1/P2:**
  - Multi-tenant lead routing via `?nutri=<slug>` query param
  - Slot generation em `America/Sao_Paulo` (`-03:00`)
  - Login lockout (5 tentativas / 15 min)
  - Public chat rate limit (8 req / 60s por token)
  - Whitelist de campos públicos do lead (sem `nutricionista_id`)
  - Schedule: parsing correto de date/time como SP-local
- **Frontend:**
  - Agendar.jsx: parsing local de ISO sem TZ shift, labels BRT
  - Brand component + RCLogo aplicados em todas as páginas públicas

## Iter 2 — Formulário Pré-consulta (alinhado ao doc)
- **Frontend `PreConsulta.jsx` reescrito**: 15 seções 100% alinhadas ao `FORMULÁRIO PRÉ CONSULTA.docx`
- Novos tipos de campo: `radio-card` (com descrição), `multi-check`, `slider 0-10`, `yes-no`, `photos`
- Auto-cálculo de idade a partir de `data_nascimento`
- Step pills navegáveis (ícones)
- Upload de fotos client-side com resize (1280px / 78% JPEG) → max 4
- Chat inicial atualizado com texto exato do doc ("Perfeito, suas informações foram recebidas...")
- **Backend**:
  - Endpoint `POST /api/public/lead/{token}/photos` (validação data: image/, cap 4, max 4.5MB cada)
  - `submit_anamnesis` aceita `peso_atual`/`estatura` (novo) e `peso`/`altura` (back-compat)
- **Backend testado** ✅ (anamnesis remap + photo upload).

## Iter 3 — 3 Áreas + 3 Agentes IA Treináveis (Feb/2026)

**Arquitetura nova**: Landing pública · Área do Nutricionista · Área do Paciente

### Backend (server.py)
- **Roles**: `users.role` agora pode ser `"nutritionist"` ou `"patient"`. `get_current_user` + `require_nutritionist` + `require_patient` helpers.
- **3 agentes treináveis** (coleção `agents`, seeded no startup):
  - **Agent 1 (SAC/Triagem)** — substitui o assistente da pré-consulta (`/api/public/chat` agora usa `build_agent_system_prompt("agent1")` dinamicamente)
  - **Agent 2 (Consultório)** — interno, apoia o nutricionista
  - **Agent 3 (Suporte Paciente)** — atende dúvidas pós-consulta
- **Documentos de treinamento** (coleção `agent_documents`): upload de PDF/JSON/TXT/MD; texto extraído (pdfplumber para PDF) e concatenado ao system_prompt. Cap = 50.000 chars.
- **Endpoints novos**:
  - `GET/PATCH /api/agents`, `GET/PATCH /api/agents/{code}`
  - `POST /api/agents/{code}/documents` (multipart) + `/documents/text` (JSON) + `DELETE /documents/{id}`
  - `POST /api/patient/signup` (cria role=patient a partir do token de lead)
  - `GET /api/patient/me`, `GET /api/patient/diet`, `GET/POST /api/patient/chat` (Agente 3)
  - `GET /api/consultorio/patients`, `POST /api/consultorio/chat`, `GET /api/consultorio/chat/{patient_id}` (Agente 2)
- **Backend testado** ✅ — 23/23 testes (`test_iter3_agents.py`), 100% pass com Claude real.

### Frontend
- `AuthContext`: `patientSignup()` novo, `login/register` retornam user (com role) para roteamento.
- `App.js`: `<Protected role="...">` redireciona usuário fora do role para sua home (nutri→/dashboard, paciente→/paciente).
- **Página `/agentes`** (`Agentes.jsx`): sidebar com os 3 agentes, edição do `base_prompt`, upload de docs, colar texto livre, lista de docs com remover, contador de chars com barra de progresso.
- **Página `/consultorio`** (`Consultorio.jsx`): seletor de pacientes do nutricionista + chat com Agente 2 (contexto completo do paciente injetado).
- **Página `/paciente`** (`PatientArea.jsx`): 2 tabs — "Minha dieta" (KPIs + markdown do plano ativo) e "Assistente IA" (chat com Agente 3).
- **Sucesso.jsx** reescrito: formulário de criação de conta do paciente (email readonly do lead + senha 2x) → redirect `/paciente`.
- **NutriLayout**: links `/consultorio` e `/agentes` adicionados ao sidebar.
- **Frontend testado** ✅ — 15/16 fluxos PASS via Playwright (iter4).

### Decisões de produto (acordadas com user)
- Treinamento dos agentes via **append no system prompt** (não RAG) — limite 50k chars.
- Paciente cria login/senha **somente** ao final da pré-consulta (não pode criar do nada).
- Agent 1 = mesmo da pré-consulta atual, agora editável pelo nutricionista.
- Pacientes só veem dieta + chat (sem agenda/exames/avaliações).

## Backlog Pendente (Iter 3+)
- [ ] **Versioned plan history UI** — listar versões anteriores do plano alimentar e permitir comparar lado a lado.
- [ ] **DatePicker pt-BR (dd/mm/yyyy)** — substituir input HTML5 nativo por shadcn DatePicker com `date-fns/locale/pt-BR`.
- [ ] **Refactor server.py** — quebrar em módulos `routes/`, `models/`, `services/`, `ai/`.
- [ ] **Gráficos ricos no Comparativo** — Recharts lado-a-lado por avaliação.
- [ ] **Importação de Bioimpedância (PDF/CSV)** — InBody, Tanita.

## Backlog Pendente (Iter 3+)
- [ ] **Gráficos ricos no Comparativo** — Recharts lado-a-lado por avaliação, séries de peso/dobras/IMC.
- [ ] **Importação de Bioimpedância (PDF/CSV)** — parser específico (InBody, Tanita) + extração de água corporal, massa magra, gordura visceral.

### Backlog longo prazo
- [ ] Google Calendar real (OAuth + free/busy + push events)
- [ ] WhatsApp Business API real (templates + webhooks)
- [ ] Notificações push (web push + service worker)
- [ ] Versioning end-to-end de planos (com diff visual)

## Test Credentials
See `/app/memory/test_credentials.md`.

## Brand Assets
- Logo full: `/public/brand/logo-full.png`
- Logo blue (icon): `/public/brand/logo-blue.png`
- Logo dark (icon): `/public/brand/logo-dark.png`
- Cores: `#0081FD` / `#000000`
- Fontes web: Orbitron (display 500-900) + Rajdhani (texto 400-700)
