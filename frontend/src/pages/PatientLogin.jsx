import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import RCLogo from "@/components/evonut/RCLogo";
import MacroRings from "@/components/evonut/MacroRings";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
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
      toast.success("Bem-vindo de volta");
      navigate("/paciente");
    }
  };

  return (
    <div className="min-h-[100dvh] relative overflow-hidden flex flex-col px-5 py-6 sm:px-10">
      <MacroRings className="absolute -right-24 -top-20 w-[340px] h-[340px] opacity-40 pointer-events-none" stroke={12} values={{ ptn: 0.8, cho: 0.62, lip: 0.45 }} />

      <a href="/" data-testid="back-home" className="relative rc-btn-ghost self-start -ml-3">
        <ArrowLeft className="w-4 h-4" /> Voltar ao site
      </a>

      <div className="relative flex-1 flex items-center justify-center py-10">
        <div className="w-full max-w-[380px] animate-fade-up">
          <div className="flex items-center gap-2.5 mb-10">
            <RCLogo size={30} variant="blue" />
            <span className="rc-display text-[15px] text-white">Rogério Costa</span>
          </div>
          <div className="rc-eyebrow">Área do paciente</div>
          <h1 className="rc-display text-[52px] text-white mt-3">Seu plano,<br /><span className="text-rc-lime">no bolso.</span></h1>
          <p className="text-gray-400 mt-4">Dieta, exames e assistente para tirar dúvidas entre as consultas.</p>

        <form onSubmit={submit} className="space-y-4 mt-8">
          <div>
            <label className="rc-label" htmlFor="patient-email">E-mail</label>
            <input
              id="patient-email"
              autoComplete="email"
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
            <label className="rc-label" htmlFor="patient-password">Senha</label>
            <input
              id="patient-password"
              autoComplete="current-password"
              data-testid="patient-password-input"
              type="password"
              className="rc-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Sua senha"
              required
              minLength={6}
            />
          </div>

          {error && (
            <p data-testid="patient-auth-error" role="alert" className="text-[13px] text-rc-coral">{error}</p>
          )}

          <button
            data-testid="patient-submit-btn"
            type="submit"
            disabled={loading}
            className="rc-btn-lime w-full h-11 mt-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {loading ? "Entrando..." : "Acessar minha área"}
            {!loading && <ArrowRight className="w-4 h-4" />}
          </button>
        </form>

          <div className="mt-10 pt-5 border-t border-white/[0.06] space-y-3 text-[13px]">
            <p className="text-gray-500">
              Ainda não tem acesso? Fale com o Rogério pelo{" "}
              <a href="https://wa.me/5511983692815" target="_blank" rel="noopener noreferrer" className="text-gray-100 underline decoration-rc-lime/60 underline-offset-4 hover:decoration-rc-lime">
                WhatsApp
              </a>{" "}
              e receba seu convite.
            </p>
            <a href="/login" className="inline-flex items-center gap-1.5 text-gray-400 hover:text-white transition-colors">
              Acesso profissional <ArrowRight className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
