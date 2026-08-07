import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://127.0.0.1:8001").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@rogeriocosta.com.br"
ADMIN_PASSWORD = "rogerio2025"


@pytest.fixture(scope="session")
def nutri_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    if r.status_code != 200:
        email = f"test_iter6_nutri_{uuid.uuid4().hex[:8]}@example.com"
        r = s.post(
            f"{API}/auth/register",
            json={"email": email, "password": "secret123", "name": "TEST Iter6 Nutri"},
            timeout=30,
        )
    assert r.status_code == 200, f"nutritionist auth failed: {r.status_code} {r.text}"
    return s


@pytest.fixture()
def patient_id(nutri_session):
    email = f"test_orient_{uuid.uuid4().hex[:8]}@example.com"
    r = nutri_session.post(
        f"{API}/leads",
        json={"name": "TEST Orientacoes", "phone": "11999993333", "email": email},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    return r.json()["patient_id"]


def test_orientacoes_crud_and_plan_duplicate(nutri_session, patient_id):
    payload = {
        "titulo": f"TEST Hidratação {uuid.uuid4().hex[:6]}",
        "categoria": "Rotina",
        "objetivos": ["emagrecimento", "adesao"],
        "tags": ["agua", "habito"],
        "conteudo": "Beber 35 ml/kg ao dia e distribuir a ingestão ao longo do dia.",
        "ativo": True,
    }

    created = nutri_session.post(f"{API}/orientacoes", json=payload, timeout=20)
    assert created.status_code == 201, created.text
    orient = created.json()
    oid = orient["id"]

    listing = nutri_session.get(f"{API}/orientacoes?q=Hidratação", timeout=20)
    assert listing.status_code == 200
    assert any(item["id"] == oid for item in listing.json())

    updated = nutri_session.put(
        f"{API}/orientacoes/{oid}",
        json={**payload, "conteudo": "Atualizada: reforçar 35 ml/kg e monitorar coloração da urina."},
        timeout=20,
    )
    assert updated.status_code == 200, updated.text
    assert "Atualizada" in updated.json()["conteudo"]

    plano = nutri_session.post(
        f"{API}/patients/{patient_id}/planos-manuais",
        json={
            "titulo": "Plano TEST Orientações",
            "meta_kcal": 2000,
            "meta_proteina_g": 150,
            "meta_carboidrato_g": 220,
            "meta_lipidio_g": 70,
            "orientacao_ids": [oid],
            "refeicoes": [],
            "observacoes": "Plano de teste",
        },
        timeout=20,
    )
    assert plano.status_code == 201, plano.text
    plano_data = plano.json()
    pmid = plano_data["id"]
    assert plano_data["versao"] >= 1
    assert plano_data["orientacoes"][0]["id"] == oid

    duplicated = nutri_session.post(f"{API}/patients/{patient_id}/planos-manuais/{pmid}/duplicar", timeout=20)
    assert duplicated.status_code == 201, duplicated.text
    duplicated_data = duplicated.json()
    assert duplicated_data["id"] != pmid
    assert duplicated_data["origem_plano_id"] == pmid
    assert duplicated_data["versao"] == plano_data["versao"] + 1

    history = nutri_session.get(f"{API}/patients/{patient_id}/planos-manuais/{pmid}/historico", timeout=20)
    assert history.status_code == 200
    history_rows = history.json()
    assert any(row["motivo"] == "create" for row in history_rows)

    template = nutri_session.post(
        f"{API}/patients/{patient_id}/planos-manuais/{pmid}/template",
        json={"nome": "Template TEST Orientações", "categoria": "Hipertrofia"},
        timeout=20,
    )
    assert template.status_code == 201, template.text
    template_data = template.json()
    assert template_data["nome"] == "Template TEST Orientações"
    assert template_data["orientacoes"][0]["id"] == oid

    template_list = nutri_session.get(f"{API}/plano-templates?q=Template TEST", timeout=20)
    assert template_list.status_code == 200
    assert any(item["id"] == template_data["id"] for item in template_list.json())

    applied = nutri_session.post(
        f"{API}/patients/{patient_id}/plano-templates/{template_data['id']}/aplicar",
        timeout=20,
    )
    assert applied.status_code == 201, applied.text
    applied_data = applied.json()
    assert applied_data["origem_template_id"] == template_data["id"]
    assert applied_data["versao"] == duplicated_data["versao"] + 1

    deleted = nutri_session.delete(f"{API}/orientacoes/{oid}", timeout=20)
    assert deleted.status_code == 200, deleted.text
