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

function Protected({ children }) {
  const { user } = useAuth();
  if (user === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-evo-bg">
        <div className="w-10 h-10 rounded-full border-2 border-evo-purple border-t-transparent animate-spin" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function App() {
  return (
    <div className="App font-sans">
      <Toaster
        position="top-right"
        theme="dark"
        toastOptions={{
          style: { background: "#161B22", border: "1px solid rgba(255,255,255,0.08)", color: "#fff" },
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

            <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
            <Route path="/pacientes" element={<Protected><Pacientes /></Protected>} />
            <Route path="/pacientes/:id" element={<Protected><PacienteDetalhe /></Protected>} />
            <Route path="/agenda" element={<Protected><Agenda /></Protected>} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </div>
  );
}

export default App;
