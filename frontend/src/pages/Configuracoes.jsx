import React, { useEffect, useRef, useState } from "react";
import NutriLayout from "@/components/evonut/NutriLayout";
import { api, formatApiError } from "@/lib/evo-api";
import { toast } from "sonner";
import { Upload, Save, Download } from "lucide-react";

export default function Configuracoes() {
  const [cfg, setCfg] = useState(null);
  const [form, setForm] = useState({ crn: "", especialidade: "", clinica_nome: "", clinica_endereco: "", telefone_clinica: "", site: "" });
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const fileRef = useRef(null);

  const load = async () => {
    try {
      const { data } = await api.get("/configuracoes");
      setCfg(data);
      setForm({
        crn: data.crn || "",
        especialidade: data.especialidade || "",
        clinica_nome: data.clinica_nome || "",
        clinica_endereco: data.clinica_endereco || "",
        telefone_clinica: data.telefone_clinica || "",
        site: data.site || "",
      });
    } catch (e) {
      toast.error("Erro ao carregar configurações");
    }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.put("/configuracoes", form);
      setCfg(data);
      toast.success("Configurações salvas!");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Erro ao salvar");
    } finally { setSaving(false); }
  };

  const uploadLogo = async (file) => {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(file.type)) {
      toast.error("Use PNG, JPEG ou WebP"); return;
    }
    setUploadingLogo(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const { data } = await api.post("/configuracoes/logo", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setCfg(prev => ({ ...prev, logo_url: data.logo_url }));
      toast.success("Logo atualizado!");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Erro ao enviar logo");
    } finally {
      setUploadingLogo(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <NutriLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="evo-card p-6">
          <h2 className="evo-h2 mb-1">Configurações</h2>
          <p className="text-sm text-gray-400">Dados do nutricionista e clínica. Estas informações aparecem nos relatórios PDF.</p>
        </div>

        {/* Logo */}
        <div className="evo-card p-6">
          <h3 className="evo-h3 mb-4">Logo da Clínica</h3>
          <div className="flex items-center gap-6 flex-wrap">
            {cfg?.logo_url ? (
              <div className="w-32 h-20 rounded-lg bg-evo-bg border border-white/[0.06] flex items-center justify-center overflow-hidden">
                <img src={cfg.logo_url} alt="Logo" className="max-h-full max-w-full object-contain" />
              </div>
            ) : (
              <div className="w-32 h-20 rounded-lg bg-evo-bg border border-white/[0.06] flex items-center justify-center text-xs text-gray-500">
                Sem logo
              </div>
            )}
            <div className="space-y-2">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e => uploadLogo(e.target.files?.[0])} />
              <button onClick={() => fileRef.current?.click()} disabled={uploadingLogo} className="evo-btn-secondary">
                <Upload className="w-4 h-4" /> {uploadingLogo ? "Enviando..." : "Enviar logo"}
              </button>
              <div className="text-xs text-gray-500">PNG, JPEG ou WebP. Máx 2MB.</div>
            </div>
          </div>
        </div>

        {/* Dados profissionais */}
        <div className="evo-card p-6 space-y-4">
          <h3 className="evo-h3">Dados Profissionais</h3>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="evo-label">CRN</label>
              <input className="evo-input" value={form.crn} onChange={e => set("crn", e.target.value)} placeholder="Ex: CRN-3 12345" />
            </div>
            <div>
              <label className="evo-label">Especialidade</label>
              <input className="evo-input" value={form.especialidade} onChange={e => set("especialidade", e.target.value)} placeholder="Ex: Nutrição Esportiva" />
            </div>
            <div>
              <label className="evo-label">Nome da Clínica</label>
              <input className="evo-input" value={form.clinica_nome} onChange={e => set("clinica_nome", e.target.value)} placeholder="Ex: Clínica NutriSaúde" />
            </div>
            <div>
              <label className="evo-label">Telefone da Clínica</label>
              <input className="evo-input" value={form.telefone_clinica} onChange={e => set("telefone_clinica", e.target.value)} placeholder="(11) 99999-9999" />
            </div>
            <div className="sm:col-span-2">
              <label className="evo-label">Endereço</label>
              <input className="evo-input" value={form.clinica_endereco} onChange={e => set("clinica_endereco", e.target.value)} placeholder="Rua, número, bairro, cidade" />
            </div>
            <div className="sm:col-span-2">
              <label className="evo-label">Site / Redes sociais</label>
              <input className="evo-input" value={form.site} onChange={e => set("site", e.target.value)} placeholder="www.exemplo.com.br" />
            </div>
          </div>
          <button onClick={save} disabled={saving} className="evo-btn-primary">
            <Save className="w-4 h-4" /> {saving ? "Salvando..." : "Salvar configurações"}
          </button>
        </div>

        {/* Relatórios */}
        <div className="evo-card p-6">
          <h3 className="evo-h3 mb-2">Relatórios PDF</h3>
          <p className="text-sm text-gray-400">Os relatórios incluem automaticamente seu logo e CRN. Acesse-os na aba de cada paciente.</p>
          <div className="mt-3 grid sm:grid-cols-3 gap-2 text-xs text-gray-500">
            <div className="p-2 rounded bg-evo-bg border border-white/[0.04]">Relatório de Anamnese</div>
            <div className="p-2 rounded bg-evo-bg border border-white/[0.04]">Relatório Antropométrico</div>
            <div className="p-2 rounded bg-evo-bg border border-white/[0.04]">Relatório de Exames</div>
            <div className="p-2 rounded bg-evo-bg border border-white/[0.04]">Plano Alimentar Manual</div>
          </div>
        </div>
      </div>
    </NutriLayout>
  );
}
