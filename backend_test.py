#!/usr/bin/env python3
"""
Backend Testing for Iter 2 - Rogério Costa System
Tests: Photo upload endpoint and Anamnesis field remap
"""

import requests
import json
import base64
import uuid
from datetime import datetime

# Configuration
BASE_URL = "https://smart-diet-system.preview.emergentagent.com/api"
ADMIN_EMAIL = "admin@rogeriocosta.com.br"
ADMIN_PASSWORD = "rogerio2025"

class BackendTester:
    def __init__(self):
        self.session = requests.Session()
        self.admin_token = None
        self.test_results = []
        
    def log_result(self, test_name, success, details=""):
        """Log test result"""
        status = "✅ PASS" if success else "❌ FAIL"
        self.test_results.append({
            "test": test_name,
            "status": status,
            "success": success,
            "details": details,
            "timestamp": datetime.now().isoformat()
        })
        print(f"{status}: {test_name}")
        if details:
            print(f"   Details: {details}")
    
    def admin_login(self):
        """Login as admin to get authentication"""
        try:
            response = self.session.post(f"{BASE_URL}/auth/login", json={
                "email": ADMIN_EMAIL,
                "password": ADMIN_PASSWORD
            })
            
            if response.status_code == 200:
                # Check if we got a valid response
                data = response.json()
                if data.get("name") == "Rogério Costa":
                    self.log_result("Admin login", True, f"Logged in as {data.get('name')}")
                    return True
                else:
                    self.log_result("Admin login", False, f"Unexpected user data: {data}")
                    return False
            else:
                self.log_result("Admin login", False, f"Status {response.status_code}: {response.text}")
                return False
                
        except Exception as e:
            self.log_result("Admin login", False, f"Exception: {str(e)}")
            return False
    
    def create_test_lead(self, name_suffix=""):
        """Create a test lead and return token"""
        try:
            lead_data = {
                "name": f"Teste Iter2{name_suffix}",
                "phone": f"11999990001{name_suffix[-1:] if name_suffix else ''}"
            }
            
            response = self.session.post(f"{BASE_URL}/leads", json=lead_data)
            
            if response.status_code == 200:
                data = response.json()
                token = data.get("token")
                if token:
                    self.log_result(f"Create lead{name_suffix}", True, f"Token: {token[:8]}...")
                    return token
                else:
                    self.log_result(f"Create lead{name_suffix}", False, f"No token in response: {data}")
                    return None
            else:
                self.log_result(f"Create lead{name_suffix}", False, f"Status {response.status_code}: {response.text}")
                return None
                
        except Exception as e:
            self.log_result(f"Create lead{name_suffix}", False, f"Exception: {str(e)}")
            return None
    
    def test_anamnesis_new_format(self, token):
        """Test anamnesis with new field format (peso_atual/estatura)"""
        try:
            anamnesis_data = {
                "token": token,
                "respostas": {
                    "nome": "Teste Iter2",
                    "data_nascimento": "1990-05-15",
                    "estatura": 178,
                    "peso_atual": 82.5,
                    "objetivo": "emagrecimento",
                    "condicionamento": "ativo_2",
                    "dias_treino": ["Segunda", "Quarta", "Sexta"],
                    "agua": "Entre 1L e 2L (5 a 10 copos)",
                    "energia": 7,
                    "saude_score": 8,
                    "anabolizantes": "nao"
                }
            }
            
            response = self.session.post(f"{BASE_URL}/public/anamnesis", json=anamnesis_data)
            
            if response.status_code == 200:
                data = response.json()
                if data.get("ok") and data.get("anamnesis_id"):
                    self.log_result("Anamnesis new format submission", True, f"ID: {data.get('anamnesis_id')[:8]}...")
                    return data.get("anamnesis_id")
                else:
                    self.log_result("Anamnesis new format submission", False, f"Invalid response: {data}")
                    return None
            else:
                self.log_result("Anamnesis new format submission", False, f"Status {response.status_code}: {response.text}")
                return None
                
        except Exception as e:
            self.log_result("Anamnesis new format submission", False, f"Exception: {str(e)}")
            return None
    
    def test_anamnesis_old_format(self, token):
        """Test anamnesis with old field format (peso/altura) for backward compatibility"""
        try:
            anamnesis_data = {
                "token": token,
                "respostas": {
                    "nome": "Teste Iter2 Old",
                    "data_nascimento": "1985-03-20",
                    "altura": 170,
                    "peso": 70,
                    "objetivo": "hipertrofia",
                    "condicionamento": "sedentario",
                    "dias_treino": ["Segunda", "Quinta"],
                    "agua": "Menos de 1L (menos de 5 copos)",
                    "energia": 5,
                    "saude_score": 6,
                    "anabolizantes": "nao"
                }
            }
            
            response = self.session.post(f"{BASE_URL}/public/anamnesis", json=anamnesis_data)
            
            if response.status_code == 200:
                data = response.json()
                if data.get("ok") and data.get("anamnesis_id"):
                    self.log_result("Anamnesis old format submission", True, f"ID: {data.get('anamnesis_id')[:8]}...")
                    return data.get("anamnesis_id")
                else:
                    self.log_result("Anamnesis old format submission", False, f"Invalid response: {data}")
                    return None
            else:
                self.log_result("Anamnesis old format submission", False, f"Status {response.status_code}: {response.text}")
                return None
                
        except Exception as e:
            self.log_result("Anamnesis old format submission", False, f"Exception: {str(e)}")
            return None
    
    def verify_patient_data(self, expected_peso, expected_altura, expected_objetivo, test_name):
        """Verify patient data was updated correctly"""
        try:
            response = self.session.get(f"{BASE_URL}/patients")
            
            if response.status_code == 200:
                patients = response.json()
                # Find the most recent patient
                if patients:
                    patient = patients[0]  # Should be most recent due to sort order
                    
                    peso_match = patient.get("peso") == expected_peso
                    altura_match = patient.get("altura") == expected_altura
                    objetivo_match = patient.get("objetivo") == expected_objetivo
                    status_match = patient.get("status_funil") == "ANAMNESE_COMPLETA"
                    
                    if peso_match and altura_match and objetivo_match and status_match:
                        self.log_result(f"Patient data verification ({test_name})", True, 
                                      f"peso={patient.get('peso')}, altura={patient.get('altura')}, objetivo={patient.get('objetivo')}, status={patient.get('status_funil')}")
                        return True
                    else:
                        details = f"Expected: peso={expected_peso}, altura={expected_altura}, objetivo={expected_objetivo}, status=ANAMNESE_COMPLETA. "
                        details += f"Got: peso={patient.get('peso')}, altura={patient.get('altura')}, objetivo={patient.get('objetivo')}, status={patient.get('status_funil')}"
                        self.log_result(f"Patient data verification ({test_name})", False, details)
                        return False
                else:
                    self.log_result(f"Patient data verification ({test_name})", False, "No patients found")
                    return False
            else:
                self.log_result(f"Patient data verification ({test_name})", False, f"Status {response.status_code}: {response.text}")
                return False
                
        except Exception as e:
            self.log_result(f"Patient data verification ({test_name})", False, f"Exception: {str(e)}")
            return False
    
    def create_minimal_jpeg_base64(self):
        """Create a minimal valid JPEG in base64 format"""
        # This is a minimal 1x1 pixel JPEG (properly encoded)
        return "/9j/4AAQSkZJRgABAQEAAAAAAAD//gA7Q1JFQVRPUjogZ2QtanBlZyB2MS4wICh1c2luZyBJSkcgSlBFRyB2NjIpLCBxdWFsaXR5ID0gOTAK/9sAQwADAgIDAgIDAwMDBAMDBAUIBQUEBAUKBwcGCAwKDAwLCgsLDQ4SEA0OEQ4LCxAWEBETFBUVFQwPFxgWFBgSFBUU/9sAQwEDBAQFBAUJBQUJFA0LDRQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU/8AAEQgAAQABAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+gEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoLEAACAQMDAgQDBQUEBAAAAX0BAgMABBEFEiExQQYTUWEHInEUMoGRoQgjQrHBFVLR8CQzYnKCCQoWFxgZGiUmJygpKjQ1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4eLj5OXm5+jp6vHy8/T19vf4+fr/2gAMAwEAAhEDEQA/APf6KKK"
    
    def test_photo_upload_valid(self, token):
        """Test photo upload with valid data"""
        try:
            jpeg_base64 = self.create_minimal_jpeg_base64()
            photo_data = {
                "fotos": [
                    {
                        "name": "frente.jpg",
                        "data_url": f"data:image/jpeg;base64,{jpeg_base64}",
                        "size": 12345
                    }
                ]
            }
            
            response = self.session.post(f"{BASE_URL}/public/lead/{token}/photos", json=photo_data)
            
            if response.status_code == 200:
                data = response.json()
                if data.get("ok") and data.get("count") == 1:
                    self.log_result("Photo upload valid", True, f"Uploaded {data.get('count')} photo(s)")
                    return True
                else:
                    self.log_result("Photo upload valid", False, f"Unexpected response: {data}")
                    return False
            else:
                self.log_result("Photo upload valid", False, f"Status {response.status_code}: {response.text}")
                return False
                
        except Exception as e:
            self.log_result("Photo upload valid", False, f"Exception: {str(e)}")
            return False
    
    def test_photo_upload_invalid_format(self, token):
        """Test photo upload with invalid format (should be filtered)"""
        try:
            photo_data = {
                "fotos": [
                    {
                        "name": "invalid.txt",
                        "data_url": "data:text/plain;base64,SGVsbG8gV29ybGQ=",
                        "size": 100
                    }
                ]
            }
            
            response = self.session.post(f"{BASE_URL}/public/lead/{token}/photos", json=photo_data)
            
            if response.status_code == 200:
                data = response.json()
                if data.get("ok") and data.get("count") == 0:
                    self.log_result("Photo upload invalid format", True, "Invalid format correctly filtered")
                    return True
                else:
                    self.log_result("Photo upload invalid format", False, f"Expected count=0, got: {data}")
                    return False
            else:
                self.log_result("Photo upload invalid format", False, f"Status {response.status_code}: {response.text}")
                return False
                
        except Exception as e:
            self.log_result("Photo upload invalid format", False, f"Exception: {str(e)}")
            return False
    
    def test_photo_upload_multiple_capped(self, token):
        """Test photo upload with 5 photos (should be capped at 4)"""
        try:
            jpeg_base64 = self.create_minimal_jpeg_base64()
            photo_data = {
                "fotos": [
                    {
                        "name": f"foto{i}.jpg",
                        "data_url": f"data:image/jpeg;base64,{jpeg_base64}",
                        "size": 12345
                    }
                    for i in range(1, 6)  # 5 photos
                ]
            }
            
            response = self.session.post(f"{BASE_URL}/public/lead/{token}/photos", json=photo_data)
            
            if response.status_code == 200:
                data = response.json()
                if data.get("ok") and data.get("count") <= 4:
                    self.log_result("Photo upload multiple capped", True, f"Correctly capped at {data.get('count')} photos")
                    return True
                else:
                    self.log_result("Photo upload multiple capped", False, f"Expected count <= 4, got: {data}")
                    return False
            else:
                self.log_result("Photo upload multiple capped", False, f"Status {response.status_code}: {response.text}")
                return False
                
        except Exception as e:
            self.log_result("Photo upload multiple capped", False, f"Exception: {str(e)}")
            return False
    
    def test_photo_upload_invalid_token(self):
        """Test photo upload with non-existent token"""
        try:
            fake_token = "nonexistent_token_12345"
            jpeg_base64 = self.create_minimal_jpeg_base64()
            photo_data = {
                "fotos": [
                    {
                        "name": "test.jpg",
                        "data_url": f"data:image/jpeg;base64,{jpeg_base64}",
                        "size": 12345
                    }
                ]
            }
            
            response = self.session.post(f"{BASE_URL}/public/lead/{fake_token}/photos", json=photo_data)
            
            if response.status_code == 404:
                self.log_result("Photo upload invalid token", True, "Correctly returned 404 for invalid token")
                return True
            else:
                self.log_result("Photo upload invalid token", False, f"Expected 404, got {response.status_code}: {response.text}")
                return False
                
        except Exception as e:
            self.log_result("Photo upload invalid token", False, f"Exception: {str(e)}")
            return False
    
    def run_all_tests(self):
        """Run all backend tests"""
        print("=" * 60)
        print("BACKEND TESTING - ITER 2")
        print("=" * 60)
        
        # Login as admin
        if not self.admin_login():
            print("❌ Cannot proceed without admin login")
            return False
        
        print("\n--- ANAMNESIS FIELD REMAP TESTS ---")
        
        # Test 1: Anamnesis with new format (peso_atual/estatura)
        token1 = self.create_test_lead("_new")
        if token1:
            anamnesis_id1 = self.test_anamnesis_new_format(token1)
            if anamnesis_id1:
                self.verify_patient_data(82.5, 178, "emagrecimento", "new format")
        
        # Test 2: Anamnesis with old format (peso/altura) for backward compatibility
        token2 = self.create_test_lead("_old")
        if token2:
            anamnesis_id2 = self.test_anamnesis_old_format(token2)
            if anamnesis_id2:
                self.verify_patient_data(70.0, 170, "hipertrofia", "old format")
        
        print("\n--- PHOTO UPLOAD TESTS ---")
        
        # Test 3: Photo upload tests
        token3 = self.create_test_lead("_photos")
        if token3:
            self.test_photo_upload_valid(token3)
            self.test_photo_upload_invalid_format(token3)
            self.test_photo_upload_multiple_capped(token3)
        
        # Test 4: Photo upload with invalid token
        self.test_photo_upload_invalid_token()
        
        # Summary
        print("\n" + "=" * 60)
        print("TEST SUMMARY")
        print("=" * 60)
        
        passed = sum(1 for r in self.test_results if r["success"])
        total = len(self.test_results)
        
        for result in self.test_results:
            print(f"{result['status']}: {result['test']}")
            if result['details'] and not result['success']:
                print(f"   {result['details']}")
        
        print(f"\nRESULT: {passed}/{total} tests passed")
        
        if passed == total:
            print("🎉 ALL TESTS PASSED!")
            return True
        else:
            print(f"⚠️  {total - passed} tests failed")
            return False

if __name__ == "__main__":
    tester = BackendTester()
    success = tester.run_all_tests()
    exit(0 if success else 1)