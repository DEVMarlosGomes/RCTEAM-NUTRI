import React, { useEffect, useMemo, useState } from "react";
import { ChevronRight, FilePlus2, Loader2, Replace, Search } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/evo-api";
import Dialogo from "./Dialogo";

export const SEM_CATEGORIA = "Sem categoria";

/** Agrupa os modelos pela ordem das categorias da configuração; categorias avulsas e "Sem categoria" no fim. */
export function agruparPorCategoria(modelos, categorias = []) {
  const grupos = new Map(categorias.map((c) => [c, []]));
  modelos.forEach((m) => {
    const c = m.categoria || SEM_CATEGORIA;
    if (!grupos.has(c)) grupos.set(c, []);
    grupos.get(c).push(m);
  });
  const sem = grupos.get(SEM_CATEGORIA);
  grupos.delete(SEM_CATEGORIA);
  if (sem) grupos.set(SEM_CATEGORIA, sem);
  return [...grupos.entries()];
}

const temConteudo = (draft) =>
  (draft?.refeicoes || []).some((r) => [r, ...(r.opcoes || [])].some((b) => (b.alimentos || []).some((it) => it.alimento_id || String(it.nome || "").trim())));

/**
 * "Modelos de dieta": lista por categoria, com busca, kcal e nº de refeições. Um clique aplica o modelo ao
 * paciente e abre a dieta no editor; se a dieta aberta tiver conteúdo, pergunta se substitui ou cria uma nova.
 */
export default function ModelosDietaModal({ pid, draft, categorias, onAplicado, onClose }) {
  const [modelos, setModelos] = useState(null);
  const [busca, setBusca] = useState("");
  const [escolhido, setEscolhido] = useState(null);
  const [aplicando, setAplicando] = useState(false);

  useEffect(() => {
    api.get("/plano-templates").then((r) => setModelos(r.data || [])).catch(() => setModelos([]));
  }, []);

  const grupos = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const lista = (modelos || []).filter((m) => !termo || String(m.nome || "").toLowerCase().includes(termo));
    return agruparPorCategoria(lista, categorias).filter(([, itens]) => itens.length);
  }, [modelos, busca, categorias]);

  const aplicar = async (modelo, substituir) => {
    setAplicando(true);
    try {
      const url = `/patients/${pid}/plano-templates/${modelo.id}/aplicar${substituir && draft?.id ? `?substituir=${draft.id}` : ""}`;
      const { data } = await api.post(url);
      toast.success(substituir ? `Dieta substituída pelo modelo "${modelo.nome}".` : `Modelo "${modelo.nome}" aplicado em uma nova dieta.`);
      onAplicado(data.id);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
      setAplicando(false);
    }
  };

  const clicar = (m) => {
    if (aplicando) return;
    if (temConteudo(draft)) setEscolhido(m);
    else aplicar(m, Boolean(draft?.id));
  };

  if (escolhido) {
    return (
      <Dialogo eyebrow="Modelos de dieta" titulo={`Aplicar "${escolhido.nome}"`} onClose={onClose}
        rodape={<button type="button" onClick={() => setEscolhido(null)} className="rc-btn-secondary" disabled={aplicando}>Voltar</button>}>
        <p className="text-[13.5px] text-gray-300 mb-4">A dieta aberta já tem alimentos. O que você quer fazer?</p>
        <div className="space-y-2">
          {draft?.id && (
            <button type="button" disabled={aplicando} onClick={() => aplicar(escolhido, true)} className="w-full flex items-start gap-3 rounded-xl p-3 text-left bg-white/[0.03] hover:bg-white/[0.06] ring-1 ring-white/[0.08]">
              <Replace className="w-5 h-5 text-rc-amber mt-0.5" />
              <span><span className="block text-white font-medium">Substituir a dieta aberta</span>
                <span className="block text-[12.5px] text-gray-400">“{draft.titulo || "Sem título"}” recebe as refeições do modelo. A versão atual fica no histórico.</span></span>
            </button>
          )}
          <button type="button" disabled={aplicando} onClick={() => aplicar(escolhido, false)} className="w-full flex items-start gap-3 rounded-xl p-3 text-left bg-white/[0.03] hover:bg-white/[0.06] ring-1 ring-white/[0.08]">
            <FilePlus2 className="w-5 h-5 text-rc-lime mt-0.5" />
            <span><span className="block text-white font-medium">Criar uma nova dieta</span>
              <span className="block text-[12.5px] text-gray-400">A dieta aberta continua como está e o modelo vira uma nova aba.</span></span>
          </button>
        </div>
        {aplicando && <div className="mt-3 flex items-center gap-2 text-[12.5px] text-gray-400"><Loader2 className="w-4 h-4 animate-spin" />Aplicando…</div>}
      </Dialogo>
    );
  }

  return (
    <Dialogo eyebrow="Prescrição dietética" titulo="Modelos de dieta" onClose={onClose} largura="sm:max-w-xl">
      <div className="relative mb-3">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input className="rc-input h-10 pl-9" placeholder="Buscar modelo pelo nome" value={busca} onChange={(e) => setBusca(e.target.value)} autoFocus />
      </div>
      {!modelos && <div className="py-10 flex justify-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>}
      {modelos?.length === 0 && (
        <p className="py-8 text-center text-[13px] text-gray-500">Nenhum modelo salvo. Monte uma dieta e use a estrela “Modelo” para salvar.</p>
      )}
      {modelos?.length > 0 && !grupos.length && <p className="py-8 text-center text-[13px] text-gray-500">Nenhum modelo com esse nome.</p>}
      <div className="max-h-[60vh] overflow-y-auto -mx-1 px-1 space-y-4">
        {grupos.map(([categoria, itens]) => (
          <section key={categoria}>
            <h3 className="text-[11px] uppercase tracking-[0.14em] text-gray-500 mb-1.5">{categoria} <span className="text-gray-600">· {itens.length}</span></h3>
            <ul className="divide-y divide-white/[0.05] rounded-xl ring-1 ring-white/[0.06] overflow-hidden">
              {itens.map((m) => (
                <li key={m.id}>
                  <button type="button" onClick={() => clicar(m)} disabled={aplicando} data-testid={`modelo-${m.id}`}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-white/[0.04] transition-colors disabled:opacity-50">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] text-white truncate">{m.nome}</span>
                      <span className="block text-[12px] text-gray-500 tabular">
                        {m.resumo?.kcal ?? "—"} kcal · {m.resumo?.refeicoes ?? (m.refeicoes || []).length} refeições{m.objetivo ? ` · ${m.objetivo}` : ""}
                      </span>
                    </span>
                    <ChevronRight className="w-4 h-4 text-gray-600" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialogo>
  );
}

export function SalvarModeloDialogo({ valorInicial = "", categorias = [], onConfirmar, onClose }) {
  const [nome, setNome] = useState(valorInicial);
  const [categoria, setCategoria] = useState(categorias[0] || "");
  const [enviando, setEnviando] = useState(false);
  const ok = async () => {
    if (!nome.trim() || enviando) return;
    setEnviando(true);
    try { await onConfirmar(nome.trim(), categoria); } finally { setEnviando(false); }
  };
  return (
    <Dialogo titulo="Salvar como modelo" onClose={onClose}
      rodape={(
        <>
          <button type="button" onClick={onClose} className="rc-btn-secondary">Cancelar</button>
          <button type="button" onClick={ok} disabled={!nome.trim() || enviando} className="rc-btn-primary">{enviando ? "Salvando…" : "Salvar modelo"}</button>
        </>
      )}>
      <label className="rc-label" htmlFor="modelo-nome">Nome do modelo</label>
      <input id="modelo-nome" className="rc-input h-10" value={nome} autoFocus onChange={(e) => setNome(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); ok(); } }} />
      <label className="rc-label mt-4" htmlFor="modelo-categoria">Categoria</label>
      <select id="modelo-categoria" className="rc-input h-10" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
        {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
        <option value="">{SEM_CATEGORIA}</option>
      </select>
      <p className="mt-2 text-[12px] text-gray-500">As categorias são editadas em Configurações da dieta › Modelos de dieta.</p>
    </Dialogo>
  );
}
