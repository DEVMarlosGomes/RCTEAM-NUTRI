import React, { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import {
  LayoutDashboard, Users, CalendarDays, LogOut, Bot, Stethoscope, Settings, Database,
  BookOpenText, PackagePlus, Menu, X, Wallet, SlidersHorizontal, MessageCircle, ClipboardList, MessagesSquare,
} from "lucide-react";
import RCLogo from "./RCLogo";

// Menu reorganizado (ajuste sb1): Configurações no rodapé; Depoimentos, Rótulos e Medidas caseiras saem do menu
// (as telas continuam existindo pelo link direto).
const groups = [
  {
    label: "Clínica",
    links: [
      { to: "/dashboard", label: "Painel", icon: LayoutDashboard, testid: "nav-dashboard" },
      { to: "/agenda", label: "Agenda", icon: CalendarDays, testid: "nav-agenda" },
      { to: "/pacientes", label: "Pacientes", icon: Users, testid: "nav-pacientes" },
      { to: "/consultorio", label: "Consultório", icon: Stethoscope, testid: "nav-consultorio" },
      { to: "/pagamentos", label: "Pagamentos", icon: Wallet, testid: "nav-pagamentos" },
    ],
  },
  {
    label: "Acompanhamento",
    links: [
      { to: "/acompanhamento/conversas", label: "Conversas do WhatsApp", icon: MessagesSquare, testid: "nav-conversas" },
      { to: "/acompanhamento/mensagens", label: "Mensagens e lembretes", icon: MessageCircle, testid: "nav-mensagens" },
      { to: "/acompanhamento/formularios", label: "Formulários", icon: ClipboardList, testid: "nav-formularios" },
    ],
  },
  {
    label: "Base nutricional",
    links: [
      { to: "/cadastro-alimentos", label: "Alimentos", icon: Database, testid: "nav-cadastro-alimentos" },
      { to: "/cadastro-insumos", label: "Suplementos e fórmulas", icon: PackagePlus, testid: "nav-cadastro-insumos" },
      { to: "/orientacoes", label: "Orientações", icon: BookOpenText, testid: "nav-orientacoes" },
      { to: "/configuracoes-dieta", label: "Padrões da dieta", icon: SlidersHorizontal, testid: "nav-configuracoes-dieta" },
    ],
  },
  {
    label: "Inteligência",
    links: [
      { to: "/agentes", label: "Agentes IA", icon: Bot, testid: "nav-agentes" },
    ],
  },
];

function NavItem({ link, onNavigate, compacto }) {
  return (
    <NavLink
      to={link.to}
      data-testid={link.testid}
      onClick={onNavigate}
      title={compacto ? link.label : undefined}
      aria-label={compacto ? link.label : undefined}
      className={({ isActive }) =>
        `group relative flex items-center gap-3 h-11 ${compacto ? "justify-center px-0" : "pl-3 pr-2"} text-[14px] transition-colors duration-150 ${
          isActive
            ? "rc-corte bg-rc-blue text-black font-semibold"
            : "text-gray-400 hover:text-gray-100 hover:bg-white/[0.04]"
        }`
      }
    >
      {({ isActive }) => (
        <>
          <link.icon className={`w-[17px] h-[17px] shrink-0 ${isActive ? "text-black" : "text-gray-500 group-hover:text-gray-300"}`} strokeWidth={1.75} />
          {!compacto && <span className="truncate">{link.label}</span>}
        </>
      )}
    </NavLink>
  );
}

function SidebarContent({ user, onLogout, onNavigate, compacto }) {
  return (
    <div className="flex flex-col h-full">
      <Link to="/dashboard" onClick={onNavigate} className={`flex items-center gap-3 h-16 shrink-0 ${compacto ? "justify-center" : "px-5"}`} title={compacto ? "Painel" : undefined}>
        <RCLogo size={34} variant="ghost" />
        {!compacto && <div className="leading-none">
          <div className="font-display uppercase text-[12px] tracking-[0.04em] text-white">
            Rogério Costa
          </div>
          <div className="text-[9.5px] uppercase tracking-[0.14em] text-gray-500 mt-1 whitespace-nowrap">Nutrição · Performance</div>
        </div>}
      </Link>

      <nav className={`flex-1 overflow-y-auto pb-4 ${compacto ? "px-2" : "px-3"}`} aria-label="Navegação principal">
        {groups.map((g, gi) => (
          <div key={g.label} className={gi ? `${compacto ? "mt-3 pt-3" : "mt-5 pt-4"} border-t border-white/[0.05]` : "mt-2"}>
            {!compacto && <div className="px-3 mb-1.5 text-[10.5px] uppercase tracking-[0.16em] text-gray-500">{g.label}</div>}
            <div className="space-y-0.5">
              {g.links.map((l) => <NavItem key={l.to} link={l} onNavigate={onNavigate} compacto={compacto} />)}
            </div>
          </div>
        ))}
      </nav>

      <div className={`border-t border-white/[0.05] ${compacto ? "p-2" : "p-3"}`}>
        <NavItem link={{ to: "/configuracoes", label: "Configurações", icon: Settings, testid: "nav-configuracoes" }} onNavigate={onNavigate} compacto={compacto} />
        <div className={`mt-1 flex items-center gap-3 rounded-xl ${compacto ? "flex-col p-1" : "p-2"}`}>
          <div className="w-9 h-9 rounded-none bg-rc-raised text-rc-blue flex items-center justify-center font-display font-bold text-sm shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
            {(user?.name || "U").slice(0, 1).toUpperCase()}
          </div>
          {!compacto && (
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium text-gray-100 truncate">{user?.name || "Usuário"}</div>
              <div className="text-[11px] text-gray-500 truncate">{user?.email}</div>
            </div>
          )}
          <button
            data-testid="logout-button"
            onClick={onLogout}
            className="rc-btn-ghost p-2"
            title="Sair"
            aria-label="Sair"
          >
            <LogOut className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** compacto: menu lateral recolhido (só ícones), para telas que precisam de largura (Prescrição, Recordatório). */
export default function NutriLayout({ children, compacto = false }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setDrawerOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const handleLogout = async () => { await logout(); navigate("/"); };

  return (
    <div className="min-h-[100dvh] flex text-gray-100">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] rc-btn-secondary">
        Pular para o conteúdo
      </a>

      <aside className={`${compacto ? "w-[64px]" : "w-[248px]"} hidden md:block shrink-0 sticky top-0 h-[100dvh] bg-rc-black/40 border-r border-white/[0.05] transition-[width] duration-200`} data-testid="menu-lateral">
        <SidebarContent user={user} onLogout={handleLogout} compacto={compacto} />
      </aside>

      {/* Drawer mobile */}
      <div
        className={`md:hidden fixed inset-0 z-50 transition-opacity duration-200 ${drawerOpen ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        aria-hidden={!drawerOpen}
        inert={!drawerOpen}
      >
        <button aria-label="Fechar menu" className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
        <aside
          className={`absolute left-0 top-0 h-full w-[84%] max-w-[300px] bg-rc-ink shadow-[var(--shadow-pop)] transition-transform duration-300 ease-drawer ${drawerOpen ? "translate-x-0" : "-translate-x-full"}`}
        >
          <button onClick={() => setDrawerOpen(false)} className="absolute right-3 top-4 rc-btn-ghost p-2" aria-label="Fechar menu">
            <X className="w-5 h-5" />
          </button>
          <SidebarContent user={user} onLogout={handleLogout} onNavigate={() => setDrawerOpen(false)} />
        </aside>
      </div>

      <main id="conteudo" className="flex-1 min-w-0">
        <div className="md:hidden flex items-center justify-between h-14 px-4 border-b border-white/[0.05] bg-rc-ink/80 backdrop-blur-xl sticky top-0 z-30">
          <button
            onClick={() => setDrawerOpen(true)}
            className="rc-btn-ghost p-2 -ml-2"
            aria-label="Abrir menu"
            aria-expanded={drawerOpen}
            data-testid="mobile-menu-button"
          >
            <Menu className="w-5 h-5" />
          </button>
          <Link to="/dashboard" className="flex items-center gap-2">
            <RCLogo size={26} variant="blue" />
            <span className="font-display font-extrabold italic uppercase text-sm" style={{ fontStretch: "75%" }}>Rogério Costa</span>
          </Link>
          <button data-testid="logout-button-mobile" onClick={handleLogout} className="rc-btn-ghost p-2 -mr-2" aria-label="Sair">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
        <div className={`px-4 py-5 sm:px-6 sm:py-7 ${compacto ? "lg:px-6 max-w-[1600px]" : "lg:px-10 max-w-[1440px]"} lg:py-9 mx-auto animate-fade-in`}>{children}</div>
      </main>
    </div>
  );
}
