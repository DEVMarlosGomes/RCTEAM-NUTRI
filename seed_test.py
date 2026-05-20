"""Script de seed e teste ponta-a-ponta do RCTEAM-NUTRI."""
import requests
import json
import uuid
from datetime import datetime, timezone
from pymongo import MongoClient

MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "rcteam_nutri"
mongo = MongoClient(MONGO_URL)
db = mongo[DB_NAME]

def now_iso():
    return datetime.now(timezone.utc).isoformat()

# ─── Limpar dados de teste anteriores ────────────────────────────────────────
TEST_NAMES = {"Ana Paula Ferreira", "Carlos Eduardo Lima", "Mariana Costa Silva"}
print("=== LIMPANDO DADOS DE TESTE ANTERIORES ===")
old_patients = list(db.patients.find({"nome": {"$in": list(TEST_NAMES)}}, {"id": 1}))
old_pids = [p["id"] for p in old_patients]
if old_pids:
    db.anamneses.delete_many({"paciente_id": {"$in": old_pids}})
    db.evaluations.delete_many({"paciente_id": {"$in": old_pids}})
    db.meal_plans.delete_many({"paciente_id": {"$in": old_pids}})
    db.exams.delete_many({"paciente_id": {"$in": old_pids}})
    db.nudges.delete_many({"paciente_id": {"$in": old_pids}})
    db.recordatorios.delete_many({"paciente_id": {"$in": old_pids}})
    db.appointments.delete_many({"paciente_id": {"$in": old_pids}})
    db.patients.delete_many({"id": {"$in": old_pids}})
    print(f"  Removidos {len(old_pids)} pacientes de teste e dados relacionados.")
else:
    print("  Nenhum dado anterior encontrado.")

BASE = "http://localhost:8001/api"
session = requests.Session()
TOKEN = None

def ok(r, label=""):
    if r.status_code not in (200, 201):
        print(f"  [ERRO] {label} [{r.status_code}]: {r.text[:200]}")
        return None
    data = r.json()
    print(f"  [OK] {label}")
    return data

def auth():
    """Return Authorization header dict."""
    return {"Authorization": f"Bearer {TOKEN}"}

# ─── 1. Login ────────────────────────────────────────────────────────────────
print("\n=== 1. LOGIN ADMIN ===")
r = session.post(f"{BASE}/auth/login", json={"email": "admin@rcteam.com", "password": "admin123"})
me = ok(r, "Login admin")
assert me, "Login falhou – abortando"
# Extract JWT from Set-Cookie header
cookie_header = r.headers.get("set-cookie", "")
TOKEN = cookie_header.split("access_token=")[1].split(";")[0] if "access_token=" in cookie_header else None
assert TOKEN, "Token nao encontrado no cookie"
print(f"  TOKEN: {TOKEN[:40]}...")

# ─── 2. Criar Leads (pacientes) ──────────────────────────────────────────────
print("\n=== 2. CRIAR LEADS ===")
leads_data = [
    {"name": "Ana Paula Ferreira",  "phone": "11991110001", "email": "ana.ferreira@email.com"},
    {"name": "Carlos Eduardo Lima", "phone": "21982220002", "email": "carlos.lima@email.com"},
    {"name": "Mariana Costa Silva", "phone": "31973330003", "email": "mariana.silva@email.com"},
]
leads = []
for ld in leads_data:
    r = session.post(f"{BASE}/leads", json=ld, headers=auth())
    d = ok(r, f"Lead: {ld['name']}")
    if d:
        leads.append(d)

# ─── 3. Anamnese (via rota pública com token) ────────────────────────────────
print("\n=== 3. ANAMNESE ===")
anamneses = [
    {
        "token": leads[0]["token"],
        "respostas": {
            "nome_completo": "Ana Paula Ferreira",
            "data_nascimento": "1990-03-15",
            "sexo": "F",
            "email": "ana.ferreira@email.com",
            "telefone": "11991110001",
            "peso_atual": 72.5,
            "estatura": 165,
            "objetivo": "emagrecimento",
            "nivel_atividade": "moderado",
            "historico_doencas": "Hipertensão leve controlada",
            "medicamentos": "Losartana 50mg",
            "cirurgias": "Nenhuma",
            "alergias_alimentares": "Lactose",
            "intolerâncias": "Lactose",
            "preferencias_alimentares": "Frango, peixe, legumes",
            "alimentos_nao_gosta": "Fígado, jiló",
            "refeicoes_por_dia": 4,
            "horario_acordar": "06:30",
            "horario_dormir": "23:00",
            "qualidade_sono": "regular",
            "atividade_fisica": "Caminhada 3x/semana 45min",
            "nivel_estresse": "alto",
            "consumo_agua": 1.5,
            "consumo_alcool": "raramente",
            "tabagismo": "não",
            "intestino": "regular",
            "queixas_principais": "Cansaço, inchaço abdominal, dificuldade de perder peso",
        }
    },
    {
        "token": leads[1]["token"],
        "respostas": {
            "nome_completo": "Carlos Eduardo Lima",
            "data_nascimento": "1985-07-22",
            "sexo": "M",
            "email": "carlos.lima@email.com",
            "telefone": "21982220002",
            "peso_atual": 88.0,
            "estatura": 178,
            "objetivo": "hipertrofia",
            "nivel_atividade": "muito_ativo",
            "historico_doencas": "Nenhuma",
            "medicamentos": "Creatina, Whey protein",
            "cirurgias": "Nenhuma",
            "alergias_alimentares": "Nenhuma",
            "preferencias_alimentares": "Carne vermelha, ovos, arroz",
            "alimentos_nao_gosta": "Espinafre",
            "refeicoes_por_dia": 6,
            "horario_acordar": "05:30",
            "horario_dormir": "22:00",
            "qualidade_sono": "boa",
            "atividade_fisica": "Musculação 5x/semana + natação 2x",
            "nivel_estresse": "baixo",
            "consumo_agua": 3.5,
            "consumo_alcool": "nunca",
            "tabagismo": "não",
            "intestino": "normal",
            "queixas_principais": "Ganho de massa muscular, melhora de performance",
        }
    },
    {
        "token": leads[2]["token"],
        "respostas": {
            "nome_completo": "Mariana Costa Silva",
            "data_nascimento": "1998-11-05",
            "sexo": "F",
            "email": "mariana.silva@email.com",
            "telefone": "31973330003",
            "peso_atual": 58.0,
            "estatura": 162,
            "objetivo": "manutencao",
            "nivel_atividade": "levemente_ativo",
            "historico_doencas": "Anemia ferropriva",
            "medicamentos": "Sulfato ferroso",
            "cirurgias": "Nenhuma",
            "alergias_alimentares": "Frutos do mar",
            "preferencias_alimentares": "Vegetais, frutas, leguminosas",
            "alimentos_nao_gosta": "Carne de porco",
            "refeicoes_por_dia": 5,
            "horario_acordar": "07:00",
            "horario_dormir": "23:30",
            "qualidade_sono": "boa",
            "atividade_fisica": "Yoga 2x/semana, caminhada esporádica",
            "nivel_estresse": "moderado",
            "consumo_agua": 2.0,
            "consumo_alcool": "socialmente",
            "tabagismo": "não",
            "intestino": "normal",
            "queixas_principais": "Manter peso, aumentar energia e disposição",
        }
    },
]

for an in anamneses:
    r = session.post(f"{BASE}/public/anamnesis", json=an)
    ok(r, f"Anamnese: {an['respostas']['nome_completo']}")

# ─── 4. Buscar pacientes criados ─────────────────────────────────────────────
print("\n=== 4. BUSCAR PACIENTES ===")
r = session.get(f"{BASE}/patients", headers=auth())
patients = ok(r, "Listar pacientes")
pids = [p["id"] for p in patients if p.get("nome") in [l["name"] for l in leads_data]]
print(f"  → {len(pids)} pacientes encontrados: {[p['nome'] for p in patients if p['id'] in pids]}")

# ─── 5. Avaliações físicas (antropometria) ───────────────────────────────────
print("\n=== 5. AVALIAÇÕES FÍSICAS ===")
evaluations = [
    {
        "pid": pids[0],
        "data": {
            "peso": 72.5, "altura": 165, "idade": 35, "sexo": "F",
            "protocolo_dobras": "pollock3",
            "dobras": {"triceps": 22.0, "suprailiaca": 18.0, "coxa": 30.0},
            "perimetria": {
                "cintura": 80.0, "quadril": 98.0, "braco_d": 29.0,
                "coxa_d": 55.0, "panturrilha_d": 35.0
            },
            "nivel_atividade": 1.55,
            "objetivo": "emagrecimento",
        }
    },
    {
        "pid": pids[1],
        "data": {
            "peso": 88.0, "altura": 178, "idade": 40, "sexo": "M",
            "protocolo_dobras": "pollock7",
            "dobras": {
                "peitoral": 12.0, "axilar_media": 10.0, "triceps": 11.0,
                "subescapular": 14.0, "abdominal": 18.0, "suprailiaca": 13.0, "coxa": 15.0
            },
            "perimetria": {
                "cintura": 86.0, "quadril": 96.0, "braco_d": 38.0,
                "coxa_d": 60.0, "panturrilha_d": 40.0, "peitoral": 102.0
            },
            "nivel_atividade": 1.9,
            "objetivo": "hipertrofia",
        }
    },
    {
        "pid": pids[2],
        "data": {
            "peso": 58.0, "altura": 162, "idade": 27, "sexo": "F",
            "protocolo_dobras": "pollock3",
            "dobras": {"triceps": 16.0, "suprailiaca": 12.0, "coxa": 22.0},
            "perimetria": {
                "cintura": 68.0, "quadril": 90.0, "braco_d": 25.0,
                "coxa_d": 50.0, "panturrilha_d": 33.0
            },
            "nivel_atividade": 1.375,
            "objetivo": "manutencao",
        }
    },
]

for ev in evaluations:
    r = session.post(f"{BASE}/patients/{ev['pid']}/evaluations", json=ev["data"], headers=auth())
    name = next(p["nome"] for p in patients if p["id"] == ev["pid"])
    ok(r, f"Avaliacao: {name}")

# ─── 6. Plano Alimentar (inserção direta no MongoDB - sem IA) ────────────────
print("\n=== 6. PLANO ALIMENTAR (MongoDB direto) ===")
planos_conteudo = [
    {
        "pid": pids[0],
        "nome": "Ana Paula Ferreira",
        "objetivo": "emagrecimento",
        "kcal": 1500, "proteina_g": 112, "carboidrato_g": 150, "gordura_g": 45,
        "conteudo": """## Plano Alimentar - Emagrecimento (Sem Lactose)
**Meta:** 1500 kcal | PTN 112g | CHO 150g | LIP 45g

### Refeição 1 - Café da Manhã (07:00)
- Pão integral: 2 fatias (60g)
- Ovo mexido: 2 unidades (100g)
- Abacate: 30g
- Café preto sem açúcar: 200ml

### Refeição 2 - Lanche (10:00)
- Banana: 1 unidade média (100g)
- Amendoim torrado: 20g

### Refeição 3 - Almoço (13:00)
- Arroz integral: 3 colheres (75g cru)
- Feijão carioca: 1 concha média (80g)
- Filé de frango grelhado: 150g
- Salada verde + azeite: 1 prato raso

### Refeição 4 - Lanche (16:00)
- Iogurte de coco: 150g
- Granola sem lactose: 25g

### Refeição 5 - Jantar (20:00)
- Salmão grelhado: 130g
- Batata doce assada: 120g
- Brócolis no vapor: 100g

### Suplementação Sugerida
- Vitamina D3: 2000 UI/dia (repor deficiência)
- Probiótico: 1 cápsula/dia (suporte intestinal)

### Hidratação
Mínimo **2L/dia** de água. Priorizar entre as refeições."""
    },
    {
        "pid": pids[1],
        "nome": "Carlos Eduardo Lima",
        "objetivo": "hipertrofia",
        "kcal": 3200, "proteina_g": 220, "carboidrato_g": 380, "gordura_g": 90,
        "conteudo": """## Plano Alimentar - Hipertrofia
**Meta:** 3200 kcal | PTN 220g | CHO 380g | LIP 90g

### Refeição 1 - Café da Manhã (05:30)
- Omelete de 4 ovos com queijo
- Aveia com banana e mel: 80g aveia
- Suco de laranja natural: 300ml

### Refeição 2 - Pré-Treino (08:30)
- Arroz integral: 150g cozido
- Peito de frango: 150g
- Batata inglesa: 100g

### Refeição 3 - Pós-Treino (11:00)
- Whey protein: 40g (1,5 scoops) com água
- Banana: 1 grande (120g)
- Tâmara: 30g

### Refeição 4 - Almoço (13:00)
- Arroz branco: 200g cozido
- Feijão: 1,5 concha
- Carne vermelha magra (patinho): 200g
- Salada + azeite

### Refeição 5 - Lanche (17:30)
- Pão integral: 3 fatias
- Atum em água: 1 lata (140g)
- Requeijão light: 30g

### Refeição 6 - Jantar (20:00)
- Frango: 200g
- Macarrão integral: 150g cozido
- Molho de tomate caseiro

### Suplementação Sugerida
- Creatina monohidratada: 5g/dia
- Whey Protein: 40g pós-treino
- Vitamina D3: manter dose atual

### Hidratação
Mínimo **3,5L/dia**. Aumentar para 4L em dias de treino intenso."""
    },
    {
        "pid": pids[2],
        "nome": "Mariana Costa Silva",
        "objetivo": "manutencao",
        "kcal": 1800, "proteina_g": 100, "carboidrato_g": 220, "gordura_g": 60,
        "conteudo": """## Plano Alimentar - Manutenção e Energia (Sem Frutos do Mar)
**Meta:** 1800 kcal | PTN 100g | CHO 220g | LIP 60g

### Refeição 1 - Café da Manhã (07:00)
- Tapioca recheada com ovo e queijo: 80g tapioca
- Mamão papaia: 150g
- Chá verde ou café: 200ml

### Refeição 2 - Lanche (10:00)
- Mix de castanhas: 30g
- Maçã: 1 unidade (150g)

### Refeição 3 - Almoço (13:00)
- Arroz integral: 4 colheres (100g cru)
- Lentilha: 1 concha (90g)
- Frango desfiado: 120g
- Legumes refogados: 100g
- Salada com azeite e limão

### Refeição 4 - Lanche (16:00)
- Vitamina de banana com aveia: 200ml
- Torrada integral: 2 unidades

### Refeição 5 - Jantar (19:30)
- Sopa de legumes com frango: 300ml
- Pão integral: 1 fatia

### Suplementação Sugerida
- Sulfato Ferroso: conforme prescrição médica (anemia)
- Vitamina C: 500mg/dia (potencializar absorção do ferro)
- Vitamina D3: 4000 UI/dia (repor deficiência grave)

### Hidratação
Mínimo **2L/dia**. Priorizar água com limão em jejum."""
    },
]

for plano in planos_conteudo:
    doc = {
        "id": str(uuid.uuid4()),
        "paciente_id": plano["pid"],
        "objetivo": plano["objetivo"],
        "kcal": plano["kcal"],
        "proteina_g": plano["proteina_g"],
        "carboidrato_g": plano["carboidrato_g"],
        "gordura_g": plano["gordura_g"],
        "restricoes": None,
        "conteudo": plano["conteudo"],
        "version": 1,
        "created_at": now_iso(),
    }
    db.meal_plans.insert_one(doc)
    print(f"  [OK] Plano alimentar (MongoDB): {plano['nome']}")

# ─── 7. Exames Laboratoriais (MongoDB direto - sem PDF/IA) ───────────────────
print("\n=== 7. EXAMES (MongoDB direto) ===")
exams_data = [
    {
        "paciente_id": pids[0], "nome": "Ana Paula",
        "file_name": "hemograma_ana_2026-05-10.pdf",
        "raw_text": "Hemograma + Bioquimica Geral - Ana Paula Ferreira - 10/05/2026",
        "markers": [
            {"nome": "Glicose", "valor": 92, "unidade": "mg/dL", "referencia": "70-99", "status": "normal"},
            {"nome": "Colesterol Total", "valor": 198, "unidade": "mg/dL", "referencia": "<200", "status": "normal"},
            {"nome": "HDL", "valor": 52, "unidade": "mg/dL", "referencia": ">50", "status": "normal"},
            {"nome": "LDL", "valor": 128, "unidade": "mg/dL", "referencia": "<130", "status": "normal"},
            {"nome": "Triglicerideos", "valor": 145, "unidade": "mg/dL", "referencia": "<150", "status": "normal"},
            {"nome": "TSH", "valor": 2.8, "unidade": "mUI/L", "referencia": "0.4-4.0", "status": "normal"},
            {"nome": "Ferritina", "valor": 18, "unidade": "ng/mL", "referencia": "15-150", "status": "normal"},
            {"nome": "Vitamina D", "valor": 22, "unidade": "ng/mL", "referencia": "30-100", "status": "baixo"},
        ],
        "resumo": "Perfil bioquimico dentro da normalidade, exceto Vitamina D levemente reduzida (22 ng/mL). Demais marcadores sem alteracoes.",
        "conduta_sugerida": "Suplementar Vitamina D3 2000-4000 UI/dia. Reavaliar em 3 meses. Monitorar ferritina nas proximas consultas.",
        "observacoes": "Paciente relatou cansaco e queda de cabelo.",
    },
    {
        "paciente_id": pids[1], "nome": "Carlos Eduardo",
        "file_name": "hormonal_carlos_2026-05-12.pdf",
        "raw_text": "Painel Hormonal + Bioquimica Esportiva - Carlos Eduardo Lima - 12/05/2026",
        "markers": [
            {"nome": "Testosterona Total", "valor": 620, "unidade": "ng/dL", "referencia": "300-1000", "status": "normal"},
            {"nome": "Glicose", "valor": 85, "unidade": "mg/dL", "referencia": "70-99", "status": "normal"},
            {"nome": "Creatinina", "valor": 1.1, "unidade": "mg/dL", "referencia": "0.7-1.2", "status": "normal"},
            {"nome": "CK Total", "valor": 280, "unidade": "U/L", "referencia": "38-308", "status": "normal"},
            {"nome": "Ferritina", "valor": 95, "unidade": "ng/mL", "referencia": "30-400", "status": "normal"},
            {"nome": "Vitamina D", "valor": 45, "unidade": "ng/mL", "referencia": "30-100", "status": "normal"},
            {"nome": "Hemoglobina", "valor": 15.2, "unidade": "g/dL", "referencia": "13.5-17.5", "status": "normal"},
        ],
        "resumo": "Perfil laboratorial excelente, compativel com atleta de alto rendimento. Todos os parametros dentro dos valores de referencia.",
        "conduta_sugerida": "Manter protocolo atual. Reavaliar em 6 meses. Monitorar CK em periodos de treinamento intenso.",
        "observacoes": "",
    },
    {
        "paciente_id": pids[2], "nome": "Mariana Costa",
        "file_name": "hemograma_mariana_2026-05-08.pdf",
        "raw_text": "Hemograma + Ferritina + Vitaminas - Mariana Costa Silva - 08/05/2026",
        "markers": [
            {"nome": "Hemoglobina", "valor": 11.2, "unidade": "g/dL", "referencia": "12-16", "status": "baixo"},
            {"nome": "Ferritina", "valor": 8, "unidade": "ng/mL", "referencia": "15-150", "status": "baixo"},
            {"nome": "Vitamina D", "valor": 18, "unidade": "ng/mL", "referencia": "30-100", "status": "baixo"},
            {"nome": "Vitamina B12", "valor": 320, "unidade": "pg/mL", "referencia": "200-900", "status": "normal"},
            {"nome": "Glicose", "valor": 78, "unidade": "mg/dL", "referencia": "70-99", "status": "normal"},
            {"nome": "TSH", "valor": 3.1, "unidade": "mUI/L", "referencia": "0.4-4.0", "status": "normal"},
        ],
        "resumo": "Anemia ferropriva confirmada com hemoglobina 11.2 g/dL e ferritina 8 ng/mL. Vitamina D gravemente deficiente. Demais parametros normais.",
        "conduta_sugerida": "Priorizar alimentos ricos em ferro (carnes, leguminosas, folhas escuras) + Vitamina C para absorcao. Suplementar Vitamina D3 4000-5000 UI/dia. Reavaliar em 60 dias.",
        "observacoes": "Paciente ja em uso de sulfato ferroso.",
    },
]

for ex in exams_data:
    doc = {
        "id": str(uuid.uuid4()),
        "paciente_id": ex["paciente_id"],
        "file_name": ex["file_name"],
        "raw_text": ex["raw_text"],
        "markers": ex["markers"],
        "resumo": ex["resumo"],
        "conduta_sugerida": ex["conduta_sugerida"],
        "observacoes": ex["observacoes"],
        "created_at": now_iso(),
    }
    db.exams.insert_one(doc)
    print(f"  [OK] Exames (MongoDB): {ex['nome']}")

# ─── 8. Agendamento de consultas ─────────────────────────────────────────────
print("\n=== 8. AGENDAMENTO (via token público) ===")
schedules = [
    {"token": leads[0]["token"], "date": "2026-05-28", "time": "09:00", "type": "Retorno"},
    {"token": leads[1]["token"], "date": "2026-05-29", "time": "10:30", "type": "Retorno"},
    {"token": leads[2]["token"], "date": "2026-05-30", "time": "14:00", "type": "Inicial"},
]
for sc in schedules:
    r = session.post(f"{BASE}/public/schedule", json=sc)
    ok(r, f"Agendamento: {sc['date']} {sc['time']}")

# ─── 9. Nudges (lembretes) ───────────────────────────────────────────────────
print("\n=== 9. NUDGES ===")
nudges = [
    {
        "pid": pids[0],
        "data": {
            "label": "Hidratação matinal",
            "trigger_text": "Lembrar a paciente de beber 500ml de água ao acordar antes do café da manhã",
            "hour": 7, "minute": 0, "weekdays": [0,1,2,3,4,5,6], "active": True
        }
    },
    {
        "pid": pids[1],
        "data": {
            "label": "Pré-treino",
            "trigger_text": "Lembrar sobre a refeição pré-treino: carboidrato + proteína 1h antes",
            "hour": 17, "minute": 30, "weekdays": [0,1,2,3,4], "active": True
        }
    },
]
for n in nudges:
    r = session.post(f"{BASE}/patients/{n['pid']}/nudges", json=n["data"], headers=auth())
    name = next(p["nome"] for p in patients if p["id"] == n["pid"])
    ok(r, f"Nudge: {name}")

# ─── 10. Dashboard ──────────────────────────────────────────────────────────
print("\n=== 10. DASHBOARD ===")
r = session.get(f"{BASE}/dashboard", headers=auth())
dash = ok(r, "Dashboard")
if dash:
    print(f"  → total_pacientes: {dash.get('total_pacientes', '?')}")
    print(f"  → leads_semana: {dash.get('leads_semana', '?')}")
    print(f"  → consultas_hoje: {dash.get('consultas_hoje', '?')}")

# ─── 11. Recordatório alimentar ──────────────────────────────────────────────
print("\n=== 11. RECORDATÓRIO 24H ===")
r = session.post(f"{BASE}/patients/{pids[0]}/recordatorios", headers=auth(), json={
    "data": "2026-05-19",
    "refeicoes": [
        {"nome": "Cafe da manha", "horario": "07:00", "alimentos": [
            {"nome": "Pao integral", "quantidade": "2 fatias (60g)"},
            {"nome": "Ovo mexido", "quantidade": "2 unidades (100g)"},
            {"nome": "Cafe com leite vegetal", "quantidade": "200ml"},
        ]},
        {"nome": "Lanche da manha", "horario": "10:00", "alimentos": [
            {"nome": "Banana", "quantidade": "1 unidade (100g)"},
            {"nome": "Amendoim", "quantidade": "30g"},
        ]},
        {"nome": "Almoco", "horario": "13:00", "alimentos": [
            {"nome": "Arroz integral", "quantidade": "4 colheres (100g)"},
            {"nome": "Feijao carioca", "quantidade": "1 concha (80g)"},
            {"nome": "File de frango grelhado", "quantidade": "150g"},
            {"nome": "Salada de folhas com azeite", "quantidade": "1 prato (80g)"},
        ]},
        {"nome": "Lanche da tarde", "horario": "16:00", "alimentos": [
            {"nome": "Iogurte de coco", "quantidade": "150g"},
            {"nome": "Granola sem lactose", "quantidade": "30g"},
        ]},
        {"nome": "Jantar", "horario": "20:00", "alimentos": [
            {"nome": "Salmao grelhado", "quantidade": "150g"},
            {"nome": "Batata doce cozida", "quantidade": "150g"},
            {"nome": "Brocolis no vapor", "quantidade": "100g"},
        ]},
    ],
    "observacoes": "Paciente relatou sensacao de inchaco apos o almoco. Considera reduzir feijao.",
})
ok(r, "Recordatório 24h: Ana Paula")

# ─── 12. Segunda avaliação (acompanhamento) ───────────────────────────────────
print("\n=== 12. SEGUNDA AVALIAÇÃO (RETORNO) ===")
r = session.post(f"{BASE}/patients/{pids[0]}/evaluations", headers=auth(), json={
    "peso": 71.2, "altura": 165, "idade": 35, "sexo": "F",
    "protocolo_dobras": "pollock3",
    "dobras": {"triceps": 21.0, "suprailiaca": 17.0, "coxa": 28.5},
    "perimetria": {
        "cintura": 79.0, "quadril": 97.5, "braco_d": 28.5,
        "coxa_d": 54.5, "panturrilha_d": 34.8
    },
    "nivel_atividade": 1.55,
    "objetivo": "emagrecimento",
})
ok(r, "2ª Avaliação: Ana Paula (-1,3kg em retorno)")

# ─── Resumo Final ─────────────────────────────────────────────────────────────
print("\n" + "="*55)
print("SEED CONCLUÍDO!")
print("="*55)
print(f"  Pacientes criados : {len(leads)}")
print(f"  IDs               : {pids}")
print(f"  Frontend          : http://localhost:3000")
print(f"  Backend/docs      : http://localhost:8001/docs")
print("="*55)
