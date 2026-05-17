import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, ArrowLeft, Lock, KeyRound, LogIn } from "lucide-react";
import GlowOrb from "@/components/evonut/GlowOrb";
import Brand from "@/components/evonut/Brand";
import { api, formatApiError } from "@/lib/evo-api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export default function Sucesso() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { patientSignup } = useAuth();
  const [lead, setLead] = useState(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [accountCreated, setAccountCreated] = useState(false);

  useEffect(() => {
    if (!token) return;
    api
      .get(`/public/lead/${token}`)
      .then((r) => setLead(r.data))
      .catch(() => setLead({}));
  }, [token]);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("A senha deve ter pelo menos 6 caracteres");
      return;
    }
    if (password !== confirm) {
      toast.error("As senhas não conferem");
      return;
    }
    setSubmitting(true);
    const result = await patientSignup(token, password);
    setSubmitting(false);
    if (result) {
      toast.success("Conta criada com sucesso!");
      setAccountCreated(true);
      setTimeout(() => navigate("/paciente"), 800);
    } else {
      toast.error("Não foi possível criar a conta. Use o link 'Já tenho conta' abaixo.");
    }
  };

  const email = lead?.email || "";

  return (
    <div className="min-h-screen relative bg-rc-ink flex items-center justify-center px-4 py-10">
      <GlowOrb color="#0081FD" size={500} top="10%" left="10%" opacity={0.22} />
      <GlowOrb color="#0066CC" size={400} top="55%" left="65%" opacity={0.18} />
      <div className="absolute top-6 left-6 z-10"><Brand size="sm" /></div>

      <div className="relative z-10 rc-glass rounded-2xl p-8 sm:p-10 max-w-lg w-full animate-fade-up">
        <div className="w-16 h-16 rounded-full bg-rc-blue flex items-center justify-center mx-auto shadow-[0_8px_32px_rgba(0,129,253,0.5)]">
          <CheckCircle2 className="w-8 h-8 text-black" strokeWidth={2.5} />
        </div>
        <h1 className="rc-h2 mt-6 text-center">Consulta confirmada</h1>
        <p className="text-gray-300 mt-3 leading-relaxed text-sm text-center">
          O Rogério já tem acesso à sua anamnese e ao seu perfil clínico inicial.
          Crie agora sua <strong className="text-rc-blue">conta de paciente</strong> para acessar a dieta prescrita e tirar dúvidas com nossa IA depois da consulta.
        </p>

        {!email && (
          <div className="mt-6 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-xs text-yellow-200">
            Não localizamos o e-mail informado na pré-consulta. Você pode pular essa etapa e voltar mais tarde.
          </div>
        )}

        {email && !accountCreated && (
          <form data-testid="patient-signup-form" onSubmit={onSubmit} className="mt-7 space-y-4">
            <div>
              <label className="rc-label flex items-center gap-2"><KeyRound className="w-3.5 h-3.5" /> E-mail</label>
              <input data-testid="patient-email-readonly" className="rc-input opacity-70 cursor-not-allowed" value={email} readOnly />
            </div>
            <div>
              <label className="rc-label flex items-center gap-2"><Lock className="w-3.5 h-3.5" /> Crie uma senha</label>
              <input
                data-testid="patient-password"
                type="password"
                className="rc-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
                placeholder="mínimo 6 caracteres"
              />
            </div>
            <div>
              <label className="rc-label flex items-center gap-2"><Lock className="w-3.5 h-3.5" /> Confirme a senha</label>
              <input
                data-testid="patient-password-confirm"
                type="password"
                className="rc-input"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                minLength={6}
                required
              />
            </div>
            <button data-testid="patient-signup-submit" type="submit" disabled={submitting} className="rc-btn-primary w-full justify-center">
              {submitting ? "Criando conta..." : "Criar minha área de paciente"}
            </button>
          </form>
        )}

        {accountCreated && (
          <div data-testid="signup-success" className="mt-6 p-4 rounded-lg bg-rc-blue/10 border border-rc-blue/40 text-sm text-gray-200 text-center">
            Conta criada! Redirecionando para sua área de paciente...
          </div>
        )}

        <div className="mt-6 flex flex-col gap-2 items-center text-xs text-gray-500">
          <Link to="/login" className="flex items-center gap-1.5 hover:text-rc-blue transition-colors" data-testid="link-login">
            <LogIn className="w-3.5 h-3.5" /> Já tenho conta — entrar
          </Link>
          <Link to="/" className="flex items-center gap-1.5 hover:text-white transition-colors" data-testid="link-home">
            <ArrowLeft className="w-3.5 h-3.5" /> Voltar à página inicial
          </Link>
        </div>
      </div>
    </div>
  );
}
