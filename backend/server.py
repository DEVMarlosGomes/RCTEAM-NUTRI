from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import re
import asyncio
import logging
import uuid
import csv
import html
from difflib import SequenceMatcher
import bcrypt
import jwt
import secrets
import unicodedata
from collections import defaultdict, deque
from datetime import datetime, timezone, timedelta, date
from functools import lru_cache
from typing import List, Optional, Any
from zoneinfo import ZoneInfo

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, status, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr, ConfigDict

from llm_chat import LlmChat, UserMessage
import json
import io
import pdfplumber
try:
    from weasyprint import HTML, CSS
    _WEASYPRINT_AVAILABLE = True
except Exception:
    _WEASYPRINT_AVAILABLE = False
    HTML = None
    CSS = None

# ---------- App / DB ----------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="Rogério Costa — Sistema Nutricional API")
api = APIRouter(prefix="/api")

# Brazil timezone for slot generation & business logic
TZ_BR = ZoneInfo("America/Sao_Paulo")

# Login lockout (in-memory; resets on restart — acceptable for MVP)
LOCKOUT_MAX_ATTEMPTS = 5
LOCKOUT_WINDOW_MIN = 15
_login_attempts: dict = {}  # email -> {"count": int, "first": datetime, "locked_until": datetime|None}

# Public chat rate limiter (token -> deque of timestamps)
CHAT_RATE_MAX = 8       # max requests
CHAT_RATE_WINDOW = 60   # in seconds
_chat_rate: dict = defaultdict(deque)

def slugify(text: str) -> str:
    if not text:
        return ""
    s = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s[:60] or "user"

# Public lead fields whitelist (avoid leaking nutricionista_id, etc.)
PUBLIC_LEAD_FIELDS = {
    "id", "nome", "telefone", "email", "status_funil",
    "peso", "altura", "data_nascimento", "sexo", "objetivo",
    "lead_token", "created_at", "atendimento_dados",
}

def public_lead_view(p: dict) -> dict:
    return {k: v for k, v in p.items() if k in PUBLIC_LEAD_FIELDS}

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALG = "HS256"
ANTHROPIC_API_KEY = os.environ.get('ANTHROPIC_API_KEY', '').strip()
GEMINI_KEY = os.environ.get('GEMINI_KEY', '').strip()

# ---------- Helpers ----------
def now_utc():
    return datetime.now(timezone.utc)

def iso(dt: datetime) -> str:
    return dt.isoformat()

def hash_password(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()

def verify_password(p: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(p.encode(), h.encode())
    except Exception:
        return False

def create_token(user_id: str, email: str, ttl_minutes=60*24*7) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "exp": now_utc() + timedelta(minutes=ttl_minutes),
        "iat": now_utc(),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)

async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(401, "Não autenticado")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(401, "Usuário não encontrado")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expirado")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Token inválido")

async def maybe_get_current_user(request: Request) -> Optional[dict]:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        return None
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        return await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    except Exception:
        return None

async def require_nutritionist(user=Depends(get_current_user)) -> dict:
    if user.get("role") != "nutritionist":
        raise HTTPException(403, "Acesso restrito ao nutricionista")
    return user

async def require_patient(user=Depends(get_current_user)) -> dict:
    if user.get("role") != "patient":
        raise HTTPException(403, "Acesso restrito ao paciente")
    return user

def set_auth_cookie(response: Response, token: str):
    frontend_urls = (os.environ.get("FRONTEND_URLS") or os.environ.get("FRONTEND_URL") or "").lower()
    is_local_frontend = any(host in frontend_urls for host in ("localhost", "127.0.0.1"))
    response.set_cookie(
        key="access_token", value=token,
        httponly=True,
        secure=not is_local_frontend,
        samesite="lax" if is_local_frontend else "none",
        max_age=60*60*24*7, path="/",
    )

# ---------- Models ----------
class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str

class LoginIn(BaseModel):
    email: EmailStr
    password: str

class UserOut(BaseModel):
    id: str
    email: str
    name: str
    role: str = "nutritionist"

class LeadIn(BaseModel):
    name: str
    phone: str
    email: Optional[str] = None

class LeadOut(BaseModel):
    token: str
    patient_id: str
    name: str

class PatientCreateIn(BaseModel):
    nome: str = Field(min_length=2)
    telefone: str = ""
    email: Optional[EmailStr] = None
    data_nascimento: Optional[str] = None
    sexo: Optional[str] = None
    objetivo: Optional[str] = None
    peso: Optional[float] = None
    altura: Optional[float] = None
    status_funil: str = "LEAD_INICIADO"

class PatientUpdateIn(BaseModel):
    nome: Optional[str] = Field(default=None, min_length=2)
    telefone: Optional[str] = None
    email: Optional[EmailStr] = None
    data_nascimento: Optional[str] = None
    sexo: Optional[str] = None
    objetivo: Optional[str] = None
    peso: Optional[float] = None
    altura: Optional[float] = None
    status_funil: Optional[str] = None

class AnamnesisIn(BaseModel):
    token: str
    respostas: dict

class ChatIn(BaseModel):
    token: str
    message: str

class PhotosIn(BaseModel):
    fotos: List[dict]  # [{name, data_url, size}]

class ScheduleIn(BaseModel):
    token: str
    date: str   # ISO date
    time: str   # "HH:MM"
    type: str = "Inicial"

class ConsultationCreateIn(BaseModel):
    paciente_id: str
    date: str
    time: str
    tipo: str = "Inicial"
    status: str = "AGENDADA"
    observacoes: str = ""

class ConsultationUpdateIn(BaseModel):
    date: Optional[str] = None
    time: Optional[str] = None
    tipo: Optional[str] = None
    status: Optional[str] = None
    observacoes: Optional[str] = None

class EvaluationIn(BaseModel):
    peso: float
    altura: float            # cm
    idade: int
    sexo: str                # "M" / "F"
    protocolo_dobras: Optional[str] = None  # "pollock7" | "pollock3" | "faulkner"
    dobras: Optional[dict] = None            # mm valores
    perimetria: Optional[dict] = None
    nivel_atividade: float = 1.55  # GET factor
    objetivo: str = "manutencao"   # emagrecimento | manutencao | hipertrofia

class MealPlanRequest(BaseModel):
    objetivo: str = "manutencao"
    restricoes: Optional[str] = None

# ---------- Agents / Patient ----------
AGENT_CODES = ("agent1", "agent2", "agent3")
AGENT_PROMPT_MAX_CHARS = 50_000  # cap full system prompt length

class AgentPromptUpdate(BaseModel):
    base_prompt: str

class AgentDocCreate(BaseModel):
    title: str
    content: str  # plain text (already extracted)

class PatientSignupIn(BaseModel):
    token: str
    password: str = Field(min_length=6)

class PatientLoginIn(BaseModel):
    email: EmailStr
    password: str

class PatientChatIn(BaseModel):
    message: str
    session_id: Optional[str] = None  # client-provided, persists per browser/device

class ConsultorioChatIn(BaseModel):
    patient_id: str
    message: str
    session_id: Optional[str] = None

class NudgeIn(BaseModel):
    label: str
    trigger_text: str  # instruction to Agent 3 about what to say
    hour: int = Field(ge=0, le=23)
    minute: int = Field(ge=0, le=59)
    weekdays: Optional[List[int]] = None  # 0=Mon..6=Sun; None = every day
    active: bool = True

class NudgeUpdate(BaseModel):
    label: Optional[str] = None
    trigger_text: Optional[str] = None
    hour: Optional[int] = Field(default=None, ge=0, le=23)
    minute: Optional[int] = Field(default=None, ge=0, le=59)
    weekdays: Optional[List[int]] = None
    active: Optional[bool] = None

# ---------- Calculations ----------
def calc_imc(peso, altura_cm):
    h = altura_cm / 100
    return round(peso / (h * h), 2)

def imc_class(imc):
    if imc < 18.5: return "Baixo peso"
    if imc < 25: return "Eutrofia"
    if imc < 30: return "Sobrepeso"
    if imc < 35: return "Obesidade I"
    if imc < 40: return "Obesidade II"
    return "Obesidade III"

def calc_tmb_mifflin(peso, altura, idade, sexo):
    base = 10*peso + 6.25*altura - 5*idade
    return round(base + (5 if sexo.upper().startswith("M") else -161), 1)

def calc_tmb_harris(peso, altura, idade, sexo):
    if sexo.upper().startswith("M"):
        return round(88.362 + 13.397*peso + 4.799*altura - 5.677*idade, 1)
    return round(447.593 + 9.247*peso + 3.098*altura - 4.330*idade, 1)

def pct_gordura_pollock7(dobras, sexo, idade):
    # Pollock 7: subescapular, tríceps, peitoral, axilar média, suprailíaca, abdominal, coxa
    keys = ["subescapular", "triceps", "peitoral", "axilar", "suprailiaca", "abdominal", "coxa"]
    s = sum(float(dobras.get(k, 0)) for k in keys)
    if sexo.upper().startswith("M"):
        d = 1.112 - 0.00043499*s + 0.00000055*(s**2) - 0.00028826*idade
    else:
        d = 1.097 - 0.00046971*s + 0.00000056*(s**2) - 0.00012828*idade
    if d <= 0: return None
    return round((4.95/d - 4.5)*100, 2)

def pct_gordura_pollock3(dobras, sexo, idade):
    if sexo.upper().startswith("M"):
        keys = ["peitoral", "abdominal", "coxa"]
    else:
        keys = ["triceps", "suprailiaca", "coxa"]
    s = sum(float(dobras.get(k, 0)) for k in keys)
    if sexo.upper().startswith("M"):
        d = 1.10938 - 0.0008267*s + 0.0000016*(s**2) - 0.0002574*idade
    else:
        d = 1.0994921 - 0.0009929*s + 0.0000023*(s**2) - 0.0001392*idade
    if d <= 0: return None
    return round((4.95/d - 4.5)*100, 2)

def pct_gordura_faulkner(dobras):
    # Faulkner: tríceps + subescapular + suprailíaca + abdominal
    keys = ["triceps", "subescapular", "suprailiaca", "abdominal"]
    s = sum(float(dobras.get(k, 0)) for k in keys)
    return round(s * 0.153 + 5.783, 2)

def calc_bodycomp(eval_data: dict):
    peso = eval_data["peso"]; altura = eval_data["altura"]
    idade = eval_data["idade"]; sexo = eval_data["sexo"]
    imc = calc_imc(peso, altura)
    tmb_m = calc_tmb_mifflin(peso, altura, idade, sexo)
    tmb_h = calc_tmb_harris(peso, altura, idade, sexo)
    fat_act = eval_data.get("nivel_atividade", 1.55)
    get_kcal = round(tmb_m * fat_act, 1)

    pct = None
    proto = eval_data.get("protocolo_dobras")
    dobras = eval_data.get("dobras") or {}
    if proto and dobras:
        if proto == "pollock7": pct = pct_gordura_pollock7(dobras, sexo, idade)
        elif proto == "pollock3": pct = pct_gordura_pollock3(dobras, sexo, idade)
        elif proto == "faulkner": pct = pct_gordura_faulkner(dobras)

    massa_gorda = round(peso * pct/100, 2) if pct else None
    massa_magra = round(peso - massa_gorda, 2) if massa_gorda else None

    return {
        "imc": imc, "imc_classificacao": imc_class(imc),
        "tmb_mifflin": tmb_m, "tmb_harris": tmb_h, "get_kcal": get_kcal,
        "pct_gordura": pct, "massa_gorda": massa_gorda, "massa_magra": massa_magra,
        "protocolo_dobras": proto,
    }

def calc_macros(get_kcal, objetivo, peso, massa_magra=None):
    if objetivo == "emagrecimento":
        kcal = round(get_kcal - 400)
        ptn_g_kg = 1.8
    elif objetivo == "hipertrofia":
        kcal = round(get_kcal + 350)
        ptn_g_kg = 2.0
    else:
        kcal = round(get_kcal)
        ptn_g_kg = 1.6
    base = massa_magra if massa_magra else peso
    ptn_g = round(base * ptn_g_kg)
    lip_g = round(peso * 0.9)
    rem = kcal - (ptn_g*4 + lip_g*9)
    cho_g = max(round(rem / 4), 0)
    return {
        "kcal": kcal, "proteina_g": ptn_g,
        "carboidrato_g": cho_g, "gordura_g": lip_g,
        "ptn_pct": round((ptn_g*4)/kcal*100, 1),
        "cho_pct": round((cho_g*4)/kcal*100, 1),
        "lip_pct": round((lip_g*9)/kcal*100, 1),
    }

# ---------- Agents (training) ----------
AGENT_DEFAULTS = {
    "agent1": {
        "name": "Agente 1 — SAC / Pré-consulta",
        "description": (
            "Atende o lead na pré-consulta, conduz a triagem e direciona para o agendamento. "
            "Substitui o assistente público da pré-consulta."
        ),
        "base_prompt": (
            "Você é o assistente do nutricionista Rogério Costa que conversa com o paciente "
            "para aprofundar a anamnese de forma natural e empática. Faça UMA pergunta por vez, "
            "curta e clara. Foque nos pontos críticos detectados (sono, treino, alimentação, estresse, "
            "medicamentos). Após 6 a 8 perguntas, finalize com a frase exata: 'ANAMNESE_FINALIZADA' "
            "e um resumo gentil ao paciente."
        ),
    },
    "agent2": {
        "name": "Agente 2 — Consultório (apoio ao nutricionista)",
        "description": (
            "Ferramenta interna do nutricionista durante a consulta. Analisa exames e dados do paciente "
            "com base nos materiais científicos enviados."
        ),
        "base_prompt": (
            "Você é o assistente clínico interno do nutricionista Rogério Costa. "
            "Responda em Português (BR), tom técnico, objetivo e direto. "
            "Analise os exames laboratoriais, anamnese e avaliação física do paciente do contexto. "
            "Use o conteúdo científico fornecido nos documentos de treinamento como referência. "
            "Sempre cite o raciocínio clínico e nunca invente referências. "
            "Quando faltar dado, peça ao nutricionista explicitamente."
        ),
    },
    "agent3": {
        "name": "Agente 3 — Suporte ao Paciente",
        "description": (
            "Atende o paciente após a consulta. Responde dúvidas sobre dieta, treino e rotina, "
            "treinado com os materiais que o nutricionista enviar."
        ),
        "base_prompt": (
            "Você é o assistente pessoal do paciente, treinado pelo nutricionista Rogério Costa. "
            "Responda em Português (BR), tom acolhedor e claro. "
            "Use SOMENTE as informações do plano alimentar do paciente (anexado no contexto) e dos "
            "materiais de treinamento fornecidos. Nunca contrarie a prescrição do nutricionista. "
            "Se a pergunta sair do escopo nutrição/treino/rotina, oriente o paciente a falar com o nutricionista."
        ),
    },
}

async def ensure_agents_seeded():
    for code, cfg in AGENT_DEFAULTS.items():
        existing = await db.agents.find_one({"code": code})
        if not existing:
            await db.agents.insert_one({
                "id": str(uuid.uuid4()),
                "code": code,
                "name": cfg["name"],
                "description": cfg["description"],
                "base_prompt": cfg["base_prompt"],
                "created_at": iso(now_utc()),
                "updated_at": iso(now_utc()),
            })

def extract_text_from_upload(filename: str, content_type: str, raw: bytes) -> str:
    """Best-effort text extraction from PDF / JSON / TXT/MD uploads."""
    name = (filename or "").lower()
    if name.endswith(".pdf") or (content_type or "").lower() == "application/pdf":
        try:
            with pdfplumber.open(io.BytesIO(raw)) as pdf:
                text = "\n".join((p.extract_text() or "") for p in pdf.pages)
            return text.strip()
        except Exception as e:
            raise HTTPException(400, f"Não foi possível ler o PDF: {str(e)[:140]}")
    if name.endswith(".json") or (content_type or "").lower() == "application/json":
        try:
            data = json.loads(raw.decode("utf-8", errors="ignore"))
            return json.dumps(data, ensure_ascii=False, indent=2)
        except Exception:
            return raw.decode("utf-8", errors="ignore")
    # treat everything else as plain text
    try:
        return raw.decode("utf-8", errors="ignore")
    except Exception:
        return ""

async def build_agent_system_prompt(agent_code: str, extra_context: str = "") -> str:
    """Concatenate the agent's base_prompt + uploaded training docs + extra_context.
    Caps at AGENT_PROMPT_MAX_CHARS to stay within model context.
    """
    agent = await db.agents.find_one({"code": agent_code}, {"_id": 0})
    if not agent:
        # Fallback to defaults if not seeded yet
        agent = {"base_prompt": AGENT_DEFAULTS[agent_code]["base_prompt"]}
    base = agent.get("base_prompt", "") or ""
    docs = await db.agent_documents.find(
        {"agent_code": agent_code}, {"_id": 0}
    ).sort("created_at", 1).to_list(50)

    parts = [base.strip()]
    if docs:
        parts.append(
            "\n\n--- MATERIAL DE TREINAMENTO ENVIADO PELO NUTRICIONISTA ---\n"
            "Use estes documentos como referência ao responder. Não invente conteúdo fora deles."
        )
        for d in docs:
            title = d.get("title", "documento")
            body = (d.get("content") or "").strip()
            if not body:
                continue
            parts.append(f"\n### DOC: {title}\n{body}")

    if extra_context:
        parts.append(f"\n\n--- CONTEXTO DESTA INTERAÇÃO ---\n{extra_context.strip()}")

    full = "\n".join(parts).strip()
    if len(full) > AGENT_PROMPT_MAX_CHARS:
        full = full[:AGENT_PROMPT_MAX_CHARS] + "\n\n[...material truncado por limite de contexto...]"
    return full

# ---------- AI ----------
SYSTEM_CLINICAL = (
    "Você é o assistente clínico nutricional sênior do Rogério Costa (Treinador e Nutricionista). "
    "Responda sempre em Português (Brasil), tom acolhedor, preciso e sem jargão excessivo. "
    "Nunca dê diagnóstico médico — apenas organize informações, destaque sinais de atenção, "
    "e ofereça sugestões para o nutricionista revisar."
)

async def ai_clinical_analysis(anamnesis: dict, evaluation: Optional[dict]) -> str:
    prompt = (
        "Analise clinicamente este paciente e gere um relatório estruturado em Markdown com as seções: "
        "1) Objetivo principal e prioridade. 2) Padrões alimentares e comportamentais detectados. "
        "3) Riscos clínicos sugeridos (com bullets). 4) Score de adesão estimado (1–10) com justificativa. "
        "5) 3 recomendações práticas para a primeira consulta. Seja conciso (máx. 400 palavras).\n\n"
        f"ANAMNESE: {anamnesis}\n\nAVALIAÇÃO FÍSICA: {evaluation or 'não disponível'}"
    )
    return await _ai_chat(f"analise-{uuid.uuid4()}", SYSTEM_CLINICAL, prompt)

async def ai_meal_plan(patient: dict, anamnesis: dict, macros: dict, restricoes: str = None) -> str:
    prompt = (
        f"Monte um plano alimentar diário em Markdown para o paciente {patient.get('name')}. "
        f"Meta: {macros['kcal']} kcal | PTN {macros['proteina_g']}g | CHO {macros['carboidrato_g']}g | LIP {macros['gordura_g']}g. "
        f"Restrições/preferências: {restricoes or 'nenhuma informada'}. "
        "Estruture em 5 a 6 refeições com horários sugeridos, alimentos em porções práticas (g/ml/unidades), "
        "e finalize com uma seção 'Suplementação Sugerida' (se aplicável) e 'Hidratação'. "
        "Use linguagem clara, sem jargão. Não exceda 500 palavras."
    )
    return await _ai_chat(f"plano-{uuid.uuid4()}", SYSTEM_CLINICAL, prompt)

async def ai_adaptive_chat(token: str, message: str, anamnesis: dict, history: list) -> str:
    sys_prompt = await build_agent_system_prompt("agent1")
    context = f"Dados iniciais do paciente:\n{anamnesis}\n\nHistórico recente:\n"
    for m in history[-10:]:
        context += f"{m['role']}: {m['content']}\n"
    context += f"\nMensagem do paciente: {message}\nResponda de forma acolhedora."
    return await _ai_chat(f"chat-{token}", sys_prompt, context)

async def ai_consultorio_chat(session_id: str, message: str, patient_context: dict, history: list) -> str:
    extra = (
        "DADOS DO PACIENTE EM CONSULTA (use para fundamentar a resposta):\n"
        f"{json.dumps(patient_context, ensure_ascii=False, default=str)[:18000]}"
    )
    sys_prompt = await build_agent_system_prompt("agent2", extra_context=extra)
    convo = "".join(f"{m['role']}: {m['content']}\n" for m in history[-10:])
    convo += f"user: {message}"
    return await _ai_chat(f"consult-{session_id}", sys_prompt, convo)

async def ai_patient_chat(session_id: str, message: str, patient_context: dict, history: list) -> str:
    extra = (
        "CONTEXTO DO PACIENTE (plano alimentar ativo e dados-chave):\n"
        f"{json.dumps(patient_context, ensure_ascii=False, default=str)[:14000]}"
    )
    sys_prompt = await build_agent_system_prompt("agent3", extra_context=extra)
    convo = "".join(f"{m['role']}: {m['content']}\n" for m in history[-10:])
    convo += f"user: {message}"
    return await _ai_chat(f"patient-{session_id}", sys_prompt, convo)

async def ai_patient_proactive(session_id: str, instruction: str, patient_context: dict) -> str:
    extra = (
        "CONTEXTO DO PACIENTE (plano alimentar ativo e dados-chave):\n"
        f"{json.dumps(patient_context, ensure_ascii=False, default=str)[:14000]}"
    )
    sys_prompt = await build_agent_system_prompt("agent3", extra_context=extra)
    prompt = (
        "[INSTRUÇÃO INTERNA — NÃO REVELAR AO PACIENTE]\n"
        f"Diretriz do nutricionista: {instruction}\n\n"
        "Componha UMA mensagem proativa e curta (até 350 caracteres), em primeira pessoa, "
        "iniciando você o contato (sem responder a uma pergunta). Tom acolhedor, claro. "
        "Use o nome do paciente se disponível no contexto. "
        "Não cite que isto é um lembrete automático. NÃO use emoji."
    )
    return await _ai_chat(f"proactive-{session_id}-{uuid.uuid4().hex[:6]}", sys_prompt, prompt)

_GEMINI_MODEL = "gemini-2.5-flash"
_GEMINI_RETRY_DELAYS = [1, 2, 4, 8]  # backoff em segundos (4 tentativas)

async def _gemini_chat(messages: list, system_prompt: str, api_key: str) -> str:
    """Chama a Gemini 2.5 Flash com retry exponencial em caso de alta demanda."""
    import httpx, asyncio
    contents = []
    for m in messages:
        role = "model" if m.get("role") == "assistant" else "user"
        contents.append({"role": role, "parts": [{"text": str(m.get("content", ""))}]})
    if not contents:
        contents = [{"role": "user", "parts": [{"text": "Olá!"}]}]
    body = {
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": contents,
        "generationConfig": {"maxOutputTokens": 1024, "temperature": 0.9},
    }
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{_GEMINI_MODEL}:generateContent"
    last_err = "desconhecido"
    async with httpx.AsyncClient(timeout=50.0) as client:
        for attempt, delay in enumerate([0] + _GEMINI_RETRY_DELAYS):
            if delay:
                await asyncio.sleep(delay)
            try:
                resp = await client.post(url, params={"key": api_key}, json=body)
                data = resp.json()
                if resp.is_success:
                    return data["candidates"][0]["content"]["parts"][0]["text"]
                err_msg = data.get("error", {}).get("message", f"HTTP {resp.status_code}")
                last_err = err_msg
                # Erro fatal (auth, billing real) → não adianta retry
                if resp.status_code in (401, 403):
                    raise ValueError(err_msg)
                # Alta demanda ou quota → retry com backoff
                logging.warning(f"Gemini tentativa {attempt+1}: {err_msg[:120]}")
            except httpx.TimeoutException:
                last_err = "Timeout"
                logging.warning(f"Gemini timeout na tentativa {attempt+1}")
    raise ValueError(f"Gemini indisponível após {len(_GEMINI_RETRY_DELAYS)+1} tentativas: {last_err[:120]}")

async def _ai_chat(session_id: str, system_prompt: str, user_text: str) -> str:
    """Usa Gemini quando disponível e Anthropic como alternativa."""
    if GEMINI_KEY:
        return await _gemini_chat(
            [{"role": "user", "content": user_text}],
            system_prompt,
            GEMINI_KEY,
        )
    chat = LlmChat(
        api_key=ANTHROPIC_API_KEY,
        session_id=session_id,
        system_message=system_prompt,
    ).with_model("anthropic", "claude-sonnet-4-6")
    return await chat.send_message(UserMessage(text=user_text))

async def ai_exam_analysis(raw_text: str) -> dict:
    """Extract laboratory markers from exam PDF text and classify them.
    Returns: {markers: [{nome, valor, unidade, referencia, status}], resumo, conduta_sugerida}
    """
    chat = LlmChat(
        api_key=ANTHROPIC_API_KEY,
        session_id=f"exame-{uuid.uuid4()}",
        system_message=(
            "Você é um especialista em interpretação de exames laboratoriais. "
            "Receberá o texto bruto extraído de um PDF de exame e deve devolver APENAS JSON válido "
            "(sem markdown, sem comentários) com a seguinte estrutura: "
            '{"markers":[{"nome":"...","valor":"...","unidade":"...","referencia":"...","status":"normal|atencao|prioridade","observacao":"..."}], '
            '"resumo":"...","conduta_sugerida":"..."}. '
            "Identifique marcadores comuns: hemoglobina, glicemia, glicose em jejum, vitamina D (25-OH), ferritina, "
            "vitamina B12, colesterol total, LDL, HDL, triglicerídeos, TSH, T4 livre, PCR, ferro sérico, "
            "creatinina, ureia, ácido úrico, ALT, AST, GGT, hemoglobina glicada (HbA1c). "
            "Status: 'normal' (dentro da referência), 'atencao' (limítrofe ou levemente alterado), "
            "'prioridade' (alteração relevante que merece atenção). "
            "Responda em Português (BR). NÃO faça diagnóstico médico, apenas organize."
        ),
    ).with_model("anthropic", "claude-sonnet-4-6")
    prompt = f"Texto extraído do exame:\n\n{raw_text[:8000]}"
    raw = await chat.send_message(UserMessage(text=prompt))
    # Try to parse JSON; fallback on first valid {...} block
    try:
        return json.loads(raw)
    except Exception:
        start = raw.find("{")
        end = raw.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(raw[start:end+1])
            except Exception:
                pass
        return {"markers": [], "resumo": raw[:600], "conduta_sugerida": ""}

# ---------- Auth Endpoints ----------
@api.post("/auth/register", response_model=UserOut)
async def register(payload: RegisterIn, response: Response):
    email = payload.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "E-mail já cadastrado")
    uid = str(uuid.uuid4())
    doc = {
        "id": uid, "email": email, "name": payload.name,
        "password_hash": hash_password(payload.password),
        "role": "nutritionist", "created_at": iso(now_utc()),
    }
    await db.users.insert_one(doc)
    set_auth_cookie(response, create_token(uid, email))
    return UserOut(id=uid, email=email, name=payload.name, role="nutritionist")

@api.post("/auth/login", response_model=UserOut)
async def login(payload: LoginIn, response: Response):
    email = payload.email.lower()
    now = now_utc()

    # Lockout check
    state = _login_attempts.get(email)
    if state and state.get("locked_until") and state["locked_until"] > now:
        remaining = int((state["locked_until"] - now).total_seconds() / 60) + 1
        raise HTTPException(
            429,
            f"Conta temporariamente bloqueada por excesso de tentativas. Tente novamente em ~{remaining} min."
        )

    user = await db.users.find_one({"email": email})
    ok = bool(user) and verify_password(payload.password, user["password_hash"])
    if not ok:
        # increment counter
        if not state or (state.get("first") and (now - state["first"]).total_seconds() > LOCKOUT_WINDOW_MIN * 60):
            state = {"count": 1, "first": now, "locked_until": None}
        else:
            state["count"] += 1
        if state["count"] >= LOCKOUT_MAX_ATTEMPTS:
            state["locked_until"] = now + timedelta(minutes=LOCKOUT_WINDOW_MIN)
        _login_attempts[email] = state
        raise HTTPException(401, "Credenciais inválidas")

    # Success — reset counter
    _login_attempts.pop(email, None)
    set_auth_cookie(response, create_token(user["id"], email))
    return UserOut(id=user["id"], email=email, name=user["name"], role=user.get("role", "nutritionist"))

@api.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    return {"ok": True}

@api.get("/auth/me", response_model=UserOut)
async def me(user=Depends(get_current_user)):
    return UserOut(id=user["id"], email=user["email"], name=user["name"], role=user.get("role", "nutritionist"))

# ---------- Public Lead / Anamnesis flow ----------
@api.post("/leads", response_model=LeadOut)
async def create_lead(payload: LeadIn, request: Request, nutri: Optional[str] = Query(None)):
    nutri_doc = None
    current_user = await maybe_get_current_user(request)
    if current_user and current_user.get("role") == "nutritionist":
        nutri_doc = current_user
    if nutri:
        nutri_doc = await db.users.find_one({"slug": nutri.lower(), "role": "nutritionist"})
    if not nutri_doc:
        admin_email = (os.environ.get("ADMIN_EMAIL") or "").lower()
        if admin_email:
            nutri_doc = await db.users.find_one(
                {"role": "nutritionist", "email": {"$ne": admin_email}},
                sort=[("created_at", 1)],
            )
    if not nutri_doc:
        nutri_doc = await db.users.find_one({"role": "nutritionist"}, sort=[("created_at", 1)])
    if not nutri_doc:
        raise HTTPException(500, "Nenhum nutricionista cadastrado")
    token = secrets.token_urlsafe(16)
    pid = str(uuid.uuid4())
    patient = {
        "id": pid, "nome": payload.name, "telefone": payload.phone, "email": payload.email,
        "status_funil": "LEAD_INICIADO", "nutricionista_id": nutri_doc["id"],
        "lead_token": token, "created_at": iso(now_utc()),
    }
    await db.patients.insert_one(patient)
    return LeadOut(token=token, patient_id=pid, name=payload.name)

# ─── ATENDIMENTO PÚBLICO (Agente de Primeiro Contato) ────────────────────────

ATENDIMENTO_SYSTEM_PROMPT = """Você é RC Nutri, o assistente de primeiro contato do nutricionista e treinador Rogério Costa.

Seu objetivo é realizar o primeiro contato com o potencial paciente, coletar informações essenciais, qualificá-lo e apresentar os planos da consultoria.

Tom: motivador, empático, linguagem informal mas profissional. Use emojis moderadamente. Valide cada resposta antes de avançar.

FLUXO OBRIGATÓRIO (siga exatamente esta ordem, nunca pule etapas):

ETAPA 1 — SAUDAÇÃO:
Comece apresentando-se e pedindo o nome do visitante. Após receber o nome, use exatamente:
"Olá {nome} tudo bem? SEJA MUITO BEM VINDO(A)! 😊

Vou te explicar todos os detalhes da consultoria online do Rogério.
Mas antes preciso fazer algumas perguntas para ver se essa consultoria serve para você, ok?"

Depois pergunte: "Qual perfil e objetivo abaixo que você se encaixa atualmente?"
1. Quero ganhar massa e volume muscular 💪
2. Quero perder barriga, definir o corpo e emagrecer sem flacidez 🔥
3. Apenas manutenção da saúde, sem fins estéticos ✅

ETAPA 2 — DETALHES PESSOAIS:
Após o objetivo, responda: "Agora compreendi perfeitamente seu objetivo 😊 Vou te ajudar nessa jornada! 👊 Últimos detalhes para eu entender 100% se meu método pode te ajudar!"
Pergunte (pode ser em uma mensagem):
1. Qual sua idade, peso e altura ATUAL?
2. Você já teve experiência com consultoria de treino e nutrição?
3. Qual sua maior dificuldade em atingir o objetivo?

ETAPA 3 — AVALIAÇÃO CORPORAL:
"Perfeito, obrigado pelas informações! Só mais uma coisa 👇"
Peça que escolha uma faixa de 1 a 9 que representa o corpo HOJE e outra que representa o corpo que DESEJA:
1 (10-12%) — Muito definido, músculos aparentes
2 (15-17%) — Boa definição, forma atlética
3 (20-22%) — Forma saudável, pouca definição
4 (25%) — Acima do ideal, pouca tonicidade
5 (30%) — Sobrepeso moderado
6 (35%) — Sobrepeso significativo
7 (40%) — Obesidade moderada
8 (45%) — Obesidade severa
9 (50%+) — Obesidade mórbida

ETAPA 4 — APRESENTAÇÃO DA OFERTA:
Apresente com entusiasmo:
"COMO FUNCIONA A CONSULTORIA FITNESS GOLD 🏆

🏋 AVALIAÇÃO FÍSICA / CONSULTA — análise do condicionamento físico atual e rotina para o planejamento perfeito

📱 ACESSO EXCLUSIVO AO APP — vídeos da execução correta de cada exercício + PDF com planejamento nutricional 🍎🥗

💎 SUPORTE VIP e ILIMITADO — acesso ao WhatsApp do Rogério para tirar dúvidas sempre que precisar

✅ FEEDBACK SEMANAL para acompanhamento mais próximo e ajustes no planejamento

É esse tipo de acompanhamento PERSONALIZADO que você está procurando?
Pois já vou te passar o valor promocional 👇"

Planos disponíveis:
- Plano Treino (2 meses de acompanhamento)
- Plano Nutrição (2 meses de acompanhamento)
- Consultoria Gold (2 meses) ⭐ MAIS POPULAR

Urgência: "Restam apenas algumas vagas para a consultoria Gold Fitness deste mês — oferta válida enquanto durarem as vagas!"
"Qual plano fica melhor para você? 😊"

ETAPA 5 — ENCERRAMENTO:
Após o paciente escolher o plano:
"Perfeito, ótima escolha! 🎉

Já vou processar suas informações e o Rogério entrará em contato para finalizar sua inscrição.

Fique de olho no seu WhatsApp 📱"

REGRAS:
- Nunca pule etapas. Sempre valide a resposta antes de avançar.
- Ao finalizar TODA a coleta, inclua obrigatoriamente este bloco no final da mensagem de encerramento:
DADOS_COLETADOS: {"nome": "", "objetivo": "", "idade": "", "peso": "", "altura": "", "experiencia_previa": "", "maior_dificuldade": "", "gordura_atual_faixa": "", "gordura_desejada_faixa": "", "plano_escolhido": ""}
"""

# Rate limit para atendimento (session_id → timestamps)
_atendimento_rate: dict = defaultdict(deque)
ATENDIMENTO_RATE_MAX = 30
ATENDIMENTO_RATE_WINDOW = 60

class AtendimentoMsgIn(BaseModel):
    session_id: str
    messages: List[dict]  # [{"role": "user"|"assistant", "content": "..."}]

class AtendimentoLeadIn(BaseModel):
    nome: Optional[str] = None
    telefone: Optional[str] = None
    email: Optional[str] = None
    objetivo: Optional[str] = None
    idade: Optional[str] = None
    peso: Optional[str] = None
    altura: Optional[str] = None
    experiencia_previa: Optional[str] = None
    maior_dificuldade: Optional[str] = None
    gordura_atual_faixa: Optional[str] = None
    gordura_desejada_faixa: Optional[str] = None
    plano_escolhido: Optional[str] = None

@api.post("/public/atendimento/chat")
async def atendimento_chat(payload: AtendimentoMsgIn):
    sid = (payload.session_id or "")[:64]
    now = now_utc()
    bucket = _atendimento_rate[sid]
    cutoff = now - timedelta(seconds=ATENDIMENTO_RATE_WINDOW)
    while bucket and bucket[0] < cutoff:
        bucket.popleft()
    if len(bucket) >= ATENDIMENTO_RATE_MAX:
        raise HTTPException(429, "Muitas mensagens. Aguarde alguns segundos.")
    bucket.append(now)

    msgs = (payload.messages or [])[-25:]

    try:
        gemini_key = os.environ.get("GEMINI_KEY", "").strip()
        if gemini_key:
            reply = await _gemini_chat(msgs, ATENDIMENTO_SYSTEM_PROMPT, gemini_key)
        else:
            # Alternativa direta pela API da Anthropic
            convo = "\n\n".join(
                f"{str(m.get('role','user')).upper()}: {str(m.get('content',''))}"
                for m in msgs
            )
            chat = LlmChat(
                api_key=ANTHROPIC_API_KEY,
                session_id=f"atend-{sid}-{uuid.uuid4().hex[:8]}",
                system_message=ATENDIMENTO_SYSTEM_PROMPT,
            ).with_model("anthropic", "claude-sonnet-4-6")
            reply = await chat.send_message(UserMessage(text=convo.strip() or "Olá!"))
    except Exception as e:
        logging.exception("Atendimento chat failed")
        raise HTTPException(503, f"Agente indisponível: {str(e)[:160]}")

    # Extract DADOS_COLETADOS if present
    collected = None
    match = re.search(r'DADOS_COLETADOS:\s*(\{[\s\S]*?\})', reply)
    if match:
        try:
            collected = json.loads(match.group(1))
        except Exception:
            pass

    clean_reply = re.sub(r'\s*DADOS_COLETADOS:[\s\S]*$', '', reply).strip()
    return {"reply": clean_reply, "collected_data": collected, "finished": collected is not None}

@api.post("/public/atendimento/lead")
async def atendimento_save_lead(payload: AtendimentoLeadIn):
    nutri_doc = await db.users.find_one({"role": "nutritionist"}, sort=[("created_at", 1)])
    if not nutri_doc:
        raise HTTPException(500, "Nenhum nutricionista cadastrado")
    token = secrets.token_urlsafe(16)
    pid = str(uuid.uuid4())
    patient = {
        "id": pid,
        "nome": payload.nome or "Visitante",
        "telefone": payload.telefone or "",
        "email": payload.email or "",
        "status_funil": "LEAD_ATENDIMENTO",
        "nutricionista_id": nutri_doc["id"],
        "lead_token": token,
        "objetivo": payload.objetivo,
        "peso": payload.peso,
        "altura": payload.altura,
        "atendimento_dados": {
            "idade": payload.idade,
            "experiencia_previa": payload.experiencia_previa,
            "maior_dificuldade": payload.maior_dificuldade,
            "gordura_atual_faixa": payload.gordura_atual_faixa,
            "gordura_desejada_faixa": payload.gordura_desejada_faixa,
            "plano_escolhido": payload.plano_escolhido,
        },
        "created_at": iso(now_utc()),
    }
    await db.patients.insert_one(patient)
    return {"ok": True, "token": token, "patient_id": pid}

@api.get("/public/lead/{token}")
async def get_lead(token: str):
    p = await db.patients.find_one({"lead_token": token}, {"_id": 0, "password_hash": 0})
    if not p:
        raise HTTPException(404, "Lead não encontrado")
    return public_lead_view(p)

@api.post("/public/checkout/{token}/comprovante")
async def upload_comprovante(token: str, file: UploadFile = File(...)):
    p = await db.patients.find_one({"lead_token": token})
    if not p:
        raise HTTPException(404, "Lead não encontrado")
    ct = (file.content_type or "")
    if not (ct.startswith("image/") or ct == "application/pdf"):
        raise HTTPException(400, "Envie uma imagem ou PDF")
    contents = await file.read()
    if len(contents) > 10 * 1024 * 1024:
        raise HTTPException(400, "Arquivo maior que 10MB")
    b64 = _base64.b64encode(contents).decode()
    data_url = f"data:{ct};base64,{b64}"
    await db.patients.update_one(
        {"lead_token": token},
        {"$set": {
            "comprovante": {"file_name": file.filename, "data_url": data_url, "uploaded_at": iso(now_utc())},
            "status_funil": "COMPROVANTE_ENVIADO",
        }},
    )
    return {"ok": True}

_COND_LABELS = {
    "sem_experiencia": "Sem experiência",
    "inativo": "Inativo",
    "ativo_1": "Ativo 1 — treina às vezes",
    "ativo_2": "Ativo 2 — treina regularmente",
    "atleta": "Atleta",
}

def _join_list(v):
    if isinstance(v, list):
        return ", ".join(str(x) for x in v if x)
    return v or ""

def _map_preconsulta(r: dict) -> dict:
    m = {}
    # dados_sociais
    if r.get("email"):     m["email"]    = r["email"]
    if r.get("profissao"): m["ocupacao"] = r["profissao"]
    # habitos_vida
    if r.get("alcool"):   m["alcool"]              = r["alcool"]
    if r.get("fumo"):     m["tabagismo"]            = r["fumo"]
    if r.get("sono"):     m["habitos_sono"]         = _join_list(r["sono"])
    if r.get("alergias"): m["restricao_alimentar"]  = r["alergias"]
    # patologias
    if r.get("lesoes"):    m["lesoes"]       = r["lesoes"]
    if r.get("doencas"):   m["patologias"]   = r["doencas"]
    if r.get("medicacao"): m["medicamentos"] = r["medicacao"]
    # avaliacao_clinica
    if r.get("intestino"): m["habito_intestinal"] = r["intestino"]
    if r.get("agua"):      m["ingestao_hidrica"]  = r["agua"]
    # alimentacao
    if r.get("alergias"):
        m["alergia_alimentar"]     = r["alergias"]
        m["intolerancia_alimentar"] = r["alergias"]
    if r.get("frutas_preferidas"): m["preferencia_alimentar"] = r["frutas_preferidas"]
    if r.get("suplementacao"):     m["suplementos"]           = r["suplementacao"]
    # atividade_fisica
    cond = r.get("condicionamento")
    if cond: m["atividades_praticadas"] = _COND_LABELS.get(cond, cond)
    if r.get("dias_treino"):    m["frequencia_semana"]  = _join_list(r["dias_treino"])
    if r.get("horario_treino"): m["horario_atividades"] = r["horario_treino"]
    return m

@api.post("/public/anamnesis")
async def submit_anamnesis(payload: AnamnesisIn):
    p = await db.patients.find_one({"lead_token": payload.token})
    if not p:
        raise HTTPException(404, "Lead não encontrado")
    r = payload.respostas
    aid = str(uuid.uuid4())
    doc = {
        "id": aid, "paciente_id": p["id"], "respostas": r,
        "created_at": iso(now_utc()),
        **_map_preconsulta(r),
    }
    await db.anamneses.insert_one(doc)
    # update patient with relevant fields (support old & new field names)
    upd = {"status_funil": "ANAMNESE_COMPLETA"}

    def first(*keys):
        for k in keys:
            v = r.get(k)
            if v not in (None, "", [], {}):
                return v
        return None

    peso = first("peso_atual", "peso")
    altura = first("estatura", "altura")
    if peso is not None:
        try: upd["peso"] = float(peso)
        except (TypeError, ValueError): pass
    if altura is not None:
        try: upd["altura"] = int(float(altura))
        except (TypeError, ValueError): pass
    if r.get("data_nascimento"): upd["data_nascimento"] = r["data_nascimento"]
    if r.get("sexo"): upd["sexo"] = r["sexo"]
    if r.get("email"): upd["email"] = r["email"]
    obj = first("objetivo")
    if obj: upd["objetivo"] = obj if isinstance(obj, str) else str(obj)
    await db.patients.update_one({"id": p["id"]}, {"$set": upd})
    return {"ok": True, "anamnesis_id": aid}

@api.post("/public/lead/{token}/photos")
async def upload_lead_photos(token: str, payload: PhotosIn):
    p = await db.patients.find_one({"lead_token": token})
    if not p:
        raise HTTPException(404, "Lead não encontrado")
    if not isinstance(payload.fotos, list):
        raise HTTPException(400, "Formato inválido")
    # Cap at 4 photos and ~3MB each (data URL ≈ 4MB raw)
    cleaned = []
    for f in payload.fotos[:4]:
        data_url = (f.get("data_url") or "")
        if not data_url.startswith("data:image/"):
            continue
        if len(data_url) > 4_500_000:
            continue
        cleaned.append({
            "id": str(uuid.uuid4()),
            "name": (f.get("name") or "foto")[:120],
            "data_url": data_url,
            "size": int(f.get("size") or len(data_url)),
            "uploaded_at": iso(now_utc()),
        })
    await db.patients.update_one({"id": p["id"]}, {"$set": {"fotos": cleaned}})
    return {"ok": True, "count": len(cleaned)}

@api.get("/public/chat/{token}")
async def get_chat(token: str):
    msgs = await db.chat_messages.find({"token": token}, {"_id": 0}).sort("created_at", 1).to_list(200)
    return msgs

@api.post("/public/chat")
async def post_chat(payload: ChatIn):
    p = await db.patients.find_one({"lead_token": payload.token})
    if not p:
        raise HTTPException(404, "Lead não encontrado")

    # Rate limit: max CHAT_RATE_MAX requests / CHAT_RATE_WINDOW seconds per token
    now = now_utc()
    bucket = _chat_rate[payload.token]
    cutoff = now - timedelta(seconds=CHAT_RATE_WINDOW)
    while bucket and bucket[0] < cutoff:
        bucket.popleft()
    if len(bucket) >= CHAT_RATE_MAX:
        raise HTTPException(429, "Muitas mensagens em pouco tempo. Aguarde alguns segundos e tente novamente.")
    bucket.append(now)

    anam = await db.anamneses.find_one({"paciente_id": p["id"]}, {"_id": 0}, sort=[("created_at", -1)])
    history = await db.chat_messages.find({"token": payload.token}, {"_id": 0}).sort("created_at", 1).to_list(50)
    user_msg = {
        "id": str(uuid.uuid4()), "token": payload.token, "role": "user",
        "content": payload.message, "created_at": iso(now_utc()),
    }
    await db.chat_messages.insert_one(user_msg)
    try:
        ai_text = await ai_adaptive_chat(payload.token, payload.message, anam.get("respostas") if anam else {}, history)
    except Exception as e:
        logging.exception("AI chat failed")
        ai_text = "Desculpe, tive uma instabilidade. Pode repetir sua última resposta?"
    ai_msg = {
        "id": str(uuid.uuid4()), "token": payload.token, "role": "assistant",
        "content": ai_text, "created_at": iso(now_utc()),
    }
    await db.chat_messages.insert_one(ai_msg)
    finished = "ANAMNESE_FINALIZADA" in ai_text
    return {"reply": ai_text, "finished": finished}

@api.get("/public/slots/{token}")
async def get_slots(token: str):
    p = await db.patients.find_one({"lead_token": token})
    if not p:
        raise HTTPException(404, "Lead não encontrado")
    # Generate next 7 days slots in America/Sao_Paulo (Mon-Sat 09-17h)
    booked = set()
    cursor = db.consultations.find({"nutricionista_id": p["nutricionista_id"], "status": "AGENDADA"})
    async for c in cursor:
        booked.add(c["data_hora"])
    slots = []
    today_br = datetime.now(TZ_BR).date()
    for d in range(7):
        day = today_br + timedelta(days=d + 1)
        if day.weekday() == 6:  # skip Sunday
            continue
        for h in [9, 10, 11, 14, 15, 16, 17]:
            dt_local = datetime(day.year, day.month, day.day, h, 0, tzinfo=TZ_BR)
            key = dt_local.isoformat()
            slots.append({
                "datetime": key,
                "available": key not in booked,
                "label": f"{day.strftime('%d/%m')} · {h:02d}:00 (BRT)",
            })
    return slots

@api.post("/public/schedule")
async def schedule(payload: ScheduleIn):
    p = await db.patients.find_one({"lead_token": payload.token})
    if not p:
        raise HTTPException(404, "Lead não encontrado")
    # Build SP-local datetime → store ISO with offset
    try:
        y, m, dd = [int(x) for x in payload.date.split("-")]
        hh, mm = [int(x) for x in payload.time.split(":")]
        dt_local = datetime(y, m, dd, hh, mm, tzinfo=TZ_BR)
    except Exception:
        raise HTTPException(400, "Data ou horário inválidos")
    dt_str = dt_local.isoformat()
    cid = str(uuid.uuid4())
    consult = {
        "id": cid, "paciente_id": p["id"], "nutricionista_id": p["nutricionista_id"],
        "data_hora": dt_str, "tipo": payload.type, "status": "AGENDADA",
        "observacoes": "", "created_at": iso(now_utc()),
    }
    await db.consultations.insert_one(consult)
    await db.patients.update_one({"id": p["id"]}, {"$set": {"status_funil": "CONSULTA_AGENDADA"}})
    return {"ok": True, "consultation_id": cid, "data_hora": dt_str}

# ---------- Authenticated CRM ----------
PATIENT_STATUSES = {
    "LEAD_INICIADO", "ANAMNESE_COMPLETA", "CONSULTA_AGENDADA",
    "CONSULTA_REALIZADA", "PLANO_ENTREGUE", "EM_ACOMPANHAMENTO",
}

def _validate_patient_status(value: Optional[str]) -> Optional[str]:
    if value is not None and value not in PATIENT_STATUSES:
        raise HTTPException(400, f"Status inválido. Use um de: {sorted(PATIENT_STATUSES)}")
    return value

def _consultation_datetime(date_value: str, time_value: str) -> str:
    try:
        y, m, dd = [int(x) for x in date_value.split("-")]
        hh, mm = [int(x) for x in time_value.split(":")]
        return datetime(y, m, dd, hh, mm, tzinfo=TZ_BR).isoformat()
    except Exception:
        raise HTTPException(400, "Data ou horário inválidos")

@api.get("/dashboard")
async def dashboard(user=Depends(get_current_user)):
    nid = user["id"]
    total = await db.patients.count_documents({"nutricionista_id": nid})
    agora = now_utc()
    inicio_dia = datetime(agora.year, agora.month, agora.day, tzinfo=timezone.utc).isoformat()
    fim_dia = datetime(agora.year, agora.month, agora.day, 23, 59, 59, tzinfo=timezone.utc).isoformat()
    consultas_hoje = await db.consultations.count_documents({
        "nutricionista_id": nid,
        "data_hora": {"$gte": inicio_dia, "$lte": fim_dia},
        "status": "AGENDADA",
    })
    novos = await db.patients.count_documents({
        "nutricionista_id": nid,
        "created_at": {"$gte": (agora - timedelta(days=7)).isoformat()},
    })
    em_acomp = await db.patients.count_documents({
        "nutricionista_id": nid,
        "status_funil": {"$in": ["EM_ACOMPANHAMENTO", "PLANO_ENTREGUE"]},
    })
    funil = {}
    for s in ["LEAD_INICIADO", "ANAMNESE_COMPLETA", "CONSULTA_AGENDADA",
              "CONSULTA_REALIZADA", "PLANO_ENTREGUE", "EM_ACOMPANHAMENTO"]:
        funil[s] = await db.patients.count_documents({"nutricionista_id": nid, "status_funil": s})
    return {
        "total_pacientes": total, "consultas_hoje": consultas_hoje,
        "novos_7d": novos, "em_acompanhamento": em_acomp, "funil": funil,
    }

@api.get("/patients")
async def list_patients(user=Depends(get_current_user)):
    rows = await db.patients.find(
        {"nutricionista_id": user["id"]}, {"_id": 0, "lead_token": 0}
    ).sort("created_at", -1).to_list(500)
    return rows

@api.post("/patients", status_code=201)
async def create_patient(payload: PatientCreateIn, user=Depends(require_nutritionist)):
    email = str(payload.email).lower() if payload.email else None
    if email and await db.patients.find_one({"nutricionista_id": user["id"], "email": email}):
        raise HTTPException(409, "Já existe um paciente com este e-mail")
    _validate_patient_status(payload.status_funil)
    now_str = iso(now_utc())
    doc = {
        "id": str(uuid.uuid4()),
        "nutricionista_id": user["id"],
        "lead_token": secrets.token_urlsafe(16),
        **payload.model_dump(),
        "email": email,
        "created_at": now_str,
        "updated_at": now_str,
    }
    await db.patients.insert_one(doc)
    return {k: v for k, v in doc.items() if k not in ("_id", "lead_token")}

@api.patch("/patients/{pid}")
async def update_patient(pid: str, payload: PatientUpdateIn, user=Depends(require_nutritionist)):
    patient = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not patient:
        raise HTTPException(404, "Paciente não encontrado")
    updates = payload.model_dump(exclude_unset=True)
    _validate_patient_status(updates.get("status_funil"))
    if updates.get("email"):
        updates["email"] = str(updates["email"]).lower()
        duplicate = await db.patients.find_one({
            "nutricionista_id": user["id"], "email": updates["email"], "id": {"$ne": pid}
        })
        if duplicate:
            raise HTTPException(409, "Já existe outro paciente com este e-mail")
    updates["updated_at"] = iso(now_utc())
    await db.patients.update_one({"id": pid}, {"$set": updates})
    return await db.patients.find_one({"id": pid}, {"_id": 0, "lead_token": 0})

@api.delete("/patients/{pid}")
async def delete_patient(pid: str, user=Depends(require_nutritionist)):
    patient = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not patient:
        raise HTTPException(404, "Paciente não encontrado")
    patient_filters = {
        "anamneses": {"paciente_id": pid},
        "consultations": {"paciente_id": pid},
        "evaluations": {"paciente_id": pid},
        "meal_plans": {"paciente_id": pid},
        "ai_analyses": {"paciente_id": pid},
        "exams": {"paciente_id": pid},
        "recordatorios": {"paciente_id": pid},
        "patient_nudges": {"patient_id": pid},
        "patient_messages": {"patient_id": pid},
        "consultorio_messages": {"patient_id": pid},
        "planos_manuais": {"paciente_id": pid},
        "planos_manuais_historico": {"paciente_id": pid},
        "exames_manuais": {"paciente_id": pid},
    }
    deleted = {}
    for collection_name, query in patient_filters.items():
        result = await db[collection_name].delete_many(query)
        deleted[collection_name] = result.deleted_count
    if patient.get("user_id"):
        await db.users.delete_one({"id": patient["user_id"], "role": "patient"})
    await db.patients.delete_one({"id": pid})
    return {"ok": True, "deleted_related": deleted}

@api.get("/patients/{pid}")
async def get_patient(pid: str, user=Depends(get_current_user)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    anam = await db.anamneses.find({"paciente_id": pid}, {"_id": 0}).sort("created_at", -1).to_list(10)
    consultas = await db.consultations.find({"paciente_id": pid}, {"_id": 0}).sort("data_hora", -1).to_list(50)
    avals = await db.evaluations.find({"paciente_id": pid}, {"_id": 0}).sort("created_at", -1).to_list(50)
    plans = await db.meal_plans.find({"paciente_id": pid}, {"_id": 0}).sort("created_at", -1).to_list(20)
    analyses = await db.ai_analyses.find({"paciente_id": pid}, {"_id": 0}).sort("created_at", -1).to_list(10)
    exams = await db.exams.find({"paciente_id": pid}, {"_id": 0, "raw_text": 0}).sort("created_at", -1).to_list(50)
    recs = await db.recordatorios.find({"paciente_id": pid}, {"_id": 0}).sort("data", -1).to_list(50)
    anam_v2 = await db.anamneses.find_one({"paciente_id": pid}, {"_id": 0})
    return {"patient": p, "anamneses": anam, "anamnese_v2": anam_v2 or {},
            "consultations": consultas, "evaluations": avals, "meal_plans": plans,
            "ai_analyses": analyses, "exams": exams, "recordatorios": recs}

@api.post("/patients/{pid}/evaluations")
async def add_evaluation(pid: str, payload: EvaluationIn, user=Depends(get_current_user)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    comp = calc_bodycomp(payload.model_dump())
    eid = str(uuid.uuid4())
    doc = {
        "id": eid, "paciente_id": pid, **payload.model_dump(),
        "composicao": comp, "created_at": iso(now_utc()),
    }
    await db.evaluations.insert_one(doc)
    await db.patients.update_one({"id": pid}, {"$set": {
        "peso": payload.peso, "altura": payload.altura,
        "ultima_avaliacao": iso(now_utc()),
    }})
    return {"ok": True, "evaluation_id": eid, "composicao": comp}

@api.post("/patients/{pid}/analysis")
async def run_analysis(pid: str, user=Depends(get_current_user)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    anam = await db.anamneses.find_one({"paciente_id": pid}, {"_id": 0}, sort=[("created_at", -1)])
    avals = await db.evaluations.find_one({"paciente_id": pid}, {"_id": 0}, sort=[("created_at", -1)])
    if not anam:
        raise HTTPException(400, "Paciente sem anamnese")
    try:
        text = await ai_clinical_analysis(anam.get("respostas", {}), avals.get("composicao") if avals else None)
    except Exception as e:
        logging.exception("AI analysis failed")
        raise HTTPException(503, f"Falha ao gerar análise (IA indisponível): {str(e)[:120]}")
    aid = str(uuid.uuid4())
    doc = {"id": aid, "paciente_id": pid, "content": text, "created_at": iso(now_utc())}
    await db.ai_analyses.insert_one(doc)
    return {"id": aid, "content": text}

@api.post("/patients/{pid}/meal-plan")
async def gen_meal_plan(pid: str, payload: MealPlanRequest, user=Depends(get_current_user)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    avals = await db.evaluations.find_one({"paciente_id": pid}, {"_id": 0}, sort=[("created_at", -1)])
    if not avals:
        raise HTTPException(400, "Cadastre uma avaliação física antes de gerar o plano")
    comp = avals["composicao"]
    macros = calc_macros(comp["get_kcal"], payload.objetivo, avals["peso"], comp.get("massa_magra"))
    anam = await db.anamneses.find_one({"paciente_id": pid}, {"_id": 0}, sort=[("created_at", -1)])
    try:
        text = await ai_meal_plan(p, anam.get("respostas") if anam else {}, macros, payload.restricoes)
    except Exception as e:
        logging.exception("AI meal plan failed")
        raise HTTPException(503, f"Falha ao gerar plano (IA indisponível): {str(e)[:120]}")
    last = await db.meal_plans.find_one({"paciente_id": pid}, sort=[("version", -1)])
    version = (last["version"] + 1) if last else 1
    mid = str(uuid.uuid4())
    doc = {
        "id": mid, "paciente_id": pid, "kcal_total": macros["kcal"],
        "proteina_g": macros["proteina_g"], "carboidrato_g": macros["carboidrato_g"],
        "gordura_g": macros["gordura_g"], "ptn_pct": macros["ptn_pct"],
        "cho_pct": macros["cho_pct"], "lip_pct": macros["lip_pct"],
        "objetivo": payload.objetivo, "content": text,
        "version": version, "created_at": iso(now_utc()),
    }
    await db.meal_plans.insert_one(doc)
    await db.patients.update_one({"id": pid}, {"$set": {"status_funil": "PLANO_ENTREGUE"}})
    return {"id": mid, "macros": macros, "content": text, "version": version}

@api.get("/patients/{pid}/comparativo")
async def comparativo(pid: str, user=Depends(get_current_user)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    rows = await db.evaluations.find({"paciente_id": pid}, {"_id": 0}).sort("created_at", 1).to_list(50)
    return rows

@api.get("/agenda")
async def agenda(user=Depends(get_current_user)):
    rows = await db.consultations.find({"nutricionista_id": user["id"]}, {"_id": 0}).sort("data_hora", 1).to_list(200)
    # join patient name
    pids = list({r["paciente_id"] for r in rows})
    pats = await db.patients.find({"id": {"$in": pids}}, {"_id": 0, "id": 1, "nome": 1}).to_list(500)
    name_by = {p["id"]: p["nome"] for p in pats}
    for r in rows:
        r["paciente_nome"] = name_by.get(r["paciente_id"], "—")
    return rows

@api.post("/agenda", status_code=201)
async def create_consultation(payload: ConsultationCreateIn, user=Depends(require_nutritionist)):
    patient = await db.patients.find_one({"id": payload.paciente_id, "nutricionista_id": user["id"]})
    if not patient:
        raise HTTPException(404, "Paciente não encontrado")
    data_hora = _consultation_datetime(payload.date, payload.time)
    if await db.consultations.find_one({
        "nutricionista_id": user["id"], "data_hora": data_hora, "status": {"$ne": "CANCELADA"}
    }):
        raise HTTPException(409, "Já existe uma consulta neste horário")
    doc = {
        "id": str(uuid.uuid4()),
        "paciente_id": payload.paciente_id,
        "nutricionista_id": user["id"],
        "data_hora": data_hora,
        "tipo": payload.tipo,
        "status": payload.status,
        "observacoes": payload.observacoes,
        "created_at": iso(now_utc()),
    }
    await db.consultations.insert_one(doc)
    if payload.status == "AGENDADA":
        await db.patients.update_one({"id": payload.paciente_id}, {"$set": {"status_funil": "CONSULTA_AGENDADA"}})
    return {**{k: v for k, v in doc.items() if k != "_id"}, "paciente_nome": patient.get("nome")}

@api.patch("/agenda/{cid}")
async def update_consultation(cid: str, payload: ConsultationUpdateIn, user=Depends(require_nutritionist)):
    consultation = await db.consultations.find_one({"id": cid, "nutricionista_id": user["id"]})
    if not consultation:
        raise HTTPException(404, "Consulta não encontrada")
    updates = payload.model_dump(exclude_unset=True)
    date_value = updates.pop("date", None)
    time_value = updates.pop("time", None)
    if date_value is not None or time_value is not None:
        current_date, current_time = consultation["data_hora"].split("T", 1)
        data_hora = _consultation_datetime(date_value or current_date, time_value or current_time[:5])
        conflict = await db.consultations.find_one({
            "id": {"$ne": cid}, "nutricionista_id": user["id"],
            "data_hora": data_hora, "status": {"$ne": "CANCELADA"},
        })
        if conflict:
            raise HTTPException(409, "Já existe uma consulta neste horário")
        updates["data_hora"] = data_hora
    updates["updated_at"] = iso(now_utc())
    await db.consultations.update_one({"id": cid}, {"$set": updates})
    updated = await db.consultations.find_one({"id": cid}, {"_id": 0})
    patient = await db.patients.find_one({"id": consultation["paciente_id"]}, {"_id": 0, "nome": 1})
    return {**updated, "paciente_nome": (patient or {}).get("nome", "—")}

@api.delete("/agenda/{cid}")
async def delete_consultation(cid: str, user=Depends(require_nutritionist)):
    result = await db.consultations.delete_one({"id": cid, "nutricionista_id": user["id"]})
    if result.deleted_count == 0:
        raise HTTPException(404, "Consulta não encontrada")
    return {"ok": True}

# ---------- Lab Exams ----------
@api.post("/patients/{pid}/exams")
async def upload_exam(pid: str, file: UploadFile = File(...), user=Depends(get_current_user)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(400, "Envie um arquivo PDF")
    contents = await file.read()
    if len(contents) > 10 * 1024 * 1024:
        raise HTTPException(400, "Arquivo maior que 10MB")
    # extract text
    try:
        with pdfplumber.open(io.BytesIO(contents)) as pdf:
            raw = "\n".join((page.extract_text() or "") for page in pdf.pages)
    except Exception as e:
        raise HTTPException(400, f"Não foi possível ler o PDF: {str(e)[:120]}")
    if not raw.strip():
        raise HTTPException(400, "O PDF parece estar vazio ou ilegível (possivelmente uma imagem digitalizada).")

    try:
        analysis = await ai_exam_analysis(raw)
    except Exception as e:
        logging.exception("AI exam analysis failed")
        raise HTTPException(503, f"Falha ao analisar exame (IA indisponível): {str(e)[:120]}")

    eid = str(uuid.uuid4())
    doc = {
        "id": eid, "paciente_id": pid, "file_name": file.filename,
        "raw_text": raw[:6000], "markers": analysis.get("markers", []),
        "resumo": analysis.get("resumo", ""), "conduta_sugerida": analysis.get("conduta_sugerida", ""),
        "observacoes": "", "created_at": iso(now_utc()),
    }
    await db.exams.insert_one(doc)
    out = {k: v for k, v in doc.items() if k not in ("raw_text", "_id")}
    return out

@api.get("/patients/{pid}/exams")
async def list_exams(pid: str, user=Depends(get_current_user)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    rows = await db.exams.find({"paciente_id": pid}, {"_id": 0, "raw_text": 0}).sort("created_at", -1).to_list(50)
    return rows

@api.delete("/patients/{pid}/exams/{eid}")
async def delete_exam(pid: str, eid: str, user=Depends(get_current_user)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    await db.exams.delete_one({"id": eid, "paciente_id": pid})
    return {"ok": True}

@api.patch("/patients/{pid}/exams/{eid}")
async def update_exam_notes(pid: str, eid: str, payload: dict, user=Depends(get_current_user)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    obs = (payload or {}).get("observacoes", "")
    await db.exams.update_one({"id": eid, "paciente_id": pid}, {"$set": {"observacoes": obs}})
    return {"ok": True}

# ---------- PDF generation (meal plan) ----------
def _md_to_html(md: str) -> str:
    """Tiny markdown→html for meal plan content (headings, bold, bullets, line breaks)."""
    import re
    if not md:
        return ""
    lines = md.split("\n")
    out = []
    in_ul = False
    for ln in lines:
        s = ln.rstrip()
        if not s.strip():
            if in_ul:
                out.append("</ul>"); in_ul = False
            out.append("")
            continue
        if s.startswith("### "):
            if in_ul: out.append("</ul>"); in_ul = False
            out.append(f"<h4>{s[4:]}</h4>")
        elif s.startswith("## "):
            if in_ul: out.append("</ul>"); in_ul = False
            out.append(f"<h3>{s[3:]}</h3>")
        elif s.startswith("# "):
            if in_ul: out.append("</ul>"); in_ul = False
            out.append(f"<h2>{s[2:]}</h2>")
        elif s.lstrip().startswith(("- ", "• ", "* ")):
            if not in_ul: out.append("<ul>"); in_ul = True
            content = s.lstrip()[2:]
            out.append(f"<li>{content}</li>")
        else:
            if in_ul: out.append("</ul>"); in_ul = False
            out.append(f"<p>{s}</p>")
    if in_ul: out.append("</ul>")
    html = "\n".join(out)
    html = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", html)
    html = re.sub(r"\*(.+?)\*", r"<em>\1</em>", html)
    return html

@api.get("/patients/{pid}/meal-plan/{plan_id}/pdf")
async def meal_plan_pdf(pid: str, plan_id: str, user=Depends(get_current_user)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    plan = await db.meal_plans.find_one({"id": plan_id, "paciente_id": pid}, {"_id": 0})
    if not plan:
        raise HTTPException(404, "Plano não encontrado")

    nutri = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})
    body_html = _md_to_html(plan.get("content", ""))
    issued = datetime.fromisoformat(plan["created_at"]).strftime("%d/%m/%Y")

    html_doc = f"""<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Plano Alimentar — Rogério Costa</title></head>
<body>
  <header class="brand">
    <div class="logo">
      <span class="logo-mark">P</span>
      <div>
        <div class="brand-name">ROGÉRIO COSTA</div>
        <div class="brand-sub">Treinador & Nutricionista · Plano alimentar personalizado</div>
      </div>
    </div>
    <div class="meta">
      <div><strong>Profissional</strong>{nutri.get('name','—')}</div>
      <div><strong>Data</strong>{issued}</div>
      <div><strong>Versão</strong>v{plan.get('version', 1)}</div>
    </div>
  </header>

  <section class="patient">
    <h1>{p.get('nome','Paciente')}</h1>
    <p class="muted">{p.get('telefone','')}{(' · ' + p.get('email','')) if p.get('email') else ''}</p>
  </section>

  <section class="kpis">
    <div class="kpi kpi-primary"><div class="lbl">Calorias / dia</div><div class="val">{plan.get('kcal_total','—')} <span>kcal</span></div></div>
    <div class="kpi"><div class="lbl">Proteína</div><div class="val">{plan.get('proteina_g','—')}g <span>· {plan.get('ptn_pct','—')}%</span></div></div>
    <div class="kpi"><div class="lbl">Carboidrato</div><div class="val">{plan.get('carboidrato_g','—')}g <span>· {plan.get('cho_pct','—')}%</span></div></div>
    <div class="kpi"><div class="lbl">Gordura</div><div class="val">{plan.get('gordura_g','—')}g <span>· {plan.get('lip_pct','—')}%</span></div></div>
  </section>

  <section class="content">
    {body_html}
  </section>

  <footer>
    <div>ROGÉRIO COSTA · Treinador e Nutricionista</div>
    <div>Documento gerado automaticamente — revise com seu nutricionista.</div>
  </footer>
</body></html>"""

    css = CSS(string="""
      @page { size: A4; margin: 18mm 16mm 22mm 16mm; }
      * { box-sizing: border-box; }
      body { font-family: 'Helvetica', 'Arial', sans-serif; color: #000000; font-size: 11pt; }
      header.brand { display: flex; justify-content: space-between; align-items: center; padding-bottom: 14px; border-bottom: 3px solid #0081FD; margin-bottom: 18px; }
      .logo { display: flex; align-items: center; gap: 12px; }
      .logo-mark { width: 42px; height: 42px; border-radius: 50%; background: #0081FD; color: #000; display: inline-flex; align-items: center; justify-content: center; font-weight: 900; font-size: 22pt; font-family: 'Arial Black', sans-serif; letter-spacing: -1px; }
      .brand-name { font-size: 16pt; font-weight: 900; color: #000000; letter-spacing: 1px; }
      .brand-sub { font-size: 8.5pt; color: #555; letter-spacing: 0.5px; }
      header .meta { font-size: 9pt; text-align: right; color: #333; }
      header .meta div { margin-bottom: 2px; }
      header .meta strong { display: block; color: #888; font-size: 8pt; text-transform: uppercase; letter-spacing: 1px; }
      .patient h1 { font-size: 22pt; margin: 0 0 4px 0; color: #000; font-weight: 800; }
      .patient .muted { color: #666; margin: 0 0 16px 0; }
      .kpis { display: flex; gap: 8px; margin-bottom: 22px; }
      .kpi { flex: 1; background: #F5F8FB; border-radius: 10px; padding: 12px 14px; border: 1px solid #E3E9F0; }
      .kpi-primary { background: linear-gradient(135deg, #0081FD15, #0081FD08); border: 1px solid #0081FD66; }
      .kpi .lbl { font-size: 8pt; text-transform: uppercase; letter-spacing: 1px; color: #777; margin-bottom: 4px; }
      .kpi .val { font-size: 16pt; font-weight: 800; color: #000; }
      .kpi .val span { font-size: 9pt; color: #777; font-weight: 500; }
      .content h2 { font-size: 14pt; color: #0081FD; border-bottom: 1px solid #E3E9F0; padding-bottom: 4px; margin-top: 18px; text-transform: uppercase; letter-spacing: 0.5px; }
      .content h3 { font-size: 12pt; color: #000; margin-top: 14px; margin-bottom: 4px; font-weight: 700; }
      .content h4 { font-size: 11pt; color: #0081FD; margin-top: 10px; margin-bottom: 2px; font-weight: 700; }
      .content p { margin: 6px 0; line-height: 1.5; }
      .content ul { padding-left: 18px; margin: 6px 0; }
      .content li { margin: 3px 0; line-height: 1.45; }
      footer { position: fixed; bottom: -12mm; left: 0; right: 0; font-size: 8pt; color: #888; display: flex; justify-content: space-between; padding-top: 6px; border-top: 1px solid #E3E9F0; }
    """)

    pdf_bytes = HTML(string=html_doc).write_pdf(stylesheets=[css])
    safe_name = (p.get("nome") or "paciente").lower().replace(" ", "-")
    headers = {"Content-Disposition": f'attachment; filename="rogerio-costa-plano-{safe_name}-v{plan.get("version", 1)}.pdf"'}
    return StreamingResponse(io.BytesIO(pdf_bytes), media_type="application/pdf", headers=headers)

# ---------- Agentes (treináveis pelo nutricionista) ----------
def _agent_view(a: dict) -> dict:
    return {
        "id": a.get("id"),
        "code": a.get("code"),
        "name": a.get("name"),
        "description": a.get("description"),
        "base_prompt": a.get("base_prompt", ""),
        "created_at": a.get("created_at"),
        "updated_at": a.get("updated_at"),
    }

@api.get("/agents")
async def list_agents(user=Depends(require_nutritionist)):
    await ensure_agents_seeded()
    rows = await db.agents.find({}, {"_id": 0}).sort("code", 1).to_list(10)
    out = []
    for a in rows:
        cnt = await db.agent_documents.count_documents({"agent_code": a["code"]})
        view = _agent_view(a)
        view["documents_count"] = cnt
        out.append(view)
    return out

@api.get("/agents/{code}")
async def get_agent(code: str, user=Depends(require_nutritionist)):
    if code not in AGENT_CODES:
        raise HTTPException(404, "Agente desconhecido")
    await ensure_agents_seeded()
    a = await db.agents.find_one({"code": code}, {"_id": 0})
    if not a:
        raise HTTPException(404, "Agente não encontrado")
    docs = await db.agent_documents.find(
        {"agent_code": code}, {"_id": 0, "content": 0}
    ).sort("created_at", 1).to_list(100)
    full_prompt = await build_agent_system_prompt(code)
    view = _agent_view(a)
    view["documents"] = docs
    view["prompt_chars"] = len(full_prompt)
    view["prompt_max_chars"] = AGENT_PROMPT_MAX_CHARS
    return view

@api.patch("/agents/{code}")
async def update_agent_prompt(code: str, payload: AgentPromptUpdate, user=Depends(require_nutritionist)):
    if code not in AGENT_CODES:
        raise HTTPException(404, "Agente desconhecido")
    await ensure_agents_seeded()
    await db.agents.update_one(
        {"code": code},
        {"$set": {"base_prompt": payload.base_prompt, "updated_at": iso(now_utc())}},
    )
    a = await db.agents.find_one({"code": code}, {"_id": 0})
    return _agent_view(a)

@api.post("/agents/{code}/documents")
async def upload_agent_document(
    code: str,
    file: Optional[UploadFile] = File(None),
    title: Optional[str] = Query(None),
    user=Depends(require_nutritionist),
):
    if code not in AGENT_CODES:
        raise HTTPException(404, "Agente desconhecido")
    if not file:
        raise HTTPException(400, "Arquivo é obrigatório")
    raw = await file.read()
    if len(raw) > 15 * 1024 * 1024:
        raise HTTPException(400, "Arquivo maior que 15MB")
    text = extract_text_from_upload(file.filename or "doc", file.content_type or "", raw)
    if not text.strip():
        raise HTTPException(400, "Não foi possível extrair texto do arquivo enviado")
    # cap each doc at 200k chars to keep mongo doc small; truncated content still useful
    text = text[:200_000]
    did = str(uuid.uuid4())
    doc = {
        "id": did, "agent_code": code,
        "title": title or file.filename or "documento",
        "filename": file.filename, "content_type": file.content_type,
        "size": len(raw), "chars": len(text), "content": text,
        "created_at": iso(now_utc()),
    }
    await db.agent_documents.insert_one(doc)
    return {k: v for k, v in doc.items() if k not in ("content", "_id")}

@api.post("/agents/{code}/documents/text")
async def add_agent_text_document(code: str, payload: AgentDocCreate, user=Depends(require_nutritionist)):
    if code not in AGENT_CODES:
        raise HTTPException(404, "Agente desconhecido")
    text = (payload.content or "").strip()
    if not text:
        raise HTTPException(400, "Conteúdo vazio")
    text = text[:200_000]
    did = str(uuid.uuid4())
    doc = {
        "id": did, "agent_code": code, "title": (payload.title or "Texto manual")[:200],
        "filename": None, "content_type": "text/plain",
        "size": len(text.encode("utf-8")), "chars": len(text), "content": text,
        "created_at": iso(now_utc()),
    }
    await db.agent_documents.insert_one(doc)
    return {k: v for k, v in doc.items() if k not in ("content", "_id")}

@api.delete("/agents/{code}/documents/{doc_id}")
async def delete_agent_document(code: str, doc_id: str, user=Depends(require_nutritionist)):
    if code not in AGENT_CODES:
        raise HTTPException(404, "Agente desconhecido")
    res = await db.agent_documents.delete_one({"id": doc_id, "agent_code": code})
    if res.deleted_count == 0:
        raise HTTPException(404, "Documento não encontrado")
    return {"ok": True}

# ---------- Consultório (Agente 2, uso interno do nutricionista) ----------
@api.get("/consultorio/patients")
async def consultorio_list_patients(user=Depends(require_nutritionist)):
    """Lightweight list for the patient selector on the consultório page."""
    rows = await db.patients.find(
        {"nutricionista_id": user["id"]},
        {"_id": 0, "id": 1, "nome": 1, "email": 1, "status_funil": 1},
    ).sort("nome", 1).to_list(500)
    return rows

@api.post("/consultorio/chat")
async def consultorio_chat(payload: ConsultorioChatIn, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": payload.patient_id, "nutricionista_id": user["id"]}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    session_id = payload.session_id or f"{user['id']}-{payload.patient_id}"
    # Build patient context (anamnese mais recente, última avaliação, exames recentes)
    anam = await db.anamneses.find_one({"paciente_id": p["id"]}, {"_id": 0}, sort=[("created_at", -1)])
    aval = await db.evaluations.find_one({"paciente_id": p["id"]}, {"_id": 0}, sort=[("created_at", -1)])
    exams = await db.exams.find(
        {"paciente_id": p["id"]}, {"_id": 0, "raw_text": 0, "content": 0}
    ).sort("created_at", -1).to_list(5)
    plan = await db.meal_plans.find_one({"paciente_id": p["id"]}, {"_id": 0}, sort=[("version", -1)])
    patient_ctx = {
        "nome": p.get("nome"), "sexo": p.get("sexo"),
        "peso": p.get("peso"), "altura": p.get("altura"),
        "data_nascimento": p.get("data_nascimento"),
        "objetivo": p.get("objetivo"),
        "anamnese": (anam or {}).get("respostas"),
        "avaliacao": (aval or {}).get("composicao"),
        "exames_recentes": exams,
        "plano_alimentar_ativo": (plan or {}).get("content"),
    }
    # Persist & load chat history
    history = await db.consultorio_messages.find(
        {"session_id": session_id}, {"_id": 0}
    ).sort("created_at", 1).to_list(50)
    user_msg = {
        "id": str(uuid.uuid4()), "session_id": session_id, "nutricionista_id": user["id"],
        "patient_id": p["id"], "role": "user", "content": payload.message,
        "created_at": iso(now_utc()),
    }
    await db.consultorio_messages.insert_one(user_msg)
    try:
        ai_text = await ai_consultorio_chat(session_id, payload.message, patient_ctx, history)
    except Exception as e:
        logging.exception("Consultorio chat failed")
        raise HTTPException(503, f"Falha no chat (IA indisponível): {str(e)[:140]}")
    ai_msg = {
        "id": str(uuid.uuid4()), "session_id": session_id, "nutricionista_id": user["id"],
        "patient_id": p["id"], "role": "assistant", "content": ai_text,
        "created_at": iso(now_utc()),
    }
    await db.consultorio_messages.insert_one(ai_msg)
    return {"reply": ai_text, "session_id": session_id}

@api.get("/consultorio/chat/{patient_id}")
async def consultorio_chat_history(patient_id: str, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": patient_id, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    session_id = f"{user['id']}-{patient_id}"
    msgs = await db.consultorio_messages.find(
        {"session_id": session_id}, {"_id": 0}
    ).sort("created_at", 1).to_list(200)
    return msgs

# ---------- Patient signup (final da pré-consulta) ----------
@api.post("/patient/signup", response_model=UserOut)
async def patient_signup(payload: PatientSignupIn, response: Response):
    p = await db.patients.find_one({"lead_token": payload.token})
    if not p:
        raise HTTPException(404, "Lead não encontrado")
    email = (p.get("email") or "").lower().strip()
    if not email:
        raise HTTPException(400, "E-mail do paciente não cadastrado na pré-consulta")
    existing = await db.users.find_one({"email": email})
    if existing:
        # If patient account already exists, just log them in by checking password? No — for security
        # require the user to log in via /auth/login. Block re-signup.
        raise HTTPException(400, "Já existe uma conta com este e-mail. Faça login.")
    uid = str(uuid.uuid4())
    doc = {
        "id": uid, "email": email, "name": p.get("nome") or email,
        "password_hash": hash_password(payload.password),
        "role": "patient", "patient_id": p["id"],
        "nutricionista_id": p.get("nutricionista_id"),
        "created_at": iso(now_utc()),
    }
    await db.users.insert_one(doc)
    # Link the user_id back to patient (so nutritionist sees account linked)
    await db.patients.update_one({"id": p["id"]}, {"$set": {"user_id": uid, "has_account": True}})
    set_auth_cookie(response, create_token(uid, email))
    return UserOut(id=uid, email=email, name=doc["name"], role="patient")

# ---------- Área do paciente (Agente 3) ----------
def _patient_summary(p: dict) -> dict:
    keys = ["id", "nome", "email", "telefone", "peso", "altura", "objetivo", "sexo", "data_nascimento"]
    return {k: p.get(k) for k in keys}

@api.get("/patient/me")
async def patient_me(user=Depends(require_patient)):
    p = await db.patients.find_one({"id": user.get("patient_id")}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    return {"user": {"id": user["id"], "email": user["email"], "name": user["name"], "role": "patient"},
            "patient": _patient_summary(p)}

@api.get("/patient/diet")
async def patient_diet(user=Depends(require_patient)):
    pid = user.get("patient_id")
    plan = await db.meal_plans.find_one({"paciente_id": pid}, {"_id": 0}, sort=[("version", -1)])
    if not plan:
        return {"plan": None}
    return {"plan": plan}

@api.get("/patient/chat")
async def patient_chat_history(user=Depends(require_patient)):
    session_id = f"patient-{user['id']}"
    pid = user.get("patient_id")
    # Include both: current user's session AND any "pending" proactive nudges fired
    # before the patient had an account (session_id=patient-pending-{patient_id})
    msgs = await db.patient_messages.find(
        {"$or": [
            {"session_id": session_id},
            {"session_id": f"patient-pending-{pid}"},
        ]},
        {"_id": 0},
    ).sort("created_at", 1).to_list(500)
    return msgs

@api.post("/patient/chat")
async def patient_chat(payload: PatientChatIn, user=Depends(require_patient)):
    pid = user.get("patient_id")
    session_id = payload.session_id or f"patient-{user['id']}"
    # Context: plano ativo + dados-chave
    plan = await db.meal_plans.find_one({"paciente_id": pid}, {"_id": 0}, sort=[("version", -1)])
    p = await db.patients.find_one({"id": pid}, {"_id": 0}) or {}
    patient_ctx = {
        "nome": p.get("nome"), "objetivo": p.get("objetivo"),
        "peso": p.get("peso"), "altura": p.get("altura"),
        "plano_alimentar": (plan or {}).get("content"),
        "kcal": (plan or {}).get("kcal_total"),
        "macros": {
            "proteina_g": (plan or {}).get("proteina_g"),
            "carboidrato_g": (plan or {}).get("carboidrato_g"),
            "gordura_g": (plan or {}).get("gordura_g"),
        } if plan else None,
    }
    history = await db.patient_messages.find(
        {"session_id": session_id}, {"_id": 0}
    ).sort("created_at", 1).to_list(50)
    user_msg = {
        "id": str(uuid.uuid4()), "session_id": session_id, "user_id": user["id"],
        "patient_id": pid, "role": "user", "content": payload.message,
        "created_at": iso(now_utc()),
    }
    await db.patient_messages.insert_one(user_msg)
    try:
        ai_text = await ai_patient_chat(session_id, payload.message, patient_ctx, history)
    except Exception as e:
        logging.exception("Patient chat failed")
        raise HTTPException(503, f"Falha no chat (IA indisponível): {str(e)[:140]}")
    ai_msg = {
        "id": str(uuid.uuid4()), "session_id": session_id, "user_id": user["id"],
        "patient_id": pid, "role": "assistant", "content": ai_text,
        "created_at": iso(now_utc()),
    }
    await db.patient_messages.insert_one(ai_msg)
    return {"reply": ai_text, "session_id": session_id}

# ---------- Nudges (Agente 3 pró-ativo) ----------
def _nudge_view(n: dict) -> dict:
    return {
        "id": n.get("id"),
        "patient_id": n.get("patient_id"),
        "label": n.get("label"),
        "trigger_text": n.get("trigger_text"),
        "hour": n.get("hour"),
        "minute": n.get("minute"),
        "weekdays": n.get("weekdays"),
        "active": n.get("active", True),
        "last_fired_at": n.get("last_fired_at"),
        "next_run_at": n.get("next_run_at"),
        "created_at": n.get("created_at"),
    }

def _compute_next_run(hour: int, minute: int, weekdays: Optional[List[int]], from_dt: Optional[datetime] = None) -> datetime:
    """Compute next firing in America/Sao_Paulo timezone. Returns aware UTC datetime."""
    base = (from_dt or now_utc()).astimezone(TZ_BR)
    candidate = base.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if candidate <= base:
        candidate = candidate + timedelta(days=1)
    # Bump until weekday matches (max 7 iterations)
    if weekdays:
        wd_set = set(weekdays)
        for _ in range(8):
            if candidate.weekday() in wd_set:
                break
            candidate = candidate + timedelta(days=1)
    return candidate.astimezone(timezone.utc)

async def _patient_context_for_nudge(patient_id: str) -> dict:
    p = await db.patients.find_one({"id": patient_id}, {"_id": 0}) or {}
    plan = await db.meal_plans.find_one({"paciente_id": patient_id}, {"_id": 0}, sort=[("version", -1)])
    return {
        "nome": p.get("nome"), "objetivo": p.get("objetivo"),
        "peso": p.get("peso"), "altura": p.get("altura"),
        "plano_alimentar": (plan or {}).get("content"),
        "kcal": (plan or {}).get("kcal_total"),
    }

async def _fire_nudge(nudge: dict) -> Optional[str]:
    """Generate proactive message via Agent 3 and persist to patient_messages.
    Returns the message content (or None if failed)."""
    pid = nudge["patient_id"]
    # Locate the patient's user account (role=patient) to write into THEIR session_id
    pu = await db.users.find_one({"role": "patient", "patient_id": pid}, {"_id": 0})
    if not pu:
        # Patient hasn't signed up yet — store message anyway tied to patient_id
        session_id = f"patient-pending-{pid}"
    else:
        session_id = f"patient-{pu['id']}"
    ctx = await _patient_context_for_nudge(pid)
    try:
        text = await ai_patient_proactive(session_id, nudge["trigger_text"], ctx)
    except Exception as e:
        logging.exception(f"Nudge fire failed for {nudge.get('id')}: {e}")
        return None
    msg = {
        "id": str(uuid.uuid4()), "session_id": session_id,
        "user_id": (pu or {}).get("id"), "patient_id": pid,
        "role": "assistant", "content": text,
        "kind": "proactive", "nudge_id": nudge.get("id"),
        "created_at": iso(now_utc()),
    }
    await db.patient_messages.insert_one(msg)
    return text

@api.get("/patients/{pid}/nudges")
async def list_nudges(pid: str, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    rows = await db.patient_nudges.find(
        {"patient_id": pid}, {"_id": 0}
    ).sort("created_at", 1).to_list(50)
    return [_nudge_view(n) for n in rows]

@api.post("/patients/{pid}/nudges")
async def create_nudge(pid: str, payload: NudgeIn, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    nid = str(uuid.uuid4())
    next_run = _compute_next_run(payload.hour, payload.minute, payload.weekdays)
    doc = {
        "id": nid, "patient_id": pid, "nutricionista_id": user["id"],
        "label": payload.label[:120], "trigger_text": payload.trigger_text[:1000],
        "hour": payload.hour, "minute": payload.minute, "weekdays": payload.weekdays,
        "active": payload.active, "last_fired_at": None,
        "next_run_at": iso(next_run), "created_at": iso(now_utc()),
    }
    await db.patient_nudges.insert_one(doc)
    return _nudge_view(doc)

@api.patch("/patients/{pid}/nudges/{nid}")
async def update_nudge(pid: str, nid: str, payload: NudgeUpdate, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    existing = await db.patient_nudges.find_one({"id": nid, "patient_id": pid}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Lembrete não encontrado")
    upd = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if any(k in upd for k in ("hour", "minute", "weekdays")) or upd.get("active") is True:
        hour = upd.get("hour", existing["hour"])
        minute = upd.get("minute", existing["minute"])
        weekdays = upd.get("weekdays", existing.get("weekdays"))
        upd["next_run_at"] = iso(_compute_next_run(hour, minute, weekdays))
    await db.patient_nudges.update_one({"id": nid}, {"$set": upd})
    updated = await db.patient_nudges.find_one({"id": nid}, {"_id": 0})
    return _nudge_view(updated)

@api.delete("/patients/{pid}/nudges/{nid}")
async def delete_nudge(pid: str, nid: str, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    res = await db.patient_nudges.delete_one({"id": nid, "patient_id": pid})
    if res.deleted_count == 0:
        raise HTTPException(404, "Lembrete não encontrado")
    return {"ok": True}

@api.post("/patients/{pid}/nudges/{nid}/run-now")
async def run_nudge_now(pid: str, nid: str, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    nudge = await db.patient_nudges.find_one({"id": nid, "patient_id": pid}, {"_id": 0})
    if not nudge:
        raise HTTPException(404, "Lembrete não encontrado")
    text = await _fire_nudge(nudge)
    if text is None:
        raise HTTPException(503, "Falha ao gerar mensagem (IA indisponível)")
    now = now_utc()
    await db.patient_nudges.update_one(
        {"id": nid},
        {"$set": {
            "last_fired_at": iso(now),
            "next_run_at": iso(_compute_next_run(nudge["hour"], nudge["minute"], nudge.get("weekdays"), from_dt=now)),
        }},
    )
    return {"ok": True, "message": text}

# ─── DEPOIMENTOS (Testimonials) ──────────────────────────────────────────────

import base64 as _base64

class TestimonialIn(BaseModel):
    name: str
    stars: int = 5
    phrase: str
    quote: str
    active: bool = True
    order: int = 0

@api.get("/public/testimonials")
async def list_public_testimonials():
    rows = await db.testimonials.find(
        {"active": True}, {"_id": 0, "photo_data_url": 0}
    ).sort("order", 1).to_list(50)
    return rows

@api.get("/public/testimonials/{tid}/photo")
async def get_testimonial_photo(tid: str):
    t = await db.testimonials.find_one({"id": tid}, {"_id": 0, "photo_data_url": 1})
    if not t or not t.get("photo_data_url"):
        raise HTTPException(404, "Foto não encontrada")
    data_url = t["photo_data_url"]
    try:
        header, b64 = data_url.split(",", 1)
        content_type = header.split(":")[1].split(";")[0]
        content = _base64.b64decode(b64)
    except Exception:
        raise HTTPException(400, "Dados de imagem inválidos")
    return Response(content=content, media_type=content_type)

@api.get("/testimonials")
async def list_all_testimonials(user=Depends(require_nutritionist)):
    rows = await db.testimonials.find(
        {"nutricionista_id": user["id"]}, {"_id": 0, "photo_data_url": 0}
    ).sort("order", 1).to_list(100)
    return rows

@api.post("/testimonials")
async def create_testimonial(payload: TestimonialIn, user=Depends(require_nutritionist)):
    tid = str(uuid.uuid4())
    doc = {
        "id": tid,
        "nutricionista_id": user["id"],
        "name": payload.name,
        "stars": max(1, min(5, payload.stars)),
        "phrase": payload.phrase,
        "quote": payload.quote,
        "photo_data_url": None,
        "active": payload.active,
        "order": payload.order,
        "created_at": iso(now_utc()),
    }
    await db.testimonials.insert_one(doc)
    return {k: v for k, v in doc.items() if k not in ("_id", "photo_data_url")}

@api.post("/testimonials/{tid}/photo")
async def upload_testimonial_photo(tid: str, file: UploadFile = File(...), user=Depends(require_nutritionist)):
    t = await db.testimonials.find_one({"id": tid, "nutricionista_id": user["id"]})
    if not t:
        raise HTTPException(404, "Depoimento não encontrado")
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(400, "Envie uma imagem (JPG, PNG, etc.)")
    contents = await file.read()
    if len(contents) > 3 * 1024 * 1024:
        raise HTTPException(400, "Imagem maior que 3MB")
    b64 = _base64.b64encode(contents).decode()
    data_url = f"data:{file.content_type};base64,{b64}"
    await db.testimonials.update_one({"id": tid}, {"$set": {"photo_data_url": data_url}})
    return {"ok": True, "photo_url": f"/api/public/testimonials/{tid}/photo"}

@api.patch("/testimonials/{tid}")
async def update_testimonial(tid: str, payload: dict, user=Depends(require_nutritionist)):
    t = await db.testimonials.find_one({"id": tid, "nutricionista_id": user["id"]})
    if not t:
        raise HTTPException(404, "Depoimento não encontrado")
    allowed = {"name", "stars", "phrase", "quote", "active", "order"}
    updates = {k: v for k, v in (payload or {}).items() if k in allowed}
    if updates:
        await db.testimonials.update_one({"id": tid}, {"$set": updates})
    return {"ok": True}

@api.delete("/testimonials/{tid}")
async def delete_testimonial(tid: str, user=Depends(require_nutritionist)):
    t = await db.testimonials.find_one({"id": tid, "nutricionista_id": user["id"]})
    if not t:
        raise HTTPException(404, "Depoimento não encontrado")
    await db.testimonials.delete_one({"id": tid})
    return {"ok": True}

# Patient: list own exams
@api.get("/patient/exams")
async def patient_exams(user=Depends(require_patient)):
    pid = user.get("patient_id")
    rows = await db.exams.find(
        {"paciente_id": pid}, {"_id": 0, "raw_text": 0}
    ).sort("created_at", -1).to_list(30)
    return rows

# Background scheduler — checks every 60s for due nudges
_scheduler_task = None

async def nudge_scheduler_loop():
    logging.info("Nudge scheduler started")
    while True:
        try:
            now = now_utc()
            cursor = db.patient_nudges.find({
                "active": True,
                "next_run_at": {"$lte": iso(now)},
            }, {"_id": 0}).limit(20)
            due = await cursor.to_list(20)
            for nudge in due:
                # Re-check weekday in BRT (next_run_at already accounts for it but be safe)
                local_now = now.astimezone(TZ_BR)
                if nudge.get("weekdays") and local_now.weekday() not in set(nudge["weekdays"]):
                    # reschedule without firing
                    nxt = _compute_next_run(nudge["hour"], nudge["minute"], nudge.get("weekdays"), from_dt=now)
                    await db.patient_nudges.update_one({"id": nudge["id"]}, {"$set": {"next_run_at": iso(nxt)}})
                    continue
                logging.info(f"Firing nudge {nudge['id']} for patient {nudge['patient_id']}")
                text = await _fire_nudge(nudge)
                next_run = _compute_next_run(nudge["hour"], nudge["minute"], nudge.get("weekdays"), from_dt=now)
                await db.patient_nudges.update_one(
                    {"id": nudge["id"]},
                    {"$set": {
                        "last_fired_at": iso(now) if text else nudge.get("last_fired_at"),
                        "next_run_at": iso(next_run),
                    }},
                )
        except Exception:
            logging.exception("nudge_scheduler_loop error")
        await asyncio.sleep(60)

# ================================================================
# MOTOR CLÍNICO COMPLETO — RCTEAM-NUTRI SPEC v2.0
# ================================================================
import math as _math

# ── TMB protocols ────────────────────────────────────────────────

def _tmb_by_table(rows, idade, peso):
    for (mn, mx), fn in rows:
        if mn <= idade < mx:
            return round(fn(peso), 2)
    return round(rows[-1][1](peso), 2)

_FAO1985 = {
    1: [((0,3),lambda p:60.9*p-54),((3,10),lambda p:22.7*p+495),((10,18),lambda p:17.5*p+651),
        ((18,30),lambda p:15.3*p+679),((30,60),lambda p:11.6*p+879),((60,999),lambda p:13.5*p+487)],
    2: [((0,3),lambda p:61.0*p-51),((3,10),lambda p:22.5*p+499),((10,18),lambda p:12.2*p+746),
        ((18,30),lambda p:14.7*p+496),((30,60),lambda p:8.7*p+829),((60,999),lambda p:10.5*p+596)],
}
_FAO2004 = {
    1: [((0,3),lambda p:59.512*p-30.4),((3,10),lambda p:22.706*p+504.3),((10,18),lambda p:17.686*p+658.2),
        ((18,30),lambda p:15.057*p+692.2),((30,60),lambda p:11.472*p+873.1),((60,999),lambda p:11.711*p+587.7)],
    2: [((0,3),lambda p:58.317*p-31.1),((3,10),lambda p:20.315*p+485.9),((10,18),lambda p:13.384*p+692.6),
        ((18,30),lambda p:14.818*p+486.6),((30,60),lambda p:8.126*p+845.6),((60,999),lambda p:9.082*p+658.5)],
}

def _tmb_all(protocolo: str, peso: float, altura_cm: float, idade: int, sexo_num: int, mlg_kg: float = None) -> float:
    s = sexo_num
    if protocolo == "harris_benedict_1984":
        if s == 1: return round(88.362 + 13.397*peso + 4.799*altura_cm - 5.677*idade, 2)
        return round(447.593 + 9.247*peso + 3.098*altura_cm - 4.330*idade, 2)
    if protocolo == "harris_benedict_1919":
        if s == 1: return round(66.473 + 13.752*peso + 5.003*altura_cm - 6.755*idade, 2)
        return round(655.096 + 9.563*peso + 1.850*altura_cm - 4.676*idade, 2)
    if protocolo == "mifflin_st_jeor":
        base = 10*peso + 6.25*altura_cm - 5*idade
        return round(base + 5 if s == 1 else base - 161, 2)
    if protocolo == "fao_who_1985":
        return _tmb_by_table(_FAO1985.get(s, _FAO1985[1]), idade, peso)
    if protocolo == "fao_who_2004":
        return _tmb_by_table(_FAO2004.get(s, _FAO2004[1]), idade, peso)
    if protocolo == "cunningham":
        if mlg_kg is None: raise ValueError("Cunningham requer MLG (massa livre de gordura)")
        return round(500 + 22*mlg_kg, 2)
    if protocolo == "tinsley_peso":
        return round(24.8*peso + 10, 2)
    if protocolo == "tinsley_mlg":
        if mlg_kg is None: raise ValueError("Tinsley MLG requer MLG")
        return round(25.9*mlg_kg + 284, 2)
    raise ValueError(f"Protocolo desconhecido: {protocolo}")

PROTOCOLOS_TMB_DESCRICAO = {
    "harris_benedict_1984": "Harris-Benedict (1984)",
    "harris_benedict_1919": "Harris-Benedict (1919)",
    "mifflin_st_jeor": "Mifflin St Jeor",
    "fao_who_1985": "FAO/WHO (1985)",
    "fao_who_2004": "FAO/WHO (2004)",
    "cunningham": "Cunningham",
    "tinsley_peso": "Tinsley (por Peso)",
    "tinsley_mlg": "Tinsley (por MLG)",
}

# ── NAF tables ───────────────────────────────────────────────────

_NAF_PADRAO = {
    1: {1: 1.20, 2: 1.56, 3: 1.78, 4: 2.10},
    2: {1: 1.20, 2: 1.56, 3: 1.64, 4: 1.82},
}
_NAF_FAO2004 = {
    1: {1: 1.00, 2: 1.11, 3: 1.25, 4: 1.48},
    2: {1: 1.00, 2: 1.12, 3: 1.27, 4: 1.45},
}
_NAF_EER = {
    1: {1: 1.00, 2: 1.13, 3: 1.26, 4: 1.42},
    2: {1: 1.00, 2: 1.16, 3: 1.31, 4: 1.56},
}
_NAF_DESCRICAO = {
    1: "Sedentário",
    2: "Pouco ativo / Atividade leve",
    3: "Ativo / Atividade moderada",
    4: "Muito ativo / Atividade intensa",
}
_NAF_BY_PROTOCOLO = {
    "harris_benedict_1984": _NAF_PADRAO, "harris_benedict_1919": _NAF_PADRAO,
    "mifflin_st_jeor": _NAF_PADRAO, "fao_who_1985": _NAF_PADRAO,
    "fao_who_2004": _NAF_FAO2004, "schofield": _NAF_PADRAO,
    "henry_rees": _NAF_PADRAO, "cunningham": _NAF_PADRAO,
    "tinsley_peso": _NAF_PADRAO, "tinsley_mlg": _NAF_PADRAO,
    "eer_iom_2005": _NAF_EER,
}

# ── Fatores de Injúria ───────────────────────────────────────────

FATORES_INJURIA_TABLE = {
    1:  {"descricao": "Paciente não complicado", "fator": 1.00, "min": 1.00, "max": 1.00},
    2:  {"descricao": "Câncer", "fator": 1.275, "min": 1.10, "max": 1.45},
    3:  {"descricao": "Cirurgia eletiva", "fator": 1.05, "min": 1.00, "max": 1.10},
    4:  {"descricao": "Desnutrição grave", "fator": 1.50, "min": 1.50, "max": 1.50},
    5:  {"descricao": "Doença cardiopulmonar", "fator": 0.90, "min": 0.80, "max": 1.00},
    6:  {"descricao": "Doença cardiopulmonar c/ cirurgia", "fator": 1.425, "min": 1.30, "max": 1.55},
    7:  {"descricao": "Fratura", "fator": 1.20, "min": 1.20, "max": 1.20},
    8:  {"descricao": "Fraturas múltiplas", "fator": 1.275, "min": 1.20, "max": 1.35},
    9:  {"descricao": "Infecção grave", "fator": 1.325, "min": 1.30, "max": 1.35},
    10: {"descricao": "Insuficiência cardíaca", "fator": 1.40, "min": 1.30, "max": 1.50},
    11: {"descricao": "Insuficiência hepática", "fator": 1.425, "min": 1.30, "max": 1.55},
    12: {"descricao": "Insuficiência renal aguda", "fator": 1.30, "min": 1.30, "max": 1.30},
    13: {"descricao": "Jejum / inanição", "fator": 0.925, "min": 0.85, "max": 1.00},
    14: {"descricao": "Multitrauma (reabilitação)", "fator": 1.50, "min": 1.50, "max": 1.50},
    15: {"descricao": "Multitrauma + sepse", "fator": 1.60, "min": 1.60, "max": 1.60},
    16: {"descricao": "Pequena cirurgia", "fator": 1.20, "min": 1.20, "max": 1.20},
    17: {"descricao": "Pequeno trauma de tecido", "fator": 1.255, "min": 1.14, "max": 1.37},
    18: {"descricao": "Peritonite", "fator": 1.35, "min": 1.20, "max": 1.50},
    19: {"descricao": "PO cirurgia cardíaca", "fator": 1.35, "min": 1.20, "max": 1.50},
    20: {"descricao": "PO cirurgia geral", "fator": 1.25, "min": 1.00, "max": 1.50},
    21: {"descricao": "Pós-operatório", "fator": 1.10, "min": 1.10, "max": 1.10},
    22: {"descricao": "Queimadura 30-50%", "fator": 1.70, "min": 1.70, "max": 1.70},
    23: {"descricao": "Queimadura 50-70%", "fator": 1.80, "min": 1.80, "max": 1.80},
    24: {"descricao": "Queimadura 70-90%", "fator": 2.00, "min": 2.00, "max": 2.00},
    25: {"descricao": "Queimadura até 20%", "fator": 1.25, "min": 1.00, "max": 1.50},
    26: {"descricao": "Sepse", "fator": 1.45, "min": 1.10, "max": 1.80},
    27: {"descricao": "Transplante de fígado", "fator": 1.35, "min": 1.20, "max": 1.50},
}

# ── IMC classification by age group ─────────────────────────────

def _classif_imc_adulto(imc: float) -> str:
    if imc < 16.0: return "Magreza Grau III"
    if imc < 17.0: return "Magreza Grau II"
    if imc < 18.5: return "Magreza Grau I"
    if imc < 25.0: return "Eutrofia"
    if imc < 30.0: return "Sobrepeso"
    if imc < 35.0: return "Obesidade Grau I"
    if imc < 40.0: return "Obesidade Grau II"
    return "Obesidade Grau III"

def _classif_imc_idoso(imc: float, ref: str = "lipschitz_1994") -> str:
    tabelas = {
        "lipschitz_1994": [(22.0,"Magreza"),(27.0,"Eutrofia"),(999,"Sobrepeso")],
        "perisinoto_2002": [(20.0,"Magreza"),(30.0,"Eutrofia"),(999,"Sobrepeso")],
        "sabe_opas_oms":   [(23.0,"Magreza"),(28.0,"Eutrofia"),(30.0,"Sobrepeso"),(999,"Obesidade")],
    }
    rows = tabelas.get(ref, tabelas["lipschitz_1994"])
    for lim, label in rows:
        if imc < lim: return label
    return rows[-1][1]

_ATALAH = [
    (6,19.99,24.99,30.09),(8,20.19,25.09,30.19),(10,20.29,25.29,30.29),(11,20.39,25.39,30.39),
    (12,20.49,25.49,30.39),(13,20.69,25.69,30.49),(14,20.79,25.79,30.59),(15,20.89,25.89,30.69),
    (16,21.09,25.99,30.79),(17,21.19,26.09,30.89),(18,21.29,26.19,30.99),(19,21.49,26.29,30.99),
    (20,21.59,26.39,31.09),(21,21.79,26.49,31.19),(22,21.89,26.69,31.29),(23,22.09,26.89,31.39),
    (24,22.29,26.99,31.59),(25,22.49,27.09,31.69),(26,22.69,27.29,31.79),(27,22.79,27.39,31.89),
    (28,22.99,27.59,31.99),(29,23.19,27.69,32.09),(30,23.39,27.89,32.19),(31,23.49,27.99,32.29),
    (32,23.69,28.09,32.39),(33,23.89,28.19,32.49),(34,23.90,28.39,32.59),(35,24.19,28.49,32.69),
    (36,24.29,28.59,32.79),(37,24.49,28.79,32.89),(38,24.59,28.89,32.99),(39,24.79,28.99,33.09),
    (40,24.99,29.19,33.19),(41,25.09,29.29,33.29),(42,25.09,29.29,33.29),
]

def _classif_imc_gestacional(imc: float, semana: int) -> str:
    for w, bp_max, ad_max, sb_max in _ATALAH:
        if w == semana:
            if imc <= bp_max: return "Baixo Peso"
            if imc <= ad_max: return "Adequado"
            if imc <= sb_max: return "Sobrepeso"
            return "Obesidade"
    return "Semana fora do intervalo"

def _classif_imc(imc: float, idade: int, gestante: bool = False, ig_semanas: int = None, ref_idoso: str = "lipschitz_1994") -> tuple:
    if gestante and ig_semanas:
        return _classif_imc_gestacional(imc, ig_semanas), "Atalah (1997)"
    if idade >= 60:
        return _classif_imc_idoso(imc, ref_idoso), f"Lipschitz 1994 (SISVAN)" if ref_idoso == "lipschitz_1994" else ref_idoso
    return _classif_imc_adulto(imc), "OMS 1995/1997"

# ── %MG classification by sex ────────────────────────────────────

_CLASSIF_MG = {
    1: [(8.0,"Muito baixo"),(22.0,"Bom"),(27.0,"Adequado"),(999,"Elevado")],
    2: [(21.0,"Muito baixo"),(33.0,"Bom"),(39.0,"Adequado"),(999,"Elevado")],
}

def _classif_pct_mg(pct_mg: float, sexo_num: int) -> str:
    for lim, label in _CLASSIF_MG.get(sexo_num, _CLASSIF_MG[1]):
        if pct_mg < lim: return label
    return "Elevado"

# ── Anthropometric indices ────────────────────────────────────────

def _peso_ideal(altura_cm: float) -> tuple:
    h = altura_cm / 100
    return round(18.5 * h**2, 2), round(24.99 * h**2, 2)

def _calc_ic(cintura_cm: float, peso_kg: float, altura_cm: float) -> float:
    return round(cintura_cm/100 / (0.109 * _math.sqrt(peso_kg / (altura_cm/100))), 4)

def _classif_ic(ic: float, sexo_num: int) -> str:
    return "Normal" if ic < (1.25 if sexo_num == 1 else 1.18) else "Elevado"

def _calc_rcq(cintura_cm: float, quadril_cm: float) -> float:
    return round(cintura_cm / quadril_cm, 2)

def _risco_rcq(rcq: float, sexo_num: int) -> bool:
    return rcq > (1.0 if sexo_num == 1 else 0.85)

def _calc_amb_agb(circ_braco_cm: float, dobra_tricipital_mm: float) -> tuple:
    at = (circ_braco_cm**2) / (4 * _math.pi)
    dt_cm = dobra_tricipital_mm / 10
    amb = ((circ_braco_cm - _math.pi * dt_cm)**2) / (4 * _math.pi)
    agb = at - amb
    return round(amb, 2), round(agb, 2)

# ── Venta (goal weight planning) ─────────────────────────────────

def _calcular_venta(peso_atual: float, peso_desejado: float, prazo_dias: int) -> dict:
    diferenca_kg = round(peso_atual - peso_desejado, 2)
    total_kcal = round(diferenca_kg * 7716.18, 2)
    saldo_diario = round(total_kcal / prazo_dias, 2)
    return {
        "diferenca_kg": diferenca_kg, "total_kcal": total_kcal,
        "saldo_diario_kcal": saldo_diario,
        "objetivo": "perder" if diferenca_kg > 0 else "ganhar",
    }

# ── GET with FI and METs ─────────────────────────────────────────

def _calc_get(tmb: float, naf: float, fi: float = 1.0) -> float:
    return round(tmb * naf * fi, 2)

def _calc_kcal_met(met: float, peso_kg: float, duracao_min: int) -> float:
    return round(met * peso_kg * (duracao_min / 60), 2)

def _calc_get_mets(tmb: float, atividades: list, peso_kg: float) -> float:
    total = sum(_calc_kcal_met(a["met"], peso_kg, a["duracao_min"]) for a in atividades)
    return round(tmb + total, 2)

# ── Enhanced body composition (complete) ─────────────────────────

def _sexo_str_to_num(sexo_str: str) -> int:
    return 1 if str(sexo_str).upper().startswith("M") else 2

def calc_bodycomp_v2(data: dict) -> dict:
    """Complete body composition calculation per spec v2.0."""
    peso = float(data["peso"])
    altura_cm = float(data["altura"])
    idade = int(data.get("idade", 30))
    sexo_raw = data.get("sexo", "F")
    sexo_num = sexo_raw if isinstance(sexo_raw, int) else _sexo_str_to_num(sexo_raw)
    gestante = bool(data.get("gestante", False))
    ig_semanas = data.get("ig_semanas")
    protocolo_dobras = data.get("protocolo_dobras")
    protocolo_mg = data.get("protocolo_mg", "siri")
    dobras = data.get("dobras") or {}
    perimetria = data.get("perimetria") or {}
    bioimp = data.get("bioimpedancia") or {}

    # IMC
    h = altura_cm / 100
    imc = round(peso / (h**2), 2)
    imc_class, imc_ref = _classif_imc(imc, idade, gestante, ig_semanas)

    # Peso ideal
    pi_min, pi_max = _peso_ideal(altura_cm)

    # %MG via dobras
    pct_mg = pct_mg_class = dc = None
    if protocolo_dobras and dobras:
        if protocolo_dobras == "pollock7":
            pct_mg = pct_gordura_pollock7(dobras, "M" if sexo_num == 1 else "F", idade)
        elif protocolo_dobras == "pollock3":
            pct_mg = pct_gordura_pollock3(dobras, "M" if sexo_num == 1 else "F", idade)
        elif protocolo_dobras == "faulkner":
            pct_mg = pct_gordura_faulkner(dobras)
        if pct_mg is not None:
            pct_mg_class = _classif_pct_mg(pct_mg, sexo_num)

    bio_pct = _coerce_float(bioimp.get("pct_gordura"))
    bio_massa_magra = _coerce_float(bioimp.get("massa_magra_kg"))
    if pct_mg is None and bio_pct is not None:
        pct_mg = round(bio_pct, 2)
        pct_mg_class = _classif_pct_mg(pct_mg, sexo_num)

    massa_gorda = round(peso * pct_mg / 100, 2) if pct_mg is not None else None
    pct_magra = round(100 - pct_mg, 2) if pct_mg is not None else None
    massa_magra = round(peso - massa_gorda, 2) if massa_gorda is not None else None
    if massa_magra is None and bio_massa_magra is not None:
        massa_magra = round(bio_massa_magra, 2)
        massa_gorda = round(peso - massa_magra, 2)
        pct_mg = round((massa_gorda / peso) * 100, 2) if peso else None
        pct_magra = round(100 - pct_mg, 2) if pct_mg is not None else None
        pct_mg_class = _classif_pct_mg(pct_mg, sexo_num) if pct_mg is not None else None
    fator_res = 0.241 if sexo_num == 1 else 0.209
    peso_residual = round(peso * fator_res, 2)

    # TMB (Mifflin as default, keep old calc too)
    protocolo_tmb = data.get("protocolo_tmb", "mifflin_st_jeor")
    try:
        tmb = _tmb_all(protocolo_tmb, peso, altura_cm, idade, sexo_num, massa_magra)
    except Exception:
        tmb = calc_tmb_mifflin(peso, altura_cm, idade, "M" if sexo_num == 1 else "F")
    tmb_mifflin = calc_tmb_mifflin(peso, altura_cm, idade, "M" if sexo_num == 1 else "F")

    # NAF / GET
    naf_codigo = int(data.get("naf_codigo", 2))
    naf_manual = data.get("naf_manual")
    fi_codigo = data.get("fi_codigo")
    fi_manual = data.get("fi_manual")
    naf_table = _NAF_BY_PROTOCOLO.get(protocolo_tmb, _NAF_PADRAO)
    naf = naf_manual if naf_manual else naf_table.get(sexo_num, naf_table[1]).get(naf_codigo, 1.56)
    fi = fi_manual if fi_manual else (FATORES_INJURIA_TABLE.get(fi_codigo, {}).get("fator", 1.0) if fi_codigo else 1.0)
    get_kcal = _calc_get(tmb, naf, fi)

    # Legacy compat
    fat_act = data.get("nivel_atividade")
    if fat_act and not naf_manual:
        get_kcal = round(tmb_mifflin * float(fat_act), 1)
        naf = float(fat_act)

    # Anthropometric indices from perimetria
    cintura = perimetria.get("cintura") or data.get("cintura")
    quadril = perimetria.get("quadril") or data.get("quadril")
    braco_r = perimetria.get("braco_relaxado_d") or perimetria.get("braco")
    tricipital_mm = dobras.get("tricipital") or dobras.get("triceps")

    ic = ic_class = None
    if cintura and peso and altura_cm:
        try:
            ic = _calc_ic(float(cintura), peso, altura_cm)
            ic_class = _classif_ic(ic, sexo_num)
        except Exception:
            pass

    rcq = rcq_risco = None
    if cintura and quadril:
        try:
            rcq = _calc_rcq(float(cintura), float(quadril))
            rcq_risco = _risco_rcq(rcq, sexo_num)
        except Exception:
            pass

    amb = agb = None
    if braco_r and tricipital_mm:
        try:
            amb, agb = _calc_amb_agb(float(braco_r), float(tricipital_mm))
        except Exception:
            pass

    result = {
        "imc": imc, "imc_classificacao": imc_class, "imc_referencia": imc_ref,
        "peso_ideal_min": pi_min, "peso_ideal_max": pi_max,
        "pct_gordura": pct_mg, "pct_gordura_classificacao": pct_mg_class,
        "massa_gorda": massa_gorda, "pct_massa_magra": pct_magra,
        "massa_magra": massa_magra, "peso_residual": peso_residual,
        "protocolo_dobras": protocolo_dobras,
        "tmb_mifflin": tmb_mifflin, "tmb": tmb, "tmb_protocolo": protocolo_tmb,
        "naf": naf, "fi": fi, "get_kcal": get_kcal,
        "ic": ic, "ic_classificacao": ic_class,
        "rcq": rcq, "rcq_risco": rcq_risco,
        "amb": amb, "agb": agb,
        # gestacional
        "ig_semanas": ig_semanas,
        "imc_gestacional_classificacao": _classif_imc_gestacional(imc, ig_semanas) if (gestante and ig_semanas) else None,
        "bioimpedancia": {
            "pct_gordura": bio_pct,
            "massa_magra_kg": bio_massa_magra,
            "agua_corporal_pct": _coerce_float(bioimp.get("agua_corporal_pct")),
            "gordura_visceral": _coerce_float(bioimp.get("gordura_visceral")),
            "musculo_esqueletico_pct": _coerce_float(bioimp.get("musculo_esqueletico_pct")),
        } if bioimp else None,
        "composicao_fonte": "dobras" if dobras else ("bioimpedancia" if bioimp else "basico"),
    }
    return result

# ── New Pydantic models ──────────────────────────────────────────

class TmbPreviewIn(BaseModel):
    protocolo: str = "mifflin_st_jeor"
    peso: float
    altura_cm: float
    idade: int
    sexo_num: int = 1
    mlg_kg: Optional[float] = None

class AtividadeMetIn(BaseModel):
    nome: str
    met: float
    duracao_min: int

class GetPreviewIn(BaseModel):
    tmb: float
    naf_codigo: Optional[int] = None
    naf_manual: Optional[float] = None
    fi_codigo: Optional[int] = None
    fi_manual: Optional[float] = None
    protocolo_tmb: str = "mifflin_st_jeor"
    sexo_num: int = 1
    peso_kg: Optional[float] = None
    usar_mets: bool = False
    atividades_mets: List[AtividadeMetIn] = []

class VentaIn(BaseModel):
    peso_atual: float
    peso_desejado: float
    prazo_dias: int = 30

class AnamnseSecaoIn(BaseModel):
    dados: dict

class ObsAddIn(BaseModel):
    texto: str

class RecordatorioItemIn(BaseModel):
    n: int = 1
    alimento_id: Optional[str] = None   # ID string da colecao alimentos
    alimento_nome: str
    medida_nome: str = "Gramas"
    quantidade: Optional[float] = 0
    quantidade_g: Optional[float] = None

class RecordatorioRefeicaoIn(BaseModel):
    numero: int = 1
    nome: str
    horario: Optional[str] = None
    itens: List[RecordatorioItemIn] = []
    observacao: Optional[str] = None

class RecordatorioIn(BaseModel):
    data: str
    refeicoes: List[RecordatorioRefeicaoIn] = []
    observacoes: Optional[str] = None
    finalizado: bool = False

class ConfigNutricionistaIn(BaseModel):
    nome: Optional[str] = None
    crn: Optional[str] = None
    especialidade: Optional[str] = None
    telefone: Optional[str] = None
    cor_relatorio: Optional[str] = None
    clinica_nome: Optional[str] = None
    clinica_endereco: Optional[str] = None
    telefone_clinica: Optional[str] = None
    site: Optional[str] = None

class EvaluationV2In(BaseModel):
    peso: float
    altura: float
    idade: int
    sexo: str = "F"
    sexo_num: Optional[int] = None
    gestante: bool = False
    ig_semanas: Optional[int] = None
    protocolo_dobras: Optional[str] = None
    protocolo_mg: str = "siri"
    protocolo_tmb: str = "mifflin_st_jeor"
    dobras: Optional[dict] = None
    perimetria: Optional[dict] = None
    bioimpedancia: Optional[dict] = None
    nivel_atividade: Optional[float] = None
    naf_codigo: Optional[int] = 2
    naf_manual: Optional[float] = None
    fi_codigo: Optional[int] = None
    fi_manual: Optional[float] = None
    objetivo: str = "manutencao"
    mlg_kg: Optional[float] = None

# ── Clinical calculation endpoints ──────────────────────────────

@api.post("/calculos/tmb")
async def preview_tmb(payload: TmbPreviewIn, user=Depends(get_current_user)):
    try:
        val = _tmb_all(payload.protocolo, payload.peso, payload.altura_cm, payload.idade, payload.sexo_num, payload.mlg_kg)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"tmb": val, "protocolo": payload.protocolo, "descricao": PROTOCOLOS_TMB_DESCRICAO.get(payload.protocolo, payload.protocolo)}

@api.post("/calculos/get")
async def preview_get(payload: GetPreviewIn, user=Depends(get_current_user)):
    naf_table = _NAF_BY_PROTOCOLO.get(payload.protocolo_tmb, _NAF_PADRAO)
    if payload.naf_manual is not None:
        naf = payload.naf_manual
    elif payload.naf_codigo:
        naf = naf_table.get(payload.sexo_num, naf_table[1]).get(payload.naf_codigo, 1.56)
    else:
        naf = 1.56
    fi = 1.0
    if payload.fi_manual is not None:
        fi = payload.fi_manual
    elif payload.fi_codigo:
        fi = FATORES_INJURIA_TABLE.get(payload.fi_codigo, {}).get("fator", 1.0)
    if payload.usar_mets and payload.atividades_mets and payload.peso_kg:
        get_v = _calc_get_mets(payload.tmb, [a.model_dump() for a in payload.atividades_mets], payload.peso_kg)
    else:
        get_v = _calc_get(payload.tmb, naf, fi)
    return {"get": get_v, "naf": naf, "fi": fi, "tmb": payload.tmb}

@api.post("/calculos/venta")
async def preview_venta(payload: VentaIn, user=Depends(get_current_user)):
    if payload.prazo_dias <= 0:
        raise HTTPException(400, "Prazo deve ser maior que zero")
    return _calcular_venta(payload.peso_atual, payload.peso_desejado, payload.prazo_dias)

@api.get("/referencias/naf")
async def get_naf_ref(protocolo: str = "mifflin_st_jeor", sexo: int = 1, user=Depends(get_current_user)):
    table = _NAF_BY_PROTOCOLO.get(protocolo, _NAF_PADRAO)
    vals = table.get(sexo, table[1])
    return [{"codigo": k, "naf": v, "descricao": _NAF_DESCRICAO.get(k, "")} for k, v in vals.items()]

@api.get("/referencias/fatores-injuria")
async def get_fi_ref(user=Depends(get_current_user)):
    return [{"codigo": k, **v} for k, v in FATORES_INJURIA_TABLE.items()]

@api.get("/referencias/protocolos-tmb")
async def get_tmb_ref(user=Depends(get_current_user)):
    return [{"codigo": k, "descricao": v} for k, v in PROTOCOLOS_TMB_DESCRICAO.items()]

# ── Enhanced anamnese endpoints ──────────────────────────────────

SECOES_ANAMNESE = {
    "dados_sociais": ["estado_civil","ocupacao","escolaridade","naturalidade","email","redes_sociais","telefone","celular","endereco","bairro","cidade_uf","cep","motivo","motivo_outro"],
    "habitos_vida": ["restricao_alimentar","alcool","tabagismo","refeicoes_fora","pessoas_casa","compras_casa","sal_oleo_mes","habitos_sono"],
    "patologias": ["sintomas_gerais","outros_sintomas","lesoes","cirurgias","patologias","medicamentos","historico_familiar"],
    "avaliacao_clinica": ["apetite","mastigacao","habito_intestinal","cor_fezes","formato_fezes","habito_urinario","ingestao_hidrica","hidratacao_urinaria"],
    "alimentacao": ["intolerancia_alimentar","preferencia_alimentar","aversao_alimentar","alergia_alimentar","alteracoes_apetite","inicio_obesidade","dieta_especial","num_refeicoes_dia","suplementos"],
    "atividade_fisica": ["atividades_praticadas","intensidade_atividades","horario_atividades","duracao_atividades","frequencia_semana","sintomas_durante","sintomas_apos","hidratacao_atividade","alimentacao_pre","alimentacao_durante","alimentacao_pos"],
    "mulheres": ["ultima_menstruacao","tpm","ciclo_menstrual","contraceptivo","colicas","lactante","menopausa"],
}

@api.post("/admin/migrate-anamneses")
async def migrate_anamneses(user=Depends(require_nutritionist)):
    """Backfill structured fields for anamneses that only have raw `respostas`."""
    updated = 0
    cursor = db.anamneses.find({"respostas": {"$exists": True}})
    async for doc in cursor:
        r = doc.get("respostas") or {}
        mapeado = _map_preconsulta(r)
        if not mapeado:
            continue
        # Only set fields that are not yet present in the document
        to_set = {k: v for k, v in mapeado.items() if not doc.get(k)}
        if to_set:
            await db.anamneses.update_one({"_id": doc["_id"]}, {"$set": to_set})
            updated += 1
    return {"ok": True, "updated": updated}

@api.get("/patients/{pid}/anamnese-v2")
async def get_anamnese_v2(pid: str, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    anam = await db.anamneses.find_one({"paciente_id": pid}, {"_id": 0})
    return anam or {}

@api.patch("/patients/{pid}/anamnese/{secao}")
async def patch_anamnese_secao(pid: str, secao: str, payload: AnamnseSecaoIn, user=Depends(require_nutritionist)):
    if secao not in SECOES_ANAMNESE:
        raise HTTPException(400, f"Seção inválida. Válidas: {list(SECOES_ANAMNESE)}")
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    campos = SECOES_ANAMNESE[secao]
    dados = {k: v for k, v in payload.dados.items() if k in campos}
    now_str = iso(now_utc())
    existing = await db.anamneses.find_one({"paciente_id": pid})
    if existing:
        await db.anamneses.update_one({"paciente_id": pid}, {"$set": {**dados, "atualizado_em": now_str}})
    else:
        doc = {"id": str(uuid.uuid4()), "paciente_id": pid, "nutricionista_id": user["id"],
               **dados, "criado_em": now_str, "atualizado_em": now_str}
        await db.anamneses.insert_one(doc)
    updated = await db.anamneses.find_one({"paciente_id": pid}, {"_id": 0})
    return updated or {}

@api.delete("/patients/{pid}/anamnese/{secao}")
async def clear_anamnese_secao(pid: str, secao: str, user=Depends(require_nutritionist)):
    if secao not in SECOES_ANAMNESE:
        raise HTTPException(400, f"Seção inválida. Válidas: {list(SECOES_ANAMNESE)}")
    patient = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not patient:
        raise HTTPException(404, "Paciente não encontrado")
    fields = {field: "" for field in SECOES_ANAMNESE[secao]}
    fields["atualizado_em"] = iso(now_utc())
    result = await db.anamneses.update_one({"paciente_id": pid}, {"$set": fields})
    if result.matched_count == 0:
        raise HTTPException(404, "Anamnese não encontrada")
    return {"ok": True}

@api.post("/patients/{pid}/anamnese/observacoes/{tipo}")
async def add_observacao_anamnese(pid: str, tipo: str, payload: ObsAddIn, user=Depends(require_nutritionist)):
    tipos_validos = ["dados_iniciais","habitos_vida","patologias","avaliacao_clinica","alimentacao","atividade_fisica","mulheres"]
    if tipo not in tipos_validos:
        raise HTTPException(400, f"Tipo inválido: {tipo}")
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    campo = f"obs_{tipo}"
    entrada = {"texto": payload.texto, "data": iso(now_utc())}
    now_str = iso(now_utc())
    existing = await db.anamneses.find_one({"paciente_id": pid})
    if existing:
        await db.anamneses.update_one({"paciente_id": pid},
            {"$push": {campo: entrada}, "$set": {"atualizado_em": now_str}})
    else:
        doc = {"id": str(uuid.uuid4()), "paciente_id": pid, "nutricionista_id": user["id"],
               campo: [entrada], "criado_em": now_str, "atualizado_em": now_str}
        await db.anamneses.insert_one(doc)
    return {"ok": True}

# ── Enhanced evaluation endpoint v2 ─────────────────────────────

@api.post("/patients/{pid}/evaluations-v2")
async def add_evaluation_v2(pid: str, payload: EvaluationV2In, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    count = await db.evaluations.count_documents({"paciente_id": pid})
    if count >= 10:
        raise HTTPException(400, "Máximo de 10 avaliações por paciente")
    data = payload.model_dump()
    comp = calc_bodycomp_v2(data)
    eid = str(uuid.uuid4())
    doc = {"id": eid, "paciente_id": pid, "nutricionista_id": user["id"],
           **data, "composicao": comp, "created_at": iso(now_utc())}
    await db.evaluations.insert_one(doc)
    await db.patients.update_one({"id": pid}, {"$set": {
        "peso": payload.peso, "altura": payload.altura, "ultima_avaliacao": iso(now_utc()),
    }})
    return {"ok": True, "evaluation_id": eid, "composicao": comp}

@api.put("/patients/{pid}/evaluations/{eid}")
async def update_evaluation(pid: str, eid: str, payload: EvaluationV2In, user=Depends(require_nutritionist)):
    patient = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not patient:
        raise HTTPException(404, "Paciente não encontrado")
    existing = await db.evaluations.find_one({"id": eid, "paciente_id": pid})
    if not existing:
        raise HTTPException(404, "Avaliação não encontrada")
    data = payload.model_dump()
    composition = calc_bodycomp_v2(data)
    updates = {**data, "composicao": composition, "updated_at": iso(now_utc())}
    await db.evaluations.update_one({"id": eid, "paciente_id": pid}, {"$set": updates})
    await db.patients.update_one({"id": pid}, {"$set": {"peso": payload.peso, "altura": payload.altura, "ultima_avaliacao": iso(now_utc())}})
    return {"ok": True, "evaluation_id": eid, "composicao": composition}

@api.delete("/patients/{pid}/evaluations/{eid}")
async def delete_evaluation(pid: str, eid: str, user=Depends(require_nutritionist)):
    patient = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not patient:
        raise HTTPException(404, "Paciente não encontrado")
    result = await db.evaluations.delete_one({"id": eid, "paciente_id": pid})
    if result.deleted_count == 0:
        raise HTTPException(404, "Avaliação não encontrada")
    latest = await db.evaluations.find_one({"paciente_id": pid}, sort=[("created_at", -1)])
    if latest:
        await db.patients.update_one({"id": pid}, {"$set": {"peso": latest.get("peso"), "altura": latest.get("altura"), "ultima_avaliacao": latest.get("created_at")}})
    return {"ok": True}

# ── Recordatório endpoints ───────────────────────────────────────

@api.get("/patients/{pid}/recordatorios")
async def list_recordatorios(pid: str, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    rows = await db.recordatorios.find({"paciente_id": pid}, {"_id": 0}).sort("data", -1).to_list(100)
    return rows

async def _build_recordatorio_model(payload: RecordatorioIn, pid: str, nutricionista_id: str):
    """Constroi o modelo Pydantic Recordatorio buscando nutrientes no MongoDB."""
    from recordatorio_schema import Recordatorio as RecSchema, RefeicaoRecordatorio as RefSchema, ItemRecordatorio as ItemSchema
    from recordatorio_calc import calcular_item
    refeicoes = []
    for ri, ref_in in enumerate(payload.refeicoes, 1):
        itens = []
        for idx, item_in in enumerate(ref_in.itens, 1):
            item_data = item_in.model_dump()
            item_data["n"] = idx
            if item_in.alimento_id:
                alim = await db.alimentos.find_one({"id": item_in.alimento_id}, {"_id": 0})
                if alim:
                    resolved_g = _resolve_quantidade_g(alim, item_in.medida_nome, item_in.quantidade, item_in.quantidade_g)
                    item_data["quantidade_g"] = resolved_g
                    item_data["quantidade"] = _coerce_float(item_in.quantidade) if item_in.quantidade is not None else resolved_g
                    item_data.update(calcular_item(alim, resolved_g))
            itens.append(ItemSchema(**item_data))
        refeicoes.append(RefSchema(
            numero=ref_in.numero or ri,
            nome=ref_in.nome,
            horario=ref_in.horario,
            itens=itens,
            observacao=ref_in.observacao,
        ))
    return RecSchema(
        paciente_id=pid,
        nutricionista_id=nutricionista_id,
        data=payload.data,
        data_registro=iso(now_utc()),
        refeicoes=refeicoes,
        observacoes=payload.observacoes or "",
        finalizado=payload.finalizado,
    )

@api.post("/patients/{pid}/recordatorios")
async def create_recordatorio(pid: str, payload: RecordatorioIn, user=Depends(require_nutritionist)):
    from recordatorio_calc import finalizar_recordatorio
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    rid = str(uuid.uuid4())
    now_str = iso(now_utc())
    rec = await _build_recordatorio_model(payload, pid, user["id"])
    rec = finalizar_recordatorio(rec)
    doc = rec.model_dump()
    doc["id"] = rid
    doc["criado_em"] = now_str
    doc["atualizado_em"] = now_str
    await db.recordatorios.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}

@api.put("/patients/{pid}/recordatorios/{rid}")
async def update_recordatorio(pid: str, rid: str, payload: RecordatorioIn, user=Depends(require_nutritionist)):
    from recordatorio_calc import finalizar_recordatorio
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    existing = await db.recordatorios.find_one({"id": rid, "paciente_id": pid})
    if not existing:
        raise HTTPException(404, "Recordatório não encontrado")
    if existing.get("finalizado"):
        raise HTTPException(409, "Recordatório finalizado não pode ser editado")
    rec = await _build_recordatorio_model(payload, pid, user["id"])
    rec = finalizar_recordatorio(rec)
    upd = rec.model_dump()
    upd["atualizado_em"] = iso(now_utc())
    await db.recordatorios.update_one({"id": rid, "paciente_id": pid}, {"$set": upd})
    return await db.recordatorios.find_one({"id": rid}, {"_id": 0})

@api.delete("/patients/{pid}/recordatorios/{rid}")
async def delete_recordatorio(pid: str, rid: str, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    res = await db.recordatorios.delete_one({"id": rid, "paciente_id": pid})
    if res.deleted_count == 0:
        raise HTTPException(404, "Recordatório não encontrado")
    return {"ok": True}

# ── Configurações do nutricionista ───────────────────────────────

@api.get("/configuracoes")
async def get_configuracoes(user=Depends(require_nutritionist)):
    u = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})
    return u or {}

@api.put("/configuracoes")
async def update_configuracoes(payload: ConfigNutricionistaIn, user=Depends(require_nutritionist)):
    upd = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    upd["atualizado_em"] = iso(now_utc())
    await db.users.update_one({"id": user["id"]}, {"$set": upd})
    u = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})
    return u or {}

# ── TACO Food Database ──────────────────────────────────────────

_TACO_SEED = [
    {"id":"taco-1","nome":"Arroz, branco, cozido","categoria":"Cereais e derivados","porcao_padrao_g":125,"medida_caseira":"1 escumadeira cheia","por_100g":{"energia_kcal":128,"proteinas_g":2.5,"carboidratos_g":28.1,"lipidios_g":0.2,"fibras_g":1.6,"sodio_mg":1,"calcio_mg":4,"ferro_mg":0.3,"vitamina_c_mg":0,"colesterol_mg":0,"acidos_graxos_saturados_g":0.1,"acidos_graxos_mono_g":0.1,"acidos_graxos_poli_g":0.1,"potassio_mg":34,"magnesio_mg":9}},
    {"id":"taco-2","nome":"Arroz, integral, cozido","categoria":"Cereais e derivados","porcao_padrao_g":125,"medida_caseira":"1 escumadeira cheia","por_100g":{"energia_kcal":124,"proteinas_g":2.6,"carboidratos_g":25.8,"lipidios_g":1.0,"fibras_g":2.7,"sodio_mg":1,"calcio_mg":7,"ferro_mg":0.4,"vitamina_c_mg":0,"colesterol_mg":0,"acidos_graxos_saturados_g":0.2,"acidos_graxos_mono_g":0.3,"acidos_graxos_poli_g":0.4,"potassio_mg":60,"magnesio_mg":43}},
    {"id":"taco-3","nome":"Macarrão, cozido","categoria":"Cereais e derivados","porcao_padrao_g":140,"medida_caseira":"1 prato fundo","por_100g":{"energia_kcal":148,"proteinas_g":5.3,"carboidratos_g":29.9,"lipidios_g":0.9,"fibras_g":1.6,"sodio_mg":1,"calcio_mg":7,"ferro_mg":0.7,"vitamina_c_mg":0,"colesterol_mg":0,"acidos_graxos_saturados_g":0.1,"acidos_graxos_mono_g":0.2,"acidos_graxos_poli_g":0.4,"potassio_mg":24,"magnesio_mg":16}},
    {"id":"taco-4","nome":"Pão francês","categoria":"Cereais e derivados","porcao_padrao_g":50,"medida_caseira":"1 unidade","por_100g":{"energia_kcal":300,"proteinas_g":8.0,"carboidratos_g":58.6,"lipidios_g":3.1,"fibras_g":2.3,"sodio_mg":588,"calcio_mg":25,"ferro_mg":1.1,"vitamina_c_mg":0,"colesterol_mg":0,"acidos_graxos_saturados_g":0.7,"acidos_graxos_mono_g":1.4,"acidos_graxos_poli_g":0.7,"potassio_mg":104,"magnesio_mg":24}},
    {"id":"taco-5","nome":"Aveia, flocos, crua","categoria":"Cereais e derivados","porcao_padrao_g":40,"medida_caseira":"4 colheres de sopa","por_100g":{"energia_kcal":394,"proteinas_g":13.9,"carboidratos_g":66.6,"lipidios_g":8.5,"fibras_g":9.1,"sodio_mg":4,"calcio_mg":54,"ferro_mg":4.5,"vitamina_c_mg":0,"colesterol_mg":0,"acidos_graxos_saturados_g":1.5,"acidos_graxos_mono_g":2.9,"acidos_graxos_poli_g":3.5,"potassio_mg":372,"magnesio_mg":119}},
    {"id":"taco-6","nome":"Feijão, preto, cozido","categoria":"Leguminosas e derivados","porcao_padrao_g":86,"medida_caseira":"1 concha cheia","por_100g":{"energia_kcal":77,"proteinas_g":4.5,"carboidratos_g":14.0,"lipidios_g":0.5,"fibras_g":8.4,"sodio_mg":2,"calcio_mg":29,"ferro_mg":1.5,"vitamina_c_mg":0,"colesterol_mg":0,"acidos_graxos_saturados_g":0.1,"acidos_graxos_mono_g":0.1,"acidos_graxos_poli_g":0.2,"potassio_mg":255,"magnesio_mg":43}},
    {"id":"taco-7","nome":"Feijão, carioca, cozido","categoria":"Leguminosas e derivados","porcao_padrao_g":86,"medida_caseira":"1 concha cheia","por_100g":{"energia_kcal":76,"proteinas_g":4.8,"carboidratos_g":13.6,"lipidios_g":0.5,"fibras_g":8.5,"sodio_mg":2,"calcio_mg":27,"ferro_mg":1.8,"vitamina_c_mg":0,"colesterol_mg":0,"acidos_graxos_saturados_g":0.1,"acidos_graxos_mono_g":0.1,"acidos_graxos_poli_g":0.2,"potassio_mg":258,"magnesio_mg":37}},
    {"id":"taco-8","nome":"Lentilha, cozida","categoria":"Leguminosas e derivados","porcao_padrao_g":86,"medida_caseira":"1 concha cheia","por_100g":{"energia_kcal":93,"proteinas_g":7.0,"carboidratos_g":15.9,"lipidios_g":0.5,"fibras_g":5.8,"sodio_mg":2,"calcio_mg":19,"ferro_mg":3.4,"vitamina_c_mg":1.5,"colesterol_mg":0,"acidos_graxos_saturados_g":0.1,"acidos_graxos_mono_g":0.1,"acidos_graxos_poli_g":0.2,"potassio_mg":319,"magnesio_mg":35}},
    {"id":"taco-9","nome":"Grão-de-bico, cozido","categoria":"Leguminosas e derivados","porcao_padrao_g":86,"medida_caseira":"1 concha cheia","por_100g":{"energia_kcal":164,"proteinas_g":9.0,"carboidratos_g":27.4,"lipidios_g":2.6,"fibras_g":6.0,"sodio_mg":7,"calcio_mg":57,"ferro_mg":3.2,"vitamina_c_mg":1.3,"colesterol_mg":0,"acidos_graxos_saturados_g":0.3,"acidos_graxos_mono_g":0.6,"acidos_graxos_poli_g":1.2,"potassio_mg":291,"magnesio_mg":48}},
    {"id":"taco-10","nome":"Frango, peito, grelhado","categoria":"Carnes e derivados","porcao_padrao_g":100,"medida_caseira":"1 filé médio","por_100g":{"energia_kcal":159,"proteinas_g":32.0,"carboidratos_g":0,"lipidios_g":2.9,"fibras_g":0,"sodio_mg":67,"calcio_mg":5,"ferro_mg":0.4,"vitamina_c_mg":0,"colesterol_mg":81,"acidos_graxos_saturados_g":0.8,"acidos_graxos_mono_g":1.0,"acidos_graxos_poli_g":0.6,"potassio_mg":355,"magnesio_mg":28}},
    {"id":"taco-11","nome":"Frango, coxa, assada","categoria":"Carnes e derivados","porcao_padrao_g":100,"medida_caseira":"1 coxa","por_100g":{"energia_kcal":213,"proteinas_g":24.7,"carboidratos_g":0,"lipidios_g":12.4,"fibras_g":0,"sodio_mg":75,"calcio_mg":14,"ferro_mg":0.7,"vitamina_c_mg":0,"colesterol_mg":88,"acidos_graxos_saturados_g":3.4,"acidos_graxos_mono_g":5.0,"acidos_graxos_poli_g":2.7,"potassio_mg":245,"magnesio_mg":22}},
    {"id":"taco-12","nome":"Carne bovina, patinho, cozido","categoria":"Carnes e derivados","porcao_padrao_g":100,"medida_caseira":"1 bife médio","por_100g":{"energia_kcal":219,"proteinas_g":30.6,"carboidratos_g":0,"lipidios_g":10.9,"fibras_g":0,"sodio_mg":60,"calcio_mg":10,"ferro_mg":3.4,"vitamina_c_mg":0,"colesterol_mg":104,"acidos_graxos_saturados_g":4.3,"acidos_graxos_mono_g":4.7,"acidos_graxos_poli_g":0.4,"potassio_mg":326,"magnesio_mg":24}},
    {"id":"taco-13","nome":"Atum, enlatado em água, escorrido","categoria":"Peixes e frutos do mar","porcao_padrao_g":80,"medida_caseira":"1/2 lata","por_100g":{"energia_kcal":130,"proteinas_g":28.8,"carboidratos_g":0,"lipidios_g":1.7,"fibras_g":0,"sodio_mg":347,"calcio_mg":20,"ferro_mg":1.2,"vitamina_c_mg":0,"colesterol_mg":49,"acidos_graxos_saturados_g":0.4,"acidos_graxos_mono_g":0.4,"acidos_graxos_poli_g":0.5,"potassio_mg":265,"magnesio_mg":32}},
    {"id":"taco-14","nome":"Salmão, assado","categoria":"Peixes e frutos do mar","porcao_padrao_g":100,"medida_caseira":"1 filé médio","por_100g":{"energia_kcal":181,"proteinas_g":25.4,"carboidratos_g":0,"lipidios_g":8.6,"fibras_g":0,"sodio_mg":55,"calcio_mg":14,"ferro_mg":0.6,"vitamina_c_mg":0,"colesterol_mg":71,"acidos_graxos_saturados_g":2.0,"acidos_graxos_mono_g":3.5,"acidos_graxos_poli_g":2.4,"potassio_mg":440,"magnesio_mg":28}},
    {"id":"taco-15","nome":"Ovo de galinha, cozido","categoria":"Ovos e derivados","porcao_padrao_g":50,"medida_caseira":"1 unidade","por_100g":{"energia_kcal":146,"proteinas_g":13.3,"carboidratos_g":0.6,"lipidios_g":9.5,"fibras_g":0,"sodio_mg":164,"calcio_mg":50,"ferro_mg":1.9,"vitamina_c_mg":0,"colesterol_mg":425,"acidos_graxos_saturados_g":2.9,"acidos_graxos_mono_g":3.6,"acidos_graxos_poli_g":1.3,"potassio_mg":140,"magnesio_mg":11}},
    {"id":"taco-16","nome":"Leite integral","categoria":"Leite e derivados","porcao_padrao_g":200,"medida_caseira":"1 copo","por_100g":{"energia_kcal":61,"proteinas_g":3.2,"carboidratos_g":4.5,"lipidios_g":3.2,"fibras_g":0,"sodio_mg":38,"calcio_mg":113,"ferro_mg":0,"vitamina_c_mg":1.0,"colesterol_mg":10,"acidos_graxos_saturados_g":1.9,"acidos_graxos_mono_g":0.8,"acidos_graxos_poli_g":0.1,"potassio_mg":141,"magnesio_mg":10}},
    {"id":"taco-17","nome":"Iogurte, natural, integral","categoria":"Leite e derivados","porcao_padrao_g":170,"medida_caseira":"1 pote","por_100g":{"energia_kcal":66,"proteinas_g":3.7,"carboidratos_g":5.2,"lipidios_g":3.2,"fibras_g":0,"sodio_mg":49,"calcio_mg":121,"ferro_mg":0.1,"vitamina_c_mg":1.0,"colesterol_mg":11,"acidos_graxos_saturados_g":2.0,"acidos_graxos_mono_g":0.9,"acidos_graxos_poli_g":0.1,"potassio_mg":155,"magnesio_mg":11}},
    {"id":"taco-18","nome":"Queijo mussarela","categoria":"Leite e derivados","porcao_padrao_g":30,"medida_caseira":"1 fatia","por_100g":{"energia_kcal":289,"proteinas_g":19.7,"carboidratos_g":2.2,"lipidios_g":22.4,"fibras_g":0,"sodio_mg":547,"calcio_mg":577,"ferro_mg":0.3,"vitamina_c_mg":0,"colesterol_mg":73,"acidos_graxos_saturados_g":13.2,"acidos_graxos_mono_g":6.5,"acidos_graxos_poli_g":0.8,"potassio_mg":100,"magnesio_mg":20}},
    {"id":"taco-19","nome":"Queijo cottage","categoria":"Leite e derivados","porcao_padrao_g":100,"medida_caseira":"2 colheres de sopa","por_100g":{"energia_kcal":98,"proteinas_g":11.1,"carboidratos_g":3.4,"lipidios_g":4.3,"fibras_g":0,"sodio_mg":406,"calcio_mg":98,"ferro_mg":0.1,"vitamina_c_mg":0,"colesterol_mg":15,"acidos_graxos_saturados_g":2.7,"acidos_graxos_mono_g":1.2,"acidos_graxos_poli_g":0.1,"potassio_mg":120,"magnesio_mg":9}},
    {"id":"taco-20","nome":"Alface, crua","categoria":"Hortaliças e derivados","porcao_padrao_g":35,"medida_caseira":"1 pires","por_100g":{"energia_kcal":11,"proteinas_g":1.3,"carboidratos_g":1.7,"lipidios_g":0.2,"fibras_g":1.8,"sodio_mg":14,"calcio_mg":28,"ferro_mg":0.4,"vitamina_c_mg":18.0,"colesterol_mg":0,"acidos_graxos_saturados_g":0,"acidos_graxos_mono_g":0,"acidos_graxos_poli_g":0.1,"potassio_mg":164,"magnesio_mg":12}},
    {"id":"taco-21","nome":"Tomate, cru","categoria":"Hortaliças e derivados","porcao_padrao_g":100,"medida_caseira":"1 unidade média","por_100g":{"energia_kcal":15,"proteinas_g":1.1,"carboidratos_g":3.1,"lipidios_g":0.2,"fibras_g":1.2,"sodio_mg":5,"calcio_mg":11,"ferro_mg":0.3,"vitamina_c_mg":21.2,"colesterol_mg":0,"acidos_graxos_saturados_g":0,"acidos_graxos_mono_g":0,"acidos_graxos_poli_g":0.1,"potassio_mg":222,"magnesio_mg":11}},
    {"id":"taco-22","nome":"Brócolis, cozido","categoria":"Hortaliças e derivados","porcao_padrao_g":90,"medida_caseira":"1 pires","por_100g":{"energia_kcal":35,"proteinas_g":2.3,"carboidratos_g":6.6,"lipidios_g":0.4,"fibras_g":3.4,"sodio_mg":18,"calcio_mg":57,"ferro_mg":1.1,"vitamina_c_mg":50.6,"colesterol_mg":0,"acidos_graxos_saturados_g":0.1,"acidos_graxos_mono_g":0,"acidos_graxos_poli_g":0.2,"potassio_mg":274,"magnesio_mg":22}},
    {"id":"taco-23","nome":"Espinafre, cru","categoria":"Hortaliças e derivados","porcao_padrao_g":40,"medida_caseira":"1 pires","por_100g":{"energia_kcal":18,"proteinas_g":2.2,"carboidratos_g":2.9,"lipidios_g":0.4,"fibras_g":2.2,"sodio_mg":79,"calcio_mg":84,"ferro_mg":3.0,"vitamina_c_mg":28.1,"colesterol_mg":0,"acidos_graxos_saturados_g":0.1,"acidos_graxos_mono_g":0,"acidos_graxos_poli_g":0.2,"potassio_mg":466,"magnesio_mg":68}},
    {"id":"taco-24","nome":"Cenoura, crua","categoria":"Hortaliças e derivados","porcao_padrao_g":80,"medida_caseira":"1 unidade média","por_100g":{"energia_kcal":34,"proteinas_g":0.9,"carboidratos_g":7.7,"lipidios_g":0.2,"fibras_g":3.2,"sodio_mg":72,"calcio_mg":32,"ferro_mg":0.3,"vitamina_c_mg":5.6,"colesterol_mg":0,"acidos_graxos_saturados_g":0,"acidos_graxos_mono_g":0.1,"acidos_graxos_poli_g":0.1,"potassio_mg":263,"magnesio_mg":13}},
    {"id":"taco-25","nome":"Batata, cozida","categoria":"Hortaliças e derivados","porcao_padrao_g":100,"medida_caseira":"1 unidade pequena","por_100g":{"energia_kcal":52,"proteinas_g":1.2,"carboidratos_g":11.9,"lipidios_g":0.1,"fibras_g":1.5,"sodio_mg":2,"calcio_mg":4,"ferro_mg":0.4,"vitamina_c_mg":10.5,"colesterol_mg":0,"acidos_graxos_saturados_g":0,"acidos_graxos_mono_g":0,"acidos_graxos_poli_g":0.1,"potassio_mg":392,"magnesio_mg":20}},
    {"id":"taco-26","nome":"Batata-doce, cozida","categoria":"Hortaliças e derivados","porcao_padrao_g":100,"medida_caseira":"1 unidade pequena","por_100g":{"energia_kcal":77,"proteinas_g":0.6,"carboidratos_g":18.4,"lipidios_g":0.1,"fibras_g":2.2,"sodio_mg":37,"calcio_mg":30,"ferro_mg":0.5,"vitamina_c_mg":17.7,"colesterol_mg":0,"acidos_graxos_saturados_g":0,"acidos_graxos_mono_g":0,"acidos_graxos_poli_g":0.1,"potassio_mg":301,"magnesio_mg":18}},
    {"id":"taco-27","nome":"Abobrinha, cozida","categoria":"Hortaliças e derivados","porcao_padrao_g":90,"medida_caseira":"2 colheres de servir","por_100g":{"energia_kcal":20,"proteinas_g":1.2,"carboidratos_g":4.1,"lipidios_g":0.2,"fibras_g":1.1,"sodio_mg":2,"calcio_mg":21,"ferro_mg":0.4,"vitamina_c_mg":10.5,"colesterol_mg":0,"acidos_graxos_saturados_g":0,"acidos_graxos_mono_g":0,"acidos_graxos_poli_g":0.1,"potassio_mg":248,"magnesio_mg":14}},
    {"id":"taco-28","nome":"Banana, nanica","categoria":"Frutas e derivados","porcao_padrao_g":100,"medida_caseira":"1 unidade média","por_100g":{"energia_kcal":92,"proteinas_g":1.3,"carboidratos_g":23.8,"lipidios_g":0.1,"fibras_g":1.9,"sodio_mg":1,"calcio_mg":3,"ferro_mg":0.3,"vitamina_c_mg":5.9,"colesterol_mg":0,"acidos_graxos_saturados_g":0,"acidos_graxos_mono_g":0,"acidos_graxos_poli_g":0,"potassio_mg":376,"magnesio_mg":27}},
    {"id":"taco-29","nome":"Maçã, fuji","categoria":"Frutas e derivados","porcao_padrao_g":150,"medida_caseira":"1 unidade média","por_100g":{"energia_kcal":56,"proteinas_g":0.3,"carboidratos_g":15.2,"lipidios_g":0.1,"fibras_g":1.3,"sodio_mg":1,"calcio_mg":4,"ferro_mg":0.1,"vitamina_c_mg":2.0,"colesterol_mg":0,"acidos_graxos_saturados_g":0,"acidos_graxos_mono_g":0,"acidos_graxos_poli_g":0,"potassio_mg":113,"magnesio_mg":6}},
    {"id":"taco-30","nome":"Laranja, pera","categoria":"Frutas e derivados","porcao_padrao_g":140,"medida_caseira":"1 unidade média","por_100g":{"energia_kcal":37,"proteinas_g":1.0,"carboidratos_g":8.9,"lipidios_g":0.1,"fibras_g":0.8,"sodio_mg":1,"calcio_mg":24,"ferro_mg":0.1,"vitamina_c_mg":53.0,"colesterol_mg":0,"acidos_graxos_saturados_g":0,"acidos_graxos_mono_g":0,"acidos_graxos_poli_g":0,"potassio_mg":176,"magnesio_mg":11}},
    {"id":"taco-31","nome":"Mamão, papaia","categoria":"Frutas e derivados","porcao_padrao_g":170,"medida_caseira":"1 fatia média","por_100g":{"energia_kcal":40,"proteinas_g":0.5,"carboidratos_g":10.4,"lipidios_g":0.1,"fibras_g":1.8,"sodio_mg":4,"calcio_mg":20,"ferro_mg":0.1,"vitamina_c_mg":78.0,"colesterol_mg":0,"acidos_graxos_saturados_g":0,"acidos_graxos_mono_g":0,"acidos_graxos_poli_g":0,"potassio_mg":206,"magnesio_mg":10}},
    {"id":"taco-32","nome":"Abacate","categoria":"Frutas e derivados","porcao_padrao_g":85,"medida_caseira":"1/2 unidade média","por_100g":{"energia_kcal":96,"proteinas_g":1.2,"carboidratos_g":6.0,"lipidios_g":8.4,"fibras_g":6.3,"sodio_mg":2,"calcio_mg":10,"ferro_mg":0.4,"vitamina_c_mg":12.5,"colesterol_mg":0,"acidos_graxos_saturados_g":1.6,"acidos_graxos_mono_g":5.5,"acidos_graxos_poli_g":1.1,"potassio_mg":485,"magnesio_mg":29}},
    {"id":"taco-33","nome":"Morango","categoria":"Frutas e derivados","porcao_padrao_g":120,"medida_caseira":"1 xícara","por_100g":{"energia_kcal":30,"proteinas_g":0.8,"carboidratos_g":6.9,"lipidios_g":0.3,"fibras_g":1.7,"sodio_mg":1,"calcio_mg":14,"ferro_mg":0.4,"vitamina_c_mg":58.8,"colesterol_mg":0,"acidos_graxos_saturados_g":0,"acidos_graxos_mono_g":0,"acidos_graxos_poli_g":0.2,"potassio_mg":168,"magnesio_mg":14}},
    {"id":"taco-34","nome":"Azeite de oliva extra virgem","categoria":"Óleos e gorduras","porcao_padrao_g":10,"medida_caseira":"1 colher de sopa","por_100g":{"energia_kcal":884,"proteinas_g":0,"carboidratos_g":0,"lipidios_g":100.0,"fibras_g":0,"sodio_mg":2,"calcio_mg":1,"ferro_mg":0.4,"vitamina_c_mg":0,"colesterol_mg":0,"acidos_graxos_saturados_g":13.8,"acidos_graxos_mono_g":73.0,"acidos_graxos_poli_g":10.5,"potassio_mg":1,"magnesio_mg":0}},
    {"id":"taco-35","nome":"Óleo de soja","categoria":"Óleos e gorduras","porcao_padrao_g":10,"medida_caseira":"1 colher de sopa","por_100g":{"energia_kcal":884,"proteinas_g":0,"carboidratos_g":0,"lipidios_g":100.0,"fibras_g":0,"sodio_mg":0,"calcio_mg":0,"ferro_mg":0,"vitamina_c_mg":0,"colesterol_mg":0,"acidos_graxos_saturados_g":15.6,"acidos_graxos_mono_g":22.8,"acidos_graxos_poli_g":57.7,"potassio_mg":0,"magnesio_mg":0}},
    {"id":"taco-36","nome":"Açúcar cristal","categoria":"Açúcares e doces","porcao_padrao_g":5,"medida_caseira":"1 colher de chá","por_100g":{"energia_kcal":387,"proteinas_g":0,"carboidratos_g":99.6,"lipidios_g":0,"fibras_g":0,"sodio_mg":0,"calcio_mg":2,"ferro_mg":0.2,"vitamina_c_mg":0,"colesterol_mg":0,"acidos_graxos_saturados_g":0,"acidos_graxos_mono_g":0,"acidos_graxos_poli_g":0,"potassio_mg":3,"magnesio_mg":1}},
    {"id":"taco-37","nome":"Mel de abelha","categoria":"Açúcares e doces","porcao_padrao_g":15,"medida_caseira":"1 colher de sobremesa","por_100g":{"energia_kcal":309,"proteinas_g":0.3,"carboidratos_g":84.0,"lipidios_g":0,"fibras_g":0.2,"sodio_mg":8,"calcio_mg":5,"ferro_mg":0.3,"vitamina_c_mg":2.4,"colesterol_mg":0,"acidos_graxos_saturados_g":0,"acidos_graxos_mono_g":0,"acidos_graxos_poli_g":0,"potassio_mg":50,"magnesio_mg":2}},
    {"id":"taco-38","nome":"Café, infusão 5%","categoria":"Bebidas","porcao_padrao_g":200,"medida_caseira":"1 xícara","por_100g":{"energia_kcal":2,"proteinas_g":0.2,"carboidratos_g":0.4,"lipidios_g":0,"fibras_g":0,"sodio_mg":1,"calcio_mg":4,"ferro_mg":0.1,"vitamina_c_mg":0,"colesterol_mg":0,"acidos_graxos_saturados_g":0,"acidos_graxos_mono_g":0,"acidos_graxos_poli_g":0,"potassio_mg":64,"magnesio_mg":8}},
    {"id":"taco-39","nome":"Amendoim, torrado, sem sal","categoria":"Nozes e sementes","porcao_padrao_g":30,"medida_caseira":"1 punhado","por_100g":{"energia_kcal":603,"proteinas_g":27.0,"carboidratos_g":21.4,"lipidios_g":49.5,"fibras_g":8.0,"sodio_mg":382,"calcio_mg":54,"ferro_mg":2.3,"vitamina_c_mg":0,"colesterol_mg":0,"acidos_graxos_saturados_g":9.1,"acidos_graxos_mono_g":24.4,"acidos_graxos_poli_g":14.6,"potassio_mg":740,"magnesio_mg":178}},
    {"id":"taco-40","nome":"Castanha-do-pará","categoria":"Nozes e sementes","porcao_padrao_g":10,"medida_caseira":"1 unidade","por_100g":{"energia_kcal":643,"proteinas_g":14.3,"carboidratos_g":15.1,"lipidios_g":63.5,"fibras_g":7.9,"sodio_mg":3,"calcio_mg":160,"ferro_mg":2.4,"vitamina_c_mg":0.7,"colesterol_mg":0,"acidos_graxos_saturados_g":15.1,"acidos_graxos_mono_g":24.5,"acidos_graxos_poli_g":20.6,"potassio_mg":659,"magnesio_mg":376}},
    {"id":"taco-41","nome":"Chia, semente","categoria":"Nozes e sementes","porcao_padrao_g":15,"medida_caseira":"1 colher de sopa","por_100g":{"energia_kcal":490,"proteinas_g":16.5,"carboidratos_g":42.1,"lipidios_g":30.7,"fibras_g":34.4,"sodio_mg":16,"calcio_mg":631,"ferro_mg":7.7,"vitamina_c_mg":1.6,"colesterol_mg":0,"acidos_graxos_saturados_g":3.3,"acidos_graxos_mono_g":2.3,"acidos_graxos_poli_g":23.7,"potassio_mg":407,"magnesio_mg":335}},
    {"id":"taco-42","nome":"Linhaça, semente dourada","categoria":"Nozes e sementes","porcao_padrao_g":15,"medida_caseira":"1 colher de sopa","por_100g":{"energia_kcal":534,"proteinas_g":18.3,"carboidratos_g":28.9,"lipidios_g":42.2,"fibras_g":27.3,"sodio_mg":30,"calcio_mg":255,"ferro_mg":5.7,"vitamina_c_mg":0.6,"colesterol_mg":0,"acidos_graxos_saturados_g":3.7,"acidos_graxos_mono_g":7.5,"acidos_graxos_poli_g":28.7,"potassio_mg":813,"magnesio_mg":392}},
    {"id":"taco-43","nome":"Whey protein, concentrado","categoria":"Suplementos","porcao_padrao_g":30,"medida_caseira":"1 scoop","por_100g":{"energia_kcal":378,"proteinas_g":80.0,"carboidratos_g":8.0,"lipidios_g":4.0,"fibras_g":0,"sodio_mg":200,"calcio_mg":600,"ferro_mg":1.0,"vitamina_c_mg":0,"colesterol_mg":40,"acidos_graxos_saturados_g":2.0,"acidos_graxos_mono_g":1.0,"acidos_graxos_poli_g":0.5,"potassio_mg":450,"magnesio_mg":50}},
    {"id":"taco-44","nome":"Biscoito, cream-cracker","categoria":"Cereais e derivados","porcao_padrao_g":30,"medida_caseira":"6 unidades","por_100g":{"energia_kcal":442,"proteinas_g":9.6,"carboidratos_g":72.1,"lipidios_g":12.1,"fibras_g":3.0,"sodio_mg":769,"calcio_mg":25,"ferro_mg":2.1,"vitamina_c_mg":0,"colesterol_mg":0,"acidos_graxos_saturados_g":2.9,"acidos_graxos_mono_g":5.1,"acidos_graxos_poli_g":3.4,"potassio_mg":138,"magnesio_mg":24}},
    {"id":"taco-45","nome":"Tilápia, filé, grelhado","categoria":"Peixes e frutos do mar","porcao_padrao_g":100,"medida_caseira":"1 filé médio","por_100g":{"energia_kcal":96,"proteinas_g":20.1,"carboidratos_g":0,"lipidios_g":1.7,"fibras_g":0,"sodio_mg":52,"calcio_mg":10,"ferro_mg":0.5,"vitamina_c_mg":0,"colesterol_mg":56,"acidos_graxos_saturados_g":0.6,"acidos_graxos_mono_g":0.5,"acidos_graxos_poli_g":0.5,"potassio_mg":302,"magnesio_mg":27}},
    {"id":"taco-46","nome":"Sardinha, assada","categoria":"Peixes e frutos do mar","porcao_padrao_g":40,"medida_caseira":"2 unidades","por_100g":{"energia_kcal":185,"proteinas_g":27.0,"carboidratos_g":0,"lipidios_g":8.4,"fibras_g":0,"sodio_mg":81,"calcio_mg":354,"ferro_mg":2.2,"vitamina_c_mg":0,"colesterol_mg":90,"acidos_graxos_saturados_g":2.4,"acidos_graxos_mono_g":3.1,"acidos_graxos_poli_g":2.1,"potassio_mg":414,"magnesio_mg":39}},
    {"id":"taco-47","nome":"Carne bovina, contrafilé, grelhado","categoria":"Carnes e derivados","porcao_padrao_g":100,"medida_caseira":"1 bife médio","por_100g":{"energia_kcal":252,"proteinas_g":26.6,"carboidratos_g":0,"lipidios_g":15.8,"fibras_g":0,"sodio_mg":53,"calcio_mg":7,"ferro_mg":3.0,"vitamina_c_mg":0,"colesterol_mg":86,"acidos_graxos_saturados_g":6.2,"acidos_graxos_mono_g":7.0,"acidos_graxos_poli_g":0.7,"potassio_mg":296,"magnesio_mg":23}},
    {"id":"taco-48","nome":"Peru, peito, cozido","categoria":"Carnes e derivados","porcao_padrao_g":100,"medida_caseira":"1 fatia grossa","por_100g":{"energia_kcal":139,"proteinas_g":28.6,"carboidratos_g":0,"lipidios_g":2.3,"fibras_g":0,"sodio_mg":68,"calcio_mg":11,"ferro_mg":0.7,"vitamina_c_mg":0,"colesterol_mg":76,"acidos_graxos_saturados_g":0.6,"acidos_graxos_mono_g":0.5,"acidos_graxos_poli_g":0.6,"potassio_mg":298,"magnesio_mg":28}},
    {"id":"taco-49","nome":"Leite desnatado","categoria":"Leite e derivados","porcao_padrao_g":200,"medida_caseira":"1 copo","por_100g":{"energia_kcal":35,"proteinas_g":3.4,"carboidratos_g":4.8,"lipidios_g":0.1,"fibras_g":0,"sodio_mg":47,"calcio_mg":123,"ferro_mg":0.1,"vitamina_c_mg":1.0,"colesterol_mg":2,"acidos_graxos_saturados_g":0.1,"acidos_graxos_mono_g":0,"acidos_graxos_poli_g":0,"potassio_mg":156,"magnesio_mg":12}},
    {"id":"taco-50","nome":"Queijo ricota","categoria":"Leite e derivados","porcao_padrao_g":50,"medida_caseira":"2 colheres de sopa","por_100g":{"energia_kcal":164,"proteinas_g":11.3,"carboidratos_g":2.0,"lipidios_g":12.6,"fibras_g":0,"sodio_mg":104,"calcio_mg":204,"ferro_mg":0.3,"vitamina_c_mg":0,"colesterol_mg":46,"acidos_graxos_saturados_g":7.9,"acidos_graxos_mono_g":3.7,"acidos_graxos_poli_g":0.4,"potassio_mg":125,"magnesio_mg":10}},
    {"id":"taco-51","nome":"Couve, refogada","categoria":"Hortaliças e derivados","porcao_padrao_g":35,"medida_caseira":"1 colher de servir","por_100g":{"energia_kcal":64,"proteinas_g":3.0,"carboidratos_g":8.7,"lipidios_g":2.4,"fibras_g":3.6,"sodio_mg":44,"calcio_mg":199,"ferro_mg":1.6,"vitamina_c_mg":107.0,"colesterol_mg":0,"acidos_graxos_saturados_g":0.3,"acidos_graxos_mono_g":1.6,"acidos_graxos_poli_g":0.3,"potassio_mg":460,"magnesio_mg":46}},
    {"id":"taco-52","nome":"Mandioca, cozida","categoria":"Hortaliças e derivados","porcao_padrao_g":100,"medida_caseira":"2 pedaços médios","por_100g":{"energia_kcal":125,"proteinas_g":0.6,"carboidratos_g":30.1,"lipidios_g":0.3,"fibras_g":1.9,"sodio_mg":7,"calcio_mg":18,"ferro_mg":0.3,"vitamina_c_mg":19.1,"colesterol_mg":0,"acidos_graxos_saturados_g":0.1,"acidos_graxos_mono_g":0.1,"acidos_graxos_poli_g":0.1,"potassio_mg":271,"magnesio_mg":25}},
    {"id":"taco-53","nome":"Milho verde, cozido","categoria":"Cereais e derivados","porcao_padrao_g":85,"medida_caseira":"3 colheres de sopa","por_100g":{"energia_kcal":90,"proteinas_g":3.1,"carboidratos_g":18.8,"lipidios_g":1.3,"fibras_g":2.0,"sodio_mg":1,"calcio_mg":2,"ferro_mg":0.8,"vitamina_c_mg":11.5,"colesterol_mg":0,"acidos_graxos_saturados_g":0.2,"acidos_graxos_mono_g":0.4,"acidos_graxos_poli_g":0.6,"potassio_mg":270,"magnesio_mg":37}},
    {"id":"taco-54","nome":"Quinoa, cozida","categoria":"Cereais e derivados","porcao_padrao_g":100,"medida_caseira":"4 colheres de sopa","por_100g":{"energia_kcal":120,"proteinas_g":4.4,"carboidratos_g":21.3,"lipidios_g":1.9,"fibras_g":2.8,"sodio_mg":7,"calcio_mg":17,"ferro_mg":1.5,"vitamina_c_mg":0,"colesterol_mg":0,"acidos_graxos_saturados_g":0.2,"acidos_graxos_mono_g":0.5,"acidos_graxos_poli_g":1.0,"potassio_mg":172,"magnesio_mg":64}},
]

async def seed_alimentos():
    for item in _TACO_SEED:
        existing = await db.alimentos.find_one({"id": item["id"]})
        if not existing:
            await db.alimentos.insert_one({**item, "fonte": "TACO", "criado_em": iso(now_utc())})

class AlimentoCustomIn(BaseModel):
    nome: str
    categoria: str = "Outros"
    porcao_padrao_g: float = 100
    medida_caseira: str = "100g"
    por_100g: dict

_GRUPOS_ALIMENTARES = [
    "Carnes e Proteínas",
    "Cereais, Raízes, Tubérculos e Frutos",
    "Feijão e Leguminosas",
    "Fibras A",
    "Fibras B",
    "Frutas",
    "Frutas Oleosas",
    "Leite e Derivados",
    "Livres",
    "Oleaginosas e Sementes",
    "Outros",
    "Pães e Variedades",
    "Sucos Naturais e Integrais",
    "Vegetais A (livres para o consumo)",
    "Vegetais B",
    "Óleos e Gorduras",
]

_MEASURES_WIDE_PATH = ROOT_DIR.parent / "frontend" / "public" / "data" / "cadastro_medidas_caseiras_evonut_wide.csv"
_EQUIVALENTES_PATH = ROOT_DIR / "equivalentes_evonut.json"
_MEASURE_RESERVED_COLUMNS = {"descricao do alimento", "alimento", "grupo"}

def _normalize_food_lookup(text: str) -> str:
    if not text:
        return ""
    s = unicodedata.normalize("NFKD", str(text)).encode("ascii", "ignore").decode("ascii")
    s = s.replace("®", " ").replace("@", " ").replace("/", " ").replace("|", " ")
    s = re.sub(r"[^a-zA-Z0-9]+", " ", s).strip().lower()
    return re.sub(r"\s+", " ", s)

def _normalize_lookup_header(text: str) -> str:
    if not text:
        return ""
    s = unicodedata.normalize("NFKD", str(text)).encode("ascii", "ignore").decode("ascii")
    s = re.sub(r"[^a-zA-Z0-9]+", " ", s).strip().lower()
    return re.sub(r"\s+", " ", s)

def _food_lookup_aliases(text: str) -> list[str]:
    raw = str(text or "").strip()
    aliases: list[str] = []

    def add(value: str) -> None:
        norm = _normalize_food_lookup(value)
        if norm and norm not in aliases:
            aliases.append(norm)

    add(raw)
    raw_no_paren = re.sub(r"\([^)]*\)", " ", raw)
    add(raw_no_paren)
    raw_no_source = re.sub(r"\b(ibge|tbca|taco|tucunduva)\b", " ", raw_no_paren, flags=re.IGNORECASE)
    add(raw_no_source)
    add(re.sub(r"\s*,\s*", " ", raw_no_source))
    return aliases

def _find_csv_header(fieldnames: list[str], *candidates: str) -> Optional[str]:
    wanted = {_normalize_lookup_header(candidate) for candidate in candidates if candidate}
    for fieldname in fieldnames or []:
        if _normalize_lookup_header(fieldname) in wanted:
            return fieldname
    return None

def _score_lookup_match(target: str, candidate: str) -> float:
    if not target or not candidate:
        return 0.0
    if target == candidate:
        return 10.0
    score = SequenceMatcher(None, target, candidate).ratio() * 5
    target_tokens = set(target.split())
    candidate_tokens = set(candidate.split())
    score += len(target_tokens & candidate_tokens) * 1.5
    if candidate in target or target in candidate:
        score += 2.5
    if target.split()[:2] == candidate.split()[:2]:
        score += 1.0
    return score

def _select_best_lookup_key(target: str, candidates: list[str]) -> Optional[str]:
    scored = sorted(
        ((candidate, _score_lookup_match(target, candidate)) for candidate in candidates if candidate),
        key=lambda item: item[1],
        reverse=True,
    )
    if not scored or scored[0][1] < 4.5:
        return None
    return scored[0][0]

def _coerce_float(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    txt = str(value).strip()
    if not txt:
        return None
    if "," in txt and "." in txt:
        txt = txt.replace(".", "").replace(",", ".")
    else:
        txt = txt.replace(",", ".")
    try:
        return float(txt)
    except Exception:
        return None

@lru_cache(maxsize=1)
def _load_measures_index() -> dict:
    if not _MEASURES_WIDE_PATH.exists():
        return {"exact": {}, "alias": {}}
    exact_index: dict[str, list[dict]] = {}
    alias_index: dict[str, set[str]] = defaultdict(set)
    with _MEASURES_WIDE_PATH.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        name_key = _find_csv_header(reader.fieldnames or [], "descricao do alimento", "alimento")
        if not name_key:
            return {"exact": {}, "alias": {}}
        for row in reader:
            alimento_nome = (row.get(name_key) or "").strip()
            if not alimento_nome:
                continue
            key = _normalize_food_lookup(alimento_nome)
            measures = []
            for col, raw in row.items():
                if _normalize_lookup_header(col) in _MEASURE_RESERVED_COLUMNS:
                    continue
                grams = _coerce_float(raw)
                if grams is None or grams <= 0:
                    continue
                measures.append({"nome": col.strip(), "gramas": round(grams, 2)})
            if measures:
                # preserve order while deduplicating by name
                seen = set()
                unique = []
                for item in measures:
                    n = item["nome"].lower()
                    if n in seen:
                        continue
                    seen.add(n)
                    unique.append(item)
                exact_index[key] = unique
                for alias in _food_lookup_aliases(alimento_nome):
                    alias_index[alias].add(key)
    return {"exact": exact_index, "alias": {k: sorted(v) for k, v in alias_index.items()}}

@lru_cache(maxsize=1)
def _load_equivalentes_index() -> list[dict]:
    if not _EQUIVALENTES_PATH.exists():
        return []
    try:
        data = json.loads(_EQUIVALENTES_PATH.read_text(encoding="utf-8"))
    except Exception:
        return []
    for item in data:
        item["opcoes"] = [opt for opt in (item.get("opcoes") or item.get("equivalentes") or []) if (opt or {}).get("nome")]
        aliases = set(_food_lookup_aliases(item.get("base_nome", "")))
        aliases.update(_food_lookup_aliases(str(item.get("base_display") or "").split("|", 1)[0].strip()))
        item["_norm_aliases"] = sorted(alias for alias in aliases if alias)
        for opt in item.get("opcoes", []):
            opt["_norm"] = _normalize_food_lookup(opt.get("nome", ""))
    return data

def _get_measures_for_food_name(food_name: str) -> list[dict]:
    indexes = _load_measures_index()
    exact_index = indexes.get("exact", {})
    alias_index = indexes.get("alias", {})
    candidates: list[str] = []
    for alias in _food_lookup_aliases(food_name):
        if alias in exact_index:
            return list(exact_index.get(alias, []))
        candidates.extend(alias_index.get(alias, []))
    best_key = _select_best_lookup_key(_normalize_food_lookup(food_name), list(dict.fromkeys(candidates)))
    if best_key:
        return list(exact_index.get(best_key, []))
    return []

def _find_equivalente_entry(food_name: str) -> Optional[dict]:
    target = _normalize_food_lookup(food_name)
    if not target:
        return None
    entries = _load_equivalentes_index()
    best_item = None
    best_score = 0.0
    for item in entries:
        for alias in item.get("_norm_aliases", []):
            if alias == target:
                return item
            score = _score_lookup_match(target, alias)
            if score > best_score:
                best_score = score
                best_item = item
    return best_item if best_score >= 4.5 else None

def _resolve_quantidade_g(alimento: dict, medida_nome: Optional[str], quantidade: Optional[float], quantidade_g: Optional[float]) -> float:
    grams_direct = _coerce_float(quantidade_g)
    if grams_direct is not None and grams_direct > 0:
        return round(grams_direct, 2)
    qty = _coerce_float(quantidade) or 0.0
    medida = (medida_nome or "").strip().lower()
    if not medida or medida == "gramas":
        return round(qty, 2)
    all_measures = []
    base_measure = alimento.get("medida_caseira")
    base_grams = _coerce_float(alimento.get("porcao_padrao_g") or alimento.get("quantidade_referencia_g"))
    if base_measure and base_grams:
        all_measures.append({"nome": base_measure, "gramas": base_grams})
    all_measures.extend(_get_measures_for_food_name(alimento.get("nome", "")))
    for item in all_measures:
        if item["nome"].strip().lower() == medida:
            return round((item.get("gramas") or 0) * qty, 2)
    return round(qty, 2)

async def _resolve_alimento_light_by_name(nome: str) -> Optional[dict]:
    if not nome:
        return None
    projection = {"_id": 0, "id": 1, "nome": 1, "grupo": 1, "categoria": 1, "fonte": 1, "porcao_padrao_g": 1, "quantidade_referencia_g": 1, "nutrientes": 1, "por_100g": 1}
    exact = await db.alimentos.find_one({"nome": {"$regex": f"^{re.escape(nome)}$", "$options": "i"}}, projection)
    if exact:
        return exact
    token = re.sub(r"[^a-zA-Z0-9 ]+", " ", nome).strip().split()
    if not token:
        return None
    prefix = " ".join(token[:3])
    candidates = await db.alimentos.find({"nome": {"$regex": re.escape(prefix), "$options": "i"}}, projection).limit(25).to_list(25)
    target_norm = _normalize_food_lookup(nome)
    for cand in candidates:
        cand_norm = _normalize_food_lookup(cand.get("nome", ""))
        if cand_norm == target_norm or cand_norm in target_norm or target_norm in cand_norm:
            return cand
    return candidates[0] if candidates else None

@api.get("/alimentos/grupos")
async def list_grupos(user=Depends(require_nutritionist)):
    return _GRUPOS_ALIMENTARES

@api.get("/alimentos")
async def search_alimentos(
    q: str = "",
    grupo: str = "",
    categoria: str = "",
    fonte: str = "",
    page: int = 1,
    limit: int = 50,
    user=Depends(require_nutritionist),
):
    filt: dict = {}
    if q:
        filt["nome"] = {"$regex": q, "$options": "i"}
    if grupo:
        filt["grupo"] = grupo
    if categoria:
        filt["categoria"] = {"$regex": categoria, "$options": "i"}
    if fonte == "CUSTOM":
        filt["nutricionista_id"] = user["id"]
    elif fonte in ("TACO", "IBGE", "TBCA", "Tucunduva"):
        filt["fonte"] = fonte
        filt["nutricionista_id"] = {"$exists": False}
    else:
        # Todos os alimentos do banco (evonut + taco legacy) + custom do nutricionista
        filt["$or"] = [
            {"nutricionista_id": {"$exists": False}},
            {"nutricionista_id": user["id"]},
        ]
    skip = (page - 1) * limit
    total = await db.alimentos.count_documents(filt)
    cursor = db.alimentos.find(filt, {"_id": 0}).skip(skip).limit(limit).sort("nome", 1)
    items = []
    async for a in cursor:
        # Normaliza campos de display para ambos os formatos (evonut e legado TACO/CUSTOM)
        if "nutrientes" in a:
            n = a.pop("nutrientes") or {}
            a["energia_kcal_100g"] = n.get("energia_kcal")
            a["grupo_display"] = a.get("grupo")
        else:
            p = a.get("por_100g") or {}
            a["energia_kcal_100g"] = p.get("energia_kcal")
            a["grupo_display"] = a.get("grupo") or a.get("categoria")
        items.append(a)
    return {"total": total, "page": page, "limit": limit, "items": items}

@api.get("/alimentos/{aid}")
async def get_alimento(aid: str, user=Depends(require_nutritionist)):
    doc = await db.alimentos.find_one({"id": aid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Alimento não encontrado")
    return doc

@api.get("/alimentos/{aid}/medidas")
async def get_alimento_medidas(aid: str, user=Depends(require_nutritionist)):
    doc = await db.alimentos.find_one({"id": aid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Alimento não encontrado")
    measures = [{"nome": "Gramas", "gramas": 1.0, "origem": "sistema"}]
    base_grams = _coerce_float(doc.get("porcao_padrao_g") or doc.get("quantidade_referencia_g"))
    base_measure = doc.get("medida_caseira")
    if base_measure and base_grams:
        measures.append({"nome": str(base_measure), "gramas": round(base_grams, 2), "origem": "alimento"})
    for item in _get_measures_for_food_name(doc.get("nome", "")):
        measures.append({**item, "origem": "tabela_medidas"})
    unique = []
    seen = set()
    for item in measures:
        key = item["nome"].strip().lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return {"alimento_id": aid, "alimento_nome": doc.get("nome"), "medidas": unique}

@api.get("/alimentos/{aid}/equivalentes")
async def get_alimento_equivalentes(aid: str, user=Depends(require_nutritionist)):
    doc = await db.alimentos.find_one({"id": aid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Alimento não encontrado")
    entry = _find_equivalente_entry(doc.get("nome", ""))
    if not entry:
        return {"alimento_id": aid, "alimento_nome": doc.get("nome"), "equivalentes": []}
    options = []
    for raw in entry.get("opcoes", []):
        resolved = await _resolve_alimento_light_by_name(raw.get("nome", ""))
        energia = None
        if resolved:
            if "nutrientes" in resolved:
                energia = (resolved.get("nutrientes") or {}).get("energia_kcal")
            else:
                energia = (resolved.get("por_100g") or {}).get("energia_kcal")
        options.append({
            "nome": raw.get("nome"),
            "medida_nome": raw.get("medida_nome") or "Gramas",
            "quantidade": raw.get("quantidade"),
            "alimento_id": resolved.get("id") if resolved else None,
            "grupo": (resolved or {}).get("grupo") or (resolved or {}).get("categoria"),
            "fonte": (resolved or {}).get("fonte"),
            "energia_kcal_100g": energia,
        })
    return {
        "alimento_id": aid,
        "alimento_nome": doc.get("nome"),
        "base_quantidade_g": entry.get("base_quantidade_g"),
        "descricao": entry.get("descricao"),
        "equivalentes": options,
    }

class AlimentoCalcIn(BaseModel):
    alimento_id: str
    quantidade_g: float

@api.post("/alimentos/calcular")
async def calcular_porcao(payload: AlimentoCalcIn, user=Depends(require_nutritionist)):
    doc = await db.alimentos.find_one({"id": payload.alimento_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Alimento não encontrado")
    nutr = _nutrientes_por_porcao(doc, payload.quantidade_g)
    return {
        "alimento_id": payload.alimento_id,
        "nome": doc.get("nome"),
        "grupo": doc.get("grupo"),
        "quantidade_g": payload.quantidade_g,
        "nutrientes": nutr,
    }

@api.post("/alimentos", status_code=201)
async def create_alimento(payload: AlimentoCustomIn, user=Depends(require_nutritionist)):
    doc = {
        "id": str(uuid.uuid4()),
        "nome": payload.nome,
        "categoria": payload.categoria,
        "fonte": "CUSTOM",
        "nutricionista_id": user["id"],
        "porcao_padrao_g": payload.porcao_padrao_g,
        "medida_caseira": payload.medida_caseira,
        "por_100g": payload.por_100g,
        "criado_em": iso(now_utc()),
    }
    await db.alimentos.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}

@api.put("/alimentos/{aid}")
async def update_alimento(aid: str, payload: AlimentoCustomIn, user=Depends(require_nutritionist)):
    existing = await db.alimentos.find_one({"id": aid})
    if not existing:
        raise HTTPException(404, "Alimento não encontrado")
    if not existing.get("nutricionista_id"):
        raise HTTPException(403, "Alimentos do banco não podem ser editados")
    if existing.get("nutricionista_id") != user["id"]:
        raise HTTPException(403, "Sem permissão")
    upd = {**payload.model_dump(), "atualizado_em": iso(now_utc())}
    await db.alimentos.update_one({"id": aid}, {"$set": upd})
    return await db.alimentos.find_one({"id": aid}, {"_id": 0})

@api.delete("/alimentos/{aid}")
async def delete_alimento(aid: str, user=Depends(require_nutritionist)):
    existing = await db.alimentos.find_one({"id": aid})
    if not existing:
        raise HTTPException(404, "Alimento não encontrado")
    if not existing.get("nutricionista_id"):
        raise HTTPException(403, "Alimentos do banco não podem ser excluídos")
    if existing.get("nutricionista_id") != user["id"]:
        raise HTTPException(403, "Sem permissão")
    await db.alimentos.delete_one({"id": aid})
    return {"ok": True}

# ── Plano Alimentar Manual ────────────────────────────────────────

def _nutrientes_por_porcao(alimento: dict, quantidade_g: float) -> dict:
    ref_g = alimento.get("quantidade_referencia_g", 100.0) or 100.0
    f = quantidade_g / ref_g
    # Formato EVONUT: campo "nutrientes" com nomes diferentes
    if "nutrientes" in alimento:
        n = alimento["nutrientes"]
        return {
            "energia_kcal":    round((n.get("energia_kcal") or 0) * f, 2),
            "proteinas_g":     round((n.get("proteina_g") or 0) * f, 2),
            "carboidratos_g":  round((n.get("carboidrato_g") or 0) * f, 2),
            "lipidios_g":      round((n.get("lipideos_g") or 0) * f, 2),
            "fibras_g":        round((n.get("fibra_g") or 0) * f, 2),
            "sodio_mg":        round((n.get("sodio_mg") or 0) * f, 2),
            "calcio_mg":       round((n.get("calcio_mg") or 0) * f, 2),
            "ferro_mg":        round((n.get("ferro_mg") or 0) * f, 2),
            "vitamina_c_mg":   round((n.get("vit_c_mg") or 0) * f, 2),
            "colesterol_mg":   round((n.get("colesterol_mg") or 0) * f, 2),
            "potassio_mg":     round((n.get("potassio_mg") or 0) * f, 2),
            "magnesio_mg":     round((n.get("magnesio_mg") or 0) * f, 2),
            "ag_saturados_g":  round((n.get("ag_saturados_g") or 0) * f, 2),
            "ag_mono_g":       round((n.get("ag_monoinsat_g") or 0) * f, 2),
            "ag_poli_g":       round((n.get("ag_poliinsat_g") or 0) * f, 2),
            "ag_trans_g":      round((n.get("ag_trans_g") or 0) * f, 2),
            "zinco_mg":        round((n.get("zinco_mg") or 0) * f, 2),
            "selenio_mcg":     round((n.get("selenio_mcg") or 0) * f, 2),
            "vitamina_a_mcg":  round((n.get("vitamina_a_mcg") or 0) * f, 2),
            "vitamina_d_mcg":  round((n.get("vit_d_mcg") or 0) * f, 2),
            "vitamina_e_mg":   round((n.get("vit_e_mg") or 0) * f, 2),
            "vitamina_b12_mcg":round((n.get("vit_b12_mcg") or 0) * f, 2),
            "folato_mcg":      round((n.get("folato_mcg") or 0) * f, 2),
        }
    # Formato legado TACO / CUSTOM: campo "por_100g"
    p = alimento.get("por_100g", {})
    f2 = quantidade_g / 100.0
    keys = ["energia_kcal","proteinas_g","carboidratos_g","lipidios_g","fibras_g",
            "sodio_mg","calcio_mg","ferro_mg","vitamina_c_mg","colesterol_mg",
            "potassio_mg","magnesio_mg"]
    return {k: round((p.get(k) or 0) * f2, 2) for k in keys}

class AlimentoPlanoItem(BaseModel):
    alimento_id: str
    quantidade_g: Optional[float] = None
    medida_nome: str = "Gramas"
    quantidade: Optional[float] = None
    substituivel: bool = True
    observacao: Optional[str] = None

class RefeicaoPlano(BaseModel):
    nome: str
    horario: Optional[str] = None
    meta_kcal: Optional[float] = None
    meta_pct: Optional[float] = None
    alimentos: List[AlimentoPlanoItem] = []

class OrientacaoNutricionalIn(BaseModel):
    titulo: str
    categoria: Optional[str] = None
    objetivos: List[str] = []
    tags: List[str] = []
    conteudo: str
    ativo: bool = True

class PlanoManualIn(BaseModel):
    titulo: str = "Plano Alimentar"
    objetivo: Optional[str] = None
    meta_kcal: Optional[float] = None
    meta_proteina_g: Optional[float] = None
    meta_carboidrato_g: Optional[float] = None
    meta_lipidio_g: Optional[float] = None
    orientacao_ids: List[str] = []
    refeicoes: List[RefeicaoPlano] = []
    observacoes: Optional[str] = None

class PlanoTemplateIn(BaseModel):
    nome: str
    categoria: Optional[str] = None
    descricao: Optional[str] = None
    objetivo: Optional[str] = None
    meta_kcal: Optional[float] = None
    meta_proteina_g: Optional[float] = None
    meta_carboidrato_g: Optional[float] = None
    meta_lipidio_g: Optional[float] = None
    orientacao_ids: List[str] = []
    refeicoes: List[RefeicaoPlano] = []
    observacoes: Optional[str] = None

async def _resolve_orientacoes(ids: list[str], user_id: str) -> list[dict]:
    clean_ids = [oid for oid in ids or [] if oid]
    if not clean_ids:
        return []
    rows = [d async for d in db.orientacoes_nutricionais.find(
        {"id": {"$in": clean_ids}, "nutricionista_id": user_id},
        {"_id": 0}
    )]
    by_id = {row["id"]: row for row in rows}
    return [by_id[oid] for oid in clean_ids if oid in by_id]

async def _create_plano_snapshot(doc: dict, motivo: str, user_id: str):
    snapshot = {k: v for k, v in doc.items() if k != "_id"}
    await db.planos_manuais_historico.insert_one({
        "id": str(uuid.uuid4()),
        "plano_id": snapshot.get("id"),
        "paciente_id": snapshot.get("paciente_id"),
        "nutricionista_id": user_id,
        "motivo": motivo,
        "snapshot": snapshot,
        "criado_em": iso(now_utc()),
    })

async def _enrich_plano_template(doc: dict) -> dict:
    orientacoes = await _resolve_orientacoes(doc.get("orientacao_ids") or [], doc.get("nutricionista_id"))
    return {**doc, "orientacoes": orientacoes}

async def _enrich_plano(doc: dict) -> dict:
    refeicoes_out = []
    ref_rows = []
    totais_dia = {k: 0.0 for k in ["energia_kcal","proteinas_g","carboidratos_g","lipidios_g","fibras_g","sodio_mg"]}
    metas_dia = {
        "energia_kcal": _coerce_float(doc.get("meta_kcal")),
        "proteinas_g": _coerce_float(doc.get("meta_proteina_g")),
        "carboidratos_g": _coerce_float(doc.get("meta_carboidrato_g")),
        "lipidios_g": _coerce_float(doc.get("meta_lipidio_g")),
    }
    for ref in doc.get("refeicoes", []):
        alimentos_out = []
        totais_ref = {k: 0.0 for k in totais_dia}
        for item in ref.get("alimentos", []):
            alim = await db.alimentos.find_one({"id": item.get("alimento_id")}, {"_id": 0})
            if not alim:
                continue
            resolved_g = _resolve_quantidade_g(alim, item.get("medida_nome"), item.get("quantidade"), item.get("quantidade_g"))
            nutr = _nutrientes_por_porcao(alim, resolved_g)
            for k in totais_ref:
                totais_ref[k] = round(totais_ref[k] + nutr.get(k, 0), 2)
            measures = [{"nome": "Gramas", "gramas": 1.0}]
            base_measure = alim.get("medida_caseira")
            base_grams = _coerce_float(alim.get("porcao_padrao_g") or alim.get("quantidade_referencia_g"))
            if base_measure and base_grams:
                measures.append({"nome": str(base_measure), "gramas": round(base_grams, 2)})
            for m in _get_measures_for_food_name(alim.get("nome", "")):
                if m["nome"].strip().lower() not in {x["nome"].strip().lower() for x in measures}:
                    measures.append(m)
            alimentos_out.append({
                **item,
                "quantidade_g": resolved_g,
                "quantidade": _coerce_float(item.get("quantidade")) if item.get("quantidade") is not None else resolved_g,
                "medida_nome": item.get("medida_nome") or "Gramas",
                "alimento_nome": alim.get("nome", ""),
                "grupo": alim.get("grupo") or alim.get("categoria"),
                "medidas": measures,
                "nutrientes": nutr,
            })
        for k in totais_dia:
            totais_dia[k] = round(totais_dia[k] + totais_ref.get(k, 0), 2)
        meta_kcal = _coerce_float(ref.get("meta_kcal"))
        saldo_kcal = round(totais_ref["energia_kcal"] - meta_kcal, 2) if meta_kcal is not None else None
        ref_rows.append({**ref, "alimentos": alimentos_out, "totais": totais_ref, "saldo_kcal": saldo_kcal})
    for ref in ref_rows:
        pct_dia = round((ref["totais"]["energia_kcal"] / totais_dia["energia_kcal"]) * 100, 1) if totais_dia["energia_kcal"] > 0 else None
        refeicoes_out.append({**ref, "pct_energia_dia": pct_dia})
    saldo_dia = {}
    for k, meta in metas_dia.items():
        saldo_dia[k] = round((totais_dia.get(k, 0) or 0) - meta, 2) if meta is not None else None
    orientacoes = await _resolve_orientacoes(doc.get("orientacao_ids") or [], doc.get("nutricionista_id"))
    return {**doc, "refeicoes": refeicoes_out, "totais_dia": totais_dia, "saldos_dia": saldo_dia, "orientacoes": orientacoes}

@api.get("/orientacoes")
async def list_orientacoes(
    q: str = "",
    categoria: str = "",
    objetivo: str = "",
    ativos: Optional[bool] = None,
    user=Depends(require_nutritionist),
):
    filt: dict[str, Any] = {"nutricionista_id": user["id"]}
    if q.strip():
        filt["$or"] = [
            {"titulo": {"$regex": re.escape(q.strip()), "$options": "i"}},
            {"conteudo": {"$regex": re.escape(q.strip()), "$options": "i"}},
            {"tags": {"$elemMatch": {"$regex": re.escape(q.strip()), "$options": "i"}}},
        ]
    if categoria.strip():
        filt["categoria"] = categoria.strip()
    if objetivo.strip():
        filt["objetivos"] = objetivo.strip()
    if ativos is not None:
        filt["ativo"] = ativos
    return [d async for d in db.orientacoes_nutricionais.find(filt, {"_id": 0}).sort("atualizado_em", -1)]

@api.post("/orientacoes", status_code=201)
async def create_orientacao(payload: OrientacaoNutricionalIn, user=Depends(require_nutritionist)):
    now = iso(now_utc())
    doc = {
        "id": str(uuid.uuid4()),
        "nutricionista_id": user["id"],
        "titulo": payload.titulo.strip()[:140],
        "categoria": (payload.categoria or "").strip()[:80] or None,
        "objetivos": [str(item).strip()[:60] for item in payload.objetivos if str(item).strip()],
        "tags": [str(item).strip()[:40] for item in payload.tags if str(item).strip()],
        "conteudo": payload.conteudo.strip()[:4000],
        "ativo": payload.ativo,
        "criado_em": now,
        "atualizado_em": now,
    }
    await db.orientacoes_nutricionais.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}

@api.put("/orientacoes/{oid}")
async def update_orientacao(oid: str, payload: OrientacaoNutricionalIn, user=Depends(require_nutritionist)):
    existing = await db.orientacoes_nutricionais.find_one({"id": oid, "nutricionista_id": user["id"]})
    if not existing:
        raise HTTPException(404, "Orientação não encontrada")
    upd = {
        "titulo": payload.titulo.strip()[:140],
        "categoria": (payload.categoria or "").strip()[:80] or None,
        "objetivos": [str(item).strip()[:60] for item in payload.objetivos if str(item).strip()],
        "tags": [str(item).strip()[:40] for item in payload.tags if str(item).strip()],
        "conteudo": payload.conteudo.strip()[:4000],
        "ativo": payload.ativo,
        "atualizado_em": iso(now_utc()),
    }
    await db.orientacoes_nutricionais.update_one({"id": oid}, {"$set": upd})
    return await db.orientacoes_nutricionais.find_one({"id": oid}, {"_id": 0})

@api.delete("/orientacoes/{oid}")
async def delete_orientacao(oid: str, user=Depends(require_nutritionist)):
    res = await db.orientacoes_nutricionais.delete_one({"id": oid, "nutricionista_id": user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Orientação não encontrada")
    await db.planos_manuais.update_many(
        {"nutricionista_id": user["id"], "orientacao_ids": oid},
        {"$pull": {"orientacao_ids": oid}, "$set": {"atualizado_em": iso(now_utc())}},
    )
    return {"ok": True}

@api.get("/patients/{pid}/planos-manuais")
async def list_planos_manuais(pid: str, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    docs = [d async for d in db.planos_manuais.find({"paciente_id": pid}, {"_id": 0}).sort("criado_em", -1)]
    return [await _enrich_plano(d) for d in docs]

@api.get("/plano-templates")
async def list_plano_templates(q: str = "", user=Depends(require_nutritionist)):
    filt: dict[str, Any] = {"nutricionista_id": user["id"]}
    if q.strip():
        filt["$or"] = [
            {"nome": {"$regex": re.escape(q.strip()), "$options": "i"}},
            {"categoria": {"$regex": re.escape(q.strip()), "$options": "i"}},
            {"descricao": {"$regex": re.escape(q.strip()), "$options": "i"}},
        ]
    docs = [d async for d in db.plano_templates.find(filt, {"_id": 0}).sort("atualizado_em", -1)]
    return [await _enrich_plano_template(d) for d in docs]

@api.post("/plano-templates", status_code=201)
async def create_plano_template(payload: PlanoTemplateIn, user=Depends(require_nutritionist)):
    now = iso(now_utc())
    doc = {
        "id": str(uuid.uuid4()),
        "nutricionista_id": user["id"],
        **payload.model_dump(),
        "criado_em": now,
        "atualizado_em": now,
    }
    await db.plano_templates.insert_one(doc)
    return await _enrich_plano_template({k: v for k, v in doc.items() if k != "_id"})

@api.post("/patients/{pid}/planos-manuais/{pmid}/template", status_code=201)
async def create_template_from_plano(
    pid: str,
    pmid: str,
    payload: Optional[dict] = None,
    user=Depends(require_nutritionist),
):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    doc = await db.planos_manuais.find_one({"id": pmid, "paciente_id": pid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Plano não encontrado")
    body = payload or {}
    now = iso(now_utc())
    template = {
        "id": str(uuid.uuid4()),
        "nutricionista_id": user["id"],
        "nome": str(body.get("nome") or doc.get("titulo") or "Template de plano")[:140],
        "categoria": (str(body.get("categoria") or "").strip() or None),
        "descricao": (str(body.get("descricao") or "").strip() or None),
        "objetivo": doc.get("objetivo"),
        "meta_kcal": doc.get("meta_kcal"),
        "meta_proteina_g": doc.get("meta_proteina_g"),
        "meta_carboidrato_g": doc.get("meta_carboidrato_g"),
        "meta_lipidio_g": doc.get("meta_lipidio_g"),
        "orientacao_ids": doc.get("orientacao_ids") or [],
        "refeicoes": doc.get("refeicoes") or [],
        "observacoes": doc.get("observacoes"),
        "origem_plano_id": pmid,
        "criado_em": now,
        "atualizado_em": now,
    }
    await db.plano_templates.insert_one(template)
    return await _enrich_plano_template({k: v for k, v in template.items() if k != "_id"})

@api.post("/patients/{pid}/plano-templates/{tid}/aplicar", status_code=201)
async def apply_plano_template(pid: str, tid: str, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    template = await db.plano_templates.find_one({"id": tid, "nutricionista_id": user["id"]}, {"_id": 0})
    if not template:
        raise HTTPException(404, "Template não encontrado")
    latest = await db.planos_manuais.find_one({"paciente_id": pid}, {"versao": 1}, sort=[("versao", -1)])
    now = iso(now_utc())
    doc = {
        "id": str(uuid.uuid4()),
        "paciente_id": pid,
        "nutricionista_id": user["id"],
        "titulo": template.get("nome") or "Plano Alimentar",
        "objetivo": template.get("objetivo"),
        "meta_kcal": template.get("meta_kcal"),
        "meta_proteina_g": template.get("meta_proteina_g"),
        "meta_carboidrato_g": template.get("meta_carboidrato_g"),
        "meta_lipidio_g": template.get("meta_lipidio_g"),
        "orientacao_ids": template.get("orientacao_ids") or [],
        "refeicoes": template.get("refeicoes") or [],
        "observacoes": template.get("observacoes"),
        "versao": int((latest or {}).get("versao") or 0) + 1,
        "origem_template_id": tid,
        "criado_em": now,
        "atualizado_em": now,
    }
    await db.planos_manuais.insert_one(doc)
    await _create_plano_snapshot(doc, "apply_template", user["id"])
    return await _enrich_plano({k: v for k, v in doc.items() if k != "_id"})

@api.post("/patients/{pid}/planos-manuais", status_code=201)
async def create_plano_manual(pid: str, payload: PlanoManualIn, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    latest = await db.planos_manuais.find_one({"paciente_id": pid}, {"versao": 1}, sort=[("versao", -1)])
    doc = {
        "id": str(uuid.uuid4()),
        "paciente_id": pid,
        "nutricionista_id": user["id"],
        **payload.model_dump(),
        "versao": int((latest or {}).get("versao") or 0) + 1,
        "criado_em": iso(now_utc()),
        "atualizado_em": iso(now_utc()),
    }
    await db.planos_manuais.insert_one(doc)
    await _create_plano_snapshot(doc, "create", user["id"])
    return await _enrich_plano({k: v for k, v in doc.items() if k != "_id"})

@api.get("/patients/{pid}/planos-manuais/{pmid}")
async def get_plano_manual(pid: str, pmid: str, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    doc = await db.planos_manuais.find_one({"id": pmid, "paciente_id": pid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Plano não encontrado")
    return await _enrich_plano(doc)

@api.put("/patients/{pid}/planos-manuais/{pmid}")
async def update_plano_manual(pid: str, pmid: str, payload: PlanoManualIn, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    doc = await db.planos_manuais.find_one({"id": pmid, "paciente_id": pid})
    if not doc:
        raise HTTPException(404, "Plano não encontrado")
    await _create_plano_snapshot(doc, "update_before", user["id"])
    upd = {**payload.model_dump(), "atualizado_em": iso(now_utc())}
    await db.planos_manuais.update_one({"id": pmid}, {"$set": upd})
    updated = await db.planos_manuais.find_one({"id": pmid}, {"_id": 0})
    await _create_plano_snapshot(updated, "update_after", user["id"])
    return await _enrich_plano(updated)

@api.get("/patients/{pid}/planos-manuais/{pmid}/historico")
async def list_plano_manual_historico(pid: str, pmid: str, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente nÃ£o encontrado")
    return [d async for d in db.planos_manuais_historico.find(
        {"plano_id": pmid, "paciente_id": pid, "nutricionista_id": user["id"]},
        {"_id": 0}
    ).sort("criado_em", -1)]

@api.post("/patients/{pid}/planos-manuais/{pmid}/duplicar", status_code=201)
async def duplicate_plano_manual(pid: str, pmid: str, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente nÃ£o encontrado")
    doc = await db.planos_manuais.find_one({"id": pmid, "paciente_id": pid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Plano nÃ£o encontrado")
    latest = await db.planos_manuais.find_one({"paciente_id": pid}, {"versao": 1}, sort=[("versao", -1)])
    clone = {
        **doc,
        "id": str(uuid.uuid4()),
        "titulo": f"{doc.get('titulo', 'Plano')} (cÃ³pia)",
        "versao": int((latest or {}).get("versao") or 0) + 1,
        "origem_plano_id": pmid,
        "criado_em": iso(now_utc()),
        "atualizado_em": iso(now_utc()),
    }
    await db.planos_manuais.insert_one(clone)
    await _create_plano_snapshot(clone, "duplicate", user["id"])
    return await _enrich_plano({k: v for k, v in clone.items() if k != "_id"})

@api.delete("/patients/{pid}/planos-manuais/{pmid}")
async def delete_plano_manual(pid: str, pmid: str, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    doc = await db.planos_manuais.find_one({"id": pmid, "paciente_id": pid}, {"_id": 0})
    if doc:
        await _create_plano_snapshot(doc, "delete", user["id"])
    res = await db.planos_manuais.delete_one({"id": pmid, "paciente_id": pid})
    if res.deleted_count == 0:
        raise HTTPException(404, "Plano não encontrado")
    return {"ok": True}

def _build_adequacao_payload(plano: Optional[dict], recordatorio: Optional[dict]) -> dict:
    plan_map = {
        "energia_kcal": "energia_kcal",
        "proteina_g": "proteinas_g",
        "carboidrato_g": "carboidratos_g",
        "lipideos_g": "lipidios_g",
        "fibra_g": "fibras_g",
        "sodio_mg": "sodio_mg",
    }
    plan_totais = (plano or {}).get("totais_dia") or {}
    rec_totais = (recordatorio or {}).get("totais_dia") or {}
    comparativo = []
    for rec_key, plan_key in plan_map.items():
        plano_valor = _coerce_float(plan_totais.get(plan_key)) or 0.0
        rec_valor = _coerce_float(rec_totais.get(rec_key)) or 0.0
        comparativo.append({
            "codigo": rec_key,
            "plano": plano_valor,
            "recordatorio": rec_valor,
            "delta": round(rec_valor - plano_valor, 2),
            "pct_vs_plano": round((rec_valor / plano_valor) * 100, 1) if plano_valor > 0 else None,
        })
    dri_relevantes = []
    for item in (recordatorio or {}).get("adequacao_dri") or []:
        pct = _coerce_float(item.get("pct_adequacao"))
        if pct is None:
            continue
        status = "adequado"
        if pct < 90:
            status = "baixo"
        elif pct > 110:
            status = "alto"
        dri_relevantes.append({**item, "status": status})
    dri_relevantes.sort(key=lambda item: abs((_coerce_float(item.get("pct_adequacao")) or 100) - 100), reverse=True)
    return {
        "plano": plano,
        "recordatorio": recordatorio,
        "comparativo": comparativo,
        "dri_relevantes": dri_relevantes[:12],
    }

@api.get("/patients/{pid}/adequacao")
async def get_adequacao_clinica(pid: str, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    plano_raw = await db.planos_manuais.find_one({"paciente_id": pid}, {"_id": 0}, sort=[("criado_em", -1)])
    plano = await _enrich_plano(plano_raw) if plano_raw else None
    recordatorio = await db.recordatorios.find_one({"paciente_id": pid}, {"_id": 0}, sort=[("data", -1)])
    return _build_adequacao_payload(plano, recordatorio)

# ── Exames laboratoriais — catálogo + entrada manual ─────────────

_EXAMES_CATALOG = {
    "Hemograma": [
        {"codigo":"HEM-01","nome":"Hemoglobina","unidade":"g/dL","ref_m_min":13.5,"ref_m_max":17.5,"ref_f_min":12.0,"ref_f_max":16.0},
        {"codigo":"HEM-02","nome":"Hematócrito","unidade":"%","ref_m_min":41,"ref_m_max":53,"ref_f_min":36,"ref_f_max":46},
        {"codigo":"HEM-03","nome":"VCM","unidade":"fL","ref_m_min":80,"ref_m_max":100,"ref_f_min":80,"ref_f_max":100},
        {"codigo":"HEM-04","nome":"HCM","unidade":"pg","ref_m_min":27,"ref_m_max":33,"ref_f_min":27,"ref_f_max":33},
        {"codigo":"HEM-05","nome":"Leucócitos totais","unidade":"mil/mm³","ref_m_min":4.5,"ref_m_max":11.0,"ref_f_min":4.5,"ref_f_max":11.0},
        {"codigo":"HEM-06","nome":"Plaquetas","unidade":"mil/mm³","ref_m_min":150,"ref_m_max":400,"ref_f_min":150,"ref_f_max":400},
        {"codigo":"HEM-07","nome":"Neutrófilos","unidade":"%","ref_m_min":45,"ref_m_max":75,"ref_f_min":45,"ref_f_max":75},
        {"codigo":"HEM-08","nome":"Linfócitos","unidade":"%","ref_m_min":20,"ref_m_max":40,"ref_f_min":20,"ref_f_max":40},
    ],
    "Glicemia e Diabetes": [
        {"codigo":"GLI-01","nome":"Glicemia em jejum","unidade":"mg/dL","ref_m_min":70,"ref_m_max":99,"ref_f_min":70,"ref_f_max":99},
        {"codigo":"GLI-02","nome":"Hemoglobina glicada (HbA1c)","unidade":"%","ref_m_min":None,"ref_m_max":5.7,"ref_f_min":None,"ref_f_max":5.7},
        {"codigo":"GLI-03","nome":"Insulina em jejum","unidade":"µUI/mL","ref_m_min":2.6,"ref_m_max":24.9,"ref_f_min":2.6,"ref_f_max":24.9},
        {"codigo":"GLI-04","nome":"HOMA-IR","unidade":"","ref_m_min":None,"ref_m_max":2.7,"ref_f_min":None,"ref_f_max":2.7},
    ],
    "Lipidograma": [
        {"codigo":"LIP-01","nome":"Colesterol total","unidade":"mg/dL","ref_m_min":None,"ref_m_max":200,"ref_f_min":None,"ref_f_max":200},
        {"codigo":"LIP-02","nome":"LDL","unidade":"mg/dL","ref_m_min":None,"ref_m_max":130,"ref_f_min":None,"ref_f_max":130},
        {"codigo":"LIP-03","nome":"HDL","unidade":"mg/dL","ref_m_min":40,"ref_m_max":None,"ref_f_min":50,"ref_f_max":None},
        {"codigo":"LIP-04","nome":"VLDL","unidade":"mg/dL","ref_m_min":None,"ref_m_max":40,"ref_f_min":None,"ref_f_max":40},
        {"codigo":"LIP-05","nome":"Triglicerídeos","unidade":"mg/dL","ref_m_min":None,"ref_m_max":150,"ref_f_min":None,"ref_f_max":150},
    ],
    "Função Renal": [
        {"codigo":"REN-01","nome":"Creatinina sérica","unidade":"mg/dL","ref_m_min":0.7,"ref_m_max":1.3,"ref_f_min":0.5,"ref_f_max":1.1},
        {"codigo":"REN-02","nome":"Ureia","unidade":"mg/dL","ref_m_min":15,"ref_m_max":45,"ref_f_min":15,"ref_f_max":45},
        {"codigo":"REN-03","nome":"Ácido úrico","unidade":"mg/dL","ref_m_min":3.5,"ref_m_max":7.2,"ref_f_min":2.6,"ref_f_max":6.0},
        {"codigo":"REN-04","nome":"TFG (CKD-EPI)","unidade":"mL/min/1,73m²","ref_m_min":60,"ref_m_max":None,"ref_f_min":60,"ref_f_max":None},
    ],
    "Função Hepática": [
        {"codigo":"HEP-01","nome":"TGO (AST)","unidade":"U/L","ref_m_min":None,"ref_m_max":40,"ref_f_min":None,"ref_f_max":32},
        {"codigo":"HEP-02","nome":"TGP (ALT)","unidade":"U/L","ref_m_min":None,"ref_m_max":41,"ref_f_min":None,"ref_f_max":31},
        {"codigo":"HEP-03","nome":"GGT","unidade":"U/L","ref_m_min":None,"ref_m_max":61,"ref_f_min":None,"ref_f_max":36},
        {"codigo":"HEP-04","nome":"Fosfatase alcalina","unidade":"U/L","ref_m_min":40,"ref_m_max":130,"ref_f_min":35,"ref_f_max":105},
        {"codigo":"HEP-05","nome":"Bilirrubina total","unidade":"mg/dL","ref_m_min":None,"ref_m_max":1.2,"ref_f_min":None,"ref_f_max":1.2},
        {"codigo":"HEP-06","nome":"Albumina","unidade":"g/dL","ref_m_min":3.5,"ref_m_max":5.0,"ref_f_min":3.5,"ref_f_max":5.0},
    ],
    "Tireoide": [
        {"codigo":"TIR-01","nome":"TSH","unidade":"µUI/mL","ref_m_min":0.4,"ref_m_max":4.0,"ref_f_min":0.4,"ref_f_max":4.0},
        {"codigo":"TIR-02","nome":"T4 livre","unidade":"ng/dL","ref_m_min":0.8,"ref_m_max":1.9,"ref_f_min":0.8,"ref_f_max":1.9},
        {"codigo":"TIR-03","nome":"T3 livre","unidade":"pg/mL","ref_m_min":2.3,"ref_m_max":4.2,"ref_f_min":2.3,"ref_f_max":4.2},
        {"codigo":"TIR-04","nome":"Anti-TPO","unidade":"UI/mL","ref_m_min":None,"ref_m_max":35,"ref_f_min":None,"ref_f_max":35},
    ],
    "Minerais e Vitaminas": [
        {"codigo":"MIN-01","nome":"Ferro sérico","unidade":"µg/dL","ref_m_min":65,"ref_m_max":175,"ref_f_min":50,"ref_f_max":170},
        {"codigo":"MIN-02","nome":"Ferritina","unidade":"ng/mL","ref_m_min":22,"ref_m_max":322,"ref_f_min":10,"ref_f_max":291},
        {"codigo":"MIN-03","nome":"Vitamina B12","unidade":"pg/mL","ref_m_min":200,"ref_m_max":900,"ref_f_min":200,"ref_f_max":900},
        {"codigo":"MIN-04","nome":"Vitamina D (25-OH)","unidade":"ng/mL","ref_m_min":30,"ref_m_max":100,"ref_f_min":30,"ref_f_max":100},
        {"codigo":"MIN-05","nome":"Zinco","unidade":"µg/dL","ref_m_min":70,"ref_m_max":150,"ref_f_min":70,"ref_f_max":150},
        {"codigo":"MIN-06","nome":"Magnésio sérico","unidade":"mg/dL","ref_m_min":1.6,"ref_m_max":2.6,"ref_f_min":1.6,"ref_f_max":2.6},
        {"codigo":"MIN-07","nome":"Cálcio total","unidade":"mg/dL","ref_m_min":8.5,"ref_m_max":10.5,"ref_f_min":8.5,"ref_f_max":10.5},
        {"codigo":"MIN-08","nome":"Fósforo","unidade":"mg/dL","ref_m_min":2.5,"ref_m_max":4.5,"ref_f_min":2.5,"ref_f_max":4.5},
        {"codigo":"MIN-09","nome":"Potássio","unidade":"mEq/L","ref_m_min":3.5,"ref_m_max":5.0,"ref_f_min":3.5,"ref_f_max":5.0},
        {"codigo":"MIN-10","nome":"Sódio","unidade":"mEq/L","ref_m_min":135,"ref_m_max":145,"ref_f_min":135,"ref_f_max":145},
    ],
    "Inflamatórios": [
        {"codigo":"INF-01","nome":"PCR ultra-sensível","unidade":"mg/L","ref_m_min":None,"ref_m_max":1.0,"ref_f_min":None,"ref_f_max":1.0},
        {"codigo":"INF-02","nome":"VHS (Eritrossedimentação)","unidade":"mm/h","ref_m_min":None,"ref_m_max":20,"ref_f_min":None,"ref_f_max":30},
        {"codigo":"INF-03","nome":"Homocisteína","unidade":"µmol/L","ref_m_min":None,"ref_m_max":15,"ref_f_min":None,"ref_f_max":12},
    ],
    "Proteínas Séricas": [
        {"codigo":"PRO-01","nome":"Proteína total","unidade":"g/dL","ref_m_min":6.4,"ref_m_max":8.3,"ref_f_min":6.4,"ref_f_max":8.3},
        {"codigo":"PRO-02","nome":"Pré-albumina","unidade":"mg/dL","ref_m_min":16,"ref_m_max":35,"ref_f_min":16,"ref_f_max":35},
        {"codigo":"PRO-03","nome":"Transferrina","unidade":"mg/dL","ref_m_min":200,"ref_m_max":360,"ref_f_min":200,"ref_f_max":360},
    ],
    "Hormônios": [
        {"codigo":"HOR-01","nome":"Insulina pós-prandial (2h)","unidade":"µUI/mL","ref_m_min":None,"ref_m_max":30,"ref_f_min":None,"ref_f_max":30},
        {"codigo":"HOR-02","nome":"Cortisol (manhã)","unidade":"µg/dL","ref_m_min":5,"ref_m_max":25,"ref_f_min":5,"ref_f_max":25},
        {"codigo":"HOR-03","nome":"DHEA-S","unidade":"µg/dL","ref_m_min":85,"ref_m_max":690,"ref_f_min":45,"ref_f_max":430},
        {"codigo":"HOR-04","nome":"Testosterona total","unidade":"ng/dL","ref_m_min":270,"ref_m_max":1070,"ref_f_min":15,"ref_f_max":70},
        {"codigo":"HOR-05","nome":"Estradiol","unidade":"pg/mL","ref_m_min":None,"ref_m_max":40,"ref_f_min":30,"ref_f_max":400},
        {"codigo":"HOR-06","nome":"FSH","unidade":"mUI/mL","ref_m_min":1.5,"ref_m_max":12.4,"ref_f_min":2.5,"ref_f_max":10.2},
        {"codigo":"HOR-07","nome":"LH","unidade":"mUI/mL","ref_m_min":1.7,"ref_m_max":8.6,"ref_f_min":2.4,"ref_f_max":12.6},
    ],
    "Urina": [
        {"codigo":"URI-01","nome":"Creatinina urinária","unidade":"mg/24h","ref_m_min":800,"ref_m_max":2000,"ref_f_min":600,"ref_f_max":1800},
        {"codigo":"URI-02","nome":"Microalbuminúria","unidade":"mg/24h","ref_m_min":None,"ref_m_max":30,"ref_f_min":None,"ref_f_max":30},
    ],
}

def _classif_exame(valor: float, ref: dict, sexo: str) -> str:
    if str(sexo) in ("M", "1"):
        mn, mx = ref.get("ref_m_min"), ref.get("ref_m_max")
    else:
        mn, mx = ref.get("ref_f_min"), ref.get("ref_f_max")
    if mn is not None and valor < mn:
        return "baixo"
    if mx is not None and valor > mx:
        return "alto"
    return "normal"

def _parse_exam_date(value: Optional[str]) -> datetime:
    raw = str(value or "").strip()
    if not raw:
        return datetime.min.replace(tzinfo=timezone.utc)
    for fmt in ("%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(raw, fmt).replace(tzinfo=timezone.utc)
        except Exception:
            continue
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except Exception:
        return datetime.min.replace(tzinfo=timezone.utc)

def _build_exames_longitudinal_payload(lotes: list[dict]) -> dict:
    ordered = sorted(lotes, key=lambda item: _parse_exam_date(item.get("data_coleta")))
    markers: dict[str, dict] = {}
    grupos: dict[str, dict] = {}
    timeline = []

    for lote in ordered:
        exames = lote.get("exames") or []
        alterados = [e for e in exames if e.get("classificacao") in ("alto", "baixo")]
        timeline.append({
            "id": lote.get("id"),
            "data_coleta": lote.get("data_coleta"),
            "laboratorio": lote.get("laboratorio"),
            "total_exames": len(exames),
            "alterados": len(alterados),
        })
        for exame in exames:
            codigo = exame.get("codigo")
            if not codigo:
                continue
            grupo = exame.get("grupo") or "Outros"
            marker = markers.setdefault(codigo, {
                "codigo": codigo,
                "nome": exame.get("nome"),
                "grupo": grupo,
                "unidade": exame.get("unidade"),
                "coletas": [],
            })
            marker["coletas"].append({
                "data_coleta": lote.get("data_coleta"),
                "laboratorio": lote.get("laboratorio"),
                "valor": exame.get("valor"),
                "classificacao": exame.get("classificacao"),
            })
            group_bucket = grupos.setdefault(grupo, {
                "grupo": grupo,
                "total_exames": 0,
                "alterados": 0,
                "ultima_data": lote.get("data_coleta"),
            })
            group_bucket["total_exames"] += 1
            if exame.get("classificacao") in ("alto", "baixo"):
                group_bucket["alterados"] += 1
            group_bucket["ultima_data"] = lote.get("data_coleta")

    markers_out = []
    for marker in markers.values():
        coletas = marker["coletas"]
        latest = coletas[-1] if coletas else None
        previous = coletas[-2] if len(coletas) > 1 else None
        delta_abs = None
        delta_pct = None
        trend = "estavel"
        if latest and previous and latest.get("valor") is not None and previous.get("valor") is not None:
            delta_abs = round(float(latest["valor"]) - float(previous["valor"]), 2)
            if previous["valor"] not in (None, 0):
                delta_pct = round((delta_abs / float(previous["valor"])) * 100, 1)
            if abs(delta_abs) >= 0.01:
                trend = "subiu" if delta_abs > 0 else "caiu"
        marker["ultima_classificacao"] = (latest or {}).get("classificacao")
        marker["ultima_data"] = (latest or {}).get("data_coleta")
        marker["ultima_coleta"] = latest
        marker["coleta_anterior"] = previous
        marker["delta_abs"] = delta_abs
        marker["delta_pct"] = delta_pct
        marker["trend"] = trend
        markers_out.append(marker)

    markers_out.sort(key=lambda item: (
        0 if item.get("ultima_classificacao") in ("alto", "baixo") else 1,
        item.get("grupo") or "",
        item.get("nome") or "",
    ))
    grupos_out = sorted(grupos.values(), key=lambda item: (-item["alterados"], item["grupo"]))
    resumo = {
        "total_coletas": len(ordered),
        "total_marcadores": len(markers_out),
        "marcadores_alterados_ultima_coleta": sum(1 for item in markers_out if item.get("ultima_classificacao") in ("alto", "baixo")),
        "grupos_com_alteracao": sum(1 for item in grupos_out if item.get("alterados", 0) > 0),
        "ultima_data_coleta": timeline[-1]["data_coleta"] if timeline else None,
    }
    return {"resumo": resumo, "timeline": timeline, "grupos": grupos_out, "marcadores": markers_out}

class ExameManualItem(BaseModel):
    codigo: str
    nome: str
    valor: float
    unidade: str
    grupo: str

class ExamesManualIn(BaseModel):
    data_coleta: str
    laboratorio: Optional[str] = None
    exames: List[ExameManualItem]

@api.get("/referencias/exames-catalog")
async def get_exames_catalog(q: str = "", grupo: str = "", user=Depends(require_nutritionist)):
    results = []
    for grupo_nome, itens in _EXAMES_CATALOG.items():
        if grupo and grupo.lower() not in grupo_nome.lower():
            continue
        for item in itens:
            if q and q.lower() not in item["nome"].lower():
                continue
            results.append({"grupo": grupo_nome, **item})
    return results

@api.get("/referencias/exames-grupos")
async def get_exames_grupos(user=Depends(require_nutritionist)):
    return list(_EXAMES_CATALOG.keys())

@api.post("/patients/{pid}/exames-manuais", status_code=201)
async def create_exame_manual(pid: str, payload: ExamesManualIn, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    sexo = p.get("sexo", "M")
    catalog_flat = {item["codigo"]: item for itens in _EXAMES_CATALOG.values() for item in itens}
    exames_enrich = []
    for e in payload.exames:
        ref = catalog_flat.get(e.codigo, {})
        classif = _classif_exame(e.valor, ref, sexo) if ref else "sem_referencia"
        exames_enrich.append({**e.model_dump(), "classificacao": classif, "referencia": ref})
    doc = {
        "id": str(uuid.uuid4()),
        "paciente_id": pid,
        "nutricionista_id": user["id"],
        "tipo": "manual",
        "data_coleta": payload.data_coleta,
        "laboratorio": payload.laboratorio,
        "exames": exames_enrich,
        "criado_em": iso(now_utc()),
    }
    await db.exames_manuais.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}

@api.put("/patients/{pid}/exames-manuais/{emid}")
async def update_exame_manual(pid: str, emid: str, payload: ExamesManualIn, user=Depends(require_nutritionist)):
    patient = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not patient:
        raise HTTPException(404, "Paciente não encontrado")
    existing = await db.exames_manuais.find_one({"id": emid, "paciente_id": pid})
    if not existing:
        raise HTTPException(404, "Registro de exames não encontrado")
    catalog_flat = {item["codigo"]: item for items in _EXAMES_CATALOG.values() for item in items}
    exams = []
    for exam in payload.exames:
        reference = catalog_flat.get(exam.codigo, {})
        classification = _classif_exame(exam.valor, reference, patient.get("sexo", "M")) if reference else "sem_referencia"
        exams.append({**exam.model_dump(), "classificacao": classification, "referencia": reference})
    updates = {
        "data_coleta": payload.data_coleta,
        "laboratorio": payload.laboratorio,
        "exames": exams,
        "atualizado_em": iso(now_utc()),
    }
    await db.exames_manuais.update_one({"id": emid, "paciente_id": pid}, {"$set": updates})
    return await db.exames_manuais.find_one({"id": emid}, {"_id": 0})

@api.get("/patients/{pid}/exames-manuais")
async def list_exames_manuais(pid: str, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    return [d async for d in db.exames_manuais.find({"paciente_id": pid}, {"_id": 0}).sort("data_coleta", -1)]

@api.get("/patients/{pid}/exames-manuais/longitudinal")
async def get_exames_manuais_longitudinal(pid: str, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    lotes = [d async for d in db.exames_manuais.find({"paciente_id": pid}, {"_id": 0}).sort("data_coleta", 1)]
    return _build_exames_longitudinal_payload(lotes)

@api.delete("/patients/{pid}/exames-manuais/{emid}")
async def delete_exame_manual(pid: str, emid: str, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    res = await db.exames_manuais.delete_one({"id": emid, "paciente_id": pid})
    if res.deleted_count == 0:
        raise HTTPException(404, "Exame não encontrado")
    return {"ok": True}

# ── Configurações — logo upload ──────────────────────────────────

@api.post("/configuracoes/logo")
async def upload_logo(file: UploadFile = File(...), user=Depends(require_nutritionist)):
    if file.content_type not in ("image/png", "image/jpeg", "image/jpg", "image/webp"):
        raise HTTPException(400, "Formato inválido. Use PNG, JPEG ou WebP.")
    data = await file.read()
    if len(data) > 2 * 1024 * 1024:
        raise HTTPException(400, "Arquivo muito grande. Máximo 2MB.")
    import base64
    b64 = base64.b64encode(data).decode("utf-8")
    logo_uri = f"data:{file.content_type};base64,{b64}"
    await db.users.update_one({"id": user["id"]}, {"$set": {"logo_url": logo_uri, "atualizado_em": iso(now_utc())}})
    return {"logo_url": logo_uri}

# ── PDF Reports ──────────────────────────────────────────────────

def _pdf_html_base(titulo: str, paciente: dict, nutri: dict, conteudo: str) -> str:
    logo = nutri.get("logo_url", "")
    logo_html = f'<img src="{logo}" style="height:56px;object-fit:contain;" />' if logo else ""
    nome_nutri = nutri.get("name", "") or nutri.get("nome", "")
    crn = nutri.get("crn", "")
    crn_txt = f" — CRN: {crn}" if crn else ""
    return f"""<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"/>
<style>
@page {{size:A4;margin:2cm 2cm 2.5cm 2cm;}}
body{{font-family:Arial,Helvetica,sans-serif;font-size:11pt;color:#222;margin:0;}}
.hdr{{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #7c3aed;padding-bottom:12px;margin-bottom:20px;}}
.hdr h1{{margin:0;font-size:16pt;color:#7c3aed;}}
.hdr p{{margin:2px 0;font-size:9pt;color:#555;}}
.sec{{margin-bottom:18px;}}
.sec-title{{background:#7c3aed;color:white;padding:5px 10px;font-size:11pt;font-weight:bold;border-radius:4px;margin-bottom:10px;}}
table{{width:100%;border-collapse:collapse;margin-bottom:10px;}}
th{{background:#ede9fe;color:#4c1d95;text-align:left;padding:5px 8px;font-size:10pt;}}
td{{padding:4px 8px;font-size:10pt;border-bottom:1px solid #eee;}}
tr:nth-child(even) td{{background:#faf9ff;}}
.baixo{{color:#dc2626;font-weight:bold;}}.alto{{color:#ea580c;font-weight:bold;}}.normal{{color:#16a34a;font-weight:bold;}}
.ftr{{position:fixed;bottom:0;left:0;right:0;text-align:center;font-size:8pt;color:#aaa;border-top:1px solid #eee;padding:8px;}}
</style></head><body>
<div class="hdr">
  <div><h1>{titulo}</h1>
    <p>Paciente: <strong>{paciente.get('nome','')}</strong> &nbsp;|&nbsp; Gerado em: {datetime.now(TZ_BR).strftime('%d/%m/%Y %H:%M')}</p>
    {f'<p>{nome_nutri}{crn_txt}</p>' if nome_nutri else ''}
  </div>
  <div>{logo_html}</div>
</div>
{conteudo}
<div class="ftr">RCTEAM — Sistema Nutricional {datetime.now(TZ_BR).strftime('%Y')} | {nome_nutri} {('CRN ' + crn) if crn else ''}</div>
</body></html>"""

def _pdf_escape(value: Any) -> str:
    if value is None:
        return ""
    return html.escape(str(value))

def _pdf_nl2br(value: Any) -> str:
    return _pdf_escape(value).replace("\n", "<br/>")

def _pdf_fmt_num(value: Any, unit: str = "") -> str:
    if value in (None, ""):
        return "—"
    num = _coerce_float(value)
    if num is None:
        return f"{_pdf_escape(value)}{unit}"
    if abs(num - round(num)) < 0.01:
        txt = str(int(round(num)))
    else:
        txt = f"{num:.1f}".replace(".", ",")
    return f"{txt}{unit}"

def _pdf_badges(items: list[str]) -> str:
    clean = [item for item in items if item]
    return "".join(f'<span class="badge">{_pdf_escape(item)}</span>' for item in clean)

def _pdf_html_base_plano(titulo: str, paciente: dict, nutri: dict, conteudo: str) -> str:
    logo = nutri.get("logo_url", "")
    logo_html = f'<img src="{logo}" style="height:64px;max-width:180px;object-fit:contain;" />' if logo else ""
    nome_nutri = nutri.get("name", "") or nutri.get("nome", "")
    crn = nutri.get("crn", "")
    clinica_nome = nutri.get("clinica_nome", "")
    clinica_endereco = nutri.get("clinica_endereco", "")
    telefone_clinica = nutri.get("telefone_clinica", "") or nutri.get("telefone", "")
    site = nutri.get("site", "")
    especialidade = nutri.get("especialidade", "")
    accent = (nutri.get("cor_relatorio") or "#0f766e").strip() or "#0f766e"
    contato = " | ".join([part for part in [
        _pdf_escape(clinica_endereco),
        _pdf_escape(telefone_clinica),
        _pdf_escape(site),
    ] if part])
    return f"""<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"/>
<style>
@page {{size:A4;margin:2cm 2cm 2.5cm 2cm;}}
body{{font-family:Arial,Helvetica,sans-serif;font-size:11pt;color:#1f2937;margin:0;}}
.hdr{{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid {accent};padding-bottom:14px;margin-bottom:20px;gap:18px;}}
.hdr h1{{margin:0;font-size:18pt;color:{accent};}}
.hdr p{{margin:2px 0;font-size:9pt;color:#475569;}}
.muted{{color:#64748b;}}
.sec{{margin-bottom:18px;}}
.sec-title{{background:{accent};color:white;padding:7px 12px;font-size:11pt;font-weight:bold;border-radius:8px;margin-bottom:10px;}}
.hero{{background:linear-gradient(135deg, #f0fdfa, #ffffff);border:1px solid #dbeafe;border-radius:14px;padding:14px 16px;margin-bottom:18px;}}
.hero-grid{{display:flex;flex-wrap:wrap;gap:18px;}}
.hero-col{{flex:1 1 220px;}}
.badge-row{{margin-top:10px;}}
.badge{{display:inline-block;background:#ccfbf1;color:#134e4a;border:1px solid rgba(15,118,110,0.18);padding:4px 10px;border-radius:999px;font-size:8.5pt;font-weight:bold;margin:0 6px 6px 0;}}
.kpi-grid{{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px;}}
.kpi{{flex:1 1 150px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:10px 12px;}}
.kpi-label{{font-size:8.5pt;text-transform:uppercase;letter-spacing:.08em;color:#64748b;font-weight:bold;}}
.kpi-value{{font-size:15pt;color:#0f172a;font-weight:bold;margin-top:4px;}}
.kpi-note{{font-size:8.5pt;color:#64748b;margin-top:4px;}}
.meal-meta{{font-size:9pt;color:#475569;margin:0 0 8px 0;}}
.card{{background:#fcfcfd;border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px;margin-bottom:10px;}}
table{{width:100%;border-collapse:collapse;margin-bottom:10px;}}
th{{background:#f1f5f9;color:#0f172a;text-align:left;padding:7px 8px;font-size:9.5pt;border-bottom:1px solid #cbd5e1;}}
td{{padding:6px 8px;font-size:9.5pt;border-bottom:1px solid #e5e7eb;vertical-align:top;}}
tr:nth-child(even) td{{background:#f8fafc;}}
.tot-row td{{background:#ccfbf1;font-weight:bold;border-top:1px solid #cbd5e1;}}
.right{{text-align:right;}}
.small{{font-size:8.5pt;}}
.ftr{{position:fixed;bottom:0;left:0;right:0;text-align:center;font-size:8pt;color:#94a3b8;border-top:1px solid #e2e8f0;padding:8px;}}
</style></head><body>
<div class="hdr">
  <div style="flex:1"><h1>{_pdf_escape(titulo)}</h1>
    <p>Paciente: <strong>{_pdf_escape(paciente.get('nome',''))}</strong> | Gerado em: {datetime.now(TZ_BR).strftime('%d/%m/%Y %H:%M')}</p>
    {f'<p><strong>{_pdf_escape(nome_nutri)}</strong>{(" | CRN: " + _pdf_escape(crn)) if crn else ""}{(" | " + _pdf_escape(especialidade)) if especialidade else ""}</p>' if nome_nutri else ''}
    {f'<p>{_pdf_escape(clinica_nome)}</p>' if clinica_nome else ''}
    {f'<p class="muted">{contato}</p>' if contato else ''}
  </div>
  <div>{logo_html}</div>
</div>
{conteudo}
<div class="ftr">RCTEAM - Sistema Nutricional {datetime.now(TZ_BR).strftime('%Y')} | {_pdf_escape(nome_nutri)} {('CRN ' + _pdf_escape(crn)) if crn else ''}</div>
</body></html>"""

@api.get("/patients/{pid}/relatorios/antropometria")
async def relatorio_antropometria(pid: str, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    nutri = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0}) or {}
    evals = [e async for e in db.evaluations.find({"paciente_id": pid}, {"_id": 0}).sort("data", -1).limit(5)]
    rows = ""
    for e in evals:
        r = e.get("resultado", {})
        rows += (f"<tr><td>{str(e.get('data',''))[:10]}</td>"
                 f"<td>{r.get('peso_kg', e.get('peso','—'))}</td>"
                 f"<td>{r.get('imc','—')}</td><td>{r.get('imc_classificacao','—')}</td>"
                 f"<td>{r.get('pct_gordura','—')}</td>"
                 f"<td>{r.get('tmb','—')}</td><td>{r.get('get_kcal','—')}</td></tr>")
    conteudo = f"""<div class="sec"><div class="sec-title">Avaliações Antropométricas (últimas 5)</div>
      <table><tr><th>Data</th><th>Peso (kg)</th><th>IMC</th><th>Classificação</th><th>%Gordura</th><th>TMB (kcal)</th><th>GET (kcal)</th></tr>
      {rows or '<tr><td colspan="7" style="text-align:center;color:#888">Nenhuma avaliação registrada</td></tr>'}
      </table></div>"""
    html = _pdf_html_base("Relatório Antropométrico", p, nutri, conteudo)
    pdf_bytes = HTML(string=html).write_pdf()
    fname = f"antropometria_{p.get('nome','p').replace(' ','_')}_{datetime.now(TZ_BR).strftime('%Y%m%d')}.pdf"
    return Response(content=pdf_bytes, media_type="application/pdf",
                    headers={"Content-Disposition": f"attachment; filename={fname}"})

@api.get("/patients/{pid}/relatorios/anamnese")
async def relatorio_anamnese(pid: str, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    nutri = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0}) or {}
    anam = await db.anamneses.find_one({"paciente_id": pid}, {"_id": 0})
    secoes_html = ""
    label_map = {
        "dados_sociais": "Dados Sociais",
        "habitos_vida": "Hábitos de Vida",
        "patologias": "Patologias e Histórico",
        "avaliacao_clinica": "Avaliação Clínica",
        "alimentacao": "Alimentação",
        "atividade_fisica": "Atividade Física",
        "mulheres": "Dados Femininos",
    }
    if anam:
        for sec_key, sec_label in label_map.items():
            fields = SECOES_ANAMNESE.get(sec_key, [])
            rows = "".join(
                f"<tr><td><strong>{f.replace('_',' ').title()}</strong></td><td>{anam.get(f) or '—'}</td></tr>"
                for f in fields if anam.get(f)
            )
            if rows:
                secoes_html += f'<div class="sec"><div class="sec-title">{sec_label}</div><table>{rows}</table></div>'
        for obs_key, obs_label in [
            ("observacoes_medicas","Observações Médicas"),
            ("observacoes_nutricionais","Observações Nutricionais"),
            ("observacoes_evolucao","Observações de Evolução"),
        ]:
            obs_list = anam.get(obs_key, [])
            if obs_list:
                items = "".join(
                    f"<tr><td>{o.get('data_hora','')[:16]}</td><td>{o.get('texto','')}</td></tr>"
                    for o in obs_list
                )
                secoes_html += (f'<div class="sec"><div class="sec-title">{obs_label}</div>'
                                f'<table><tr><th>Data</th><th>Observação</th></tr>{items}</table></div>')
    if not secoes_html:
        secoes_html = '<p style="color:#888">Anamnese não preenchida.</p>'
    html = _pdf_html_base("Relatório de Anamnese", p, nutri, secoes_html)
    pdf_bytes = HTML(string=html).write_pdf()
    fname = f"anamnese_{p.get('nome','p').replace(' ','_')}_{datetime.now(TZ_BR).strftime('%Y%m%d')}.pdf"
    return Response(content=pdf_bytes, media_type="application/pdf",
                    headers={"Content-Disposition": f"attachment; filename={fname}"})

@api.get("/patients/{pid}/relatorios/exames")
async def relatorio_exames(pid: str, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    nutri = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0}) or {}
    lotes = [e async for e in db.exames_manuais.find({"paciente_id": pid}, {"_id": 0}).sort("data_coleta", -1)]
    conteudo = ""
    if not lotes:
        conteudo = '<p style="color:#888">Nenhum exame laboratorial registrado.</p>'
    else:
        sexo = p.get("sexo", "M")
        for lote in lotes:
            rows = ""
            for e in lote.get("exames", []):
                cls = e.get("classificacao", "sem_referencia")
                badge = f'<span class="{cls}">{cls.upper()}</span>' if cls != "sem_referencia" else "—"
                ref = e.get("referencia", {})
                mn = ref.get("ref_f_min") if sexo == "F" else ref.get("ref_m_min")
                mx = ref.get("ref_f_max") if sexo == "F" else ref.get("ref_m_max")
                parts = []
                if mn is not None: parts.append(f"≥{mn}")
                if mx is not None: parts.append(f"≤{mx}")
                ref_txt = " — ".join(parts) if parts else "—"
                rows += (f"<tr><td>{e.get('grupo','')}</td><td>{e.get('nome','')}</td>"
                         f"<td><strong>{e.get('valor','')}</strong> {e.get('unidade','')}</td>"
                         f"<td>{ref_txt}</td><td>{badge}</td></tr>")
            lab = lote.get("laboratorio") or "Laboratório não informado"
            conteudo += (f'<div class="sec"><div class="sec-title">Exames de '
                         f'{str(lote.get("data_coleta",""))[:10]} — {lab}</div>'
                         f'<table><tr><th>Grupo</th><th>Exame</th><th>Resultado</th>'
                         f'<th>Referência</th><th>Status</th></tr>{rows}</table></div>')
    html = _pdf_html_base("Relatório de Exames Laboratoriais", p, nutri, conteudo)
    pdf_bytes = HTML(string=html).write_pdf()
    fname = f"exames_{p.get('nome','p').replace(' ','_')}_{datetime.now(TZ_BR).strftime('%Y%m%d')}.pdf"
    return Response(content=pdf_bytes, media_type="application/pdf",
                    headers={"Content-Disposition": f"attachment; filename={fname}"})

@api.get("/patients/{pid}/relatorios/plano-alimentar/{pmid}")
async def relatorio_plano_alimentar(pid: str, pmid: str, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    nutri = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0}) or {}
    doc = await db.planos_manuais.find_one({"id": pmid, "paciente_id": pid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Plano não encontrado")
    plano = await _enrich_plano(doc)
    badges = []
    if plano.get("versao") is not None:
        badges.append(f"Versao {plano.get('versao')}")
        badges.append("Consulta de retorno" if int(plano.get("versao") or 0) > 1 else "Consulta inicial")
    if plano.get("origem_template_id"):
        badges.append("Gerado por template")
    if plano.get("origem_plano_id"):
        badges.append("Duplicado de plano anterior")
    conteudo_v2 = (
        '<div class="hero">'
        '<div class="hero-grid">'
        f'<div class="hero-col"><p class="small muted">Objetivo do plano</p><p><strong>{_pdf_escape(plano.get("objetivo") or p.get("objetivo") or "Nao informado")}</strong></p></div>'
        f'<div class="hero-col"><p class="small muted">Paciente</p><p><strong>{_pdf_escape(p.get("nome") or "")}</strong></p><p class="small muted">{_pdf_escape(p.get("sexo") or "")}{(" | " + _pdf_escape(p.get("email"))) if p.get("email") else ""}</p></div>'
        f'<div class="hero-col"><p class="small muted">Plano</p><p><strong>{_pdf_escape(plano.get("titulo") or "Plano Alimentar")}</strong></p><p class="small muted">{len(plano.get("refeicoes") or [])} refeicoes | {len(plano.get("orientacoes") or [])} orientacoes</p></div>'
        '</div>'
        f'<div class="badge-row">{_pdf_badges(badges)}</div>'
        '</div>'
    )
    totais_dia = plano.get("totais_dia", {})
    kpis = [
        ("Energia do dia", _pdf_fmt_num(totais_dia.get("energia_kcal"), " kcal"), _pdf_fmt_num(plano.get("meta_kcal"), " kcal") if plano.get("meta_kcal") else None),
        ("Proteinas", _pdf_fmt_num(totais_dia.get("proteinas_g"), " g"), _pdf_fmt_num(plano.get("meta_proteina_g"), " g") if plano.get("meta_proteina_g") else None),
        ("Carboidratos", _pdf_fmt_num(totais_dia.get("carboidratos_g"), " g"), _pdf_fmt_num(plano.get("meta_carboidrato_g"), " g") if plano.get("meta_carboidrato_g") else None),
        ("Lipidios", _pdf_fmt_num(totais_dia.get("lipidios_g"), " g"), _pdf_fmt_num(plano.get("meta_lipidio_g"), " g") if plano.get("meta_lipidio_g") else None),
        ("Fibras", _pdf_fmt_num(totais_dia.get("fibras_g"), " g"), None),
        ("Sodio", _pdf_fmt_num(totais_dia.get("sodio_mg"), " mg"), None),
    ]
    conteudo_v2 += '<div class="kpi-grid">' + "".join(
        f"<div class='kpi'><div class='kpi-label'>{_pdf_escape(label)}</div><div class='kpi-value'>{valor}</div>{(f'<div class=\"kpi-note\">Meta: {meta}</div>' if meta else '')}</div>"
        for label, valor, meta in kpis
    ) + '</div>'
    metas = []
    if plano.get("meta_kcal"): metas.append(("Meta energetica", _pdf_fmt_num(plano["meta_kcal"], " kcal")))
    if plano.get("meta_proteina_g"): metas.append(("Meta de proteinas", _pdf_fmt_num(plano["meta_proteina_g"], " g")))
    if plano.get("meta_carboidrato_g"): metas.append(("Meta de carboidratos", _pdf_fmt_num(plano["meta_carboidrato_g"], " g")))
    if plano.get("meta_lipidio_g"): metas.append(("Meta de lipidios", _pdf_fmt_num(plano["meta_lipidio_g"], " g")))
    if metas:
        conteudo_v2 += '<div class="sec"><div class="sec-title">Metas Nutricionais</div><table>' + "".join(
            f"<tr><td>{_pdf_escape(label)}</td><td>{valor}</td></tr>" for label, valor in metas
        ) + '</table></div>'
    if plano.get("orientacoes"):
        cards = "".join(
            f"<div class='card'><strong>{_pdf_escape(o.get('titulo','Orientacao'))}</strong>"
            + (f"<div class='small muted' style='margin-top:4px'>{_pdf_escape(o.get('categoria'))}</div>" if o.get("categoria") else "")
            + (f"<div class='small muted' style='margin-top:4px'>Objetivos: {_pdf_escape(', '.join(o.get('objetivos') or []))}</div>" if o.get("objetivos") else "")
            + f"<p style='white-space:pre-wrap;margin-bottom:0;margin-top:8px'>{_pdf_nl2br(o.get('conteudo',''))}</p></div>"
            for o in plano.get("orientacoes", [])
        )
        conteudo_v2 += f'<div class="sec"><div class="sec-title">OrientaÃ§Ãµes Nutricionais</div>{cards}</div>'
    for ref in plano.get("refeicoes", []):
        rows = ""
        for a in ref.get("alimentos", []):
            n = a.get("nutrientes", {})
            qtd_label = _pdf_fmt_num(a.get("quantidade"), "") if a.get("medida_nome") and a.get("medida_nome") != "Gramas" else _pdf_fmt_num(a.get("quantidade_g"), " g")
            medida_txt = f"{qtd_label} {a.get('medida_nome')}".strip() if a.get("medida_nome") and a.get("medida_nome") != "Gramas" else qtd_label
            obs_food = f"<div class='small muted' style='margin-top:3px'>{_pdf_escape(a.get('observacao'))}</div>" if a.get("observacao") else ""
            rows += (f"<tr><td><strong>{_pdf_escape(a.get('alimento_nome',''))}</strong>{obs_food}</td>"
                     f"<td>{_pdf_escape(medida_txt)}</td>"
                     f"<td class='right'>{_pdf_fmt_num(n.get('energia_kcal',0))}</td><td class='right'>{_pdf_fmt_num(n.get('proteinas_g',0))}</td>"
                     f"<td class='right'>{_pdf_fmt_num(n.get('carboidratos_g',0))}</td><td class='right'>{_pdf_fmt_num(n.get('lipidios_g',0))}</td></tr>")
        tot = ref.get("totais", {})
        horario = f" - {ref.get('horario')}" if ref.get("horario") else ""
        meal_meta = []
        if ref.get("meta_kcal") is not None:
            meal_meta.append(f"Meta: {_pdf_fmt_num(ref.get('meta_kcal'), ' kcal')}")
        if ref.get("saldo_kcal") is not None:
            meal_meta.append(f"Saldo: {_pdf_fmt_num(ref.get('saldo_kcal'), ' kcal')}")
        if ref.get("pct_energia_dia") is not None:
            meal_meta.append(f"Participacao: {_pdf_fmt_num(ref.get('pct_energia_dia'), '%')}")
        meal_meta_html = f'<p class="meal-meta">{" | ".join(meal_meta)}</p>' if meal_meta else ""
        conteudo_v2 += (f'<div class="sec"><div class="sec-title">{_pdf_escape(ref.get("nome",""))}{horario}</div>'
                        f'{meal_meta_html}'
                        f'<table><tr><th>Alimento</th><th>Qtd</th><th>Energia (kcal)</th>'
                        f'<th>Prot (g)</th><th>CHO (g)</th><th>Lip (g)</th></tr>'
                        f'{rows}<tr class="tot-row">'
                        f'<td colspan="2">Total da refeiÃ§Ã£o</td>'
                        f'<td class="right">{_pdf_fmt_num(tot.get("energia_kcal",0))}</td><td class="right">{_pdf_fmt_num(tot.get("proteinas_g",0))}</td>'
                        f'<td class="right">{_pdf_fmt_num(tot.get("carboidratos_g",0))}</td><td class="right">{_pdf_fmt_num(tot.get("lipidios_g",0))}</td>'
                        f'</tr></table></div>')
    conteudo_v2 += (f'<div class="sec"><div class="sec-title">Total do Dia</div>'
                    f'<table><tr><th>Energia</th><th>ProteÃ­nas</th><th>Carboidratos</th><th>LipÃ­dios</th><th>Fibras</th><th>SÃ³dio</th></tr>'
                    f'<tr><td>{_pdf_fmt_num(totais_dia.get("energia_kcal",0), " kcal")}</td><td>{_pdf_fmt_num(totais_dia.get("proteinas_g",0), " g")}</td>'
                    f'<td>{_pdf_fmt_num(totais_dia.get("carboidratos_g",0), " g")}</td><td>{_pdf_fmt_num(totais_dia.get("lipidios_g",0), " g")}</td>'
                    f'<td>{_pdf_fmt_num(totais_dia.get("fibras_g",0), " g")}</td><td>{_pdf_fmt_num(totais_dia.get("sodio_mg",0), " mg")}</td></tr></table></div>')
    if plano.get("observacoes"):
        conteudo_v2 += f'<div class="sec"><div class="sec-title">ObservaÃ§Ãµes</div><div class="card"><p style="white-space:pre-wrap;margin:0">{_pdf_nl2br(plano["observacoes"])}</p></div></div>'
    html = _pdf_html_base_plano(plano.get("titulo", "Plano Alimentar"), p, nutri, conteudo_v2)
    pdf_bytes = HTML(string=html).write_pdf()
    fname = f"plano_{p.get('nome','p').replace(' ','_')}_{datetime.now(TZ_BR).strftime('%Y%m%d')}.pdf"
    return Response(content=pdf_bytes, media_type="application/pdf",
                    headers={"Content-Disposition": f"attachment; filename={fname}"})
    conteudo = ""
    metas = []
    if plano.get("meta_kcal"): metas.append(f"Energia: {plano['meta_kcal']} kcal")
    if plano.get("meta_proteina_g"): metas.append(f"Proteínas: {plano['meta_proteina_g']}g")
    if plano.get("meta_carboidrato_g"): metas.append(f"Carboidratos: {plano['meta_carboidrato_g']}g")
    if plano.get("meta_lipidio_g"): metas.append(f"Lipídios: {plano['meta_lipidio_g']}g")
    if metas:
        conteudo += f'<div class="sec"><div class="sec-title">Metas Nutricionais</div><p>{" &nbsp;|&nbsp; ".join(metas)}</p></div>'
    if plano.get("orientacoes"):
        cards = "".join(
            f"<div style='margin-bottom:14px'><strong>{o.get('titulo','Orientação')}</strong>"
            + (f"<div style='color:#666;font-size:11px;margin-top:2px'>{o.get('categoria')}</div>" if o.get("categoria") else "")
            + f"<p style='white-space:pre-wrap'>{o.get('conteudo','')}</p></div>"
            for o in plano.get("orientacoes", [])
        )
        conteudo += f'<div class="sec"><div class="sec-title">Orientações Nutricionais</div>{cards}</div>'
    for ref in plano.get("refeicoes", []):
        rows = ""
        for a in ref.get("alimentos", []):
            n = a.get("nutrientes", {})
            rows += (f"<tr><td>{a.get('alimento_nome','')}</td><td>{a.get('quantidade_g','')}g</td>"
                     f"<td>{n.get('energia_kcal',0)}</td><td>{n.get('proteinas_g',0)}</td>"
                     f"<td>{n.get('carboidratos_g',0)}</td><td>{n.get('lipidios_g',0)}</td></tr>")
        tot = ref.get("totais", {})
        horario = f" — {ref.get('horario')}" if ref.get("horario") else ""
        conteudo += (f'<div class="sec"><div class="sec-title">{ref.get("nome","")}{horario}</div>'
                     f'<table><tr><th>Alimento</th><th>Qtd</th><th>Energia (kcal)</th>'
                     f'<th>Prot (g)</th><th>CHO (g)</th><th>Lip (g)</th></tr>'
                     f'{rows}<tr style="font-weight:bold;background:#ede9fe">'
                     f'<td colspan="2">Total da refeição</td>'
                     f'<td>{tot.get("energia_kcal",0)}</td><td>{tot.get("proteinas_g",0)}</td>'
                     f'<td>{tot.get("carboidratos_g",0)}</td><td>{tot.get("lipidios_g",0)}</td>'
                     f'</tr></table></div>')
    t = plano.get("totais_dia", {})
    conteudo += (f'<div class="sec"><div class="sec-title">Total do Dia</div>'
                 f'<table><tr><th>Energia</th><th>Proteínas</th><th>Carboidratos</th><th>Lipídios</th><th>Fibras</th><th>Sódio</th></tr>'
                 f'<tr><td>{t.get("energia_kcal",0)} kcal</td><td>{t.get("proteinas_g",0)}g</td>'
                 f'<td>{t.get("carboidratos_g",0)}g</td><td>{t.get("lipidios_g",0)}g</td>'
                 f'<td>{t.get("fibras_g",0)}g</td><td>{t.get("sodio_mg",0)}mg</td></tr></table></div>')
    if plano.get("observacoes"):
        conteudo += f'<div class="sec"><div class="sec-title">Observações</div><p>{plano["observacoes"]}</p></div>'
    html = _pdf_html_base(plano.get("titulo","Plano Alimentar"), p, nutri, conteudo)
    pdf_bytes = HTML(string=html).write_pdf()
    fname = f"plano_{p.get('nome','p').replace(' ','_')}_{datetime.now(TZ_BR).strftime('%Y%m%d')}.pdf"
    return Response(content=pdf_bytes, media_type="application/pdf",
                    headers={"Content-Disposition": f"attachment; filename={fname}"})

# ================================================================
# END MOTOR CLÍNICO
# ================================================================

# ---------- Bootstrap ----------
@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("slug")
    await db.users.create_index("role")
    await db.patients.create_index("lead_token")
    await db.patients.create_index("nutricionista_id")
    await db.patients.create_index("user_id")
    await db.consultations.create_index("nutricionista_id")
    await db.exams.create_index("paciente_id")
    await db.agents.create_index("code", unique=True)
    await db.agent_documents.create_index("agent_code")
    await db.consultorio_messages.create_index([("session_id", 1), ("created_at", 1)])
    await db.patient_messages.create_index([("session_id", 1), ("created_at", 1)])
    await db.patient_nudges.create_index([("active", 1), ("next_run_at", 1)])
    await db.patient_nudges.create_index("patient_id")
    await db.recordatorios.create_index([("paciente_id", 1), ("data", -1)])
    await db.anamneses.create_index("paciente_id")
    await db.alimentos.create_index([("nome", 1)])
    await db.alimentos.create_index([("fonte", 1), ("categoria", 1)])
    await db.alimentos.create_index("grupo")
    await db.alimentos.create_index([("nome", "text")])
    await db.planos_manuais.create_index([("paciente_id", 1), ("criado_em", -1)])
    await db.orientacoes_nutricionais.create_index([("nutricionista_id", 1), ("atualizado_em", -1)])
    await db.orientacoes_nutricionais.create_index([("nutricionista_id", 1), ("categoria", 1)])
    await db.planos_manuais_historico.create_index([("plano_id", 1), ("criado_em", -1)])
    await db.exames_manuais.create_index([("paciente_id", 1), ("data_coleta", -1)])
    # seed alimentos TACO
    await seed_alimentos()
    # seed agents
    await ensure_agents_seeded()
    # start proactive nudge scheduler
    global _scheduler_task
    _scheduler_task = asyncio.create_task(nudge_scheduler_loop())
    # seed admin
    admin_email = os.environ['ADMIN_EMAIL'].lower()
    admin_pass = os.environ['ADMIN_PASSWORD']
    admin_name = os.environ.get('ADMIN_NAME', 'Admin')
    admin_slug = slugify(admin_name) or "admin"
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        await db.users.insert_one({
            "id": str(uuid.uuid4()), "email": admin_email, "name": admin_name,
            "password_hash": hash_password(admin_pass), "role": "nutritionist",
            "slug": admin_slug, "created_at": iso(now_utc()),
        })
    else:
        upd = {}
        if not verify_password(admin_pass, existing["password_hash"]):
            upd["password_hash"] = hash_password(admin_pass)
        if not existing.get("slug"):
            upd["slug"] = admin_slug
        if existing.get("name") != admin_name:
            upd["name"] = admin_name
        if upd:
            await db.users.update_one({"email": admin_email}, {"$set": upd})
    # Backfill slug for any nutritionist missing it
    async for u in db.users.find({"role": "nutritionist", "slug": {"$exists": False}}):
        await db.users.update_one({"id": u["id"]}, {"$set": {"slug": slugify(u.get("name", "user"))}})

@app.on_event("shutdown")
async def shutdown():
    global _scheduler_task
    if _scheduler_task:
        _scheduler_task.cancel()
        try:
            await _scheduler_task
        except (asyncio.CancelledError, Exception):
            pass
    client.close()

# ---------- CORS ----------
@app.get("/health")
async def health():
    return {"status": "ok"}

app.include_router(api)
_frontend_urls = [
    url.strip().rstrip("/")
    for url in (os.environ.get("FRONTEND_URLS") or os.environ.get("FRONTEND_URL") or "http://localhost:3000").split(",")
    if url.strip()
]
if "http://localhost:3000" not in _frontend_urls:
    _frontend_urls.append("http://localhost:3000")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_frontend_urls,
    allow_origin_regex=r"https://[a-zA-Z0-9-]+\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
