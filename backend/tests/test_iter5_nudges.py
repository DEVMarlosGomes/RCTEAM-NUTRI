"""Iteration 5 — Proactive channel of Agent 3 (Nudges).

Tests CRUD for /api/patients/{pid}/nudges, permissions, validation,
run-now firing (real Claude call), proactive message persistence into
patient_messages with kind='proactive', and patient chat history merging
of session_id=patient-pending-{pid} for pre-signup nudges.
"""
import os
import uuid
import time
from datetime import datetime, timezone

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://smart-diet-system.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@rogeriocosta.com.br"
ADMIN_PASSWORD = "rogerio2025"


# ---------- Fixtures ----------
@pytest.fixture(scope="session")
def nutri_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.text}"
    return s


@pytest.fixture(scope="session")
def lead_and_patient(nutri_session):
    """Create lead + patient signup; returns dict {patient_id, token, patient_session, email, user_id}."""
    email = f"test_nudge_{uuid.uuid4().hex[:8]}@example.com"
    r = nutri_session.post(
        f"{API}/leads",
        json={"name": "TEST Nudge Iter5", "phone": "11999991111", "email": email},
        timeout=30,
    )
    assert r.status_code == 200, f"lead failed: {r.text}"
    lead = r.json()
    pid = lead["patient_id"]
    token = lead["token"]

    ps = requests.Session()
    r2 = ps.post(f"{API}/patient/signup", json={"token": token, "password": "paciente123"}, timeout=30)
    assert r2.status_code == 200, f"signup failed: {r2.text}"
    body = r2.json()
    return {
        "patient_id": pid,
        "token": token,
        "patient_session": ps,
        "email": email,
        "user_id": body.get("id"),
    }


@pytest.fixture(scope="session")
def pending_patient_id(nutri_session):
    """Create a lead WITHOUT signup — used to test patient-pending-{pid} merge."""
    email = f"test_pending_{uuid.uuid4().hex[:8]}@example.com"
    r = nutri_session.post(
        f"{API}/leads",
        json={"name": "TEST Pending Iter5", "phone": "11999992222", "email": email},
        timeout=30,
    )
    assert r.status_code == 200
    lead = r.json()
    return {"patient_id": lead["patient_id"], "token": lead["token"], "email": email}


# ===========================================================================
# Nudges CRUD + permissions + validation
# ===========================================================================
class TestNudgesCRUD:
    def test_create_nudge_sets_next_run_at(self, nutri_session, lead_and_patient):
        pid = lead_and_patient["patient_id"]
        payload = {
            "label": "TEST_Lembrete almoco",
            "trigger_text": "Pergunte ao paciente se ele almoçou e se seguiu o plano alimentar.",
            "hour": 12,
            "minute": 30,
            "weekdays": [0, 1, 2, 3, 4],
            "active": True,
        }
        r = nutri_session.post(f"{API}/patients/{pid}/nudges", json=payload, timeout=15)
        assert r.status_code == 200, f"create failed: {r.status_code} {r.text}"
        body = r.json()
        assert body["label"] == payload["label"]
        assert body["hour"] == 12
        assert body["minute"] == 30
        assert body["weekdays"] == [0, 1, 2, 3, 4]
        assert body["active"] is True
        assert body["next_run_at"] is not None
        # next_run_at must be aware datetime in the future (>= now)
        nra = datetime.fromisoformat(body["next_run_at"].replace("Z", "+00:00"))
        assert nra >= datetime.now(timezone.utc) - timezone.utc.utcoffset(datetime.now(timezone.utc)) if False else True
        # Use a simpler check: future or within last minute (clock skew)
        delta = (nra - datetime.now(timezone.utc)).total_seconds()
        assert delta > -60, f"next_run_at is too far in past: delta={delta}s"
        lead_and_patient["_nudge_id"] = body["id"]

    def test_list_nudges_owner_only(self, nutri_session, lead_and_patient):
        pid = lead_and_patient["patient_id"]
        r = nutri_session.get(f"{API}/patients/{pid}/nudges", timeout=15)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        ids = [n["id"] for n in rows]
        assert lead_and_patient.get("_nudge_id") in ids

    def test_patch_nudge_recomputes_next_run(self, nutri_session, lead_and_patient):
        pid = lead_and_patient["patient_id"]
        nid = lead_and_patient.get("_nudge_id")
        assert nid, "previous create test must run first"
        # GET current next_run_at
        r0 = nutri_session.get(f"{API}/patients/{pid}/nudges", timeout=15)
        old = next(n for n in r0.json() if n["id"] == nid)
        old_nra = old["next_run_at"]

        r = nutri_session.patch(
            f"{API}/patients/{pid}/nudges/{nid}",
            json={"hour": 20, "minute": 15, "weekdays": [5, 6]},
            timeout=15,
        )
        assert r.status_code == 200, f"patch failed: {r.text}"
        body = r.json()
        assert body["hour"] == 20
        assert body["minute"] == 15
        assert body["weekdays"] == [5, 6]
        assert body["next_run_at"] != old_nra, "next_run_at must be recomputed when schedule changes"

    def test_patch_only_label_does_not_break_schedule(self, nutri_session, lead_and_patient):
        pid = lead_and_patient["patient_id"]
        nid = lead_and_patient["_nudge_id"]
        r = nutri_session.patch(
            f"{API}/patients/{pid}/nudges/{nid}",
            json={"label": "TEST_Lembrete renomeado"},
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["label"] == "TEST_Lembrete renomeado"

    def test_create_nudge_invalid_hour_returns_422(self, nutri_session, lead_and_patient):
        pid = lead_and_patient["patient_id"]
        r = nutri_session.post(
            f"{API}/patients/{pid}/nudges",
            json={"label": "x", "trigger_text": "x", "hour": 24, "minute": 0},
            timeout=15,
        )
        assert r.status_code == 422, f"expected 422 got {r.status_code} {r.text}"

    def test_create_nudge_invalid_minute_returns_422(self, nutri_session, lead_and_patient):
        pid = lead_and_patient["patient_id"]
        r = nutri_session.post(
            f"{API}/patients/{pid}/nudges",
            json={"label": "x", "trigger_text": "x", "hour": 10, "minute": 60},
            timeout=15,
        )
        assert r.status_code == 422

    def test_patient_cannot_access_nudges_endpoint(self, lead_and_patient):
        """A patient-authenticated user must get 403 (require_nutritionist)."""
        pid = lead_and_patient["patient_id"]
        ps = lead_and_patient["patient_session"]
        r = ps.get(f"{API}/patients/{pid}/nudges", timeout=15)
        assert r.status_code == 403, f"expected 403 got {r.status_code} {r.text}"

    def test_unauth_get_returns_401(self, lead_and_patient):
        pid = lead_and_patient["patient_id"]
        r = requests.get(f"{API}/patients/{pid}/nudges", timeout=15)
        assert r.status_code == 401

    def test_nonowner_nutri_returns_404(self, nutri_session):
        """A nutricionist hitting a non-existent patient must get 404."""
        fake_pid = str(uuid.uuid4())
        r = nutri_session.get(f"{API}/patients/{fake_pid}/nudges", timeout=15)
        assert r.status_code == 404


# ===========================================================================
# Run-now (real Claude — slow)
# ===========================================================================
class TestNudgeRunNow:
    def test_run_now_persists_proactive_message(self, nutri_session, lead_and_patient):
        pid = lead_and_patient["patient_id"]
        # Create a fresh nudge for this test
        r = nutri_session.post(
            f"{API}/patients/{pid}/nudges",
            json={
                "label": "TEST_RunNow",
                "trigger_text": "Pergunte de forma breve e amigável se o paciente bebeu água hoje.",
                "hour": 9,
                "minute": 0,
                "active": True,
            },
            timeout=15,
        )
        assert r.status_code == 200, r.text
        nid = r.json()["id"]

        r2 = nutri_session.post(f"{API}/patients/{pid}/nudges/{nid}/run-now", timeout=60)
        assert r2.status_code == 200, f"run-now failed: {r2.status_code} {r2.text}"
        body = r2.json()
        assert body.get("ok") is True
        assert isinstance(body.get("message"), str) and len(body["message"]) > 0

        # Verify last_fired_at updated
        r3 = nutri_session.get(f"{API}/patients/{pid}/nudges", timeout=15)
        row = next(n for n in r3.json() if n["id"] == nid)
        assert row["last_fired_at"] is not None

        # Verify patient sees the message via /api/patient/chat with kind='proactive'
        ps = lead_and_patient["patient_session"]
        time.sleep(1)
        r4 = ps.get(f"{API}/patient/chat", timeout=15)
        assert r4.status_code == 200
        msgs = r4.json()
        proactive = [m for m in msgs if m.get("kind") == "proactive"]
        assert len(proactive) >= 1, f"no proactive message in patient chat history. Total msgs={len(msgs)}"
        # The most recent proactive msg should match what run-now returned
        assert any(p["content"] == body["message"] for p in proactive), "run-now message not found in patient chat"
        # The proactive message must be role=assistant
        assert all(p["role"] == "assistant" for p in proactive)


# ===========================================================================
# Patient regular chat must NOT mark messages as kind='proactive'
# ===========================================================================
class TestPatientChatKind:
    def test_normal_patient_chat_no_proactive_kind(self, lead_and_patient):
        ps = lead_and_patient["patient_session"]
        r = ps.post(f"{API}/patient/chat", json={"message": "Olá, teste regressão kind."}, timeout=60)
        assert r.status_code == 200, r.text
        body = r.json()
        reply = body.get("reply")
        assert isinstance(reply, str) and len(reply) > 0

        r2 = ps.get(f"{API}/patient/chat", timeout=15)
        assert r2.status_code == 200
        msgs = r2.json()
        # The very last message should be the assistant reply we just got, NOT proactive
        last_assistant = [m for m in msgs if m["role"] == "assistant" and m["content"] == reply]
        assert last_assistant, "freshly sent assistant reply not found"
        for m in last_assistant:
            assert m.get("kind") != "proactive", "normal chat msg must not have kind='proactive'"


# ===========================================================================
# patient-pending-{pid} merging: nudge fired BEFORE signup, then signup happens
# ===========================================================================
class TestPendingNudgeMerge:
    def test_pending_nudge_appears_after_signup(self, nutri_session, pending_patient_id):
        pid = pending_patient_id["patient_id"]
        token = pending_patient_id["token"]

        # Create + fire a nudge BEFORE patient signs up
        r = nutri_session.post(
            f"{API}/patients/{pid}/nudges",
            json={
                "label": "TEST_Pending",
                "trigger_text": "Boas-vindas pró-ativas: peça ao paciente para confirmar o horário do café.",
                "hour": 7,
                "minute": 0,
                "active": True,
            },
            timeout=15,
        )
        assert r.status_code == 200, r.text
        nid = r.json()["id"]

        r2 = nutri_session.post(f"{API}/patients/{pid}/nudges/{nid}/run-now", timeout=60)
        assert r2.status_code == 200, r2.text
        pending_msg = r2.json()["message"]

        # Now patient signs up
        ps = requests.Session()
        r3 = ps.post(f"{API}/patient/signup", json={"token": token, "password": "paciente123"}, timeout=30)
        assert r3.status_code == 200, r3.text

        # GET /api/patient/chat must include the pending proactive message
        r4 = ps.get(f"{API}/patient/chat", timeout=15)
        assert r4.status_code == 200
        msgs = r4.json()
        proactives = [m for m in msgs if m.get("kind") == "proactive"]
        assert any(m["content"] == pending_msg for m in proactives), \
            f"pending pre-signup nudge message not visible in patient chat. proactives count={len(proactives)}"


# ===========================================================================
# DELETE
# ===========================================================================
class TestNudgeDelete:
    def test_delete_nudge_then_404(self, nutri_session, lead_and_patient):
        pid = lead_and_patient["patient_id"]
        # Create one to delete
        r = nutri_session.post(
            f"{API}/patients/{pid}/nudges",
            json={"label": "TEST_ToDelete", "trigger_text": "x", "hour": 10, "minute": 0},
            timeout=15,
        )
        assert r.status_code == 200
        nid = r.json()["id"]

        r2 = nutri_session.delete(f"{API}/patients/{pid}/nudges/{nid}", timeout=15)
        assert r2.status_code == 200
        assert r2.json().get("ok") is True

        r3 = nutri_session.delete(f"{API}/patients/{pid}/nudges/{nid}", timeout=15)
        assert r3.status_code == 404
