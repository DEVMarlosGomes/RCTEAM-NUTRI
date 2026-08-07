import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";

import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import PreConsulta from "@/pages/PreConsulta";
import Chat from "@/pages/Chat";
import Agendar from "@/pages/Agendar";
import Sucesso from "@/pages/Sucesso";
import Dashboard from "@/pages/Dashboard";
import Pacientes from "@/pages/Pacientes";
import PacienteDetalhe from "@/pages/PacienteDetalhe";
import Agenda from "@/pages/Agenda";
import Agentes from "@/pages/Agentes";
import Consultorio from "@/pages/Consultorio";
import PatientArea from "@/pages/PatientArea";
import Configuracoes from "@/pages/Configuracoes";
import AgenteConfig from "@/pages/AgenteConfig";
import Depoimentos from "@/pages/Depoimentos";
import PatientLogin from "@/pages/PatientLogin";
import Atendimento from "@/pages/Atendimento";
import Checkout from "@/pages/Checkout";
import CadastroAlimentos from "@/pages/CadastroAlimentos";
import CadastroMedidas from "@/pages/CadastroMedidas";
import RotulosNutricionais from "@/pages/RotulosNutricionais";
import OrientacoesNutricionais from "@/pages/OrientacoesNutricionais";

function Loader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-rc-ink">
      <div className="w-10 h-10 rounded-full border-2 border-rc-blue border-t-transparent animate-spin" />
    </div>
  );
}

function Protected({ children, role, loginPath }) {
  const { user } = useAuth();
  if (user === null) return <Loader />;
  const redirectTo = loginPath || (role === "patient" ? "/login-paciente" : "/login");
  if (!user) return <Navigate to={redirectTo} replace />;
  if (role && user.role !== role) {
    const target = user.role === "patient" ? "/paciente" : "/dashboard";
    return <Navigate to={target} replace />;
  }
  return children;
}

function App() {
  return (
    <div className="App">
      <Toaster
        position="top-right"
        theme="dark"
        toastOptions={{
          style: { background: "#0F141B", border: "1px solid rgba(0,129,253,0.25)", color: "#fff" },
        }}
      />
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/login-paciente" element={<PatientLogin />} />
            <Route path="/atendimento" element={<Atendimento />} />
            <Route path="/checkout/:token" element={<Checkout />} />
            <Route path="/pre-consulta" element={<PreConsulta />} />
            <Route path="/pre-consulta/:token" element={<PreConsulta />} />
            <Route path="/chat/:token" element={<Chat />} />
            <Route path="/agendar/:token" element={<Agendar />} />
            <Route path="/sucesso/:token" element={<Sucesso />} />

            {/* Nutritionist area */}
            <Route path="/dashboard" element={<Protected role="nutritionist"><Dashboard /></Protected>} />
            <Route path="/pacientes" element={<Protected role="nutritionist"><Pacientes /></Protected>} />
            <Route path="/pacientes/:id" element={<Protected role="nutritionist"><PacienteDetalhe /></Protected>} />
            <Route path="/agenda" element={<Protected role="nutritionist"><Agenda /></Protected>} />
            <Route path="/agentes" element={<Protected role="nutritionist"><Agentes /></Protected>} />
            <Route path="/consultorio" element={<Protected role="nutritionist"><Consultorio /></Protected>} />
            <Route path="/cadastro-alimentos" element={<Protected role="nutritionist"><CadastroAlimentos /></Protected>} />
            <Route path="/cadastro-medidas" element={<Protected role="nutritionist"><CadastroMedidas /></Protected>} />
            <Route path="/rotulos-nutricionais" element={<Protected role="nutritionist"><RotulosNutricionais /></Protected>} />
            <Route path="/orientacoes" element={<Protected role="nutritionist"><OrientacoesNutricionais /></Protected>} />
            <Route path="/configuracoes" element={<Protected role="nutritionist"><Configuracoes /></Protected>} />
            <Route path="/agente-config" element={<Protected role="nutritionist"><AgenteConfig /></Protected>} />
            <Route path="/depoimentos" element={<Protected role="nutritionist"><Depoimentos /></Protected>} />

            {/* Patient area */}
            <Route path="/paciente" element={<Protected role="patient"><PatientArea /></Protected>} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </div>
  );
}

export default App;
