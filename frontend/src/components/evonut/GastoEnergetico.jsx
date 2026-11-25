import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, PieChart, Plus, Save, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/evo-api";
import ModeloAvaliacao, { useModeloAvaliacao } from "./ModeloAvaliacao";
import { numerarAvaliacoes } from "./SeletorAvaliacoes";
import { ajustePorPrazo, classificarGordura, classificarImc, classificarRcq, equacoesDonatto, pesoIdeal, protocolosDonatto } from "@/lib/donatto";

/**
 * Gasto Energético numa tela só (item 16 dos ajustes): dados puxados da Antropometria com etiqueta de origem,
 * equações lado a lado, Fator de atividade OU METs (nunca os dois), fator de injúria em "Contexto clínico" e,
 * à direita, a conta em cascata TMB + atividade = GET → ajuste → arredondamento → META FINAL. Embaixo, a
 * projeção da meta de peso (VENTA). No modelo Donatto, as equações da planilha Donatto (item 17).
 */
const nf0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(String(v).replace(",", "."));
  return Number.isFinite(x) ? x : null;
};
const txt = (v) => (v === null || v === undefined ? "" : String(v).replace(".", ","));
const KCAL_KG = 7716.18; // mesma constante do VENTA no backend

const FATORES_RAPIDOS = [1.4, 1.5, 1.55, 1.6];
const FATORES_DIARIOS = [1.2, 1.3, 1.4, 1.5, 1.6, 1.7];
const MULTIPLOS = [1, 10, 50, 100];
const SUGESTAO_MLG = ["cunningham", "tinsley_mlg"];

const formatarData = (v) => (v ? new Date(`${String(v).slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "");
const idadeDe = (nasc) => {
  const b = nasc ? new Date(`${nasc}T12:00:00`) : null;
  if (!b || Number.isNaN(b.getTime())) return null;
  const h = new Date();
  return h.getFullYear() - b.getFullYear() - (h < new Date(h.getFullYear(), b.getMonth(), b.getDate()) ? 1 : 0);
};

/** Atalho de ajuste pelo objetivo da ficha. */
function atalhoDoObjetivo(objetivo) {
  const o = String(objetivo || "").toLowerCase();
  if (/emagre|perda|defini|gordura|secar/.test(o)) return "emagrecer";
  if (/hipertrof|ganho|massa|bulking/.test(o)) return "hipertrofia";
  if (/manut|manter/.test(o)) return "manter";
  return null;
}
const ATALHOS = [["emagrecer", "Emagrecer", "diminuir", 15], ["manter", "Manter", "diminuir", 0], ["hipertrofia", "Hipertrofia", "aumentar", 10]];

/** Treino do formulário: dias marcados e duração tirada do texto de horário ("18h, 1h30" → 90 min). */
function treinoDoFormulario(anamnese) {
  const f = anamnese?.formulario || {};
  const todos = Object.values(f).reduce((a, b) => ({ ...a, ...(b || {}) }), {});
  const dias = Array.isArray(todos.dias_treino) ? todos.dias_treino.filter((x) => !/nenhum/i.test(x)).length : null;
  const texto = String(todos.horario_treino || "");
  let min = null;
  const hm = texto.match(/(\d+)\s*h\s*(\d{1,2})(?!\d)/i);
  const soMin = texto.match(/(\d{2,3})\s*min/i);
  const soH = texto.match(/(\d)\s*h(?:ora)?s?\b(?!\s*\d)/i);
  if (soMin) min = Number(soMin[1]);
  else if (hm && Number(hm[1]) <= 4) min = Number(hm[1]) * 60 + Number(hm[2]);
  else if (soH && Number(soH[1]) <= 4) min = Number(soH[1]) * 60;
  return { dias, min };
}

function Origem({ children }) {
  return <span className="ml-1.5 inline-flex h-5 items-center rounded-full bg-white/[0.06] px-2 text-[10.5px] font-medium normal-case tracking-normal text-gray-400">{children}</span>;
}

function Campo({ rotulo, valor, onChange, unidade, origem, largura = "w-full", testId }) {
  return (
    <label className="block min-w-0">
      <span className="flex items-center whitespace-nowrap text-[11px] uppercase tracking-[0.12em] text-gray-500">{rotulo}{origem && <Origem>{origem}</Origem>}</span>
      <div className={`relative mt-1.5 ${largura}`}>
        <input inputMode="decimal" className="rc-input h-10 pr-12 tabular" value={valor ?? ""} onChange={(e) => onChange(e.target.value)} data-testid={testId} aria-label={rotulo} />
        {unidade && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-gray-500">{unidade}</span>}
      </div>
    </label>
  );
}

function Chip({ ativo, onClick, children, testId, title }) {
  return (
    <button type="button" onClick={onClick} data-testid={testId} title={title} aria-pressed={ativo}
      className={`h-9 min-w-[56px] rounded-lg px-3 text-[13px] font-semibold tabular transition-colors ${ativo ? "bg-rc-lime text-rc-ink" : "bg-white/[0.05] text-gray-300 hover:bg-white/[0.09]"}`}>
      {children}
    </button>
  );
}

function Cartao({ titulo, numero, children, direita }) {
  return (
    <section className="rc-card p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {numero && <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-rc-blue/15 text-[12px] font-bold text-rc-blueLight">{numero}</span>}
        <h3 className="font-display font-bold uppercase text-[16px] text-white" style={{ fontStretch: "86%" }}>{titulo}</h3>
        {direita && <div className="ml-auto">{direita}</div>}
      </div>
      {children}
    </section>
  );
}

/** Linha da conta em cascata. */
function Degrau({ rotulo, valor, detalhe, sinal, forte, testId }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-2 ${forte ? "border-t border-white/[0.08] mt-1 pt-3" : ""}`}>
      <span className={`text-[13px] ${forte ? "font-semibold text-white" : "text-gray-400"}`}>
        {sinal && <span className="mr-1.5 inline-block w-3 text-gray-500">{sinal}</span>}{rotulo}
        {detalhe && <span className="block pl-[18px] text-[11px] text-gray-500">{detalhe}</span>}
      </span>
      <span className={`tabular whitespace-nowrap ${forte ? "rc-num text-[20px] text-white" : "text-[14px] text-gray-200"}`} data-testid={testId}>{valor == null ? "—" : `${nf0.format(valor)} kcal`}</span>
    </div>
  );
}

// ── Projeção da meta de peso (VENTA) ───────────────────────────────────────
function Projecao({ peso, pesoDesejado, semanas, get, meta }) {
  const p0 = num(peso); const p1 = num(pesoDesejado); const sem = num(semanas);
  if (!p0 || !p1 || !sem) return <p className="text-[13px] text-gray-500">Informe o peso desejado e o prazo para ver a projeção.</p>;
  const dif = p1 - p0;
  const saldoDia = (dif * KCAL_KG) / (sem * 7); // >0 superávit
  const ritmo = Math.abs(dif) / sem;
  const pctSemana = (ritmo / p0) * 100;
  // com a meta final, quanto o peso anda por semana
  const saldoMeta = get && meta ? meta - get : null;
  const kgSemanaMeta = saldoMeta != null ? (saldoMeta * 7) / KCAL_KG : null;
  const semanasMeta = kgSemanaMeta && Math.sign(kgSemanaMeta) === Math.sign(dif) ? Math.abs(dif / kgSemanaMeta) : null;
  // gráfico
  const W = 560; const H = 170; const pad = 34;
  const total = Math.max(sem, Math.min(semanasMeta || 0, sem * 3));
  const minP = Math.min(p0, p1) - 1; const maxP = Math.max(p0, p1) + 1;
  const x = (s) => pad + (s / total) * (W - pad - 10);
  const y = (p) => 10 + (1 - (p - minP) / (maxP - minP)) * (H - 30);
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-[13px]">
        <div><div className="text-[11px] uppercase tracking-[0.12em] text-gray-500">{saldoDia < 0 ? "Déficit por dia" : "Superávit por dia"}</div><div className="rc-num text-[20px] text-white" data-testid="venta-saldo">{nf0.format(Math.abs(saldoDia))} kcal</div></div>
        <div><div className="text-[11px] uppercase tracking-[0.12em] text-gray-500">Ritmo</div><div className="rc-num text-[20px] text-white">{nf2.format(ritmo)} kg/sem</div></div>
        <div><div className="text-[11px] uppercase tracking-[0.12em] text-gray-500">% do peso por semana</div><div className={`rc-num text-[20px] ${pctSemana > 1 ? "text-rc-amber" : "text-white"}`}>{nf2.format(pctSemana)}%</div></div>
        <div><div className="text-[11px] uppercase tracking-[0.12em] text-gray-500">Com a meta final</div><div className="rc-num text-[20px] text-white">{semanasMeta ? `${nf1.format(semanasMeta)} sem` : "—"}</div></div>
      </div>
      {pctSemana > 1 && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-rc-amber/10 px-3 py-2 text-[12.5px] text-rc-amber" data-testid="aviso-venta">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Ritmo acima de 1% do peso por semana. Considere aumentar o prazo para {Math.ceil(Math.abs(dif) / (p0 * 0.01))} semanas ou mais.
        </p>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 w-full max-w-[640px]" role="img" aria-label={`Projeção do peso de ${nf1.format(p0)} para ${nf1.format(p1)} kg em ${sem} semanas`}>
        {[p0, p1].map((p) => (
          <g key={p}><line x1={pad} x2={W - 10} y1={y(p)} y2={y(p)} stroke="rgba(255,255,255,.06)" /><text x={pad - 6} y={y(p) + 4} textAnchor="end" fontSize="10" fill="#8b93a1">{nf1.format(p)}</text></g>
        ))}
        <line x1={x(0)} y1={y(p0)} x2={x(sem)} y2={y(p1)} stroke="#C3F53C" strokeWidth="2.5" />
        {semanasMeta && <line x1={x(0)} y1={y(p0)} x2={x(Math.min(semanasMeta, total))} y2={y(p0 + kgSemanaMeta * Math.min(semanasMeta, total))} stroke="#4DA6FF" strokeWidth="2" strokeDasharray="5 4" />}
        <circle cx={x(sem)} cy={y(p1)} r="4" fill="#C3F53C" />
        <text x={x(sem)} y={H - 4} textAnchor="middle" fontSize="10" fill="#8b93a1">{sem} sem</text>
        <text x={x(0)} y={H - 4} textAnchor="middle" fontSize="10" fill="#8b93a1">hoje</text>
      </svg>
      <div className="mt-1 flex gap-4 text-[11.5px] text-gray-400"><span><span className="inline-block h-0.5 w-4 bg-rc-lime align-middle mr-1.5" />plano pelo prazo</span>{semanasMeta && <span><span className="inline-block h-0.5 w-4 bg-macro-ptn align-middle mr-1.5" />com a meta final</span>}</div>
    </div>
  );
}

// ── Modelo Donatto ─────────────────────────────────────────────────────────
function GastoDonatto({ patient, ultima, dados, salvarMeta, salvando, onIrMacros }) {
  const salvo = patient.meta_energetica?.donatto || {};
  const protocolos = useMemo(() => protocolosDonatto(dados.sexo, dados.idade, ultima?.dobras), [dados.sexo, dados.idade, ultima]);
  const calculaveis = protocolos.filter((p) => p.pct != null);
  const [protocolo, setProtocolo] = useState(salvo.protocolo || ultima?.donatto?.protocolo || calculaveis.find((p) => p.id === "pollock7")?.id || calculaveis[0]?.id || "");
  const [pctAlvo, setPctAlvo] = useState(txt(salvo.pct_alvo ?? (dados.sexo === "M" ? 12 : 22)));
  const [fa, setFa] = useState(salvo.fa || 1.2);
  const [exercicio, setExercicio] = useState(txt(salvo.exercicio ?? 0));
  const [equacao, setEquacao] = useState(salvo.equacao || "iom");
  const [prazo, setPrazo] = useState(salvo.prazo_dias ?? 0);
  const pctAtual = calculaveis.find((p) => p.id === protocolo)?.pct ?? num(ultima?.composicao?.pct_gordura);
  const pi = pesoIdeal(dados.peso, pctAtual, num(pctAlvo));
  const eqs = equacoesDonatto({ sexo: dados.sexo, idade: dados.idade, peso: dados.peso, altura_m: num(dados.altura) / 100, massa_magra: pi?.massa_magra, peso_ideal: pi?.peso_ideal, fa, exercicio: num(exercicio) || 0 });
  const eq = eqs.find((e) => e.id === equacao) || eqs[0];
  const restricao = prazo && pi?.excesso > 0 ? ajustePorPrazo(pi.excesso, prazo) : 0;
  const final = eq ? Math.round(eq.kcal - restricao) : null;

  const salvar = async (irMacros) => {
    const ok = await salvarMeta({
      modelo: "donatto", get_base: eq?.kcal ?? null, kcal_final: final, final_manual: false,
      donatto: { protocolo, pct_atual: pctAtual, pct_alvo: num(pctAlvo), fa: num(fa), exercicio: num(exercicio) || 0, equacao: eq?.id, prazo_dias: prazo || 0, peso_ideal: pi?.peso_ideal ?? null },
    });
    if (ok && irMacros) onIrMacros?.();
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px] items-start" data-testid="gasto-donatto">
      <div className="space-y-4 min-w-0">
        <Cartao numero="1" titulo="Protocolos de dobras lado a lado">
          {!ultima ? <p className="text-[13px] text-gray-500">Sem avaliação com dobras. Registre na Antropometria.</p> : (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {protocolos.map((p) => (
                <button key={p.id} type="button" disabled={p.pct == null} onClick={() => setProtocolo(p.id)} aria-pressed={protocolo === p.id}
                  className={`rounded-xl px-4 py-3 text-left ring-1 transition-colors ${protocolo === p.id ? "bg-rc-blue/15 ring-rc-blue" : "bg-white/[0.03] ring-white/[0.06] hover:ring-white/20"} disabled:opacity-40`}>
                  <div className="text-[12.5px] font-semibold text-gray-200">{p.nome}</div>
                  <div className="rc-num text-[22px] text-white">{p.pct != null ? `${nf1.format(p.pct)}%` : "—"}</div>
                  <div className="text-[11px] text-gray-500">{p.pct != null ? `soma ${nf1.format(p.soma)} mm` : `falta: ${p.falta.join(", ")}`}</div>
                </button>
              ))}
            </div>
          )}
        </Cartao>
        <Cartao numero="2" titulo="Fracionamento e peso ideal">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div><div className="text-[11px] uppercase tracking-[0.12em] text-gray-500">% gordura atual</div><div className="rc-num text-[22px] text-white">{pctAtual != null ? `${nf1.format(pctAtual)}%` : "—"}</div></div>
            <Campo rotulo="% gordura alvo" valor={pctAlvo} onChange={setPctAlvo} unidade="%" testId="donatto-pct-alvo" />
            <div><div className="text-[11px] uppercase tracking-[0.12em] text-gray-500">Peso ideal</div><div className="rc-num text-[22px] text-white" data-testid="donatto-peso-ideal">{pi ? `${nf1.format(pi.peso_ideal)} kg` : "—"}</div></div>
            <div><div className="text-[11px] uppercase tracking-[0.12em] text-gray-500">Peso em excesso</div><div className="rc-num text-[22px] text-white">{pi ? `${nf1.format(pi.excesso)} kg` : "—"}</div></div>
          </div>
          {pi && <p className="mt-3 text-[12px] text-gray-500">Massa magra {nf1.format(pi.massa_magra)} kg · massa gorda {nf1.format(pi.massa_gorda)} kg (peso {nf1.format(dados.peso)} kg).</p>}
          <div className="mt-4 grid gap-2 sm:grid-cols-3 text-[12.5px]" data-testid="donatto-classificacoes">
            {[
              ["% de gordura", classificarGordura(dados.sexo, dados.idade, pctAtual)],
              ["IMC (OMS)", (() => { const h = num(dados.altura) / 100; const imc = dados.peso && h ? dados.peso / (h * h) : null; return imc ? { nivel: classificarImc(imc), tabela: `IMC ${nf1.format(imc)}` } : null; })()],
              ["Cintura ÷ quadril", (() => { const r = classificarRcq(dados.sexo, dados.idade, ultima?.perimetria?.cintura, ultima?.perimetria?.quadril); return r ? { nivel: `Risco ${r.risco.toLowerCase()}`, tabela: `RCQ ${nf2.format(r.rcq)} · Bray & Gray` } : null; })()],
            ].map(([rot, c]) => (
              <div key={rot} className="rounded-lg bg-white/[0.03] px-3 py-2">
                <div className="text-[10.5px] uppercase tracking-[0.12em] text-gray-500">{rot}</div>
                <div className="font-semibold text-white">{c?.nivel || "—"}</div>
                <div className="text-[11px] text-gray-500">{c?.tabela || "sem medida"}</div>
              </div>
            ))}
          </div>
        </Cartao>
        <Cartao numero="3" titulo="Equações de gasto">
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div>
              <span className="text-[11px] uppercase tracking-[0.12em] text-gray-500">Fator de atividade</span>
              <div className="mt-1.5 flex gap-1.5">{[1.2, 1.3, 1.4].map((v) => <Chip key={v} ativo={num(fa) === v} onClick={() => setFa(v)}>{txt(v)}</Chip>)}</div>
            </div>
            <Campo rotulo="Gasto do exercício" valor={exercicio} onChange={setExercicio} unidade="kcal" largura="w-36" />
          </div>
          <div className="space-y-2">
            {eqs.map((e) => (
              <button key={e.id} type="button" onClick={() => setEquacao(e.id)} aria-pressed={eq?.id === e.id}
                className={`w-full flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-left ring-1 ${eq?.id === e.id ? "bg-rc-blue/15 ring-rc-blue" : "bg-white/[0.03] ring-white/[0.06] hover:ring-white/20"}`}>
                <span><span className="block text-[13.5px] font-semibold text-white">{e.nome}</span><span className="block text-[11.5px] text-gray-500">com {e.base} · FA {txt(fa)}{num(exercicio) ? ` + ${nf0.format(num(exercicio))} kcal de exercício` : ""}</span></span>
                <span className="text-right tabular"><span className="block rc-num text-[20px] text-white">{nf0.format(e.kcal)} kcal</span><span className="block text-[11.5px] text-gray-500">{nf1.format(e.kcal_kg)} kcal/kg</span></span>
              </button>
            ))}
            {!eqs.length && <p className="text-[13px] text-gray-500">Faltam peso, altura ou idade.</p>}
          </div>
        </Cartao>
      </div>
      <aside className="rc-card p-5 xl:sticky xl:top-20 space-y-3">
        <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500">Conta · Donatto</div>
        <Degrau rotulo={eq?.nome || "Equação"} valor={eq?.kcal} />
        <div>
          <span className="text-[11px] uppercase tracking-[0.12em] text-gray-500">Ajuste por prazo</span>
          <div className="mt-1.5 flex gap-1.5">{[[0, "Sem"], [60, "60 dias"], [90, "90 dias"]].map(([v, l]) => <Chip key={v} ativo={prazo === v} onClick={() => setPrazo(v)}>{l}</Chip>)}</div>
          {prazo > 0 && <p className="mt-1.5 text-[11.5px] text-gray-500">gordura em excesso {nf1.format(Math.max(0, pi?.excesso || 0))} kg × 7.700 ÷ {prazo} dias</p>}
        </div>
        {prazo > 0 && <Degrau sinal="−" rotulo="Restrição" valor={restricao} />}
        <Degrau forte rotulo="META FINAL" valor={final} testId="donatto-meta" />
        {final != null && <p className="text-[12px] text-gray-500 tabular">{nf1.format(final / num(dados.peso))} kcal/kg do peso atual</p>}
        <button type="button" disabled={salvando || final == null} onClick={() => salvar(false)} className="rc-btn-secondary w-full"><Save className="h-4 w-4" /> Salvar meta</button>
        <button type="button" disabled={salvando || final == null} onClick={() => salvar(true)} className="rc-btn-primary w-full" data-testid="usar-na-previsao"><PieChart className="h-4 w-4" /> Usar na Previsão de Macros</button>
      </aside>
    </div>
  );
}

// ── Tela ───────────────────────────────────────────────────────────────────
export default function GastoEnergetico({ d, reload, onIrMacros }) {
  const patient = d.patient;
  const modelo = useModeloAvaliacao(patient);
  const m = patient.meta_energetica || {};
  const avaliacoes = useMemo(() => numerarAvaliacoes(d.evaluations || []), [d.evaluations]);
  const ultima = avaliacoes[avaliacoes.length - 1] || null;
  const comp = ultima?.composicao || {};
  const origemAval = ultima ? `aval. ${formatarData(ultima.data_avaliacao || ultima.created_at).slice(0, 5)}` : null;

  // dados puxados da última Antropometria (um só peso), editáveis só nesta tela
  const [dados, setDados] = useState(() => ({
    peso: txt(ultima?.peso ?? patient.peso ?? ""),
    altura: txt(ultima?.altura ?? patient.altura ?? ""),
    idade: txt(idadeDe(patient.data_nascimento) ?? ultima?.idade ?? ""),
    sexo: patient.sexo === "M" ? "M" : patient.sexo === "F" ? "F" : "",
    mlg: txt(comp.massa_magra != null ? Math.round(comp.massa_magra * 10) / 10 : ""),
  }));
  const setDado = (k, v) => setDados((s) => ({ ...s, [k]: v }));
  const peso = num(dados.peso);

  const temMlg = num(dados.mlg) > 0;
  const [protocolo, setProtocolo] = useState(m.protocolo_tmb || (temMlg ? "cunningham" : "mifflin_st_jeor"));
  const [tmbs, setTmbs] = useState([]);
  const [modo, setModo] = useState(m.modo_atividade === "mets" ? "mets" : "fator");
  const [fator, setFator] = useState(txt(m.fator_atividade ?? 1.55));
  const [nafTabela, setNafTabela] = useState([]);
  const [fatorDiario, setFatorDiario] = useState(m.fator_diario ?? 1.4);
  const doForm = treinoDoFormulario(d.anamnese_v2);
  const [treinos, setTreinos] = useState(() => (m.treinos?.length ? m.treinos : [{ nome: "Musculação", met: "5", min: txt(doForm.min ?? 60), dias: txt(doForm.dias ?? 4) }]));
  const [contextoAberto, setContextoAberto] = useState(Boolean(m.fi_codigo && m.fi_codigo !== 1));
  const [fiOpts, setFiOpts] = useState([]);
  const [fiCodigo, setFiCodigo] = useState(m.fi_codigo || 1);
  const [operacao, setOperacao] = useState(m.operacao || "diminuir");
  // metas antigas guardavam só ajuste_kcal (em kcal)
  const [ajusteTipo, setAjusteTipo] = useState(m.ajuste_tipo || (m.ajuste_kcal ? "kcal" : "pct"));
  const [ajusteValor, setAjusteValor] = useState(txt(m.ajuste_valor ?? m.ajuste_kcal ?? 0));
  const [arredondar, setArredondar] = useState(m.arredondamento || "nenhum");
  const [multiplo, setMultiplo] = useState(Number(m.multiplo) || 10);
  const [finalManual, setFinalManual] = useState(Boolean(m.final_manual));
  const [finalTexto, setFinalTexto] = useState(txt(m.kcal_final ?? ""));
  const [pesoDesejado, setPesoDesejado] = useState(txt(m.peso_desejado ?? ""));
  const [semanas, setSemanas] = useState(txt(m.prazo_semanas ?? 12));
  const [salvando, setSalvando] = useState(false);
  const [historico, setHistorico] = useState(false);

  // atalho pré-selecionado pelo objetivo da ficha quando nada foi salvo
  useEffect(() => {
    if (m.operacao || m.ajuste_tipo) return;
    const a = ATALHOS.find(([k]) => k === atalhoDoObjetivo(patient.objetivo));
    if (a) { setOperacao(a[2]); setAjusteTipo("pct"); setAjusteValor(String(a[3])); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sexoNum = dados.sexo === "M" ? 1 : 2;
  useEffect(() => {
    if (!peso || !num(dados.altura) || num(dados.idade) == null || !dados.sexo) { setTmbs([]); return undefined; }
    const t = setTimeout(() => {
      api.post("/calculos/tmb-todas", { peso, altura_cm: num(dados.altura), idade: Math.round(num(dados.idade)), sexo_num: sexoNum, mlg_kg: temMlg ? num(dados.mlg) : null })
        .then((r) => setTmbs(r.data || [])).catch(() => setTmbs([]));
    }, 250);
    return () => clearTimeout(t);
  }, [peso, dados.altura, dados.idade, dados.sexo, dados.mlg, sexoNum, temMlg]);

  useEffect(() => {
    api.get("/referencias/fatores-injuria").then((r) => setFiOpts(r.data || [])).catch(() => {});
  }, []);
  useEffect(() => {
    api.get(`/referencias/naf?protocolo=${protocolo}&sexo=${sexoNum}`).then((r) => setNafTabela(r.data || [])).catch(() => {});
  }, [protocolo, sexoNum]);

  // ── conta em cascata ──
  const tmbSel = tmbs.find((t) => t.protocolo === protocolo);
  const tmb = tmbSel?.tmb ?? null;
  const fi = num(fiOpts.find((o) => o.codigo === Number(fiCodigo))?.fator) || 1;
  const treinoDia = modo === "mets" && peso ? treinos.reduce((a, t) => a + (num(t.met) || 0) * peso * ((num(t.min) || 0) / 60), 0) : 0;
  const treinoMedio = modo === "mets" && peso ? treinos.reduce((a, t) => a + (num(t.met) || 0) * peso * ((num(t.min) || 0) / 60) * ((num(t.dias) || 0) / 7), 0) : 0;
  const baseAtividade = tmb == null ? null : modo === "fator" ? tmb * (num(fator) || 1) : tmb * (num(fatorDiario) || 1);
  const atividade = baseAtividade == null ? null : baseAtividade - tmb;
  const getSemFi = baseAtividade == null ? null : baseAtividade + (modo === "mets" ? treinoMedio : 0);
  const injuria = getSemFi == null ? null : getSemFi * fi - getSemFi;
  const get = getSemFi == null ? null : getSemFi * fi;
  const getDescanso = modo === "mets" && baseAtividade != null ? baseAtividade * fi : null;
  const getTreino = modo === "mets" && baseAtividade != null ? (baseAtividade + treinoDia) * fi : null;
  const ajusteKcal = get == null ? 0 : ajusteTipo === "pct" ? (get * (num(ajusteValor) || 0)) / 100 : num(ajusteValor) || 0;
  const aposAjuste = get == null ? null : operacao === "aumentar" ? get + ajusteKcal : get - ajusteKcal;
  const arredondado = aposAjuste == null ? null
    : arredondar === "cima" ? Math.ceil(aposAjuste / multiplo) * multiplo
      : arredondar === "baixo" ? Math.floor(aposAjuste / multiplo) * multiplo
        : Math.round(aposAjuste / multiplo) * multiplo;
  const metaFinal = finalManual ? num(finalTexto) : arredondado;
  const sugerida = temMlg ? SUGESTAO_MLG : [];
  const atalhoAtivo = ATALHOS.find(([, , op, v]) => ajusteTipo === "pct" && num(ajusteValor) === v && (v === 0 || operacao === op))?.[0];

  const salvarMeta = async (extra) => {
    setSalvando(true);
    try {
      await api.patch(`/patients/${patient.id}`, { meta_energetica: { ...m, ...extra, atualizado_em: new Date().toISOString() } });
      toast.success(`Meta salva: ${nf0.format(extra.kcal_final)} kcal/dia.`);
      await reload?.();
      return true;
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
      return false;
    } finally { setSalvando(false); }
  };
  const salvarRc = async (irMacros) => {
    if (metaFinal == null) { toast.error("Complete os dados para calcular a meta."); return; }
    const ok = await salvarMeta({
      modelo: "rc", kcal_final: Math.round(metaFinal * 100) / 100, get_base: get != null ? Math.round(get * 10) / 10 : null, tmb, protocolo_tmb: protocolo,
      modo_atividade: modo,
      // a opção não escolhida não fica guardada
      fator_atividade: modo === "fator" ? num(fator) : null,
      fator_diario: modo === "mets" ? num(fatorDiario) : null,
      treinos: modo === "mets" ? treinos : [],
      get_descanso: getDescanso, get_treino: getTreino,
      fi_codigo: Number(fiCodigo) || 1, fi,
      operacao, ajuste_tipo: ajusteTipo, ajuste_valor: num(ajusteValor) || 0, ajuste_kcal: Math.round(ajusteKcal),
      arredondamento: arredondar, multiplo, final_manual: finalManual,
      peso_desejado: num(pesoDesejado), prazo_semanas: num(semanas),
    });
    if (ok && irMacros) onIrMacros?.();
  };

  const cabecalho = (
    <div className="rc-card px-5 py-4 space-y-4">
      <ModeloAvaliacao patient={patient} reload={reload} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="dados-gasto">
        <Campo rotulo="Peso" valor={dados.peso} onChange={(v) => setDado("peso", v)} unidade="kg" origem={ultima?.peso != null ? origemAval : "cadastro"} testId="gasto-peso" />
        <Campo rotulo="Altura" valor={dados.altura} onChange={(v) => setDado("altura", v)} unidade="cm" origem={ultima?.altura != null ? origemAval : "cadastro"} />
        <Campo rotulo="Idade" valor={dados.idade} onChange={(v) => setDado("idade", v)} unidade="anos" origem="cadastro" />
        <label className="block">
          <span className="flex items-center text-[11px] uppercase tracking-[0.12em] text-gray-500">Sexo<Origem>cadastro</Origem></span>
          <select className="rc-input h-10 mt-1.5" value={dados.sexo} onChange={(e) => setDado("sexo", e.target.value)} aria-label="Sexo">
            <option value="" disabled>Selecione</option><option value="M">Masculino</option><option value="F">Feminino</option>
          </select>
        </label>
        <Campo rotulo="Massa magra" valor={dados.mlg} onChange={(v) => setDado("mlg", v)} unidade="kg" origem={comp.massa_magra != null ? origemAval : "sem avaliação"} />
      </div>
    </div>
  );

  if (modelo === "donatto") {
    return (
      <div className="space-y-4" data-testid="energy-workspace">
        {cabecalho}
        <GastoDonatto patient={patient} ultima={ultima} dados={{ ...dados, peso, idade: num(dados.idade) }} salvarMeta={salvarMeta} salvando={salvando} onIrMacros={onIrMacros} />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="energy-workspace">
      {cabecalho}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_350px] items-start">
        <div className="space-y-4 min-w-0">
          <Cartao numero="1" titulo="Taxa metabólica basal">
            {!tmbs.length ? <p className="text-[13px] text-gray-500">Preencha peso, altura, idade e sexo.</p> : (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" role="radiogroup" aria-label="Equação de TMB">
                {tmbs.map((t) => (
                  <button key={t.protocolo} type="button" role="radio" aria-checked={protocolo === t.protocolo} disabled={t.tmb == null}
                    onClick={() => setProtocolo(t.protocolo)} data-testid={`tmb-${t.protocolo}`}
                    className={`relative rounded-xl px-3.5 py-3 text-left ring-1 transition-colors disabled:opacity-40 ${protocolo === t.protocolo ? "bg-rc-blue/15 ring-rc-blue" : "bg-white/[0.03] ring-white/[0.06] hover:ring-white/20"}`}>
                    {sugerida.includes(t.protocolo) && <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-rc-lime/15 px-1.5 text-[10px] font-semibold text-rc-lime"><Sparkles className="h-3 w-3" />sugerida</span>}
                    <div className="pr-14 text-[12px] font-medium text-gray-300 leading-tight">{t.nome}</div>
                    <div className="mt-1 rc-num text-[20px] text-white">{t.tmb != null ? nf0.format(t.tmb) : "—"}</div>
                    <div className="text-[10.5px] text-gray-500">{t.tmb != null ? "kcal/dia" : "precisa da massa magra"}</div>
                  </button>
                ))}
              </div>
            )}
            {temMlg && !SUGESTAO_MLG.includes(protocolo) && <p className="mt-3 text-[12px] text-gray-500">Com massa magra medida, Cunningham ou Tinsley (MLG) costumam estimar melhor em quem treina.</p>}
          </Cartao>

          <Cartao numero="2" titulo="Atividade" direita={(
            <div role="radiogroup" aria-label="Forma de calcular a atividade" className="inline-flex rounded-lg bg-white/[0.04] p-0.5 ring-1 ring-white/[0.06]">
              {[["fator", "Fator de atividade"], ["mets", "METs"]].map(([k, l]) => (
                <button key={k} type="button" role="radio" aria-checked={modo === k} onClick={() => setModo(k)} data-testid={`modo-${k}`}
                  className={`h-8 px-3.5 rounded-md text-[12.5px] font-semibold ${modo === k ? "bg-rc-blue text-white" : "text-gray-400 hover:text-white"}`}>{l}</button>
              ))}
            </div>
          )}>
            {modo === "fator" ? (
              <div data-testid="bloco-fator">
                <p className="mb-3 text-[12.5px] text-gray-500">TMB × fator. O treino já está incluído no fator: um valor só.</p>
                <div className="flex flex-wrap items-end gap-2">
                  {FATORES_RAPIDOS.map((v) => <Chip key={v} ativo={num(fator) === v} onClick={() => setFator(txt(v))} testId={`fator-${v}`}>{txt(v)}</Chip>)}
                  <Campo rotulo="Manual" valor={fator} onChange={setFator} largura="w-24" testId="fator-manual" />
                  {nafTabela.length > 0 && (
                    <label className="block">
                      <span className="text-[11px] uppercase tracking-[0.12em] text-gray-500">Tabela</span>
                      <select className="rc-input h-10 mt-1.5 max-w-[320px]" value="" onChange={(e) => e.target.value && setFator(txt(e.target.value))} aria-label="Fator pela tabela">
                        <option value="">Escolher pela tabela…</option>
                        {nafTabela.map((o) => <option key={o.codigo} value={o.naf}>{o.descricao} · {txt(o.naf)}</option>)}
                      </select>
                    </label>
                  )}
                </div>
              </div>
            ) : (
              <div data-testid="bloco-mets">
                <p className="mb-3 text-[12.5px] text-gray-500">Fator só do dia a dia + treino por MET (dias e duração do formulário). Gera a meta do dia de treino e do dia de descanso.</p>
                <span className="text-[11px] uppercase tracking-[0.12em] text-gray-500">Fator do dia a dia</span>
                <div className="mt-1.5 mb-4 flex flex-wrap gap-1.5">{FATORES_DIARIOS.map((v) => <Chip key={v} ativo={num(fatorDiario) === v} onClick={() => setFatorDiario(v)}>{txt(v)}</Chip>)}</div>
                <div className="space-y-2">
                  {treinos.map((t, i) => (
                    <div key={i} className="grid grid-cols-[minmax(0,1fr)_80px_90px_80px_36px] items-end gap-2">
                      <label className="block"><span className="text-[11px] uppercase tracking-[0.12em] text-gray-500">Treino</span><input className="rc-input h-10 mt-1.5" value={t.nome} onChange={(e) => setTreinos((l) => l.map((x, k) => (k === i ? { ...x, nome: e.target.value } : x)))} aria-label="Nome do treino" /></label>
                      <Campo rotulo="MET" valor={t.met} onChange={(v) => setTreinos((l) => l.map((x, k) => (k === i ? { ...x, met: v } : x)))} />
                      <Campo rotulo="Minutos" valor={t.min} onChange={(v) => setTreinos((l) => l.map((x, k) => (k === i ? { ...x, min: v } : x)))} />
                      <Campo rotulo="Dias/sem" valor={t.dias} onChange={(v) => setTreinos((l) => l.map((x, k) => (k === i ? { ...x, dias: v } : x)))} />
                      <button type="button" onClick={() => setTreinos((l) => (l.length > 1 ? l.filter((_, k) => k !== i) : l))} className="h-10 rounded-lg text-gray-500 hover:text-white" aria-label="Remover treino"><X className="mx-auto h-4 w-4" /></button>
                    </div>
                  ))}
                  <div className="flex flex-wrap items-center gap-3">
                    <button type="button" onClick={() => setTreinos((l) => [...l, { nome: "", met: "", min: "", dias: "" }])} className="rc-btn-ghost -ml-2 text-rc-lime"><Plus className="h-4 w-4" /> Adicionar treino</button>
                    {(doForm.min || doForm.dias) && !m.treinos?.length && <span className="text-[11.5px] text-gray-500">Duração e dias vieram do formulário do paciente.</span>}
                  </div>
                </div>
              </div>
            )}
            <div className="mt-5 border-t border-white/[0.06] pt-4">
              <button type="button" onClick={() => setContextoAberto((v) => !v)} className="flex items-center gap-2 text-[13px] text-gray-300 hover:text-white" aria-expanded={contextoAberto}>
                <ChevronDown className={`h-4 w-4 transition-transform ${contextoAberto ? "rotate-180" : ""}`} /> Contexto clínico
                <span className="text-gray-500">· fator de injúria ×{txt(fi)}</span>
              </button>
              {contextoAberto && (
                <label className="mt-3 block max-w-[420px]">
                  <span className="text-[11px] uppercase tracking-[0.12em] text-gray-500">Fator de injúria</span>
                  <select className="rc-input h-10 mt-1.5" value={fiCodigo} onChange={(e) => setFiCodigo(Number(e.target.value))} aria-label="Fator de injúria" data-testid="fator-injuria">
                    {fiOpts.map((o) => <option key={o.codigo} value={o.codigo}>{o.descricao} · ×{txt(o.fator)}</option>)}
                  </select>
                </label>
              )}
            </div>
          </Cartao>

          <Cartao numero="3" titulo="Projeção da meta de peso (VENTA)">
            <div className="mb-4 flex flex-wrap gap-3">
              <Campo rotulo="Peso desejado" valor={pesoDesejado} onChange={setPesoDesejado} unidade="kg" largura="w-36" testId="peso-desejado" />
              <Campo rotulo="Prazo" valor={semanas} onChange={setSemanas} unidade="sem" largura="w-32" testId="prazo-semanas" />
            </div>
            <Projecao peso={peso} pesoDesejado={pesoDesejado} semanas={semanas} get={get} meta={metaFinal} />
          </Cartao>

          <section className="rc-card">
            <button type="button" onClick={() => setHistorico((v) => !v)} className="flex w-full items-center gap-2 px-5 py-4 text-[13px] text-gray-300 hover:text-white" aria-expanded={historico}>
              <ChevronDown className={`h-4 w-4 transition-transform ${historico ? "rotate-180" : ""}`} /> Histórico das avaliações ({avaliacoes.length})
            </button>
            {historico && (
              <div className="overflow-x-auto px-5 pb-5">
                <table className="w-full text-[13px] tabular">
                  <thead><tr className="text-[10.5px] uppercase tracking-[0.12em] text-gray-500"><th className="text-left font-medium pb-2">Avaliação</th><th className="text-right font-medium pb-2">Peso</th><th className="text-right font-medium pb-2">Massa magra</th><th className="text-right font-medium pb-2">TMB</th><th className="text-right font-medium pb-2">GET</th></tr></thead>
                  <tbody>
                    {[...avaliacoes].reverse().map((a) => (
                      <tr key={a.id} className="border-t border-white/[0.05]">
                        <td className="py-2 text-gray-300">{a._numero}ª · {formatarData(a.data_avaliacao || a.created_at)}{a.modelo_avaliacao && <Origem>{a.modelo_avaliacao === "donatto" ? "Donatto" : "RC"}</Origem>}</td>
                        <td className="py-2 text-right text-gray-200">{a.peso != null ? `${nf1.format(a.peso)} kg` : "—"}</td>
                        <td className="py-2 text-right text-gray-200">{a.composicao?.massa_magra != null ? `${nf1.format(a.composicao.massa_magra)} kg` : "—"}</td>
                        <td className="py-2 text-right text-gray-200">{a.composicao?.tmb != null ? nf0.format(a.composicao.tmb) : "—"}</td>
                        <td className="py-2 text-right text-gray-200">{a.composicao?.get_kcal != null ? nf0.format(a.composicao.get_kcal) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        {/* conta em cascata */}
        <aside className="rc-card p-5 xl:sticky xl:top-20" data-testid="cascata">
          <div className="text-[11px] uppercase tracking-[0.16em] text-gray-500 mb-1">Conta</div>
          <Degrau rotulo="TMB" detalhe={tmbSel?.nome} valor={tmb} testId="cascata-tmb" />
          <Degrau sinal="+" rotulo={modo === "fator" ? `Atividade (×${txt(num(fator) || 1)})` : `Dia a dia (×${txt(fatorDiario)})`} valor={atividade} />
          {modo === "mets" && <Degrau sinal="+" rotulo="Treino (média da semana)" detalhe={`dia de treino +${nf0.format(treinoDia)} kcal`} valor={treinoMedio} />}
          {fi !== 1 && <Degrau sinal="+" rotulo={`Injúria (×${txt(fi)})`} valor={injuria} />}
          <Degrau forte rotulo="GET" valor={get} testId="cascata-get" />
          {modo === "mets" && getDescanso != null && (
            <p className="text-[11.5px] text-gray-500 tabular -mt-1 mb-2">dia de treino {nf0.format(getTreino)} · descanso {nf0.format(getDescanso)} kcal</p>
          )}

          <div className="mt-3 space-y-3 border-t border-white/[0.06] pt-3">
            <div className="flex flex-wrap gap-1.5">
              {ATALHOS.map(([k, l, op, v]) => (
                <Chip key={k} ativo={atalhoAtivo === k} onClick={() => { setOperacao(op); setAjusteTipo("pct"); setAjusteValor(String(v)); setFinalManual(false); }} testId={`atalho-${k}`}
                  title={atalhoDoObjetivo(patient.objetivo) === k ? "Sugerido pelo objetivo da ficha" : undefined}>
                  {l}{v ? ` ${op === "aumentar" ? "+" : "−"}${v}%` : ""}{atalhoDoObjetivo(patient.objetivo) === k ? " ★" : ""}
                </Chip>
              ))}
            </div>
            <div className="grid grid-cols-[110px_minmax(0,1fr)_70px] gap-2 items-end">
              <select className="rc-input h-10" value={operacao} onChange={(e) => { setOperacao(e.target.value); setFinalManual(false); }} aria-label="Aumentar ou diminuir">
                <option value="diminuir">Diminuir</option><option value="aumentar">Aumentar</option>
              </select>
              <input className="rc-input h-10 tabular" inputMode="decimal" value={ajusteValor} onChange={(e) => { setAjusteValor(e.target.value); setFinalManual(false); }} aria-label="Valor do ajuste" data-testid="ajuste-valor" />
              <select className="rc-input h-10" value={ajusteTipo} onChange={(e) => { setAjusteTipo(e.target.value); setFinalManual(false); }} aria-label="Ajuste em % ou kcal">
                <option value="pct">%</option><option value="kcal">kcal</option>
              </select>
            </div>
            <Degrau sinal={operacao === "aumentar" ? "+" : "−"} rotulo="Ajuste" valor={ajusteKcal} />
            <div>
              <div className="flex items-center justify-between gap-2">
                <select className="rc-input h-9 w-[150px] text-[12.5px]" value={arredondar} onChange={(e) => { setArredondar(e.target.value); setFinalManual(false); }} aria-label="Arredondamento">
                  <option value="nenhum">Arredondar</option><option value="cima">Para cima</option><option value="baixo">Para baixo</option>
                </select>
                <div className="flex gap-1">{MULTIPLOS.map((v) => (
                  <button key={v} type="button" onClick={() => { setMultiplo(v); setFinalManual(false); }} aria-pressed={multiplo === v}
                    className={`h-8 min-w-[36px] rounded-md px-1.5 text-[12px] font-semibold tabular ${multiplo === v ? "bg-white/[0.14] text-white" : "text-gray-500 hover:text-white"}`}>{v}</button>
                ))}</div>
              </div>
              <Degrau rotulo="Total calculado" valor={arredondado} testId="cascata-total" />
            </div>
          </div>

          <div className="mt-2 rounded-xl bg-rc-lime/[0.07] p-4 ring-1 ring-rc-lime/25">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-rc-lime">Meta final</span>
              {finalManual && <button type="button" onClick={() => setFinalManual(false)} className="text-[11.5px] text-gray-400 hover:text-white">voltar ao calculado</button>}
            </div>
            <div className="relative mt-2">
              <input inputMode="decimal" aria-label="Meta final em kcal por dia" className="rc-input h-12 pr-16 rc-num text-[24px]" data-testid="meta-final"
                value={finalManual ? finalTexto : txt(arredondado ?? "")} onChange={(e) => { setFinalManual(true); setFinalTexto(e.target.value); }} />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-gray-500">kcal/dia</span>
            </div>
            <p className="mt-1.5 text-[11.5px] text-gray-500">{finalManual ? "Definido por você." : "Segue o total calculado. Digite para definir outro valor."}{peso && metaFinal ? ` · ${nf1.format(metaFinal / peso)} kcal/kg` : ""}</p>
            <button type="button" onClick={() => salvarRc(false)} disabled={salvando || metaFinal == null} className="rc-btn-secondary mt-3 w-full" data-testid="salvar-meta"><Save className="h-4 w-4" /> Salvar meta</button>
            <button type="button" onClick={() => salvarRc(true)} disabled={salvando || metaFinal == null} className="rc-btn-primary mt-2 w-full" data-testid="usar-na-previsao"><PieChart className="h-4 w-4" /> Usar na Previsão de Macros</button>
          </div>
        </aside>
      </div>
    </div>
  );
}
