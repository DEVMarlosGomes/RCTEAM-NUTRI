import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import GlowOrb from "@/components/evonut/GlowOrb";
import { ArrowLeft, Dumbbell, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function PatientLogin() {
  const { login, error } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    const result = await login(email, password);
    setLoading(false);
    if (result) {
      if (result.role !== "patient") {
        toast.error("Esta área é exclusiva para pacientes. Use o Acesso Profissional.");
        return;
      }
      toast.success("Bem-vindo de volta!");
      navigate("/paciente");
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden bg-rc-ink flex items-center justify-center px-4">
      <GlowOrb color="#0081FD" size={500} top="-15%" left="-10%" opacity={0.22} />
      <GlowOrb color="#0066CC" size={380} top="60%" left="70%" opacity={0.15} />
      <div className="absolute inset-0 rc-grid-bg pointer-events-none" />

      {/* Voltar */}
      <a
        href="/landing.html"
        data-testid="back-home"
        className="absolute top-6 left-6 rc-btn-ghost"
      >
        <ArrowLeft className="w-4 h-4" /> Voltar ao site
      </a>

      <div className="relative z-10 w-full max-w-md rc-glass rounded-2xl p-8 shadow-2xl animate-fade-up">

        {/* Ícone + título */}
        <div className="flex flex-col items-center text-center mb-7">
          <div className="w-14 h-14 rounded-2xl bg-emerald-400/10 border border-emerald-400/30 flex items-center justify-center mb-4">
            <Dumbbell className="w-6 h-6 text-emerald-400" />
          </div>
          <h1 className="rc-h2">Área do Paciente</h1>
          <p className="text-[11px] text-gray-400 mt-1.5 uppercase tracking-[0.2em] font-bold">
            Dieta · Exames · Assistente IA
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="rc-label">E-mail</label>
            <input
              data-testid="patient-email-input"
              type="email"
              className="rc-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              required
            />
          </div>
          <div>
            <label className="rc-label">Senha</label>
            <input
              data-testid="patient-password-input"
              type="password"
              className="rc-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={6}
            />
          </div>

          {error && (
            <p data-testid="patient-auth-error" className="text-sm text-red-400">{error}</p>
          )}

          <button
            data-testid="patient-submit-btn"
            type="submit"
            disabled={loading}
            className="rc-btn-primary w-full mt-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Dumbbell className="w-4 h-4" />}
            {loading ? "Entrando..." : "Acessar minha área"}
          </button>
        </form>

        {/* Separador */}
        <div className="mt-6 pt-5 border-t border-white/[0.06] text-center space-y-1">
          <p className="text-xs text-gray-500 leading-relaxed">
            Ainda não tem acesso? Fale com o Rogério pelo{" "}
            <a
              href="https://wa.me/5511983692815"
              target="_blank"
              rel="noopener noreferrer"
              className="text-rc-blue hover:underline font-bold"
            >
              WhatsApp
            </a>{" "}
            e receba seu convite.
          </p>
          <p className="text-xs text-gray-600">
            É profissional?{" "}
            <a href="/login" className="text-gray-400 hover:text-white font-bold transition-colors">
              Acesso profissional →
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
