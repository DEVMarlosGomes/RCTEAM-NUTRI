from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import logging
import uuid
import bcrypt
import jwt
import secrets
from datetime import datetime, timezone, timedelta, date
from typing import List, Optional, Any

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, status, UploadFile, File
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

app = FastAPI(title="EvoNut API")
api = APIRouter(prefix="/api")

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

# ---------- AI ----------
SYSTEM_CLINICAL = (
    "Você é o EvoNut AI, assistente clínico nutricional sênior. Responda sempre em Português (Brasil), "
    "tom acolhedor, preciso e sem jargão excessivo. Nunca dê diagnóstico médico — apenas organize informações, "
    "destaque sinais de atenção, e ofereça sugestões para o nutricionista revisar."
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
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"chat-{token}",
        system_message=(
            "Você é o EvoNut, assistente do nutricionista que conversa com o paciente "
            "para aprofundar a anamnese de forma natural e empática. Faça UMA pergunta por vez, "
            "curta e clara. Foque nos pontos críticos detectados (sono, treino, alimentação, estresse, "
            "medicamentos). Após 6 a 8 perguntas, finalize com a frase exata: 'ANAMNESE_FINALIZADA' "
            "e um resumo gentil ao paciente."
        ),
    ).with_model("anthropic", "claude-sonnet-4-5-20250929")
    context = f"Dados iniciais do paciente:\n{anamnesis}\n\nHistórico recente:\n"
    for m in history[-10:]:
        context += f"{m['role']}: {m['content']}\n"
    context += f"\nMensagem do paciente: {message}\nResponda como EvoNut."
    return await chat.send_message(UserMessage(text=context))

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
    return UserOut(id=uid, email=email, name=payload.name)

@api.post("/auth/login", response_model=UserOut)
async def login(payload: LoginIn, response: Response):
    email = payload.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(401, "Credenciais inválidas")
    set_auth_cookie(response, create_token(user["id"], email))
    return UserOut(id=user["id"], email=email, name=user["name"])

@api.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    return {"ok": True}

@api.get("/auth/me", response_model=UserOut)
async def me(user=Depends(get_current_user)):
    return UserOut(**user)

# ---------- Public Lead / Anamnesis flow ----------
@api.post("/leads", response_model=LeadOut)
async def create_lead(payload: LeadIn):
    nutri = await db.users.find_one({"role": "nutritionist"}, sort=[("created_at", 1)])
    if not nutri:
        raise HTTPException(500, "Nenhum nutricionista cadastrado")
    token = secrets.token_urlsafe(16)
    pid = str(uuid.uuid4())
    patient = {
        "id": pid, "nome": payload.name, "telefone": payload.phone, "email": payload.email,
        "status_funil": "LEAD_INICIADO", "nutricionista_id": nutri["id"],
        "lead_token": token, "created_at": iso(now_utc()),
    }
    await db.patients.insert_one(patient)
    return LeadOut(token=token, patient_id=pid, name=payload.name)

@api.get("/public/lead/{token}")
async def get_lead(token: str):
    p = await db.patients.find_one({"lead_token": token}, {"_id": 0, "password_hash": 0})
    if not p:
        raise HTTPException(404, "Lead não encontrado")
    return p

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
    # update patient with relevant fields
    upd = {"status_funil": "ANAMNESE_COMPLETA"}
    r = payload.respostas
    if r.get("peso"): upd["peso"] = float(r["peso"])
    if r.get("altura"): upd["altura"] = int(r["altura"])
    if r.get("data_nascimento"): upd["data_nascimento"] = r["data_nascimento"]
    if r.get("sexo"): upd["sexo"] = r["sexo"]
    if r.get("email"): upd["email"] = r["email"]
    if r.get("objetivo"): upd["objetivo"] = r["objetivo"]
    await db.patients.update_one({"id": p["id"]}, {"$set": upd})
    return {"ok": True, "anamnesis_id": aid}

@api.get("/public/chat/{token}")
async def get_chat(token: str):
    msgs = await db.chat_messages.find({"token": token}, {"_id": 0}).sort("created_at", 1).to_list(200)
    return msgs

@api.post("/public/chat")
async def post_chat(payload: ChatIn):
    p = await db.patients.find_one({"lead_token": payload.token})
    if not p:
        raise HTTPException(404, "Lead não encontrado")
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
    # Generate next 7 days slots 09:00 - 17:00 (skipping booked)
    booked = set()
    cursor = db.consultations.find({"nutricionista_id": p["nutricionista_id"], "status": "AGENDADA"})
    async for c in cursor:
        booked.add(c["data_hora"])
    slots = []
    for d in range(7):
        day = datetime.now(timezone.utc).date() + timedelta(days=d+1)
        if day.weekday() == 6:  # skip Sunday
            continue
        for h in [9, 10, 11, 14, 15, 16, 17]:
            dt = datetime(day.year, day.month, day.day, h, 0, tzinfo=timezone.utc)
            key = iso(dt)
            slots.append({"datetime": key, "available": key not in booked, "label": f"{day.strftime('%d/%m')} {h:02d}:00"})
    return slots

@api.post("/public/schedule")
async def schedule(payload: ScheduleIn):
    p = await db.patients.find_one({"lead_token": payload.token})
    if not p:
        raise HTTPException(404, "Lead não encontrado")
    dt_str = f"{payload.date}T{payload.time}:00+00:00"
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
<html lang="pt-BR"><head><meta charset="utf-8"><title>Plano EvoNut</title></head>
<body>
  <header class="brand">
    <div class="logo">
      <span class="logo-mark"></span>
      <div>
        <div class="brand-name">EvoNut</div>
        <div class="brand-sub">Plano alimentar personalizado</div>
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
    <div class="kpi kpi-purple"><div class="lbl">Calorias / dia</div><div class="val">{plan.get('kcal_total','—')} <span>kcal</span></div></div>
    <div class="kpi"><div class="lbl">Proteína</div><div class="val">{plan.get('proteina_g','—')}g <span>· {plan.get('ptn_pct','—')}%</span></div></div>
    <div class="kpi"><div class="lbl">Carboidrato</div><div class="val">{plan.get('carboidrato_g','—')}g <span>· {plan.get('cho_pct','—')}%</span></div></div>
    <div class="kpi"><div class="lbl">Gordura</div><div class="val">{plan.get('gordura_g','—')}g <span>· {plan.get('lip_pct','—')}%</span></div></div>
  </section>

  <section class="content">
    {body_html}
  </section>

  <footer>
    <div>EvoNut · Sistema Nutricional Inteligente</div>
    <div>Documento gerado automaticamente — revise com seu(sua) nutricionista.</div>
  </footer>
</body></html>"""

    css = CSS(string="""
      @page { size: A4; margin: 18mm 16mm 22mm 16mm; }
      * { box-sizing: border-box; }
      body { font-family: 'Helvetica', 'Arial', sans-serif; color: #0D1117; font-size: 11pt; }
      header.brand { display: flex; justify-content: space-between; align-items: center; padding-bottom: 14px; border-bottom: 2px solid #7B61FF; margin-bottom: 18px; }
      .logo { display: flex; align-items: center; gap: 12px; }
      .logo-mark { width: 36px; height: 36px; border-radius: 10px; background: linear-gradient(135deg, #7B61FF, #1DB97E); }
      .brand-name { font-size: 18pt; font-weight: 700; color: #161B22; }
      .brand-sub { font-size: 9pt; color: #6B7280; }
      header .meta { font-size: 9pt; text-align: right; color: #4B5563; }
      header .meta div { margin-bottom: 2px; }
      header .meta strong { display: block; color: #6B7280; font-size: 8pt; text-transform: uppercase; letter-spacing: 1px; }
      .patient h1 { font-size: 22pt; margin: 0 0 4px 0; color: #161B22; }
      .patient .muted { color: #6B7280; margin: 0 0 16px 0; }
      .kpis { display: flex; gap: 8px; margin-bottom: 22px; }
      .kpi { flex: 1; background: #F3F4F6; border-radius: 10px; padding: 12px 14px; }
      .kpi-purple { background: linear-gradient(135deg, #7B61FF22, #1DB97E22); border: 1px solid #7B61FF55; }
      .kpi .lbl { font-size: 8pt; text-transform: uppercase; letter-spacing: 1px; color: #6B7280; margin-bottom: 4px; }
      .kpi .val { font-size: 16pt; font-weight: 700; color: #161B22; }
      .kpi .val span { font-size: 9pt; color: #6B7280; font-weight: 500; }
      .content h2 { font-size: 14pt; color: #7B61FF; border-bottom: 1px solid #E5E7EB; padding-bottom: 4px; margin-top: 18px; }
      .content h3 { font-size: 12pt; color: #161B22; margin-top: 14px; margin-bottom: 4px; }
      .content h4 { font-size: 11pt; color: #1DB97E; margin-top: 10px; margin-bottom: 2px; }
      .content p { margin: 6px 0; line-height: 1.5; }
      .content ul { padding-left: 18px; margin: 6px 0; }
      .content li { margin: 3px 0; line-height: 1.45; }
      footer { position: fixed; bottom: -12mm; left: 0; right: 0; font-size: 8pt; color: #9CA3AF; display: flex; justify-content: space-between; padding-top: 6px; border-top: 1px solid #E5E7EB; }
    """)

    pdf_bytes = HTML(string=html_doc).write_pdf(stylesheets=[css])
    safe_name = (p.get("nome") or "paciente").lower().replace(" ", "-")
    headers = {"Content-Disposition": f'attachment; filename="evonut-plano-{safe_name}-v{plan.get("version", 1)}.pdf"'}
    return StreamingResponse(io.BytesIO(pdf_bytes), media_type="application/pdf", headers=headers)

# ---------- Bootstrap ----------
@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.patients.create_index("lead_token")
    await db.patients.create_index("nutricionista_id")
    await db.consultations.create_index("nutricionista_id")
    await db.exams.create_index("paciente_id")
    # seed admin
    admin_email = os.environ['ADMIN_EMAIL'].lower()
    admin_pass = os.environ['ADMIN_PASSWORD']
    admin_name = os.environ.get('ADMIN_NAME', 'Admin')
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        await db.users.insert_one({
            "id": str(uuid.uuid4()), "email": admin_email, "name": admin_name,
            "password_hash": hash_password(admin_pass), "role": "nutritionist",
            "created_at": iso(now_utc()),
        })
    elif not verify_password(admin_pass, existing["password_hash"]):
        await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_password(admin_pass)}})

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
