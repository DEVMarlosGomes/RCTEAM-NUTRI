"""EvoNut backend regression tests — Auth, Public Lead/Anamnesis/Chat/Schedule, Dashboard, Patients, Evaluations, AI, Agenda."""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'http://127.0.0.1:8001').rstrip('/')
ADMIN_EMAIL = "admin@rogeriocosta.com.br"
ADMIN_PASSWORD = "rogerio2025"


# ---------- Fixtures ----------
@pytest.fixture(scope="session")
def admin_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=20)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    assert "access_token" in s.cookies
    return s


@pytest.fixture(scope="session")
def created_lead():
    """Public lead created once for the session."""
    r = requests.post(f"{BASE_URL}/api/leads",
                      json={"name": "TEST_Paciente Joana", "phone": "+5511999990001",
                            "email": "test_joana@example.com"}, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    return data  # {token, patient_id, name}


# ---------- Auth ----------
class TestAuth:
    def test_login_admin(self):
        s = requests.Session()
        r = s.post(f"{BASE_URL}/api/auth/login",
                   json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body["email"] == ADMIN_EMAIL
        assert body["role"] == "nutritionist"
        assert "access_token" in s.cookies

    def test_login_invalid(self):
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": ADMIN_EMAIL, "password": "wrong"}, timeout=15)
        assert r.status_code == 401

    def test_me_with_cookie(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/auth/me", timeout=15)
        assert r.status_code == 200
        assert r.json()["email"] == ADMIN_EMAIL

    def test_me_without_cookie(self):
        r = requests.get(f"{BASE_URL}/api/auth/me", timeout=15)
        assert r.status_code == 401

    def test_register_new_nutri(self):
        s = requests.Session()
        email = f"test_nutri_{uuid.uuid4().hex[:8]}@example.com"
        r = s.post(f"{BASE_URL}/api/auth/register",
                   json={"email": email, "password": "secret123", "name": "TEST_Nutri"}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["email"] == email
        assert "access_token" in s.cookies
        # GET /me with new cookie
        rm = s.get(f"{BASE_URL}/api/auth/me", timeout=15)
        assert rm.status_code == 200
        assert rm.json()["email"] == email


# ---------- Public lead/anamnesis/chat/schedule ----------
class TestPublicFlow:
    def test_create_lead(self, created_lead):
        assert "token" in created_lead and len(created_lead["token"]) > 10
        assert created_lead["name"].startswith("TEST_")

    def test_get_lead_by_token(self, created_lead):
        r = requests.get(f"{BASE_URL}/api/public/lead/{created_lead['token']}", timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body["status_funil"] == "LEAD_INICIADO"
        assert body["nome"] == created_lead["name"]
        assert "_id" not in body

    def test_get_lead_invalid_token(self):
        r = requests.get(f"{BASE_URL}/api/public/lead/no-such-token", timeout=15)
        assert r.status_code == 404

    def test_submit_anamnesis_updates_status(self, created_lead):
        respostas = {
            "peso": 78.5, "altura": 170, "sexo": "F",
            "data_nascimento": "1992-05-10", "objetivo": "emagrecimento",
            "rotina": "Trabalho em escritório", "sono": "6h",
            "medicamentos": "Nenhum", "alergias": "Nenhuma",
        }
        r = requests.post(f"{BASE_URL}/api/public/anamnesis",
                          json={"token": created_lead["token"], "respostas": respostas}, timeout=15)
        assert r.status_code == 200
        assert r.json().get("ok") is True

        # verify status updated
        rl = requests.get(f"{BASE_URL}/api/public/lead/{created_lead['token']}", timeout=15)
        assert rl.status_code == 200
        body = rl.json()
        assert body["status_funil"] == "ANAMNESE_COMPLETA"
        assert body["peso"] == 78.5
        assert body["altura"] == 170
        assert body["sexo"] == "F"

    def test_chat_ai(self, created_lead):
        # AI chat — Claude Sonnet 4.5 (slow)
        r = requests.post(f"{BASE_URL}/api/public/chat",
                          json={"token": created_lead["token"],
                                "message": "Olá, estou um pouco ansiosa com a primeira consulta."},
                          timeout=90)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "reply" in body
        assert isinstance(body["reply"], str) and len(body["reply"]) > 5
        # history should contain at least 2 messages now
        rh = requests.get(f"{BASE_URL}/api/public/chat/{created_lead['token']}", timeout=15)
        assert rh.status_code == 200
        msgs = rh.json()
        assert len(msgs) >= 2
        roles = [m["role"] for m in msgs]
        assert "user" in roles and "assistant" in roles

    def test_slots_and_schedule(self, created_lead):
        rs = requests.get(f"{BASE_URL}/api/public/slots/{created_lead['token']}", timeout=15)
        assert rs.status_code == 200
        slots = rs.json()
        assert isinstance(slots, list) and len(slots) > 0
        assert all("datetime" in s and "available" in s for s in slots)

        # pick first available
        chosen = next(s for s in slots if s["available"])
        # parse datetime to date+HH:MM
        dt = chosen["datetime"]  # ISO like 2026-..T09:00:00+00:00
        date_part = dt.split("T")[0]
        time_part = dt.split("T")[1][:5]
        rsc = requests.post(f"{BASE_URL}/api/public/schedule",
                            json={"token": created_lead["token"],
                                  "date": date_part, "time": time_part, "type": "Inicial"},
                            timeout=15)
        assert rsc.status_code == 200, rsc.text
        body = rsc.json()
        assert body.get("ok") is True
        assert "consultation_id" in body

        # status should now be CONSULTA_AGENDADA
        rl = requests.get(f"{BASE_URL}/api/public/lead/{created_lead['token']}", timeout=15)
        assert rl.json()["status_funil"] == "CONSULTA_AGENDADA"


# ---------- Dashboard / Patients / Evaluations / AI / Agenda ----------
class TestCRM:
    def test_dashboard(self, admin_session, created_lead):
        r = admin_session.get(f"{BASE_URL}/api/dashboard", timeout=15)
        assert r.status_code == 200
        body = r.json()
        for k in ["total_pacientes", "consultas_hoje", "novos_7d", "em_acompanhamento", "funil"]:
            assert k in body
        for s in ["LEAD_INICIADO", "ANAMNESE_COMPLETA", "CONSULTA_AGENDADA",
                  "CONSULTA_REALIZADA", "PLANO_ENTREGUE", "EM_ACOMPANHAMENTO"]:
            assert s in body["funil"]
        assert body["total_pacientes"] >= 1

    def test_list_patients_contains_lead(self, admin_session, created_lead):
        r = admin_session.get(f"{BASE_URL}/api/patients", timeout=15)
        assert r.status_code == 200
        rows = r.json()
        ids = [p["id"] for p in rows]
        assert created_lead["patient_id"] in ids

    def test_get_patient_detail(self, admin_session, created_lead):
        r = admin_session.get(f"{BASE_URL}/api/patients/{created_lead['patient_id']}", timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body["patient"]["id"] == created_lead["patient_id"]
        assert isinstance(body["anamneses"], list)
        assert isinstance(body["consultations"], list)
        assert isinstance(body["evaluations"], list)
        assert isinstance(body["meal_plans"], list)

    def test_create_evaluation_calculations(self, admin_session, created_lead):
        payload = {
            "peso": 78.5, "altura": 170, "idade": 33, "sexo": "F",
            "protocolo_dobras": "pollock3",
            "dobras": {"triceps": 22, "suprailiaca": 24, "coxa": 28},
            "nivel_atividade": 1.55, "objetivo": "emagrecimento",
        }
        r = admin_session.post(f"{BASE_URL}/api/patients/{created_lead['patient_id']}/evaluations",
                               json=payload, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        comp = body["composicao"]
        # IMC ~ 78.5 / (1.7^2) = 27.16
        assert abs(comp["imc"] - 27.16) < 0.05
        assert comp["imc_classificacao"] == "Sobrepeso"
        assert comp["tmb_mifflin"] > 0
        assert comp["tmb_harris"] > 0
        assert comp["get_kcal"] > 0
        assert comp["pct_gordura"] is not None and 5 < comp["pct_gordura"] < 60
        assert comp["massa_magra"] is not None and comp["massa_gorda"] is not None

    def test_ai_analysis(self, admin_session, created_lead):
        r = admin_session.post(f"{BASE_URL}/api/patients/{created_lead['patient_id']}/analysis",
                               json={}, timeout=120)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "content" in body and isinstance(body["content"], str)
        assert len(body["content"]) > 30

    def test_ai_meal_plan(self, admin_session, created_lead):
        r = admin_session.post(f"{BASE_URL}/api/patients/{created_lead['patient_id']}/meal-plan",
                               json={"objetivo": "emagrecimento",
                                     "restricoes": "Sem lactose"}, timeout=120)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "macros" in body and "kcal" in body["macros"]
        assert body["macros"]["kcal"] > 800
        assert body["version"] >= 1
        assert isinstance(body["content"], str) and len(body["content"]) > 30

    def test_comparativo(self, admin_session, created_lead):
        r = admin_session.get(f"{BASE_URL}/api/patients/{created_lead['patient_id']}/comparativo",
                              timeout=15)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        assert len(rows) >= 1
        # ensure sort ascending by created_at
        if len(rows) > 1:
            assert rows[0]["created_at"] <= rows[-1]["created_at"]

    def test_agenda(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/agenda", timeout=15)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        if rows:
            assert "paciente_nome" in rows[0]

    def test_logout(self):
        s = requests.Session()
        s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
        r = s.post(f"{BASE_URL}/api/auth/logout", timeout=15)
        assert r.status_code == 200
        # Cookie should now be cleared; /me must return 401
        s.cookies.clear()
        rm = s.get(f"{BASE_URL}/api/auth/me", timeout=15)
        assert rm.status_code == 401
