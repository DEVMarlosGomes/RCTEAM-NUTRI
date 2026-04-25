"""EvoNut iteration 2 tests — Lab Exam upload (Claude AI marker extraction) + Branded PDF generation (WeasyPrint)."""
import os
import io
import uuid
import pytest
import requests
from weasyprint import HTML

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://base-doc-builder.preview.emergentagent.com').rstrip('/')
ADMIN_EMAIL = "admin@evonut.com"
ADMIN_PASSWORD = "evonut123"


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
               headers={"Content-Type": "application/json"}, timeout=20)
    assert r.status_code == 200, f"Admin login failed: {r.text}"
    return s


@pytest.fixture(scope="module")
def patient_id(admin_session):
    """Create a TEST_ patient via lead flow with anamnesis + evaluation."""
    r = requests.post(f"{BASE_URL}/api/leads",
                      json={"name": f"TEST_Iter2 {uuid.uuid4().hex[:6]}",
                            "phone": "+5511999990002",
                            "email": "test_iter2@example.com"}, timeout=15)
    assert r.status_code == 200
    lead = r.json()
    pid = lead["patient_id"]
    # submit anamnesis (so AI analysis later can run if needed)
    requests.post(f"{BASE_URL}/api/public/anamnesis",
                  json={"token": lead["token"],
                        "respostas": {"peso": 78, "altura": 170, "sexo": "F",
                                      "objetivo": "emagrecimento",
                                      "data_nascimento": "1992-05-10"}},
                  timeout=15)
    # add evaluation so meal-plan can be created later
    admin_session.post(f"{BASE_URL}/api/patients/{pid}/evaluations",
                       json={"peso": 78, "altura": 170, "idade": 33, "sexo": "F",
                             "protocolo_dobras": "pollock3",
                             "dobras": {"triceps": 22, "suprailiaca": 24, "coxa": 28},
                             "nivel_atividade": 1.55, "objetivo": "emagrecimento"},
                       headers={"Content-Type": "application/json"}, timeout=20)
    return pid


def _make_exam_pdf() -> bytes:
    """Generate a small synthetic lab-exam PDF in-memory (text-based, so pdfplumber can parse)."""
    html = """<html><body>
      <h1>Laboratorio Vida Plena</h1>
      <h2>Hemograma Completo e Bioquimica</h2>
      <p>Paciente: TEST_Iter2 | Data: 10/01/2026</p>
      <table border='1' cellpadding='6'>
        <tr><th>Marcador</th><th>Valor</th><th>Unidade</th><th>Referencia</th></tr>
        <tr><td>Hemoglobina</td><td>13.8</td><td>g/dL</td><td>12.0 - 16.0</td></tr>
        <tr><td>Glicemia em jejum</td><td>102</td><td>mg/dL</td><td>70 - 99</td></tr>
        <tr><td>Colesterol Total</td><td>215</td><td>mg/dL</td><td>< 200</td></tr>
        <tr><td>HDL</td><td>52</td><td>mg/dL</td><td>> 40</td></tr>
        <tr><td>LDL</td><td>140</td><td>mg/dL</td><td>< 130</td></tr>
        <tr><td>Triglicerides</td><td>165</td><td>mg/dL</td><td>< 150</td></tr>
        <tr><td>Vitamina D (25-OH)</td><td>22</td><td>ng/mL</td><td>30 - 100</td></tr>
        <tr><td>Vitamina B12</td><td>410</td><td>pg/mL</td><td>200 - 900</td></tr>
        <tr><td>Ferritina</td><td>85</td><td>ng/mL</td><td>15 - 150</td></tr>
        <tr><td>TSH</td><td>2.4</td><td>uUI/mL</td><td>0.4 - 4.5</td></tr>
        <tr><td>Hemoglobina Glicada (HbA1c)</td><td>5.7</td><td>%</td><td>< 5.7</td></tr>
        <tr><td>ALT</td><td>28</td><td>U/L</td><td>< 35</td></tr>
      </table>
    </body></html>"""
    return HTML(string=html).write_pdf()


# ---------- Auth guard ----------
class TestAuthGuard:
    def test_upload_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/patients/anything/exams",
                          files={"file": ("x.pdf", b"%PDF-1.4\n", "application/pdf")}, timeout=20)
        assert r.status_code == 401

    def test_list_exams_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/patients/anything/exams", timeout=15)
        assert r.status_code == 401

    def test_pdf_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/patients/anything/meal-plan/anything/pdf", timeout=15)
        assert r.status_code == 401

    def test_other_nutri_patient_404(self, admin_session):
        # Admin tries to access non-existent patient → 404 (auth guard via nutricionista_id)
        r = admin_session.get(f"{BASE_URL}/api/patients/{uuid.uuid4()}/exams", timeout=15)
        assert r.status_code == 404


# ---------- Exam validation ----------
class TestExamValidation:
    def test_reject_non_pdf(self, admin_session, patient_id):
        r = admin_session.post(f"{BASE_URL}/api/patients/{patient_id}/exams",
                               files={"file": ("x.txt", b"hello world", "text/plain")},
                               timeout=20)
        assert r.status_code == 400

    def test_reject_unreadable_pdf(self, admin_session, patient_id):
        # Empty/blank PDF (no text) → should 400 with empty/illegible message
        blank = HTML(string="<html><body></body></html>").write_pdf()
        r = admin_session.post(f"{BASE_URL}/api/patients/{patient_id}/exams",
                               files={"file": ("blank.pdf", blank, "application/pdf")},
                               timeout=60)
        assert r.status_code == 400, r.text


# ---------- Exam CRUD with AI ----------
class TestExamCRUD:
    @pytest.fixture(scope="class")
    def uploaded_exam(self, admin_session, patient_id):
        pdf_bytes = _make_exam_pdf()
        r = admin_session.post(f"{BASE_URL}/api/patients/{patient_id}/exams",
                               files={"file": ("hemograma.pdf", pdf_bytes, "application/pdf")},
                               timeout=120)
        if r.status_code == 503:
            pytest.skip(f"AI budget/availability issue: {r.text[:120]}")
        assert r.status_code == 200, r.text
        return r.json()

    def test_upload_exam_response_shape(self, uploaded_exam, patient_id):
        body = uploaded_exam
        for k in ["id", "paciente_id", "file_name", "markers", "resumo",
                  "conduta_sugerida", "observacoes", "created_at"]:
            assert k in body, f"missing key {k}"
        assert body["paciente_id"] == patient_id
        assert body["file_name"] == "hemograma.pdf"
        assert isinstance(body["markers"], list)
        assert "raw_text" not in body
        # marker schema
        if body["markers"]:
            m = body["markers"][0]
            for mk in ["nome", "valor", "status"]:
                assert mk in m, f"marker missing {mk}"
            assert m["status"] in ("normal", "atencao", "prioridade")

    def test_markers_classification(self, uploaded_exam):
        # We expect AI to flag at least one of the abnormal values (Vitamina D 22 / Glicemia 102 / Colesterol 215)
        names = [m.get("nome", "").lower() for m in uploaded_exam["markers"]]
        assert len(uploaded_exam["markers"]) >= 3, f"too few markers: {len(uploaded_exam['markers'])}"
        # at least one prioridade or atencao
        statuses = [m.get("status") for m in uploaded_exam["markers"]]
        assert any(s in ("atencao", "prioridade") for s in statuses), \
            f"expected at least one flagged marker, got {statuses}"

    def test_list_exams(self, admin_session, patient_id, uploaded_exam):
        r = admin_session.get(f"{BASE_URL}/api/patients/{patient_id}/exams", timeout=15)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list) and len(rows) >= 1
        ids = [e["id"] for e in rows]
        assert uploaded_exam["id"] in ids
        # raw_text must NOT be returned
        assert all("raw_text" not in e for e in rows)

    def test_patch_observacoes(self, admin_session, patient_id, uploaded_exam):
        r = admin_session.patch(
            f"{BASE_URL}/api/patients/{patient_id}/exams/{uploaded_exam['id']}",
            json={"observacoes": "TEST_observacao_clinica"},
            headers={"Content-Type": "application/json"}, timeout=15)
        assert r.status_code == 200
        # verify persisted via list
        rows = admin_session.get(f"{BASE_URL}/api/patients/{patient_id}/exams", timeout=15).json()
        e = next(x for x in rows if x["id"] == uploaded_exam["id"])
        assert e["observacoes"] == "TEST_observacao_clinica"

    def test_patient_detail_includes_exams(self, admin_session, patient_id, uploaded_exam):
        """Per review request: GET /api/patients/{id} should now include exams[]."""
        r = admin_session.get(f"{BASE_URL}/api/patients/{patient_id}", timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert "exams" in body, f"patient detail missing 'exams' key. Keys: {list(body.keys())}"
        assert isinstance(body["exams"], list)
        ids = [e["id"] for e in body["exams"]]
        assert uploaded_exam["id"] in ids

    def test_delete_exam(self, admin_session, patient_id, uploaded_exam):
        r = admin_session.delete(
            f"{BASE_URL}/api/patients/{patient_id}/exams/{uploaded_exam['id']}", timeout=15)
        assert r.status_code == 200
        rows = admin_session.get(f"{BASE_URL}/api/patients/{patient_id}/exams", timeout=15).json()
        ids = [e["id"] for e in rows]
        assert uploaded_exam["id"] not in ids


# ---------- PDF meal plan ----------
class TestMealPlanPDF:
    @pytest.fixture(scope="class")
    def plan_id(self, admin_session, patient_id):
        # try to create a meal plan; if AI budget fails, skip class
        r = admin_session.post(f"{BASE_URL}/api/patients/{patient_id}/meal-plan",
                               json={"objetivo": "emagrecimento", "restricoes": "Sem lactose"},
                               headers={"Content-Type": "application/json"}, timeout=120)
        if r.status_code == 503:
            pytest.skip(f"AI budget: {r.text[:120]}")
        assert r.status_code == 200, r.text
        return r.json()["id"]

    def test_pdf_returns_valid_pdf(self, admin_session, patient_id, plan_id):
        r = admin_session.get(
            f"{BASE_URL}/api/patients/{patient_id}/meal-plan/{plan_id}/pdf", timeout=60)
        assert r.status_code == 200, r.text[:200]
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert "attachment" in r.headers.get("content-disposition", "").lower()
        assert "filename=" in r.headers.get("content-disposition", "").lower()
        body = r.content
        assert body[:5] == b"%PDF-", f"PDF magic missing, got {body[:8]}"
        assert len(body) > 5000, f"PDF suspiciously small: {len(body)} bytes"

    def test_pdf_invalid_plan_id_404(self, admin_session, patient_id):
        r = admin_session.get(
            f"{BASE_URL}/api/patients/{patient_id}/meal-plan/{uuid.uuid4()}/pdf", timeout=15)
        assert r.status_code == 404

    def test_pdf_invalid_patient_id_404(self, admin_session, plan_id):
        r = admin_session.get(
            f"{BASE_URL}/api/patients/{uuid.uuid4()}/meal-plan/{plan_id}/pdf", timeout=15)
        assert r.status_code == 404
