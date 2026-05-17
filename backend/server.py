from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import re
import logging
import uuid
import bcrypt
import jwt
import secrets
import unicodedata
from collections import defaultdict, deque
from datetime import datetime, timezone, timedelta, date
from typing import List, Optional, Any
from zoneinfo import ZoneInfo

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, status, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr, ConfigDict

from emergentintegrations.llm.chat import LlmChat, UserMessage
import json
import io
import pdfplumber
from weasyprint import HTML, CSS

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
    "lead_token", "created_at",
}

def public_lead_view(p: dict) -> dict:
    return {k: v for k, v in p.items() if k in PUBLIC_LEAD_FIELDS}

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALG = "HS256"
EMERGENT_LLM_KEY = os.environ['EMERGENT_LLM_KEY']

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

async def require_nutritionist(user=Depends(get_current_user)) -> dict:
    if user.get("role") != "nutritionist":
        raise HTTPException(403, "Acesso restrito ao nutricionista")
    return user

async def require_patient(user=Depends(get_current_user)) -> dict:
    if user.get("role") != "patient":
        raise HTTPException(403, "Acesso restrito ao paciente")
    return user

def set_auth_cookie(response: Response, token: str):
    response.set_cookie(
        key="access_token", value=token,
        httponly=True, secure=True, samesite="none",
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
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"analise-{uuid.uuid4()}",
        system_message=SYSTEM_CLINICAL,
    ).with_model("anthropic", "claude-sonnet-4-5-20250929")

    prompt = (
        "Analise clinicamente este paciente e gere um relatório estruturado em Markdown com as seções: "
        "1) Objetivo principal e prioridade. 2) Padrões alimentares e comportamentais detectados. "
        "3) Riscos clínicos sugeridos (com bullets). 4) Score de adesão estimado (1–10) com justificativa. "
        "5) 3 recomendações práticas para a primeira consulta. Seja conciso (máx. 400 palavras).\n\n"
        f"ANAMNESE: {anamnesis}\n\nAVALIAÇÃO FÍSICA: {evaluation or 'não disponível'}"
    )
    return await chat.send_message(UserMessage(text=prompt))

async def ai_meal_plan(patient: dict, anamnesis: dict, macros: dict, restricoes: str = None) -> str:
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"plano-{uuid.uuid4()}",
        system_message=SYSTEM_CLINICAL,
    ).with_model("anthropic", "claude-sonnet-4-5-20250929")
    prompt = (
        f"Monte um plano alimentar diário em Markdown para o paciente {patient.get('name')}. "
        f"Meta: {macros['kcal']} kcal | PTN {macros['proteina_g']}g | CHO {macros['carboidrato_g']}g | LIP {macros['gordura_g']}g. "
        f"Restrições/preferências: {restricoes or 'nenhuma informada'}. "
        "Estruture em 5 a 6 refeições com horários sugeridos, alimentos em porções práticas (g/ml/unidades), "
        "e finalize com uma seção 'Suplementação Sugerida' (se aplicável) e 'Hidratação'. "
        "Use linguagem clara, sem jargão. Não exceda 500 palavras."
    )
    return await chat.send_message(UserMessage(text=prompt))

async def ai_adaptive_chat(token: str, message: str, anamnesis: dict, history: list) -> str:
    sys_prompt = await build_agent_system_prompt("agent1")
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"chat-{token}",
        system_message=sys_prompt,
    ).with_model("anthropic", "claude-sonnet-4-5-20250929")
    context = f"Dados iniciais do paciente:\n{anamnesis}\n\nHistórico recente:\n"
    for m in history[-10:]:
        context += f"{m['role']}: {m['content']}\n"
    context += f"\nMensagem do paciente: {message}\nResponda de forma acolhedora."
    return await chat.send_message(UserMessage(text=context))

async def ai_consultorio_chat(session_id: str, message: str, patient_context: dict, history: list) -> str:
    """Agente 2 — interno do nutricionista. patient_context = anamnese + exames + avaliações."""
    extra = (
        "DADOS DO PACIENTE EM CONSULTA (use para fundamentar a resposta):\n"
        f"{json.dumps(patient_context, ensure_ascii=False, default=str)[:18000]}"
    )
    sys_prompt = await build_agent_system_prompt("agent2", extra_context=extra)
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"consult-{session_id}",
        system_message=sys_prompt,
    ).with_model("anthropic", "claude-sonnet-4-5-20250929")
    convo = ""
    for m in history[-10:]:
        convo += f"{m['role']}: {m['content']}\n"
    convo += f"user: {message}"
    return await chat.send_message(UserMessage(text=convo))

async def ai_patient_chat(session_id: str, message: str, patient_context: dict, history: list) -> str:
    """Agente 3 — paciente. patient_context = plano alimentar ativo, objetivo, restrições."""
    extra = (
        "CONTEXTO DO PACIENTE (plano alimentar ativo e dados-chave):\n"
        f"{json.dumps(patient_context, ensure_ascii=False, default=str)[:14000]}"
    )
    sys_prompt = await build_agent_system_prompt("agent3", extra_context=extra)
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"patient-{session_id}",
        system_message=sys_prompt,
    ).with_model("anthropic", "claude-sonnet-4-5-20250929")
    convo = ""
    for m in history[-10:]:
        convo += f"{m['role']}: {m['content']}\n"
    convo += f"user: {message}"
    return await chat.send_message(UserMessage(text=convo))

async def ai_exam_analysis(raw_text: str) -> dict:
    """Extract laboratory markers from exam PDF text and classify them.
    Returns: {markers: [{nome, valor, unidade, referencia, status}], resumo, conduta_sugerida}
    """
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
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
    ).with_model("anthropic", "claude-sonnet-4-5-20250929")
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
async def create_lead(payload: LeadIn, nutri: Optional[str] = Query(None)):
    nutri_doc = None
    if nutri:
        nutri_doc = await db.users.find_one({"slug": nutri.lower(), "role": "nutritionist"})
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

@api.get("/public/lead/{token}")
async def get_lead(token: str):
    p = await db.patients.find_one({"lead_token": token}, {"_id": 0, "password_hash": 0})
    if not p:
        raise HTTPException(404, "Lead não encontrado")
    return public_lead_view(p)

@api.post("/public/anamnesis")
async def submit_anamnesis(payload: AnamnesisIn):
    p = await db.patients.find_one({"lead_token": payload.token})
    if not p:
        raise HTTPException(404, "Lead não encontrado")
    aid = str(uuid.uuid4())
    doc = {
        "id": aid, "paciente_id": p["id"], "respostas": payload.respostas,
        "created_at": iso(now_utc()),
    }
    await db.anamneses.insert_one(doc)
    # update patient with relevant fields (support old & new field names)
    upd = {"status_funil": "ANAMNESE_COMPLETA"}
    r = payload.respostas

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
    return {"patient": p, "anamneses": anam, "consultations": consultas,
            "evaluations": avals, "meal_plans": plans, "ai_analyses": analyses}

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
    msgs = await db.patient_messages.find(
        {"session_id": session_id}, {"_id": 0}
    ).sort("created_at", 1).to_list(200)
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
    # seed agents
    await ensure_agents_seeded()
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
    client.close()

# ---------- CORS ----------
app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.environ.get("FRONTEND_URL", "http://localhost:3000"), "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
