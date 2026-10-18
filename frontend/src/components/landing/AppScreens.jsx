import React from "react";
import { Check, Play, Pause, Flame, Trophy, ChevronRight, Timer } from "lucide-react";
import MacroRings from "@/components/evonut/MacroRings";

/*
 * Telas ilustrativas do app (treino = FitMaster, nutricao = RCTEAM-NUTRI), desenhadas em codigo.
 * Os dados sao de exemplo; nenhuma informacao de aluno real.
 */

/** Moldura de celular. */
export function Phone({ className = "", children, label }) {
  return (
    <div
      role="img"
      aria-label={label}
      className={`relative w-[290px] sm:w-[310px] aspect-[9/19] rounded-[46px] bg-[#05070A] p-[10px] shadow-[0_0_0_1px_rgba(255,255,255,0.12),0_0_0_7px_#11161D,0_0_0_8px_rgba(255,255,255,0.08),0_60px_120px_-30px_rgba(0,0,0,0.9)] ${className}`}
    >
      <div className="relative h-full w-full rounded-[37px] overflow-hidden bg-rc-ink">
        <div className="absolute top-2.5 left-1/2 -translate-x-1/2 w-[92px] h-[26px] rounded-full bg-black z-20" />
        <div className="absolute inset-0 bg-[radial-gradient(400px_220px_at_20%_-10%,rgba(0,129,253,0.18),transparent_60%)]" />
        {children}
      </div>
    </div>
  );
}

function TabBar({ active }) {
  const tabs = ["Treino", "Dieta", "Evolução", "Chat"];
  return (
    <div className="absolute bottom-0 inset-x-0 h-14 bg-rc-ink/95 border-t border-white/[0.06] grid grid-cols-4 text-[9px] z-10">
      {tabs.map((t) => (
        <div key={t} className={`flex flex-col items-center justify-center gap-1 ${t === active ? "text-rc-lime" : "text-gray-500"}`}>
          <span className={`w-4 h-4 rounded-[5px] ${t === active ? "bg-rc-lime/80" : "bg-white/[0.12]"}`} />{t}
        </div>
      ))}
    </div>
  );
}

const card = "rounded-2xl bg-rc-surface shadow-[var(--shadow-card)]";

/** Treino do dia: lista de exercicios no formato do ExerciseCard do FitMaster. */
export function WorkoutScreen() {
  const exercicios = [
    { n: "Supino reto", g: "Peito", s: "4x 10", c: "32 kg", done: true },
    { n: "Crucifixo inclinado", g: "Peito", s: "3x 12", c: "14 kg", done: true },
    { n: "Desenvolvimento", g: "Ombros", s: "4x 10", c: "18 kg", now: true },
    { n: "Tríceps corda", g: "Tríceps", s: "3x 15", c: "25 kg" },
  ];
  return (
    <div className="relative px-4 pt-14 h-full">
      <div className="flex items-center justify-between px-1">
        <div>
          <div className="text-[9px] uppercase tracking-[0.2em] text-rc-lime">Treino de hoje</div>
          <div className="rc-display text-[26px] text-white mt-1">Treino A</div>
          <div className="text-[10.5px] text-gray-400">Peito · ombros · tríceps</div>
        </div>
        <div className="flex items-center gap-1 rounded-full bg-rc-amber/15 text-rc-amber px-2 py-1 text-[10px] font-semibold">
          <Flame className="w-3 h-3" /> 7 dias
        </div>
      </div>
      <div className="mt-3 px-1">
        <div className="flex justify-between text-[10px] text-gray-400"><span>2 de 4 exercícios</span><span className="tabular">50%</span></div>
        <div className="h-1.5 rounded-full bg-white/[0.06] mt-1"><div className="h-full w-1/2 rounded-full bg-rc-lime" /></div>
      </div>
      <div className="mt-3 space-y-2">
        {exercicios.map((e) => (
          <div key={e.n} className={`${card} flex items-stretch overflow-hidden ${e.now ? "shadow-[0_0_0_1.5px_#C3F53C]" : ""}`}>
            <div className={`w-14 shrink-0 flex items-center justify-center ${e.done ? "bg-rc-lime/[0.12]" : "bg-white/[0.04]"}`}>
              {e.done ? <Check className="w-4 h-4 text-rc-lime" strokeWidth={3} /> : <Play className={`w-3.5 h-3.5 ${e.now ? "text-rc-lime fill-current" : "text-gray-500"}`} />}
            </div>
            <div className="flex-1 min-w-0 px-3 py-2.5">
              <div className="flex items-center justify-between gap-1">
                <div className={`text-[12.5px] font-semibold truncate ${e.done ? "text-gray-400" : "text-white"}`}>{e.n}</div>
                <ChevronRight className="w-3.5 h-3.5 text-gray-600 shrink-0" />
              </div>
              <div className="text-[10px] text-rc-blueLight">{e.g}</div>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-gray-200 tabular">{e.s}</span>
                <span className="text-[10px] text-gray-400 tabular">{e.c}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      <TabBar active="Treino" />
    </div>
  );
}

/** Registro de series + timer de descanso (SetTracker do FitMaster). */
export function SetScreen() {
  const series = [
    { kg: "18", reps: "10", ok: true },
    { kg: "18", reps: "10", ok: true },
    { kg: "20", reps: "8", ok: false, now: true },
    { kg: "20", reps: "8", ok: false },
  ];
  const c = 2 * Math.PI * 46;
  return (
    <div className="relative px-4 pt-14 h-full">
      <div className="px-1">
        <div className="text-[9px] uppercase tracking-[0.2em] text-rc-lime">Treino em andamento</div>
        <div className="rc-display text-[24px] text-white mt-1">Desenvolvimento</div>
        <div className="text-[10.5px] text-gray-400">Ombros · 4x 10 · descanso 90s</div>
      </div>

      <div className={`${card} mt-3 p-3.5 flex items-center gap-4`}>
        <div className="relative w-[84px] h-[84px] shrink-0">
          <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90" aria-hidden>
            <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7" />
            <circle cx="50" cy="50" r="46" fill="none" stroke="#C3F53C" strokeWidth="7" strokeLinecap="round" strokeDasharray={`${c * 0.62} ${c}`} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="rc-num text-[22px] text-white leading-none">00:56</span>
            <span className="text-[8.5px] text-gray-500 mt-0.5">descanso</span>
          </div>
        </div>
        <div className="flex-1 space-y-1.5">
          <div className="flex items-center gap-1.5 rounded-full bg-rc-amber/15 text-rc-amber px-2.5 py-1 text-[10px] font-semibold w-fit"><Pause className="w-3 h-3" />Pausar</div>
          <div className="flex items-center gap-1.5 rounded-full bg-white/[0.06] text-gray-300 px-2.5 py-1 text-[10px] w-fit"><Timer className="w-3 h-3" />Alerta sonoro</div>
        </div>
      </div>

      <div className={`${card} mt-3 p-3`}>
        <div className="grid grid-cols-[28px_1fr_1fr_24px] text-[9px] uppercase tracking-[0.12em] text-gray-500 px-1 pb-1.5">
          <span>Série</span><span>Carga</span><span>Reps</span><span />
        </div>
        <div className="space-y-1.5">
          {series.map((s, i) => (
            <div key={i} className={`grid grid-cols-[28px_1fr_1fr_24px] items-center rounded-xl px-1 py-1.5 ${s.now ? "bg-rc-lime/[0.08] shadow-[0_0_0_1px_rgba(195,245,60,0.35)]" : ""}`}>
              <span className="rc-num text-[14px] text-gray-400 pl-1">{i + 1}</span>
              <span className="text-[12px] text-white tabular">{s.kg} <span className="text-gray-500 text-[10px]">kg</span></span>
              <span className="text-[12px] text-white tabular">{s.reps}</span>
              <span className={`w-5 h-5 rounded-md flex items-center justify-center ${s.ok ? "bg-rc-lime text-rc-ink" : "bg-white/[0.06]"}`}>
                {s.ok && <Check className="w-3 h-3" strokeWidth={3} />}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 rounded-2xl bg-rc-blue/[0.12] px-3.5 py-2.5 text-[10.5px] text-gray-200">
        <span className="text-rc-blueLight font-semibold">Recorde pessoal:</span> +2 kg desde a última semana
      </div>
      <TabBar active="Treino" />
    </div>
  );
}

/** Evolucao de carga + conquistas (ProgressPage / GamificationPage). */
export function ProgressScreen() {
  const pts = [22, 24, 24, 26, 28, 28, 30, 32];
  const max = 34, min = 18, w = 240, h = 96;
  const path = pts.map((v, i) => `${(i / (pts.length - 1)) * w},${h - ((v - min) / (max - min)) * h}`).join(" ");
  return (
    <div className="relative px-4 pt-14 h-full">
      <div className="px-1">
        <div className="text-[9px] uppercase tracking-[0.2em] text-rc-lime">Evolução</div>
        <div className="rc-display text-[24px] text-white mt-1">Supino reto</div>
      </div>
      <div className={`${card} mt-3 p-3.5`}>
        <div className="flex items-baseline justify-between">
          <div className="flex items-baseline gap-1">
            <span className="rc-num text-[34px] text-white leading-none">32</span><span className="text-[10px] text-gray-400">kg</span>
          </div>
          <span className="rounded-full bg-rc-lime/15 text-rc-lime text-[10px] font-semibold px-2 py-0.5">+10 kg</span>
        </div>
        <div className="text-[10px] text-gray-500 mt-0.5">Carga máxima · 8 semanas</div>
        <svg viewBox={`-4 -6 ${w + 8} ${h + 12}`} className="w-full mt-3" aria-hidden>
          <defs>
            <linearGradient id="rc-evo" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#C3F53C" stopOpacity="0.3" /><stop offset="1" stopColor="#C3F53C" stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon points={`0,${h} ${path} ${w},${h}`} fill="url(#rc-evo)" />
          <polyline points={path} fill="none" stroke="#C3F53C" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          {pts.map((v, i) => <circle key={i} cx={(i / (pts.length - 1)) * w} cy={h - ((v - min) / (max - min)) * h} r={i === pts.length - 1 ? 4 : 2} fill="#C3F53C" />)}
        </svg>
      </div>
      <div className="mt-3 text-[9px] uppercase tracking-[0.16em] text-gray-500 px-1">Conquistas</div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {[
          { t: "Dedicado", d: "7 dias", icon: Flame, cls: "text-rc-amber bg-rc-amber/[0.12]" },
          { t: "Força +10", d: "supino", icon: Trophy, cls: "text-rc-lime bg-rc-lime/[0.12]" },
          { t: "Veterano", d: "50 treinos", icon: Trophy, cls: "text-gray-500 bg-white/[0.05]", locked: true },
        ].map((b) => (
          <div key={b.t} className={`${card} p-2.5 text-center ${b.locked ? "opacity-50" : ""}`}>
            <div className={`mx-auto w-8 h-8 rounded-[10px] flex items-center justify-center ${b.cls}`}><b.icon className="w-4 h-4" /></div>
            <div className="text-[10px] text-white font-semibold mt-1.5">{b.t}</div>
            <div className="text-[8.5px] text-gray-500">{b.d}</div>
          </div>
        ))}
      </div>
      <TabBar active="Evolução" />
    </div>
  );
}

/** Area de nutricao (RCTEAM-NUTRI). */
export function NutritionScreen() {
  return (
    <div className="relative px-4 pt-14 h-full">
      <div className="px-1">
        <div className="text-[9px] uppercase tracking-[0.2em] text-rc-lime">Minha dieta</div>
        <div className="rc-display text-[26px] text-white mt-1">Olá, <span className="text-rc-lime">Ana</span></div>
      </div>
      <div className={`${card} mt-3 p-4 relative`}>
        <MacroRings className="absolute right-3 top-3 w-[64px] h-[64px]" stroke={20} values={{ ptn: 0.3, cho: 0.45, lip: 0.25 }} />
        <div className="text-[10px] text-gray-400">Meta diária</div>
        <div className="flex items-baseline gap-1 mt-0.5">
          <span className="rc-num text-[40px] leading-none text-white">1.820</span>
          <span className="text-[10px] text-gray-400">kcal</span>
        </div>
        {[
          ["Proteína", "136 g", "w-[30%]", "bg-macro-ptn"],
          ["Carboidrato", "205 g", "w-[45%]", "bg-macro-cho"],
          ["Gordura", "51 g", "w-[25%]", "bg-macro-lip"],
        ].map(([l, g, wd, c]) => (
          <div key={l} className="mt-2.5">
            <div className="flex justify-between text-[10px]"><span className="text-gray-300">{l}</span><span className="text-white tabular">{g}</span></div>
            <div className="h-1 rounded-full bg-white/[0.06] mt-1"><div className={`h-full rounded-full ${wd} ${c}`} /></div>
          </div>
        ))}
      </div>
      <div className={`${card} mt-3 p-4`}>
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-[0.14em] text-gray-400">Pós-treino</span>
          <span className="rc-num text-[14px] text-white">19:30</span>
        </div>
        <ul className="mt-2 space-y-1 text-[11px] text-gray-300">
          <li>150 g de patinho moído</li>
          <li>5 col. de arroz + feijão</li>
          <li>Legumes no vapor à vontade</li>
        </ul>
      </div>
      <div className="mt-3 rounded-2xl bg-rc-blue/[0.12] p-3.5 flex items-center gap-3">
        <div className="w-8 h-8 rounded-[10px] bg-rc-blue flex items-center justify-center text-rc-ink text-[11px] font-bold">RC</div>
        <div className="min-w-0">
          <div className="text-[11px] text-white font-medium">Rogério</div>
          <div className="text-[10.5px] text-gray-300 truncate">Carbo ajustado para o dia de treino.</div>
        </div>
      </div>
      <TabBar active="Dieta" />
    </div>
  );
}
