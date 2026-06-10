"""Iteration 3 — Agents (Área do Nutricionista), Consultório (Agente 2),
Área do Paciente (Agente 3), patient signup & permissions.

The 3 agents are seeded on startup. AI (Claude via emergentintegrations) is real
and slow — chat tests only assert non-5xx + presence of `reply`.
"""
import io
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://deploy-projeto-1.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@rogeriocosta.com.br"
ADMIN_PASSWORD = "rogerio2025"


# ---------- Fixtures ----------
@pytest.fixture(scope="session")
def nutri_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    body = r.json()
    assert body.get("role") == "nutritionist"
    return s


@pytest.fixture(scope="session")
def patient_signup_data(nutri_session):
    """Create a fresh lead + patient signup, return (patient_session, lead_token, patient_id, email)."""
    email = f"TEST_pac_{uuid.uuid4().hex[:8]}@example.com".lower()
    r = nutri_session.post(f"{API}/leads", json={"name": "TEST Paciente Iter3", "phone": "11999990000", "email": email})
    assert r.status_code == 200, f"lead create failed: {r.text}"
    lead = r.json()
    token = lead["token"]
    pid = lead["patient_id"]

    ps = requests.Session()
    r2 = ps.post(f"{API}/patient/signup", json={"token": token, "password": "patient123"}, timeout=30)
    assert r2.status_code == 200, f"signup failed: {r2.status_code} {r2.text}"
    body = r2.json()
    assert body["role"] == "patient"
    assert body["email"].lower() == email.lower()
    return {"session": ps, "token": token, "patient_id": pid, "email": email.lower()}


# ===========================================================================
# AGENTS — Área do Nutricionista
# ===========================================================================
class TestAgents:
    def test_list_agents_requires_auth(self):
        r = requests.get(f"{API}/agents", timeout=15)
        assert r.status_code == 401, f"expected 401 got {r.status_code}"

    def test_list_agents_ok(self, nutri_session):
        r = nutri_session.get(f"{API}/agents", timeout=15)
        assert r.status_code == 200
        agents = r.json()
        assert isinstance(agents, list) and len(agents) == 3
        codes = sorted(a["code"] for a in agents)
        assert codes == ["agent1", "agent2", "agent3"]
        for a in agents:
            assert "documents_count" in a
            assert "base_prompt" in a
            assert isinstance(a["documents_count"], int)

    def test_get_agent_detail(self, nutri_session):
        r = nutri_session.get(f"{API}/agents/agent1", timeout=15)
        assert r.status_code == 200
        a = r.json()
        assert a["code"] == "agent1"
        assert a["prompt_max_chars"] == 50000
        assert isinstance(a["prompt_chars"], int) and a["prompt_chars"] > 0
        assert isinstance(a["documents"], list)
        assert "base_prompt" in a and len(a["base_prompt"]) > 0

    def test_get_agent_unknown(self, nutri_session):
        r = nutri_session.get(f"{API}/agents/INVALID", timeout=15)
        assert r.status_code == 404

    def test_patch_agent_prompt(self, nutri_session):
        # Capture original prompt to restore at end
        orig = nutri_session.get(f"{API}/agents/agent2").json()["base_prompt"]
        new_prompt = orig + "\n\n[TEST_ITER3_MARKER]"
        r = nutri_session.patch(f"{API}/agents/agent2", json={"base_prompt": new_prompt})
        assert r.status_code == 200
        assert r.json()["base_prompt"].endswith("[TEST_ITER3_MARKER]")
        # restore
        nutri_session.patch(f"{API}/agents/agent2", json={"base_prompt": orig})

    def test_upload_text_file(self, nutri_session):
        files = {"file": ("teste.txt", b"Conteudo de teste para Agente 1. Calorias 2000 kcal.", "text/plain")}
        r = nutri_session.post(f"{API}/agents/agent1/documents", files=files, timeout=30)
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["agent_code"] == "agent1"
        assert doc["chars"] > 0
        assert "id" in doc
        # cleanup
        nutri_session.delete(f"{API}/agents/agent1/documents/{doc['id']}")

    def test_upload_minimal_pdf(self, nutri_session):
        # Generate a minimal valid PDF using pypdf so pdfplumber can parse it
        try:
            from pypdf import PdfWriter
        except Exception:
            try:
                from PyPDF2 import PdfWriter
            except Exception:
                pytest.skip("No PDF writer lib installed")
        # Build a 1-page PDF via reportlab if available, else skip — pdfplumber needs content
        try:
            from reportlab.pdfgen import canvas
        except Exception:
            pytest.skip("reportlab not installed; cannot build a real text PDF")
        buf = io.BytesIO()
        c = canvas.Canvas(buf)
        c.drawString(100, 750, "Documento de treinamento Agente 2 — referencia clinica.")
        c.drawString(100, 730, "Vitamina D 30-100 ng/mL. Glicemia <100 mg/dL.")
        c.save()
        buf.seek(0)
        files = {"file": ("ref.pdf", buf.getvalue(), "application/pdf")}
        r = nutri_session.post(f"{API}/agents/agent2/documents", files=files, timeout=30)
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["chars"] > 10
        # cleanup
        nutri_session.delete(f"{API}/agents/agent2/documents/{doc['id']}")

    def test_add_text_document(self, nutri_session):
        r = nutri_session.post(
            f"{API}/agents/agent3/documents/text",
            json={"title": "TEST Diretrizes", "content": "Regra: nunca recomendar dieta sem aprovação do nutricionista."},
        )
        assert r.status_code == 200
        doc = r.json()
        assert doc["title"] == "TEST Diretrizes"
        assert doc["chars"] > 0
        doc_id = doc["id"]
        # verify it appears in get_agent.documents
        r2 = nutri_session.get(f"{API}/agents/agent3")
        ids = [d["id"] for d in r2.json()["documents"]]
        assert doc_id in ids
        # delete
        r3 = nutri_session.delete(f"{API}/agents/agent3/documents/{doc_id}")
        assert r3.status_code == 200
        # verify gone
        r4 = nutri_session.get(f"{API}/agents/agent3")
        ids2 = [d["id"] for d in r4.json()["documents"]]
        assert doc_id not in ids2

    def test_add_text_document_invalid_agent(self, nutri_session):
        r = nutri_session.post(
            f"{API}/agents/INVALID/documents/text",
            json={"title": "x", "content": "y"},
        )
        assert r.status_code == 404
        body = r.json()
        # FastAPI returns {detail: "..."}
        assert "Agente desconhecido" in (body.get("detail") or "")

    def test_delete_unknown_doc_returns_404(self, nutri_session):
        r = nutri_session.delete(f"{API}/agents/agent1/documents/does-not-exist-xyz")
        assert r.status_code == 404


# ===========================================================================
# PATIENT SIGNUP & AUTH
# ===========================================================================
class TestPatientAuthFlow:
    def test_signup_creates_patient_role(self, patient_signup_data):
        s = patient_signup_data["session"]
        r = s.get(f"{API}/auth/me")
        assert r.status_code == 200
        body = r.json()
        assert body["role"] == "patient"
        assert body["email"].lower() == patient_signup_data["email"]

    def test_signup_duplicate_email_400(self, nutri_session, patient_signup_data):
        email = patient_signup_data["email"]
        r = nutri_session.post(f"{API}/leads", json={"name": "dup", "phone": "11", "email": email})
        assert r.status_code == 200
        token = r.json()["token"]
        s = requests.Session()
        r2 = s.post(f"{API}/patient/signup", json={"token": token, "password": "abc12345"})
        assert r2.status_code == 400

    def test_patient_me(self, patient_signup_data):
        s = patient_signup_data["session"]
        r = s.get(f"{API}/patient/me")
        assert r.status_code == 200
        body = r.json()
        assert body["user"]["role"] == "patient"
        assert body["patient"]["id"] == patient_signup_data["patient_id"]
        assert body["patient"]["email"].lower() == patient_signup_data["email"]

    def test_patient_diet_empty(self, patient_signup_data):
        s = patient_signup_data["session"]
        r = s.get(f"{API}/patient/diet")
        assert r.status_code == 200
        assert r.json() == {"plan": None}

    def test_nutri_cannot_access_patient_me(self, nutri_session):
        r = nutri_session.get(f"{API}/patient/me")
        assert r.status_code == 403

    def test_patient_cannot_access_agents(self, patient_signup_data):
        s = patient_signup_data["session"]
        r = s.get(f"{API}/agents")
        assert r.status_code == 403


# ===========================================================================
# CONSULTÓRIO — Agente 2
# ===========================================================================
class TestConsultorio:
    def test_list_patients(self, nutri_session, patient_signup_data):
        r = nutri_session.get(f"{API}/consultorio/patients")
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        pid = patient_signup_data["patient_id"]
        assert any(p["id"] == pid for p in rows), "newly created patient should appear"
        for p in rows[:3]:
            assert "id" in p and "nome" in p

    def test_consultorio_chat_unknown_patient_404(self, nutri_session):
        r = nutri_session.post(
            f"{API}/consultorio/chat",
            json={"patient_id": "non-existent-id-xyz", "message": "ola"},
            timeout=30,
        )
        assert r.status_code == 404

    def test_consultorio_chat_real(self, nutri_session, patient_signup_data):
        pid = patient_signup_data["patient_id"]
        r = nutri_session.post(
            f"{API}/consultorio/chat",
            json={"patient_id": pid, "message": "Resuma o que voce sabe deste paciente em 1 frase."},
            timeout=60,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "reply" in body and isinstance(body["reply"], str) and len(body["reply"]) > 0
        assert "session_id" in body
        # history
        time.sleep(0.5)
        r2 = nutri_session.get(f"{API}/consultorio/chat/{pid}")
        assert r2.status_code == 200
        msgs = r2.json()
        assert len(msgs) >= 2  # user + assistant

    def test_consultorio_requires_nutri(self, patient_signup_data):
        s = patient_signup_data["session"]
        r = s.get(f"{API}/consultorio/patients")
        assert r.status_code == 403


# ===========================================================================
# ÁREA DO PACIENTE — Agente 3
# ===========================================================================
class TestPatientArea:
    def test_patient_chat(self, patient_signup_data):
        s = patient_signup_data["session"]
        r = s.post(
            f"{API}/patient/chat",
            json={"message": "Oi, qual e meu objetivo?"},
            timeout=60,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "reply" in body and isinstance(body["reply"], str) and len(body["reply"]) > 0
        assert "session_id" in body
        # history
        r2 = s.get(f"{API}/patient/chat")
        assert r2.status_code == 200
        msgs = r2.json()
        assert len(msgs) >= 2

    def test_patient_chat_requires_patient(self, nutri_session):
        r = nutri_session.post(f"{API}/patient/chat", json={"message": "hi"})
        assert r.status_code == 403


# ===========================================================================
# REGRESSION — public chat (now uses Agente 1 prompt)
# ===========================================================================
class TestPublicChatRegression:
    def test_public_chat_still_works(self, nutri_session):
        # Create a quick lead to test the public chat (which requires a valid token)
        email = f"TEST_pub_{uuid.uuid4().hex[:6]}@example.com"
        r = nutri_session.post(f"{API}/leads", json={"name": "TEST Pub", "phone": "11", "email": email})
        assert r.status_code == 200
        token = r.json()["token"]
        # send anamnese minimal so chat has context (some implementations require it)
        s = requests.Session()
        r2 = s.post(
            f"{API}/public/chat",
            json={"token": token, "message": "ola"},
            timeout=60,
        )
        # accept 200 (works) or 404 if anamnese required — we just want no 5xx
        assert r2.status_code < 500, f"public chat broken: {r2.status_code} {r2.text[:200]}"

    def test_auth_me_returns_role(self, nutri_session):
        r = nutri_session.get(f"{API}/auth/me")
        assert r.status_code == 200
        body = r.json()
        assert body.get("role") == "nutritionist"
