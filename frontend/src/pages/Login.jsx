import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import GlowOrb from "@/components/evonut/GlowOrb";
import { Sparkles, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

export default function Login() {
  const { login, register, error } = useAuth();
  const [mode, setMode] = useState("login"); // login | register
  const [name, setName] = useState("");
  const [email, setEmail] = useState("admin@evonut.com");
  const [password, setPassword] = useState("evonut123");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    const ok = mode === "login"
      ? await login(email, password)
      : await register(name, email, password);
    setLoading(false);
    if (ok) {
      toast.success(mode === "login" ? "Bem-vinda de volta!" : "Conta criada!");
      navigate("/dashboard");
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden bg-evo-bg flex items-center justify-center px-4">
      <GlowOrb color="#7B61FF" size={500} top="-15%" left="-10%" opacity={0.35} />
      <GlowOrb color="#1DB97E" size={400} top="60%" left="65%" opacity={0.3} />
      <div className="absolute inset-0 evo-grid-bg pointer-events-none" />

      <Link to="/" data-testid="back-home" className="absolute top-6 left-6 evo-btn-ghost text-sm">
        <ArrowLeft className="w-4 h-4" /> Voltar
      </Link>

      <div className="relative z-10 w-full max-w-md evo-glass rounded-2xl p-8 shadow-2xl animate-fade-up">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-evo-purple to-evo-teal flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <span className="font-display text-lg font-semibold">EvoNut</span>
        </div>
        <h1 className="evo-h2 mt-3">{mode === "login" ? "Entrar no painel" : "Criar conta"}</h1>
        <p className="text-sm text-gray-400 mt-1">
          {mode === "login" ? "Acesso para nutricionistas" : "Comece em menos de 1 minuto"}
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          {mode === "register" && (
            <div>
              <label className="evo-label">Nome</label>
              <input data-testid="register-name" className="evo-input" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
          )}
          <div>
            <label className="evo-label">E-mail</label>
            <input data-testid="email-input" type="email" className="evo-input" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="evo-label">Senha</label>
            <input data-testid="password-input" type="password" className="evo-input" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          </div>
          {error && <div data-testid="auth-error" className="text-sm text-evo-coral">{error}</div>}
          <button data-testid="submit-auth" type="submit" disabled={loading} className="evo-btn-primary w-full">
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
          <div className="mt-4 p-3 rounded-lg bg-evo-purple/10 border border-evo-purple/20 text-xs text-gray-300">
            <strong className="text-evo-purple">Demo:</strong> admin@evonut.com / evonut123
          </div>
        )}
      </div>
    </div>
  );
}
