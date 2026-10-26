import React, { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import {
  LayoutDashboard, Users, CalendarDays, LogOut, Bot, Stethoscope, Settings, Quote, Database,
  Ruler, FileText, BookOpenText, PackagePlus, Menu, X, Wallet,
} from "lucide-react";
import RCLogo from "./RCLogo";

const groups = [
  {
    label: "Clínica",
    links: [
      { to: "/dashboard", label: "Painel", icon: LayoutDashboard, testid: "nav-dashboard" },
      { to: "/pacientes", label: "Pacientes", icon: Users, testid: "nav-pacientes" },
      { to: "/agenda", label: "Agenda", icon: CalendarDays, testid: "nav-agenda" },
      { to: "/pagamentos", label: "Pagamentos", icon: Wallet, testid: "nav-pagamentos" },
      { to: "/consultorio", label: "Consultório", icon: Stethoscope, testid: "nav-consultorio" },
    ],
  },
  {
    label: "Inteligência",
    links: [
      { to: "/agentes", label: "Agentes IA", icon: Bot, testid: "nav-agentes" },
    ],
  },
  {
    label: "Base nutricional",
    links: [
      { to: "/cadastro-alimentos", label: "Alimentos", icon: Database, testid: "nav-cadastro-alimentos" },
      { to: "/cadastro-insumos", label: "Insumos", icon: PackagePlus, testid: "nav-cadastro-insumos" },
      { to: "/cadastro-medidas", label: "Medidas caseiras", icon: Ruler, testid: "nav-cadastro-medidas" },
      { to: "/rotulos-nutricionais", label: "Rótulos", icon: FileText, testid: "nav-rotulos-nutricionais" },
      { to: "/orientacoes", label: "Orientações", icon: BookOpenText, testid: "nav-orientacoes" },
    ],
  },
  {
    label: "Marca",
    links: [
      { to: "/depoimentos", label: "Depoimentos", icon: Quote, testid: "nav-depoimentos" },
      { to: "/configuracoes", label: "Configurações", icon: Settings, testid: "nav-configuracoes" },
    ],
  },
];

function NavItem({ link, onNavigate }) {
  return (
    <NavLink
      to={link.to}
      data-testid={link.testid}
      onClick={onNavigate}
      className={({ isActive }) =>
        `group relative flex items-center gap-3 h-9 pl-3 pr-2 rounded-lg text-[13.5px] transition-colors duration-150 ${
          isActive
            ? "bg-white/[0.06] text-white font-medium"
            : "text-gray-400 hover:text-gray-100 hover:bg-white/[0.035]"
        }`
      }
    >
      {({ isActive }) => (
        <>
          <span
            aria-hidden
            className={`absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-rc-lime transition-opacity duration-200 ${isActive ? "opacity-100" : "opacity-0"}`}
          />
          <link.icon className={`w-[17px] h-[17px] shrink-0 ${isActive ? "text-rc-lime" : "text-gray-500 group-hover:text-gray-300"}`} strokeWidth={1.75} />
          <span className="truncate">{link.label}</span>
        </>
      )}
    </NavLink>
  );
}

function SidebarContent({ user, onLogout, onNavigate }) {
  return (
    <div className="flex flex-col h-full">
      <Link to="/dashboard" onClick={onNavigate} className="flex items-center gap-3 px-5 h-16 shrink-0">
        <RCLogo size={30} variant="blue" />
        <div className="leading-none">
          <div className="font-display font-extrabold italic uppercase text-[15px] tracking-[0.01em] text-white" style={{ fontStretch: "75%" }}>
            Rogério Costa
          </div>
          <div className="text-[9.5px] uppercase tracking-[0.14em] text-gray-500 mt-1 whitespace-nowrap">Nutrição · Performance</div>
        </div>
      </Link>

      <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Navegação principal">
        {groups.map((g, gi) => (
          <div key={g.label} className={gi ? "mt-5 pt-4 border-t border-white/[0.05]" : "mt-2"}>
            <div className="px-3 mb-1.5 text-[10.5px] uppercase tracking-[0.16em] text-gray-500">{g.label}</div>
            <div className="space-y-0.5">
              {g.links.map((l) => <NavItem key={l.to} link={l} onNavigate={onNavigate} />)}
            </div>
          </div>
        ))}
      </nav>

      <div className="p-3 border-t border-white/[0.05]">
        <div className="flex items-center gap-3 p-2 rounded-xl">
          <div className="w-9 h-9 rounded-[10px] bg-rc-raised text-rc-lime flex items-center justify-center font-display font-bold text-sm shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
            {(user?.name || "U").slice(0, 1).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium text-gray-100 truncate">{user?.name || "Usuário"}</div>
            <div className="text-[11px] text-gray-500 truncate">{user?.email}</div>
          </div>
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

export default function NutriLayout({ children }) {
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

      <aside className="w-[248px] hidden md:block shrink-0 sticky top-0 h-[100dvh] bg-rc-black/40 border-r border-white/[0.05]">
        <SidebarContent user={user} onLogout={handleLogout} />
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
        <div className="px-4 py-5 sm:px-6 sm:py-7 lg:px-10 lg:py-9 max-w-[1440px] mx-auto animate-fade-in">{children}</div>
      </main>
    </div>
  );
}
