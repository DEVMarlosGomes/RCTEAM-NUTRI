import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import GlowOrb from "@/components/evonut/GlowOrb";
import Brand from "@/components/evonut/Brand";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

export default function Login() {
  const { login, register, error } = useAuth();
  const [mode, setMode] = useState("login"); // login | register
  const [name, setName] = useState("");
  const [email, setEmail] = useState("admin@rogeriocosta.com.br");
  const [password, setPassword] = useState("rogerio2025");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    const result = mode === "login"
      ? await login(email, password)
      : await register(name, email, password);
    setLoading(false);
    if (result) {
      toast.success(mode === "login" ? "Bem-vindo de volta!" : "Conta criada!");
      navigate(result.role === "patient" ? "/paciente" : "/dashboard");
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden bg-rc-ink flex items-center justify-center px-4">
      <GlowOrb color="#0081FD" size={500} top="-15%" left="-10%" opacity={0.28} />
      <GlowOrb color="#0066CC" size={400} top="60%" left="65%" opacity={0.2} />
      <div className="absolute inset-0 rc-grid-bg pointer-events-none" />

      <Link to="/" data-testid="back-home" className="absolute top-6 left-6 rc-btn-ghost">
        <ArrowLeft className="w-4 h-4" /> Voltar
      </Link>

      <div className="relative z-10 w-full max-w-md rc-glass rounded-2xl p-8 shadow-2xl animate-fade-up">
        <Brand size="md" />

        <h1 className="rc-h2 mt-6">{mode === "login" ? "Acessar Painel" : "Criar Conta"}</h1>
        <p className="text-sm text-gray-400 mt-1 uppercase tracking-wider font-bold text-[11px]">
          {mode === "login" ? "Área restrita para profissionais" : "Cadastro de nutricionistas"}
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          {mode === "register" && (
            <div>
              <label className="rc-label">Nome</label>
              <input data-testid="register-name" className="rc-input" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
          )}
          <div>
            <label className="rc-label">E-mail</label>
            <input data-testid="email-input" type="email" className="rc-input" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="rc-label">Senha</label>
            <input data-testid="password-input" type="password" className="rc-input" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          </div>
          {error && <div data-testid="auth-error" className="text-sm text-red-400">{error}</div>}
          <button data-testid="submit-auth" type="submit" disabled={loading} className="rc-btn-primary w-full">
            {loading ? "Carregando..." : mode === "login" ? "Entrar" : "Criar conta"}
          </button>
        </form>

        <button
          data-testid="toggle-mode"
          onClick={() => setMode(mode === "login" ? "register" : "login")}
          className="mt-5 w-full text-sm text-gray-400 hover:text-white transition-colors"
        >
          {mode === "login" ? "Não tem conta? Criar agora" : "Já tem conta? Entrar"}
        </button>

        {mode === "login" && (
          <div className="mt-4 p-3 rounded-lg bg-rc-blue/10 border border-rc-blue/30 text-xs text-gray-300">
            <strong className="text-rc-blue uppercase tracking-wider">Demo:</strong> admin@rogeriocosta.com.br / rogerio2025
          </div>
        )}
      </div>
    </div>
  );
}
