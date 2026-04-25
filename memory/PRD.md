# Rogério Costa — PRD (formerly EvoNut)

> **Rebrand (Iter 1):** EvoNut → **Rogério Costa · Treinador e Nutricionista**
> Paleta: `#0081FD` (azul) + `#000000` (preto). Tipografia: Orbitron (display, substituto web do Pirulen) + Rajdhani (texto). Logo: bracketed "P" mark, variantes blue/dark.

## Visão
Sistema clínico premium ponta-a-ponta para o treinador e nutricionista: do lead ao plano alimentar, com IA embarcada e UX dark com identidade Rogério Costa.

## Stack
- Backend: FastAPI + Mongo + JWT cookie auth + Claude Sonnet 4.5 via emergentintegrations + WeasyPrint (PDF) + pdfplumber (OCR exames).
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

## Backlog Pendente (Iter 2 / 3)

### Iter 2 (próximo)
- [ ] **Versioned plan history UI** — listar versões anteriores do plano alimentar e permitir comparar lado a lado.
- [ ] **DatePicker pt-BR (dd/mm/yyyy)** — substituir input HTML5 nativo (PreConsulta + Antropometria) por shadcn DatePicker com `date-fns/locale/pt-BR`.
- [ ] **Refactor server.py** — quebrar em módulos `routes/`, `models/`, `services/`, `ai/`.

### Iter 3
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
