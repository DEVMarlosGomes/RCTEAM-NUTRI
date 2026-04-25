import React from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { LayoutDashboard, Users, CalendarDays, LogOut } from "lucide-react";
import Brand from "./Brand";
import RCLogo from "./RCLogo";

const links = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, testid: "nav-dashboard" },
  { to: "/pacientes", label: "Pacientes", icon: Users, testid: "nav-pacientes" },
  { to: "/agenda", label: "Agenda", icon: CalendarDays, testid: "nav-agenda" },
];

export default function NutriLayout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex bg-rc-ink text-white">
      <aside className="w-64 hidden md:flex flex-col border-r border-white/[0.06] bg-rc-surface/50 backdrop-blur-xl">
        <div className="p-6">
          <Brand size="sm" />
        </div>
        <nav className="px-3 py-2 space-y-1 flex-1">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              data-testid={l.testid}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-bold uppercase tracking-wider transition-all ${
                  isActive
                    ? "bg-rc-blue/15 text-rc-blue border border-rc-blue/40 shadow-[0_4px_18px_-6px_rgba(0,129,253,0.5)]"
                    : "text-gray-300 hover:text-white hover:bg-white/5 border border-transparent"
                }`
              }
            >
              <l.icon className="w-4 h-4" />
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-4 border-t border-white/[0.06]">
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="w-9 h-9 rounded-full bg-rc-blue text-black flex items-center justify-center text-sm font-black">
              {(user?.name || "U").slice(0, 1).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold truncate uppercase tracking-wide">{user?.name || "Usuário"}</div>
              <div className="text-xs text-gray-500 truncate">{user?.email}</div>
            </div>
            <button
              data-testid="logout-button"
              onClick={async () => { await logout(); navigate("/"); }}
              className="rc-btn-ghost p-2"
              title="Sair"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <div className="md:hidden flex items-center justify-between p-4 border-b border-white/[0.06] bg-rc-surface/60 backdrop-blur-xl sticky top-0 z-10">
          <Link to="/dashboard" className="flex items-center gap-2">
            <RCLogo size={32} variant="blue" />
            <span className="font-display font-black tracking-wider text-sm uppercase">Rogério Costa</span>
          </Link>
          <button
            data-testid="logout-button-mobile"
            onClick={async () => { await logout(); navigate("/"); }}
            className="rc-btn-ghost"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 sm:p-6 lg:p-10">{children}</div>
      </main>
    </div>
  );
}
