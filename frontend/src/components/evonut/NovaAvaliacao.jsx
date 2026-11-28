import React, { useEffect, useMemo, useRef, useState } from "react";
import { Camera, ChevronDown, Loader2, Plus, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/evo-api";
import { PROTOCOLOS_DOBRAS, avisoIdade, dobrasDoProtocolo, perimetrosDoProtocolo } from "./protocolosDobras";
import { COR_NOME_PROTOCOLO } from "./dobrasCores";
import useDietaConfig from "./dieta/useDietaConfig";
import { classificarGordura, fracionar, protocolosDonatto } from "@/lib/donatto";

/**
 * Nova avaliação numa tela só (item 15 dos ajustes): peso e altura → perímetros (direito e esquerdo na mesma
 * linha) → dobras do protocolo → fotos, com o resultado ao vivo fixo à direita e a diferença para a última
 * avaliação ao lado de cada medida (cor pelo objetivo do paciente).
 */
export const PARES = [
  ["braco_relaxado", "Braço relaxado", true], ["braco_contraido", "Braço contraído", true], ["antebraco", "Antebraço", true],
  ["punho", "Punho", true], ["pescoco", "Pescoço", false], ["ombro", "Ombro", false], ["torax", "Tórax", false],
  ["cintura", "Cintura", false], ["abdomen", "Abdômen", false], ["quadril", "Quadril", false], ["coxa", "Coxa", true],
  ["coxa_proximal", "Coxa proximal", true], ["panturrilha", "Panturrilha", true],
];
export const DOBRAS = [
  ["peitoral", "Peitoral"], ["axilar", "Axilar média"], ["tricipital", "Tricipital"], ["subescapular", "Subescapular"],
  ["abdominal", "Abdominal"], ["suprailiaca", "Suprailíaca"], ["coxa", "Coxa"], ["bicipital", "Bicipital"], ["panturrilha", "Panturrilha"],
];
const POSES = [["frente", "Frente"], ["lado", "Lado"], ["costas", "Costas"]];
const MUSCULARES = new Set(["braco_relaxado", "braco_contraido", "antebraco", "coxa", "coxa_proximal", "panturrilha", "torax", "ombro"]);
const CENTRAIS = new Set(["cintura", "abdomen", "quadril"]);
const nf1 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
export const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(String(v).replace(",", "."));
  return Number.isFinite(x) ? x : null;
};
const txt = (v) => (v === null || v === undefined ? "" : String(v).replace(".", ","));
const VERDE = "#3DDC84"; const VERMELHO = "#F87171"; const LARANJA = "#FFA53B"; const CINZA = "#8A97A6";

export const ehHipertrofia = (objetivo) => /hipertrof|ganho|massa|bulking/i.test(objetivo || "");
export const ehEmagrecimento = (objetivo) => /emagre|perda|defini|gordura|secar/i.test(objetivo || "");

/** Cor da diferença para a avaliação anterior conforme o objetivo (hipertrofia: braço subir = verde; cintura descer = verde). */
export function corDelta(chave, delta, objetivo, tipo = "perimetro") {
  if (delta == null || Math.abs(delta) < 0.05) return CINZA;
  const sobe = delta > 0;
  if (tipo === "dobra" || chave === "pct_gordura" || chave === "massa_gorda" || chave === "soma_dobras") return sobe ? VERMELHO : VERDE;
  if (chave === "massa_magra") return sobe ? VERDE : LARANJA;
  if (chave === "peso") {
    if (ehHipertrofia(objetivo)) return sobe ? VERDE : LARANJA;
    if (ehEmagrecimento(objetivo)) return sobe ? VERMELHO : VERDE;
    return CINZA;
  }
  if (chave === "rcq" || chave === "rce") return sobe ? VERMELHO : VERDE;
  const base = chave.replace(/_(d|e)$/, "");
  if (CENTRAIS.has(base)) return sobe ? VERMELHO : VERDE;
  if (MUSCULARES.has(base)) return sobe ? VERDE : ehHipertrofia(objetivo) ? VERMELHO : LARANJA;
  return CINZA;
}

function Delta({ valor, anterior, chave, objetivo, tipo, unidade = "", casas = 1, testId }) {
  const v = num(valor); const a = num(anterior);
  if (v == null || a == null) return <span className="w-full max-w-16 text-right text-[11.5px] text-gray-600 tabular">{a == null ? "" : "—"}</span>;
  const d = v - a;
  const f = casas === 2 ? nf2 : nf1;
  return (
    <span className="w-full max-w-16 text-right text-[11px] font-semibold tabular sm:text-[12px]" style={{ color: corDelta(chave, d, objetivo, tipo) }} data-testid={testId} title={`Anterior: ${f.format(a)}${unidade}`}>
      {Math.abs(d) < 0.05 ? "=" : `${d > 0 ? "+" : "−"}${f.format(Math.abs(d))}`}
    </span>
  );
}

function Entrada({ valor, onChange, rotulo, testId, largura = "w-full max-w-[74px]" }) {
  return (
    <input inputMode="decimal" aria-label={rotulo} data-testid={testId} value={txt(valor)} onChange={(e) => onChange(e.target.value)}
      className={`${largura} h-9 rounded-md bg-rc-surfaceAlt px-2 text-center tabular text-gray-50 outline-none shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] focus:shadow-[inset_0_0_0_1px_#0081FD,0_0_0_3px_rgba(0,129,253,0.22)]`} />
  );
}

function Bloco({ numero, titulo, direita, children }) {
  return (
    <section className="rc-card p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-rc-blue/15 text-[12px] font-bold text-rc-blueLight">{numero}</span>
        <h3 className="font-display font-bold uppercase text-[16px] text-white" style={{ fontStretch: "86%" }}>{titulo}</h3>
        {direita && <div className="ml-auto flex flex-wrap items-center gap-2">{direita}</div>}
      </div>
      {children}
    </section>
  );
}

/** Reduz a foto para ~1280 px (JPEG) antes de enviar. */
async function comprimir(file, max = 1280) {
  const url = await new Promise((ok, erro) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = erro; r.readAsDataURL(file); });
  const img = await new Promise((ok, erro) => { const i = new Image(); i.onload = () => ok(i); i.onerror = erro; i.src = url; });
  const f = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * f); c.height = Math.round(img.height * f);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.82);
}

function Fotos({ pid, avaliacaoId, pendentes, setPendentes, avaliacoes, fotos, recarregarFotos }) {
  const [comparar, setComparar] = useState("");
  const inputs = useRef({});
  const daAval = (eid) => Object.fromEntries((fotos || []).filter((f) => f.avaliacao_id === eid).map((f) => [f.pose, f]));
  const atuais = { ...(avaliacaoId ? daAval(avaliacaoId) : {}), ...Object.fromEntries(Object.entries(pendentes).map(([k, v]) => [k, { data_url: v, pendente: true }])) };
  const outras = avaliacoes.filter((a) => a.id !== avaliacaoId && (fotos || []).some((f) => f.avaliacao_id === a.id));
  const deOutra = comparar ? daAval(comparar) : null;
  const escolher = async (pose, file) => {
    if (!file) return;
    try {
      const dataUrl = await comprimir(file);
      if (avaliacaoId) {
        await api.put(`/patients/${pid}/evaluations/${avaliacaoId}/fotos`, { pose, data_url: dataUrl });
        recarregarFotos();
        toast.success("Foto salva.");
      } else {
        setPendentes((s) => ({ ...s, [pose]: dataUrl }));
      }
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Não foi possível ler a imagem."); }
  };
  const remover = async (pose) => {
    if (atuais[pose]?.pendente) { setPendentes((s) => { const n = { ...s }; delete n[pose]; return n; }); return; }
    if (!window.confirm("Remover esta foto?")) return;
    await api.delete(`/patients/${pid}/evaluations/${avaliacaoId}/fotos/${pose}`).catch(() => {});
    recarregarFotos();
  };
  return (
    <div>
      {outras.length > 0 && (
        <label className="mb-3 flex items-center gap-2 text-[12.5px] text-gray-400">
          Comparar com
          <select className="rc-input h-9 w-auto" value={comparar} onChange={(e) => setComparar(e.target.value)} aria-label="Comparar fotos com outra avaliação">
            <option value="">—</option>
            {outras.map((a) => <option key={a.id} value={a.id}>{a._numero}ª · {new Date(`${String(a.data_avaliacao || a.created_at).slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR")}</option>)}
          </select>
        </label>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        {POSES.map(([pose, rotulo]) => (
          <div key={pose} className="space-y-2">
            <div className="text-[11px] uppercase tracking-[0.12em] text-gray-500">{rotulo}</div>
            <div className={`grid gap-2 ${deOutra ? "grid-cols-2" : ""}`}>
              {deOutra && (
                <div className="aspect-[3/4] overflow-hidden rounded-xl bg-white/[0.03] ring-1 ring-white/[0.06]">
                  {deOutra[pose] ? <img src={deOutra[pose].data_url} alt={`${rotulo} na avaliação comparada`} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-[11px] text-gray-600">sem foto</div>}
                </div>
              )}
              <div className="relative aspect-[3/4] overflow-hidden rounded-xl bg-white/[0.03] ring-1 ring-white/[0.06]">
                {atuais[pose] ? (
                  <>
                    <img src={atuais[pose].data_url} alt={`${rotulo} desta avaliação`} className="h-full w-full object-cover" />
                    <button type="button" onClick={() => remover(pose)} className="absolute right-2 top-2 rounded-md bg-black/60 p-1.5 text-white" aria-label={`Remover foto de ${rotulo.toLowerCase()}`}><Trash2 className="h-3.5 w-3.5" /></button>
                    {atuais[pose].pendente && <span className="absolute bottom-2 left-2 rounded bg-black/60 px-1.5 text-[10.5px] text-rc-amber">envia ao salvar</span>}
                  </>
                ) : (
                  <button type="button" onClick={() => inputs.current[pose]?.click()} className="flex h-full w-full flex-col items-center justify-center gap-2 text-[12px] text-gray-400 hover:text-white">
                    <Camera className="h-6 w-6" /> Adicionar foto
                  </button>
                )}
                <input ref={(el) => { inputs.current[pose] = el; }} type="file" accept="image/*" className="hidden" aria-label={`Foto de ${rotulo.toLowerCase()}`} data-testid={`foto-${pose}`}
                  onChange={(e) => { escolher(pose, e.target.files?.[0]); e.target.value = ""; }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LinhaResultado({ rotulo, valor, anterior, unidade = "", chave, objetivo, casas = 1, testId, destaque }) {
  const f = casas === 2 ? nf2 : nf1;
  return (
    <div className="flex items-baseline justify-between gap-2 py-1.5">
      <span className={`text-[13px] ${destaque ? "font-semibold text-white" : "text-gray-400"}`}>{rotulo}</span>
      <span className="flex items-baseline gap-2">
        <span className={`tabular ${destaque ? "rc-num text-[22px] text-white" : "text-[14px] text-gray-100"}`} data-testid={testId}>{valor == null ? "—" : `${f.format(valor)}${unidade}`}</span>
        <Delta valor={valor} anterior={anterior} chave={chave} objetivo={objetivo} casas={casas} />
      </span>
    </div>
  );
}

export default function NovaAvaliacao({ d, form, setForm, editingId, anterior, avaliacoes, modelo, saving, onSalvar, onCancelar, fotos, recarregarFotos, pendentes, setPendentes }) {
  const patient = d.patient;
  const { config, salvar: salvarConfig } = useDietaConfig();
  const objetivo = patient.objetivo;
  const [todasMedidas, setTodasMedidas] = useState(false);
  const [todasDobras, setTodasDobras] = useState(modelo === "donatto");
  const [bioAberto, setBioAberto] = useState(Object.values(form.bioimpedancia || {}).some((v) => v !== "" && v != null));
  const [preview, setPreview] = useState(null);
  const [calculando, setCalculando] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setGrupo = (g, k, v) => setForm((f) => ({ ...f, [g]: { ...(f[g] || {}), [k]: v } }));
  const ant = anterior || null;
  const sexo = form.sexo === "M" ? "M" : "F";
  const mostraGestacao = sexo === "F" && (patient.gestante || form.gestante);

  // perímetros: os do padrão + os do protocolo + os que já têm valor
  const padrao = config.medidas_padrao || [];
  const protoPerim = perimetrosDoProtocolo(form.protocolo_dobras, form.sexo).map((k) => k.replace(/_(d|e)$/, ""));
  const temValor = (base, bilateral) => (bilateral ? [`${base}_d`, `${base}_e`] : [base]).some((k) => num(form.perimetria?.[k]) != null);
  const paresVisiveis = PARES.filter(([k, , bi]) => todasMedidas || padrao.includes(k) || protoPerim.includes(k) || temValor(k, bi));

  // dobras: só as do protocolo (RC) ou todas (Donatto)
  const exigidas = dobrasDoProtocolo(form.protocolo_dobras, form.sexo);
  const dobrasVisiveis = DOBRAS.filter(([k]) => todasDobras || exigidas.includes(k) || num(form.dobras?.[k]) != null);
  const aviso = modelo === "rc" ? avisoIdade(form.protocolo_dobras, form.sexo, form.idade) : "";

  // Donatto: protocolos lado a lado
  const donatto = useMemo(() => (modelo === "donatto" ? protocolosDonatto(sexo, num(form.idade), form.dobras) : []), [modelo, sexo, form.idade, form.dobras]);
  const protoDonatto = form.donatto?.protocolo || donatto.find((p) => p.id === "pollock7" && p.pct != null)?.id || donatto.find((p) => p.pct != null)?.id;
  const pctDonatto = donatto.find((p) => p.id === protoDonatto)?.pct ?? null;

  // resultado ao vivo (RC: mesma conta do backend; Donatto: planilha)
  const chavePreview = JSON.stringify([form.peso, form.altura, form.idade, form.sexo, form.protocolo_dobras, form.dobras, form.perimetria]);
  useEffect(() => {
    if (!num(form.peso) || !num(form.altura) || !num(form.idade)) { setPreview(null); return undefined; }
    const t = setTimeout(async () => {
      setCalculando(true);
      try {
        const { data } = await api.post("/calculos/composicao-preview", {
          peso: num(form.peso), altura: num(form.altura), idade: Math.round(num(form.idade)), sexo: form.sexo, sexo_num: form.sexo === "M" ? 1 : 2,
          protocolo_dobras: form.protocolo_dobras, dobras: limpar(form.dobras), perimetria: limpar(form.perimetria),
        });
        setPreview(data);
      } catch { setPreview(null); } finally { setCalculando(false); }
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chavePreview]);

  const peso = num(form.peso);
  const pct = modelo === "donatto" ? pctDonatto : preview?.pct_gordura ?? null;
  const frac = modelo === "donatto" ? fracionar(peso, pct) : { mg: preview?.massa_gorda ?? null, mm: preview?.massa_magra ?? null };
  const somaDobras = (fonte, chaves) => {
    const v = chaves.map((k) => num(fonte?.dobras?.[k]));
    return chaves.length && v.every((x) => x != null) ? v.reduce((a, b) => a + b, 0) : null;
  };
  const chavesSoma = modelo === "donatto" ? (donatto.find((p) => p.id === protoDonatto)?.dobras || []).map((k) => (k === "axilar_media" ? "axilar" : k)) : exigidas;
  const cintura = num(form.perimetria?.cintura); const quadril = num(form.perimetria?.quadril); const altura = num(form.altura);
  const antC = ant?.composicao || {};
  const antCintura = num(ant?.perimetria?.cintura); const antQuadril = num(ant?.perimetria?.quadril);
  const classif = classificarGordura(sexo, num(form.idade), pct);

  const salvarPadrao = async () => {
    const lista = PARES.filter(([k, , bi]) => padrao.includes(k) || temValor(k, bi)).map(([k]) => k);
    try { await salvarConfig({ medidas_padrao: lista }); toast.success("Medidas padrão salvas para as próximas avaliações."); } catch { toast.error("Não foi possível salvar."); }
  };

  const salvar = () => onSalvar({ donatto: modelo === "donatto" ? { protocolo: protoDonatto, pct: pctDonatto } : null });

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px] items-start" data-testid="nova-avaliacao">
      <div className="space-y-4 min-w-0">
        <Bloco numero="1" titulo={editingId ? "Editar avaliação · peso e altura" : "Peso e altura"}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <label className="block"><span className="rc-label">Data</span><input type="date" className="rc-input h-10" value={form.data_avaliacao} onChange={(e) => set("data_avaliacao", e.target.value)} data-testid="anth-data" /></label>
            <label className="block"><span className="rc-label">Retorno</span><select className="rc-input h-10" value={form.retorno ? "sim" : "nao"} onChange={(e) => set("retorno", e.target.value === "sim")}><option value="nao">Não</option><option value="sim">Sim</option></select></label>
            <label className="block">
              <span className="rc-label flex justify-between">Peso <Delta valor={form.peso} anterior={ant?.peso} chave="peso" objetivo={objetivo} testId="delta-peso" /></span>
              <div className="relative"><input inputMode="decimal" className="rc-input h-10 pr-9 tabular" value={txt(form.peso)} onChange={(e) => set("peso", e.target.value)} data-testid="anth-peso" aria-label="Peso" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-gray-500">kg</span></div>
            </label>
            <label className="block"><span className="rc-label">Altura</span><div className="relative"><input inputMode="decimal" className="rc-input h-10 pr-10 tabular" value={txt(form.altura)} onChange={(e) => set("altura", e.target.value)} data-testid="anth-altura" aria-label="Altura" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-gray-500">cm</span></div></label>
            <label className="block"><span className="rc-label">Idade</span><input inputMode="numeric" className="rc-input h-10 tabular" value={form.idade} onChange={(e) => set("idade", e.target.value)} data-testid="anth-idade" aria-label="Idade" /></label>
            <label className="block"><span className="rc-label">Sexo</span><select className="rc-input h-10" value={form.sexo} onChange={(e) => set("sexo", e.target.value)} data-testid="anth-sexo"><option value="F">Feminino</option><option value="M">Masculino</option></select></label>
          </div>
        </Bloco>

        <Bloco numero="2" titulo="Perímetros (cm)" direita={(
          <>
            <button type="button" onClick={() => setTodasMedidas((v) => !v)} className="rc-btn-ghost h-8 text-[12.5px]" data-testid="outras-medidas">{todasMedidas ? "Só as padrão" : <><Plus className="h-3.5 w-3.5" /> outras medidas</>}</button>
            <button type="button" onClick={salvarPadrao} className="rc-btn-ghost h-8 text-[12.5px]" title="As medidas com valor e as padrão passam a aparecer sempre">Salvar como padrão</button>
          </>
        )}>
          <div className="grid grid-cols-[minmax(0,1fr)_58px_40px_58px_40px] items-center gap-x-1.5 gap-y-1.5 text-[13px] sm:grid-cols-[minmax(0,1fr)_74px_64px_74px_64px] sm:gap-x-2">
            <span /><span className="text-center text-[10.5px] uppercase tracking-[0.12em] text-gray-500">Direito</span><span /><span className="text-center text-[10.5px] uppercase tracking-[0.12em] text-gray-500">Esquerdo</span><span />
            {paresVisiveis.map(([base, rotulo, bi]) => {
              const noProt = protoPerim.includes(base);
              return (
                <React.Fragment key={base}>
                  <span className={noProt ? "font-semibold" : "text-gray-200"} style={noProt ? { color: COR_NOME_PROTOCOLO } : undefined}>{rotulo}</span>
                  {bi ? (
                    <>
                      <Entrada valor={form.perimetria?.[`${base}_d`]} onChange={(v) => setGrupo("perimetria", `${base}_d`, v)} rotulo={`${rotulo} direito`} testId={`per-${base}_d`} />
                      <Delta valor={form.perimetria?.[`${base}_d`]} anterior={ant?.perimetria?.[`${base}_d`]} chave={`${base}_d`} objetivo={objetivo} testId={`delta-${base}_d`} />
                      <Entrada valor={form.perimetria?.[`${base}_e`]} onChange={(v) => setGrupo("perimetria", `${base}_e`, v)} rotulo={`${rotulo} esquerdo`} testId={`per-${base}_e`} />
                      <Delta valor={form.perimetria?.[`${base}_e`]} anterior={ant?.perimetria?.[`${base}_e`]} chave={`${base}_e`} objetivo={objetivo} />
                    </>
                  ) : (
                    <>
                      <Entrada valor={form.perimetria?.[base]} onChange={(v) => setGrupo("perimetria", base, v)} rotulo={rotulo} testId={`per-${base}`} />
                      <Delta valor={form.perimetria?.[base]} anterior={ant?.perimetria?.[base]} chave={base} objetivo={objetivo} testId={`delta-${base}`} />
                      <span /><span />
                    </>
                  )}
                </React.Fragment>
              );
            })}
          </div>
          {ant && <p className="mt-3 text-[11.5px] text-gray-500">Diferença para a {ant._numero}ª avaliação. Verde é o esperado para o objetivo{objetivo ? ` (${objetivo})` : ""}.</p>}
        </Bloco>

        <Bloco numero="3" titulo="Dobras cutâneas (mm)" direita={(
          <>
            {modelo === "rc" ? (
              <select data-testid="anth-protocolo" className="rc-input h-9 w-auto max-w-[300px]" value={form.protocolo_dobras} onChange={(e) => set("protocolo_dobras", e.target.value)} aria-label="Protocolo de dobras">
                {PROTOCOLOS_DOBRAS.map((p) => <option key={p.id} value={p.id}>{p.nome}{p.id === (config.protocolo_dobras_padrao || "pollock7") ? " · padrão" : ""}</option>)}
              </select>
            ) : <span className="text-[12px] text-gray-400">Donatto: todas as dobras, protocolos lado a lado</span>}
            {modelo === "rc" && <button type="button" onClick={() => setTodasDobras((v) => !v)} className="rc-btn-ghost h-8 text-[12.5px]">{todasDobras ? "Só as do protocolo" : <><Plus className="h-3.5 w-3.5" /> outras dobras</>}</button>}
          </>
        )}>
          {aviso && <p role="status" className="mb-3 rounded-lg bg-rc-amber/10 px-3 py-2 text-[12px] text-rc-amber" data-testid="aviso-protocolo">{aviso}</p>}
          <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2" data-testid="lista-dobras">
            {dobrasVisiveis.map(([k, rotulo]) => {
              const noProt = modelo === "rc" && exigidas.includes(k);
              return (
                <div key={k} className="flex items-center gap-2 text-[13px]">
                  <span className={`flex-1 ${noProt ? "font-semibold" : "text-gray-200"}`} style={noProt ? { color: COR_NOME_PROTOCOLO } : undefined}>{rotulo}</span>
                  <Entrada valor={form.dobras?.[k]} onChange={(v) => setGrupo("dobras", k, v)} rotulo={`Dobra ${rotulo}`} testId={`dobra-${k}`} />
                  <Delta valor={form.dobras?.[k]} anterior={ant?.dobras?.[k]} chave={k} objetivo={objetivo} tipo="dobra" />
                </div>
              );
            })}
          </div>
          {modelo === "donatto" && (
            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3" data-testid="donatto-protocolos">
              {donatto.map((p) => (
                <button key={p.id} type="button" disabled={p.pct == null} onClick={() => set("donatto", { ...(form.donatto || {}), protocolo: p.id })} aria-pressed={protoDonatto === p.id}
                  className={`rounded-xl px-3 py-2 text-left ring-1 disabled:opacity-40 ${protoDonatto === p.id ? "bg-rc-blue/15 ring-rc-blue" : "bg-white/[0.03] ring-white/[0.06] hover:ring-white/20"}`}>
                  <div className="text-[12px] text-gray-300">{p.nome}</div>
                  <div className="rc-num text-[18px] text-white">{p.pct != null ? `${nf1.format(p.pct)}%` : "—"}</div>
                </button>
              ))}
            </div>
          )}
        </Bloco>

        <Bloco numero="4" titulo="Fotos">
          <Fotos pid={patient.id} avaliacaoId={editingId} pendentes={pendentes} setPendentes={setPendentes} avaliacoes={avaliacoes} fotos={fotos} recarregarFotos={recarregarFotos} />
        </Bloco>

        <section className="rc-card">
          <button type="button" onClick={() => setBioAberto((v) => !v)} className="flex w-full items-center gap-2 px-5 py-4 text-[13px] text-gray-300 hover:text-white" aria-expanded={bioAberto}>
            <ChevronDown className={`h-4 w-4 transition-transform ${bioAberto ? "rotate-180" : ""}`} /> Bioimpedância (opcional)
          </button>
          {bioAberto && (
            <div className="grid grid-cols-2 gap-3 px-5 pb-5 md:grid-cols-4">
              {[["pct_gordura", "% Massa gorda", "%"], ["massa_magra_kg", "Massa magra", "kg"], ["massa_gorda_kg", "Massa gorda", "kg"], ["agua_corporal_pct", "% Água", "%"], ["peso_muscular_kg", "Peso muscular", "kg"], ["peso_osseo_kg", "Peso ósseo", "kg"], ["gordura_visceral", "Gordura visceral", ""], ["idade_metabolica", "Idade metabólica", "anos"]].map(([k, l, u]) => (
                <label key={k} className="block"><span className="rc-label">{l}{u ? ` (${u})` : ""}</span><input inputMode="decimal" className="rc-input h-10 tabular" value={txt(form.bioimpedancia?.[k])} onChange={(e) => setGrupo("bioimpedancia", k, e.target.value)} aria-label={l} /></label>
              ))}
            </div>
          )}
        </section>

        {mostraGestacao && (
          <section className="rc-card p-5">
            <h3 className="font-display font-bold uppercase text-[16px] text-white mb-3" style={{ fontStretch: "86%" }}>Gestação</h3>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <label className="block"><span className="rc-label">Peso pré-gestacional (kg)</span><input inputMode="decimal" className="rc-input h-10" value={txt(form.gestacional?.peso_pre_gestacional)} onChange={(e) => setGrupo("gestacional", "peso_pre_gestacional", e.target.value)} /></label>
              <label className="block"><span className="rc-label">Última menstruação</span><input type="date" className="rc-input h-10" value={form.gestacional?.dum || ""} onChange={(e) => setGrupo("gestacional", "dum", e.target.value)} /></label>
              <label className="block"><span className="rc-label">Idade gestacional (sem)</span><input inputMode="numeric" className="rc-input h-10" value={txt(form.gestacional?.idade_gestacional ?? form.ig_semanas)} onChange={(e) => { setGrupo("gestacional", "idade_gestacional", e.target.value); set("ig_semanas", e.target.value); }} /></label>
              <label className="block"><span className="rc-label">Previsão de parto</span><input type="date" className="rc-input h-10" value={form.gestacional?.dpp || ""} onChange={(e) => setGrupo("gestacional", "dpp", e.target.value)} /></label>
            </div>
          </section>
        )}
      </div>

      <aside className="rc-card p-5 xl:sticky xl:top-20" data-testid="resultado-vivo">
        <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-gray-500">
          <span>Resultado {modelo === "donatto" ? "· Donatto" : ""}</span>{calculando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        </div>
        <div className="mt-2">
          <LinhaResultado destaque rotulo="% gordura" valor={pct} anterior={antC.pct_gordura} unidade="%" chave="pct_gordura" objetivo={objetivo} testId="vivo-pct" />
          {classif && <p className="-mt-1 mb-1 text-right text-[11.5px] text-gray-500">{classif.nivel} · {classif.tabela}</p>}
          <LinhaResultado rotulo="Massa magra" valor={frac.mm} anterior={antC.massa_magra} unidade=" kg" chave="massa_magra" objetivo={objetivo} testId="vivo-mm" />
          <LinhaResultado rotulo="Massa gorda" valor={frac.mg} anterior={antC.massa_gorda} unidade=" kg" chave="massa_gorda" objetivo={objetivo} />
          <LinhaResultado rotulo="Soma de dobras" valor={somaDobras(form, chavesSoma)} anterior={ant ? somaDobras(ant, chavesSoma) : null} unidade=" mm" chave="soma_dobras" objetivo={objetivo} testId="vivo-soma" />
          <LinhaResultado rotulo="Cintura ÷ quadril" valor={cintura && quadril ? cintura / quadril : null} anterior={antCintura && antQuadril ? antCintura / antQuadril : null} chave="rcq" casas={2} objetivo={objetivo} testId="vivo-rcq" />
          <LinhaResultado rotulo="Cintura ÷ estatura" valor={cintura && altura ? cintura / altura : null} anterior={antCintura && num(ant?.altura) ? antCintura / num(ant.altura) : null} chave="rce" casas={2} objetivo={objetivo} testId="vivo-rce" />
          {cintura && altura && cintura / altura >= 0.5 && <p className="text-right text-[11.5px] text-rc-amber">Cintura ≥ metade da altura</p>}
          <LinhaResultado rotulo="IMC" valor={peso && altura ? peso / ((altura / 100) ** 2) : null} anterior={antC.imc} chave="imc" objetivo={objetivo} />
        </div>
        {ant && <p className="mt-2 text-[11.5px] text-gray-500">Diferença para a {ant._numero}ª avaliação.</p>}
        <div className="mt-4 space-y-2">
          <button type="button" data-testid="save-evaluation" onClick={salvar} disabled={saving} className="rc-btn-primary w-full">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{editingId ? "Atualizar avaliação" : "Salvar avaliação"}
          </button>
          {editingId && <button type="button" onClick={onCancelar} className="rc-btn-ghost w-full"><X className="h-4 w-4" /> Cancelar edição</button>}
        </div>
      </aside>
    </div>
  );
}

function limpar(obj) {
  return Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k, num(v)]).filter(([, v]) => v != null));
}
