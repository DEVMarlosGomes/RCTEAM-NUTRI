import React, { useEffect, useMemo, useState } from "react";
import { BookOpenText, Plus, Save, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import NutriLayout from "@/components/evonut/NutriLayout";
import { api, formatApiError } from "@/lib/evo-api";

const emptyForm = {
  titulo: "",
  categoria: "",
  objetivos: "",
  tags: "",
  conteudo: "",
  ativo: true,
};

function toPayload(form) {
  return {
    titulo: form.titulo,
    categoria: form.categoria || null,
    objetivos: String(form.objetivos || "").split(",").map((v) => v.trim()).filter(Boolean),
    tags: String(form.tags || "").split(",").map((v) => v.trim()).filter(Boolean),
    conteudo: form.conteudo,
    ativo: !!form.ativo,
  };
}

export default function OrientacoesNutricionais() {
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set("q", query.trim());
        const { data } = await api.get(`/orientacoes${params.toString() ? `?${params.toString()}` : ""}`);
        if (active) setItems(data || []);
      } catch (e) {
        if (active) toast.error(formatApiError(e.response?.data?.detail) || "Erro ao carregar orientações");
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, [query]);

  const categorias = useMemo(
    () => [...new Set(items.map((item) => item.categoria).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [items]
  );

  const startEdit = (item) => {
    setEditingId(item.id);
    setForm({
      titulo: item.titulo || "",
      categoria: item.categoria || "",
      objetivos: (item.objetivos || []).join(", "),
      tags: (item.tags || []).join(", "),
      conteudo: item.conteudo || "",
      ativo: item.ativo !== false,
    });
  };

  const reset = () => {
    setEditingId(null);
    setForm(emptyForm);
  };

  const save = async () => {
    if (!form.titulo.trim() || !form.conteudo.trim()) {
      toast.error("Preencha título e conteúdo.");
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await api.put(`/orientacoes/${editingId}`, toPayload(form));
        toast.success("Orientação atualizada");
      } else {
        await api.post("/orientacoes", toPayload(form));
        toast.success("Orientação criada");
      }
      reset();
      await load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Erro ao salvar orientação");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm("Excluir esta orientação?")) return;
    try {
      await api.delete(`/orientacoes/${id}`);
      toast.success("Orientação removida");
      if (editingId === id) reset();
      await load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Erro ao excluir orientação");
    }
  };

  return (
    <NutriLayout>
      <div className="space-y-6">
        <section className="rc-card p-6 relative overflow-hidden">
          <div className="absolute inset-y-0 right-0 w-1/3 bg-[radial-gradient(circle_at_top_right,rgba(0,129,253,0.28),transparent_60%)] pointer-events-none" />
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="max-w-2xl">
              <div className="text-xs uppercase tracking-[0.32em] text-rc-blue font-bold">Prescrição</div>
              <h1 className="rc-h2 mt-2">Orientações nutricionais</h1>
              <p className="text-sm text-gray-300 mt-3">
                Biblioteca reutilizável para imprimir condutas, recomendações e instruções por objetivo clínico.
              </p>
            </div>
            <button onClick={reset} className="rc-btn-primary">
              <Plus className="w-4 h-4" />
              Nova orientação
            </button>
          </div>
        </section>

        <section className="grid xl:grid-cols-[1.1fr,1.9fr] gap-5">
          <div className="rc-card p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-wider text-gray-400">Editor</div>
                <div className="text-lg font-semibold mt-1">{editingId ? "Editar orientação" : "Nova orientação"}</div>
              </div>
              <button onClick={save} disabled={saving} className="rc-btn-primary">
                <Save className="w-4 h-4" />
                {saving ? "Salvando..." : "Salvar"}
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="rc-label">Título</label>
                <input className="rc-input" value={form.titulo} onChange={(e) => setForm((s) => ({ ...s, titulo: e.target.value }))} />
              </div>
              <div>
                <label className="rc-label">Categoria</label>
                <input className="rc-input" list="categorias-orientacoes" value={form.categoria} onChange={(e) => setForm((s) => ({ ...s, categoria: e.target.value }))} />
                <datalist id="categorias-orientacoes">
                  {categorias.map((categoria) => <option key={categoria} value={categoria} />)}
                </datalist>
              </div>
              <div>
                <label className="rc-label">Objetivos</label>
                <input className="rc-input" placeholder="Ex: emagrecimento, diabetes, hipertrofia" value={form.objetivos} onChange={(e) => setForm((s) => ({ ...s, objetivos: e.target.value }))} />
              </div>
              <div>
                <label className="rc-label">Tags</label>
                <input className="rc-input" placeholder="Ex: jejum, hidratação, suplementos" value={form.tags} onChange={(e) => setForm((s) => ({ ...s, tags: e.target.value }))} />
              </div>
              <div>
                <label className="rc-label">Conteúdo</label>
                <textarea className="rc-input min-h-[220px] resize-y" value={form.conteudo} onChange={(e) => setForm((s) => ({ ...s, conteudo: e.target.value }))} />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input type="checkbox" checked={form.ativo} onChange={(e) => setForm((s) => ({ ...s, ativo: e.target.checked }))} />
                Orientação ativa na biblioteca
              </label>
            </div>
          </div>

          <div className="rc-card p-0 overflow-hidden">
            <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="rc-h3">Biblioteca</h2>
                <p className="text-xs text-gray-400 mt-1">{items.length} orientações carregadas</p>
              </div>
              <div className="relative min-w-[280px]">
                <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} className="rc-input pl-11" placeholder="Buscar por título, conteúdo ou tag" />
              </div>
            </div>

            {loading ? (
              <div className="px-6 py-10 text-sm text-gray-400">Carregando orientações...</div>
            ) : items.length === 0 ? (
              <div className="px-6 py-10 text-sm text-gray-500">Nenhuma orientação encontrada.</div>
            ) : (
              <div className="divide-y divide-white/[0.05]">
                {items.map((item) => (
                  <div key={item.id} className="px-6 py-5 hover:bg-white/[0.02] transition-colors">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-base font-semibold text-white">{item.titulo}</h3>
                          <span className={`text-[10px] uppercase tracking-widest px-2 py-1 rounded-full border ${item.ativo !== false ? "border-emerald-500/30 text-emerald-400" : "border-white/[0.08] text-gray-500"}`}>
                            {item.ativo !== false ? "Ativa" : "Inativa"}
                          </span>
                          {item.categoria && <span className="text-[10px] uppercase tracking-widest px-2 py-1 rounded-full border border-rc-blue/30 text-rc-blue">{item.categoria}</span>}
                        </div>
                        {!!item.objetivos?.length && <div className="text-xs text-gray-500 mt-2">Objetivos: {item.objetivos.join(", ")}</div>}
                        {!!item.tags?.length && <div className="text-xs text-gray-500 mt-1">Tags: {item.tags.join(", ")}</div>}
                        <p className="text-sm text-gray-300 mt-3 whitespace-pre-wrap">{item.conteudo}</p>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button onClick={() => startEdit(item)} className="rc-btn-secondary">Editar</button>
                        <button onClick={() => remove(item.id)} className="rc-btn-ghost text-red-400 hover:text-red-300">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </NutriLayout>
  );
}
