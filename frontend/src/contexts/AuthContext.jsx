import React, { createContext, useContext, useEffect, useState } from "react";
import { api, formatApiError } from "../lib/evo-api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null=loading, false=unauth, object=auth
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get("/auth/me")
      .then((r) => setUser(r.data))
      .catch(() => setUser(false));
  }, []);

  const login = async (email, password) => {
    setError("");
    try {
      const { data } = await api.post("/auth/login", { email, password });
      setUser(data);
      return data;
    } catch (e) {
      setError(formatApiError(e.response?.data?.detail) || e.message);
      return null;
    }
  };

  const register = async (name, email, password) => {
    setError("");
    try {
      const { data } = await api.post("/auth/register", { name, email, password });
      setUser(data);
      return data;
    } catch (e) {
      setError(formatApiError(e.response?.data?.detail) || e.message);
      return null;
    }
  };

  const patientSignup = async (token, password) => {
    setError("");
    try {
      const { data } = await api.post("/patient/signup", { token, password });
      setUser(data);
      return data;
    } catch (e) {
      setError(formatApiError(e.response?.data?.detail) || e.message);
      return null;
    }
  };

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch (_) {}
    setUser(false);
  };

  return (
    <AuthContext.Provider value={{ user, login, register, patientSignup, logout, error }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
