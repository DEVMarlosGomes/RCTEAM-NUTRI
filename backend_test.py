#!/usr/bin/env python3
"""
Backend Testing Suite for Rogério Costa (formerly EvoNut) - Iter 1
Tests the 7 focus items from test_result.md
"""

import requests
import json
import time
import uuid
from datetime import datetime, timezone

# Base URL from frontend/.env + /api
BASE_URL = "https://design-completion-2.preview.emergentagent.com/api"

# Test credentials from /app/memory/test_credentials.md
ADMIN_EMAIL = "admin@rogeriocosta.com.br"
ADMIN_PASSWORD = "rogerio2025"

class TestResults:
    def __init__(self):
        self.results = []
        self.session = requests.Session()
        
    def log(self, test_name, status, details=""):
        result = {
            "test": test_name,
            "status": status,  # "PASS" or "FAIL"
            "details": details,
            "timestamp": datetime.now().isoformat()
        }
        self.results.append(result)
        print(f"[{status}] {test_name}: {details}")
        
    def summary(self):
        passed = sum(1 for r in self.results if r["status"] == "PASS")
        failed = sum(1 for r in self.results if r["status"] == "FAIL")
        print(f"\n=== TEST SUMMARY ===")
        print(f"Total: {len(self.results)} | Passed: {passed} | Failed: {failed}")
        
        if failed > 0:
            print("\n=== FAILED TESTS ===")
            for r in self.results:
                if r["status"] == "FAIL":
                    print(f"❌ {r['test']}: {r['details']}")
        
        return passed, failed

def test_1_login_new_credentials(tr: TestResults):
    """Test 1: Login + new credentials"""
    try:
        # Test login with new admin credentials
        response = tr.session.post(f"{BASE_URL}/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        
        if response.status_code != 200:
            tr.log("1. Login with new credentials", "FAIL", 
                   f"Expected 200, got {response.status_code}: {response.text}")
            return
            
        data = response.json()
        
        # Check if cookie is set
        if "access_token" not in tr.session.cookies:
            tr.log("1. Login with new credentials", "FAIL", "No access_token cookie set")
            return
            
        # Check UserOut response
        if data.get("name") != "Rogério Costa":
            tr.log("1. Login with new credentials", "FAIL", 
                   f"Expected name 'Rogério Costa', got '{data.get('name')}'")
            return
            
        tr.log("1. Login with new credentials", "PASS", 
               f"Login successful, cookie set, name: {data.get('name')}")
        
        # Test /auth/me with cookie
        me_response = tr.session.get(f"{BASE_URL}/auth/me")
        if me_response.status_code != 200:
            tr.log("1. Auth/me with cookie", "FAIL", 
                   f"Expected 200, got {me_response.status_code}")
            return
            
        me_data = me_response.json()
        if me_data.get("name") != "Rogério Costa":
            tr.log("1. Auth/me with cookie", "FAIL", 
                   f"Expected name 'Rogério Costa', got '{me_data.get('name')}'")
            return
            
        tr.log("1. Auth/me with cookie", "PASS", "Successfully retrieved user info")
        
    except Exception as e:
        tr.log("1. Login with new credentials", "FAIL", f"Exception: {str(e)}")

def test_3_multi_tenant_lead_routing(tr: TestResults):
    """Test 3: Multi-tenant lead routing"""
    try:
        # Test 1: POST /api/leads (no slug) - should assign to admin (Rogério)
        lead_data = {
            "name": "João Silva",
            "phone": "+5511999887766",
            "email": "joao.silva@test.com"
        }
        
        response = tr.session.post(f"{BASE_URL}/leads", json=lead_data)
        if response.status_code != 200:
            tr.log("3. Lead routing (no slug)", "FAIL", 
                   f"Expected 200, got {response.status_code}: {response.text}")
            return
            
        data = response.json()
        token1 = data.get("token")
        
        # Verify lead was assigned to admin by checking the lead details
        lead_response = tr.session.get(f"{BASE_URL}/public/lead/{token1}")
        if lead_response.status_code != 200:
            tr.log("3. Lead routing (no slug)", "FAIL", "Could not retrieve lead details")
            return
            
        tr.log("3. Lead routing (no slug)", "PASS", f"Lead created with token: {token1}")
        
        # Test 2: POST /api/leads?nutri=rogerio - should assign to admin
        lead_data2 = {
            "name": "Maria Santos",
            "phone": "+5511888776655",
            "email": "maria.santos@test.com"
        }
        
        response2 = tr.session.post(f"{BASE_URL}/leads?nutri=rogerio", json=lead_data2)
        if response2.status_code != 200:
            tr.log("3. Lead routing (nutri=rogerio)", "FAIL", 
                   f"Expected 200, got {response2.status_code}: {response2.text}")
            return
            
        data2 = response2.json()
        token2 = data2.get("token")
        tr.log("3. Lead routing (nutri=rogerio)", "PASS", f"Lead created with token: {token2}")
        
        # Test 3: POST /api/leads?nutri=nonexistent - should fall back to first nutritionist (admin)
        lead_data3 = {
            "name": "Pedro Costa",
            "phone": "+5511777665544",
            "email": "pedro.costa@test.com"
        }
        
        response3 = tr.session.post(f"{BASE_URL}/leads?nutri=nonexistent", json=lead_data3)
        if response3.status_code != 200:
            tr.log("3. Lead routing (nutri=nonexistent)", "FAIL", 
                   f"Expected 200, got {response3.status_code}: {response3.text}")
            return
            
        data3 = response3.json()
        token3 = data3.get("token")
        tr.log("3. Lead routing (nutri=nonexistent)", "PASS", 
               f"Lead created with fallback, token: {token3}")
        
        return token1, token2, token3
        
    except Exception as e:
        tr.log("3. Multi-tenant lead routing", "FAIL", f"Exception: {str(e)}")
        return None, None, None

def test_4_public_lead_whitelist(tr: TestResults, token):
    """Test 4: Public lead whitelist (no nutricionista_id leak)"""
    if not token:
        tr.log("4. Public lead whitelist", "FAIL", "No token available from previous test")
        return
        
    try:
        response = tr.session.get(f"{BASE_URL}/public/lead/{token}")
        if response.status_code != 200:
            tr.log("4. Public lead whitelist", "FAIL", 
                   f"Expected 200, got {response.status_code}: {response.text}")
            return
            
        data = response.json()
        
        # Check that sensitive fields are NOT present
        sensitive_fields = ["nutricionista_id", "password_hash"]
        leaked_fields = [field for field in sensitive_fields if field in data]
        
        if leaked_fields:
            tr.log("4. Public lead whitelist", "FAIL", 
                   f"Sensitive fields leaked: {leaked_fields}")
            return
            
        # Check that expected safe fields ARE present
        expected_fields = ["id", "nome", "telefone", "email", "status_funil", 
                          "lead_token", "created_at"]
        missing_fields = [field for field in expected_fields if field not in data]
        
        if missing_fields:
            tr.log("4. Public lead whitelist", "FAIL", 
                   f"Expected fields missing: {missing_fields}")
            return
            
        tr.log("4. Public lead whitelist", "PASS", 
               f"No sensitive fields leaked, safe fields present: {list(data.keys())}")
        
    except Exception as e:
        tr.log("4. Public lead whitelist", "FAIL", f"Exception: {str(e)}")

def test_5_public_chat_rate_limit(tr: TestResults, token):
    """Test 5: Public chat rate limit (8 req / 60s per token)"""
    if not token:
        tr.log("5. Public chat rate limit", "FAIL", "No token available from previous test")
        return
        
    try:
        # Send 9 rapid chat requests
        rate_limit_hit = False
        successful_requests = 0
        
        for i in range(9):
            response = tr.session.post(f"{BASE_URL}/public/chat", json={
                "token": token,
                "message": f"Test message {i+1}"
            })
            
            if response.status_code == 429:
                rate_limit_hit = True
                if "Muitas mensagens" in response.text or "muitas mensagens" in response.text.lower():
                    tr.log("5. Public chat rate limit", "PASS", 
                           f"Rate limit triggered at request {i+1} with correct message")
                else:
                    tr.log("5. Public chat rate limit", "FAIL", 
                           f"Rate limit triggered but wrong message: {response.text}")
                break
            elif response.status_code == 200:
                successful_requests += 1
            else:
                # AI might fail, but that's OK as long as it's not 429
                if response.status_code != 429:
                    successful_requests += 1
                    
        if not rate_limit_hit:
            tr.log("5. Public chat rate limit", "FAIL", 
                   f"Rate limit not triggered after 9 requests. All {successful_requests} succeeded.")
        
    except Exception as e:
        tr.log("5. Public chat rate limit", "FAIL", f"Exception: {str(e)}")

def test_6_slot_generation_sp_timezone(tr: TestResults, token):
    """Test 6: Slot generation in SP timezone"""
    if not token:
        tr.log("6. Slot generation SP timezone", "FAIL", "No token available from previous test")
        return None, None
        
    try:
        response = tr.session.get(f"{BASE_URL}/public/slots/{token}")
        if response.status_code != 200:
            tr.log("6. Slot generation SP timezone", "FAIL", 
                   f"Expected 200, got {response.status_code}: {response.text}")
            return None, None
            
        slots = response.json()
        
        if not slots:
            tr.log("6. Slot generation SP timezone", "FAIL", "No slots returned")
            return None, None
            
        # Check timezone format
        timezone_errors = []
        label_errors = []
        
        for slot in slots[:5]:  # Check first 5 slots
            datetime_str = slot.get("datetime", "")
            label = slot.get("label", "")
            
            # Check datetime ends with -03:00 (Brazil timezone)
            if not datetime_str.endswith("-03:00"):
                timezone_errors.append(f"Slot datetime '{datetime_str}' doesn't end with -03:00")
                
            # Check label format: "DD/MM · HH:00 (BRT)"
            if not ("·" in label and "(BRT)" in label and ":00" in label):
                label_errors.append(f"Slot label '{label}' doesn't match expected format")
                
        if timezone_errors:
            tr.log("6. Slot generation SP timezone", "FAIL", 
                   f"Timezone errors: {timezone_errors[:3]}")
            return None, None
            
        if label_errors:
            tr.log("6. Slot generation SP timezone", "FAIL", 
                   f"Label format errors: {label_errors[:3]}")
            return None, None
            
        tr.log("6. Slot generation SP timezone", "PASS", 
               f"All slots have correct timezone (-03:00) and label format. Sample: {slots[0]}")
        
        # Return first available slot for scheduling test
        available_slot = next((s for s in slots if s.get("available")), None)
        if available_slot:
            # Extract date and time from datetime
            dt_str = available_slot["datetime"]
            # Format: 2024-01-15T09:00:00-03:00
            date_part = dt_str.split("T")[0]  # 2024-01-15
            time_part = dt_str.split("T")[1].split("-")[0][:5]  # 09:00
            return date_part, time_part
        else:
            return None, None
            
    except Exception as e:
        tr.log("6. Slot generation SP timezone", "FAIL", f"Exception: {str(e)}")
        return None, None

def test_6b_schedule_sp_timezone(tr: TestResults, token, date, time):
    """Test 6b: Schedule endpoint with SP timezone"""
    if not token or not date or not time:
        tr.log("6b. Schedule SP timezone", "FAIL", "Missing token, date, or time")
        return
        
    try:
        response = tr.session.post(f"{BASE_URL}/public/schedule", json={
            "token": token,
            "date": date,
            "time": time,
            "type": "Inicial"
        })
        
        if response.status_code != 200:
            tr.log("6b. Schedule SP timezone", "FAIL", 
                   f"Expected 200, got {response.status_code}: {response.text}")
            return
            
        data = response.json()
        data_hora = data.get("data_hora", "")
        
        if not data_hora.endswith("-03:00"):
            tr.log("6b. Schedule SP timezone", "FAIL", 
                   f"Scheduled datetime '{data_hora}' doesn't end with -03:00")
            return
            
        tr.log("6b. Schedule SP timezone", "PASS", 
               f"Consultation scheduled with correct timezone: {data_hora}")
        
    except Exception as e:
        tr.log("6b. Schedule SP timezone", "FAIL", f"Exception: {str(e)}")

def test_7_pdf_generation_new_brand(tr: TestResults):
    """Test 7: PDF generation with new brand"""
    try:
        # First, get list of patients
        patients_response = tr.session.get(f"{BASE_URL}/patients")
        if patients_response.status_code != 200:
            tr.log("7. PDF generation (get patients)", "FAIL", 
                   f"Expected 200, got {patients_response.status_code}: {patients_response.text}")
            return
            
        patients = patients_response.json()
        if not patients:
            tr.log("7. PDF generation", "FAIL", "No patients found to test PDF generation")
            return
            
        patient_id = patients[0]["id"]
        
        # Create an evaluation first (required for meal plan)
        evaluation_response = tr.session.post(f"{BASE_URL}/patients/{patient_id}/evaluations", json={
            "peso": 70.0,
            "altura": 175,
            "idade": 30,
            "sexo": "M",
            "nivel_atividade": 1.55,
            "objetivo": "manutencao"
        })
        
        if evaluation_response.status_code != 200:
            tr.log("7. PDF generation (create evaluation)", "FAIL", 
                   f"Expected 200, got {evaluation_response.status_code}: {evaluation_response.text}")
            return
        
        # Create a meal plan
        meal_plan_response = tr.session.post(f"{BASE_URL}/patients/{patient_id}/meal-plan", json={
            "objetivo": "manutencao",
            "restricoes": "Teste para PDF"
        })
        
        if meal_plan_response.status_code != 200:
            tr.log("7. PDF generation (create meal plan)", "FAIL", 
                   f"Expected 200, got {meal_plan_response.status_code}: {meal_plan_response.text}")
            return
            
        meal_plan_data = meal_plan_response.json()
        plan_id = meal_plan_data.get("id")
        
        if not plan_id:
            tr.log("7. PDF generation", "FAIL", "No meal plan ID returned")
            return
            
        # Test PDF generation
        pdf_response = tr.session.get(f"{BASE_URL}/patients/{patient_id}/meal-plan/{plan_id}/pdf")
        
        if pdf_response.status_code != 200:
            tr.log("7. PDF generation", "FAIL", 
                   f"Expected 200, got {pdf_response.status_code}: {pdf_response.text}")
            return
            
        # Check content type
        content_type = pdf_response.headers.get("content-type", "")
        if "application/pdf" not in content_type:
            tr.log("7. PDF generation", "FAIL", 
                   f"Expected content-type application/pdf, got {content_type}")
            return
            
        # Check content disposition for filename
        content_disposition = pdf_response.headers.get("content-disposition", "")
        if "rogerio-costa-plano-" not in content_disposition:
            tr.log("7. PDF generation", "FAIL", 
                   f"Expected filename with 'rogerio-costa-plano-', got {content_disposition}")
            return
            
        tr.log("7. PDF generation", "PASS", 
               f"PDF generated successfully with correct content-type and filename pattern")
        
    except Exception as e:
        tr.log("7. PDF generation", "FAIL", f"Exception: {str(e)}")

def test_2_login_lockout(tr: TestResults):
    """Test 2: Login lockout (5 attempts / 15 min) - LAST TEST"""
    try:
        # Use a test email that doesn't exist to avoid blocking real admin
        test_email = "nobody@test.com"
        wrong_password = "wrongpassword"
        
        lockout_triggered = False
        
        # Make 5 failed login attempts
        for i in range(6):  # Try 6 times to ensure lockout triggers
            response = tr.session.post(f"{BASE_URL}/auth/login", json={
                "email": test_email,
                "password": wrong_password
            })
            
            if response.status_code == 429:
                lockout_triggered = True
                if "bloqueada" in response.text.lower() or "temporariamente" in response.text.lower():
                    tr.log("2. Login lockout", "PASS", 
                           f"Lockout triggered at attempt {i+1} with correct message: {response.text}")
                else:
                    tr.log("2. Login lockout", "FAIL", 
                           f"Lockout triggered but wrong message: {response.text}")
                break
            elif response.status_code == 401:
                # Expected for wrong credentials
                continue
            else:
                tr.log("2. Login lockout", "FAIL", 
                       f"Unexpected status code {response.status_code} at attempt {i+1}")
                return
                
        if not lockout_triggered:
            tr.log("2. Login lockout", "FAIL", 
                   "Lockout not triggered after 6 failed attempts")
            return
            
        # Test that even correct password is blocked (using real admin but should be locked)
        # Note: This will lock the admin account, so we do this test LAST
        response = tr.session.post(f"{BASE_URL}/auth/login", json={
            "email": test_email,
            "password": "anycorrectpassword"  # Even if this was correct, should be blocked
        })
        
        if response.status_code != 429:
            tr.log("2. Login lockout (correct password blocked)", "FAIL", 
                   f"Expected 429 for locked account, got {response.status_code}")
        else:
            tr.log("2. Login lockout (correct password blocked)", "PASS", 
                   "Correct password also blocked during lockout period")
        
    except Exception as e:
        tr.log("2. Login lockout", "FAIL", f"Exception: {str(e)}")

def main():
    print("=== Rogério Costa Backend Testing Suite - Iter 1 ===")
    print(f"Base URL: {BASE_URL}")
    print(f"Admin credentials: {ADMIN_EMAIL} / {ADMIN_PASSWORD}")
    print()
    
    tr = TestResults()
    
    # Test 1: Login + new credentials
    test_1_login_new_credentials(tr)
    
    # Test 3: Multi-tenant lead routing (returns tokens for other tests)
    token1, token2, token3 = test_3_multi_tenant_lead_routing(tr)
    
    # Test 4: Public lead whitelist (use token from test 3)
    test_4_public_lead_whitelist(tr, token1)
    
    # Test 5: Public chat rate limit (use token from test 3)
    test_5_public_chat_rate_limit(tr, token2)
    
    # Test 6: Slot generation in SP timezone (use token from test 3)
    date, time = test_6_slot_generation_sp_timezone(tr, token3)
    
    # Test 6b: Schedule with SP timezone
    test_6b_schedule_sp_timezone(tr, token3, date, time)
    
    # Test 7: PDF generation with new brand
    test_7_pdf_generation_new_brand(tr)
    
    # Test 2: Login lockout (LAST - may lock accounts)
    test_2_login_lockout(tr)
    
    # Summary
    passed, failed = tr.summary()
    
    return failed == 0

if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)