import React from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Sparkles } from "lucide-react";
import GlowOrb from "@/components/evonut/GlowOrb";

export default function Sucesso() {
  return (
    <div className="min-h-screen relative bg-evo-bg flex items-center justify-center px-4">
      <GlowOrb color="#1DB97E" size={500} top="20%" left="20%" opacity={0.3} />
      <GlowOrb color="#7B61FF" size={400} top="50%" left="60%" opacity={0.25} />
      <div className="relative z-10 evo-glass rounded-2xl p-10 max-w-lg w-full text-center animate-fade-up">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-evo-purple to-evo-teal flex items-center justify-center mx-auto shadow-[0_8px_32px_rgba(123,97,255,0.4)]">
          <CheckCircle2 className="w-8 h-8 text-white" />
        </div>
        <h1 className="evo-h2 mt-6">Consulta confirmada! 🎉</h1>
        <p className="text-gray-300 mt-3">
          Você receberá lembretes automáticos pelo WhatsApp 24h e 1h antes da consulta.
          Sua nutricionista já tem acesso à sua anamnese, à conversa e ao seu perfil clínico inicial.
        </p>
        <div className="mt-8 flex flex-col gap-3">
          <Link to="/" className="evo-btn-primary justify-center">
            <Sparkles className="w-4 h-4" /> Voltar à página inicial
          </Link>
        </div>
      </div>
    </div>
  );
}
