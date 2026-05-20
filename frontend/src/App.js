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

function Loader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-rc-ink">
      <div className="w-10 h-10 rounded-full border-2 border-rc-blue border-t-transparent animate-spin" />
    </div>
  );
}

function Protected({ children, role }) {
  const { user } = useAuth();
  if (user === null) return <Loader />;
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) {
    // Send each user back to the right home
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
            <Route path="/configuracoes" element={<Protected role="nutritionist"><Configuracoes /></Protected>} />

            {/* Patient area */}
            <Route path="/paciente" element={<Protected role="patient"><PatientArea /></Protected>} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </div>
  );
}

export default App;
