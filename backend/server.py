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
import hashlib
import zipfile
import xml.etree.ElementTree as ET
from difflib import SequenceMatcher
import bcrypt
import jwt
import secrets
import unicodedata
from collections import defaultdict, deque
from datetime import datetime, timezone, timedelta, date
from functools import lru_cache
from typing import List, Optional, Any, Literal
from zoneinfo import ZoneInfo

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, status, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr, ConfigDict

from ai.donato.agent import generate_donato_plan_with_openai
from ai.donato.knowledge_sync import prepare_manifest_documents, sync_approved_documents
from ai.donato import gemini_agent as donato_gemini
from ai.donato.manifest import DONATO_KNOWLEDGE_MANIFEST
from ai.donato.openai_client import DonatoProviderUnavailable
from ai.donato.settings import get_donato_settings
from ai.drhouse.knowledge_sync import sync_drhouse_documents
from ai.drhouse.prompt import DRHOUSE_KNOWLEDGE_HEADER, DRHOUSE_PROMPT_VERSION, DRHOUSE_SYSTEM_PROMPT
from llm_chat import LlmChat, UserMessage
from financeiro import build_financeiro_router
from dieta import build_dieta_router
from alimentos_base import BASE_VERSAO, corrigir_mojibake, normalizar_nome, sincronizar_base
import anamnese_form as af
import ciclos as ciclos_mod
import protocolos_dobras as protd
from types import SimpleNamespace
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
GROQ_API_KEY = os.environ.get('GROQ_API_KEY', '').strip()
# Cada modelo da Groq tem cota propria por minuto; o segundo entra quando o primeiro esgota.
GROQ_MODELS = [m.strip() for m in (os.environ.get('GROQ_MODELS') or os.environ.get('GROQ_MODEL') or 'openai/gpt-oss-120b,qwen/qwen3.8-27b').split(',') if m.strip()]
GROQ_TOKENS_PER_REQUEST = int(os.environ.get('GROQ_TOKENS_PER_REQUEST', '7500'))  # plano gratuito: 8000 tokens/min

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
    objetivos: Optional[List[str]] = None
    peso: Optional[float] = None
    altura: Optional[float] = None
    status_funil: str = "LEAD_INICIADO"
    origem: Optional[str] = None  # instagram | site | whatsapp | indicacao | outro

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
    gestante: Optional[bool] = None
    # Perfil atleta: muda o critério de cor das dobras cutâneas (faixas por dobra e sexo).
    atleta: Optional[bool] = None
    # gor1: fase do atleta (off/cutting) e uso de esteroides (sensível: só o nutricionista vê)
    fase_treino: Optional[Literal["off", "cutting"]] = None
    usa_esteroides: Optional[bool] = None
    meta_gordura: Optional[dict] = None
    ciclo_carbo: Optional[dict] = None  # cid1/cic1: ciclo de carboidrato (ver ciclos.py)
    data_primeira_consulta: Optional[str] = None
    observacoes: Optional[str] = Field(default=None, max_length=20000)
    meta_energetica: Optional[dict] = None
    # Modelo de avaliação do paciente (Antropometria + Gasto): "rc" (planilha atual) ou "donatto"
    modelo_avaliacao: Optional[Literal["rc", "donatto"]] = None
    # objetivos marcados (o principal fica em `objetivo`)
    objetivos: Optional[List[str]] = None
    origem: Optional[str] = None
    peso_desejado: Optional[float] = None

class AnamnesisIn(BaseModel):
    token: str
    respostas: dict
    consentimento_lgpd: Optional[bool] = None

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
    protocolo_dobras: Optional[str] = None  # id de protocolos_dobras.PROTOCOLOS
    dobras: Optional[dict] = None            # mm valores
    perimetria: Optional[dict] = None
    nivel_atividade: float = 1.55  # GET factor
    objetivo: str = "manutencao"   # emagrecimento | manutencao | hipertrofia

class MealPlanRequest(BaseModel):
    objetivo: str = "manutencao"
    restricoes: Optional[str] = None

# ---------- Agents / Patient ----------
AGENT_CODES = ("agent1", "agent2", "agent3", "donato", "drhouse", "vendas")
AGENT_PROMPT_MAX_CHARS = 50_000  # cap full system prompt length
# Dr. House carrega o prompt mestre + toda a base de biomarcadores (~65k chars)
AGENT_PROMPT_MAX_CHARS_BY_CODE = {"drhouse": 120_000, "agent2": 120_000}

def _agent_prompt_max_chars(agent_code: str) -> int:
    return AGENT_PROMPT_MAX_CHARS_BY_CODE.get(agent_code, AGENT_PROMPT_MAX_CHARS)
DONATO_SETTINGS = get_donato_settings()
DONATO_SCHEMA_VERSION = DONATO_SETTINGS.schema_version
DONATO_ENABLED = DONATO_SETTINGS.enabled
DONATO_REQUIRE_HUMAN_APPROVAL = DONATO_SETTINGS.require_human_approval
DONATO_STRICT_SOURCE_GATE = DONATO_SETTINGS.strict_source_gate

class AgentPromptUpdate(BaseModel):
    base_prompt: str

class AgentDocCreate(BaseModel):
    title: str
    content: str  # plain text (already extracted)

class DonatoDraftIn(BaseModel):
    objetivo: Optional[str] = None
    numero_refeicoes: int = Field(default=6, ge=1, le=10)
    observacoes: Optional[str] = None
    kcal_meta: Optional[float] = Field(default=None, gt=300, lt=10000)  # CALORIAS DA DIETA (definidas pelo nutricionista)
    refeicoes: Optional[List[dict]] = None  # [{nome, horario, pct}] da Prescrição


class DonatoAplicarIn(BaseModel):
    plano: Optional[dict] = None  # o plano como ficou no editor (revisado pelo nutricionista)


class DonatoRegerarIn(BaseModel):
    kcal_meta: Optional[float] = None
    refeicoes: Optional[List[dict]] = None

class DonatoDraftPatch(BaseModel):
    draft: dict

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
    action: Optional[str] = None

class NudgeIn(BaseModel):
    label: str
    trigger_text: str  # instruction to Agent 3 about what to say
    hour: int = Field(ge=0, le=23)
    minute: int = Field(ge=0, le=59)
    weekdays: Optional[List[int]] = None  # 0=Mon..6=Sun; None = every day
    active: bool = True
    # repetição: diario | semanal (weekdays) | intervalo (a cada X dias) | unica (data) ; `ate` = até o fim do plano/data
    repeticao: Optional[str] = None
    intervalo_dias: Optional[int] = Field(default=None, ge=1, le=90)
    data_unica: Optional[str] = None
    ate: Optional[str] = None
    canal: Optional[str] = "app"  # app | whatsapp
    silencio_inicio: Optional[str] = None  # "22:00"
    silencio_fim: Optional[str] = None  # "07:00"
    modelo: Optional[str] = None

class NudgeUpdate(BaseModel):
    label: Optional[str] = None
    trigger_text: Optional[str] = None
    hour: Optional[int] = Field(default=None, ge=0, le=23)
    minute: Optional[int] = Field(default=None, ge=0, le=59)
    weekdays: Optional[List[int]] = None
    active: Optional[bool] = None
    repeticao: Optional[str] = None
    intervalo_dias: Optional[int] = Field(default=None, ge=1, le=90)
    data_unica: Optional[str] = None
    ate: Optional[str] = None
    canal: Optional[str] = None
    silencio_inicio: Optional[str] = None
    silencio_fim: Optional[str] = None

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
        pct = protd.calcular(proto, sexo, idade, peso, altura, dobras, eval_data.get("perimetria"))["pct_gordura"]

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
    "donato": {
        "name": "Dr. Donatto AI",
        "description": (
            "Agente DONATO para rascunhos estruturados de prescrição dietética, protocolos, "
            "base de conhecimento e motor nutricional com aprovação humana obrigatória."
        ),
        "base_prompt": (
            "Você é o Dr. Donatto AI, assistente interno do nutricionista para gerar rascunhos "
            "estruturados de plano alimentar. Responda em Português (BR). Gere apenas rascunhos "
            "para revisão do nutricionista, nunca publique automaticamente ao paciente. Use dados "
            "ausentes como null, preserve rastreabilidade, respeite alergias/intolerâncias e mantenha "
            "alimentos calculáveis vinculados à base EVONUT."
        ),
        "provider": "openai",
        "knowledge_mode": "vector_store",
        "schema_version": DONATO_SCHEMA_VERSION,
        "requires_human_approval": True,
        "active": True,
    },
    "vendas": {
        "name": "Agente de Vendas — WhatsApp",
        "description": (
            "Atende quem chega pelo WhatsApp (Instagram e site): entende o objetivo, apresenta planos e valores, "
            "envia o link de agendamento quando a pessoa aceita e passa para o Rogério o que for clínico."
        ),
        "base_prompt": (
            "Você é o atendente do Rogério Costa (treinador e nutricionista) no WhatsApp. Responda em português do Brasil, "
            "em mensagens curtas (até 4 linhas), tom próximo e direto, sem emoji em excesso. Faça UMA pergunta por vez.\n\n"
            "OBJETIVO: entender o que a pessoa quer (emagrecer, ganhar massa, saúde, performance), se prefere online ou presencial "
            "e se quer treino, dieta ou os dois; então indicar o plano certo, passar valores e condições e levar ao agendamento.\n\n"
            "PLANOS E VALORES (o Rogério edita esta parte em Agentes IA):\n"
            "- Consultoria Gold: treino + dieta integrados, 3 meses, app com treino e plano alimentar, suporte VIP no WhatsApp. Valor: A DEFINIR.\n"
            "- Nutrition e Training: treino + nutrição, 2 meses. Valor: A DEFINIR.\n"
            "- Personal presencial: aulas presenciais com o Rogério. Valor e horários: A DEFINIR.\n"
            "Condições: Pix ou cartão. A consulta inicial só é marcada após o pagamento.\n"
            "Preço só se passa aqui no WhatsApp (o site não mostra valores).\n\n"
            "PERGUNTAS FREQUENTES:\n"
            "- Como funciona? Consulta inicial, avaliação, plano no app e ajustes pelo acompanhamento.\n"
            "- Falo direto com o Rogério? Sim, o suporte é com ele.\n\n"
            "MARCAÇÃO DE AÇÃO: na maioria das mensagens NÃO escreva marcação nenhuma; continue a conversa normalmente. "
            "Use marcação só nos casos abaixo.\n\n"
            "REGRAS:\n"
            "1. Nunca dê orientação clínica, dieta, dose de suplemento ou opinião sobre exame/remédio/doença. Diga que o Rogério "
            "vai responder pessoalmente e termine com [ACAO: humano].\n"
            "2. Só quando a pessoa PERGUNTAR algo que você não sabe responder (ou pedir um valor que está 'A DEFINIR'), diga que vai "
            "confirmar com o Rogério e termine com [ACAO: humano]. Perguntas de descoberta (objetivo, online/presencial) nunca levam marcação.\n"
            "3. Quando a pessoa ACEITAR um plano (ex.: 'quero', 'fechado', 'vamos', 'quero fechar'), SEMPRE confirme em uma frase e termine com "
            "[ACAO: proposta_aceita | plano=<nome do plano>]. NÃO pergunte forma de pagamento: o sistema anexa o link para escolher o horário "
            "e pagar (Pix ou cartão). Não invente links.\n"
            "4. Quando a pessoa mostrar interesse em UM plano específico sem aceitar ainda, pode terminar com [ACAO: plano | plano=<nome exato>].\n"
            "5. Se quem escreve voltou depois de um tempo, retome com naturalidade e já ofereça o horário.\n"
            "6. A marcação [ACAO: ...] vai sempre na última linha e nunca é mostrada ao cliente."
        ),
        "prompt_version": "vendas-1.2",
        "active": True,
    },
    "drhouse": {
        "name": "Dr. House AI",
        "description": (
            "Agente especialista em interpretação integrada de exames laboratoriais aplicados "
            "à nutrição clínica, com base em biomarcadores e raciocínio funcional."
        ),
        "base_prompt": DRHOUSE_SYSTEM_PROMPT,
        "prompt_version": DRHOUSE_PROMPT_VERSION,
        "provider": "prompt_context",
        "knowledge_mode": "agent_documents",
        "schema_version": "1.0",
        "requires_human_approval": True,
        "active": True,
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
                "provider": cfg.get("provider"),
                "knowledge_mode": cfg.get("knowledge_mode"),
                "schema_version": cfg.get("schema_version"),
                "requires_human_approval": cfg.get("requires_human_approval"),
                "active": cfg.get("active", True),
                "prompt_version": cfg.get("prompt_version"),
                "created_at": iso(now_utc()),
                "updated_at": iso(now_utc()),
            })
        elif (
            cfg.get("prompt_version")
            and existing.get("prompt_version") != cfg["prompt_version"]
            and not existing.get("prompt_customized")
        ):
            # Prompt versionado no codigo: atualiza o salvo, salvo se o nutricionista personalizou
            await db.agents.update_one({"code": code}, {"$set": {
                "base_prompt": cfg["base_prompt"],
                "prompt_version": cfg["prompt_version"],
                "updated_at": iso(now_utc()),
            }})

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
    if name.endswith(".docx") or (content_type or "").lower() in {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/octet-stream",
    }:
        try:
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
        except Exception as e:
            if name.endswith(".docx"):
                raise HTTPException(400, f"Não foi possível ler o DOCX: {str(e)[:140]}")
    # treat everything else as plain text
    try:
        return raw.decode("utf-8", errors="ignore")
    except Exception:
        return ""

async def build_agent_system_prompt(agent_code: str, extra_context: str = "") -> str:
    """Concatenate the agent's base_prompt + uploaded training docs + extra_context.
    Caps at the agent's max chars (_agent_prompt_max_chars) to stay within model context.
    """
    agent = await db.agents.find_one({"code": agent_code}, {"_id": 0})
    if not agent:
        # Fallback to defaults if not seeded yet
        agent = {"base_prompt": AGENT_DEFAULTS[agent_code]["base_prompt"]}
    base = agent.get("base_prompt", "") or ""
    docs = await db.agent_documents.find(
        {
            "agent_code": agent_code,
            "$or": [{"status": "approved"}, {"status": {"$exists": False}}],
            # o documento do prompt mestre ja e o proprio base_prompt; nao duplicar
            "document_type": {"$ne": "base_prompt"},
        },
        {"_id": 0},
    ).sort("created_at", 1).to_list(50)

    parts = [base.strip()]
    if docs and agent_code == "drhouse":
        parts.append("\n\n" + DRHOUSE_KNOWLEDGE_HEADER)
    elif docs:
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
    max_chars = _agent_prompt_max_chars(agent_code)
    if len(full) > max_chars:
        full = full[:max_chars] + "\n\n[...material truncado por limite de contexto...]"
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
        f"{json.dumps(patient_context, ensure_ascii=False, default=str)[:60000]}"
    )
    sys_prompt = await build_agent_system_prompt("agent2", extra_context=extra)
    convo = "".join(f"{m['role']}: {m['content']}\n" for m in history[-10:])
    convo += f"user: {message}"
    return await _ai_chat(f"consult-{session_id}", sys_prompt, convo)

CONSULTORIO_AGENT2_ACTIONS = {
    "clinical_summary": (
        "Gere um resumo clinico objetivo do paciente para abertura da consulta. "
        "Use as secoes: 1) Queixa/objetivo, 2) achados relevantes, 3) hipoteses nutricionais a investigar, "
        "4) proximas perguntas na consulta. Nao feche diagnostico medico."
    ),
    "risk_points": (
        "Liste os pontos de atencao do paciente para revisao do nutricionista. "
        "Separe em sinais metabolicos, comportamento alimentar, treino/rotina, exames e dados faltantes. "
        "Marque prioridade como alta, media ou baixa."
    ),
    "exam_review": (
        "Analise os exames recentes disponiveis no contexto. "
        "Organize por marcador, possivel relevancia nutricional, o que confirmar na consulta e dados ausentes. "
        "Nao invente valores que nao estejam no contexto."
    ),
    "conduct_draft": (
        "Monte um rascunho de conduta nutricional para discussao em consultorio. "
        "Inclua prioridades, ajustes alimentares, suplementacao apenas se houver base suficiente, "
        "monitoramento e alertas para encaminhamento medico quando aplicavel. "
        "Deixe claro que e rascunho para validacao do nutricionista."
    ),
}

def _consultorio_message_for_action(action: Optional[str], message: str) -> str:
    clean = (message or "").strip()
    if action not in CONSULTORIO_AGENT2_ACTIONS:
        return clean
    instruction = CONSULTORIO_AGENT2_ACTIONS[action]
    if clean:
        return f"{instruction}\n\nSolicitacao adicional do nutricionista: {clean}"
    return instruction

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

# Cada modelo tem cota diaria propria: quando um esgota (ou sai do ar), o proximo da lista assume.
_GEMINI_MODELS = [m.strip() for m in (os.environ.get("GEMINI_MODELS") or "gemini-3.5-flash,gemini-3.7-flash,gemini-3.8-flash,gemini-flash-latest,gemini-3.5-flash-lite,gemini-3.1-flash-lite").split(",") if m.strip()]
_GEMINI_MODEL = _GEMINI_MODELS[0]
_GEMINI_RETRY_DELAYS = [2, 5]  # sobrecarga momentanea: 2 novas tentativas por modelo antes de trocar
_gemini_last_model = {"name": _GEMINI_MODEL}

async def _gemini_chat(
    messages: list,
    system_prompt: str,
    api_key: str,
    max_tokens: int = 8192,
    temperature: float = 0.9,
    timeout: float = 90.0,
    thinking_budget: int = 1024,
    response_mime_type: Optional[str] = None,
    models: Optional[list] = None,
    retry_delays: Optional[list] = None,
) -> str:
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
        # No Gemini 2.5 o raciocinio interno consome o mesmo limite de saida;
        # o orcamento separado garante espaco para a resposta em si.
        "generationConfig": {
            "maxOutputTokens": max_tokens,
            "temperature": temperature,
            "thinkingConfig": {"thinkingBudget": thinking_budget},
        },
    }
    if response_mime_type:
        body["generationConfig"]["responseMimeType"] = response_mime_type
    falhas = []
    async with httpx.AsyncClient(timeout=timeout) as client:
        for model in (models or _GEMINI_MODELS):
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
            last_err = "desconhecido"
            for attempt, delay in enumerate([0] + (_GEMINI_RETRY_DELAYS if retry_delays is None else retry_delays)):
                if delay:
                    await asyncio.sleep(delay)
                try:
                    resp = await client.post(url, params={"key": api_key}, json=body)
                    data = resp.json()
                except httpx.TimeoutException:
                    last_err = "Timeout"
                    logging.warning("Gemini %s timeout na tentativa %s", model, attempt + 1)
                    continue
                if resp.is_success:
                    candidate = (data.get("candidates") or [{}])[0]
                    parts = (candidate.get("content") or {}).get("parts") or []
                    text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
                    if candidate.get("finishReason") == "MAX_TOKENS":
                        logging.warning("Gemini %s cortou a resposta por limite de tokens (%s chars)", model, len(text))
                    if text:
                        _gemini_last_model["name"] = model
                        return text
                    last_err = f"sem texto (finishReason={candidate.get('finishReason')})"
                    break
                last_err = data.get("error", {}).get("message", f"HTTP {resp.status_code}")
                if resp.status_code in (401, 403):
                    raise ValueError(f"Chave Gemini recusada: {last_err[:160]}")  # trocar de modelo nao resolve
                if resp.status_code in (404, 429) or resp.status_code == 400:
                    break  # cota esgotada, modelo indisponivel ou parametro nao aceito: proximo modelo
                logging.warning("Gemini %s tentativa %s: %s", model, attempt + 1, last_err[:120])
            falhas.append(f"{model}: {last_err[:90]}")
            logging.warning("Gemini %s indisponivel, tentando o proximo modelo: %s", model, last_err[:120])
    raise ValueError("Cota da Gemini esgotada ou indisponivel em todos os modelos. " + " | ".join(falhas))

class _ProviderSkip(Exception):
    """Provedor nao se aplica a esta chamada (ex.: prompt maior que a cota da Groq)."""


async def _groq_chat(messages: list, system_prompt: str, max_tokens: Optional[int] = None,
                     temperature: Optional[float] = None, timeout: Optional[float] = None) -> str:
    import httpx
    approx_in = (len(system_prompt) + sum(len(str(m.get("content", ""))) for m in messages)) // 3
    # A saida reservada tambem conta na cota por minuto: reserva so o necessario para chat.
    out = min(max_tokens or 1024, 4096)
    if approx_in + out > GROQ_TOKENS_PER_REQUEST:
        raise _ProviderSkip(f"~{approx_in} tokens excede a cota por minuto da Groq")
    convo = [{"role": "system", "content": system_prompt}] + [
        {"role": "assistant" if m.get("role") == "assistant" else "user", "content": str(m.get("content", ""))}
        for m in messages
    ]
    ultimo_erro = "sem modelo configurado"
    async with httpx.AsyncClient(timeout=timeout or 60.0) as client:
        for model in GROQ_MODELS:
            body = {"model": model, "messages": convo, "max_completion_tokens": out}
            if "gpt-oss" in model:
                body["reasoning_effort"] = "low"  # modelo de raciocinio: evita gastar a saida pensando
            elif "qwen3" in model:
                body["reasoning_effort"] = "none"
            if temperature is not None:
                body["temperature"] = temperature
            resp = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
                json=body,
            )
            data = resp.json()
            if resp.is_success:
                text = ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
                text = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()
                if text:
                    return text
                ultimo_erro = f"{model}: resposta vazia"
                continue
            ultimo_erro = f"{model} HTTP {resp.status_code}: {(data.get('error') or {}).get('message', '')[:120]}"
            if resp.status_code not in (429, 503):
                break  # erro que nao se resolve trocando de modelo
    raise ValueError(f"Groq: {ultimo_erro}")


async def _anthropic_chat(messages: list, system_prompt: str, session_id: str = "",
                          max_tokens: Optional[int] = None, temperature: Optional[float] = None) -> str:
    if len(messages) == 1:
        user_text = str(messages[0].get("content", ""))
    else:
        user_text = "\n\n".join(f"{str(m.get('role', 'user')).upper()}: {m.get('content', '')}" for m in messages)
    chat = LlmChat(api_key=ANTHROPIC_API_KEY, session_id=session_id, system_message=system_prompt).with_model(
        "anthropic", "claude-sonnet-4-6"
    )
    return await chat.send_message(UserMessage(text=user_text.strip() or "Ola!"), max_tokens=max_tokens, temperature=temperature)


async def _ai_chat_messages(
    messages: list,
    system_prompt: str,
    session_id: str = "",
    max_tokens: Optional[int] = None,
    temperature: Optional[float] = None,
    timeout: Optional[float] = None,
) -> str:
    """Tenta os provedores na ordem de AI_PROVIDER_ORDER; se um falhar (cota, sobrecarga), usa o proximo."""
    order = [x.strip().lower() for x in (os.environ.get("AI_PROVIDER_ORDER") or "gemini,groq,anthropic").split(",") if x.strip()]
    falhas = []
    for provider in order:
        try:
            if provider == "gemini" and GEMINI_KEY:
                opts = {}
                if max_tokens is not None:
                    opts["max_tokens"] = max_tokens
                    if max_tokens >= 12000:
                        opts["thinking_budget"] = 4096  # analises longas (ex.: Dr. House)
                if temperature is not None:
                    opts["temperature"] = temperature
                if timeout is not None:
                    opts["timeout"] = timeout
                return await _gemini_chat(messages, system_prompt, GEMINI_KEY, **opts)
            if provider == "groq" and GROQ_API_KEY:
                return await _groq_chat(messages, system_prompt, max_tokens, temperature, timeout)
            if provider == "anthropic" and ANTHROPIC_API_KEY:
                return await _anthropic_chat(messages, system_prompt, session_id, max_tokens, temperature)
        except _ProviderSkip as exc:
            falhas.append(f"{provider}: {exc}")
        except Exception as exc:
            logging.warning("Provedor de IA %s falhou: %s", provider, str(exc)[:200])
            falhas.append(f"{provider}: {str(exc)[:160]}")
    raise ValueError("Nenhum provedor de IA respondeu. " + " | ".join(falhas or ["nenhuma chave configurada"]))


async def _ai_chat(
    session_id: str,
    system_prompt: str,
    user_text: str,
    max_tokens: Optional[int] = None,
    temperature: Optional[float] = None,
    timeout: Optional[float] = None,
) -> str:
    return await _ai_chat_messages(
        [{"role": "user", "content": user_text}], system_prompt,
        session_id=session_id, max_tokens=max_tokens, temperature=temperature, timeout=timeout,
    )

async def ai_exam_analysis(raw_text: str) -> dict:
    """Extract laboratory markers from exam PDF text and classify them.
    Returns: {markers: [{nome, valor, unidade, referencia, status}], resumo, conduta_sugerida}
    """
    await ensure_agents_seeded()
    system_prompt = await build_agent_system_prompt(
        "drhouse",
        extra_context=(
            "Tarefa desta chamada: extrair e interpretar exames laboratoriais em JSON para a tela de exames. "
            "Nesta chamada IGNORE o FORMATO OBRIGATORIO DA RESPOSTA em Markdown; mantenha as regras "
            "fundamentais e a linguagem probabilistica. "
            "Devolva APENAS JSON valido, sem markdown e sem comentarios."
        ),
    )
    prompt = (
        "Texto extraido do exame:\n\n"
        f"{raw_text[:12000]}\n\n"
        "Formato obrigatorio:\n"
        '{"markers":[{"nome":"...","valor":"...","unidade":"...","referencia":"...","status":"normal|atencao|prioridade","observacao":"..."}],'
        '"resumo":"...","conduta_sugerida":"..."}\n'
        "Status: normal para dentro da referencia, atencao para limitrofe/leve, prioridade para alteracao relevante. "
        "Nao diagnostique e nao prescreva."
    )
    raw = await _ai_chat(
        f"drhouse-exame-{uuid.uuid4()}", system_prompt, prompt,
        max_tokens=8192, temperature=0.2, timeout=120.0,
    )
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

ATENDIMENTO_SYSTEM_PROMPT = """REGRA DE APRESENTACAO: nunca mostre ao visitante nomes de etapas (ex.: ETAPA 1, SAUDACAO), titulos de fluxo ou instrucoes internas. Escreva apenas a mensagem natural da conversa.

Você é RC Nutri, o assistente de primeiro contato do nutricionista e treinador Rogério Costa.

Seu objetivo é realizar o primeiro contato com o potencial paciente, coletar informações essenciais, qualificá-lo e apresentar os planos da consultoria.

Tom: motivador, empático, linguagem informal mas profissional. Use emojis moderadamente. Valide cada resposta antes de avançar.

FLUXO OBRIGATÓRIO (siga exatamente esta ordem, nunca pule etapas):

ETAPA 1 — SAUDAÇÃO:
Comece apresentando-se e pedindo o nome do visitante. Após receber o nome, use exatamente:
"Olá {nome} tudo bem? SEJA MUITO BEM VINDO(A)! 😊

Vou te explicar todos os detalhes da consultoria online do Rogério.
Mas antes preciso fazer algumas perguntas para ver se essa consultoria serve para você, ok?"

Depois pergunte: "Qual perfil e objetivo abaixo que você se encaixa atualmente?"
1. Quero ganhar massa e volume muscular ðŸ’ª
2. Quero perder barriga, definir o corpo e emagrecer sem flacidez ðŸ”¥
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
"COMO FUNCIONA A CONSULTORIA FITNESS GOLD ðŸ†

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

Fique de olho no seu WhatsApp ðŸ“±"

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
        reply = await _ai_chat_messages(msgs, ATENDIMENTO_SYSTEM_PROMPT, session_id=f"atend-{sid}")
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
        "status_funil": "LEAD_INICIADO", "origem": "site",
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

# ── Formulário pré-consulta e anamnese por blocos (perguntas em anamnese_form.py) ──

def _map_preconsulta(r: dict) -> dict:
    """Respostas soltas do formulário -> {bloco: {pergunta: valor}}."""
    return af.agrupar(r)


def _limpar_resposta(v):
    if isinstance(v, str):
        return v[:5000]
    if v is None or isinstance(v, (bool, int, float)):
        return v
    if isinstance(v, list):
        return [_limpar_resposta(x) for x in v[:30]]
    if isinstance(v, dict):
        return {str(k)[:60]: _limpar_resposta(x) for k, x in list(v.items())[:10]}
    return str(v)[:5000]


async def _anamnese_principal(pid: str) -> Optional[dict]:
    """A anamnese do paciente organizada pelos blocos do formulário (+ nomes de campo antigos, para leitura).
    Na primeira leitura de um paciente antigo junta os documentos antigos e grava os blocos migrados,
    sem apagar nenhum campo antigo."""
    docs = await db.anamneses.find({"paciente_id": pid}, {"_id": 0}).to_list(50)
    if not docs:
        return None
    atuais = [d for d in docs if d.get("formulario_versao") == 2]
    if atuais:
        return af.com_campos_antigos(atuais[0])
    docs.sort(key=lambda d: str(d.get("atualizado_em") or d.get("criado_em") or d.get("created_at") or ""))
    junto, respostas = {}, {}
    for d in docs:
        junto.update({k: v for k, v in d.items() if v not in (None, "", [], {})})
        respostas.update({k: v for k, v in (d.get("respostas") or {}).items() if v not in (None, "", [], {})})
    junto["respostas"] = respostas
    doc = af.montar_documento(junto)
    alvo = docs[-1]
    filtro = {"id": alvo["id"]} if alvo.get("id") else {"paciente_id": pid}
    await db.anamneses.update_one(filtro, {"$set": {
        "formulario": doc["formulario"], "formulario_outras": doc["formulario_outras"], "formulario_versao": 2}})
    doc["id"] = alvo.get("id")
    return af.com_campos_antigos(doc)


async def _salvar_formulario(pid: str, nutricionista_id: Optional[str], respostas: dict, apagar_vazios: bool = False,
                             outras: Optional[dict] = None, extra: Optional[dict] = None) -> dict:
    doc = await _anamnese_principal(pid)
    agora = iso(now_utc())
    blocos = [b["key"] for b in af.BLOCOS]
    form = {b: dict(((doc or {}).get("formulario") or {}).get(b) or {}) for b in blocos}
    for k, v in (respostas or {}).items():
        perg = af.PERGUNTAS.get(k)
        if not perg:
            continue
        if v in (None, "", [], {}):
            if apagar_vazios:
                form[perg["bloco"]].pop(k, None)
        else:
            form[perg["bloco"]][k] = v
    outras_atual = {b: dict(((doc or {}).get("formulario_outras") or {}).get(b) or {}) for b in blocos}
    for bloco, itens in (outras or {}).items():
        if bloco in outras_atual and isinstance(itens, dict):
            for rotulo, v in itens.items():
                if v in (None, "", [], {}):
                    outras_atual[bloco].pop(rotulo, None)
                else:
                    outras_atual[bloco][str(rotulo)[:80]] = _limpar_resposta(v)
    sets = {"formulario": form, "formulario_outras": outras_atual, "formulario_versao": 2, "atualizado_em": agora, **(extra or {})}
    if doc:
        await db.anamneses.update_one({"id": doc["id"]} if doc.get("id") else {"paciente_id": pid}, {"$set": sets})
    else:
        await db.anamneses.insert_one({"id": str(uuid.uuid4()), "paciente_id": pid, "nutricionista_id": nutricionista_id,
                                       "criado_em": agora, "created_at": agora, **sets})
    return await _anamnese_principal(pid)


_SEXO_FORM = {"Feminino": "F", "Masculino": "M"}


def _numero(v) -> Optional[float]:
    try:
        return float(str(v).replace(",", ".").strip())
    except (TypeError, ValueError):
        return None


@api.get("/public/preconsulta/estrutura")
async def preconsulta_estrutura(tipo: str = "inicial"):
    return af.estrutura_publica("retorno" if tipo == "retorno" else "inicial")


def _estado_formulario(p: dict) -> dict:
    """Situação do formulário do paciente: aberto (pode responder) ou respondido (travado até o nutricionista
    clicar em Reenviar / Enviar retorno). Pacientes antigos que já enviaram contam como respondido."""
    f = dict(p.get("formulario") or {})
    if not f:
        f = {"tipo": "inicial", "estado": "respondido" if p.get("preconsulta_enviada_em") else "aberto",
             "respondido_em": p.get("preconsulta_enviada_em")}
    f.setdefault("tipo", "inicial")
    return f


@api.get("/public/lead/{token}/formulario")
async def formulario_publico(token: str):
    """O que a página do formulário precisa saber: qual formulário, se já foi respondido, a consulta marcada
    e o WhatsApp do nutricionista (tela final)."""
    p = await _lead_por_token(token)
    f = _estado_formulario(p)
    agora = iso(now_utc())
    consulta = await db.consultations.find_one(
        {"paciente_id": p["id"], "data_hora": {"$gte": agora[:16]}, "status": {"$nin": ["CANCELADA", "CANCELADO"]}},
        {"_id": 0, "data_hora": 1, "tipo": 1}, sort=[("data_hora", 1)])
    nutri = await db.users.find_one({"id": p.get("nutricionista_id")}, {"_id": 0, "telefone": 1, "telefone_clinica": 1, "name": 1}) or {}
    fone = re.sub(r"\D", "", str(nutri.get("telefone_clinica") or nutri.get("telefone") or ""))
    return {"tipo": f.get("tipo"), "estado": f.get("estado"), "respondido_em": f.get("respondido_em"),
            "nome": p.get("nome"), "consulta": consulta, "whatsapp": fone or None}


class EnviarFormularioIn(BaseModel):
    tipo: Literal["inicial", "retorno"] = "inicial"


@api.post("/patients/{pid}/formulario/enviar")
async def enviar_formulario(pid: str, payload: EnviarFormularioIn, user=Depends(require_nutritionist)):
    """Reenviar o formulário pré-consulta ou enviar o questionário de retorno: destrava o link do paciente."""
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    token = p.get("lead_token") or secrets.token_urlsafe(16)
    f = {"tipo": payload.tipo, "estado": "aberto", "enviado_em": iso(now_utc())}
    await db.patients.update_one({"id": pid}, {"$set": {"formulario": f, "lead_token": token},
                                               "$unset": {"preconsulta_rascunho": ""}})
    return {"ok": True, "token": token, "formulario": f}


class FotoPublicaIn(BaseModel):
    pose: Literal["frente", "lado", "costas"]
    data_url: str
    tipo: Literal["inicial", "retorno"] = "inicial"


@api.post("/public/lead/{token}/foto")
async def foto_formulario(token: str, payload: FotoPublicaIn):
    """Foto de avaliação enviada pelo formulário (frente, lado, costas). Fica com as fotos das avaliações."""
    p = await _lead_por_token(token)
    if not payload.data_url.startswith("data:image/") or len(payload.data_url) > 4_500_000:
        raise HTTPException(400, "Envie uma imagem de até 3 MB")
    grupo = "preconsulta" if payload.tipo == "inicial" else f"retorno-{iso(now_utc())[:10]}"
    doc = {"id": str(uuid.uuid4()), "paciente_id": p["id"], "avaliacao_id": grupo, "pose": payload.pose,
           "data_url": payload.data_url, "enviado_em": iso(now_utc()), "origem": "formulario"}
    await db.avaliacao_fotos.delete_many({"paciente_id": p["id"], "avaliacao_id": grupo, "pose": payload.pose})
    await db.avaliacao_fotos.insert_one(dict(doc))
    return {"id": doc["id"], "pose": payload.pose}


async def _recordatorio_da_rotina(p: dict, rotina) -> None:
    """Rotina alimentar guiada do formulário -> rascunho de recordatório (texto livre, sem cálculo)."""
    if not isinstance(rotina, list):
        return
    refeicoes = []
    for i, r in enumerate(rotina[:8], 1):
        if not isinstance(r, dict) or not (r.get("refeicao") or r.get("alimentos")):
            continue
        itens = [x.strip() for x in re.split(r"\s*\+\s*|,\s*|\n", str(r.get("alimentos") or "")) if x.strip()][:12]
        refeicoes.append({"numero": i, "nome": str(r.get("refeicao") or f"Refeição {i}")[:80], "horario": str(r.get("horario") or "")[:10],
                          "itens": [{"n": k + 1, "alimento_id": None, "alimento_nome": t[:120], "medida_nome": "Gramas", "quantidade": 0, "quantidade_g": 0}
                                    for k, t in enumerate(itens)], "observacao": ""})
    if not refeicoes:
        return
    if await db.recordatorios.find_one({"paciente_id": p["id"], "origem": "formulario"}):
        return
    try:
        payload = RecordatorioIn(data=iso(now_utc())[:10], refeicoes=refeicoes, observacoes="Rotina informada no formulário pré-consulta.")
        rec = await _build_recordatorio_model(payload, p["id"], p.get("nutricionista_id"))
        from recordatorio_calc import finalizar_recordatorio
        doc = finalizar_recordatorio(rec).model_dump()
        doc.update({"id": str(uuid.uuid4()), "origem": "formulario", "created_at": iso(now_utc())})
        await db.recordatorios.insert_one(doc)
    except Exception as e:  # o formulário não pode falhar por causa do recordatório
        logging.getLogger(__name__).warning("recordatorio da rotina: %s", e)


async def _lead_por_token(token: str) -> dict:
    p = await db.patients.find_one({"lead_token": token}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Lead não encontrado")
    return p


@api.post("/public/anamnesis")
async def submit_anamnesis(payload: AnamnesisIn):
    p = await _lead_por_token(payload.token)
    if _estado_formulario(p).get("estado") == "respondido":
        raise HTTPException(409, "Este formulário já foi enviado. Se precisar mudar algo, fale com o Rogério.")
    r = {k: _limpar_resposta(v) for k, v in (payload.respostas or {}).items() if k in af.PERGUNTAS}
    faltando = af.obrigatorias_faltando(r)
    if faltando:
        raise HTTPException(400, "Responda as perguntas obrigatórias: " + ", ".join(str(af.PERGUNTAS[k]["n"]) for k in faltando))
    agora = iso(now_utc())
    doc = await _salvar_formulario(p["id"], p.get("nutricionista_id"), r,
                                   extra={"respostas": r, "enviado_em": agora, "origem": "pre_consulta",
                                          **({"consentimento_lgpd_em": agora} if payload.consentimento_lgpd else {})})
    # o Bloco 1 também atualiza o cadastro do paciente
    upd = {"status_funil": "ANAMNESE_COMPLETA", "preconsulta_enviada_em": agora,
           "formulario": {"tipo": "inicial", "estado": "respondido", "respondido_em": agora}}
    if r.get("nome"):
        upd["nome"] = str(r["nome"]).strip()
    if r.get("email"):
        upd["email"] = str(r["email"]).strip().lower()
    if r.get("data_nascimento"):
        upd["data_nascimento"] = str(r["data_nascimento"])[:10]
    if r.get("sexo") in _SEXO_FORM:
        upd["sexo"] = _SEXO_FORM[r["sexo"]]
    peso, altura = _numero(r.get("peso_atual")), _numero(r.get("estatura"))
    if peso:
        upd["peso"] = peso
    if altura:
        upd["altura"] = int(round(altura))
    objetivos = af.objetivos_da_resposta(r.get("objetivo"))
    if objetivos:
        principal = r.get("objetivo_principal") if r.get("objetivo_principal") in objetivos else objetivos[0]
        upd["objetivos"] = objetivos
        upd["objetivo"] = str(principal)[:300]
    if str(r.get("condicionamento") or "").startswith("Atleta"):
        upd["atleta"] = True
    if _numero(r.get("peso_desejado")):
        upd["peso_desejado"] = _numero(r.get("peso_desejado"))
    await db.patients.update_one({"id": p["id"]}, {"$set": upd, "$unset": {"preconsulta_rascunho": ""}})
    await _recordatorio_da_rotina(p, r.get("rotina_alimentar"))
    return {"ok": True, "anamnesis_id": (doc or {}).get("id")}


class RascunhoIn(BaseModel):
    respostas: dict


@api.post("/public/retorno")
async def submit_retorno(payload: AnamnesisIn):
    """Questionário de retorno (antes da reavaliação): fica na anamnese, em `retornos`, com a data."""
    p = await _lead_por_token(payload.token)
    f = _estado_formulario(p)
    if f.get("tipo") != "retorno" or f.get("estado") != "aberto":
        raise HTTPException(409, "Este questionário já foi enviado ou não está liberado.")
    r = {k: _limpar_resposta(v) for k, v in (payload.respostas or {}).items() if k in af.PERGUNTAS_RETORNO}
    faltando = af.obrigatorias_faltando(r, af.RETORNO_BLOCOS)
    if faltando:
        raise HTTPException(400, "Responda as perguntas obrigatórias: " + ", ".join(str(af.PERGUNTAS_RETORNO[k]["n"]) for k in faltando))
    agora = iso(now_utc())
    entrada = {"id": str(uuid.uuid4()), "respondido_em": agora, "respostas": r}
    if await db.anamneses.find_one({"paciente_id": p["id"]}):
        await db.anamneses.update_one({"paciente_id": p["id"]}, {"$push": {"retornos": entrada}, "$set": {"atualizado_em": agora}})
    else:
        await db.anamneses.insert_one({"id": str(uuid.uuid4()), "paciente_id": p["id"], "nutricionista_id": p.get("nutricionista_id"),
                                       "criado_em": agora, "retornos": [entrada], "formulario_versao": 2, "formulario": {}, "formulario_outras": {}})
    await db.patients.update_one({"id": p["id"]}, {"$set": {"formulario": {"tipo": "retorno", "estado": "respondido", "respondido_em": agora}},
                                                   "$unset": {"preconsulta_rascunho": ""}})
    return {"ok": True}


@api.get("/public/lead/{token}/rascunho")
async def get_rascunho(token: str):
    p = await _lead_por_token(token)
    return p.get("preconsulta_rascunho") or {}


@api.put("/public/lead/{token}/rascunho")
async def salvar_rascunho(token: str, payload: RascunhoIn):
    """Rascunho salvo a cada resposta: o cliente pode fechar e voltar pelo mesmo link."""
    p = await _lead_por_token(token)
    r = {k: _limpar_resposta(v) for k, v in (payload.respostas or {}).items() if k in af.PERGUNTAS or k in af.PERGUNTAS_RETORNO}
    if len(json.dumps(r, ensure_ascii=False)) > 150_000:
        raise HTTPException(413, "Rascunho grande demais")
    await db.patients.update_one({"id": p["id"]}, {"$set": {"preconsulta_rascunho": {"respostas": r, "atualizado_em": iso(now_utc())}}})
    return {"ok": True}


_tarefas_fundo: set = set()


async def _analisar_exame_preconsulta(eid: str, contents: bytes):
    """Mesmo fluxo do 'Enviar exame' em PDF, em segundo plano (o cliente não espera a IA)."""
    try:
        with pdfplumber.open(io.BytesIO(contents)) as pdf:
            raw = "\n".join((page.extract_text() or "") for page in pdf.pages)
        if not raw.strip():
            await db.exams.update_one({"id": eid}, {"$set": {"resumo": "PDF enviado pelo paciente na pré-consulta. O texto não pôde ser lido (provavelmente digitalizado): abra o arquivo."}})
            return
        analysis = await ai_exam_analysis(raw)
        await db.exams.update_one({"id": eid}, {"$set": {
            "raw_text": raw[:6000], "markers": analysis.get("markers", []), "resumo": analysis.get("resumo", ""),
            "conduta_sugerida": analysis.get("conduta_sugerida", "")}})
    except Exception:
        logging.exception("Analise do exame da pre-consulta falhou")
        await db.exams.update_one({"id": eid}, {"$set": {"resumo": "PDF enviado pelo paciente na pré-consulta. A análise automática falhou: abra o arquivo."}})


@api.post("/public/lead/{token}/arquivo")
async def upload_arquivo_preconsulta(token: str, destino: str = "exame", file: UploadFile = File(...)):
    """Anexos do formulário: exames (pergunta 20, entram na aba Exames) e plano alimentar anterior (pergunta 36)."""
    if destino not in ("exame", "plano_anterior"):
        raise HTTPException(400, "Destino inválido")
    p = await _lead_por_token(token)
    ct = (file.content_type or "").lower()
    if ct not in af.UPLOAD_TIPOS:
        raise HTTPException(400, "Envie PDF, JPG ou PNG")
    contents = await file.read()
    if len(contents) > af.UPLOAD_MAX_BYTES:
        raise HTTPException(400, "Arquivo maior que 10 MB")
    if await db.anexos_paciente.count_documents({"paciente_id": p["id"], "origem": "pre_consulta"}) >= 20:
        raise HTTPException(400, "Limite de 20 arquivos atingido")
    agora = iso(now_utc())
    nome = (file.filename or f"arquivo{af.UPLOAD_TIPOS[ct]}")[:120]
    aid = str(uuid.uuid4())
    await db.anexos_paciente.insert_one({
        "id": aid, "paciente_id": p["id"], "nutricionista_id": p.get("nutricionista_id"), "destino": destino,
        "origem": "pre_consulta", "file_name": nome, "content_type": ct,
        "data_url": f"data:{ct};base64,{_base64.b64encode(contents).decode()}", "created_at": agora,
    })
    out = {"id": aid, "nome": nome}
    if destino == "exame":
        eid = str(uuid.uuid4())
        pdf = ct == "application/pdf"
        await db.exams.insert_one({
            "id": eid, "paciente_id": p["id"], "file_name": nome, "markers": [],
            "resumo": "Enviado pelo paciente na pré-consulta. Analisando…" if pdf else "Imagem enviada pelo paciente na pré-consulta (sem leitura automática): abra o arquivo.",
            "conduta_sugerida": "", "observacoes": "", "origem": "pre_consulta", "anexo_id": aid, "created_at": agora,
        })
        if pdf:
            tarefa = asyncio.create_task(_analisar_exame_preconsulta(eid, contents))
            _tarefas_fundo.add(tarefa)
            tarefa.add_done_callback(_tarefas_fundo.discard)
        out["exame_id"] = eid
    return out


@api.get("/patients/{pid}/anexos/{aid}")
async def baixar_anexo(pid: str, aid: str, user=Depends(require_nutritionist)):
    if not await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]}, {"_id": 1}):
        raise HTTPException(404, "Paciente não encontrado")
    a = await db.anexos_paciente.find_one({"id": aid, "paciente_id": pid}, {"_id": 0})
    if not a:
        raise HTTPException(404, "Arquivo não encontrado")
    conteudo = _base64.b64decode(a["data_url"].split(",", 1)[1])
    nome = re.sub(r'[^\w.\- ]', "_", a.get("file_name") or "arquivo")
    return Response(content=conteudo, media_type=a.get("content_type") or "application/octet-stream",
                    headers={"Content-Disposition": f'inline; filename="{nome}"'})


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

    anam = await _anamnese_principal(p["id"])
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
    "LEAD_INICIADO", "PROPOSTA_ACEITA", "ANAMNESE_COMPLETA", "CONSULTA_AGENDADA",
    "CONSULTA_REALIZADA", "PLANO_ENTREGUE", "EM_ACOMPANHAMENTO", "INATIVO", "PERDIDO",
}
# etapa da lista de Pacientes (ajuste pac1): lead não conta como paciente
_ETAPA_DO_STATUS = {"LEAD_INICIADO": "lead", "LEAD_ATENDIMENTO": "lead", "PROPOSTA_ACEITA": "lead", "ANAMNESE_COMPLETA": "atendimento", "CONSULTA_AGENDADA": "atendimento",
                    "CONSULTA_REALIZADA": "atendimento", "PLANO_ENTREGUE": "atendimento", "EM_ACOMPANHAMENTO": "acompanhamento",
                    "INATIVO": "inativo", "PERDIDO": "perdido"}

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

# ── Agendamento + pagamento: só agenda se pagar (ajuste fn2 do Rogério) ─────
# Horário fica RESERVADO 15 min; o meio de pagamento avisa o app pelo webhook (ou o nutricionista confirma o
# comprovante do Pix) e aí a consulta vira agendada, o paciente "Agendada" e o pagamento é registrado.
RESERVA_MINUTOS = 15
_HORAS_AGENDA = [8, 9, 10, 11, 14, 15, 16, 17, 18]


async def _nutri_padrao() -> Optional[dict]:
    nid = os.environ.get("NUTRICIONISTA_PADRAO_ID")
    filtro = {"id": nid} if nid else {"role": "nutritionist"}
    return await db.users.find_one(filtro, {"_id": 0, "password_hash": 0}, sort=[("created_at", 1)])


def _reserva_ativa(r: dict, agora: datetime) -> bool:
    if r.get("status") in ("confirmada", "confirmando", "paga"):
        return True
    if r.get("status") == "comprovante_enviado":
        return True  # aguardando o nutricionista conferir
    try:
        return r.get("status") == "aguardando_pagamento" and datetime.fromisoformat(r["expira_em"]) > agora
    except (KeyError, ValueError):
        return False


async def _horarios_livres(nid: str, dias: int = 14) -> list:
    agora = now_utc()
    ocupados = []  # (inicio, fim) em horário local, com folga de deslocamento para presenciais
    async for c in db.consultations.find({"nutricionista_id": nid, "status": {"$nin": ["CANCELADA", "CANCELADO"]}}, {"_id": 0, "data_hora": 1, "tipo": 1, "modalidade": 1}):
        try:
            ini = datetime.fromisoformat(str(c["data_hora"]).replace("Z", "+00:00"))
            ini = (ini if ini.tzinfo else ini.replace(tzinfo=TZ_BR)).astimezone(TZ_BR)
        except (KeyError, ValueError):
            continue
        folga = 30 if "presencial" in f"{c.get('tipo', '')} {c.get('modalidade', '')}".lower() else 0
        ocupados.append((ini - timedelta(minutes=folga), ini + timedelta(minutes=60 + folga)))
    async for r in db.reservas.find({"nutricionista_id": nid}, {"_id": 0}):
        if _reserva_ativa(r, agora):
            ini = datetime.fromisoformat(r["data_hora"]).astimezone(TZ_BR)
            folga = 30 if r.get("modalidade") == "presencial" else 0
            ocupados.append((ini - timedelta(minutes=folga), ini + timedelta(minutes=60 + folga)))
    hoje = agora.astimezone(TZ_BR).date()
    out = []
    for d in range(1, dias + 1):
        dia = hoje + timedelta(days=d)
        if dia.weekday() == 6:
            continue
        for h in _HORAS_AGENDA:
            ini = datetime(dia.year, dia.month, dia.day, h, 0, tzinfo=TZ_BR)
            fim = ini + timedelta(minutes=60)
            livre = not any(a < fim and ini < b for a, b in ocupados)
            out.append({"datetime": ini.isoformat(), "data": dia.isoformat(), "hora": f"{h:02d}:00", "livre": livre})
    return out


@api.get("/public/agenda/horarios")
async def horarios_publicos():
    nutri = await _nutri_padrao()
    if not nutri:
        raise HTTPException(404, "Agenda indisponível")
    return await _horarios_livres(nutri["id"])


class ReservaIn(BaseModel):
    nome: str = Field(min_length=2, max_length=120)
    telefone: str = Field(min_length=8, max_length=30)
    email: Optional[EmailStr] = None
    data_hora: str
    modalidade: Literal["online", "presencial"] = "online"
    plano: Optional[str] = Field(default=None, max_length=80)
    token: Optional[str] = None  # lead que já existe (link do WhatsApp)


def _reserva_publica(r: dict) -> dict:
    agora = now_utc()
    status = r.get("status")
    if status == "aguardando_pagamento" and datetime.fromisoformat(r["expira_em"]) <= agora:
        status = "expirada"
    return {"id": r["id"], "status": status, "data_hora": r["data_hora"], "modalidade": r.get("modalidade"),
            "expira_em": r.get("expira_em"), "segundos": max(0, int((datetime.fromisoformat(r["expira_em"]) - agora).total_seconds())),
            "valor": r.get("valor"), "pix_chave": r.get("pix_chave"), "pix_nome": r.get("pix_nome"),
            "token": r.get("lead_token") if status == "confirmada" else None, "checkout_url": r.get("checkout_url")}


@api.post("/public/reservas", status_code=201)
async def criar_reserva(payload: ReservaIn):
    nutri = await _nutri_padrao()
    if not nutri:
        raise HTTPException(404, "Agenda indisponível")
    livres = {s["datetime"] for s in await _horarios_livres(nutri["id"]) if s["livre"]}
    if payload.data_hora not in livres:
        raise HTTPException(409, "Esse horário acabou de ser reservado. Escolha outro.")
    # paciente: pelo token do link, pelo telefone ou novo lead
    p = await db.patients.find_one({"lead_token": payload.token}) if payload.token else None
    if not p:
        p = await _paciente_por_telefone(nutri["id"], payload.telefone)
    agora = now_utc()
    if not p:
        p = {"id": str(uuid.uuid4()), "nutricionista_id": nutri["id"], "lead_token": secrets.token_urlsafe(16), "nome": payload.nome.strip(),
             "telefone": payload.telefone, "email": str(payload.email).lower() if payload.email else None, "status_funil": "LEAD_INICIADO",
             "origem": "site", "created_at": iso(agora), "updated_at": iso(agora)}
        await db.patients.insert_one(dict(p))
    cfg = await db.dieta_config.find_one({"nutricionista_id": nutri["id"]}, {"_id": 0}) or {}
    reserva = {"id": str(uuid.uuid4()), "nutricionista_id": nutri["id"], "paciente_id": p["id"], "lead_token": p.get("lead_token"),
               "data_hora": payload.data_hora, "modalidade": payload.modalidade, "plano": payload.plano,
               "status": "aguardando_pagamento", "criado_em": iso(agora), "expira_em": iso(agora + timedelta(minutes=RESERVA_MINUTOS)),
               "valor": cfg.get("valor_consulta") or (float(os.environ["CONSULTA_VALOR"]) if os.environ.get("CONSULTA_VALOR") else None), "pix_chave": cfg.get("pix_chave") or "46.786.744/0001-84",
               "pix_nome": cfg.get("pix_nome") or "Rogério Costa Treinamento",
               "provedor": os.environ.get("PAGAMENTO_PROVEDOR") or "manual"}
    await db.reservas.insert_one(dict(reserva))
    return _reserva_publica(reserva)


@api.get("/public/reservas/{rid}")
async def ver_reserva(rid: str):
    r = await db.reservas.find_one({"id": rid}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Reserva não encontrada")
    return _reserva_publica(r)


@api.post("/public/reservas/{rid}/comprovante")
async def comprovante_reserva(rid: str, file: UploadFile = File(...)):
    r = await db.reservas.find_one({"id": rid}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Reserva não encontrada")
    if _reserva_publica(r)["status"] == "expirada":
        raise HTTPException(409, "A reserva expirou. Escolha o horário de novo.")
    ct = file.content_type or ""
    if not (ct.startswith("image/") or ct == "application/pdf"):
        raise HTTPException(400, "Envie uma imagem ou PDF")
    conteudo = await file.read()
    if len(conteudo) > 10 * 1024 * 1024:
        raise HTTPException(400, "Arquivo maior que 10MB")
    await db.reservas.update_one({"id": rid}, {"$set": {"status": "comprovante_enviado", "comprovante": {
        "file_name": file.filename, "data_url": f"data:{ct};base64,{_base64.b64encode(conteudo).decode()}", "enviado_em": iso(now_utc())}}})
    return {"ok": True}


async def _confirmar_reserva(r: dict, valor: Optional[float] = None, forma: str = "pix", origem: str = "manual") -> dict:
    """Pagamento aprovado: consulta agendada (paga), paciente 'Agendada', pagamento registrado, confirmação + formulário."""
    if r.get("status") == "confirmada":
        return r
    # trava: dois avisos ao mesmo tempo (webhook repetido) não criam duas consultas
    trava = await db.reservas.update_one({"id": r["id"], "status": {"$nin": ["confirmada", "confirmando"]}}, {"$set": {"status": "confirmando"}})
    if not trava.modified_count:
        return {**r, "status": "confirmada"}
    agora = now_utc()
    cid = str(uuid.uuid4())
    await db.consultations.insert_one({"id": cid, "paciente_id": r["paciente_id"], "nutricionista_id": r["nutricionista_id"],
                                       "data_hora": r["data_hora"], "tipo": "Inicial", "modalidade": r.get("modalidade"),
                                       "status": "AGENDADA", "paga": True, "reserva_id": r["id"], "observacoes": "", "created_at": iso(agora)})
    await db.pagamentos.insert_one({"id": str(uuid.uuid4()), "paciente_id": r["paciente_id"], "nutricionista_id": r["nutricionista_id"],
                                    "valor": round(float(valor if valor is not None else (r.get("valor") or 0)), 2), "data_pagamento": agora.astimezone(TZ_BR).date().isoformat(),
                                    "forma": forma, "observacao": f"Reserva da consulta ({origem})", "plano": r.get("plano"), "created_at": iso(agora)})
    p = await db.patients.find_one({"id": r["paciente_id"]}, {"_id": 0}) or {}
    token = p.get("lead_token") or secrets.token_urlsafe(16)
    await db.patients.update_one({"id": r["paciente_id"]}, {"$set": {
        "status_funil": "CONSULTA_AGENDADA", "lead_token": token,
        "formulario": p.get("formulario") if (p.get("formulario") or {}).get("estado") == "respondido" else {"tipo": "inicial", "estado": "aberto", "enviado_em": iso(agora)}}})
    await db.reservas.update_one({"id": r["id"]}, {"$set": {"status": "confirmada", "confirmada_em": iso(agora), "consulta_id": cid, "confirmada_por": origem}})
    quando = datetime.fromisoformat(r["data_hora"]).astimezone(TZ_BR).strftime("%d/%m às %H:%M")
    base = (os.environ.get("FRONTEND_URL") or "").split(",")[0].strip().rstrip("/")
    msg = (f"✅ Pagamento confirmado! Sua consulta está marcada para {quando} ({r.get('modalidade') or 'online'}).\n"
           f"Agora preencha o formulário pré-consulta: {base}/pre-consulta/{token}")
    await db.patient_messages.insert_one({"id": str(uuid.uuid4()), "session_id": f"patient-pending-{r['paciente_id']}", "patient_id": r["paciente_id"],
                                          "role": "assistant", "kind": "confirmacao_agenda", "content": msg, "created_at": iso(agora)})
    return {**r, "status": "confirmada", "consulta_id": cid, "mensagem": msg}


class WebhookPagamentoIn(BaseModel):
    reserva_id: str
    status: str
    valor: Optional[float] = None
    forma: Optional[str] = None


@api.post("/pagamentos/webhook/{provedor}")
async def webhook_pagamento(provedor: str, payload: WebhookPagamentoIn, request: Request):
    """Aviso do meio de pagamento (Mercado Pago, Asaas…): pagamento aprovado confirma a reserva sozinho.
    Protegido por segredo compartilhado (cabeçalho X-Webhook-Secret = PAGAMENTO_WEBHOOK_SECRET).
    Quando o provedor for escolhido, o formato dele é traduzido para este (reserva_id + status)."""
    segredo = os.environ.get("PAGAMENTO_WEBHOOK_SECRET")
    if not segredo or request.headers.get("X-Webhook-Secret") != segredo:
        raise HTTPException(401, "Webhook não autorizado")
    r = await db.reservas.find_one({"id": payload.reserva_id}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Reserva não encontrada")
    if payload.status.lower() not in ("aprovado", "approved", "paid", "pago", "confirmed"):
        await db.reservas.update_one({"id": r["id"]}, {"$set": {"ultimo_aviso_pagamento": payload.status}})
        return {"ok": True, "status": r.get("status")}
    res = await _confirmar_reserva(r, payload.valor, payload.forma or "cartao_credito", origem=provedor)
    return {"ok": True, "status": res["status"]}


@api.get("/reservas")
async def listar_reservas(user=Depends(require_nutritionist)):
    rows = await db.reservas.find({"nutricionista_id": user["id"]}, {"_id": 0, "comprovante.data_url": 0}).sort("criado_em", -1).to_list(100)
    pacs = {p["id"]: p.get("nome") for p in await db.patients.find({"id": {"$in": [r["paciente_id"] for r in rows]}}, {"_id": 0, "id": 1, "nome": 1}).to_list(None)}
    return [{**_reserva_publica(r), "nome": pacs.get(r["paciente_id"]), "paciente_id": r["paciente_id"], "tem_comprovante": bool(r.get("comprovante"))} for r in rows]


@api.get("/reservas/{rid}/comprovante")
async def ver_comprovante_reserva(rid: str, user=Depends(require_nutritionist)):
    r = await db.reservas.find_one({"id": rid, "nutricionista_id": user["id"]}, {"_id": 0})
    if not r or not r.get("comprovante"):
        raise HTTPException(404, "Sem comprovante")
    return {"file_name": r["comprovante"].get("file_name"), "data_url": r["comprovante"].get("data_url")}


@api.post("/reservas/{rid}/confirmar")
async def confirmar_reserva_manual(rid: str, user=Depends(require_nutritionist)):
    r = await db.reservas.find_one({"id": rid, "nutricionista_id": user["id"]}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Reserva não encontrada")
    res = await _confirmar_reserva(r, origem="manual")
    return {"ok": True, "status": res["status"], "consulta_id": res.get("consulta_id")}


# ── Agente de vendas no WhatsApp (ajuste fn1 do Rogério) ────────────────────
# API oficial do WhatsApp Business (Meta Cloud API). Enquanto o número não estiver ligado (sem WHATSAPP_TOKEN /
# WHATSAPP_PHONE_NUMBER_ID), as respostas ficam guardadas como "aguardando o número" e a conversa pode ser
# testada pelo simulador da tela Conversas.
_WA_GRAPH = "https://graph.facebook.com/v21.0"
_ACAO_RX = re.compile(r"\[ACAO:\s*([a-z_]+)\s*(?:\|\s*plano\s*=\s*([^\]]+))?\]", re.I)


def _chave_telefone(v) -> str:
    """DDD + 8 últimos dígitos: '11 98888-7777', '5511988887777' e '551188887777' dão a mesma chave."""
    d = _so_digitos(v)
    if len(d) >= 12 and d.startswith("55"):
        d = d[2:]
    return f"{d[:2]}{d[-8:]}" if len(d) >= 10 else d[-8:]


async def _paciente_por_telefone(nid: str, telefone: str) -> Optional[dict]:
    chave = _chave_telefone(telefone)
    if len(chave) < 8:
        return None
    async for x in db.patients.find({"nutricionista_id": nid, "telefone": {"$regex": chave[-4:]}}, {"_id": 0}):
        if _chave_telefone(x.get("telefone")) == chave:
            return x
    return None


async def whatsapp_enviar(paciente: dict, texto: str, origem: str = "agente") -> dict:
    """Envia texto pelo WhatsApp (Cloud API) e guarda na conversa. Sem número ligado: fica 'aguardando_numero'."""
    token, phone_id = os.environ.get("WHATSAPP_TOKEN"), os.environ.get("WHATSAPP_PHONE_NUMBER_ID")
    para = _so_digitos(paciente.get("telefone"))
    if len(para) in (10, 11):
        para = "55" + para
    doc = {"id": str(uuid.uuid4()), "patient_id": paciente["id"], "nutricionista_id": paciente.get("nutricionista_id"),
           "direcao": "saida", "texto": texto, "origem": origem, "created_at": iso(now_utc()), "status": "aguardando_numero"}
    if token and phone_id and para:
        import httpx
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.post(f"{_WA_GRAPH}/{phone_id}/messages", headers={"Authorization": f"Bearer {token}"},
                                         json={"messaging_product": "whatsapp", "to": para, "type": "text", "text": {"body": texto[:4000]}})
            dados = resp.json() if resp.content else {}
            if resp.is_success:
                doc["status"], doc["wa_id"] = "enviada", ((dados.get("messages") or [{}])[0]).get("id")
            else:
                erro = dados.get("error") or {}
                # 131047: passou de 24 h sem o cliente escrever; só modelo aprovado pela Meta pode reabrir
                doc["status"] = "fora_da_janela" if erro.get("code") == 131047 else "erro"
                doc["erro"] = str(erro.get("message") or resp.status_code)[:200]
        except Exception as e:  # noqa: BLE001
            doc["status"], doc["erro"] = "erro", str(e)[:200]
    await db.whatsapp_mensagens.insert_one(dict(doc))
    return doc


def _link_agendamento(p: dict, plano: Optional[str] = None) -> str:
    base = (os.environ.get("FRONTEND_URL") or "").split(",")[0].strip().rstrip("/")
    q = f"?plano={plano.strip().replace(' ', '%20')}" if plano else ""
    return f"{base}/agendar/{p['lead_token']}{q}"


async def _ai_rapido(session_id: str, sistema: str, texto: str, max_tokens: int = 700) -> str:
    """WhatsApp pede resposta rápida: cada provedor tem um tempo curto; estourou, passa para o próximo."""
    msgs = [{"role": "user", "content": texto}]
    tentativas = []
    order = [x.strip().lower() for x in (os.environ.get("AI_PROVIDER_ORDER") or "gemini,groq,anthropic").split(",") if x.strip()]
    for prov in order:
        if prov == "gemini" and GEMINI_KEY:
            # modelos leves primeiro (respondem em segundos); cada um com uma tentativa curta
            leves = [m.strip() for m in (os.environ.get("WHATSAPP_GEMINI_MODELS") or "gemini-3.5-flash-lite,gemini-3.1-flash-lite").split(",") if m.strip()]
            modelos = list(dict.fromkeys(leves + _GEMINI_MODELS))
            tentativas.append(("gemini", lambda: _gemini_chat(msgs, sistema, GEMINI_KEY, max_tokens=max_tokens, temperature=0.5, timeout=10 + max_tokens // 400,
                                                              thinking_budget=512, models=modelos, retry_delays=[]), 35 + max_tokens // 200))
        elif prov == "groq" and GROQ_API_KEY:
            tentativas.append(("groq", lambda: _groq_chat(msgs, sistema, max_tokens, 0.5, 20), 22))
        elif prov == "anthropic" and ANTHROPIC_API_KEY:
            tentativas.append(("anthropic", lambda: _anthropic_chat(msgs, sistema, session_id, max_tokens, 0.5), 45))
    falhas = []
    for nome, chamar, limite in tentativas:
        try:
            texto_ia = await asyncio.wait_for(chamar(), limite)
            if texto_ia and texto_ia.strip():
                return texto_ia
        except Exception as e:  # noqa: BLE001
            falhas.append(f"{nome}: {type(e).__name__}")
    raise RuntimeError("; ".join(falhas) or "nenhum provedor de IA configurado")


async def _agente_vendas_responder(p: dict) -> Optional[str]:
    """Lê a conversa e responde como o agente de vendas. Executa a ação pedida (proposta aceita, passar para o Rogério)."""
    if (p.get("conversa_humana") or {}).get("aberta"):
        return None  # o Rogério assumiu a conversa
    await ensure_agents_seeded()
    hist = await db.whatsapp_mensagens.find({"patient_id": p["id"]}, {"_id": 0}).sort("created_at", -1).to_list(20)
    hist.reverse()
    contexto = (f"DADOS DO CONTATO: nome={p.get('nome') or 'não informado'}; etapa={p.get('status_funil')}; "
                f"origem={p.get('origem') or 'whatsapp'}; plano de interesse={p.get('plano_interesse') or 'não definido'}.")
    sistema = await build_agent_system_prompt("vendas", extra_context=contexto)
    conversa = "\n".join(f"{'Cliente' if m['direcao'] == 'entrada' else 'Você'}: {m['texto']}" for m in hist)
    try:
        bruto = await _ai_rapido(f"vendas-{p['id']}", sistema, conversa + "\nVocê:")
    except Exception:
        logging.exception("agente de vendas falhou")
        bruto = "Recebi sua mensagem! Já já o Rogério te responde por aqui. [ACAO: humano]"
    acao = _ACAO_RX.search(bruto or "")
    texto = _ACAO_RX.sub("", bruto or "").strip()
    agora = iso(now_utc())
    if acao and acao.group(1).lower() == "proposta_aceita":
        plano = (acao.group(2) or p.get("plano_interesse") or "").strip() or None
        token = p.get("lead_token") or secrets.token_urlsafe(16)
        await db.patients.update_one({"id": p["id"]}, {"$set": {
            "lead_token": token, "proposta_aceita_em": agora, "plano_interesse": plano,
            **({"status_funil": "PROPOSTA_ACEITA"} if p.get("status_funil") in (None, "LEAD_INICIADO", "PERDIDO") else {})}})
        link = _link_agendamento({**p, "lead_token": token}, plano)
        texto = f"{texto}\n\nEscolha o melhor horário e garanta sua vaga aqui: {link}".strip()
    elif acao and acao.group(1).lower() == "humano":
        pergunta = next((m["texto"] for m in reversed(hist) if m["direcao"] == "entrada"), "")
        await db.patients.update_one({"id": p["id"]}, {"$set": {"conversa_humana": {"aberta": True, "desde": agora, "pergunta": pergunta[:300]}}})
    elif acao and acao.group(1).lower() == "plano" and acao.group(2):
        await db.patients.update_one({"id": p["id"]}, {"$set": {"plano_interesse": acao.group(2).strip()}})
    if texto:
        await whatsapp_enviar(p, texto, "agente")
    return texto


async def whatsapp_receber(nid: str, telefone: str, texto: str, nome: Optional[str] = None, wa_id: Optional[str] = None) -> dict:
    """Mensagem que chegou (webhook da Meta ou simulador): acha ou cria o lead, guarda e deixa o agente responder."""
    p = await _paciente_por_telefone(nid, telefone)
    agora = now_utc()
    if not p:
        p = {"id": str(uuid.uuid4()), "nutricionista_id": nid, "lead_token": secrets.token_urlsafe(16), "nome": (nome or "Contato do WhatsApp").strip(),
             "telefone": telefone, "status_funil": "LEAD_INICIADO", "origem": "whatsapp", "created_at": iso(agora), "updated_at": iso(agora)}
        await db.patients.insert_one(dict(p))
    elif not p.get("lead_token"):
        p["lead_token"] = secrets.token_urlsafe(16)
        await db.patients.update_one({"id": p["id"]}, {"$set": {"lead_token": p["lead_token"]}})
    if wa_id and await db.whatsapp_mensagens.find_one({"wa_id": wa_id}):
        return {"patient_id": p["id"], "duplicada": True}  # a Meta reenvia avisos; não responder duas vezes
    await db.whatsapp_mensagens.insert_one({"id": str(uuid.uuid4()), "patient_id": p["id"], "nutricionista_id": nid, "direcao": "entrada",
                                            "texto": texto, "wa_id": wa_id, "created_at": iso(agora)})
    upd = {"ultima_mensagem_cliente": iso(agora)}
    if p.get("status_funil") == "PERDIDO":
        upd["status_funil"] = "LEAD_INICIADO"  # voltou a conversar: sai de perdido (ajuste fn3)
    await db.patients.update_one({"id": p["id"]}, {"$set": upd, "$unset": {"followup": ""}})
    p = await db.patients.find_one({"id": p["id"]}, {"_id": 0})
    resposta = await _agente_vendas_responder(p)
    return {"patient_id": p["id"], "resposta": resposta}


_WA_TAREFAS: set = set()


async def _whatsapp_receber_seguro(*args):
    try:
        await whatsapp_receber(*args)
    except Exception:
        logging.exception("whatsapp webhook: falha ao tratar mensagem")


@api.get("/whatsapp/webhook")
async def whatsapp_verificar(request: Request):
    """Verificação do webhook na Meta (hub.challenge)."""
    q = request.query_params
    if q.get("hub.mode") == "subscribe" and q.get("hub.verify_token") and q.get("hub.verify_token") == os.environ.get("WHATSAPP_VERIFY_TOKEN"):
        return Response(content=q.get("hub.challenge") or "", media_type="text/plain")
    raise HTTPException(403, "Token de verificação inválido")


@api.post("/whatsapp/webhook")
async def whatsapp_webhook(request: Request):
    corpo = await request.body()
    segredo = os.environ.get("WHATSAPP_APP_SECRET")
    if segredo:
        import hmac
        esperado = "sha256=" + hmac.new(segredo.encode(), corpo, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(esperado, request.headers.get("X-Hub-Signature-256", "")):
            raise HTTPException(401, "Assinatura inválida")
    try:
        dados = json.loads(corpo or b"{}")
    except ValueError:
        raise HTTPException(400, "JSON inválido")
    nutri = await _nutri_padrao()
    if not nutri:
        return {"ok": True}
    for entrada in dados.get("entry") or []:
        for mudanca in entrada.get("changes") or []:
            valor = mudanca.get("value") or {}
            nomes = {c.get("wa_id"): (c.get("profile") or {}).get("name") for c in valor.get("contacts") or []}
            for m in valor.get("messages") or []:
                tipo = m.get("type")
                texto = ((m.get("text") or {}).get("body") if tipo == "text"
                         else ((m.get("button") or {}).get("text") if tipo == "button"
                               else f"[{tipo} recebido]"))
                # a Meta espera resposta em poucos segundos: o agente responde em segundo plano
                tarefa = asyncio.create_task(_whatsapp_receber_seguro(nutri["id"], m.get("from") or "", texto or "", nomes.get(m.get("from")), m.get("id")))
                _WA_TAREFAS.add(tarefa)
                tarefa.add_done_callback(_WA_TAREFAS.discard)
            for st in valor.get("statuses") or []:
                await db.whatsapp_mensagens.update_one({"wa_id": st.get("id")}, {"$set": {"status": st.get("status")}})
    return {"ok": True}


@api.get("/conversas")
async def listar_conversas(user=Depends(require_nutritionist)):
    ultimas = {}
    async for m in db.whatsapp_mensagens.aggregate([{"$match": {"nutricionista_id": user["id"]}}, {"$sort": {"created_at": -1}},
                                                    {"$group": {"_id": "$patient_id", "m": {"$first": "$$ROOT"}, "n": {"$sum": 1}}}]):
        ultimas[m["_id"]] = m
    pacs = await db.patients.find({"id": {"$in": list(ultimas)}}, {"_id": 0, "id": 1, "nome": 1, "telefone": 1, "status_funil": 1, "conversa_humana": 1, "plano_interesse": 1, "origem": 1}).to_list(None)
    out = []
    for p in pacs:
        u = ultimas[p["id"]]["m"]
        out.append({**p, "ultima": {"texto": u.get("texto"), "direcao": u.get("direcao"), "created_at": u.get("created_at")},
                    "total": ultimas[p["id"]]["n"], "para_voce": bool((p.get("conversa_humana") or {}).get("aberta"))})
    out.sort(key=lambda x: x["ultima"]["created_at"] or "", reverse=True)
    out.sort(key=lambda x: not x["para_voce"])
    return {"conversas": out, "numero_ligado": bool(os.environ.get("WHATSAPP_TOKEN") and os.environ.get("WHATSAPP_PHONE_NUMBER_ID"))}


@api.get("/conversas/{pid}")
async def ver_conversa(pid: str, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]}, {"_id": 0, "id": 1, "nome": 1, "telefone": 1, "status_funil": 1, "conversa_humana": 1, "plano_interesse": 1})
    if not p:
        raise HTTPException(404, "Contato não encontrado")
    msgs = await db.whatsapp_mensagens.find({"patient_id": pid}, {"_id": 0}).sort("created_at", 1).to_list(300)
    return {"contato": p, "mensagens": msgs}


class ResponderConversaIn(BaseModel):
    texto: str = Field(min_length=1, max_length=4000)


@api.post("/conversas/{pid}/responder")
async def responder_conversa(pid: str, payload: ResponderConversaIn, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Contato não encontrado")
    doc = await whatsapp_enviar(p, payload.texto.strip(), "rogerio")
    await db.patients.update_one({"id": pid}, {"$set": {"pendencias_resolvidas.conversa": iso(now_utc())}})
    return {k: v for k, v in doc.items() if k != "_id"}


class AgenteConversaIn(BaseModel):
    ativo: bool


@api.post("/conversas/{pid}/agente")
async def agente_na_conversa(pid: str, payload: AgenteConversaIn, user=Depends(require_nutritionist)):
    """ativo=True devolve a conversa ao agente; False: o Rogério assume (o agente para de responder)."""
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Contato não encontrado")
    if payload.ativo:
        await db.patients.update_one({"id": pid}, {"$set": {"conversa_humana.aberta": False, "pendencias_resolvidas.conversa": iso(now_utc())}})
    else:
        await db.patients.update_one({"id": pid}, {"$set": {"conversa_humana": {"aberta": True, "desde": iso(now_utc()), "pergunta": "assumida pelo Rogério"}}})
    return {"ok": True}


class SimularWhatsappIn(BaseModel):
    telefone: str = Field(min_length=8, max_length=30)
    texto: str = Field(min_length=1, max_length=2000)
    nome: Optional[str] = Field(default=None, max_length=120)


@api.post("/conversas/simular")
async def simular_whatsapp(payload: SimularWhatsappIn, user=Depends(require_nutritionist)):
    """Testa o agente como se o cliente tivesse escrito no WhatsApp (útil antes de ligar o número)."""
    return await whatsapp_receber(user["id"], payload.telefone, payload.texto, payload.nome)


# ── Follow-up e lembretes automáticos (ajuste fn3 do Rogério) ───────────────
# Roda junto do agendador de lembretes, a cada 10 minutos. Tudo sai pelo WhatsApp (whatsapp_enviar) e fica na
# conversa. Fora da janela de 24 h da Meta o envio fica marcado "fora_da_janela" até existir modelo aprovado.
_FOLLOWUP_INTERVALO = timedelta(minutes=10)
_followup_ultimo = {"em": None}


def _primeiro_nome(p: dict) -> str:
    return (p.get("nome") or "").split(" ")[0] or "tudo bem"


def _dt(v) -> Optional[datetime]:
    try:
        d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=TZ_BR)
    except (TypeError, ValueError):
        return None


async def _followup_leads(agora: datetime) -> int:
    """Quem não fechou: 24 h sem resposta → 1ª mensagem; 3 dias → 2ª; mais 2 dias sem resposta → Perdido."""
    feitos = 0
    async for p in db.patients.find({"status_funil": {"$in": ["LEAD_INICIADO", "PROPOSTA_ACEITA"]}}, {"_id": 0}):
        if (p.get("conversa_humana") or {}).get("aberta"):
            continue  # o Rogério está conversando
        ultima = await db.whatsapp_mensagens.find_one({"patient_id": p["id"]}, {"_id": 0}, sort=[("created_at", -1)])
        if not ultima:
            continue  # lead sem conversa no WhatsApp: não há o que seguir
        ult_cliente = await db.whatsapp_mensagens.find_one({"patient_id": p["id"], "direcao": "entrada"}, {"_id": 0, "created_at": 1}, sort=[("created_at", -1)])
        base = _dt((ult_cliente or {}).get("created_at")) or _dt(p.get("created_at"))
        if not base:
            continue
        fu = p.get("followup") or {}
        horas = (agora - base).total_seconds() / 3600
        nome = _primeiro_nome(p)
        link = _link_agendamento(p, p.get("plano_interesse")) if p.get("lead_token") else None
        if not fu.get("1") and horas >= 24:
            txt = (f"Oi, {nome}! Passando para saber se ficou alguma dúvida sobre os planos. "
                   + (f"Se quiser, já pode escolher seu horário por aqui: {link}" if p.get("status_funil") == "PROPOSTA_ACEITA" and link
                      else "Posso te ajudar a escolher o melhor para o seu objetivo?"))
            await whatsapp_enviar(p, txt, "followup")
            await db.patients.update_one({"id": p["id"]}, {"$set": {"followup.1": iso(agora)}})
            feitos += 1
        elif fu.get("1") and not fu.get("2") and horas >= 72:
            txt = (f"{nome}, ainda dá tempo de começar! Tenho horários livres nesta semana"
                   + (f": {link}" if link else ". Quer que eu te mande as opções?"))
            await whatsapp_enviar(p, txt, "followup")
            await db.patients.update_one({"id": p["id"]}, {"$set": {"followup.2": iso(agora)}})
            feitos += 1
        elif fu.get("2") and (agora - (_dt(fu["2"]) or agora)) >= timedelta(days=2):
            await db.patients.update_one({"id": p["id"]}, {"$set": {"status_funil": "PERDIDO", "perdido_em": iso(agora), "perdido_motivo": "sem resposta ao follow-up"}})
            feitos += 1
    return feitos


async def _lembretes_consulta(agora: datetime) -> int:
    """Formulário 2 dias antes (se não respondido); consulta 24 h e 2 h antes (com link se online)."""
    feitos = 0
    fim = agora + timedelta(days=2, hours=1)
    async for c in db.consultations.find({"status": "AGENDADA", "paga": {"$ne": False}}, {"_id": 0}):
        quando = _dt(c.get("data_hora"))
        if not quando or not (agora < quando <= fim):
            continue
        p = await db.patients.find_one({"id": c.get("paciente_id")}, {"_id": 0})
        if not p:
            continue
        falta = quando - agora
        nome = _primeiro_nome(p)
        hora = quando.astimezone(TZ_BR).strftime("%d/%m às %H:%M")
        link_chamada = c.get("link_chamada") or os.environ.get("CONSULTA_LINK_ONLINE")
        online = c.get("modalidade") == "online" or bool(c.get("link_chamada"))
        sets = {}
        f = p.get("formulario") or {}
        if falta <= timedelta(days=2) and f.get("estado") != "respondido" and not c.get("lembrete_formulario_em"):
            token = p.get("lead_token") or secrets.token_urlsafe(16)
            if not p.get("lead_token"):
                await db.patients.update_one({"id": p["id"]}, {"$set": {"lead_token": token}})
            base = (os.environ.get("FRONTEND_URL") or "").split(",")[0].strip().rstrip("/")
            await whatsapp_enviar(p, f"Oi, {nome}! Sua consulta é {hora}. Para aproveitarmos melhor o tempo, preencha o formulário pré-consulta: {base}/pre-consulta/{token}", "lembrete")
            sets["lembrete_formulario_em"] = iso(agora)
        if falta <= timedelta(hours=24) and falta > timedelta(hours=2) and not c.get("lembrete_24h_em"):
            extra = f" O link da chamada: {link_chamada}" if online and link_chamada else (" Te espero no local combinado." if c.get("modalidade") == "presencial" else "")
            dia = "hoje" if quando.astimezone(TZ_BR).date() == agora.astimezone(TZ_BR).date() else "amanhã"
            await whatsapp_enviar(p, f"{nome}, lembrete: {dia} tem consulta, {hora}.{extra}", "lembrete")
            sets["lembrete_24h_em"] = iso(agora)
        if falta <= timedelta(hours=2) and not c.get("lembrete_2h_em"):
            extra = f" Entre por aqui: {link_chamada}" if online and link_chamada else ""
            await whatsapp_enviar(p, f"{nome}, sua consulta começa em breve ({quando.astimezone(TZ_BR).strftime('%H:%M')}).{extra}", "lembrete")
            sets["lembrete_2h_em"] = iso(agora)
        if sets:
            await db.consultations.update_one({"id": c["id"]}, {"$set": sets})
            feitos += len(sets)
    return feitos


async def _avisos_renovacao(agora: datetime) -> int:
    """Plano perto de vencer (7 dias): um aviso por vencimento."""
    from financeiro import situacao_plano
    feitos = 0
    hoje = agora.astimezone(TZ_BR).date()
    async for p in db.patients.find({"assinatura.vencimento": {"$exists": True}, "status_funil": {"$nin": ["PERDIDO", "INATIVO"]}}, {"_id": 0}):
        a = p.get("assinatura") or {}
        sit = situacao_plano(a, 7, hoje)
        venc = str(a.get("vencimento"))[:10]
        if sit["status"] != "vencendo" or (p.get("aviso_renovacao") or {}).get(venc):
            continue
        dias = sit["dias"]
        await whatsapp_enviar(p, f"Oi, {_primeiro_nome(p)}! Seu plano vence em {dias} {'dia' if dias == 1 else 'dias'} ({venc[8:10]}/{venc[5:7]}). "
                                 "Vamos renovar para manter o ritmo? Te mando as condições.", "lembrete")
        await db.patients.update_one({"id": p["id"]}, {"$set": {f"aviso_renovacao.{venc}": iso(agora)}})
        feitos += 1
    return feitos


async def _avisos_troca_fase(agora: datetime) -> int:
    """Ciclo de carbo: avisa o paciente na véspera de trocar de fase (uma vez por troca)."""
    feitos = 0
    hoje = agora.astimezone(TZ_BR).date()
    async for p in db.patients.find({"ciclo_carbo": {"$ne": None}, "status_funil": {"$nin": ["PERDIDO", "INATIVO"]}}, {"_id": 0}):
        sit = ciclos_mod.situacao(p.get("ciclo_carbo"), hoje)
        troca = (sit or {}).get("proxima_troca")
        if not troca or (troca - hoje).days != 1 or (p.get("ciclo_avisos") or {}).get(troca.isoformat()):
            continue
        await whatsapp_enviar(p, f"Oi, {_primeiro_nome(p)}! Amanhã começa a próxima etapa do seu plano: {sit.get('proximo_rotulo')}. "
                                 "A dieta muda junto; o plano novo já fica no app.", "lembrete")
        await db.patients.update_one({"id": p["id"]}, {"$set": {f"ciclo_avisos.{troca.isoformat()}": iso(agora)}})
        feitos += 1
    return feitos


async def rodar_followups(agora: Optional[datetime] = None) -> dict:
    agora = agora or now_utc()
    return {"leads": await _followup_leads(agora), "consultas": await _lembretes_consulta(agora), "renovacao": await _avisos_renovacao(agora),
            "troca_fase": await _avisos_troca_fase(agora)}


async def followups_se_for_hora():
    agora = now_utc()
    if _followup_ultimo["em"] and agora - _followup_ultimo["em"] < _FOLLOWUP_INTERVALO:
        return
    _followup_ultimo["em"] = agora
    try:
        r = await rodar_followups(agora)
        if any(r.values()):
            logging.info("follow-ups: %s", r)
    except Exception:
        logging.exception("follow-ups falharam")


@api.post("/followups/rodar")
async def rodar_followups_agora(user=Depends(require_nutritionist)):
    """Roda os follow-ups e lembretes agora (normalmente a cada 10 min)."""
    return await rodar_followups()


# ── Cadastro de alimentos com IA (ajuste ali1 do Rogério) ───────────────────
# Ordem: TACO → TBCA (valores reais das tabelas que já estão no banco, inclusive as arquivadas) → USDA (pela IA,
# marcado "revisar") → estimado (revisar). Marca bloqueada por padrão: a IA devolve o nome genérico.
# Nada é salvo sem aprovação: aprovar um da TACO/TBCA reativa o alimento da tabela; os outros viram alimento próprio.
_MARCAS = ["growth", "integralmedica", "integral medica", "max titanium", "probiotica", "probiótica", "dux", "black skull", "optimum",
           "nestle", "nestlé", "ninho", "italac", "piracanjuba", "danone", "activia", "yopro", "vigor", "batavo", "elegê", "itambé",
           "sadia", "perdigão", "seara", "aurora", "quaker", "kellogg", "nescau", "toddy", "mupy", "ades", "del valle", "coca",
           "nissin", "bauducco", "visconti", "piraquê", "marilan", "tirolez", "polenghi", "qualy", "becel", "doriana", "hellmann",
           "liza", "soya", "camil", "tio joão", "kicaldo", "fugini", "predilecta", "essential nutrition", "atlhetica", "atlhética",
           "new millen", "darkness", "puravida", "mais mu", "verde campo", "jasmine", "vitao", "mãe terra", "piracanjuba"]
_FONTES_TABELA = ["TACO", "TBCA"]


def _sem_acento(t: str) -> str:
    return unicodedata.normalize("NFD", str(t or "")).encode("ascii", "ignore").decode().lower()


def _marca_em(nome: str) -> Optional[str]:
    n = f" {_sem_acento(nome)} "
    for m in _MARCAS:
        if f" {_sem_acento(m)} " in n or n.strip().startswith(_sem_acento(m) + " "):
            return m
    return None


def categoria_app(doc: dict) -> str:
    """Categoria organizada para a lista (frutas e hortaliças separadas de cereais/tubérculos)."""
    g = _sem_acento(doc.get("grupo") or doc.get("categoria") or "")
    nome = _sem_acento(doc.get("nome") or "")
    if re.search(r"suplement|whey|creatina|albumina|maltodextrina", g + " " + nome):
        return "Suplementos"
    if re.search(r"fruta|fruto", g) and not re.search(r"cereais", g):
        return "Frutas"
    if re.search(r"cereais, raizes|cereais, ra", g):
        # o grupo da planilha mistura cereais, tubérculos, hortaliças e frutas: separa pelo nome
        if re.search(r"^(banana|maca|mamao|manga|abacaxi|laranja|uva|pera|melancia|melao|morango|kiwi|goiaba|caqui|ameixa|abacate|acai|acerola|caju|coco|figo|jabuticaba|limao|maracuja|pessego|pitanga|tangerina|mexerica|amora|framboesa|mirtilo|cereja|carambola|graviola|lichia|nectarina|roma|tamara)", nome):
            return "Frutas"
        if re.search(r"^(arroz|aveia|batata|mandioca|aipim|macaxeira|inhame|cara|milho|trigo|farinha|farelo|pao|paes|macarr|massa|tapioca|cuscuz|quinoa|cevada|centeio|biscoito|bolacha|bolo|granola|polenta|fuba|amido|torrada|cereal|pipoca|nhoque|lasanha|panqueca|tortilha|wrap|beiju|polvilho|sagu|mingau)", nome):
            return "Cereais, pães e tubérculos"
        return "Hortaliças e vegetais"
    if re.search(r"vegeta|hortali|livre", g):
        return "Hortaliças e vegetais"
    if re.search(r"cereai|paes|pao|massa|tuberc|raiz", g):
        return "Cereais, pães e tubérculos"
    if re.search(r"feij|legumin", g):
        return "Leguminosas"
    if re.search(r"carne|peixe|ovo|prote|frango", g):
        return "Carnes, ovos e peixes"
    if re.search(r"leite|latic|queijo|iogur", g):
        return "Leite e derivados"
    if re.search(r"oleaginos|nozes|semente|oleosa", g):
        return "Oleaginosas e sementes"
    if re.search(r"oleo|gordura", g):
        return "Óleos e gorduras"
    if re.search(r"suco|bebida", g):
        return "Bebidas e sucos"
    if re.search(r"fibra", g):
        return "Fibras"
    if re.search(r"acucar|doce", g):
        return "Açúcares e doces"
    return "Outros"


def _nutri_100g(doc: dict) -> dict:
    m = _macros_100g(doc)
    n = doc.get("nutrientes") or {}
    p = doc.get("por_100g") or {}
    sodio = _coerce_float(n.get("sodio_mg") if "nutrientes" in doc else p.get("sodio_mg"))
    return {"energia_kcal": m["kcal"], "proteinas_g": m["ptn"], "carboidratos_g": m["cho"], "lipidios_g": m["lip"], "fibras_g": m["fib"], "sodio_mg": sodio}


def _conferir_kcal(n: dict) -> dict:
    calc = (n.get("proteinas_g") or 0) * 4 + (n.get("carboidratos_g") or 0) * 4 + (n.get("lipidios_g") or 0) * 9
    kcal = n.get("energia_kcal")
    if kcal is None:
        return {"calculada": round(calc, 1), "ok": None}
    dif = abs(calc - kcal) / kcal if kcal else (0 if calc == 0 else 1)
    return {"calculada": round(calc, 1), "diferenca_pct": round(dif * 100, 1), "ok": dif <= 0.15}


def _rx_sem_acento(palavra: str) -> str:
    """Regex que casa a palavra com ou sem acento (brocolis → br[oóôõ]c[oóôõ]l[iíî]s)."""
    mapa = {"a": "[aáàâã]", "e": "[eéê]", "i": "[iíî]", "o": "[oóôõ]", "u": "[uúü]", "c": "[cç]"}
    return "".join(mapa.get(ch, re.escape(ch)) for ch in palavra)


async def _candidatos_tabela(nome: str, limite: int = 6) -> list:
    """Alimentos da TACO/TBCA (ativos ou arquivados) parecidos com o nome."""
    palavras = [w for w in re.findall(r"[a-z0-9]+", _sem_acento(nome)) if len(w) >= 3][:3]
    if not palavras:
        return []
    filtro = {"fonte": {"$in": _FONTES_TABELA}, "$and": [{"nome": {"$regex": _rx_sem_acento(w[:6]), "$options": "i"}} for w in palavras]}
    docs = await db.alimentos.find(filtro, {"_id": 0}).limit(40).to_list(40)
    if not docs and palavras:
        docs = await db.alimentos.find({"fonte": {"$in": _FONTES_TABELA}, "nome": {"$regex": _rx_sem_acento(palavras[0][:6]), "$options": "i"}}, {"_id": 0}).limit(40).to_list(40)
    docs.sort(key=lambda d: (_FONTES_TABELA.index(d.get("fonte")) if d.get("fonte") in _FONTES_TABELA else 9, len(d.get("nome") or "")))
    return docs[:limite]


async def _duplicado_na_base(nome: str, nid: str) -> Optional[dict]:
    alvo = _sem_acento(nome).strip()
    if len(alvo) < 3:
        return None
    rx = _rx_sem_acento(alvo.split()[0][:6])
    async for d in db.alimentos.find({"arquivado": {"$ne": True}, "nome": {"$regex": rx, "$options": "i"},
                                      "$or": [{"nutricionista_id": None}, {"nutricionista_id": {"$exists": False}}, {"nutricionista_id": nid}]},
                                     {"_id": 0, "id": 1, "nome": 1, "fonte": 1}).limit(60):
        if SequenceMatcher(None, re.sub(r"[^a-z0-9 ]", "", _sem_acento(d["nome"])), re.sub(r"[^a-z0-9 ]", "", alvo)).ratio() >= 0.9:
            return d
    return None


class AlimentosIaIn(BaseModel):
    nomes: List[str] = Field(min_length=1, max_length=40)
    bloquear_marcas: bool = True


@api.post("/alimentos/ia/rascunho")
async def alimentos_ia_rascunho(payload: AlimentosIaIn, user=Depends(require_nutritionist)):
    nomes = [x.strip() for x in payload.nomes if x and x.strip()][:40]
    entradas = []
    for nome in nomes:
        entradas.append({"pedido": nome, "marca": _marca_em(nome) if payload.bloquear_marcas else None,
                         "candidatos": [{"id": c["id"], "nome": c["nome"], "fonte": c.get("fonte")} for c in await _candidatos_tabela(nome)]})
    sistema = ("Você ajuda um nutricionista a cadastrar alimentos. Para cada pedido: (1) se o nome tiver marca comercial e bloquear_marcas for "
               "verdadeiro, use o nome GENÉRICO (ex.: 'whey growth' → 'Whey protein concentrado'); (2) escolha entre os candidatos o que "
               "corresponde ao alimento (prefira TACO, depois TBCA; mesmo estado: cru/cozido); se nenhum corresponder, escolha_id = null; "
               "(3) só quando escolha_id for null, informe os nutrientes por 100 g da USDA FoodData Central (fonte 'USDA') ou, se não houver, "
               "uma estimativa (fonte 'estimado'). Também: categoria (Frutas, Hortaliças e vegetais, Cereais, pães e tubérculos, Leguminosas, "
               "Carnes, ovos e peixes, Leite e derivados, Óleos e gorduras, Oleaginosas e sementes, Bebidas e sucos, Açúcares e doces, Suplementos, "
               "Outros), porcao_g, medida_caseira (ex.: '1 unidade média (120 g)'), liquido (true/false) e densidade (g/ml, só se líquido). "
               "Responda APENAS JSON: {\"itens\": [{\"pedido\", \"nome_generico\", \"escolha_id\", \"fonte\", \"categoria\", \"porcao_g\", "
               "\"medida_caseira\", \"liquido\", \"densidade\", \"nutrientes\": {\"energia_kcal\", \"proteinas_g\", \"carboidratos_g\", "
               "\"lipidios_g\", \"fibras_g\", \"sodio_mg\"} ou null}]}")
    entrada_txt = json.dumps({"bloquear_marcas": payload.bloquear_marcas, "pedidos": entradas}, ensure_ascii=False)
    try:
        bruto = await _ai_rapido(f"alimentos-{user['id']}", sistema, entrada_txt, max_tokens=900 * len(nomes) + 600)
        resp = donato_gemini.parse_json(bruto)
    except Exception as e:
        logging.exception("cadastro de alimentos com IA falhou")
        raise HTTPException(503, f"IA indisponível agora: {str(e)[:120]}")
    por_pedido = {str(x.get("pedido") or "").strip().lower(): x for x in resp.get("itens") or []}
    saida = []
    for e in entradas:
        ia = por_pedido.get(e["pedido"].lower()) or {}
        escolha = next((c for c in e["candidatos"] if c["id"] == ia.get("escolha_id")), None)
        nome_final = (ia.get("nome_generico") or e["pedido"]).strip()
        if escolha:
            doc = await db.alimentos.find_one({"id": escolha["id"]}, {"_id": 0})
            nutr = _nutri_100g(doc)
            item = {"pedido": e["pedido"], "nome": doc.get("nome"), "fonte": doc.get("fonte"), "alimento_tabela_id": doc["id"],
                    "ja_na_base": not doc.get("arquivado"), "revisar": False}
        else:
            nutr = {k: _coerce_float((ia.get("nutrientes") or {}).get(k)) for k in ("energia_kcal", "proteinas_g", "carboidratos_g", "lipidios_g", "fibras_g", "sodio_mg")}
            fonte = "USDA" if str(ia.get("fonte") or "").upper() == "USDA" else "estimado"
            item = {"pedido": e["pedido"], "nome": nome_final, "fonte": fonte, "alimento_tabela_id": None, "ja_na_base": False, "revisar": True}
        item.update({"nutrientes_100g": nutr, "conferencia_kcal": _conferir_kcal(nutr), "categoria": ia.get("categoria") or "Outros",
                     "porcao_g": _coerce_float(ia.get("porcao_g")) or 100, "medida_caseira": ia.get("medida_caseira") or "100 g",
                     "liquido": bool(ia.get("liquido")), "densidade": _coerce_float(ia.get("densidade")),
                     "marca_bloqueada": e["marca"], "nome_pedido_trocado": bool(e["marca"]) and _sem_acento(nome_final) != _sem_acento(e["pedido"])})
        if item.get("ja_na_base"):  # o próprio alimento da tabela já está na base
            item["duplicado"] = {"id": item["alimento_tabela_id"], "nome": item["nome"], "fonte": item["fonte"]}
        else:
            dup = await _duplicado_na_base(item["nome"], user["id"])
            item["duplicado"] = dup if dup and dup.get("id") != item.get("alimento_tabela_id") else None
        saida.append(item)
    return {"itens": saida}


class AlimentoIaAprovarItem(BaseModel):
    nome: str = Field(min_length=2, max_length=160)
    fonte: str
    alimento_tabela_id: Optional[str] = None
    categoria: str = "Outros"
    porcao_g: float = 100
    medida_caseira: str = "100 g"
    liquido: bool = False
    densidade: Optional[float] = None
    nutrientes_100g: dict = {}
    revisado: bool = False


class AlimentosIaAprovarIn(BaseModel):
    itens: List[AlimentoIaAprovarItem] = Field(min_length=1, max_length=40)


@api.post("/alimentos/ia/aprovar")
async def alimentos_ia_aprovar(payload: AlimentosIaAprovarIn, user=Depends(require_nutritionist)):
    feitos, pulados = [], []
    for it in payload.itens:
        if it.fonte not in _FONTES_TABELA and not it.revisado:
            pulados.append(f"{it.nome}: marque como revisado antes de aprovar")
            continue
        if _marca_em(it.nome):
            pulados.append(f"{it.nome}: nome com marca (use o genérico)")
            continue
        if it.alimento_tabela_id:
            # alimento da TACO/TBCA: volta para a base (sai do arquivo), com as medidas da tabela
            res = await db.alimentos.update_one({"id": it.alimento_tabela_id, "fonte": {"$in": _FONTES_TABELA}},
                                                {"$set": {"arquivado": False, "incluido_por_ia_em": iso(now_utc()),
                                                          **({"liquido": True, "densidade": it.densidade} if it.liquido else {})}})
            if res.matched_count:
                feitos.append({"id": it.alimento_tabela_id, "nome": it.nome, "fonte": it.fonte})
            continue
        n = it.nutrientes_100g or {}
        doc = {"id": str(uuid.uuid4()), "nome": it.nome.strip(), "categoria": it.categoria, "fonte": "CUSTOM", "origem_dado": it.fonte,
               "nutricionista_id": user["id"], "porcao_padrao_g": it.porcao_g, "medida_caseira": it.medida_caseira,
               "por_100g": {k: _coerce_float(n.get(k)) or 0 for k in ("energia_kcal", "proteinas_g", "carboidratos_g", "lipidios_g", "fibras_g", "sodio_mg")},
               "liquido": it.liquido, "densidade": it.densidade if it.liquido else None, "revisado_em": iso(now_utc()), "criado_em": iso(now_utc())}
        await db.alimentos.insert_one(dict(doc))
        feitos.append({"id": doc["id"], "nome": doc["nome"], "fonte": it.fonte})
    return {"incluidos": feitos, "pulados": pulados}


# ── Painel "o que fazer hoje" (ajuste pain1 do Rogério) ─────────────────────
_PASSO_DA_ETAPA = {
    "ANAMNESE_COMPLETA": "agendar a consulta", "CONSULTA_AGENDADA": "conferir o formulário antes da consulta",
    "CONSULTA_REALIZADA": "montar e entregar o plano", "PLANO_ENTREGUE": "acompanhar a adaptação",
    "EM_ACOMPANHAMENTO": "agendar o retorno antes do plano vencer", "LEAD_INICIADO": "enviar o formulário",
}
_JORNADA = [("lead", "Lead", ["LEAD_INICIADO", "PROPOSTA_ACEITA"]), ("formulario", "Formulário", ["ANAMNESE_COMPLETA"]),
            ("agendada", "Agendada", ["CONSULTA_AGENDADA"]), ("consulta", "Consulta feita", ["CONSULTA_REALIZADA"]),
            ("plano", "Plano entregue", ["PLANO_ENTREGUE"]), ("acompanhamento", "Acompanhamento", ["EM_ACOMPANHAMENTO"])]


class ResolverPendenciaIn(BaseModel):
    tipo: str = Field(min_length=2, max_length=40)


@api.post("/patients/{pid}/pendencias/resolver")
async def resolver_pendencia(pid: str, payload: ResolverPendenciaIn, user=Depends(require_nutritionist)):
    """Tira a pendência do Painel (ex.: formulário revisado). Ela volta se acontecer algo novo do mesmo tipo."""
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    await db.patients.update_one({"id": pid}, {"$set": {f"pendencias_resolvidas.{payload.tipo}": iso(now_utc())}})
    return {"ok": True}


@api.get("/painel")
async def painel(user=Depends(require_nutritionist)):
    from financeiro import situacao_plano
    nid = user["id"]
    agora = now_utc()
    agora_br = agora.astimezone(TZ_BR)
    hoje = agora_br.date()
    pacs = await db.patients.find({"nutricionista_id": nid}, {"_id": 0, "fotos": 0, "comprovante": 0, "lead_token": 0}).to_list(None)
    por_id = {p["id"]: p for p in pacs}
    # só consultas pagas (ajuste fn2): reserva sem pagamento não vira consulta; paga=False fica de fora
    consultas = await db.consultations.find({"nutricionista_id": nid, "status": {"$nin": ["CANCELADA", "CANCELADO"]}, "paga": {"$ne": False}}, {"_id": 0}).to_list(None)

    # hoje: linha do tempo do dia (horário local)
    def local(dh):
        try:
            d = datetime.fromisoformat(str(dh).replace("Z", "+00:00"))
            return (d if d.tzinfo else d.replace(tzinfo=TZ_BR)).astimezone(TZ_BR)
        except ValueError:
            return None
    hoje_lista, futuras, passadas = [], [], []
    for c in consultas:
        d = local(c.get("data_hora"))
        if not d:
            continue
        item = {"id": c.get("id"), "paciente_id": c.get("paciente_id"), "nome": (por_id.get(c.get("paciente_id")) or {}).get("nome") or c.get("paciente_nome"),
                "hora": d.strftime("%H:%M"), "data": d.date().isoformat(), "tipo": c.get("tipo"), "status": c.get("status"), "_dt": d}
        if d.date() == hoje:
            hoje_lista.append(item)
        if d > agora_br:
            futuras.append(item)
        else:
            passadas.append(item)
    hoje_lista.sort(key=lambda x: x["hora"])
    futuras.sort(key=lambda x: x["_dt"])
    proxima = next((f for f in futuras if f["data"] != hoje.isoformat()), None)

    # pendências automáticas (cada uma com a ação)
    pend = []
    resolvidas = lambda p, tipo: str(((p.get("pendencias_resolvidas") or {}).get(tipo)) or "")

    def add(p, tipo, texto, acao, quando=""):
        if quando and resolvidas(p, tipo) >= str(quando):
            return
        if not quando and resolvidas(p, tipo):
            return
        pend.append({"tipo": tipo, "texto": texto, "acao": acao, "paciente_id": p["id"], "nome": p.get("nome"), "telefone": p.get("telefone"), "quando": quando})

    ultima_resp = {}
    async for m in db.patient_messages.aggregate([{"$match": {"role": "user", "patient_id": {"$in": list(por_id)}}},
                                                  {"$group": {"_id": "$patient_id", "u": {"$max": "$created_at"}}}]):
        ultima_resp[m["_id"]] = m["u"]
    ult_lembrete = {}
    async for n in db.patient_nudges.find({"nutricionista_id": nid, "last_fired_at": {"$ne": None}}, {"_id": 0, "patient_id": 1, "last_fired_at": 1}):
        if str(n["last_fired_at"]) > str(ult_lembrete.get(n["patient_id"], "")):
            ult_lembrete[n["patient_id"]] = n["last_fired_at"]
    house = {}
    async for a in db.drhouse_exam_analyses.find({"nutricionista_id": nid}, {"_id": 0, "paciente_id": 1, "created_at": 1}):
        if str(a["created_at"]) > str(house.get(a["paciente_id"], "")):
            house[a["paciente_id"]] = a["created_at"]
    plano_em = {}
    async for pl in db.planos_manuais.find({"paciente_id": {"$in": list(por_id)}}, {"_id": 0, "paciente_id": 1, "atualizado_em": 1, "criado_em": 1}):
        t = str(pl.get("atualizado_em") or pl.get("criado_em") or "")
        if t > plano_em.get(pl["paciente_id"], ""):
            plano_em[pl["paciente_id"]] = t
    ult_consulta = {}
    for c in passadas:
        t = c["_dt"].isoformat()
        if t > ult_consulta.get(c["paciente_id"], ""):
            ult_consulta[c["paciente_id"]] = t

    for p in pacs:
        st = p.get("status_funil")
        if st in ("PERDIDO", "INATIVO"):
            continue
        f = p.get("formulario") or {}
        if f.get("estado") == "respondido" and f.get("respondido_em"):
            add(p, "formulario", f"{'Retorno' if f.get('tipo') == 'retorno' else 'Formulário'} respondido para revisar", "revisar", f["respondido_em"])
        uc = ult_consulta.get(p["id"])
        if uc and plano_em.get(p["id"], "") < uc and st not in ("LEAD_INICIADO",):
            add(p, "sem_plano", "Consulta feita sem plano entregue", "prescricao", uc)
        if house.get(p["id"]):
            add(p, "exame", "Exame analisado pelo Dr. House", "exames", house[p["id"]])
        ul = ult_lembrete.get(p["id"])
        if ul and not (ultima_resp.get(p["id"]) and str(ultima_resp[p["id"]]) > str(ul)):
            dias = (agora - datetime.fromisoformat(str(ul))).days
            if dias >= 3:
                add(p, "sem_resposta", f"Sem responder os lembretes há {dias} dias", "whatsapp", ul)
        sit = situacao_plano(p.get("assinatura"), 7, hoje)
        if sit["status"] == "vencendo":
            add(p, "plano_vencendo", f"Plano vence em {sit['dias']} dias", "renovar", (p.get("assinatura") or {}).get("vencimento"))
        elif sit["status"] == "vencido":
            add(p, "pagamento_atrasado", f"Pagamento atrasado há {-sit['dias']} dias", "cobrar", (p.get("assinatura") or {}).get("vencimento"))
        sit_ciclo = ciclos_mod.situacao(p.get("ciclo_carbo"), hoje)
        if sit_ciclo and sit_ciclo.get("proxima_troca"):
            faltam = (sit_ciclo["proxima_troca"] - hoje).days
            if 0 <= faltam <= 3:
                add(p, "troca_fase", f"Troca de fase em {faltam} {'dia' if faltam == 1 else 'dias'}: {sit_ciclo.get('rotulo')} → {sit_ciclo.get('proximo_rotulo')}. Revise o plano da próxima fase",
                    "prescricao", sit_ciclo["proxima_troca"].isoformat())
        ch = p.get("conversa_humana") or {}
        if ch.get("aberta"):
            add(p, "conversa", f"Conversa para você: {ch.get('pergunta') or 'cliente aguardando resposta'}"[:140], "conversa", max(str(ch.get("desde") or ""), str(p.get("ultima_mensagem_cliente") or "")))
        if st == "LEAD_INICIADO" and not (p.get("formulario") or {}).get("enviado_em"):
            criado = str(p.get("created_at") or "")
            try:
                dias = (agora - datetime.fromisoformat(criado.replace("Z", "+00:00"))).days
            except ValueError:
                dias = 0
            if dias >= 2:
                add(p, "lead_parado", f"Lead sem resposta há {dias} dias", "proposta", criado)
    pend.sort(key=lambda x: str(x.get("quando") or ""), reverse=True)

    # jornada e mês
    jornada = [{"key": k, "rotulo": r, "total": sum(1 for p in pacs if p.get("status_funil") in sts),
                "pacientes": [{"id": p["id"], "nome": p.get("nome")} for p in pacs if p.get("status_funil") in sts][:30]} for k, r, sts in _JORNADA]
    ini_mes = hoje.replace(day=1).isoformat()
    pagos = await db.pagamentos.find({"nutricionista_id": nid, "data_pagamento": {"$gte": ini_mes}}, {"_id": 0, "valor": 1, "vencimento_anterior": 1}).to_list(None)
    a_receber = 0.0
    for p in pacs:
        a = p.get("assinatura") or {}
        v = str(a.get("vencimento") or "")[:10]
        if a.get("ativo") is not False and v and v[:7] == hoje.isoformat()[:7] and v >= hoje.isoformat():
            a_receber += float(a.get("valor") or 0)
    leads_mes = [p for p in pacs if str(p.get("created_at") or "") >= ini_mes]
    fecharam = [p for p in leads_mes if p.get("status_funil") not in ("LEAD_INICIADO", "PERDIDO")]
    mes = {
        "consultas": sum(1 for c in passadas + futuras if c["data"] >= ini_mes and c["data"][:7] == hoje.isoformat()[:7]),
        "novos_pacientes": len(fecharam),
        "renovacoes": sum(1 for g in pagos if g.get("vencimento_anterior")),
        "recebido": round(sum(float(g.get("valor") or 0) for g in pagos), 2),
        "a_receber": round(a_receber, 2),
        "leads": len(leads_mes), "convertidos": len(fecharam),
        "propostas": await db.patients.count_documents({"nutricionista_id": nid, "proposta_aceita_em": {"$gte": ini_mes}}),
        "pagos": await db.reservas.count_documents({"nutricionista_id": nid, "status": "confirmada", "confirmada_em": {"$gte": ini_mes}}),
    }
    # próximos passos: últimos atendidos, etapa e o que falta
    vistos, passos = set(), []
    for c in sorted(passadas, key=lambda x: x["_dt"], reverse=True):
        if c["paciente_id"] in vistos or c["paciente_id"] not in por_id:
            continue
        vistos.add(c["paciente_id"])
        p = por_id[c["paciente_id"]]
        passos.append({"paciente_id": p["id"], "nome": p.get("nome"), "ultima": c["_dt"].strftime("%d/%m/%Y"),
                       "etapa": p.get("status_funil"), "falta": _PASSO_DA_ETAPA.get(p.get("status_funil"), "—")})
        if len(passos) >= 6:
            break
    for lst in (hoje_lista,):
        for x in lst:
            x.pop("_dt", None)
    if proxima:
        proxima = {k: v for k, v in proxima.items() if k != "_dt"}
    return {"hoje": hoje_lista, "proxima": proxima, "pendencias": pend[:40], "jornada": jornada,
            "perdidos": sum(1 for p in pacs if p.get("status_funil") == "PERDIDO"), "mes": mes, "proximos_passos": passos}


@api.get("/patients")
async def list_patients(user=Depends(get_current_user)):
    rows = await db.patients.find(
        {"nutricionista_id": user["id"]}, {"_id": 0, "lead_token": 0, "fotos": 0, "comprovante": 0}
    ).sort("created_at", -1).to_list(2000)
    # etapa, última/próxima consulta e situação do plano para a lista (ajuste pac1)
    from financeiro import situacao_plano
    agora = iso(now_utc())[:16]
    pids = [r["id"] for r in rows]
    ultima, proxima = {}, {}
    async for c in db.consultations.find({"paciente_id": {"$in": pids}, "status": {"$nin": ["CANCELADA", "CANCELADO"]}},
                                         {"_id": 0, "paciente_id": 1, "data_hora": 1}):
        dh = str(c.get("data_hora") or "")
        if not dh:
            continue
        pid = c["paciente_id"]
        if dh[:16] < agora:
            if dh > ultima.get(pid, ""):
                ultima[pid] = dh
        elif not proxima.get(pid) or dh < proxima[pid]:
            proxima[pid] = dh
    hoje = now_utc().astimezone(TZ_BR).date()
    for r in rows:
        r["etapa"] = _ETAPA_DO_STATUS.get(r.get("status_funil"), "atendimento")
        r["ultima_consulta"] = ultima.get(r["id"])
        r["proxima_consulta"] = proxima.get(r["id"])
        r["plano"] = situacao_plano(r.get("assinatura"), 7, hoje)
    return rows


def _so_digitos(v) -> str:
    return re.sub(r"\D", "", str(v or ""))


@api.get("/patients/duplicados")
async def patients_duplicados(nome: str = "", telefone: str = "", user=Depends(require_nutritionist)):
    """Aviso de duplicado ao cadastrar: mesmo telefone (últimos 8 dígitos) ou nome muito parecido."""
    alvo_tel = _so_digitos(telefone)[-8:]
    alvo_nome = _normalize_food_lookup(nome)
    if len(alvo_nome) < 4 and len(alvo_tel) < 8:
        return []
    out = []
    async for p in db.patients.find({"nutricionista_id": user["id"]}, {"_id": 0, "id": 1, "nome": 1, "telefone": 1, "status_funil": 1}):
        n = _normalize_food_lookup(p.get("nome") or "")
        mesmo_tel = alvo_tel and len(alvo_tel) == 8 and _so_digitos(p.get("telefone"))[-8:] == alvo_tel
        parecido = len(alvo_nome) >= 4 and n and (n == alvo_nome or (n.split()[:2] == alvo_nome.split()[:2] and len(alvo_nome.split()) >= 2))
        if mesmo_tel or parecido:
            out.append({**p, "motivo": "telefone" if mesmo_tel else "nome"})
    return out[:5]


class JuntarIn(BaseModel):
    origem_id: str


@api.post("/patients/{pid}/juntar")
async def juntar_pacientes(pid: str, payload: JuntarIn, user=Depends(require_nutritionist)):
    """Junta o cadastro duplicado (`origem_id`) neste paciente: tudo do duplicado passa para cá e ele é apagado."""
    if payload.origem_id == pid:
        raise HTTPException(400, "Escolha outro cadastro")
    destino = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]}, {"_id": 0})
    origem = await db.patients.find_one({"id": payload.origem_id, "nutricionista_id": user["id"]}, {"_id": 0})
    if not destino or not origem:
        raise HTTPException(404, "Paciente não encontrado")
    for col in ("anamneses", "consultations", "evaluations", "avaliacao_fotos", "meal_plans", "planos_manuais", "ai_analyses", "exams",
                "exames_manuais", "drhouse_exam_analyses", "recordatorios", "pagamentos"):
        await db[col].update_many({"paciente_id": payload.origem_id}, {"$set": {"paciente_id": pid}})
    for col in ("patient_nudges", "patient_messages"):
        await db[col].update_many({"patient_id": payload.origem_id}, {"$set": {"patient_id": pid}})
    faltando = {k: v for k, v in origem.items() if k not in ("id", "_id", "created_at", "lead_token") and v not in (None, "", [], {}) and destino.get(k) in (None, "", [], {})}
    if faltando:
        await db.patients.update_one({"id": pid}, {"$set": faltando})
    await db.patients.delete_one({"id": payload.origem_id})
    return {"ok": True, "campos_copiados": sorted(faltando)}

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
        "avaliacao_fotos": {"paciente_id": pid},
        "meal_plans": {"paciente_id": pid},
        "ai_analyses": {"paciente_id": pid},
        "exams": {"paciente_id": pid},
        "recordatorios": {"paciente_id": pid},
        "patient_nudges": {"patient_id": pid},
        "patient_messages": {"patient_id": pid},
        "consultorio_messages": {"patient_id": pid},
        "planos_manuais": {"paciente_id": pid},
        "planos_manuais_historico": {"paciente_id": pid},
        "donato_plan_generations": {"paciente_id": pid},
        "drhouse_exam_analyses": {"paciente_id": pid},
        "exames_manuais": {"paciente_id": pid},
        "pagamentos": {"paciente_id": pid},
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
    avals = await db.evaluations.find({"paciente_id": pid}, {"_id": 0}).sort("created_at", -1).to_list(None)  # sem limite de avaliações
    plans = await db.meal_plans.find({"paciente_id": pid}, {"_id": 0}).sort("created_at", -1).to_list(20)
    analyses = await db.ai_analyses.find({"paciente_id": pid}, {"_id": 0}).sort("created_at", -1).to_list(10)
    exams = await db.exams.find({"paciente_id": pid}, {"_id": 0, "raw_text": 0}).sort("created_at", -1).to_list(50)
    recs = await db.recordatorios.find({"paciente_id": pid}, {"_id": 0}).sort("data", -1).to_list(50)
    anam_v2 = await _anamnese_principal(pid)
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
    anam = await _anamnese_principal(pid)
    avals = await db.evaluations.find_one({"paciente_id": pid}, {"_id": 0}, sort=[("created_at", -1)])
    if not anam:
        raise HTTPException(400, "Paciente sem anamnese")
    try:
        text = await ai_clinical_analysis(af.legiveis(anam, incluir_dados_pessoais=True), avals.get("composicao") if avals else None)
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
    anam = await _anamnese_principal(pid)
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
    rows = await db.evaluations.find({"paciente_id": pid}, {"_id": 0}).to_list(None)
    rows.sort(key=lambda e: str(e.get("data_avaliacao") or e.get("created_at") or ""))
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
        "provider": a.get("provider"),
        "knowledge_mode": a.get("knowledge_mode"),
        "schema_version": a.get("schema_version"),
        "requires_human_approval": a.get("requires_human_approval"),
        "active": a.get("active", True),
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
    view["prompt_max_chars"] = _agent_prompt_max_chars(code)
    return view

@api.patch("/agents/{code}")
async def update_agent_prompt(code: str, payload: AgentPromptUpdate, user=Depends(require_nutritionist)):
    if code not in AGENT_CODES:
        raise HTTPException(404, "Agente desconhecido")
    await ensure_agents_seeded()
    await db.agents.update_one(
        {"code": code},
        {"$set": {"base_prompt": payload.base_prompt, "prompt_customized": True, "updated_at": iso(now_utc())}},
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
        "source_filename": file.filename,
        "size": len(raw), "chars": len(text), "content": text,
        "normalized_content": text if code == "donato" else None,
        "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
        "status": "draft" if code == "donato" else "approved",
        "document_type": "scientific_evidence" if code == "donato" else None,
        "topic": None,
        "source_document_id": None,
        "version": "1.0" if code == "donato" else None,
        "indexed": False if code == "donato" else None,
        "openai_file_id": None,
        "vector_store_id": None,
        "approved_by": None,
        "approved_at": None,
        "created_at": iso(now_utc()),
        "updated_at": iso(now_utc()),
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
        "source_filename": None,
        "size": len(text.encode("utf-8")), "chars": len(text), "content": text,
        "normalized_content": text if code == "donato" else None,
        "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
        "status": "draft" if code == "donato" else "approved",
        "document_type": "scientific_evidence" if code == "donato" else None,
        "topic": None,
        "source_document_id": None,
        "version": "1.0" if code == "donato" else None,
        "indexed": False if code == "donato" else None,
        "openai_file_id": None,
        "vector_store_id": None,
        "approved_by": None,
        "approved_at": None,
        "created_at": iso(now_utc()),
        "updated_at": iso(now_utc()),
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

# ---------- DONATO (rascunho estruturado com aprovacao humana) ----------
DONATO_MISSING_REQUIRED_SOURCES = DONATO_KNOWLEDGE_MANIFEST["missing_required_sources"]
DONATO_STAGE_LABELS = [
    "Consolidando dados do paciente",
    "Selecionando protocolos",
    "Consultando base de conhecimento",
    "Montando estrategia",
    "Calculando plano",
    "Validando",
]
DONATO_MEALS = [
    "Cafe da manha", "Lanche da manha", "Almoco", "Lanche da tarde",
    "Jantar", "Ceia", "Pre-treino", "Pos-treino", "Refeicao 9", "Refeicao 10",
]
DONATO_PROTOCOL_KEYWORDS = {
    "diabetes_mellitus": ("Protocolo Clinico de Diabetes Mellitus", "03.10", ["diabetes", "diabetico"]),
    "pre_diabetes": ("Protocolo Clinico de Pre-Diabetes", "03.11", ["pre-diabetes", "prediabetes"]),
    "resistencia_insulina": ("Protocolo Clinico de Resistencia a Insulina", "03.12", ["resistencia a insulina", "homa"]),
    "hipertensao": ("Protocolo Clinico de Hipertensao Arterial", "03.13", ["hipertensao", "pressao alta"]),
    "dislipidemia": ("Protocolo Clinico de Dislipidemia", "03.14", ["dislipidemia", "colesterol", "triglicer"]),
    "obesidade": ("Protocolo Clinico de Obesidade", "03.15", ["obesidade", "obeso"]),
    "sop": ("Protocolo Clinico de Sindrome dos Ovarios Policisticos", "03.16", ["sop", "ovarios policisticos"]),
    "esteatose_hepatica": ("Protocolo Clinico de Esteatose Hepatica", "03.17", ["esteatose", "hepatica"]),
    "doenca_celiaca": ("Protocolo Clinico de Doenca Celiaca", "03.19", ["celiaca", "gluten"]),
    "intolerancia_lactose": ("Protocolo Clinico de Intolerancia a Lactose", "03.20", ["lactose"]),
    "performance_esportiva": ("Protocolo Clinico de Performance Esportiva", "03.05", ["performance", "esport", "treino", "hipertrofia"]),
}

def _patient_age_years(p: dict) -> Optional[int]:
    value = p.get("data_nascimento")
    if not value:
        return None
    try:
        birth = date.fromisoformat(str(value)[:10])
    except Exception:
        return None
    today = datetime.now(TZ_BR).date()
    return max(0, today.year - birth.year - ((today.month, today.day) < (birth.month, birth.day)))

def _donato_split_terms(value: Any) -> list[str]:
    if not value:
        return []
    raw = value if isinstance(value, list) else (value.values() if isinstance(value, dict) else re.split(r"[,;\n|]+", str(value)))
    vazios = {"nenhuma", "nenhum", "nao", "não", "n/a", "-", "sem"}
    return [str(item).strip() for item in raw if str(item).strip() and str(item).strip().lower() not in vazios]

def _donato_select_protocols(patient: dict, anam: dict, objective: str) -> list[dict]:
    respostas = (anam or {}).get("respostas") or anam or {}
    text = unicodedata.normalize("NFKD", " ".join([
        str(patient.get("objetivo") or ""), str(objective or ""), json.dumps(respostas, ensure_ascii=False), str(patient.get("observacoes") or "")
    ])).encode("ascii", "ignore").decode("ascii").lower()
    protocols = []
    for code, (title, source_id, keywords) in DONATO_PROTOCOL_KEYWORDS.items():
        if any(keyword in text for keyword in keywords):
            protocols.append({
                "codigo": code,
                "titulo": title,
                "motivo": "Detectado em objetivo, anamnese ou observacoes do paciente.",
                "prioridade": 5 if code == "performance_esportiva" else 1,
                "source_document_id": source_id,
            })
    return sorted(protocols, key=lambda item: item["prioridade"])

async def _donato_pick_food(regexes: list[str]) -> Optional[dict]:
    filt = {"arquivado": {"$ne": True}, "$or": [{"nome": {"$regex": term, "$options": "i"}} for term in regexes]}
    return await db.alimentos.find_one(filt, {"_id": 0})

def _donato_food_item(food: dict, grams: float, alternatives: Optional[list[dict]] = None) -> dict:
    nutr = _nutrientes_por_porcao(food, grams)
    return {
        "alimento_id": food.get("id"),
        "nome": food.get("nome"),
        "categoria": food.get("grupo") or food.get("categoria") or "alimento",
        "quantidade": {"peso_g": grams, "unidade": "g", "medida_caseira": food.get("medida_caseira") or f"{round(grams)} g"},
        "modo_preparo": None,
        "nutrientes": {
            "energia_kcal": nutr.get("energia_kcal"),
            "proteinas_g": nutr.get("proteinas_g"),
            "carboidratos_g": nutr.get("carboidratos_g"),
            "gorduras_g": nutr.get("lipidios_g"),
            "fibras_g": nutr.get("fibras_g"),
        },
        "alternativas": alternatives or [],
    }

def _donato_calc_summary(refeicoes: list[dict], peso_kg: Optional[float]) -> dict:
    totals = {"energia_kcal": 0.0, "proteinas_g": 0.0, "carboidratos_g": 0.0, "gorduras_g": 0.0, "fibras_g": 0.0}
    for meal in refeicoes:
        meal_totals = {key: 0.0 for key in totals}
        for item in meal.get("alimentos") or []:
            n = item.get("nutrientes") or {}
            for key in meal_totals:
                meal_totals[key] += _coerce_float(n.get(key)) or 0.0
        meal["resumo_refeicao"] = {key: round(value, 2) for key, value in meal_totals.items()}
        for key in totals:
            totals[key] += meal_totals[key]
    kcal = round(totals["energia_kcal"], 2)
    def macro(field: str, factor: int) -> dict:
        grams = round(totals[field], 2)
        return {
            "quantidade_g": grams,
            "percentual_energetico": round((grams * factor / kcal) * 100, 1) if kcal else None,
            "gramas_por_kg": round(grams / peso_kg, 2) if peso_kg else None,
        }
    return {
        "valor_energetico_total_kcal": kcal,
        "peso_utilizado_calculo_kg": peso_kg,
        "proteinas": macro("proteinas_g", 4),
        "carboidratos": macro("carboidratos_g", 4),
        "gorduras": macro("gorduras_g", 9),
        "fibras_g": round(totals["fibras_g"], 2),
        "agua_recomendada_ml": round(peso_kg * 35) if peso_kg else None,
    }

async def _donato_recalculate_evonut(draft: dict) -> dict:
    paciente = draft.get("paciente") or {}
    peso_kg = _coerce_float(paciente.get("peso_kg"))
    errors = []
    for meal in draft.get("refeicoes") or []:
        for item in meal.get("alimentos") or []:
            alimento_id = item.get("alimento_id")
            if not alimento_id:
                errors.append(f"Alimento sem alimento_id em {meal.get('nome') or 'refeicao'}.")
                continue
            food = await db.alimentos.find_one({"id": alimento_id}, {"_id": 0})
            if not food:
                errors.append(f"Alimento EVONUT nao encontrado: {item.get('nome') or alimento_id}.")
                continue
            q = item.get("quantidade") or {}
            grams = _coerce_float(q.get("peso_g"))
            if grams is None:
                errors.append(f"Quantidade em gramas ausente: {food.get('nome')}.")
                continue
            item.update(_donato_food_item(food, grams, item.get("alternativas") or []))
    draft["resumo_nutricional"] = _donato_calc_summary(draft.get("refeicoes") or [], peso_kg)
    validation = draft.setdefault("validacao", {})
    previous = validation.get("erros") or []
    validation["erros"] = previous + errors
    validation["status"] = "needs_data" if draft.get("dados_pendentes") else "pending_backend_validation"
    return draft

def _donato_to_manual_payload(draft: dict) -> dict:
    resumo = draft.get("resumo_nutricional") or {}
    refs = []
    for meal in draft.get("refeicoes") or []:
        foods = []
        for item in meal.get("alimentos") or []:
            q = item.get("quantidade") or {}
            foods.append({
                "alimento_id": item.get("alimento_id"),
                "nome": item.get("nome"),
                "medida_nome": "Gramas",
                "quantidade": q.get("peso_g"),
                "quantidade_g": q.get("peso_g"),
                "medida_caseira": q.get("medida_caseira"),
                "substituivel": True,
                "substitutos": [
                    {
                        "alimento_id": alt.get("alimento_id"),
                        "nome": alt.get("nome"),
                        "medida_nome": "Gramas",
                        "quantidade": (alt.get("quantidade") or {}).get("peso_g"),
                        "quantidade_g": (alt.get("quantidade") or {}).get("peso_g"),
                    }
                    for alt in item.get("alternativas") or []
                    if alt.get("alimento_id")
                ],
                "observacao": " · ".join(x for x in (q.get("medida_caseira"), item.get("modo_preparo")) if x) or None,
            })
        total = _coerce_float(resumo.get("valor_energetico_total_kcal")) or 0
        kcal_ref = _coerce_float((meal.get("resumo_refeicao") or {}).get("energia_kcal")) or 0
        refs.append({
            "nome": meal.get("nome") or "Refeicao",
            "horario": meal.get("horario"),
            "meta_pct": meal.get("meta_pct") if meal.get("meta_pct") is not None else (round(kcal_ref / total * 100) if total else None),
            "meta_kcal": (meal.get("resumo_refeicao") or {}).get("energia_kcal"),
            "alimentos": foods,
            "observacao": None,
        })
    return {
        "titulo": "Dieta · gerada pelo Dr. Donatto",
        "objetivo": ((draft.get("estrategia_nutricional") or {}).get("objetivo_principal")),
        "estrategia": ((draft.get("estrategia_nutricional") or {}).get("tipo_plano")),
        "meta_kcal": resumo.get("valor_energetico_total_kcal"),
        "meta_proteina_g": (resumo.get("proteinas") or {}).get("quantidade_g"),
        "meta_carboidrato_g": (resumo.get("carboidratos") or {}).get("quantidade_g"),
        "meta_lipidio_g": (resumo.get("gorduras") or {}).get("quantidade_g"),
        "prescricao_dietetica": {"origem": "donato", "schema_version": draft.get("versao_schema")},
        "orientacao_ids": [],
        "refeicoes": refs,
        "observacoes": "\n".join((draft.get("orientacoes_gerais") or []) + (draft.get("observacoes") or [])),
    }

async def _build_donato_draft(patient: dict, payload: DonatoDraftIn) -> dict:
    anam = await _anamnese_principal(patient["id"])
    aval = await db.evaluations.find_one({"paciente_id": patient["id"]}, {"_id": 0}, sort=[("created_at", -1)])
    peso = _coerce_float(patient.get("peso") or (aval or {}).get("peso"))
    altura = _coerce_float(patient.get("altura") or (aval or {}).get("altura"))
    idade = _patient_age_years(patient) or (aval or {}).get("idade")
    objetivo = payload.objetivo or patient.get("objetivo")
    dados_pendentes = []
    if not peso:
        dados_pendentes.append("Peso atual do paciente")
    if not altura:
        dados_pendentes.append("Altura do paciente")
    if not objetivo:
        dados_pendentes.append("Objetivo nutricional")
    food_sets = [
        (["ovo", "frango", "atum"], 100), (["banana", "mamao", "maca"], 100),
        (["arroz", "batata", "mandioca"], 120), (["feijao", "lentilha"], 90),
        (["frango", "peixe", "patinho"], 140), (["azeite", "abacate", "castanha"], 15),
    ]
    picked = []
    for regexes, grams in food_sets:
        food = await _donato_pick_food(regexes)
        if food:
            picked.append((food, grams))
    refeicoes = []
    count = min(payload.numero_refeicoes, len(DONATO_MEALS))
    for idx in range(count):
        item_food = picked[idx % len(picked)] if picked else None
        items = []
        if item_food:
            food, grams = item_food
            alt_food = picked[(idx + 1) % len(picked)][0] if len(picked) > 1 else None
            alternatives = []
            if alt_food and alt_food.get("id") != food.get("id"):
                alternatives.append({
                    "alimento_id": alt_food.get("id"),
                    "nome": alt_food.get("nome"),
                    "categoria": alt_food.get("grupo") or alt_food.get("categoria") or "alimento",
                    "quantidade": {"peso_g": grams, "unidade": "g", "medida_caseira": alt_food.get("medida_caseira") or f"{round(grams)} g"},
                })
            items.append(_donato_food_item(food, grams, alternatives))
        refeicoes.append({
            "ordem": idx + 1,
            "nome": DONATO_MEALS[idx],
            "horario": None,
            "resumo_refeicao": {"energia_kcal": None, "proteinas_g": None, "carboidratos_g": None, "gorduras_g": None, "fibras_g": None},
            "alimentos": items,
        })
    resumo = _donato_calc_summary(refeicoes, peso)
    protocols = _donato_select_protocols(patient, anam or {}, objetivo or "")
    validation_errors = []
    if DONATO_STRICT_SOURCE_GATE:
        validation_errors.append("Base documental incompleta: Prompt Mestre e Guia Mestre Alimentar pendentes.")
    if not picked:
        validation_errors.append("Nao foi possivel resolver alimentos na base EVONUT para montar o rascunho.")
    return {
        "tipo_resposta": "plano_alimentar",
        "versao_schema": DONATO_SCHEMA_VERSION,
        "status": "needs_data" if dados_pendentes else "draft_ai",
        "paciente": {
            "nome": patient.get("nome"),
            "idade_anos": idade,
            "sexo": patient.get("sexo"),
            "peso_kg": peso,
            "altura_cm": altura,
            "percentual_gordura": ((aval or {}).get("composicao") or {}).get("pct_gordura"),
            "objetivo_nutricional": objetivo,
            # Campos antigos (pre-consulta) com fallback para as secoes da anamnese do painel
            "condicoes_clinicas": _donato_split_terms((anam or {}).get("condicoes_clinicas") or (anam or {}).get("patologias")),
            "medicamentos": _donato_split_terms((anam or {}).get("medicamentos")),
            "nivel_atividade_fisica": str((aval or {}).get("nivel_atividade") or (aval or {}).get("naf_codigo") or "") or None,
            "alergias": _donato_split_terms((anam or {}).get("alergias") or (anam or {}).get("alergia_alimentar")),
            "intolerancias": _donato_split_terms((anam or {}).get("intolerancias") or (anam or {}).get("intolerancia_alimentar")),
            "restricoes_alimentares": _donato_split_terms(
                (anam or {}).get("restricoes")
                or ", ".join(filter(None, [(anam or {}).get("restricao_alimentar"), (anam or {}).get("aversao_alimentar")]))
            ),
            "preferencias_alimentares": _donato_split_terms((anam or {}).get("preferencias") or (anam or {}).get("preferencia_alimentar")),
        },
        "estrategia_nutricional": {
            "tipo_plano": "rascunho_evonut",
            "objetivo_principal": objetivo,
            "numero_refeicoes": count,
            "distribuicao_refeicoes": "Distribuicao inicial calculada sobre refeicoes disponiveis.",
            "observacao_estrategica": payload.observacoes,
        },
        "protocolos_aplicados": protocols,
        "dados_pendentes": dados_pendentes,
        "resumo_nutricional": resumo,
        "refeicoes": refeicoes,
        "hidratacao": {"quantidade_diaria_ml": resumo.get("agua_recomendada_ml"), "orientacao": "Ajustar conforme treino, sudorese e conduta do nutricionista."},
        "orientacoes_gerais": ["Rascunho gerado para revisao do nutricionista.", "Conferir preferencias, restricoes e rotina antes da aprovacao."],
        "observacoes": [payload.observacoes] if payload.observacoes else [],
        "justificativa_tecnica": {"titulo": "Justificativa Técnica", "texto": "Rascunho estruturado calculado no backend com alimentos vinculados a base EVONUT. A camada OpenAI/RAG ainda depende da configuracao e dos documentos pendentes."},
        "evidencias": [{"source_document_id": item["source_document_id"], "titulo": item["titulo"], "file_id": None, "relevancia": "Protocolo selecionado pelo contexto; validar clinicamente."} for item in protocols],
        "validacao": {"status": "needs_data" if dados_pendentes else "pending_backend_validation", "erros": validation_errors, "avisos": ["Aprovacao humana obrigatoria antes de virar plano oficial."]},
    }

@api.get("/agents/donato/knowledge")
async def donato_knowledge_status(user=Depends(require_nutritionist)):
    await ensure_agents_seeded()
    approved = await db.agent_documents.count_documents({"agent_code": "donato", "status": "approved"})
    waiting = await db.agent_documents.count_documents({"agent_code": "donato", "$or": [{"status": {"$exists": False}}, {"status": "draft"}]})
    inactive = await db.agent_documents.count_documents({"agent_code": "donato", "status": "inactive"})
    agent = await db.agents.find_one({"code": "donato"}, {"_id": 0})
    return {
        "enabled": DONATO_ENABLED,
        "schema_version": DONATO_SCHEMA_VERSION,
        "requires_human_approval": DONATO_REQUIRE_HUMAN_APPROVAL,
        "strict_source_gate": DONATO_STRICT_SOURCE_GATE,
        "knowledge_mode": (agent or {}).get("knowledge_mode") or "vector_store",
        "vector_store_id": os.environ.get("OPENAI_DONATO_VECTOR_STORE_ID") or (agent or {}).get("vector_store_id"),
        "openai_configured": bool(os.environ.get("OPENAI_API_KEY")),
        "approved_documents": approved,
        "waiting_review_documents": waiting,
        "inactive_documents": inactive,
        "missing_required_sources": DONATO_MISSING_REQUIRED_SOURCES,
        "stages": DONATO_STAGE_LABELS,
    }

@api.post("/agents/donato/knowledge/documents/{doc_id}/approve")
async def approve_donato_knowledge_document(doc_id: str, user=Depends(require_nutritionist)):
    now = iso(now_utc())
    res = await db.agent_documents.update_one(
        {"id": doc_id, "agent_code": "donato"},
        {"$set": {"status": "approved", "approved_by": user["id"], "approved_at": now, "updated_at": now}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Documento DONATO nao encontrado")
    return await db.agent_documents.find_one({"id": doc_id}, {"_id": 0, "content": 0, "normalized_content": 0})

@api.post("/agents/donato/knowledge/documents/{doc_id}/deactivate")
async def deactivate_donato_knowledge_document(doc_id: str, user=Depends(require_nutritionist)):
    res = await db.agent_documents.update_one(
        {"id": doc_id, "agent_code": "donato"},
        {"$set": {"status": "inactive", "updated_at": iso(now_utc())}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Documento DONATO nao encontrado")
    return await db.agent_documents.find_one({"id": doc_id}, {"_id": 0, "content": 0, "normalized_content": 0})

@api.post("/agents/donato/knowledge/sync")
async def sync_donato_knowledge(user=Depends(require_nutritionist)):
    try:
        result = await sync_approved_documents(get_donato_settings(), db, iso(now_utc()))
    except DonatoProviderUnavailable as exc:
        raise HTTPException(503, {"code": "DONATO_PROVIDER_UNAVAILABLE", "message": str(exc)})
    except Exception as exc:
        logging.exception("DONATO knowledge sync failed")
        raise HTTPException(503, {"code": "DONATO_KNOWLEDGE_UNAVAILABLE", "message": str(exc)[:180]})
    return result

@api.post("/agents/donato/knowledge/prepare")
async def prepare_donato_knowledge(user=Depends(require_nutritionist)):
    """Carrega a base do Donatto no banco (sem OpenAI). Usada pelo provedor Gemini."""
    try:
        return await prepare_manifest_documents(
            db,
            os.environ.get("DONATO_KNOWLEDGE_SOURCE_DIR") or None,
            iso(now_utc()),
            include_non_indexed=True,
        )
    except Exception as exc:
        logging.exception("DONATO knowledge prepare failed")
        raise HTTPException(503, {"code": "DONATO_KNOWLEDGE_UNAVAILABLE", "message": str(exc)[:180]})

@api.get("/agents/drhouse/knowledge")
async def drhouse_knowledge_status(user=Depends(require_nutritionist)):
    await ensure_agents_seeded()
    approved = await db.agent_documents.count_documents({"agent_code": "drhouse", "status": "approved"})
    inactive = await db.agent_documents.count_documents({"agent_code": "drhouse", "status": "inactive"})
    agent = await db.agents.find_one({"code": "drhouse"}, {"_id": 0})
    return {
        "agent_code": "drhouse",
        "agent": _agent_view(agent) if agent else None,
        "approved_documents": approved,
        "inactive_documents": inactive,
        "source_dir": os.environ.get("DRHOUSE_KNOWLEDGE_SOURCE_DIR") or str(Path.home() / "Downloads" / "DRHOUSERCTEAMNUTRI"),
    }

@api.post("/agents/drhouse/knowledge/sync")
async def sync_drhouse_knowledge(user=Depends(require_nutritionist)):
    try:
        return await sync_drhouse_documents(
            db,
            iso(now_utc()),
            source_dir=os.environ.get("DRHOUSE_KNOWLEDGE_SOURCE_DIR") or None,
        )
    except Exception as exc:
        logging.exception("Dr. House knowledge sync failed")
        raise HTTPException(503, {"code": "DRHOUSE_KNOWLEDGE_UNAVAILABLE", "message": str(exc)[:180]})

@api.get("/patients/{pid}/donato/plans")
async def list_donato_plans(pid: str, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente nao encontrado")
    return [d async for d in db.donato_plan_generations.find({"paciente_id": pid, "nutricionista_id": user["id"]}, {"_id": 0}).sort("created_at", -1)]

async def _donato_clinical_context(p: dict, payload: DonatoDraftIn, scaffold: dict) -> dict:
    anam = await _anamnese_principal(p["id"])
    aval = await db.evaluations.find_one({"paciente_id": p["id"]}, {"_id": 0}, sort=[("created_at", -1)])
    lote = await db.exames_manuais.find_one({"paciente_id": p["id"]}, {"_id": 0}, sort=[("data_coleta", -1)])
    anamnese = af.legiveis(anam)
    comp = (aval or {}).get("composicao") or {}
    return {
        "parametros_do_nutricionista": {
            "calorias_dieta_kcal": payload.kcal_meta,
            "numero_refeicoes": payload.numero_refeicoes,
            "refeicoes": payload.refeicoes or None,
            "regra": ("As calorias da dieta são definidas pelo nutricionista e devem ser usadas exatamente. "
                      "Macronutrientes, água, fibras, horários (se não vierem), alimentos, quantidades e substituições "
                      "são definidos por você com autonomia, seguindo o motor nutricional da base."),
        },
        "paciente": scaffold.get("paciente"),
        "estrategia_solicitada": payload.model_dump(exclude={"refeicoes"}),
        "gasto_energetico": {
            "tmb_kcal": comp.get("tmb"), "protocolo_tmb": comp.get("tmb_protocolo"),
            "naf": comp.get("naf"), "fator_injuria": comp.get("fi"), "get_kcal": comp.get("get_kcal"),
        },
        "antropometria": {k: comp.get(k) for k in ("imc", "imc_classificacao", "pct_gordura", "massa_magra", "ic", "rcq", "peso_ideal_min", "peso_ideal_max")},
        # gor1: fase do atleta, meta de % de gordura e peso-alvo (massa magra mantida)
        "fase_e_meta_de_gordura": {
            "atleta": bool(p.get("atleta")), "fase": {"off": "Off-season", "cutting": "Cutting"}.get(p.get("fase_treino")),
            "meta_pct_gordura": [(p.get("meta_gordura") or {}).get("min"), (p.get("meta_gordura") or {}).get("max")] if (p.get("meta_gordura") or {}).get("min") is not None else None,
            "peso_alvo_kg": [(p.get("meta_gordura") or {}).get("peso_alvo_min"), (p.get("meta_gordura") or {}).get("peso_alvo_max")] if (p.get("meta_gordura") or {}).get("peso_alvo_min") else None,
        },
        "perimetria_cm": (aval or {}).get("perimetria"),
        "anamnese": anamnese or None,
        "exames_laboratoriais": _drhouse_lotes_payload([lote]) if lote else None,
        "protocolos_sugeridos_pelo_sistema": scaffold.get("protocolos_aplicados"),
        "dados_pendentes": scaffold.get("dados_pendentes"),
    }


async def _donato_generate_with_gemini(p: dict, payload: DonatoDraftIn, scaffold: dict) -> tuple[dict, dict]:
    knowledge = await donato_gemini.load_knowledge(db)
    if not knowledge:
        raise HTTPException(503, {
            "code": "DONATO_KNOWLEDGE_MISSING",
            "message": "Base do Dr. Donatto vazia. Carregue os documentos em POST /agents/donato/knowledge/prepare.",
        })
    catalog = await donato_gemini.build_food_catalog(db)
    context = await _donato_clinical_context(p, payload, scaffold)
    agente = await db.agents.find_one({"code": "donato"}, {"_id": 0, "base_prompt": 1, "prompt_customized": 1}) or {}
    mestre = agente.get("base_prompt") if agente.get("prompt_customized") else None
    system_prompt, user_prompt = donato_gemini.build_prompt(context, knowledge, catalog, prompt_mestre=mestre)
    opts = dict(max_tokens=32768, temperature=0.4, timeout=300.0, thinking_budget=4096, response_mime_type="application/json")
    messages = [{"role": "user", "content": user_prompt}]
    raw = await _gemini_chat(messages, system_prompt, GEMINI_KEY, **opts)
    draft = donato_gemini.parse_json(raw)
    meta_kcal = payload.kcal_meta or _coerce_float((draft.get("resumo_nutricional") or {}).get("valor_energetico_total_kcal"))
    draft = await _donato_recalculate_evonut(draft)
    real_kcal = _coerce_float((draft.get("resumo_nutricional") or {}).get("valor_energetico_total_kcal"))
    def problemas_do(plano: dict, total: Optional[float]) -> list[str]:
        lista = []
        if meta_kcal and total and abs(total - meta_kcal) / meta_kcal > 0.10:
            lista.append(f"Total recalculado de {round(total)} kcal difere mais de 10% da meta de {round(meta_kcal)} kcal.")
        return lista + donato_gemini.quality_warnings(plano)

    correcoes = 0
    problemas = problemas_do(draft, real_kcal)
    if problemas:  # uma rodada de correcao guiada pelas checagens do backend
        messages += [
            {"role": "assistant", "content": raw},
            {"role": "user", "content": donato_gemini.build_correction_prompt(draft, problemas)},
        ]
        raw = await _gemini_chat(messages, system_prompt, GEMINI_KEY, **opts)
        draft = await _donato_recalculate_evonut(donato_gemini.parse_json(raw))
        real_kcal = _coerce_float((draft.get("resumo_nutricional") or {}).get("valor_energetico_total_kcal"))
        correcoes = 1
    validacao = draft.setdefault("validacao", {})
    validacao["erros"] = (validacao.get("erros") or []) + donato_gemini.schema_errors(draft)
    avisos = validacao.setdefault("avisos", [])
    avisos.extend(problemas_do(draft, real_kcal))
    avisos.append("Aprovacao humana obrigatoria antes de virar plano oficial.")
    return draft, {
        "provider": "gemini",
        "model": _gemini_last_model["name"],
        "knowledge_docs": [d.get("source_document_id") for d in knowledge],
        "catalogo_alimentos": len(catalog),
        "meta_kcal_ia": meta_kcal,
        "total_kcal_evonut": real_kcal,
        "rodadas_correcao": correcoes,
        "problemas_corrigidos": problemas,
    }


@api.post("/patients/{pid}/donato/plan/draft", status_code=201)
async def create_donato_plan_draft(pid: str, payload: DonatoDraftIn, user=Depends(require_nutritionist)):
    if not DONATO_ENABLED:
        raise HTTPException(403, "DONATO desativado por feature flag")
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Paciente nao encontrado")
    if not payload.kcal_meta:
        payload.kcal_meta = _coerce_float((p.get("meta_energetica") or {}).get("kcal_final"))
    if not payload.kcal_meta:
        raise HTTPException(400, "Informe as calorias da dieta (Gasto Energético ou Previsão de Macros) antes de gerar.")
    settings = get_donato_settings()
    scaffold = await _build_donato_draft(p, payload)
    provider = "deterministic_scaffold"
    provider_meta = {}
    agent = await db.agents.find_one({"code": "donato"}, {"_id": 0})
    vector_store_id = settings.vector_store_id or (agent or {}).get("vector_store_id")
    indexed_docs = await db.agent_documents.count_documents({
        "agent_code": "donato",
        "status": "approved",
        "indexed": True,
        "vector_store_id": vector_store_id,
    }) if vector_store_id else 0
    provider_pref = (os.environ.get("DONATO_PROVIDER") or "auto").strip().lower()
    use_openai = bool(settings.openai_api_key and vector_store_id and indexed_docs > 0) and provider_pref in ("auto", "openai")
    use_gemini = bool(GEMINI_KEY) and not use_openai and provider_pref in ("auto", "gemini")
    if use_gemini:
        try:
            draft, provider_meta = await _donato_generate_with_gemini(p, payload, scaffold)
            provider = "gemini_knowledge_in_prompt"
        except HTTPException:
            raise
        except Exception as exc:
            logging.exception("DONATO Gemini generation failed")
            raise HTTPException(503, {"code": "DONATO_GENERATION_FAILED", "message": str(exc)[:180]})
    elif use_openai:
        try:
            context = {
                "paciente": scaffold.get("paciente"),
                "estrategia_solicitada": payload.model_dump(),
                "dados_pendentes": scaffold.get("dados_pendentes"),
                "source_gate": {
                    "strict": settings.strict_source_gate,
                    "missing_required_sources": DONATO_MISSING_REQUIRED_SOURCES,
                },
            }
            draft, provider_meta = await generate_donato_plan_with_openai(
                settings,
                context,
                scaffold.get("protocolos_aplicados") or [],
                vector_store_id,
            )
            draft = await _donato_recalculate_evonut(draft)
            provider = "openai_responses_file_search"
        except DonatoProviderUnavailable as exc:
            raise HTTPException(503, {"code": "DONATO_PROVIDER_UNAVAILABLE", "message": str(exc)})
        except Exception as exc:
            logging.exception("DONATO draft generation failed")
            raise HTTPException(503, {"code": "DONATO_GENERATION_FAILED", "message": str(exc)[:180]})
    else:
        # Sem IA disponivel: rascunho automatico, marcado como tal para nao parecer gerado por IA
        draft = scaffold
        draft["status"] = "needs_review"
        draft.setdefault("validacao", {}).setdefault("erros", []).insert(
            0, "Rascunho automatico SEM IA (nenhum provedor configurado). Nao use como plano sem reescrever."
        )
    now = iso(now_utc())
    doc = {
        "id": str(uuid.uuid4()),
        "paciente_id": pid,
        "nutricionista_id": user["id"],
        "agent_code": "donato",
        "status": draft.get("status") or "draft_ai",
        "approval_status": "pending",
        "schema_version": DONATO_SCHEMA_VERSION,
        "provider": provider,
        "provider_meta": provider_meta,
        "model": settings.model,
        "stages": DONATO_STAGE_LABELS,
        "draft": draft,
        "input_snapshot_hash": hashlib.sha256(json.dumps(p, sort_keys=True, default=str).encode("utf-8")).hexdigest(),
        "created_at": now,
        "updated_at": now,
    }
    await db.donato_plan_generations.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}

@api.patch("/patients/{pid}/donato/plans/{generation_id}/draft")
async def update_donato_plan_draft(pid: str, generation_id: str, payload: DonatoDraftPatch, user=Depends(require_nutritionist)):
    existing = await db.donato_plan_generations.find_one({"id": generation_id, "paciente_id": pid, "nutricionista_id": user["id"]})
    if not existing:
        raise HTTPException(404, "Rascunho DONATO nao encontrado")
    if existing.get("approval_status") == "approved":
        raise HTTPException(409, "Rascunho ja aprovado")
    draft = payload.draft or {}
    await db.donato_plan_generations.update_one({"id": generation_id}, {"$set": {"draft": draft, "status": draft.get("status") or "edited_by_nutritionist", "approval_status": "pending", "updated_at": iso(now_utc())}})
    return await db.donato_plan_generations.find_one({"id": generation_id}, {"_id": 0})

@api.post("/patients/{pid}/donato/plans/{generation_id}/approve", status_code=201)
async def approve_donato_plan(pid: str, generation_id: str, payload: Optional[DonatoAplicarIn] = None, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente nao encontrado")
    generation = await db.donato_plan_generations.find_one({"id": generation_id, "paciente_id": pid, "nutricionista_id": user["id"]})
    if not generation:
        raise HTTPException(404, "Rascunho DONATO nao encontrado")
    if generation.get("approval_status") == "approved":
        raise HTTPException(409, "Rascunho ja aprovado")
    draft = generation.get("draft") or {}
    if draft.get("status") == "needs_data":
        raise HTTPException(400, "Rascunho possui dados pendentes e nao pode ser aprovado")
    latest = await db.planos_manuais.find_one({"paciente_id": pid}, {"versao": 1}, sort=[("versao", -1)])
    now = iso(now_utc())
    versao = int((latest or {}).get("versao") or 0) + 1
    corpo = PlanoManualIn(**payload.plano).model_dump() if payload and payload.plano else _donato_to_manual_payload(draft)
    revisado = bool(payload and payload.plano)
    corpo["titulo"] = f"Versão {versao} · gerado pelo Dr. Donatto{' e revisado por você' if revisado else ''}"
    manual = {
        "id": str(uuid.uuid4()),
        "paciente_id": pid,
        "nutricionista_id": user["id"],
        **corpo,
        "versao": versao,
        "ordem": await _proxima_ordem_plano(pid),
        "origem_donato_generation_id": generation_id,
        "criado_em": now,
        "atualizado_em": now,
    }
    await db.planos_manuais.insert_one(manual)
    await _create_plano_snapshot(manual, "approve_donato", user["id"])
    await _sincronizar_lembretes_refeicao(pid)
    await db.donato_plan_generations.update_one({"id": generation_id}, {"$set": {"approval_status": "approved", "approved_by": user["id"], "approved_at": now, "plano_manual_id": manual["id"], "updated_at": now}})
    return await _enrich_plano({k: v for k, v in manual.items() if k != "_id"})

@api.get("/patients/{pid}/donato/entrada")
async def donato_entrada(pid: str, user=Depends(require_nutritionist)):
    """O que o app manda ao Dr. Donatto, com a aba de origem de cada dado (✓ preenchido / pendente)."""
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Paciente nao encontrado")
    aval = await db.evaluations.find_one({"paciente_id": pid}, {"_id": 0}, sort=[("created_at", -1)])
    comp = (aval or {}).get("composicao") or {}
    leg = af.legiveis(await _anamnese_principal(pid)) or {}
    respostas = [(t, v) for bloco in leg.values() for t, v in bloco.items()]

    def do_form(rx):
        achados = [f"{t}: {v}" for t, v in respostas if re.search(rx, t, re.I)]
        return "; ".join(achados)[:220] or None

    house = await db.drhouse_exam_analyses.find_one({"paciente_id": pid}, {"_id": 0, "created_at": 1}, sort=[("created_at", -1)])
    lote = await db.exames_manuais.find_one({"paciente_id": pid}, {"_id": 0, "data_coleta": 1}, sort=[("data_coleta", -1)])
    idade = None
    try:
        nasc = date.fromisoformat(str(p.get("data_nascimento"))[:10])
        hoje = now_utc().astimezone(TZ_BR).date()
        idade = hoje.year - nasc.year - ((hoje.month, hoje.day) < (nasc.month, nasc.day))
    except (TypeError, ValueError):
        pass
    peso = (aval or {}).get("peso") or p.get("peso")
    itens = [
        {"campo": "Idade", "valor": f"{idade} anos" if idade is not None else None, "origem": "Ficha"},
        {"campo": "Sexo", "valor": {"M": "Masculino", "F": "Feminino"}.get(p.get("sexo"), p.get("sexo")), "origem": "Ficha"},
        {"campo": "Peso", "valor": f"{peso} kg" if peso else None, "origem": "Antropometria" if (aval or {}).get("peso") else "Ficha"},
        {"campo": "Altura", "valor": f"{(aval or {}).get('altura') or p.get('altura')} cm" if ((aval or {}).get("altura") or p.get("altura")) else None, "origem": "Ficha"},
        {"campo": "% de gordura", "valor": f"{comp.get('pct_gordura')} %" if comp.get("pct_gordura") is not None else None, "origem": "Antropometria"},
        {"campo": "Objetivo", "valor": p.get("objetivo"), "origem": "Ficha"},
        {"campo": "Fase e meta de gordura", "valor": " · ".join(x for x in (
            {"off": "Off-season", "cutting": "Cutting"}.get(p.get("fase_treino")),
            (f"meta {(p.get('meta_gordura') or {}).get('min')}–{(p.get('meta_gordura') or {}).get('max')}%" if (p.get("meta_gordura") or {}).get("min") is not None else None),
            (f"peso-alvo {(p.get('meta_gordura') or {}).get('peso_alvo_min')}–{(p.get('meta_gordura') or {}).get('peso_alvo_max')} kg" if (p.get("meta_gordura") or {}).get("peso_alvo_min") else None),
        ) if x) or None, "origem": "Antropometria"},
        {"campo": "Diagnósticos", "valor": do_form(r"doen|diagn|patolog|condi"), "origem": "Formulário"},
        {"campo": "Medicamentos", "valor": do_form(r"medica|rem[eé]dio"), "origem": "Formulário"},
        {"campo": "Rotina", "valor": do_form(r"rotina|treino|acorda|dorme"), "origem": "Formulário"},
        {"campo": "Preferências", "valor": do_form(r"gosta|prefer|fruta"), "origem": "Formulário"},
        {"campo": "Alergias e intolerâncias", "valor": do_form(r"alerg|intoler"), "origem": "Formulário"},
        {"campo": "Exames", "valor": (f"análise do Dr. House de {str(house['created_at'])[8:10]}/{str(house['created_at'])[5:7]}" if house
                                      else (f"coleta de {str(lote.get('data_coleta'))[:10]}" if lote else None)), "origem": "Exames (Dr. House)"},
    ]
    kcal = _coerce_float((p.get("meta_energetica") or {}).get("kcal_final"))
    return {"itens": itens, "kcal_meta": kcal, "formulario_respondido": bool(leg)}


@api.get("/patients/{pid}/donato/plans/{generation_id}/plano")
async def donato_plano_previa(pid: str, generation_id: str, user=Depends(require_nutritionist)):
    """O rascunho no formato do editor da Prescrição (nada é salvo)."""
    g = await db.donato_plan_generations.find_one({"id": generation_id, "paciente_id": pid, "nutricionista_id": user["id"]}, {"_id": 0})
    if not g:
        raise HTTPException(404, "Rascunho DONATO nao encontrado")
    plano = await _enrich_plano({"id": None, "paciente_id": pid, "nutricionista_id": user["id"], **_donato_to_manual_payload(g.get("draft") or {})})
    return {"plano": plano, "validacao": (g.get("draft") or {}).get("validacao") or {}, "generation": {k: v for k, v in g.items() if k != "draft"},
            "resumo": (g.get("draft") or {}).get("resumo_nutricional"), "justificativa": ((g.get("draft") or {}).get("justificativa_tecnica") or {}).get("texto")}


@api.post("/patients/{pid}/donato/plans/{generation_id}/refeicoes/{idx}/regenerar")
async def donato_regenerar_refeicao(pid: str, generation_id: str, idx: int, payload: DonatoRegerarIn, user=Depends(require_nutritionist)):
    """Refaz só uma refeição, mantendo a meta dela; o resto do rascunho fica igual."""
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]}, {"_id": 0})
    g = await db.donato_plan_generations.find_one({"id": generation_id, "paciente_id": pid, "nutricionista_id": user["id"]}, {"_id": 0})
    if not p or not g:
        raise HTTPException(404, "Rascunho DONATO nao encontrado")
    draft = g.get("draft") or {}
    refeicoes = draft.get("refeicoes") or []
    if not (0 <= idx < len(refeicoes)):
        raise HTTPException(400, "Refeição inválida")
    if not GEMINI_KEY:
        raise HTTPException(503, "Nenhum provedor de IA configurado")
    alvo = refeicoes[idx]
    meta = _coerce_float((alvo.get("resumo_refeicao") or {}).get("energia_kcal"))
    if payload.refeicoes and idx < len(payload.refeicoes) and payload.kcal_meta and payload.refeicoes[idx].get("pct"):
        meta = round(payload.kcal_meta * float(payload.refeicoes[idx]["pct"]) / 100)
    entrada = DonatoDraftIn(numero_refeicoes=len(refeicoes), kcal_meta=payload.kcal_meta or _coerce_float((draft.get("resumo_nutricional") or {}).get("valor_energetico_total_kcal")),
                            refeicoes=payload.refeicoes)
    knowledge = await donato_gemini.load_knowledge(db)
    catalog = await donato_gemini.build_food_catalog(db)
    scaffold = await _build_donato_draft(p, entrada)
    context = await _donato_clinical_context(p, entrada, scaffold)
    agente = await db.agents.find_one({"code": "donato"}, {"_id": 0, "base_prompt": 1, "prompt_customized": 1}) or {}
    system_prompt, user_prompt = donato_gemini.build_prompt(context, knowledge, catalog, prompt_mestre=agente.get("base_prompt") if agente.get("prompt_customized") else None)
    outras = [{"nome": r.get("nome"), "alimentos": [a.get("nome") for a in r.get("alimentos") or []]} for j, r in enumerate(refeicoes) if j != idx]
    pedido = (user_prompt + "\n\nTAREFA DESTA CHAMADA: refaça SOMENTE a refeição "
              f"\"{alvo.get('nome')}\" (horário {alvo.get('horario') or 'o mesmo'}), com meta de {round(meta or 0)} kcal, trocando os alimentos "
              "principais por outras opções do cardápio. Não repita os alimentos principais das outras refeições: "
              + json.dumps(outras, ensure_ascii=False)
              + "\nResponda APENAS com o JSON de UMA refeição, no mesmo formato de um item de \"refeicoes\" do contrato.")
    raw = await _gemini_chat([{"role": "user", "content": pedido}], system_prompt, GEMINI_KEY, max_tokens=8192, temperature=0.6,
                             timeout=180.0, thinking_budget=2048, response_mime_type="application/json")
    nova = donato_gemini.parse_json(raw)
    if isinstance(nova, dict) and "refeicoes" in nova and nova["refeicoes"]:
        nova = nova["refeicoes"][0]
    nova["nome"] = alvo.get("nome") or nova.get("nome")
    nova["horario"] = alvo.get("horario") or nova.get("horario")
    refeicoes[idx] = nova
    draft["refeicoes"] = refeicoes
    draft = await _donato_recalculate_evonut(draft)
    await db.donato_plan_generations.update_one({"id": generation_id}, {"$set": {"draft": draft, "updated_at": iso(now_utc())},
                                                                         "$inc": {"regeneracoes": 1}})
    return await donato_plano_previa(pid, generation_id, user)


@api.post("/patients/{pid}/donato/plans/{generation_id}/reject")
async def reject_donato_plan(pid: str, generation_id: str, user=Depends(require_nutritionist)):
    res = await db.donato_plan_generations.update_one(
        {"id": generation_id, "paciente_id": pid, "nutricionista_id": user["id"]},
        {"$set": {"approval_status": "rejected", "status": "rejected", "updated_at": iso(now_utc())}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Rascunho DONATO nao encontrado")
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
    final_message = _consultorio_message_for_action(payload.action, payload.message)
    if not final_message:
        raise HTTPException(400, "Mensagem ou acao do Agente 2 e obrigatoria")
    p = await db.patients.find_one({"id": payload.patient_id, "nutricionista_id": user["id"]}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    session_id = payload.session_id or f"{user['id']}-{payload.patient_id}"
    # Build patient context (anamnese mais recente, última avaliação, exames recentes)
    anam = await _anamnese_principal(p["id"])
    aval = await db.evaluations.find_one({"paciente_id": p["id"]}, {"_id": 0}, sort=[("created_at", -1)])
    exams = await db.exams.find(
        {"paciente_id": p["id"]}, {"_id": 0, "raw_text": 0, "content": 0}
    ).sort("created_at", -1).to_list(5)
    plan = await db.meal_plans.find_one({"paciente_id": p["id"]}, {"_id": 0}, sort=[("version", -1)])
    # Exames lancados manualmente (2 coletas mais recentes, em ordem cronologica)
    lotes_manuais = await db.exames_manuais.find(
        {"paciente_id": p["id"]}, {"_id": 0}
    ).sort("data_coleta", -1).to_list(2)
    lotes_manuais.reverse()
    # Anamnese organizada pelos blocos do formulário (inclui "outras informações" migradas do formato antigo)
    anamnese_blocos = af.legiveis(anam)
    patient_ctx = {
        "nome": p.get("nome"), "sexo": p.get("sexo"),
        "idade_anos": _patient_age_years(p),
        "peso": p.get("peso"), "altura": p.get("altura"),
        "objetivo": p.get("objetivo"),
        "anamnese": anamnese_blocos or None,
        "avaliacao": (aval or {}).get("composicao"),
        "exames_recentes": exams,
        "exames_laboratoriais": _drhouse_lotes_payload(lotes_manuais) if lotes_manuais else None,
        "plano_alimentar_ativo": (plan or {}).get("content"),
    }
    # Persist & load chat history
    history = await db.consultorio_messages.find(
        {"session_id": session_id}, {"_id": 0}
    ).sort("created_at", 1).to_list(50)
    user_msg = {
        "id": str(uuid.uuid4()), "session_id": session_id, "nutricionista_id": user["id"],
        "patient_id": p["id"], "role": "user", "content": final_message,
        "action": payload.action,
        "created_at": iso(now_utc()),
    }
    await db.consultorio_messages.insert_one(user_msg)
    try:
        ai_text = await ai_consultorio_chat(session_id, final_message, patient_ctx, history)
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
        "repeticao": n.get("repeticao") or ("semanal" if n.get("weekdays") else "diario"),
        "intervalo_dias": n.get("intervalo_dias"), "data_unica": n.get("data_unica"), "ate": n.get("ate"),
        "canal": n.get("canal") or "app", "silencio_inicio": n.get("silencio_inicio"), "silencio_fim": n.get("silencio_fim"),
        "modelo": n.get("modelo"), "origem": n.get("origem"), "refeicao": n.get("refeicao"),
        "respondeu_em": n.get("respondeu_em"),
    }


def _hm(txt: Optional[str]) -> Optional[tuple]:
    try:
        h, m = str(txt).split(":")[:2]
        return int(h), int(m)
    except (ValueError, AttributeError):
        return None


def _proximo_lembrete(n: dict, from_dt: Optional[datetime] = None) -> Optional[datetime]:
    """Próximo disparo conforme a repetição; None = encerrado (data única passada ou passou do 'até')."""
    rep = n.get("repeticao") or ("semanal" if n.get("weekdays") else "diario")
    base = (from_dt or now_utc()).astimezone(TZ_BR)
    hour, minute = int(n.get("hour") or 0), int(n.get("minute") or 0)
    if rep == "unica":
        try:
            d = datetime.strptime(str(n.get("data_unica"))[:10], "%Y-%m-%d").replace(hour=hour, minute=minute, tzinfo=TZ_BR)
        except ValueError:
            return None
        return d.astimezone(timezone.utc) if d > base else None
    if rep == "intervalo":
        passo = int(n.get("intervalo_dias") or 1)
        ultimo = n.get("last_fired_at")
        if ultimo:
            cand = datetime.fromisoformat(str(ultimo)).astimezone(TZ_BR).replace(hour=hour, minute=minute, second=0, microsecond=0) + timedelta(days=passo)
            while cand <= base:
                cand += timedelta(days=passo)
        else:
            cand = base.replace(hour=hour, minute=minute, second=0, microsecond=0)
            if cand <= base:
                cand += timedelta(days=1)
        prox = cand.astimezone(timezone.utc)
    else:
        prox = _compute_next_run(hour, minute, n.get("weekdays") if rep == "semanal" else None, from_dt=from_dt)
    if n.get("ate"):
        try:
            limite = datetime.strptime(str(n["ate"])[:10], "%Y-%m-%d").replace(hour=23, minute=59, tzinfo=TZ_BR)
            if prox.astimezone(TZ_BR) > limite:
                return None
        except ValueError:
            pass
    return prox


def _no_silencio(n: dict, quando: datetime) -> Optional[datetime]:
    """Se cair no horário de silêncio, devolve o fim do silêncio (próximo disparo); senão None."""
    ini, fim = _hm(n.get("silencio_inicio")), _hm(n.get("silencio_fim"))
    if not ini or not fim:
        return None
    local = quando.astimezone(TZ_BR)
    minutos = local.hour * 60 + local.minute
    a, b = ini[0] * 60 + ini[1], fim[0] * 60 + fim[1]
    dentro = (a <= minutos < b) if a < b else (minutos >= a or minutos < b)
    if not dentro:
        return None
    alvo = local.replace(hour=fim[0], minute=fim[1], second=0, microsecond=0)
    if alvo <= local:
        alvo += timedelta(days=1)
    return alvo.astimezone(timezone.utc)

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
    ).sort("created_at", 1).to_list(100)
    # última resposta do paciente (mensagem dele no atendimento) para "respondeu?" / "sem resposta há X dias"
    ultima = await db.patient_messages.find_one({"patient_id": pid, "role": "user"}, {"_id": 0, "created_at": 1}, sort=[("created_at", -1)])
    resp = (ultima or {}).get("created_at")
    out = []
    for n in rows:
        v = _nudge_view(n)
        v["respondeu_em"] = resp if resp and n.get("last_fired_at") and str(resp) > str(n["last_fired_at"]) else None
        out.append(v)
    return out


@api.get("/acompanhamento/lembretes")
async def acompanhamento_lembretes(user=Depends(require_nutritionist)):
    """Central de lembretes de todos os pacientes: enviados, respostas e quem está sem responder."""
    nudges = await db.patient_nudges.find({"nutricionista_id": user["id"]}, {"_id": 0}).to_list(2000)
    pids = list({n["patient_id"] for n in nudges})
    pacs = {p["id"]: p for p in await db.patients.find({"id": {"$in": pids}}, {"_id": 0, "id": 1, "nome": 1, "telefone": 1}).to_list(None)}
    ultimas = {}
    async for m in db.patient_messages.aggregate([
        {"$match": {"patient_id": {"$in": pids}, "role": "user"}},
        {"$group": {"_id": "$patient_id", "ultima": {"$max": "$created_at"}}},
    ]):
        ultimas[m["_id"]] = m["ultima"]
    por_paciente = {}
    for n in nudges:
        pid = n["patient_id"]
        if pid not in pacs:
            continue
        item = por_paciente.setdefault(pid, {"paciente_id": pid, "nome": pacs[pid].get("nome"), "telefone": pacs[pid].get("telefone"),
                                              "ativos": 0, "ultimo_envio": None, "ultima_resposta": ultimas.get(pid), "lembretes": []})
        if n.get("active"):
            item["ativos"] += 1
        if n.get("last_fired_at") and str(n["last_fired_at"]) > str(item["ultimo_envio"] or ""):
            item["ultimo_envio"] = n["last_fired_at"]
        item["lembretes"].append({"id": n["id"], "label": n.get("label"), "active": n.get("active"), "last_fired_at": n.get("last_fired_at"), "origem": n.get("origem")})
    out = list(por_paciente.values())
    for it in out:
        it["sem_resposta"] = bool(it["ultimo_envio"] and not (it["ultima_resposta"] and str(it["ultima_resposta"]) > str(it["ultimo_envio"])))
    out.sort(key=lambda x: (not x["sem_resposta"], str(x["ultimo_envio"] or "")), reverse=False)
    return out


@api.get("/acompanhamento/formularios")
async def acompanhamento_formularios(user=Depends(require_nutritionist)):
    """Pré-consultas e retornos: enviados, respondidos e pendentes (com reenviar na tela)."""
    pacs = await db.patients.find({"nutricionista_id": user["id"]}, {"_id": 0, "id": 1, "nome": 1, "telefone": 1, "formulario": 1,
                                                                     "preconsulta_enviada_em": 1, "status_funil": 1, "lead_token": 1, "created_at": 1}).to_list(None)
    out = []
    for p in pacs:
        f = _estado_formulario(p)
        out.append({"paciente_id": p["id"], "nome": p.get("nome"), "telefone": p.get("telefone"), "lead_token": p.get("lead_token"),
                    "tipo": f.get("tipo"), "estado": f.get("estado"), "enviado_em": f.get("enviado_em") or p.get("created_at"),
                    "respondido_em": f.get("respondido_em"), "status_funil": p.get("status_funil")})
    out.sort(key=lambda x: (x["estado"] == "respondido", str(x["respondido_em"] or x["enviado_em"] or "")), reverse=False)
    return out


class LembretesRefeicaoIn(BaseModel):
    ativo: bool = True
    minutos_antes: int = Field(default=15, ge=0, le=120)
    canal: Optional[str] = "app"


async def _sincronizar_lembretes_refeicao(pid: str) -> int:
    """'Antes de cada refeição': um lembrete X min antes de cada horário da dieta mais recente; refeito quando o plano muda."""
    p = await db.patients.find_one({"id": pid}, {"_id": 0, "lembretes_refeicao": 1, "nutricionista_id": 1}) or {}
    cfg = p.get("lembretes_refeicao") or {}
    await db.patient_nudges.delete_many({"patient_id": pid, "origem": "plano"})
    if not cfg.get("ativo"):
        return 0
    plano = await db.planos_manuais.find_one({"paciente_id": pid}, {"_id": 0}, sort=[("atualizado_em", -1), ("criado_em", -1)])
    criados = 0
    for ref in (plano or {}).get("refeicoes") or []:
        hm = _hm(ref.get("horario"))
        if not hm:
            continue
        total = hm[0] * 60 + hm[1] - int(cfg.get("minutos_antes") or 0)
        total %= 24 * 60
        nome = (ref.get("nome") or "refeição").strip()
        doc = {"id": str(uuid.uuid4()), "patient_id": pid, "nutricionista_id": p.get("nutricionista_id"),
               "label": f"Antes: {nome}", "trigger_text": f"Lembrar o paciente de que daqui a {cfg.get('minutos_antes')} minutos é hora de {nome} ({ref.get('horario')}), com o que está no plano.",
               "hour": total // 60, "minute": total % 60, "weekdays": None, "active": True, "last_fired_at": None,
               "repeticao": "diario", "canal": cfg.get("canal") or "app", "origem": "plano", "refeicao": nome, "created_at": iso(now_utc())}
        doc["next_run_at"] = iso(_proximo_lembrete(doc))
        await db.patient_nudges.insert_one(doc)
        criados += 1
    return criados


@api.put("/patients/{pid}/nudges-refeicoes")
async def configurar_lembretes_refeicao(pid: str, payload: LembretesRefeicaoIn, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    await db.patients.update_one({"id": pid}, {"$set": {"lembretes_refeicao": payload.model_dump()}})
    return {"ok": True, "criados": await _sincronizar_lembretes_refeicao(pid)}


class PreviaLembreteIn(BaseModel):
    trigger_text: str = Field(min_length=3, max_length=1000)


@api.post("/patients/{pid}/nudges-previa")
async def previa_lembrete(pid: str, payload: PreviaLembreteIn, user=Depends(require_nutritionist)):
    """Prévia da mensagem que a IA vai mandar (não envia nem salva)."""
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    try:
        texto = await ai_patient_proactive(f"previa-{pid}-{uuid.uuid4().hex[:6]}", payload.trigger_text, await _patient_context_for_nudge(pid))
    except Exception as e:
        raise HTTPException(503, f"IA indisponível agora: {str(e)[:120]}")
    return {"mensagem": texto}

@api.post("/patients/{pid}/nudges")
async def create_nudge(pid: str, payload: NudgeIn, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    nid = str(uuid.uuid4())
    doc = {
        "id": nid, "patient_id": pid, "nutricionista_id": user["id"],
        "label": payload.label[:120], "trigger_text": payload.trigger_text[:1000],
        "hour": payload.hour, "minute": payload.minute, "weekdays": payload.weekdays,
        "active": payload.active, "last_fired_at": None, "created_at": iso(now_utc()),
        **{k: getattr(payload, k) for k in ("repeticao", "intervalo_dias", "data_unica", "ate", "canal", "silencio_inicio", "silencio_fim", "modelo")},
    }
    prox = _proximo_lembrete(doc)
    doc["next_run_at"] = iso(prox) if prox else None
    if not prox:
        doc["active"] = False
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
    upd = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None or k in ("ate", "weekdays", "silencio_inicio", "silencio_fim")}
    if any(k in upd for k in ("hour", "minute", "weekdays", "repeticao", "intervalo_dias", "data_unica", "ate")) or upd.get("active") is True:
        prox = _proximo_lembrete({**existing, **upd})
        upd["next_run_at"] = iso(prox) if prox else None
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
                adiar = _no_silencio(nudge, now)
                if adiar:
                    await db.patient_nudges.update_one({"id": nudge["id"]}, {"$set": {"next_run_at": iso(adiar)}})
                    continue
                logging.info(f"Firing nudge {nudge['id']} for patient {nudge['patient_id']}")
                text = await _fire_nudge(nudge)
                depois = {**nudge, "last_fired_at": iso(now) if text else nudge.get("last_fired_at")}
                next_run = _proximo_lembrete(depois, from_dt=now)
                await db.patient_nudges.update_one(
                    {"id": nudge["id"]},
                    {"$set": {
                        "last_fired_at": depois["last_fired_at"],
                        "next_run_at": iso(next_run) if next_run else None,
                        **({} if next_run else {"active": False}),
                    }},
                )
        except Exception:
            logging.exception("nudge_scheduler_loop error")
        await followups_se_for_hora()
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
    dobras = dict(data.get("dobras") or {})
    # A tela grava "tricipital"; as fórmulas de %G usam "triceps".
    if dobras.get("tricipital") is not None and dobras.get("triceps") is None:
        dobras["triceps"] = dobras["tricipital"]
    perimetria = data.get("perimetria") or {}
    bioimp = data.get("bioimpedancia") or {}

    # IMC
    h = altura_cm / 100
    imc = round(peso / (h**2), 2)
    imc_class, imc_ref = _classif_imc(imc, idade, gestante, ig_semanas)

    # Peso ideal
    pi_min, pi_max = _peso_ideal(altura_cm)

    # %MG via dobras
    # %MG pelo protocolo escolhido (10 protocolos da planilha, em protocolos_dobras.py)
    pct_mg = pct_mg_class = densidade = aviso_protocolo = None
    if protocolo_dobras:
        calc = protd.calcular(protocolo_dobras, "M" if sexo_num == 1 else "F", idade, peso, altura_cm, dobras, perimetria)
        pct_mg, densidade, aviso_protocolo = calc["pct_gordura"], calc["densidade"], calc["aviso_idade"]
        if pct_mg is not None:
            pct_mg_class = _classif_pct_mg(pct_mg, sexo_num)

    bio_pct = _coerce_float(bioimp.get("pct_gordura"))
    bio_massa_magra = _coerce_float(bioimp.get("massa_magra_kg"))
    bio_massa_gorda = _coerce_float(bioimp.get("massa_gorda_kg"))
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
    elif massa_gorda is None and bio_massa_gorda is not None:
        massa_gorda = round(bio_massa_gorda, 2)
        massa_magra = round(peso - massa_gorda, 2)
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

    # Peso ósseo (Von Döbeln modificada por Rocha, 1975): diâmetros de punho e fêmur em cm.
    diametros = data.get("diametros_osseos") or {}
    punho_cm = _coerce_float(diametros.get("punho"))
    femur_cm = _coerce_float(diametros.get("femur"))
    peso_osseo = peso_muscular = None
    if punho_cm and femur_cm:
        peso_osseo = round(3.02 * ((h ** 2) * (punho_cm / 100) * (femur_cm / 100) * 400) ** 0.712, 2)
        if massa_gorda is not None:
            peso_muscular = round(peso - (massa_gorda + peso_osseo + peso_residual), 2)

    result = {
        "peso_osseo": peso_osseo, "peso_muscular": peso_muscular,
        "imc": imc, "imc_classificacao": imc_class, "imc_referencia": imc_ref,
        "peso_ideal_min": pi_min, "peso_ideal_max": pi_max,
        "pct_gordura": pct_mg, "pct_gordura_classificacao": pct_mg_class,
        "massa_gorda": massa_gorda, "pct_massa_magra": pct_magra,
        "massa_magra": massa_magra, "peso_residual": peso_residual,
        "protocolo_dobras": protocolo_dobras,
        "densidade_corporal": densidade, "aviso_protocolo": aviso_protocolo,
        "tmb_mifflin": tmb_mifflin, "tmb": tmb, "tmb_protocolo": protocolo_tmb,
        "naf": naf, "fi": fi, "get_kcal": get_kcal,
        "ic": ic, "ic_classificacao": ic_class,
        "rcq": rcq, "rcq_risco": rcq_risco,
        "amb": amb, "agb": agb,
        # gestacional
        "ig_semanas": ig_semanas,
        "imc_gestacional_classificacao": _classif_imc_gestacional(imc, ig_semanas) if (gestante and ig_semanas) else None,
        "bioimpedancia": {
            key: _coerce_float(value)
            for key, value in bioimp.items()
            if _coerce_float(value) is not None
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
    data_avaliacao: Optional[str] = None
    retorno: bool = False
    sexo_num: Optional[int] = None
    gestante: bool = False
    ig_semanas: Optional[int] = None
    protocolo_dobras: Optional[str] = None
    protocolo_mg: str = "siri"
    protocolo_tmb: str = "mifflin_st_jeor"
    dobras: Optional[dict] = None
    perimetria: Optional[dict] = None
    diametros_osseos: Optional[dict] = None
    bioimpedancia: Optional[dict] = None
    gestacional: Optional[dict] = None
    nivel_atividade: Optional[float] = None
    naf_codigo: Optional[int] = 2
    naf_manual: Optional[float] = None
    fi_codigo: Optional[int] = None
    fi_manual: Optional[float] = None
    objetivo: str = "manutencao"
    mlg_kg: Optional[float] = None
    # modelo usado nesta avaliação (etiqueta; trocar o modelo do paciente não recalcula as antigas)
    modelo_avaliacao: Optional[Literal["rc", "donatto"]] = None
    # Donatto: protocolo escolhido, % de gordura alvo etc. (calculado na tela, guardado como foi visto)
    donatto: Optional[dict] = None

# ── Clinical calculation endpoints ──────────────────────────────

@api.post("/calculos/tmb")
async def preview_tmb(payload: TmbPreviewIn, user=Depends(get_current_user)):
    try:
        val = _tmb_all(payload.protocolo, payload.peso, payload.altura_cm, payload.idade, payload.sexo_num, payload.mlg_kg)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"tmb": val, "protocolo": payload.protocolo, "descricao": PROTOCOLOS_TMB_DESCRICAO.get(payload.protocolo, payload.protocolo)}

@api.post("/calculos/tmb-todas")
async def preview_tmb_todas(payload: TmbPreviewIn, user=Depends(get_current_user)):
    """Todas as equações de TMB lado a lado (Gasto Energético numa tela só). As que pedem MLG voltam sem valor
    quando a massa magra não foi informada."""
    saida = []
    for cod, nome in PROTOCOLOS_TMB_DESCRICAO.items():
        try:
            val = _tmb_all(cod, payload.peso, payload.altura_cm, payload.idade, payload.sexo_num, payload.mlg_kg)
            saida.append({"protocolo": cod, "nome": nome, "tmb": val, "requer_mlg": cod in ("cunningham", "tinsley_mlg")})
        except (ValueError, KeyError, TypeError):
            saida.append({"protocolo": cod, "nome": nome, "tmb": None, "requer_mlg": True})
    return saida

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

@api.get("/referencias/protocolos-dobras")
async def get_protocolos_dobras_ref(user=Depends(get_current_user)):
    return protd.lista_publica()

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
    """Organiza as anamneses antigas nos blocos do formulário (não apaga nenhum campo antigo)."""
    migradas = 0
    pids = await db.anamneses.distinct("paciente_id", {"formulario_versao": {"$ne": 2}})
    for pid in pids:
        if await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]}, {"_id": 1}):
            await _anamnese_principal(pid)
            migradas += 1
    return {"ok": True, "updated": migradas}

class AnamneseFormIn(BaseModel):
    respostas: dict = {}
    outras: Optional[dict] = None

@api.patch("/patients/{pid}/anamnese-form")
async def patch_anamnese_form(pid: str, payload: AnamneseFormIn, user=Depends(require_nutritionist)):
    """Edição da anamnese pelo nutricionista (salva sozinha): resposta vazia apaga a resposta."""
    if not await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]}, {"_id": 1}):
        raise HTTPException(404, "Paciente não encontrado")
    respostas = {k: _limpar_resposta(v) for k, v in (payload.respostas or {}).items() if k in af.PERGUNTAS}
    return await _salvar_formulario(pid, user["id"], respostas, apagar_vazios=True, outras=payload.outras) or {}

@api.get("/patients/{pid}/anamnese-v2")
async def get_anamnese_v2(pid: str, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    anam = await _anamnese_principal(pid)
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
    updated = await _anamnese_principal(pid)
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

@api.post("/calculos/composicao-preview")
async def preview_composicao(payload: EvaluationV2In, user=Depends(require_nutritionist)):
    """Resultado ao vivo da Nova avaliação (mesma conta que salva, sem gravar)."""
    try:
        return calc_bodycomp_v2(payload.model_dump())
    except (ValueError, ZeroDivisionError, TypeError) as e:
        raise HTTPException(400, f"Não foi possível calcular: {e}")


# ── Fotos por avaliação (frente, lado e costas) ─────────────────────────────
_POSES_FOTO = ("frente", "lado", "costas")


class FotoAvaliacaoIn(BaseModel):
    pose: Literal["frente", "lado", "costas"]
    data_url: str


@api.get("/patients/{pid}/fotos-avaliacoes")
async def listar_fotos_avaliacoes(pid: str, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    return await db.avaliacao_fotos.find({"paciente_id": pid}, {"_id": 0}).to_list(None)


@api.put("/patients/{pid}/evaluations/{eid}/fotos")
async def salvar_foto_avaliacao(pid: str, eid: str, payload: FotoAvaliacaoIn, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    if not await db.evaluations.find_one({"id": eid, "paciente_id": pid}):
        raise HTTPException(404, "Avaliação não encontrada")
    if not payload.data_url.startswith("data:image/") or len(payload.data_url) > 4_500_000:
        raise HTTPException(400, "Envie uma imagem de até 3 MB")
    doc = {"id": str(uuid.uuid4()), "paciente_id": pid, "avaliacao_id": eid, "pose": payload.pose,
           "data_url": payload.data_url, "enviado_em": iso(now_utc())}
    await db.avaliacao_fotos.delete_many({"paciente_id": pid, "avaliacao_id": eid, "pose": payload.pose})
    await db.avaliacao_fotos.insert_one(dict(doc))
    return doc


@api.delete("/patients/{pid}/evaluations/{eid}/fotos/{pose}")
async def apagar_foto_avaliacao(pid: str, eid: str, pose: str, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    await db.avaliacao_fotos.delete_many({"paciente_id": pid, "avaliacao_id": eid, "pose": pose})
    return {"ok": True}


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
    await db.avaliacao_fotos.delete_many({"paciente_id": pid, "avaliacao_id": eid})
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

async def _sincronizar_base_alimentos():
    """Grava a TABELA ENXUTA no banco e arquiva o resto (uma vez por versao) sem segurar o boot do servidor."""
    try:
        resumo = await sincronizar_base(db)
        if resumo:
            _equiv_cache.update(ts=0.0, foods=[])
    except Exception:
        logging.exception("Falha ao sincronizar a base de alimentos")

class AlimentoCustomIn(BaseModel):
    nome: str
    categoria: str = "Outros"
    porcao_padrao_g: float = 100
    medida_caseira: str = "100g"
    por_100g: dict

class SuplementoIn(BaseModel):
    nome: str
    marca: Optional[str] = None
    categoria: str = "Suplementos"
    dose_padrao: Optional[float] = None
    unidade: str = "g"
    objetivo: Optional[str] = None
    composicao: dict = {}
    observacoes: Optional[str] = None

class FormulaItemIn(BaseModel):
    tipo: str = "alimento"
    item_id: Optional[str] = None
    nome: str
    quantidade: float = 0
    unidade: str = "g"
    nutrientes: dict = {}

class FormulaIn(BaseModel):
    nome: str
    categoria: str = "Formula"
    rendimento: Optional[float] = None
    unidade_rendimento: str = "porcao"
    itens: List[FormulaItemIn] = []
    modo_preparo: Optional[str] = None
    observacoes: Optional[str] = None

_GRUPOS_ALIMENTARES = [
    "Carnes e Proteínas",
    "Cereais, Raízes, Tubérculos e Frutos",
    "Feijão e Leguminosas",
    "Frutas",
    "Frutas Oleosas",
    "Leite e Derivados",
    "Livre",
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

# ── Líquidos em ml (ajuste ml1 do Rogério) ──────────────────────────────────
# Tipo líquido e densidade (g/ml): o que estiver gravado no alimento vale; senão, pelo nome. Sem densidade = 1 g/ml.
_LIQUIDOS = [
    (r"^(leite|bebida lactea|bebida láctea)(?!.*\b(po|pó|condensado|em p|ninho)\b)", 1.03),
    (r"^(iogurte|kefir|coalhada)", 1.03),
    (r"^(suco|refresco|néctar|nectar)|, suco\b|\bsuco\b", 1.04),
    (r"^(agua|água) de coco|^coco, água", 1.02),
    (r"^(cafe|café)(?!.*\b(po|pó)\b)|^(cha|chá)\b", 1.0),
    (r"^(azeite|oleo|óleo)\b", 0.92),
    (r"^(caldo|sopa)\b", 1.0),
]
MEDIDAS_ML = [("Colher de sopa", 15), ("Copo americano", 150), ("Copo médio", 240), ("Copo grande", 300),
              ("Caneca", 300), ("Garrafa", 200)]


def _liquido_info(alim: dict) -> Optional[dict]:
    """{'densidade': g/ml} quando o alimento é líquido; None para sólido."""
    if alim.get("liquido") is False:
        return None
    dens = _coerce_float(alim.get("densidade"))
    if alim.get("liquido") is True:
        return {"densidade": dens or 1.0}
    nome = str(alim.get("nome_original") or alim.get("nome") or "").lower().strip()
    for rx, d in _LIQUIDOS:
        if re.search(rx, nome):
            return {"densidade": dens or d}
    return None


def _medidas_liquido(alim: dict, dens: float) -> list[dict]:
    """Medidas em ml (gramas = ml × densidade). Azeite/óleo: colher de sopa ≈ 13 ml."""
    oleo = bool(re.search(r"^(azeite|oleo|óleo)", str(alim.get("nome") or "").lower()))
    out = [{"nome": "ml", "gramas": round(dens, 4), "ml": 1}]
    for nome, ml in MEDIDAS_ML:
        ml_r = 13 if (oleo and nome == "Colher de sopa") else ml
        out.append({"nome": f"{nome} ({ml_r} ml)", "gramas": round(ml_r * dens, 1), "ml": ml_r})
    return out


def _medidas_do_alimento(alim: dict) -> list[dict]:
    """Medidas caseiras do alimento: as gravadas no documento pela sincronizacao da base (planilha EVONUT +
    IBGE); para alimentos sem isso (cadastrados pelo nutricionista), a planilha pelo nome."""
    liq = _liquido_info(alim)
    if liq:
        # líquido: unidade base ml (+ gramas para planos antigos); as medidas antigas em gramas não entram
        return _medidas_liquido(alim, liq["densidade"]) + [{"nome": "Gramas", "gramas": 1.0}]
    measures = [{"nome": "Gramas", "gramas": 1.0}]
    base_measure = alim.get("medida_caseira")
    base_grams = _coerce_float(alim.get("porcao_padrao_g") or alim.get("quantidade_referencia_g"))
    if base_measure and base_grams:
        measures.append({"nome": str(base_measure), "gramas": round(base_grams, 2)})
    gravadas = alim.get("medidas_caseiras")
    origem = gravadas if isinstance(gravadas, list) else _get_measures_for_food_name(alim.get("nome_original") or alim.get("nome", ""))
    for m in origem:
        if m.get("nome") and m["nome"].strip().lower() not in {x["nome"].strip().lower() for x in measures}:
            measures.append({"nome": m["nome"], "gramas": m.get("gramas"), **({"estimada": True} if m.get("estimada") else {})})
    return measures

def _resolve_quantidade_g(alimento: dict, medida_nome: Optional[str], quantidade: Optional[float], quantidade_g: Optional[float]) -> float:
    grams_direct = _coerce_float(quantidade_g)
    if grams_direct is not None and grams_direct > 0:
        return round(grams_direct, 2)
    qty = _coerce_float(quantidade) or 0.0
    medida = (medida_nome or "").strip().lower()
    if not medida or medida == "gramas":
        return round(qty, 2)
    for item in _medidas_do_alimento(alimento):
        if item["nome"].strip().lower() == medida:
            return round((_coerce_float(item.get("gramas")) or 0) * qty, 2)
    return round(qty, 2)

async def _resolve_alimento_light_by_name(nome: str) -> Optional[dict]:
    if not nome:
        return None
    projection = {"_id": 0, "id": 1, "nome": 1, "grupo": 1, "categoria": 1, "fonte": 1, "porcao_padrao_g": 1, "quantidade_referencia_g": 1, "nutrientes": 1, "por_100g": 1}
    ativo = {"arquivado": {"$ne": True}}
    exact = await db.alimentos.find_one({**ativo, "nome": {"$regex": f"^{re.escape(nome)}$", "$options": "i"}}, projection)
    if exact:
        return exact
    token = re.sub(r"[^a-zA-Z0-9 ]+", " ", nome).strip().split()
    if not token:
        return None
    prefix = " ".join(token[:3])
    candidates = await db.alimentos.find({**ativo, "nome": {"$regex": re.escape(prefix), "$options": "i"}}, projection).limit(25).to_list(25)
    target_norm = _normalize_food_lookup(nome)
    for cand in candidates:
        cand_norm = _normalize_food_lookup(cand.get("nome", ""))
        if cand_norm == target_norm or cand_norm in target_norm or target_norm in cand_norm:
            return cand
    return candidates[0] if candidates else None

@api.get("/alimentos/grupos")
async def list_grupos(user=Depends(require_nutritionist)):
    return _GRUPOS_ALIMENTARES

_ACENTOS_BUSCA = {"a": "aáàâãä", "e": "eéèêë", "i": "iíìîï", "o": "oóòôõö", "u": "uúùûü", "c": "cç"}

def _regex_sem_acento(q: str) -> str:
    """'pao' casa com 'Pão': cada vogal/c vira uma classe com as variantes acentuadas."""
    base = unicodedata.normalize("NFD", q.strip().lower())
    base = "".join(ch for ch in base if unicodedata.category(ch) != "Mn")
    return "".join(f"[{_ACENTOS_BUSCA[ch]}]" if ch in _ACENTOS_BUSCA else re.escape(ch) for ch in base)

_PALAVRAS_VAZIAS_BUSCA = {"de", "da", "do", "das", "dos", "e", "a", "o", "com", "em", "ao", "na", "no", "para"}

def _tokens_busca(q: str) -> list[str]:
    """'banana prata' -> ['banana', 'prata']; 'pão de forma' -> ['pao', 'forma'] (sem acento e sem 'de/com/e')."""
    tokens = _normalize_food_lookup(q).split()
    uteis = [t for t in tokens if t not in _PALAVRAS_VAZIAS_BUSCA]
    return uteis or tokens

def _regex_tokens(tokens: list[str], ancorar_primeiro: bool = False) -> str:
    """Todas as palavras em qualquer posicao (lookaheads), cada uma aceitando acento: casa 'Banana, prata, crua'."""
    regex = "^" + "".join(f"(?=.*{_regex_sem_acento(t)})" for t in tokens)
    return regex + (_regex_sem_acento(tokens[0]) if ancorar_primeiro and tokens else "")

def _rank_busca(nome: str, q_norm: str, tokens: Optional[list] = None, fonte: Optional[str] = None) -> tuple:
    """Comeca com a frase > comeca com a 1a palavra > frase no inicio de uma palavra > o resto; palavra
    inteira antes de pedaco ("Arroz, branco" antes de "Arrozina"); marcas depois; empate em ordem alfabetica."""
    n = _normalize_food_lookup(nome)
    primeira = (tokens or q_norm.split() or [""])[0]
    if n.startswith(q_norm):
        nivel = 0
    elif n.startswith(primeira):
        nivel = 1
    elif f" {q_norm}" in f" {n}":
        nivel = 2
    else:
        nivel = 3
    inteira = re.search(rf"(^|\s){re.escape(primeira)}(\s|$)", n) is not None
    marca = "®" in nome or "™" in nome  # produtos de marca depois dos alimentos genericos
    return (nivel, not inteira, marca, _PRIORIDADE_FONTE.get(fonte, 9), n)

# TACO e IBGE primeiro (nomes simples, com medidas caseiras); TBCA traz nomes cientificos longos
_PRIORIDADE_FONTE = {"TACO": 0, "IBGE": 1, "Tucunduva": 2, "TBCA": 3, "Meus Alimentos": 4}

@api.get("/alimentos")
async def search_alimentos(
    q: str = "",
    grupo: str = "",
    categoria: str = "",
    fonte: str = "",
    page: int = 1,
    limit: int = 50,
    ordenar: str = "",
    tabelas: str = "",
    user=Depends(require_nutritionist),
):
    filt: dict = {"arquivado": {"$ne": True}}
    relevancia = ordenar == "relevancia" and q.strip()
    tokens = _tokens_busca(q) if relevancia else []
    if relevancia:
        filt["nome"] = {"$regex": _regex_tokens(tokens), "$options": "i"}
    elif q:
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
        # Base TABELA ENXUTA (nao arquivada) + alimentos do nutricionista
        filt["$or"] = [
            {"nutricionista_id": {"$exists": False}},
            {"nutricionista_id": user["id"]},
        ]
    # "Tabela de alimentos consultada" da configuracao da dieta (vazio = todas)
    sel = {t.strip() for t in tabelas.split(",") if t.strip()}
    if sel:
        fontes = [f for f in ("TACO", "IBGE", "TBCA", "Tucunduva") if f in sel]
        ors = [{"fonte": {"$in": fontes}, "nutricionista_id": {"$exists": False}}] if fontes else []
        if "Meus" in sel:
            ors += [{"fonte": "Meus Alimentos", "nutricionista_id": {"$exists": False}}, {"nutricionista_id": user["id"]}]
        if ors:
            filt.pop("fonte", None)
            filt.pop("nutricionista_id", None)
            filt["$or"] = ors
    skip = (page - 1) * limit
    if relevancia:
        # Editor da dieta: primeiro o que comeca com o termo, depois inicio de palavra, depois o resto.
        # Ordena so com id+nome (leve) e busca o documento completo apenas dos escolhidos: no Render
        # gratuito, trazer ~1.800 documentos com 36 nutrientes a cada tecla deixava a busca "presa".
        q_norm = _normalize_food_lookup(q)
        leve = {"_id": 0, "id": 1, "nome": 1, "fonte": 1}
        filt_prefixo = {**filt, "nome": {"$regex": _regex_tokens(tokens, ancorar_primeiro=True), "$options": "i"}}
        prefixo = await db.alimentos.find(filt_prefixo, leve).sort("nome", 1).limit(300).to_list(300)
        geral = await db.alimentos.find(filt, leve).sort("nome", 1).limit(800).to_list(800)
        vistos, candidatos = set(), []
        for a in prefixo + geral:
            if a.get("id") not in vistos:
                vistos.add(a.get("id"))
                candidatos.append(a)
        candidatos.sort(key=lambda a: _rank_busca(a.get("nome", ""), q_norm, tokens, a.get("fonte")))
        # mesmo nome em varias tabelas: mostra so o da tabela preferida (TACO, IBGE...), que vem primeiro
        nomes_vistos, unicos = set(), []
        for a in candidatos:
            chave_nome = _normalize_food_lookup(a.get("nome", ""))
            if chave_nome not in nomes_vistos:
                nomes_vistos.add(chave_nome)
                unicos.append(a)
        candidatos = unicos
        escolhidos = [a["id"] for a in candidatos[:limit]]
        completos = {d["id"]: d async for d in db.alimentos.find({"id": {"$in": escolhidos}}, {"_id": 0})}
        docs = [completos[i] for i in escolhidos if i in completos]
        total = len(candidatos)
    else:
        total = await db.alimentos.count_documents(filt)
        # padrao alfabetico; "planilha" = ordem em que o Rogerio organizou a TABELA ENXUTA
        ordem = [("ordem_planilha", 1), ("nome", 1)] if ordenar == "planilha" else [("nome", 1)]
        docs = await db.alimentos.find(filt, {"_id": 0}).sort(ordem).skip(skip).limit(limit).to_list(limit)
    items = []
    for a in docs:
        # Normaliza campos de display para ambos os formatos (evonut e legado TACO/CUSTOM)
        m100 = _macros_100g(a)
        a["sodio_mg_100g"] = _nutri_100g(a)["sodio_mg"]
        a["categoria_app"] = categoria_app(a)
        a.pop("nutrientes", None)
        a.pop("por_100g", None)
        a["energia_kcal_100g"] = m100["kcal"]
        a["macros_100g"] = m100
        a["grupo_display"] = a.get("grupo") or a.get("categoria")
        liq = _liquido_info(a)
        a["liquido"] = bool(liq)
        a["densidade"] = liq["densidade"] if liq else None
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
    grupos = await _grupos_do_nutri(user["id"])
    liq = _liquido_info(doc)
    return {"alimento_id": aid, "alimento_nome": doc.get("nome"), "medidas": _medidas_do_alimento(doc),
            "grupo_substituicao": _grupo_do_alimento(doc, grupos),
            "liquido": bool(liq), "densidade": liq["densidade"] if liq else None}


class LiquidoIn(BaseModel):
    liquido: bool
    densidade: Optional[float] = Field(default=None, gt=0.3, lt=2.5)


@api.patch("/alimentos/{aid}/liquido")
async def definir_liquido(aid: str, payload: LiquidoIn, user=Depends(require_nutritionist)):
    """Tipo do alimento (sólido em g / líquido em ml) e densidade em g/ml (ex.: leite desnatado 1,03)."""
    doc = await db.alimentos.find_one({"id": aid}, {"_id": 0, "id": 1})
    if not doc:
        raise HTTPException(404, "Alimento não encontrado")
    await db.alimentos.update_one({"id": aid}, {"$set": {"liquido": payload.liquido, "densidade": payload.densidade}})
    return {"ok": True, "liquido": payload.liquido, "densidade": payload.densidade}

@api.get("/alimentos/{aid}/equivalentes")
async def get_alimento_equivalentes(aid: str, user=Depends(require_nutritionist)):
    doc = await db.alimentos.find_one({"id": aid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Alimento não encontrado")
    entry = _find_equivalente_entry(doc.get("nome_original") or doc.get("nome", ""))
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

# ---------- Motor de equivalentes (substituicoes calculadas) ----------
_FRUTA_PREFIXOS = (
    "abacaxi", "acerola", "amora", "ameixa", "banana", "caju", "caqui", "carambola", "cereja", "cupua", "damasco",
    "figo", "framboesa", "goiaba", "graviola", "jabuticaba", "jaca", "kiwi", "laranja", "lichia", "lima", "limao",
    "maca", "mamao", "manga", "maracuja", "melancia", "melao", "mexerica", "mirtilo", "morango", "nectarina",
    "pera", "pessego", "pitanga", "pitaya", "roma", "tamara", "tangerina", "uva", "acai", "atemoia", "pinha",
    "caja", "seriguela", "umbu", "buriti", "mangaba", "bacuri", "jambo", "sapoti", "cacau",
)
_EQUIV_KIND_POR_GRUPO = {
    "Carnes e Proteínas": "proteina",
    "Leite e Derivados": "laticinio",
    "Frutas": "fruta",
    "Frutas Oleosas": "gordura",
    "Vegetais A (livres para o consumo)": "vegetal",
    "Vegetais B": "vegetal",
    "Livre": "vegetal",
    "Livres": "vegetal",
    "Óleos e Gorduras": "gordura",
    "Oleaginosas e Sementes": "oleaginosa",
    "Pães e Variedades": "carbo",
    "Feijão e Leguminosas": "leguminosa",
    "Sucos Naturais e Integrais": "suco",
    "Fibras A": "fibra",
    "Fibras B": "fibra",
}
_EQUIV_KIND_POR_PAPEL = {"ptn": ["proteina", "laticinio"], "cho": ["carbo", "fruta"], "lip": ["gordura", "oleaginosa"]}
_EQUIV_FONTE_PESO = {"TACO": 0.0, "TBCA": 0.3, "IBGE": 0.5, "Tucunduva": 0.9}
_EQUIV_PROCESSADO = re.compile(r"industrializ|frit[oa]|empanad|com a[cç][uú]car|em calda|ao molho|recheado|doce de|refrigerante|bisnaguinha|salgadinho|biscoito recheado")
_equiv_cache: dict = {"ts": 0.0, "foods": []}


def _macros_100g(doc: dict) -> dict:
    """Macros por 100 g nos dois formatos (EVONUT e legado TACO/CUSTOM)."""
    fator = 1.0  # EVONUT: nutrientes ja por 100 g
    if "nutrientes" in doc:
        n = doc.get("nutrientes") or {}
        vals = (n.get("energia_kcal"), n.get("proteina_g"), n.get("carboidrato_g"), n.get("lipideos_g"), n.get("fibra_g"))
    else:
        p = doc.get("por_100g") or {}
        fator = 1.0
        vals = (p.get("energia_kcal"), p.get("proteinas_g"), p.get("carboidratos_g"), p.get("lipidios_g"), p.get("fibras_g"))
    out = {}
    for key, value in zip(("kcal", "ptn", "cho", "lip", "fib"), vals):
        num = _coerce_float(value)
        out[key] = round(num * fator, 2) if num is not None else None
    return out


def _equiv_papel(m: dict) -> Optional[str]:
    kcal = (m.get("ptn") or 0) * 4 + (m.get("cho") or 0) * 4 + (m.get("lip") or 0) * 9
    if kcal <= 0:
        return None
    shares = {"ptn": (m.get("ptn") or 0) * 4 / kcal, "cho": (m.get("cho") or 0) * 4 / kcal, "lip": (m.get("lip") or 0) * 9 / kcal}
    return max(shares, key=shares.get)


def _equiv_shares(m: dict) -> tuple:
    kcal = (m.get("ptn") or 0) * 4 + (m.get("cho") or 0) * 4 + (m.get("lip") or 0) * 9
    if kcal <= 0:
        return (0.0, 0.0, 0.0)
    return ((m.get("ptn") or 0) * 4 / kcal, (m.get("cho") or 0) * 4 / kcal, (m.get("lip") or 0) * 9 / kcal)


_EQUIV_KIND_POR_NOME = [
    ("vegetal", ("abobrinha", "alface", "agriao", "acelga", "almeirao", "berinjela", "beterraba", "brocolis", "cebola",
                 "cenoura", "chicoria", "chuchu", "couve", "espinafre", "jilo", "maxixe", "palmito", "pepino", "pimentao",
                 "quiabo", "rabanete", "repolho", "rucula", "tomate", "vagem", "aspargo", "cogumelo", "champignon",
                 "alcachofra", "abobora", "moranga", "salsa", "cebolinha", "coentro", "nabo", "seleta de legumes")),
    ("leguminosa", ("feijao", "lentilha", "grao de bico", "ervilha", "soja", "tremoco", "fava")),
    ("laticinio", ("leite", "iogurte", "queijo", "requeijao", "ricota", "cottage", "coalhada", "kefir", "mussarela", "muçarela")),
    ("proteina", ("frango", "carne", "bovin", "peixe", "file", "atum", "sardinha", "tilapia", "salmao", "ovo", "peru",
                  "porco", "suin", "lombo", "camarao", "presunto", "patinho", "alcatra", "fraldinha", "acem", "whey",
                  "tofu", "pescada", "merluza", "bacalhau", "corvina", "linguado", "cacao", "lagarto", "musculo")),
    ("gordura", ("azeite", "oleo", "manteiga", "margarina", "banha", "abacate", "coco")),
    ("oleaginosa", ("castanha", "amendoim", "noz", "nozes", "amendoa", "avela", "pistache", "macadamia", "linhaca",
                    "chia", "gergelim", "semente", "pasta de amendoim")),
    ("carbo", ("arroz", "macarrao", "massa", "batata", "mandioca", "aipim", "macaxeira", "inhame", "cara ", "cuscuz",
               "tapioca", "aveia", "milho", "quinoa", "pao", "farinha", "cereal", "granola", "torrada", "biscoito",
               "bolacha", "polenta", "nhoque", "cevada", "rap10", "wrap")),
]


def _equiv_kind_por_nome(nome_norm: str) -> Optional[str]:
    cabeca = " ".join(nome_norm.split()[:3])
    if nome_norm.startswith(_FRUTA_PREFIXOS):
        return "fruta"
    for kind, chaves in _EQUIV_KIND_POR_NOME:
        if any(cabeca.startswith(k) or f" {k}" in f" {cabeca}" for k in chaves):
            return kind
    return None


def _equiv_kind(doc: dict, m: dict) -> Optional[str]:
    grupo = doc.get("grupo") or doc.get("categoria")
    nome = _normalize_food_lookup(doc.get("nome", ""))
    if grupo in (None, "", "Outros", "Cereais, Raízes, Tubérculos e Frutos"):
        por_nome = _equiv_kind_por_nome(nome)
        if por_nome:
            return por_nome
        if grupo == "Cereais, Raízes, Tubérculos e Frutos":
            return "carbo"
        return None  # sem pista: classificado so pelo papel do macro predominante
    return _EQUIV_KIND_POR_GRUPO.get(grupo) or _equiv_kind_por_nome(nome)


async def _equiv_foods() -> list[dict]:
    """Catalogo leve em memoria (recarrega a cada 1h). Exclui marcas e alimentos customizados."""
    import time as _time
    if _equiv_cache["foods"] and _time.time() - _equiv_cache["ts"] < 3600:
        return _equiv_cache["foods"]
    foods = []
    async for doc in db.alimentos.find({"nutricionista_id": {"$exists": False}, "arquivado": {"$ne": True}}, {"_id": 0}):
        nome = doc.get("nome") or ""
        if "®" in nome:
            continue
        m = _macros_100g(doc)
        if not m.get("kcal"):
            continue
        foods.append({
            "id": doc.get("id"), "nome": nome, "grupo": doc.get("grupo") or doc.get("categoria"),
            "fonte": doc.get("fonte"), "m": m, "kind": _equiv_kind(doc, m), "papel": _equiv_papel(m),
            "shares": _equiv_shares(m), "norm": _normalize_food_lookup(nome),
            "medidas": [x for x in _medidas_do_alimento(doc) if x["nome"] != "Gramas"],
        })
    _equiv_cache.update(ts=_time.time(), foods=foods)
    return foods


def _equiv_medida(medidas: list, gramas: float) -> Optional[dict]:
    """Escolhe a medida caseira que da um numero 'redondo' (0,5 a 6 unidades) para a quantidade."""
    melhor = None
    for med in medidas:
        g = _coerce_float(med.get("gramas"))
        if not g or g <= 0:
            continue
        qtd = round((gramas / g) * 2) / 2
        if qtd < 0.5 or qtd > 6:
            continue
        erro = abs(qtd * g - gramas) / gramas
        if melhor is None or erro < melhor[0]:
            melhor = (erro, {"nome": med["nome"], "quantidade": qtd, "gramas": round(qtd * g, 1)})
    return melhor[1] if melhor else None


async def _compute_equivalentes(base: dict, quantidade_g: float, q: str = "", limit: int = 15) -> dict:
    mb = _macros_100g(base)
    base_kcal = (mb.get("kcal") or 0) * quantidade_g / 100
    papel = _equiv_papel(mb)
    kind = _equiv_kind(base, mb)
    if not kind and papel:
        kinds = _EQUIV_KIND_POR_PAPEL.get(papel, [])
    else:
        kinds = [kind] if kind else []
    por_peso = kind == "vegetal" or (mb.get("kcal") or 0) <= 40  # vegetais trocam por peso, nao por kcal
    base_norm = _normalize_food_lookup(base.get("nome", ""))
    base_misto = " com " in f" {base_norm} "
    base_shares = _equiv_shares(mb)
    filtro = _normalize_food_lookup(q) if q else ""
    candidatos = []
    for f in await _equiv_foods():
        if f["id"] == base.get("id") or f["norm"] == base_norm:
            continue
        if filtro:
            if filtro not in f["norm"]:
                continue
        elif f["kind"] not in kinds:
            continue
        distancia = sum(abs(a - b) for a, b in zip(base_shares, f["shares"]))
        if not filtro and f["papel"] != papel and distancia > 0.35:
            continue
        kcal100 = f["m"]["kcal"] or 0
        gramas = quantidade_g if por_peso else (base_kcal / kcal100 * 100 if kcal100 else 0)
        gramas = round(gramas / 5) * 5 if gramas >= 20 else round(gramas, 1)
        if gramas <= 0 or gramas > 600:
            continue
        score = distancia * 10 + _EQUIV_FONTE_PESO.get(f["fonte"], 1.2) + len(f["nome"]) / 45
        if _EQUIV_PROCESSADO.search(f["norm"]):
            score += 1.2
        if not base_misto and (" com " in f" {f['norm']} " or f["norm"] in ("tabule", "salpicao", "farofa")):
            score += 1.5  # prato pronto como troca de alimento simples
        if re.match(r"(farinha|amido|fecula|polvilho)", f["norm"]) and not re.match(r"(farinha|amido|fecula|polvilho)", base_norm):
            score += 2.0  # ingrediente de preparo, nao alimento pronto
        if f["kind"] in ("proteina", "carbo", "leguminosa") and re.search(r"\bcru[a]?\b", f["norm"]):
            score += 1.0  # prefere a forma pronta para consumo
        candidatos.append((score, f, gramas))
    candidatos.sort(key=lambda c: c[0])
    vistos, saida = set(), []
    for score, f, gramas in candidatos:
        chave = " ".join(f["norm"].split()[:2])  # evita 10 variacoes do mesmo alimento
        if chave in vistos and not filtro:
            continue
        vistos.add(chave)
        fator = gramas / 100
        macros = {k: round((f["m"].get(k) or 0) * fator, 1) for k in ("kcal", "ptn", "cho", "lip", "fib")}
        base_q = {k: round((mb.get(k) or 0) * quantidade_g / 100, 1) for k in ("kcal", "ptn", "cho", "lip")}
        saida.append({
            "alimento_id": f["id"], "nome": f["nome"], "grupo": f["grupo"], "fonte": f["fonte"],
            "quantidade_g": gramas, "medida": _equiv_medida(f["medidas"], gramas), "macros": macros,
            "macros_100g": f["m"],
            "diferenca": {k: round(macros[k] - base_q[k], 1) for k in ("ptn", "cho", "lip")},
            "similaridade": max(0, round(100 - score * 8)),
        })
        if len(saida) >= limit:
            break
    return {
        "base": {
            "alimento_id": base.get("id"), "nome": base.get("nome"), "quantidade_g": quantidade_g,
            "grupo": base.get("grupo") or base.get("categoria"), "tipo": kind or (f"papel_{papel}" if papel else None),
            "macros": {k: round((mb.get(k) or 0) * quantidade_g / 100, 1) for k in ("kcal", "ptn", "cho", "lip", "fib")},
        },
        "criterio": "mesmo peso" if por_peso else "mesmas calorias",
        "equivalentes": saida,
    }


@api.get("/alimentos/{aid}/equivalentes-calculados")
async def get_equivalentes_calculados(
    aid: str, quantidade_g: float = 100, q: str = "", limit: int = 15, user=Depends(require_nutritionist),
):
    doc = await db.alimentos.find_one({"id": aid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Alimento nao encontrado")
    return await _compute_equivalentes(doc, max(1.0, float(quantidade_g)), q.strip(), max(1, min(limit, 40)))

# ---------- Grupos de substituição (itens 9 a 12 dos ajustes do Rogério) ----------
# Cada grupo troca por um critério (kcal ou o macro principal), tem porção de referência, 4 a 6 opções padrão
# com medida caseira e tolerância (±10%). Padrões A CONFIRMAR com o Rogério; o nutricionista edita em
# Configurações da dieta › Grupos de substituição.
GRUPOS_SUBSTITUICAO_PADRAO = [
    {"id": "paes_tuberculos", "nome": "Pães e tubérculos", "criterio": "cho", "tipos": ["carbo"],
     "referencia": {"alimento_id": "402", "quantidade_g": 100},
     "opcoes": ["392", "709", "3679", "4762", "6280", "3828"]},
    {"id": "frutas", "nome": "Frutas", "criterio": "cho", "tipos": ["fruta", "suco"],
     "referencia": {"alimento_id": "585", "quantidade_g": 80},
     "opcoes": ["3671", "3800", "4267", "3390", "6445", "4059"]},
    {"id": "proteinas", "nome": "Proteínas animais", "criterio": "ptn", "tipos": ["proteina"],
     "referencia": {"alimento_id": "2913", "quantidade_g": 100},
     "opcoes": ["1701", "1694", "6588", "5720", "4555"]},
    {"id": "laticinios", "nome": "Laticínios", "criterio": "ptn", "tipos": ["laticinio"],
     "referencia": {"alimento_id": "3524", "quantidade_g": 200},
     "opcoes": ["3259", "5396", "5450", "5479", "6575"]},
    {"id": "leguminosas", "nome": "Leguminosas", "criterio": "cho", "tipos": ["leguminosa"],
     "referencia": {"alimento_id": "2661", "quantidade_g": 100},
     "opcoes": ["2682", "3551", "3076", "2667", "2511"]},
    {"id": "gorduras", "nome": "Gorduras e oleaginosas", "criterio": "lip", "tipos": ["gordura", "oleaginosa"],
     "referencia": {"alimento_id": "505", "quantidade_g": 10},
     "opcoes": ["6", "1837", "4387", "302", "6576", "3901"]},
    {"id": "vegetais", "nome": "Vegetais", "criterio": "kcal", "tipos": ["vegetal"],
     "referencia": {"alimento_id": "1198", "quantidade_g": 100},
     "opcoes": ["68", "1884", "2088", "2250", "6468", "828"]},
]
_CRITERIOS_GRUPO = ("kcal", "cho", "ptn", "lip")


def _grupos_padrao() -> list[dict]:
    return [{"id": g["id"], "nome": g["nome"], "criterio": g["criterio"], "tolerancia_pct": 10, "tipos": list(g["tipos"]),
             "referencia": dict(g["referencia"]), "opcoes": [{"alimento_id": a} for a in g["opcoes"]]}
            for g in GRUPOS_SUBSTITUICAO_PADRAO]


async def _grupos_do_nutri(user_id: str) -> list[dict]:
    doc = await db.grupos_substituicao.find_one({"nutricionista_id": user_id}, {"_id": 0})
    return (doc or {}).get("grupos") or _grupos_padrao()


async def _enriquecer_grupos(grupos: list[dict]) -> list[dict]:
    """Junta nome, macros por 100 g e medidas caseiras de cada alimento (referência e opções)."""
    ids = {str(g.get("referencia", {}).get("alimento_id")) for g in grupos} | {str(o.get("alimento_id")) for g in grupos for o in g.get("opcoes", [])}
    docs = {d["id"]: d async for d in db.alimentos.find({"id": {"$in": [i for i in ids if i]}}, {"_id": 0})}

    def info(aid):
        d = docs.get(str(aid))
        if not d:
            return None
        return {"alimento_id": d["id"], "nome": d.get("nome"), "macros_100g": _macros_100g(d), "medidas": _medidas_do_alimento(d)}

    saida = []
    for g in grupos:
        ref = g.get("referencia") or {}
        ref_info = info(ref.get("alimento_id"))
        opcoes = [o2 for o2 in ({**o, **(info(o.get("alimento_id")) or {})} for o in g.get("opcoes", [])) if o2.get("nome")]
        saida.append({**g, "referencia": {**ref, **(ref_info or {})} if ref_info else None, "opcoes": opcoes})
    return saida


def _grupo_do_alimento(doc: dict, grupos: list[dict]) -> Optional[str]:
    aid = str(doc.get("id"))
    for g in grupos:
        if aid == str((g.get("referencia") or {}).get("alimento_id")) or any(aid == str(o.get("alimento_id")) for o in g.get("opcoes", [])):
            return g["id"]
    m = _macros_100g(doc)
    kind = _equiv_kind(doc, m)
    if not kind:
        papel = _equiv_papel(m)
        kind = {"ptn": "proteina", "cho": "carbo", "lip": "gordura"}.get(papel)
    for g in grupos:
        if kind and kind in (g.get("tipos") or []):
            return g["id"]
    return None


class GrupoOpcaoIn(BaseModel):
    alimento_id: str
    medida_nome: Optional[str] = None


class GrupoReferenciaIn(BaseModel):
    alimento_id: str
    quantidade_g: float = Field(gt=0, le=2000)
    medida_nome: Optional[str] = None


class GrupoSubstituicaoIn(BaseModel):
    id: Optional[str] = None
    nome: str = Field(min_length=1, max_length=80)
    criterio: str = "kcal"
    tolerancia_pct: float = Field(default=10, ge=1, le=50)
    tipos: List[str] = []
    referencia: GrupoReferenciaIn
    opcoes: List[GrupoOpcaoIn] = []


class GruposSubstituicaoIn(BaseModel):
    grupos: List[GrupoSubstituicaoIn]


@api.get("/dieta/grupos-substituicao")
async def get_grupos_substituicao(user=Depends(require_nutritionist)):
    return await _enriquecer_grupos(await _grupos_do_nutri(user["id"]))


@api.put("/dieta/grupos-substituicao")
async def put_grupos_substituicao(payload: GruposSubstituicaoIn, user=Depends(require_nutritionist)):
    grupos = []
    for g in payload.grupos[:20]:
        if g.criterio not in _CRITERIOS_GRUPO:
            raise HTTPException(400, f"Critério inválido no grupo {g.nome}")
        gid = re.sub(r"[^a-z0-9_]+", "_", _normalize_food_lookup(g.id or g.nome)).strip("_")[:40] or str(uuid.uuid4())[:8]
        vistos, opcoes = set(), []
        for o in g.opcoes[:12]:
            if o.alimento_id not in vistos and o.alimento_id != g.referencia.alimento_id:
                vistos.add(o.alimento_id)
                opcoes.append({"alimento_id": o.alimento_id, **({"medida_nome": o.medida_nome} if o.medida_nome else {})})
        grupos.append({"id": gid, "nome": g.nome.strip(), "criterio": g.criterio, "tolerancia_pct": g.tolerancia_pct,
                       "tipos": [t for t in g.tipos if t][:6], "referencia": g.referencia.model_dump(exclude_none=True), "opcoes": opcoes})
    await db.grupos_substituicao.update_one({"nutricionista_id": user["id"]},
                                            {"$set": {"grupos": grupos, "atualizado_em": iso(now_utc())}}, upsert=True)
    return await _enriquecer_grupos(grupos)


@api.post("/dieta/grupos-substituicao/restaurar")
async def restaurar_grupos_substituicao(user=Depends(require_nutritionist)):
    await db.grupos_substituicao.delete_one({"nutricionista_id": user["id"]})
    return await _enriquecer_grupos(_grupos_padrao())


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

def _csv_num(value: Any, default: float = 0.0) -> float:
    if value is None:
        return default
    raw = str(value).strip().replace(".", "").replace(",", ".") if "," in str(value) else str(value).strip()
    try:
        return float(raw)
    except Exception:
        return default

def _csv_first(row: dict, *names: str) -> str:
    lowered = {str(k).strip().lower(): v for k, v in row.items()}
    for name in names:
        value = lowered.get(name.lower())
        if value not in (None, ""):
            return str(value).strip()
    return ""

@api.get("/suplementos")
async def list_suplementos(q: str = "", categoria: str = "", page: int = 1, limit: int = 80, user=Depends(require_nutritionist)):
    filt = {"nutricionista_id": user["id"]}
    if q:
        filt["nome"] = {"$regex": q, "$options": "i"}
    if categoria:
        filt["categoria"] = {"$regex": categoria, "$options": "i"}
    skip = max(0, page - 1) * limit
    total = await db.suplementos.count_documents(filt)
    items = await db.suplementos.find(filt, {"_id": 0}).sort("nome", 1).skip(skip).limit(limit).to_list(limit)
    return {"total": total, "page": page, "limit": limit, "items": items}

@api.post("/suplementos", status_code=201)
async def create_suplemento(payload: SuplementoIn, user=Depends(require_nutritionist)):
    doc = {
        "id": str(uuid.uuid4()),
        **payload.model_dump(),
        "fonte": "CUSTOM",
        "nutricionista_id": user["id"],
        "criado_em": iso(now_utc()),
        "atualizado_em": iso(now_utc()),
    }
    await db.suplementos.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}

@api.put("/suplementos/{sid}")
async def update_suplemento(sid: str, payload: SuplementoIn, user=Depends(require_nutritionist)):
    existing = await db.suplementos.find_one({"id": sid})
    if not existing:
        raise HTTPException(404, "Suplemento nao encontrado")
    if existing.get("nutricionista_id") != user["id"]:
        raise HTTPException(403, "Sem permissao")
    await db.suplementos.update_one({"id": sid}, {"$set": {**payload.model_dump(), "atualizado_em": iso(now_utc())}})
    return await db.suplementos.find_one({"id": sid}, {"_id": 0})

@api.delete("/suplementos/{sid}")
async def delete_suplemento(sid: str, user=Depends(require_nutritionist)):
    res = await db.suplementos.delete_one({"id": sid, "nutricionista_id": user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Suplemento nao encontrado")
    return {"ok": True}

@api.get("/formulas")
async def list_formulas(q: str = "", categoria: str = "", page: int = 1, limit: int = 80, user=Depends(require_nutritionist)):
    filt = {"nutricionista_id": user["id"]}
    if q:
        filt["nome"] = {"$regex": q, "$options": "i"}
    if categoria:
        filt["categoria"] = {"$regex": categoria, "$options": "i"}
    skip = max(0, page - 1) * limit
    total = await db.formulas.count_documents(filt)
    items = await db.formulas.find(filt, {"_id": 0}).sort("nome", 1).skip(skip).limit(limit).to_list(limit)
    return {"total": total, "page": page, "limit": limit, "items": items}

@api.post("/formulas", status_code=201)
async def create_formula(payload: FormulaIn, user=Depends(require_nutritionist)):
    doc = {
        "id": str(uuid.uuid4()),
        **payload.model_dump(),
        "fonte": "CUSTOM",
        "nutricionista_id": user["id"],
        "criado_em": iso(now_utc()),
        "atualizado_em": iso(now_utc()),
    }
    await db.formulas.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}

@api.put("/formulas/{fid}")
async def update_formula(fid: str, payload: FormulaIn, user=Depends(require_nutritionist)):
    existing = await db.formulas.find_one({"id": fid})
    if not existing:
        raise HTTPException(404, "Formula nao encontrada")
    if existing.get("nutricionista_id") != user["id"]:
        raise HTTPException(403, "Sem permissao")
    await db.formulas.update_one({"id": fid}, {"$set": {**payload.model_dump(), "atualizado_em": iso(now_utc())}})
    return await db.formulas.find_one({"id": fid}, {"_id": 0})

@api.delete("/formulas/{fid}")
async def delete_formula(fid: str, user=Depends(require_nutritionist)):
    res = await db.formulas.delete_one({"id": fid, "nutricionista_id": user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Formula nao encontrada")
    return {"ok": True}

@api.post("/cadastros/importar-csv", status_code=201)
async def importar_cadastros_csv(tipo: str = Query(...), file: UploadFile = File(...), user=Depends(require_nutritionist)):
    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(400, "Envie um CSV autorizado")
    raw = await file.read()
    if len(raw) > 8 * 1024 * 1024:
        raise HTTPException(400, "Arquivo maior que 8MB")
    text = raw.decode("utf-8-sig", errors="ignore")
    rows = list(csv.DictReader(io.StringIO(text), delimiter=";" if text.splitlines()[0].count(";") >= text.splitlines()[0].count(",") else ","))
    if not rows:
        raise HTTPException(400, "CSV vazio")
    created = updated = skipped = 0
    now = iso(now_utc())
    for row in rows[:5000]:
        nome = _csv_first(row, "nome", "alimento", "produto", "suplemento", "formula")
        if not nome:
            skipped += 1
            continue
        if tipo == "alimentos":
            por_100g = {
                "energia_kcal": _csv_num(_csv_first(row, "energia_kcal", "kcal", "calorias")),
                "proteinas_g": _csv_num(_csv_first(row, "proteinas_g", "proteina_g", "proteina")),
                "carboidratos_g": _csv_num(_csv_first(row, "carboidratos_g", "carboidrato_g", "carboidrato")),
                "lipidios_g": _csv_num(_csv_first(row, "lipidios_g", "gorduras_g", "lipideos_g", "gordura")),
                "fibras_g": _csv_num(_csv_first(row, "fibras_g", "fibra")),
                "sodio_mg": _csv_num(_csv_first(row, "sodio_mg", "sodio")),
            }
            doc = {
                "nome": nome,
                "categoria": _csv_first(row, "categoria", "grupo") or "Importados",
                "fonte": "CUSTOM",
                "nutricionista_id": user["id"],
                "porcao_padrao_g": _csv_num(_csv_first(row, "porcao_padrao_g", "porcao_g", "gramas"), 100),
                "medida_caseira": _csv_first(row, "medida_caseira", "medida") or "100 g",
                "por_100g": por_100g,
                "atualizado_em": now,
            }
            existing = await db.alimentos.find_one({"nutricionista_id": user["id"], "nome": {"$regex": f"^{re.escape(nome)}$", "$options": "i"}})
            if existing:
                await db.alimentos.update_one({"id": existing["id"]}, {"$set": doc})
                updated += 1
            else:
                await db.alimentos.insert_one({"id": str(uuid.uuid4()), **doc, "criado_em": now})
                created += 1
        elif tipo == "suplementos":
            doc = {
                "nome": nome,
                "marca": _csv_first(row, "marca"),
                "categoria": _csv_first(row, "categoria", "grupo") or "Suplementos",
                "dose_padrao": _csv_num(_csv_first(row, "dose_padrao", "dose", "quantidade")),
                "unidade": _csv_first(row, "unidade") or "g",
                "objetivo": _csv_first(row, "objetivo", "indicacao"),
                "observacoes": _csv_first(row, "observacoes", "obs"),
                "composicao": {
                    "energia_kcal": _csv_num(_csv_first(row, "energia_kcal", "kcal")),
                    "proteinas_g": _csv_num(_csv_first(row, "proteinas_g", "proteina")),
                    "carboidratos_g": _csv_num(_csv_first(row, "carboidratos_g", "carboidrato")),
                    "lipidios_g": _csv_num(_csv_first(row, "lipidios_g", "gordura")),
                },
                "fonte": "CUSTOM",
                "nutricionista_id": user["id"],
                "atualizado_em": now,
            }
            existing = await db.suplementos.find_one({"nutricionista_id": user["id"], "nome": {"$regex": f"^{re.escape(nome)}$", "$options": "i"}})
            if existing:
                await db.suplementos.update_one({"id": existing["id"]}, {"$set": doc})
                updated += 1
            else:
                await db.suplementos.insert_one({"id": str(uuid.uuid4()), **doc, "criado_em": now})
                created += 1
        else:
            raise HTTPException(400, "Tipo suportado: alimentos ou suplementos")
    return {"ok": True, "tipo": tipo, "created": created, "updated": updated, "skipped": skipped, "total_rows": len(rows)}

# ── Plano Alimentar Manual ────────────────────────────────────────

def _nutrientes_por_porcao(alimento: dict, quantidade_g: float) -> dict:
    # No formato EVONUT os nutrientes estao sempre por 100 g. Em alguns itens ("Meus Alimentos")
    # quantidade_referencia_g guarda a porcao (ex.: whey 30 g), e usa-lo como base inflava os valores.
    ref_g = 100.0 if "nutrientes" in alimento else (alimento.get("quantidade_referencia_g", 100.0) or 100.0)
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
    # alimento_id vazio = alimento digitado livremente (sem calculo), como no NutriDiet
    alimento_id: Optional[str] = None
    nome: Optional[str] = None
    quantidade_g: Optional[float] = None
    medida_nome: Optional[str] = "Gramas"
    quantidade: Optional[float] = None
    substituivel: bool = True
    substitutos: List[dict] = []
    observacao: Optional[str] = None
    ajustavel: bool = False  # marcado com ⇅: o botão "Ajustar à meta" recalcula os gramas dele

class OpcaoRefeicaoPlano(BaseModel):
    """Opcao "OU" de uma refeicao: nao entra no total do dia."""
    observacao: Optional[str] = None
    alimentos: List[AlimentoPlanoItem] = []

class RefeicaoPlano(BaseModel):
    nome: str = ""
    horario: Optional[str] = None
    meta_kcal: Optional[float] = None
    meta_pct: Optional[float] = None
    observacao: Optional[str] = None
    alimentos: List[AlimentoPlanoItem] = []
    opcoes: List[OpcaoRefeicaoPlano] = []

class ListaSubstituicaoPlano(BaseModel):
    nome: str = ""
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
    estrategia: Optional[str] = None
    meta_kcal: Optional[float] = None
    meta_proteina_g: Optional[float] = None
    meta_carboidrato_g: Optional[float] = None
    meta_lipidio_g: Optional[float] = None
    prescricao_dietetica: Optional[dict] = None
    orientacao_ids: List[str] = []
    refeicoes: List[RefeicaoPlano] = []
    observacoes: Optional[str] = None
    recomendacoes: List[dict] = []          # [{titulo, texto}] - "Observacoes da dieta"
    planejamento: Optional[dict] = None     # metas: kcal, pct_*, kcal_kg, *_gkg
    listas_substituicao: List[ListaSubstituicaoPlano] = []
    ciclo_tipo: Optional[str] = None        # dieta de um tipo do ciclo: alto|medio|baixo|fase1..fase4

class PlanoTemplateIn(BaseModel):
    nome: str
    categoria: Optional[str] = None
    descricao: Optional[str] = None
    objetivo: Optional[str] = None
    estrategia: Optional[str] = None
    meta_kcal: Optional[float] = None
    meta_proteina_g: Optional[float] = None
    meta_carboidrato_g: Optional[float] = None
    meta_lipidio_g: Optional[float] = None
    prescricao_dietetica: Optional[dict] = None
    orientacao_ids: List[str] = []
    refeicoes: List[RefeicaoPlano] = []
    observacoes: Optional[str] = None
    recomendacoes: List[dict] = []
    planejamento: Optional[dict] = None
    listas_substituicao: List[ListaSubstituicaoPlano] = []

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
    # resumo para a lista "Modelos de dieta": kcal do dia (1ª opção de cada refeição) e nº de refeições
    kcal = 0.0
    for ref in doc.get("refeicoes") or []:
        _, totais = await _enrich_itens_plano(ref.get("alimentos", []))
        kcal += totais.get("energia_kcal", 0) or 0
    return {**doc, "orientacoes": orientacoes, "categoria": (doc.get("categoria") or "").strip() or None,
            "resumo": {"kcal": round(kcal), "refeicoes": len(doc.get("refeicoes") or [])}}

_TOTAIS_PLANO = ["energia_kcal", "proteinas_g", "carboidratos_g", "lipidios_g", "fibras_g", "sodio_mg"]

async def _enrich_itens_plano(itens: list) -> tuple[list, dict]:
    """Calcula cada item (kcal por Atwater 4/4/9, como o NutriDiet) e soma os totais do bloco."""
    alimentos_out = []
    totais = {k: 0.0 for k in _TOTAIS_PLANO}
    for item in itens or []:
        alim = await db.alimentos.find_one({"id": item.get("alimento_id")}, {"_id": 0}) if item.get("alimento_id") else None
        if not alim:
            # alimento digitado livremente: aparece no plano, mas sem calculo
            if (item.get("nome") or "").strip():
                alimentos_out.append({**item, "alimento_id": None, "alimento_nome": item.get("nome"), "medidas": [],
                                      "macros_100g": None, "nutrientes": {k: 0.0 for k in _TOTAIS_PLANO}})
            continue
        resolved_g = _resolve_quantidade_g(alim, item.get("medida_nome"), item.get("quantidade"), item.get("quantidade_g"))
        nutr = _nutrientes_por_porcao(alim, resolved_g)
        nutr["energia_kcal"] = round(nutr.get("proteinas_g", 0) * 4 + nutr.get("carboidratos_g", 0) * 4 + nutr.get("lipidios_g", 0) * 9, 2)
        for k in totais:
            totais[k] = round(totais[k] + nutr.get(k, 0), 2)
        alimentos_out.append({
            **item,
            "quantidade_g": resolved_g,
            "quantidade": _coerce_float(item.get("quantidade")) if item.get("quantidade") is not None else resolved_g,
            "medida_nome": item.get("medida_nome") if item.get("medida_nome") is not None else "Gramas",
            "nome": item.get("nome") or alim.get("nome", ""),
            "alimento_nome": alim.get("nome", ""),
            "grupo": alim.get("grupo") or alim.get("categoria"),
            "medidas": _medidas_do_alimento(alim),
            "macros_100g": _macros_100g(alim),
            "nutrientes": nutr,
        })
    return alimentos_out, totais

async def _enrich_plano(doc: dict) -> dict:
    refeicoes_out = []
    ref_rows = []
    totais_dia = {k: 0.0 for k in _TOTAIS_PLANO}
    metas_dia = {
        "energia_kcal": _coerce_float(doc.get("meta_kcal")),
        "proteinas_g": _coerce_float(doc.get("meta_proteina_g")),
        "carboidratos_g": _coerce_float(doc.get("meta_carboidrato_g")),
        "lipidios_g": _coerce_float(doc.get("meta_lipidio_g")),
    }
    for ref in doc.get("refeicoes", []):
        alimentos_out, totais_ref = await _enrich_itens_plano(ref.get("alimentos", []))
        opcoes_out = []
        for op in ref.get("opcoes") or []:
            op_alimentos, op_totais = await _enrich_itens_plano(op.get("alimentos", []))
            opcoes_out.append({**op, "alimentos": op_alimentos, "totais": op_totais})
        for k in totais_dia:
            totais_dia[k] = round(totais_dia[k] + totais_ref.get(k, 0), 2)
        meta_kcal = _coerce_float(ref.get("meta_kcal"))
        saldo_kcal = round(totais_ref["energia_kcal"] - meta_kcal, 2) if meta_kcal is not None else None
        ref_rows.append({**ref, "alimentos": alimentos_out, "opcoes": opcoes_out, "totais": totais_ref, "saldo_kcal": saldo_kcal})
    listas_out = []
    for lista in doc.get("listas_substituicao") or []:
        itens_lista, _ = await _enrich_itens_plano(lista.get("alimentos", []))
        listas_out.append({**lista, "alimentos": itens_lista})
    for ref in ref_rows:
        pct_dia = round((ref["totais"]["energia_kcal"] / totais_dia["energia_kcal"]) * 100, 1) if totais_dia["energia_kcal"] > 0 else None
        refeicoes_out.append({**ref, "pct_energia_dia": pct_dia})
    saldo_dia = {}
    for k, meta in metas_dia.items():
        saldo_dia[k] = round((totais_dia.get(k, 0) or 0) - meta, 2) if meta is not None else None
    orientacoes = await _resolve_orientacoes(doc.get("orientacao_ids") or [], doc.get("nutricionista_id"))
    return {**doc, "refeicoes": refeicoes_out, "listas_substituicao": listas_out, "totais_dia": totais_dia,
            "saldos_dia": saldo_dia, "orientacoes": orientacoes}

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
    # Abas na ordem do NutriDiet: posicao escolhida pelo nutricionista, depois ordem de criacao
    docs = [d async for d in db.planos_manuais.find({"paciente_id": pid}, {"_id": 0}).sort([("ordem", 1), ("criado_em", 1)])]
    return [await _enrich_plano(d) for d in docs]

async def _proxima_ordem_plano(pid: str) -> int:
    return await db.planos_manuais.count_documents({"paciente_id": pid})

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
        "estrategia": doc.get("estrategia"),
        "meta_kcal": doc.get("meta_kcal"),
        "meta_proteina_g": doc.get("meta_proteina_g"),
        "meta_carboidrato_g": doc.get("meta_carboidrato_g"),
        "meta_lipidio_g": doc.get("meta_lipidio_g"),
        "prescricao_dietetica": doc.get("prescricao_dietetica"),
        "orientacao_ids": doc.get("orientacao_ids") or [],
        "refeicoes": doc.get("refeicoes") or [],
        "observacoes": doc.get("observacoes"),
        "recomendacoes": doc.get("recomendacoes") or [],
        "planejamento": doc.get("planejamento"),
        "listas_substituicao": doc.get("listas_substituicao") or [],
        "origem_plano_id": pmid,
        "criado_em": now,
        "atualizado_em": now,
    }
    await db.plano_templates.insert_one(template)
    return await _enrich_plano_template({k: v for k, v in template.items() if k != "_id"})

@api.post("/patients/{pid}/plano-templates/{tid}/aplicar", status_code=201)
async def apply_plano_template(pid: str, tid: str, substituir: Optional[str] = None, user=Depends(require_nutritionist)):
    """Aplica um modelo de dieta: cria uma dieta nova ou, com `substituir=<id da dieta>`, troca o conteúdo da dieta
    aberta (título e posição ficam; a versão anterior vai para o histórico)."""
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    template = await db.plano_templates.find_one({"id": tid, "nutricionista_id": user["id"]}, {"_id": 0})
    if not template:
        raise HTTPException(404, "Template não encontrado")
    if substituir:
        atual = await db.planos_manuais.find_one({"id": substituir, "paciente_id": pid}, {"_id": 0})
        if not atual:
            raise HTTPException(404, "Dieta não encontrada")
        await _create_plano_snapshot(atual, "before_apply_template", user["id"])
        conteudo = {
            "objetivo": template.get("objetivo") or atual.get("objetivo"),
            "estrategia": template.get("estrategia"),
            "meta_kcal": template.get("meta_kcal"), "meta_proteina_g": template.get("meta_proteina_g"),
            "meta_carboidrato_g": template.get("meta_carboidrato_g"), "meta_lipidio_g": template.get("meta_lipidio_g"),
            "orientacao_ids": template.get("orientacao_ids") or [], "refeicoes": template.get("refeicoes") or [],
            "observacoes": template.get("observacoes"), "recomendacoes": template.get("recomendacoes") or [],
            "planejamento": template.get("planejamento"), "listas_substituicao": template.get("listas_substituicao") or [],
            "origem_template_id": tid, "atualizado_em": iso(now_utc()),
        }
        await db.planos_manuais.update_one({"id": substituir}, {"$set": conteudo})
        novo = await db.planos_manuais.find_one({"id": substituir}, {"_id": 0})
        return await _enrich_plano(novo)
    latest = await db.planos_manuais.find_one({"paciente_id": pid}, {"versao": 1}, sort=[("versao", -1)])
    now = iso(now_utc())
    doc = {
        "id": str(uuid.uuid4()),
        "paciente_id": pid,
        "nutricionista_id": user["id"],
        "titulo": template.get("nome") or "Plano Alimentar",
        "objetivo": template.get("objetivo"),
        "estrategia": template.get("estrategia"),
        "meta_kcal": template.get("meta_kcal"),
        "meta_proteina_g": template.get("meta_proteina_g"),
        "meta_carboidrato_g": template.get("meta_carboidrato_g"),
        "meta_lipidio_g": template.get("meta_lipidio_g"),
        # peso/altura/GET do modelo sao do paciente de origem; a tela usa os do paciente atual
        "prescricao_dietetica": {"estrategia": (template.get("prescricao_dietetica") or {}).get("estrategia")},
        "orientacao_ids": template.get("orientacao_ids") or [],
        "refeicoes": template.get("refeicoes") or [],
        "observacoes": template.get("observacoes"),
        "recomendacoes": template.get("recomendacoes") or [],
        "planejamento": template.get("planejamento"),
        "listas_substituicao": template.get("listas_substituicao") or [],
        "versao": int((latest or {}).get("versao") or 0) + 1,
        "ordem": await _proxima_ordem_plano(pid),
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
        "ordem": await _proxima_ordem_plano(pid),
        "criado_em": iso(now_utc()),
        "atualizado_em": iso(now_utc()),
    }
    await db.planos_manuais.insert_one(doc)
    await _create_plano_snapshot(doc, "create", user["id"])
    await _sincronizar_lembretes_refeicao(pid)  # 'antes de cada refeição' acompanha o plano
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
    await _sincronizar_lembretes_refeicao(pid)  # 'antes de cada refeição' acompanha o plano
    return await _enrich_plano(updated)

@api.get("/patients/{pid}/planos-manuais/{pmid}/historico")
async def list_plano_manual_historico(pid: str, pmid: str, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    return [d async for d in db.planos_manuais_historico.find(
        {"plano_id": pmid, "paciente_id": pid, "nutricionista_id": user["id"]},
        {"_id": 0}
    ).sort("criado_em", -1)]

@api.post("/patients/{pid}/planos-manuais/{pmid}/duplicar", status_code=201)
async def duplicate_plano_manual(pid: str, pmid: str, payload: Optional[dict] = None, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    doc = await db.planos_manuais.find_one({"id": pmid, "paciente_id": pid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Plano não encontrado")
    latest = await db.planos_manuais.find_one({"paciente_id": pid}, {"versao": 1}, sort=[("versao", -1)])
    titulo = str((payload or {}).get("titulo") or "").strip()[:140]
    clone = {
        **doc,
        "id": str(uuid.uuid4()),
        "titulo": titulo or f"{doc.get('titulo', 'Plano')} (cópia)",
        "versao": int((latest or {}).get("versao") or 0) + 1,
        "ordem": await _proxima_ordem_plano(pid),
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

def _drhouse_patient_context(patient: dict, anam: Optional[dict], evaluation: Optional[dict]) -> dict:
    evaluation = evaluation or {}
    perimetria = evaluation.get("perimetria") or {}
    composicao = evaluation.get("composicao") or {}
    cintura = perimetria.get("cintura") or evaluation.get("cintura")
    abdominal = perimetria.get("abdomen") or perimetria.get("abdominal")
    ctx = {
        "sexo": patient.get("sexo"),
        "idade_anos": _patient_age_years(patient),
        "peso_kg": evaluation.get("peso") or patient.get("peso"),
        "altura_cm": evaluation.get("altura") or patient.get("altura"),
        "imc": composicao.get("imc"),
        "percentual_gordura": composicao.get("pct_gordura") or composicao.get("percentual_gordura"),
        "circunferencia_cintura_cm": cintura,
        "circunferencia_abdominal_cm": abdominal,
        "data_ultima_avaliacao_fisica": evaluation.get("created_at"),
        "objetivo": patient.get("objetivo"),
    }
    ctx["anamnese"] = (af.contexto_clinico(anam) if anam else None) or None
    return {k: v for k, v in ctx.items() if v not in (None, "", [], {})}

def _drhouse_lotes_payload(lotes: list[dict]) -> list[dict]:
    out = []
    for lote in lotes:
        exames = []
        for exame in lote.get("exames") or []:
            exames.append({
                "exame": exame.get("nome"),
                "grupo": exame.get("grupo"),
                "valor": exame.get("valor"),
                "unidade": exame.get("unidade"),
                "classificacao_automatica": exame.get("classificacao"),
                "referencia": exame.get("referencia") or None,
            })
        out.append({
            "data_coleta": lote.get("data_coleta"),
            "laboratorio": lote.get("laboratorio"),
            "exames": exames,
        })
    return out

async def ai_drhouse_manual_exam_analysis(
    patient: dict,
    lotes: list[dict],
    longitudinal: dict,
    pergunta: Optional[str] = None,
    anam: Optional[dict] = None,
    evaluation: Optional[dict] = None,
) -> str:
    await ensure_agents_seeded()
    system_prompt = await build_agent_system_prompt("drhouse")
    patient_ctx = _drhouse_patient_context(patient, anam, evaluation)
    lotes_ctx = _drhouse_lotes_payload(lotes)
    tem_historico = len(lotes) > 1
    prompt = (
        "Analise os exames laboratoriais abaixo para suporte ao nutricionista.\n\n"
        f"CONTEXTO DO PACIENTE (campos ausentes nao foram informados):\n"
        f"{json.dumps(patient_ctx, ensure_ascii=False, default=str)}\n\n"
        "Estado de jejum na coleta: nao informado.\n\n"
        f"EXAMES ({len(lotes)} coleta(s), em ordem cronologica). O campo 'referencia' traz a faixa "
        "cadastrada no sistema; 'classificacao_automatica' e apenas uma triagem por faixa:\n"
        f"{json.dumps(lotes_ctx, ensure_ascii=False, default=str)[:30000]}\n\n"
    )
    if tem_historico:
        prompt += (
            "COMPARATIVO LONGITUDINAL (variacao entre a ultima coleta e a anterior):\n"
            f"{json.dumps(longitudinal.get('marcadores') or [], ensure_ascii=False, default=str)[:15000]}\n\n"
        )
    prompt += (
        f"PERGUNTA DO NUTRICIONISTA:\n{(pergunta or '').strip() or 'Gere a analise integrada completa.'}\n\n"
        "Siga o PROTOCOLO DE ANALISE e responda exatamente no FORMATO OBRIGATORIO DA RESPOSTA definido "
        "nas suas instrucoes, com todas as secoes na ordem. Na tabela VISAO GERAL DOS EXAMES use os exames "
        "da coleta mais recente"
        + (" e cite a evolucao em relacao as coletas anteriores nas secoes de alteracoes e correlacoes" if tem_historico else "")
        + ". Se a pergunta do nutricionista for especifica, responda-a dentro do RESUMO EXECUTIVO sem "
        "omitir as demais secoes."
    )
    return await _ai_chat(
        f"drhouse-manual-{patient.get('id')}-{uuid.uuid4().hex[:8]}",
        system_prompt,
        prompt,
        max_tokens=16384,
        temperature=0.3,
        timeout=180.0,
    )

_DRHOUSE_JSON_FORMATO = """Responda SOMENTE com um JSON válido (sem markdown, sem texto fora do JSON) neste formato:
{
  "resumo": "2 a 3 frases cruzando exame e anamnese",
  "pistas": [{"texto": "achado curto", "fonte": "exame|anamnese|recordatorio"}],
  "hipoteses": [{"texto": "hipótese", "certeza": 0-100, "status": "provavel|investigar|descartado", "porque": "1 frase"}],
  "perguntar": ["pergunta para confirmar com o paciente na consulta"],
  "prioridades": [{"codigo": "código do marcador", "nome": "nome", "interpretacao": "1 a 2 frases",
                   "acao": {"tipo": "conduta|medico", "texto": "linha de ação"}}],
  "condutas": ["conduta nutricional objetiva (alimentos, hábitos, horários)"],
  "repetir_em_dias": 90,
  "laudo_paciente": "texto para o paciente em linguagem simples, sem termos técnicos, 1 a 3 parágrafos"
}
Regras: no máximo 6 pistas, 4 hipóteses, 5 perguntas, 6 prioridades e 8 condutas. Prioridades = marcadores alterados
que pedem ação agora. Ação "medico" quando o achado precisa de avaliação/encaminhamento médico. NÃO sugira dose de
suplemento nem de medicamento (pode citar alimentos e hábitos). Não invente valores que não estão nos exames."""


async def ai_drhouse_estruturado(patient: dict, lotes: list[dict], longitudinal: dict, anam: Optional[dict] = None,
                                 evaluation: Optional[dict] = None, recordatorio: Optional[dict] = None) -> Optional[dict]:
    """Versão estruturada da análise (3 colunas, prioridades, condutas e laudo) para a tela de Exames."""
    await ensure_agents_seeded()
    system_prompt = await build_agent_system_prompt("drhouse")
    prompt = (
        "Analise os exames para a tela do nutricionista.\n\n"
        f"CONTEXTO DO PACIENTE:\n{json.dumps(_drhouse_patient_context(patient, anam, evaluation), ensure_ascii=False, default=str)}\n\n"
        f"RECORDATÓRIO MAIS RECENTE (totais do dia):\n{json.dumps((recordatorio or {}).get('totais_dia') or {}, ensure_ascii=False, default=str)[:2000]}\n\n"
        f"EXAMES:\n{json.dumps(_drhouse_lotes_payload(lotes), ensure_ascii=False, default=str)[:30000]}\n\n"
        f"EVOLUÇÃO:\n{json.dumps(longitudinal.get('marcadores') or [], ensure_ascii=False, default=str)[:12000]}\n\n"
        + _DRHOUSE_JSON_FORMATO
    )
    texto = await _ai_chat(f"drhouse-json-{patient.get('id')}-{uuid.uuid4().hex[:8]}", system_prompt, prompt,
                           max_tokens=6000, temperature=0.2, timeout=180.0)
    return _json_da_resposta(texto)


def _json_da_resposta(texto: str) -> Optional[dict]:
    if not texto:
        return None
    t = texto.strip()
    t = re.sub(r"^```(?:json)?|```$", "", t, flags=re.M).strip()
    ini, fim = t.find("{"), t.rfind("}")
    if ini < 0 or fim <= ini:
        return None
    try:
        dado = json.loads(t[ini:fim + 1])
    except json.JSONDecodeError:
        return None
    if not isinstance(dado, dict):
        return None
    # nada de dose de suplemento/medicamento no que vai para a tela
    dose = re.compile(r"\b\d+[\d.,]*\s?(mg|mcg|µg|ui|iu|g/dia|mg/dia)\b", re.I)
    def limpa(v):
        if isinstance(v, str):
            return dose.sub("[dose a definir com o médico]", v)
        if isinstance(v, list):
            return [limpa(x) for x in v]
        if isinstance(v, dict):
            return {k: limpa(x) for k, x in v.items()}
        return v
    return limpa(dado)


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

class DrHouseExamAnalysisIn(BaseModel):
    lote_id: Optional[str] = None
    pergunta: Optional[str] = None

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

@api.post("/patients/{pid}/exames-manuais/drhouse-analysis", status_code=201)
async def create_drhouse_exames_analysis(pid: str, payload: DrHouseExamAnalysisIn, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Paciente nao encontrado")
    query = {"paciente_id": pid}
    if payload.lote_id:
        query["id"] = payload.lote_id
    lotes = [d async for d in db.exames_manuais.find(query, {"_id": 0}).sort("data_coleta", 1)]
    if not lotes:
        raise HTTPException(400, "Nenhum exame manual encontrado para analisar")
    longitudinal = _build_exames_longitudinal_payload(lotes)
    try:
        anam = await _anamnese_principal(pid)
        evaluation = await db.evaluations.find_one({"paciente_id": pid}, {"_id": 0}, sort=[("created_at", -1)])
        recordatorio = await db.recordatorios.find_one({"paciente_id": pid}, {"_id": 0}, sort=[("data", -1)])

        async def _estruturado():
            try:
                return await ai_drhouse_estruturado(p, lotes, longitudinal, anam=anam, evaluation=evaluation, recordatorio=recordatorio)
            except Exception:  # a análise em texto continua valendo
                logging.exception("Dr. House estruturado falhou")
                return None
        content, estruturado = await asyncio.gather(
            ai_drhouse_manual_exam_analysis(p, lotes, longitudinal, payload.pergunta, anam=anam, evaluation=evaluation),
            _estruturado(),
        )
    except Exception as exc:
        logging.exception("Dr. House manual exam analysis failed")
        raise HTTPException(503, f"Falha no Dr. House: {str(exc)[:140]}")
    doc = {
        "id": str(uuid.uuid4()),
        "paciente_id": pid,
        "nutricionista_id": user["id"],
        "agent_code": "drhouse",
        "lote_id": payload.lote_id,
        "pergunta": payload.pergunta,
        "content": content,
        "estruturado": estruturado,
        "resumo_longitudinal": longitudinal.get("resumo"),
        "created_at": iso(now_utc()),
    }
    await db.drhouse_exam_analyses.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}

class AplicarCondutaIn(BaseModel):
    condutas: List[str] = []
    repetir_em_dias: Optional[int] = None


@api.post("/patients/{pid}/exames-manuais/aplicar-conduta")
async def aplicar_conduta_exames(pid: str, payload: AplicarCondutaIn, user=Depends(require_nutritionist)):
    """Manda as condutas marcadas para as Observações da dieta mais recente (não mexe nos alimentos)."""
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    itens = [str(c).strip()[:600] for c in payload.condutas if str(c).strip()][:20]
    if not itens and not payload.repetir_em_dias:
        raise HTTPException(400, "Marque ao menos uma conduta")
    plano = await db.planos_manuais.find_one({"paciente_id": pid}, {"_id": 0}, sort=[("atualizado_em", -1), ("criado_em", -1)])
    if not plano:
        raise HTTPException(400, "Crie a dieta do paciente na Prescrição antes de aplicar a conduta")
    texto = "\n".join(f"• {c}" for c in itens)
    if payload.repetir_em_dias:
        texto += f"\n• Repetir os exames em {int(payload.repetir_em_dias)} dias."
    recs = list(plano.get("recomendacoes") or [])
    recs = [r for r in recs if (r or {}).get("titulo") != "Conduta pelos exames"]
    recs.append({"titulo": "Conduta pelos exames", "texto": texto.strip()})
    await db.planos_manuais.update_one({"id": plano["id"]}, {"$set": {"recomendacoes": recs, "atualizado_em": iso(now_utc())}})
    return {"ok": True, "plano_id": plano["id"], "titulo": plano.get("titulo")}


class LaudoIn(BaseModel):
    texto: str = Field(min_length=10, max_length=8000)


@api.post("/patients/{pid}/exames-manuais/laudo-pdf")
async def laudo_exames_pdf(pid: str, payload: LaudoIn, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    nutri = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0}) or {}
    paragrafos = "".join(f"<p style='font-size:11pt;line-height:1.6;margin:0 0 10px'>{_pdf_escape(par)}</p>" for par in payload.texto.split("\n") if par.strip())
    html = _pdf_html_base("Seus exames, explicados", p, nutri, f'<div class="sec">{paragrafos}</div>')
    pdf_bytes = HTML(string=html).write_pdf()
    return Response(content=pdf_bytes, media_type="application/pdf",
                    headers={"Content-Disposition": f"attachment; filename=laudo_exames_{p.get('nome', 'p').replace(' ', '_')}.pdf"})


@api.post("/patients/{pid}/exames-manuais/laudo-enviar")
async def laudo_exames_enviar(pid: str, payload: LaudoIn, user=Depends(require_nutritionist)):
    """Envia o laudo revisado para o app do aluno (aparece no atendimento)."""
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    pu = await db.users.find_one({"role": "patient", "patient_id": pid}, {"_id": 0})
    session_id = f"patient-{pu['id']}" if pu else f"patient-pending-{pid}"
    msg = {"id": str(uuid.uuid4()), "session_id": session_id, "user_id": (pu or {}).get("id"), "patient_id": pid,
           "role": "assistant", "content": "📋 Seus exames, explicados\n\n" + payload.texto.strip(), "kind": "laudo_exames",
           "created_at": iso(now_utc())}
    await db.patient_messages.insert_one(dict(msg))
    await db.patients.update_one({"id": pid}, {"$push": {"laudos_exames": {"texto": payload.texto.strip(), "enviado_em": msg["created_at"]}}})
    return {"ok": True}


@api.get("/patients/{pid}/exames-manuais/drhouse-analysis")
async def list_drhouse_exames_analysis(pid: str, user=Depends(require_nutritionist)):
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente nao encontrado")
    return await db.drhouse_exam_analyses.find(
        {"paciente_id": pid, "nutricionista_id": user["id"]},
        {"_id": 0},
    ).sort("created_at", -1).to_list(20)

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

def _pdf_fmt_date(value: Any) -> Optional[str]:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10]).strftime("%d/%m/%Y")
    except ValueError:
        return str(value)

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
    """Todas as avaliações (sem limite), em ordem cronológica: resumo, dobras com as cores do doc
    "Critérios de cor das dobras cutâneas" e perímetros. Tabelas largas são quebradas em grupos de 6 avaliações."""
    p = await db.patients.find_one({"id": pid, "nutricionista_id": user["id"]})
    if not p:
        raise HTTPException(404, "Paciente não encontrado")
    nutri = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0}) or {}
    evals = await db.evaluations.find({"paciente_id": pid}, {"_id": 0}).to_list(None)
    evals.sort(key=lambda e: str(e.get("data_avaliacao") or e.get("created_at") or ""))
    for i, e in enumerate(evals):
        e["_numero"] = i + 1
    esc = _pdf_escape

    def num(v, casas=1):
        f = _coerce_float(v)
        return "—" if f is None else f"{f:.{casas}f}".replace(".", ",")

    def data(e):
        return _pdf_fmt_date(e.get("data_avaliacao") or e.get("created_at")) or "—"

    if not evals:
        conteudo = '<p style="color:#888">Nenhuma avaliação registrada.</p>'
    else:
        # 1) resumo
        linhas = ""
        for e in evals:
            c = e.get("composicao") or {}
            proto = protd.PROTOCOLOS.get(c.get("protocolo_dobras") or e.get("protocolo_dobras") or "", {}).get("nome", "")
            linhas += (f"<tr><td>{e['_numero']}ª</td><td>{data(e)}</td><td>{num(e.get('peso'))}</td>"
                       f"<td>{num(c.get('imc'))}{' · ' + esc(c.get('imc_classificacao')) if c.get('imc_classificacao') else ''}</td>"
                       f"<td>{num(c.get('pct_gordura'))}{'<br/><span style=\"font-size:8pt;color:#777\">' + esc(proto) + '</span>' if proto else ''}</td>"
                       f"<td>{num(c.get('massa_magra'))}</td><td>{num(c.get('get_kcal'), 0)}</td></tr>")
        conteudo = (f'<div class="sec"><div class="sec-title">Avaliações ({len(evals)})</div><table>'
                    "<tr><th>Nº</th><th>Data</th><th>Peso (kg)</th><th>IMC</th><th>% Gordura</th><th>Massa magra (kg)</th><th>GET (kcal)</th></tr>"
                    f"{linhas}</table></div>")

        # 2) dobras: protocolo da avaliação mais recente; cores pelo critério do doc (versão para impressão)
        ultimo = evals[-1]
        protocolo = (ultimo.get("composicao") or {}).get("protocolo_dobras") or ultimo.get("protocolo_dobras") or "pollock7"
        sexo = p.get("sexo") if p.get("sexo") in ("M", "F") else None
        atleta = bool(p.get("atleta"))
        do_protocolo = protd.PROTOCOLOS.get(protocolo, {}).get("dobras", {}).get(sexo or "F", [])
        cores = {"vermelho": "#DC2626", "verde": "#16A34A", "branco": "#111827", "cinza": "#9CA3AF"}
        valor = lambda e, k: _coerce_float((e.get("dobras") or {}).get(k) if k != "tricipital" else
                                           ((e.get("dobras") or {}).get("tricipital") or (e.get("dobras") or {}).get("triceps")))

        def total(e):
            vals = [valor(e, k) for k in do_protocolo]
            return round(sum(vals), 1) if do_protocolo and all(v is not None for v in vals) else None

        def celula(v, cor):
            if v is None:
                return "<td style=\"text-align:center\"></td>"
            estilo = f"color:{cores[cor]};font-weight:bold" if cor else "color:#9CA3AF"
            return f'<td style="text-align:center;{estilo}">{num(v)}</td>'

        tem_dobras = any(valor(e, k) is not None for e in evals for k, _ in protd.DOBRAS_ORDEM)
        if tem_dobras:
            perfil = f"{ {'M': 'Homem', 'F': 'Mulher'}.get(sexo, 'Sexo não informado') } · {'Atleta' if atleta else 'Não atleta'} · " \
                     f"{esc(protd.PROTOCOLOS.get(protocolo, {}).get('nome', protocolo))}"
            legenda = ("<b style='color:#DC2626'>Vermelho</b> acima da faixa · <b>Preto</b> dentro da faixa · "
                       "<b style='color:#16A34A'>Verde</b> abaixo da faixa (perfil atleta)") if atleta else \
                      ("<b style='color:#DC2626'>Vermelho</b> aumentou · <b>Preto</b> igual (até 0,5 mm) · "
                       "<b style='color:#16A34A'>Verde</b> diminuiu · <b style='color:#9CA3AF'>Cinza</b> 1ª avaliação")
            blocos = ""
            for ini_g in range(0, len(evals), 6):
                grupo = evals[ini_g:ini_g + 6]
                cab = "".join(f'<th style="text-align:center">{e["_numero"]}ª<br/><span style="font-weight:normal">{data(e)}</span></th>' for e in grupo)
                corpo = ""
                for chave, rotulo in protd.DOBRAS_ORDEM:
                    if not any(valor(e, chave) is not None for e in evals):
                        continue
                    no_prot = chave in do_protocolo
                    nome = f'<b style="color:#2563EB">{rotulo}</b>' if no_prot else f'<span style="color:#9CA3AF">{rotulo}</span>'
                    tds = ""
                    for e in grupo:
                        v = valor(e, chave)
                        ant = evals[e["_numero"] - 2] if e["_numero"] > 1 else None
                        cor = protd.cor_dobra(atleta, sexo, chave, v, valor(ant, chave) if ant else None) if no_prot else None
                        tds += celula(v, cor) if no_prot else (f'<td style="text-align:center;color:#9CA3AF">{num(v)}</td>' if v is not None else "<td></td>")
                    corpo += f"<tr><td>{nome}</td>{tds}</tr>"
                tds = ""
                for e in grupo:
                    t = total(e)
                    ant = evals[e["_numero"] - 2] if e["_numero"] > 1 else None
                    if t is None:
                        cor = None
                    elif atleta:
                        cor = protd.cor_dobra(True, sexo, "total", t) if protocolo == "pollock7" else None
                    else:
                        cor = "cinza" if not ant else (protd.cor_dobra(False, sexo, "total", t, total(ant)) if total(ant) is not None else None)
                    tds += celula(t, cor) if t is not None else "<td></td>"
                corpo += f"<tr><td><b>Total</b></td>{tds}</tr>"
                blocos += f"<table><tr><th>Dobras (mm)</th>{cab}</tr>{corpo}</table>"
            conteudo += (f'<div class="sec"><div class="sec-title">Dobras cutâneas</div>'
                         f'<p style="font-size:9pt;color:#555;margin:0 0 6px">{perfil}</p>{blocos}'
                         f'<p style="font-size:8.5pt;color:#555"><b style="color:#2563EB">Nome azul</b> entra no protocolo · {legenda}</p></div>')

        # 3) perímetros medidos
        rot_per = {"braco_relaxado_d": "Braço relaxado direito", "braco_relaxado_e": "Braço relaxado esquerdo",
                   "braco_contraido_d": "Braço contraído direito", "braco_contraido_e": "Braço contraído esquerdo",
                   "antebraco_d": "Antebraço direito", "antebraco_e": "Antebraço esquerdo", "punho_d": "Punho direito",
                   "punho_e": "Punho esquerdo", "pescoco": "Pescoço", "ombro": "Ombro", "torax": "Tórax", "cintura": "Cintura",
                   "abdomen": "Abdômen", "quadril": "Quadril", "panturrilha_d": "Panturrilha direita",
                   "panturrilha_e": "Panturrilha esquerda", "coxa_d": "Coxa direita", "coxa_e": "Coxa esquerda",
                   "coxa_proximal_d": "Coxa proximal direita", "coxa_proximal_e": "Coxa proximal esquerda"}
        chaves = []
        for e in evals:
            for k, v in (e.get("perimetria") or {}).items():
                if _coerce_float(v) is not None and k not in chaves:
                    chaves.append(k)
        chaves.sort(key=lambda k: list(rot_per).index(k) if k in rot_per else 99)
        if chaves:
            blocos = ""
            for ini_g in range(0, len(evals), 6):
                grupo = evals[ini_g:ini_g + 6]
                cab = "".join(f'<th style="text-align:center">{e["_numero"]}ª<br/><span style="font-weight:normal">{data(e)}</span></th>' for e in grupo)
                corpo = "".join(
                    f"<tr><td>{esc(rot_per.get(k, k))}</td>" + "".join(
                        f'<td style="text-align:center">{num((e.get("perimetria") or {}).get(k)) if _coerce_float((e.get("perimetria") or {}).get(k)) is not None else ""}</td>'
                        for e in grupo) + "</tr>" for k in chaves)
                blocos += f"<table><tr><th>Perímetros (cm)</th>{cab}</tr>{corpo}</table>"
            conteudo += f'<div class="sec"><div class="sec-title">Perímetros</div>{blocos}</div>'

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
    anam = await _anamnese_principal(pid)
    secoes_html = ""
    sexo = {"F": "Feminino", "M": "Masculino", "O": "Outro"}.get(p.get("sexo") or "", p.get("sexo"))
    dados_pessoais = [
        ("E-mail", p.get("email")),
        ("Telefone", p.get("telefone")),
        ("Data de nascimento", _pdf_fmt_date(p.get("data_nascimento"))),
        ("Sexo biológico", sexo),
        ("Estatura", f"{p['altura']} cm" if p.get("altura") else None),
        ("Peso", f"{p['peso']} kg" if p.get("peso") else None),
        ("Objetivo", p.get("objetivo")),
        ("Data da 1ª consulta", _pdf_fmt_date(p.get("data_primeira_consulta"))),
    ]
    # "outras informações" do Bloco 1 (dados antigos sem pergunta equivalente)
    for rotulo, valor in (((anam or {}).get("formulario_outras") or {}).get("dados_pessoais") or {}).items():
        dados_pessoais.append((rotulo, valor))
    rows = "".join(
        f"<tr><td><strong>{_pdf_escape(label)}</strong></td><td>{_pdf_nl2br(valor)}</td></tr>"
        for label, valor in dados_pessoais if valor
    )
    if rows:
        secoes_html += f'<div class="sec"><div class="sec-title">Dados pessoais</div><table>{rows}</table></div>'
    if (p.get("observacoes") or "").strip():
        obs_html = _pdf_nl2br(p["observacoes"].strip())
        secoes_html += f'<div class="sec"><div class="sec-title">Observações</div><p>{obs_html}</p></div>'
    # Blocos 2 a 5 do formulário, pergunta e resposta na ordem do formulário
    for bloco, itens in af.legiveis(anam).items():
        rows = "".join(
            f"<tr><td style=\"width:45%\"><strong>{_pdf_escape(pergunta)}</strong></td><td>{_pdf_nl2br(resposta)}</td></tr>"
            for pergunta, resposta in itens.items()
        )
        secoes_html += f'<div class="sec"><div class="sec-title">{_pdf_escape(bloco)}</div><table>{rows}</table></div>'
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
        conteudo_v2 += f'<div class="sec"><div class="sec-title">Orientações Nutricionais</div>{cards}</div>'
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
                        f'<td colspan="2">Total da refeição</td>'
                        f'<td class="right">{_pdf_fmt_num(tot.get("energia_kcal",0))}</td><td class="right">{_pdf_fmt_num(tot.get("proteinas_g",0))}</td>'
                        f'<td class="right">{_pdf_fmt_num(tot.get("carboidratos_g",0))}</td><td class="right">{_pdf_fmt_num(tot.get("lipidios_g",0))}</td>'
                        f'</tr></table></div>')
    conteudo_v2 += (f'<div class="sec"><div class="sec-title">Total do Dia</div>'
                    f'<table><tr><th>Energia</th><th>Proteínas</th><th>Carboidratos</th><th>Lipídios</th><th>Fibras</th><th>Sódio</th></tr>'
                    f'<tr><td>{_pdf_fmt_num(totais_dia.get("energia_kcal",0), " kcal")}</td><td>{_pdf_fmt_num(totais_dia.get("proteinas_g",0), " g")}</td>'
                    f'<td>{_pdf_fmt_num(totais_dia.get("carboidratos_g",0), " g")}</td><td>{_pdf_fmt_num(totais_dia.get("lipidios_g",0), " g")}</td>'
                    f'<td>{_pdf_fmt_num(totais_dia.get("fibras_g",0), " g")}</td><td>{_pdf_fmt_num(totais_dia.get("sodio_mg",0), " mg")}</td></tr></table></div>')
    if plano.get("observacoes"):
        conteudo_v2 += f'<div class="sec"><div class="sec-title">Observações</div><div class="card"><p style="white-space:pre-wrap;margin:0">{_pdf_nl2br(plano["observacoes"])}</p></div></div>'
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
    # leads antigos do atendimento do site entram como lead normal (aparecem na aba Leads)
    await db.patients.update_many({"status_funil": "LEAD_ATENDIMENTO"}, {"$set": {"status_funil": "LEAD_INICIADO", "origem": "site"}})
    await db.whatsapp_mensagens.create_index([("patient_id", 1), ("created_at", -1)])
    await db.whatsapp_mensagens.create_index("wa_id", sparse=True)
    await db.reservas.create_index([("nutricionista_id", 1), ("data_hora", 1)])
    await db.pagamentos.create_index([("nutricionista_id", 1), ("data_pagamento", -1)])
    await db.pagamentos.create_index("paciente_id")
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
    await db.suplementos.create_index([("nutricionista_id", 1), ("nome", 1)])
    await db.formulas.create_index([("nutricionista_id", 1), ("nome", 1)])
    await db.planos_manuais.create_index([("paciente_id", 1), ("criado_em", -1)])
    await db.donato_plan_generations.create_index([("paciente_id", 1), ("created_at", -1)])
    await db.donato_plan_generations.create_index([("nutricionista_id", 1), ("approval_status", 1)])
    await db.drhouse_exam_analyses.create_index([("paciente_id", 1), ("created_at", -1)])
    await db.orientacoes_nutricionais.create_index([("nutricionista_id", 1), ("atualizado_em", -1)])
    await db.orientacoes_nutricionais.create_index([("nutricionista_id", 1), ("categoria", 1)])
    await db.planos_manuais_historico.create_index([("plano_id", 1), ("criado_em", -1)])
    await db.exames_manuais.create_index([("paciente_id", 1), ("data_coleta", -1)])
    # base de alimentos = TABELA ENXUTA (grava e arquiva o resto, uma vez por versao)
    asyncio.create_task(_sincronizar_base_alimentos())
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

@app.get("/health/base")
async def health_base():
    """Versao da base de alimentos gravada no banco (para conferir a sincronizacao apos o deploy)."""
    marcador = await db.meta_sistema.find_one({"_id": "base_alimentos"}, {"_id": 0}) or {}
    return {"versao_esperada": BASE_VERSAO, **marcador}

api.include_router(build_financeiro_router(db, require_nutritionist))
_dieta_router = build_dieta_router(db, require_nutritionist, SimpleNamespace(
    enrich_plano=_enrich_plano, coerce_float=_coerce_float, macros_100g=_macros_100g,
    medidas_do_alimento=_medidas_do_alimento, pdf_escape=_pdf_escape, pdf_nl2br=_pdf_nl2br,
    HTML=HTML, TZ_BR=TZ_BR, iso=iso, now_utc=now_utc,
))


@api.get("/patient/diet/pdf")
async def patient_diet_pdf(user=Depends(require_patient)):
    """App do aluno: "Baixar plano em PDF" (sempre a versão mais nova)."""
    return await _dieta_router.pdf_plano_do_aluno(user.get("patient_id"))


@api.get("/patient/evolucao/pdf")
async def patient_evolucao_pdf(user=Depends(require_patient)):
    """App do aluno: relatório "Sua evolução" que o nutricionista enviou (ou primeira × última avaliação)."""
    return await _dieta_router.evolucao_do_aluno(user.get("patient_id"))


api.include_router(_dieta_router)
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
logging.getLogger("httpx").setLevel(logging.WARNING)
