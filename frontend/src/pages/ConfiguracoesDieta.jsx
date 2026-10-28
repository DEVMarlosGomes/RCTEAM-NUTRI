import React, { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Plus, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import NutriLayout from "@/components/evonut/NutriLayout";
import PageHeader from "@/components/evonut/PageHeader";
import { api, formatApiError } from "@/lib/evo-api";
import useDietaConfig from "@/components/evonut/dieta/useDietaConfig";
import { BlocoAlimentos, LARGURA_MIN_EDITOR } from "@/components/evonut/dieta/EditorDieta";
import { blocoDoSalvo, itensParaSalvar, nf0, totaisBloco } from "@/components/evonut/dieta/calculos";

const SECOES = [
  ["geral", "Configurações da dieta"],
  ["objetivos", "Objetivos da dieta"],
  ["titulos", "Títulos de dieta"],
  ["nomes_refeicao", "Nomes de refeição"],
  ["observacoes_refeicao", "Observações de refeição"],
  ["observacoes_alimento", "Observações de alimento"],
  ["modelos_refeicao", "Modelos de refeição"],
  ["modelos_dieta", "Modelos de dieta"],
  ["listas", "Listas de substituição"],
];

const TABELAS = [["TACO", "TACO"], ["IBGE", "IBGE"], ["TBCA", "TBCA"], ["Tucunduva", "Tucunduva"], ["Marcas", "Marcas comerciais"], ["Meus", "Meus alimentos"]];

const erro = (e) => toast.error(formatApiError(e.response?.data?.detail));

function Selecao({ rotulo, valor, onChange, opcoes }) {
  return (
    <label className="block py-4 border-b border-white/[0.05]">
      <span className="block text-[14px] text-white font-medium mb-2">{rotulo}</span>
      <select className="rc-input h-10 max-w-[460px]" value={valor} onChange={(e) => onChange(e.target.value)}>
        {opcoes.map(([v, l]) => <option key={String(v)} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

function Geral({ config, salvar }) {
  const [form, setForm] = useState(config);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => setForm(config), [config]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const refs = form.refeicoes_padrao || [];
  const setRef = (i, patch) => set("refeicoes_padrao", refs.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  const enviar = async () => {
    setSalvando(true);
    try {
      await salvar({
        refeicoes_iniciais: Number(form.refeicoes_iniciais) || 6,
        tabelas_alimentos: form.tabelas_alimentos || [],
        forma_calculo: form.forma_calculo,
        layout_calculos: form.layout_calculos,
        layout_linhas: form.layout_linhas,
        incluir_observacoes: form.incluir_observacoes,
        layout_lista_substituicao: form.layout_lista_substituicao,
        incluir_macros_pdf: form.incluir_macros_pdf,
        refeicoes_padrao: refs.filter((r) => (r.nome || "").trim()),
      });
      toast.success("Configurações salvas.");
    } catch (e) { erro(e); } finally { setSalvando(false); }
  };

  return (
    <div>
      <label className="block pb-4 border-b border-white/[0.05]">
        <span className="block text-[14px] text-white font-medium mb-2">Quantidade de refeições iniciais</span>
        <input className="rc-input h-10 w-28 tabular" inputMode="numeric" value={form.refeicoes_iniciais ?? ""} onChange={(e) => set("refeicoes_iniciais", e.target.value)} />
      </label>
      <div className="py-4 border-b border-white/[0.05]">
        <span className="block text-[14px] text-white font-medium">Tabela de alimentos consultada</span>
        <span className="block text-[12.5px] text-gray-500 mb-3">Onde a busca de alimento da dieta procura. Nenhuma marcada = todas.</span>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {TABELAS.map(([k, l]) => {
            const marcadas = form.tabelas_alimentos || [];
            return (
              <label key={k} className="inline-flex items-center gap-2 text-[13.5px] text-gray-200 cursor-pointer">
                <input type="checkbox" className="accent-[#0081FD] w-4 h-4" checked={marcadas.includes(k)}
                  onChange={() => set("tabelas_alimentos", marcadas.includes(k) ? marcadas.filter((x) => x !== k) : [...marcadas, k])} />
                {l}
              </label>
            );
          })}
        </div>
      </div>
      <Selecao rotulo="Forma de cálculo da dieta" valor={form.forma_calculo} onChange={(v) => set("forma_calculo", v)}
        opcoes={[["medida", "Medida caseira (escolhe a medida e digita a quantidade)"], ["gramas", "Gramas (digita direto o peso)"]]} />
      <Selecao rotulo="Layout de impressão dos cálculos da dieta" valor={form.layout_calculos} onChange={(v) => set("layout_calculos", v)}
        opcoes={[["medida_gramas", "Medida caseira e gramas — 1 fatia (25g)"], ["medida", "Medida caseira — 1 fatia"], ["gramas", "Gramas — 25g"]]} />
      <Selecao rotulo="Layout de impressão da dieta" valor={form.layout_linhas} onChange={(v) => set("layout_linhas", v)}
        opcoes={[["iguais", "Linhas iguais"], ["alternadas", "Linhas alternadas"]]} />
      <Selecao rotulo="Incluir observações ao final da dieta" valor={form.incluir_observacoes ? "1" : "0"} onChange={(v) => set("incluir_observacoes", v === "1")}
        opcoes={[["1", "Sim"], ["0", "Não"]]} />
      <Selecao rotulo="Layout da lista de substituição de alimento na impressão" valor={form.layout_lista_substituicao} onChange={(v) => set("layout_lista_substituicao", v)}
        opcoes={[["lista", "Colocar a lista de substituição no formato de lista"], ["obs", "Colocar a lista de substituição somente nas observações do alimento"], ["nome_obs", "Colocar no nome do alimento e nas observações"]]} />
      <Selecao rotulo="Incluir macronutrientes no PDF da dieta" valor={form.incluir_macros_pdf ? "1" : "0"} onChange={(v) => set("incluir_macros_pdf", v === "1")}
        opcoes={[["0", "Não"], ["1", "Sim"]]} />

      <div className="py-4">
        <span className="block text-[14px] text-white font-medium">Refeições que já vêm na dieta nova</span>
        <span className="block text-[12.5px] text-gray-500 mb-3">Nome e horário de cada refeição inicial, na ordem.</span>
        <div className="space-y-2 max-w-[460px]">
          {refs.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className="rc-input h-9 flex-1 uppercase" value={r.nome || ""} placeholder="Nome" onChange={(e) => setRef(i, { nome: e.target.value })} />
              <input className="rc-input h-9 w-24 tabular" value={r.horario || ""} placeholder="Horário" onChange={(e) => setRef(i, { horario: e.target.value })} />
              <button type="button" onClick={() => set("refeicoes_padrao", refs.filter((_, k) => k !== i))} className="rc-btn-ghost p-2 hover:text-rc-coral" aria-label="Remover refeição"><X className="w-4 h-4" /></button>
            </div>
          ))}
          <button type="button" onClick={() => set("refeicoes_padrao", [...refs, { nome: "", horario: "" }])} className="rc-btn-ghost text-rc-lime -ml-2"><Plus className="w-4 h-4" /> Adicionar refeição</button>
        </div>
      </div>
      <button type="button" onClick={enviar} disabled={salvando} className="rc-btn-primary mt-2">{salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar</button>
    </div>
  );
}

function ListaTextos({ campo, titulo, ajuda, config, salvar }) {
  const [itens, setItens] = useState(config[campo] || []);
  const [novo, setNovo] = useState("");
  const [salvando, setSalvando] = useState(false);
  useEffect(() => setItens(config[campo] || []), [config, campo]);
  const mover = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= itens.length) return;
    const lista = [...itens];
    [lista[i], lista[j]] = [lista[j], lista[i]];
    setItens(lista);
  };
  const adicionar = () => {
    if (!novo.trim()) return;
    setItens((l) => [...l, novo.trim()]);
    setNovo("");
  };
  const enviar = async () => {
    setSalvando(true);
    try { await salvar({ [campo]: itens }); toast.success(`${titulo}: salvo.`); } catch (e) { erro(e); } finally { setSalvando(false); }
  };
  return (
    <div>
      <p className="text-[13px] text-gray-400 mb-4 max-w-[70ch]">{ajuda}</p>
      <div className="space-y-1.5 max-w-[640px]">
        {itens.map((t, i) => (
          <div key={`${t}-${i}`} className="flex items-center gap-1">
            <input className="rc-input h-9 flex-1" value={t} onChange={(e) => setItens((l) => l.map((x, k) => (k === i ? e.target.value : x)))} />
            <button type="button" onClick={() => mover(i, 1)} disabled={i === itens.length - 1} className="rc-btn-ghost p-1.5 disabled:opacity-25" aria-label="Mover abaixo"><ChevronDown className="w-4 h-4" /></button>
            <button type="button" onClick={() => mover(i, -1)} disabled={i === 0} className="rc-btn-ghost p-1.5 disabled:opacity-25" aria-label="Mover acima"><ChevronUp className="w-4 h-4" /></button>
            <button type="button" onClick={() => setItens((l) => l.filter((_, k) => k !== i))} className="rc-btn-ghost p-1.5 hover:text-rc-coral" aria-label="Remover"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
        <div className="flex items-center gap-2 pt-2">
          <input className="rc-input h-9 flex-1" value={novo} placeholder="Novo item" onChange={(e) => setNovo(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); adicionar(); } }} />
          <button type="button" onClick={adicionar} className="rc-btn-secondary h-9"><Plus className="w-4 h-4" /> Adicionar</button>
        </div>
      </div>
      <button type="button" onClick={enviar} disabled={salvando} className="rc-btn-primary mt-5">{salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar</button>
    </div>
  );
}

/** CRUD de modelos de refeicao e de listas de substituicao (nome + alimentos na mesma grade da dieta). */
function ItensSalvos({ rota, rotuloNovo, comObservacao, ajuda, config }) {
  const [itens, setItens] = useState(null);
  const [editando, setEditando] = useState(null); // { id?, nome, observacao, alimentos }
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(() => api.get(rota).then((r) => setItens(r.data || [])).catch(() => setItens([])), [rota]);
  useEffect(() => { carregar(); }, [carregar]);

  const salvar = async () => {
    if (!editando.nome.trim()) { toast.error("Dê um nome."); return; }
    setSalvando(true);
    const body = { nome: editando.nome.trim(), alimentos: itensParaSalvar(editando.alimentos), ...(comObservacao ? { observacao: editando.observacao || "" } : {}) };
    try {
      if (editando.id) await api.put(`${rota}/${editando.id}`, body); else await api.post(rota, body);
      toast.success("Salvo.");
      setEditando(null);
      carregar();
    } catch (e) { erro(e); } finally { setSalvando(false); }
  };
  const apagar = async (item) => {
    if (!window.confirm(`Apagar "${item.nome}"?`)) return;
    try { await api.delete(`${rota}/${item.id}`); carregar(); } catch (e) { erro(e); }
  };

  if (editando) {
    return (
      <div>
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <label className="block flex-1 min-w-[240px]">
            <span className="rc-label">Nome</span>
            <input className="rc-input h-10" value={editando.nome} onChange={(e) => setEditando((x) => ({ ...x, nome: e.target.value }))} autoFocus />
          </label>
          {comObservacao && (
            <label className="block flex-1 min-w-[240px]">
              <span className="rc-label">Observação</span>
              <input className="rc-input h-10" value={editando.observacao || ""} onChange={(e) => setEditando((x) => ({ ...x, observacao: e.target.value }))} />
            </label>
          )}
        </div>
        <div className="overflow-x-auto"><div className={LARGURA_MIN_EDITOR}>
          <BlocoAlimentos bk="cfg" bloco={editando} config={config} onChange={(b) => setEditando((x) => ({ ...x, alimentos: b.alimentos }))} />
        </div></div>
        <div className="flex gap-2 mt-5">
          <button type="button" onClick={salvar} disabled={salvando} className="rc-btn-primary">{salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar</button>
          <button type="button" onClick={() => setEditando(null)} className="rc-btn-secondary">Cancelar</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <p className="text-[13px] text-gray-400 max-w-[70ch]">{ajuda}</p>
        <button type="button" onClick={() => setEditando({ nome: "", observacao: "", ...blocoDoSalvo({ alimentos: [] }) })} className="rc-btn-primary"><Plus className="w-4 h-4" /> {rotuloNovo}</button>
      </div>
      {!itens && <div className="py-8 flex justify-center text-gray-400"><Loader2 className="w-4 h-4 animate-spin" /></div>}
      {itens?.length === 0 && <p className="py-8 text-center text-[13px] text-gray-500">Nada cadastrado ainda.</p>}
      <div className="divide-y divide-white/[0.05]">
        {(itens || []).map((it) => {
          const bloco = blocoDoSalvo(it);
          return (
            <div key={it.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-[14px] text-white truncate">{it.nome}</div>
                <div className="text-[12px] text-gray-500 truncate">
                  {(it.alimentos || []).length} alimentos · {nf0.format(totaisBloco(bloco).kcal)} kcal
                  {(it.alimentos || []).length > 0 && ` · ${(it.alimentos || []).slice(0, 4).map((a) => a.nome || a.alimento_nome).join(", ")}${it.alimentos.length > 4 ? "…" : ""}`}
                </div>
              </div>
              <button type="button" onClick={() => setEditando({ id: it.id, nome: it.nome, observacao: it.observacao || "", ...bloco })} className="rc-btn-secondary h-9">Editar</button>
              <button type="button" onClick={() => apagar(it)} className="rc-btn-ghost p-2 hover:text-rc-coral" aria-label={`Apagar ${it.nome}`}><Trash2 className="w-4 h-4" /></button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ModelosDieta() {
  const [itens, setItens] = useState(null);
  const carregar = useCallback(() => api.get("/plano-templates").then((r) => setItens(r.data || [])).catch(() => setItens([])), []);
  useEffect(() => { carregar(); }, [carregar]);
  const apagar = async (t) => {
    if (!window.confirm(`Apagar o modelo "${t.nome}"?`)) return;
    try { await api.delete(`/plano-templates/${t.id}`); carregar(); } catch (e) { erro(e); }
  };
  return (
    <div>
      <p className="text-[13px] text-gray-400 mb-4 max-w-[70ch]">Para criar um modelo, monte a dieta em um paciente e use a estrela “Salvar como modelo”. Para usar, clique em Importar na dieta de qualquer paciente.</p>
      {!itens && <div className="py-8 flex justify-center text-gray-400"><Loader2 className="w-4 h-4 animate-spin" /></div>}
      {itens?.length === 0 && <p className="py-8 text-center text-[13px] text-gray-500">Nenhum modelo de dieta salvo.</p>}
      <div className="divide-y divide-white/[0.05]">
        {(itens || []).map((t) => (
          <div key={t.id} className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-[14px] text-white truncate">{t.nome}</div>
              <div className="text-[12px] text-gray-500">{(t.refeicoes || []).length} refeições{t.objetivo ? ` · ${t.objetivo}` : ""}</div>
            </div>
            <button type="button" onClick={() => apagar(t)} className="rc-btn-ghost p-2 hover:text-rc-coral" aria-label={`Apagar ${t.nome}`}><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ConfiguracoesDieta() {
  const { config, recarregar, salvar } = useDietaConfig();
  const [secao, setSecao] = useState("geral");
  useEffect(() => { recarregar(); }, [recarregar]);
  const titulo = SECOES.find(([k]) => k === secao)?.[1];
  const ajudas = {
    objetivos: "Sugestões do campo Objetivo da dieta. Pode escrever outro na hora; esta lista só agiliza.",
    titulos: "Sugestões do campo Título (ex.: Dieta para os dias COM treino).",
    nomes_refeicao: "Sugestões do nome da refeição.",
    observacoes_refeicao: "Frases prontas para a observação da refeição.",
    observacoes_alimento: "Frases prontas para a observação do alimento (ex.: ou Grupo de Frutas).",
  };

  return (
    <NutriLayout>
      <PageHeader eyebrow="Configurações" title="Dieta" description="Padrões da prescrição dietética: listas de sugestões, forma de cálculo, impressão, modelos e listas de substituição." />
      <div className="grid gap-5 lg:grid-cols-[230px_minmax(0,1fr)] items-start">
        <nav className="rc-card p-2 lg:sticky lg:top-6" aria-label="Seções">
          {SECOES.map(([k, l]) => (
            <button key={k} type="button" onClick={() => setSecao(k)}
              className={`w-full text-left rounded-lg px-3 py-2 text-[13.5px] transition-colors ${secao === k ? "bg-rc-blue/15 text-white font-medium" : "text-gray-400 hover:text-white hover:bg-white/[0.04]"}`}>
              {l}
            </button>
          ))}
        </nav>
        <section className="rc-card p-5 sm:p-6 min-w-0">
          <h2 className="font-display font-bold uppercase text-[20px] text-white mb-4" style={{ fontStretch: "82%" }}>{titulo}</h2>
          {secao === "geral" && <Geral config={config} salvar={salvar} />}
          {ajudas[secao] && <ListaTextos key={secao} campo={secao} titulo={titulo} ajuda={ajudas[secao]} config={config} salvar={salvar} />}
          {secao === "modelos_refeicao" && (
            <ItensSalvos rota="/dieta/modelos-refeicao" rotuloNovo="Novo modelo de refeição" comObservacao config={config}
              ajuda="Refeições prontas para carregar na dieta pelo ícone de livro da refeição. Também dá para criar pela estrela de uma refeição já montada." />
          )}
          {secao === "modelos_dieta" && <ModelosDieta />}
          {secao === "listas" && (
            <ItensSalvos rota="/dieta/listas-substituicao" rotuloNovo="Nova lista" config={config}
              ajuda="Grupos de substituição (Carnes e ovos, Frutas…) para adicionar na aba Lista de substituição de qualquer dieta." />
          )}
        </section>
      </div>
    </NutriLayout>
  );
}
