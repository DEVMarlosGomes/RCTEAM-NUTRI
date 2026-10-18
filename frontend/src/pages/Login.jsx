import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import RCLogo from "@/components/evonut/RCLogo";
import MacroRings from "@/components/evonut/MacroRings";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function Login() {
  const { login, register, error } = useAuth();
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
      toast.success(mode === "login" ? "Bem-vindo de volta" : "Conta criada");
      navigate(result.role === "patient" ? "/paciente" : "/dashboard");
    }
  };

  return (
    <div className="min-h-[100dvh] grid lg:grid-cols-[1.1fr_1fr]">
      {/* Painel da marca */}
      <section className="relative hidden lg:flex flex-col justify-between p-12 xl:p-16 overflow-hidden bg-rc-black/50 border-r border-white/[0.05]">
        <div className="absolute inset-0 rc-grid-bg pointer-events-none" />
        <div className="relative flex items-center gap-3">
          <RCLogo size={38} variant="blue" />
          <div className="leading-none">
            <div className="rc-display text-xl text-white">Rogério Costa</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500 mt-1.5">Treinador e Nutricionista</div>
          </div>
        </div>

        <div className="relative">
          <div className="absolute -right-32 -top-44 w-[420px] h-[420px] opacity-60">
            <MacroRings />
          </div>
          <div className="relative rc-eyebrow">Sistema clínico</div>
          <h1 className="relative rc-display text-[clamp(56px,6.4vw,104px)] text-white mt-5 max-w-[9ch] [text-shadow:0_2px_30px_rgba(9,12,16,0.8)]">
            Nutrição que <span className="text-rc-lime">performa</span>.
          </h1>
          <p className="text-gray-400 text-lg mt-6 max-w-[42ch]">
            Anamnese, exames com IA, gasto energético e prescrição no mesmo lugar, do primeiro contato ao acompanhamento.
          </p>
        </div>

        <dl className="relative grid grid-cols-3 gap-6 max-w-lg">
          {[
            ["Exames", "Leitura integrada pelo Dr. House"],
            ["Prescrição", "Base EVONUT com 6.592 alimentos"],
            ["Paciente", "Plano e chat no celular"],
          ].map(([t, d]) => (
            <div key={t} className="border-t border-white/[0.08] pt-3">
              <dt className="text-[13px] font-medium text-gray-100">{t}</dt>
              <dd className="text-[12.5px] text-gray-500 mt-1 leading-snug">{d}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Formulario */}
      <section className="relative flex flex-col px-5 py-6 sm:px-10">
        <a href="/" data-testid="back-home" className="rc-btn-ghost self-start -ml-3">
          <ArrowLeft className="w-4 h-4" /> Voltar ao site
        </a>

        <div className="flex-1 flex items-center justify-center py-10">
          <div className="w-full max-w-[380px] animate-fade-up">
            <div className="lg:hidden flex items-center gap-3 mb-10">
              <RCLogo size={34} variant="blue" />
              <div className="rc-display text-lg text-white">Rogério Costa</div>
            </div>

            <h2 className="rc-display text-4xl text-white">
              {mode === "login" ? "Acesso profissional" : "Criar conta"}
            </h2>
            <p className="text-gray-400 mt-3">
              {mode === "login" ? "Entre para abrir o painel clínico." : "Cadastro para nutricionistas e treinadores."}
            </p>

            <form onSubmit={submit} className="space-y-4 mt-8">
              {mode === "register" && (
                <div>
                  <label className="rc-label" htmlFor="register-name">Nome completo</label>
                  <input id="register-name" data-testid="register-name" className="rc-input" value={name}
                    onChange={(e) => setName(e.target.value)} placeholder="Seu nome" autoComplete="name" required />
                </div>
              )}
              <div>
                <label className="rc-label" htmlFor="login-email">E-mail</label>
                <input id="login-email" data-testid="email-input" type="email" className="rc-input" value={email}
                  onChange={(e) => setEmail(e.target.value)} placeholder="voce@clinica.com.br" autoComplete="email" required />
              </div>
              <div>
                <label className="rc-label" htmlFor="login-password">Senha</label>
                <input id="login-password" data-testid="password-input" type="password" className="rc-input" value={password}
                  onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo de 6 caracteres"
                  autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={6} />
              </div>

              {error && (
                <p data-testid="auth-error" role="alert" className="text-[13px] text-rc-coral">{error}</p>
              )}

              <button data-testid="submit-auth" type="submit" disabled={loading} className="rc-btn-primary w-full h-11 mt-2">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {loading ? "Entrando..." : mode === "login" ? "Entrar no painel" : "Criar conta"}
                {!loading && <ArrowRight className="w-4 h-4" />}
              </button>
            </form>

            <button
              data-testid="toggle-mode"
              onClick={() => setMode(mode === "login" ? "register" : "login")}
              className="mt-5 text-[13.5px] text-gray-400 hover:text-white transition-colors"
            >
              {mode === "login" ? "Não tem conta? " : "Já tem conta? "}
              <span className="text-rc-blueLight">{mode === "login" ? "Criar agora" : "Entrar"}</span>
            </button>

            <div className="mt-10 pt-5 border-t border-white/[0.06] flex items-center justify-between gap-4 text-[13px]">
              <span className="text-gray-500">É paciente?</span>
              <a href="/login-paciente" className="text-gray-200 hover:text-rc-lime transition-colors inline-flex items-center gap-1.5">
                Área do paciente <ArrowRight className="w-3.5 h-3.5" />
              </a>
            </div>

            {mode === "login" && (
              <div className="mt-6 rc-well px-3.5 py-3 text-[12.5px] text-gray-400">
                <span className="text-gray-200 font-medium">Demo</span> · admin@rogeriocosta.com.br / rogerio2025
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
