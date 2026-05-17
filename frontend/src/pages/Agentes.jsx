import React, { useEffect, useMemo, useRef, useState } from "react";
import NutriLayout from "@/components/evonut/NutriLayout";
import { api, formatApiError } from "@/lib/evo-api";
import { Bot, Upload, FileText, Trash2, Save, Plus, Loader2, FileType2 } from "lucide-react";
import { toast } from "sonner";

const AGENT_TINTS = {
  agent1: { label: "Triagem · SAC", color: "from-rc-blue/20 to-rc-blue/5" },
  agent2: { label: "Consultório", color: "from-cyan-400/15 to-cyan-400/5" },
  agent3: { label: "Suporte Paciente", color: "from-emerald-400/15 to-emerald-400/5" },
};

export default function Agentes() {
  const [agents, setAgents] = useState([]);
  const [selected, setSelected] = useState(null); // code
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [textTitle, setTextTitle] = useState("");
  const [textBody, setTextBody] = useState("");
  const [addingText, setAddingText] = useState(false);
  const fileRef = useRef(null);

  const reloadList = async () => {
    try {
      const { data } = await api.get("/agents");
      setAgents(data);
      if (!selected && data.length) setSelected(data[0].code);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  const reloadDetail = async (code) => {
    if (!code) return;
    setLoadingDetail(true);
    try {
      const { data } = await api.get(`/agents/${code}`);
      setDetail(data);
      setPrompt(data.base_prompt || "");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setLoadingDetail(false);
    }
  };

  useEffect(() => { reloadList(); }, []);
  useEffect(() => { reloadDetail(selected); }, [selected]);

  const onSavePrompt = async () => {
    setSavingPrompt(true);
    try {
      await api.patch(`/agents/${selected}`, { base_prompt: prompt });
      toast.success("Prompt base atualizado");
      reloadDetail(selected);
      reloadList();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setSavingPrompt(false);
    }
  };

  const onUploadFile = async (file) => {
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      await api.post(`/agents/${selected}/documents`, fd, {
        params: { title: file.name },
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success("Documento adicionado ao treinamento");
      reloadDetail(selected);
      reloadList();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onAddText = async () => {
    if (!textBody.trim()) {
      toast.error("Conteúdo vazio");
      return;
    }
    setAddingText(true);
    try {
      await api.post(`/agents/${selected}/documents/text`, {
        title: textTitle || "Texto manual",
        content: textBody,
      });
      toast.success("Texto adicionado ao treinamento");
      setTextTitle("");
      setTextBody("");
      reloadDetail(selected);
      reloadList();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setAddingText(false);
    }
  };

  const onDeleteDoc = async (id) => {
    if (!window.confirm("Remover este documento do treinamento?")) return;
    try {
      await api.delete(`/agents/${selected}/documents/${id}`);
      toast.success("Documento removido");
      reloadDetail(selected);
      reloadList();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  const usagePct = useMemo(() => {
    if (!detail) return 0;
    return Math.min(100, Math.round((detail.prompt_chars / detail.prompt_max_chars) * 100));
  }, [detail]);

  return (
    <NutriLayout>
      <div className="max-w-7xl mx-auto" data-testid="agentes-page">
        <header className="mb-6">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-rc-blue/15 border border-rc-blue/40 flex items-center justify-center">
              <Bot className="w-5 h-5 text-rc-blue" />
            </div>
            <div>
              <h1 className="rc-h2">Agentes IA</h1>
              <p className="text-sm text-gray-400 mt-1">
                Treine seus 3 agentes com documentos (PDF, JSON ou texto). Tudo é injetado no system prompt.
              </p>
            </div>
          </div>
        </header>

        <div className="grid lg:grid-cols-[260px_1fr] gap-6">
          {/* Sidebar of agents */}
          <aside className="space-y-3" data-testid="agents-sidebar">
            {agents.map((a) => {
              const tint = AGENT_TINTS[a.code] || {};
              const active = selected === a.code;
              return (
                <button
                  key={a.code}
                  data-testid={`agent-select-${a.code}`}
                  onClick={() => setSelected(a.code)}
                  className={`w-full text-left rc-card p-4 transition-all ${
                    active ? "border-rc-blue/60 shadow-[0_8px_30px_-12px_rgba(0,129,253,0.6)]" : "hover:border-white/15"
                  }`}
                >
                  <div className={`inline-flex px-2 py-0.5 rounded text-[10px] uppercase tracking-widest font-bold bg-gradient-to-r ${tint.color} text-gray-100 mb-2`}>
                    {tint.label}
                  </div>
                  <div className="font-bold text-sm leading-snug">{a.name}</div>
                  <div className="mt-2 text-[11px] text-gray-500 flex items-center gap-2">
                    <FileText className="w-3 h-3" /> {a.documents_count} {a.documents_count === 1 ? "documento" : "documentos"}
                  </div>
                </button>
              );
            })}
          </aside>

          {/* Detail */}
          <section className="space-y-6">
            {!detail ? (
              <div className="rc-card p-10 text-center text-gray-500">
                {loadingDetail ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "Selecione um agente"}
              </div>
            ) : (
              <>
                {/* Base prompt */}
                <div className="rc-card p-5" data-testid="agent-prompt-block">
                  <div className="flex items-center justify-between gap-4 mb-3">
                    <div>
                      <h2 className="font-display font-black text-lg tracking-wide">{detail.name}</h2>
                      <p className="text-xs text-gray-500 mt-1 leading-relaxed">{detail.description}</p>
                    </div>
                    <button
                      data-testid="save-prompt-btn"
                      onClick={onSavePrompt}
                      disabled={savingPrompt}
                      className="rc-btn-primary"
                    >
                      {savingPrompt ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      Salvar prompt
                    </button>
                  </div>
                  <label className="rc-label">Prompt base do agente</label>
                  <textarea
                    data-testid="agent-prompt-textarea"
                    className="rc-input min-h-[180px] font-mono text-xs leading-relaxed"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                  />
                  <div className="mt-3 text-[11px] text-gray-500 flex items-center justify-between">
                    <span>System prompt total (com docs): <strong className="text-gray-300">{detail.prompt_chars.toLocaleString()}</strong> / {detail.prompt_max_chars.toLocaleString()} caracteres</span>
                    <span className={usagePct > 90 ? "text-red-400" : usagePct > 70 ? "text-yellow-400" : "text-emerald-400"}>{usagePct}%</span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-rc-blue to-cyan-300 transition-all"
                      style={{ width: `${usagePct}%` }}
                    />
                  </div>
                </div>

                {/* Upload file */}
                <div className="rc-card p-5">
                  <h3 className="font-bold uppercase tracking-wider text-xs text-gray-300 mb-3 flex items-center gap-2">
                    <Upload className="w-4 h-4" /> Adicionar documento de treinamento
                  </h3>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                    <input
                      ref={fileRef}
                      data-testid="agent-file-input"
                      type="file"
                      accept=".pdf,.json,.txt,.md,application/pdf,application/json,text/plain"
                      onChange={(e) => onUploadFile(e.target.files?.[0])}
                      disabled={uploading}
                      className="text-sm text-gray-300 file:mr-3 file:px-3 file:py-1.5 file:rounded-md file:border-0 file:text-xs file:font-bold file:bg-rc-blue file:text-black hover:file:bg-rc-blue/80 file:cursor-pointer cursor-pointer"
                    />
                    {uploading && (
                      <span className="text-xs text-gray-400 flex items-center gap-2">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Enviando...
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-[11px] text-gray-500">Aceita PDF, JSON, TXT, MD · máximo 15MB. Texto será extraído e anexado ao prompt.</p>
                </div>

                {/* Add free text */}
                <div className="rc-card p-5">
                  <h3 className="font-bold uppercase tracking-wider text-xs text-gray-300 mb-3 flex items-center gap-2">
                    <Plus className="w-4 h-4" /> Colar texto livre
                  </h3>
                  <input
                    data-testid="text-doc-title"
                    className="rc-input mb-2"
                    placeholder="Título (ex: Diretrizes Vitamina D)"
                    value={textTitle}
                    onChange={(e) => setTextTitle(e.target.value)}
                  />
                  <textarea
                    data-testid="text-doc-body"
                    className="rc-input min-h-[120px] text-sm"
                    placeholder="Cole aqui um trecho de protocolo, guideline, FAQ..."
                    value={textBody}
                    onChange={(e) => setTextBody(e.target.value)}
                  />
                  <div className="mt-3 flex justify-end">
                    <button
                      data-testid="add-text-btn"
                      onClick={onAddText}
                      disabled={addingText || !textBody.trim()}
                      className="rc-btn-secondary"
                    >
                      {addingText ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                      Adicionar texto
                    </button>
                  </div>
                </div>

                {/* Docs list */}
                <div className="rc-card p-5" data-testid="docs-list">
                  <h3 className="font-bold uppercase tracking-wider text-xs text-gray-300 mb-3 flex items-center gap-2">
                    <FileText className="w-4 h-4" /> Documentos ({detail.documents.length})
                  </h3>
                  {detail.documents.length === 0 ? (
                    <p className="text-sm text-gray-500">Nenhum documento de treinamento ainda.</p>
                  ) : (
                    <ul className="space-y-2">
                      {detail.documents.map((d) => (
                        <li
                          key={d.id}
                          data-testid={`doc-row-${d.id}`}
                          className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/[0.02] border border-white/5 hover:border-rc-blue/30 transition-colors"
                        >
                          <FileType2 className="w-4 h-4 text-rc-blue flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm truncate font-medium">{d.title}</div>
                            <div className="text-[11px] text-gray-500">
                              {d.chars.toLocaleString()} chars · {d.content_type || "—"} · {new Date(d.created_at).toLocaleDateString("pt-BR")}
                            </div>
                          </div>
                          <button
                            data-testid={`delete-doc-${d.id}`}
                            onClick={() => onDeleteDoc(d.id)}
                            className="text-gray-500 hover:text-red-400 transition-colors p-1.5"
                            title="Remover"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </NutriLayout>
  );
}
