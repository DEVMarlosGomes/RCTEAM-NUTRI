import React, { useEffect, useRef, useState } from "react";
import NutriLayout from "@/components/evonut/NutriLayout";
import { api, formatApiError } from "@/lib/evo-api";
import { Star, Trash2, Upload, Plus, ToggleLeft, ToggleRight, Loader2, Quote } from "lucide-react";
import { toast } from "sonner";

const EMPTY_FORM = { name: "", stars: 5, phrase: "", quote: "", active: true, order: 0 };

export default function Depoimentos() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [uploadingId, setUploadingId] = useState(null);
  const fileRefs = useRef({});

  const reload = async () => {
    try {
      const { data } = await api.get("/testimonials");
      setList(data);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const updateForm = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.quote.trim() || !form.phrase.trim()) {
      toast.error("Preencha nome, frase de destaque e relato");
      return;
    }
    setSaving(true);
    try {
      await api.post("/testimonials", form);
      toast.success("Depoimento criado!");
      setForm(EMPTY_FORM);
      reload();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Remover este depoimento da landing page?")) return;
    try {
      await api.delete(`/testimonials/${id}`);
      toast.success("Depoimento removido");
      reload();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  const handleToggle = async (t) => {
    try {
      await api.patch(`/testimonials/${t.id}`, { active: !t.active });
      reload();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  const handlePhoto = async (id, file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Envie uma imagem"); return; }
    setUploadingId(id);
    const fd = new FormData();
    fd.append("file", file);
    try {
      await api.post(`/testimonials/${id}/photo`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Foto atualizada");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setUploadingId(null);
    }
  };

  const apiBase = process.env.REACT_APP_BACKEND_URL || "";

  return (
    <NutriLayout>
      <div className="max-w-5xl mx-auto">
        <header className="mb-6">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-rc-blue/15 border border-rc-blue/40 flex items-center justify-center">
              <Quote className="w-5 h-5 text-rc-blue" />
            </div>
            <div>
              <h1 className="rc-h2">Depoimentos</h1>
              <p className="text-sm text-gray-400 mt-1">
                Publique relatos na landing page. Cada depoimento ativo aparece automaticamente no site.
              </p>
            </div>
          </div>
        </header>

        <div className="grid lg:grid-cols-[1fr_380px] gap-6">
          {/* List */}
          <section className="space-y-3">
            {loading ? (
              <div className="rc-card p-10 text-center text-gray-500">
                <Loader2 className="w-5 h-5 animate-spin inline" />
              </div>
            ) : list.length === 0 ? (
              <div className="rc-card p-10 text-center text-gray-500 text-sm">
                Nenhum depoimento ainda. Crie o primeiro ao lado.
              </div>
            ) : (
              list.map((t) => (
                <div key={t.id} className={`rc-card p-4 flex gap-4 items-start transition-all ${t.active ? "" : "opacity-50"}`}>
                  {/* Avatar */}
                  <div className="flex-shrink-0 relative">
                    <div className="w-14 h-14 rounded-full overflow-hidden border-2 border-white/10 bg-white/5">
                      <img
                        src={`${apiBase}/api/public/testimonials/${t.id}/photo`}
                        alt={t.name}
                        className="w-full h-full object-cover"
                        onError={(e) => { e.target.style.display = "none"; }}
                      />
                    </div>
                    <label
                      className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-rc-blue flex items-center justify-center cursor-pointer hover:bg-rc-blue/80"
                      title="Trocar foto"
                    >
                      <Upload className="w-2.5 h-2.5 text-white" />
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        ref={(el) => { fileRefs.current[t.id] = el; }}
                        onChange={(e) => handlePhoto(t.id, e.target.files?.[0])}
                        disabled={uploadingId === t.id}
                      />
                    </label>
                    {uploadingId === t.id && (
                      <div className="absolute inset-0 rounded-full flex items-center justify-center bg-black/50">
                        <Loader2 className="w-4 h-4 animate-spin text-white" />
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5 mb-0.5">
                          {Array.from({ length: t.stars }).map((_, i) => (
                            <Star key={i} className="w-3 h-3 fill-rc-blue text-rc-blue" />
                          ))}
                        </div>
                        <p className="font-bold text-sm">{t.name}</p>
                        {t.phrase && <p className="text-xs font-bold text-rc-blue mt-0.5">{t.phrase}</p>}
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => handleToggle(t)} className="text-gray-400 hover:text-white transition-colors p-1" title={t.active ? "Desativar" : "Ativar"}>
                          {t.active ? <ToggleRight className="w-5 h-5 text-rc-blue" /> : <ToggleLeft className="w-5 h-5" />}
                        </button>
                        <button onClick={() => handleDelete(t.id)} className="text-gray-500 hover:text-red-400 transition-colors p-1" title="Remover">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-gray-400 mt-1.5 leading-relaxed line-clamp-3">"{t.quote}"</p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${t.active ? "bg-emerald-400/10 text-emerald-400" : "bg-white/5 text-gray-500"}`}>
                        {t.active ? "Publicado" : "Oculto"}
                      </span>
                      <span className="text-[10px] text-gray-600">
                        {new Date(t.created_at).toLocaleDateString("pt-BR")}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </section>

          {/* Create form */}
          <aside>
            <form onSubmit={handleCreate} className="rc-card p-5 space-y-4 sticky top-6">
              <div className="flex items-center gap-2 mb-1">
                <Plus className="w-4 h-4 text-rc-blue" />
                <h2 className="font-bold uppercase tracking-wider text-xs text-gray-300">Novo depoimento</h2>
              </div>

              <div>
                <label className="rc-label">Nome do aluno</label>
                <input className="rc-input" placeholder="Ex: Caio Felipe" value={form.name} onChange={(e) => updateForm("name", e.target.value)} />
              </div>

              <div>
                <label className="rc-label">Frase de destaque <span className="text-rc-blue normal-case font-normal">(aparece em azul)</span></label>
                <input className="rc-input" placeholder="Ex: 15,5% → 10% de gordura em 3 meses" value={form.phrase} onChange={(e) => updateForm("phrase", e.target.value)} />
              </div>

              <div>
                <label className="rc-label">Estrelas</label>
                <div className="flex gap-2 mt-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => updateForm("stars", n)}
                      className={`transition-colors ${n <= form.stars ? "text-rc-blue" : "text-gray-600"}`}
                    >
                      <Star className={`w-5 h-5 ${n <= form.stars ? "fill-rc-blue" : ""}`} />
                    </button>
                  ))}
                  <span className="text-xs text-gray-500 self-center ml-1">{form.stars} estrelas</span>
                </div>
              </div>

              <div>
                <label className="rc-label">Relato <span className="text-gray-500 normal-case font-normal">(curto, com impacto)</span></label>
                <textarea
                  className="rc-input min-h-[100px] text-sm leading-relaxed"
                  placeholder="Em 3 meses reduzi 8% de gordura e me senti mais saudável..."
                  value={form.quote}
                  onChange={(e) => updateForm("quote", e.target.value)}
                  rows={4}
                />
                <div className="text-[10px] text-gray-600 mt-1">{form.quote.length} / 280 caracteres recomendados</div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="activeCheck"
                  checked={form.active}
                  onChange={(e) => updateForm("active", e.target.checked)}
                  className="rounded border-white/20 bg-transparent"
                />
                <label htmlFor="activeCheck" className="text-sm text-gray-300 cursor-pointer">Publicar imediatamente</label>
              </div>

              <button type="submit" disabled={saving} className="rc-btn-primary w-full">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Criar depoimento
              </button>

              <p className="text-[10px] text-gray-600 leading-relaxed">
                Após criar, clique no ícone de câmera no card para adicionar a foto do aluno. Depoimentos ativos aparecem automaticamente na landing page.
              </p>
            </form>
          </aside>
        </div>
      </div>
    </NutriLayout>
  );
}
