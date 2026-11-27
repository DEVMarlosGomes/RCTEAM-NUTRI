import React, { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/evo-api";

/**
 * Cadastro de alimentos com IA (ajuste ali1): nome ou lista → TACO → TBCA (valores reais do banco) → USDA ou estimado
 * (marcados "revisar"). Conferência de kcal, aviso de duplicado e marca bloqueada. Nada é salvo sem aprovação.
 */
const CAMPOS = [["energia_kcal", "kcal"], ["proteinas_g", "PTN g"], ["carboidratos_g", "CHO g"], ["lipidios_g", "LIP g"], ["fibras_g", "Fibra g"], ["sodio_mg", "Sódio mg"]];
const fmt = (v) => (v == null || v === "" ? "—" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 }));
const TABELA = ["TACO", "TBCA"];

export default function AlimentosIA({ inicial = "", onClose, onSalvo }) {
  const [texto, setTexto] = useState(inicial);
  const [marcas, setMarcas] = useState(true);
  const [itens, setItens] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const buscar = async () => {
    const nomes = texto.split("\n").map((x) => x.trim()).filter(Boolean);
    if (!nomes.length) { toast.error("Digite um alimento (ou cole uma lista, um por linha)."); return; }
    setBuscando(true);
    try {
      const { data } = await api.post("/alimentos/ia/rascunho", { nomes, bloquear_marcas: marcas });
      setItens((data.itens || []).map((x) => ({ ...x, incluir: !x.duplicado, revisado: !x.revisar })));
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); } finally { setBuscando(false); }
  };
  const mudar = (i, patch) => setItens((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const mudarNutri = (i, k, v) => setItens((l) => l.map((x, j) => (j === i ? { ...x, nutrientes_100g: { ...x.nutrientes_100g, [k]: v === "" ? null : Number(v) }, revisado: true } : x)));
  const aprovar = async (lista) => {
    if (!lista.length) { toast.error("Nada selecionado para aprovar."); return; }
    setSalvando(true);
    try {
      const { data } = await api.post("/alimentos/ia/aprovar", { itens: lista.map((x) => ({ nome: x.nome, fonte: x.fonte, alimento_tabela_id: x.alimento_tabela_id,
        categoria: x.categoria, porcao_g: x.porcao_g, medida_caseira: x.medida_caseira, liquido: x.liquido, densidade: x.densidade, nutrientes_100g: x.nutrientes_100g, revisado: x.revisado })) });
      if (data.incluidos?.length) toast.success(`${data.incluidos.length} alimento(s) na base.`);
      if (data.pulados?.length) toast.error(data.pulados.join(" · "));
      const feitos = new Set((data.incluidos || []).map((x) => x.nome));
      setItens((l) => l.filter((x) => !feitos.has(x.nome)));
      onSalvo?.();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); } finally { setSalvando(false); }
  };
  const selecionados = (itens || []).filter((x) => x.incluir);
  const daTaco = (itens || []).filter((x) => x.fonte === "TACO" && !x.duplicado);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" role="dialog" aria-label="Cadastrar com IA">
      <div className="rc-card max-h-[92vh] w-full max-w-5xl overflow-y-auto p-6" data-testid="alimentos-ia">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div><div className="rc-eyebrow">Base nutricional</div><h2 className="rc-h3 mt-1"><Sparkles className="-mt-0.5 mr-1.5 inline h-4 w-4 text-rc-blue" />Cadastrar com IA</h2>
            <p className="mt-1 text-[12.5px] text-gray-400">Busca na ordem TACO → TBCA → USDA. O que vier da USDA ou for estimado só entra depois de revisado. Nada é salvo sem aprovar.</p></div>
          <button type="button" onClick={onClose} className="rc-btn-ghost p-2" aria-label="Fechar"><X className="h-5 w-5" /></button>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <label className="block text-[12px] text-gray-400">Alimento ou lista (um por linha)
            <textarea className="rc-input mt-1 min-h-[88px]" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={"Banana prata\nwhey growth\nQuinoa cozida"} data-testid="ia-texto" /></label>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[12.5px] text-gray-300"><input type="checkbox" checked={marcas} onChange={(e) => setMarcas(e.target.checked)} /> Bloquear marcas (sugere o genérico)</label>
            <button type="button" onClick={buscar} disabled={buscando} className="rc-btn-primary h-11 w-full justify-center" data-testid="ia-buscar">{buscando ? <><Loader2 className="h-4 w-4 animate-spin" /> Buscando…</> : <><Sparkles className="h-4 w-4" /> Buscar</>}</button>
          </div>
        </div>

        {itens && (
          <div className="mt-5">
            <div className="mb-2 text-[11px] uppercase tracking-[0.14em] text-gray-500">Rascunho · por 100 g</div>
            {itens.length === 0 && <p className="text-[13px] text-gray-400">Nada pendente.</p>}
            <ul className="space-y-2" data-testid="ia-itens">
              {itens.map((x, i) => {
                const tabela = TABELA.includes(x.fonte);
                const conf = x.conferencia_kcal || {};
                return (
                  <li key={`${x.pedido}-${i}`} className={`border p-3 ${x.incluir ? "border-rc-blue/50" : "border-[#1A1F26]"}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <input type="checkbox" checked={x.incluir} onChange={(e) => mudar(i, { incluir: e.target.checked })} aria-label={`Incluir ${x.nome}`} />
                      <input className="rc-input h-8 min-w-[220px] flex-1 py-0.5 font-semibold" value={x.nome} onChange={(e) => mudar(i, { nome: e.target.value })} disabled={tabela} aria-label="Nome" />
                      <span className={`px-2 py-0.5 text-[11px] font-semibold ${tabela ? "bg-[#3DDC84]/15 text-[#3DDC84]" : "bg-[#FFA53B]/15 text-[#FFA53B]"}`} data-testid={`ia-fonte-${i}`}>{tabela ? x.fonte : `${x.fonte} · revisar`}</span>
                      <span className="text-[11.5px] text-gray-500">{x.categoria} · {x.medida_caseira}{x.liquido ? ` · líquido${x.densidade ? ` ${String(x.densidade).replace(".", ",")} g/ml` : ""}` : ""}</span>
                    </div>
                    {x.marca_bloqueada && <p className="mt-1 text-[12px] text-gray-400">Marca bloqueada (“{x.pedido}”): entra como genérico.</p>}
                    {x.duplicado && <p className="mt-1 text-[12px] text-rc-amber" data-testid={`ia-dup-${i}`}><AlertTriangle className="-mt-0.5 mr-1 inline h-3.5 w-3.5" />Já existe na base: <b>{x.duplicado.nome}</b>{x.duplicado.fonte ? ` (${x.duplicado.fonte})` : ""}. Use esse em vez de cadastrar de novo.</p>}
                    <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
                      {CAMPOS.map(([k, rot]) => (
                        <label key={k} className="text-[11px] text-gray-500">{rot}
                          {tabela ? <div className="tabular text-[13px] text-white">{fmt(x.nutrientes_100g?.[k])}</div>
                            : <input className="rc-input mt-0.5 h-8 py-0.5 text-[13px]" type="number" step="0.1" value={x.nutrientes_100g?.[k] ?? ""} onChange={(e) => mudarNutri(i, k, e.target.value)} />}
                        </label>
                      ))}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-4 text-[12px]">
                      <span className={conf.ok === false ? "text-rc-amber" : "text-gray-400"} data-testid={`ia-conf-${i}`}>
                        {conf.ok === false ? <AlertTriangle className="-mt-0.5 mr-1 inline h-3.5 w-3.5" /> : <CheckCircle2 className="-mt-0.5 mr-1 inline h-3.5 w-3.5 text-[#3DDC84]" />}
                        PTN×4 + CHO×4 + LIP×9 = {fmt(conf.calculada)} kcal{conf.diferenca_pct != null ? ` (${fmt(conf.diferenca_pct)}% de diferença)` : ""}
                      </span>
                      {!tabela && <label className="flex items-center gap-1.5 text-gray-300"><input type="checkbox" checked={x.revisado} onChange={(e) => mudar(i, { revisado: e.target.checked })} /> Revisei os valores</label>}
                    </div>
                  </li>
                );
              })}
            </ul>
            {itens.length > 0 && (
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                {daTaco.length > 0 && <button type="button" onClick={() => aprovar(daTaco)} disabled={salvando} className="rc-btn-secondary h-10" data-testid="ia-aprovar-taco">Aprovar os da TACO ({daTaco.length})</button>}
                <button type="button" onClick={() => aprovar(selecionados)} disabled={salvando || !selecionados.length} className="rc-btn-primary h-10" data-testid="ia-aprovar">{salvando ? "Salvando…" : `Aprovar selecionados (${selecionados.length})`}</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
