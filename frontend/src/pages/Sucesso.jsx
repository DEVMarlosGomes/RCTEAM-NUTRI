import React from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, ArrowLeft } from "lucide-react";
import GlowOrb from "@/components/evonut/GlowOrb";
import Brand from "@/components/evonut/Brand";

export default function Sucesso() {
  return (
    <div className="min-h-screen relative bg-rc-ink flex items-center justify-center px-4">
      <GlowOrb color="#0081FD" size={500} top="20%" left="20%" opacity={0.25} />
      <GlowOrb color="#0066CC" size={400} top="50%" left="60%" opacity={0.18} />
      <div className="absolute top-6 left-6 z-10"><Brand size="sm" /></div>
      <div className="relative z-10 rc-glass rounded-2xl p-10 max-w-lg w-full text-center animate-fade-up">
        <div className="w-16 h-16 rounded-full bg-rc-blue flex items-center justify-center mx-auto shadow-[0_8px_32px_rgba(0,129,253,0.5)]">
          <CheckCircle2 className="w-8 h-8 text-black" strokeWidth={2.5} />
        </div>
        <h1 className="rc-h2 mt-6">Consulta confirmada</h1>
        <p className="text-gray-300 mt-3 leading-relaxed">
          Você receberá lembretes automáticos pelo WhatsApp 24h e 1h antes da consulta.
          O Rogério já tem acesso à sua anamnese, à conversa e ao seu perfil clínico inicial.
        </p>
        <div className="mt-8 flex flex-col gap-3">
          <Link to="/" className="rc-btn-primary justify-center">
            <ArrowLeft className="w-4 h-4" /> Voltar à página inicial
          </Link>
        </div>
      </div>
    </div>
  );
}
