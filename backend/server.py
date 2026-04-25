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

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, status
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr, ConfigDict

from emergentintegrations.llm.chat import LlmChat, UserMessage

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
    text = await ai_clinical_analysis(anam.get("respostas", {}), avals.get("composicao") if avals else None)
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
    text = await ai_meal_plan(p, anam.get("respostas") if anam else {}, macros, payload.restricoes)
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

# ---------- Bootstrap ----------
@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.patients.create_index("lead_token")
    await db.patients.create_index("nutricionista_id")
    await db.consultations.create_index("nutricionista_id")
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
