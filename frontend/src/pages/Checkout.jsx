import React, { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, formatApiError } from "@/lib/evo-api";
import GlowOrb from "@/components/evonut/GlowOrb";
import { Copy, CheckCircle2, Upload, Loader2, ArrowRight, X, FileText } from "lucide-react";
import { toast } from "sonner";

const PIX_KEY = "46.786.744/0001-84";
const PIX_NOME = "Rogério Costa Treinamento";

const PLAN_LABELS = {
  "Plano Treino": { emoji: "🏋", desc: "2 meses · Treino personalizado + app" },
  "Plano Nutrição": { emoji: "🥗", desc: "2 meses · Plano alimentar + acompanhamento" },
  "Consultoria Gold": { emoji: "⭐", desc: "2 meses · Treino + Nutrição + Suporte VIP" },
};

function getPlanInfo(plano) {
  if (!plano) return { emoji: "💪", desc: "Consultoria personalizada" };
  const key = Object.keys(PLAN_LABELS).find((k) => plano.toLowerCase().includes(k.toLowerCase()));
  return key ? PLAN_LABELS[key] : { emoji: "💪", desc: "Consultoria personalizada" };
}

export default function Checkout() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [lead, setLead] = useState(null);
  const [copied, setCopied] = useState(false);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!token) { navigate("/"); return; }
    api.get(`/public/lead/${token}`)
      .then((r) => setLead(r.data))
      .catch(() => { toast.error("Link inválido"); navigate("/"); });
  }, [token, navigate]);

  const copyPix = () => {
    navigator.clipboard.writeText(PIX_KEY).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      toast.success("Chave PIX copiada!");
    });
  };

  const handleFile = (f) => {
    if (!f) return;
    const ok = f.type.startsWith("image/") || f.type === "application/pdf";
    if (!ok) { toast.error("Envie uma imagem (JPG, PNG) ou PDF"); return; }
    if (f.size > 10 * 1024 * 1024) { toast.error("Arquivo maior que 10MB"); return; }
    setFile(f);
  };

  const submit = async () => {
    if (!file) { toast.error("Anexe o comprovante antes de continuar"); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await api.post(`/public/checkout/${token}/comprovante`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setDone(true);
      setTimeout(() => navigate(`/pre-consulta/${token}`), 1800);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setUploading(false);
    }
  };

  const plano = lead?.atendimento_dados?.plano_escolhido || "Consultoria";
  const planInfo = getPlanInfo(plano);
  const nome = lead?.nome || "";

  if (!lead) {
    return (
      <div className="min-h-screen bg-rc-ink flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-rc-blue" />
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen bg-rc-ink flex items-center justify-center px-4">
        <div className="text-center animate-fade-up">
          <div className="w-20 h-20 rounded-full bg-emerald-400/10 border-2 border-emerald-400/40 flex items-center justify-center mx-auto mb-5">
            <CheckCircle2 className="w-9 h-9 text-emerald-400" />
          </div>
          <h2 className="rc-h2 mb-2">Comprovante recebido!</h2>
          <p className="text-gray-400 text-sm">Redirecionando para a ficha pré-consulta…</p>
          <div className="mt-4 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-rc-blue" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-rc-ink relative overflow-hidden">
      <GlowOrb color="#0081FD" size={500} top="-15%" left="-10%" opacity={0.12} />
      <GlowOrb color="#0066CC" size={380} top="60%" left="70%" opacity={0.1} />
      <div className="absolute inset-0 rc-grid-bg pointer-events-none" />

      <div className="relative z-10 max-w-lg mx-auto px-4 py-10">
        {/* Header */}
        <div className="text-center mb-8 animate-fade-up">
          <div className="text-[10px] text-rc-blue uppercase tracking-[0.3em] font-bold mb-3">Finalizar inscrição</div>
          <h1 className="rc-h2 text-2xl sm:text-3xl mb-1">
            {nome ? `Quase lá, ${nome.split(" ")[0]}!` : "Quase lá!"}
          </h1>
          <p className="text-gray-400 text-sm">Realize o pagamento via PIX e envie o comprovante para confirmar.</p>
        </div>

        {/* Plano escolhido */}
        <div className="rc-card p-5 mb-5 border-rc-blue/30 animate-fade-up" style={{ animationDelay: "60ms" }}>
          <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-3">Plano selecionado</div>
          <div className="flex items-center gap-3">
            <span className="text-3xl">{planInfo.emoji}</span>
            <div>
              <p className="font-bold text-base text-white">{plano}</p>
              <p className="text-xs text-gray-400 mt-0.5">{planInfo.desc}</p>
            </div>
            <div className="ml-auto">
              <span className="text-[10px] font-bold uppercase tracking-wider bg-rc-blue/10 text-rc-blue border border-rc-blue/30 px-2.5 py-1 rounded-full">
                Confirmado
              </span>
            </div>
          </div>
        </div>

        {/* PIX */}
        <div className="rc-card p-5 mb-5 animate-fade-up" style={{ animationDelay: "120ms" }}>
          <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-4">Pagamento via PIX</div>

          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-emerald-400/10 border border-emerald-400/30 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-emerald-400" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12.0002 1.5C6.20136 1.5 1.5 6.20136 1.5 12.0002C1.5 17.7991 6.20136 22.5 12.0002 22.5C17.7991 22.5 22.5 17.7991 22.5 12.0002C22.5 6.20136 17.7991 1.5 12.0002 1.5ZM9.35352 7.02991L12.0002 9.67664L14.6469 7.02991C15.0374 6.63941 15.6706 6.63941 16.0611 7.02991L16.9703 7.93909C17.3608 8.3296 17.3608 8.96275 16.9703 9.35325L14.3236 12.0002L16.9703 14.647C17.3608 15.0375 17.3608 15.6706 16.9703 16.0611L16.0611 16.9703C15.6706 17.3608 15.0374 17.3608 14.6469 16.9703L12.0002 14.3236L9.35352 16.9703C8.963 17.3608 8.32985 17.3608 7.93934 16.9703L7.03016 16.0611C6.63966 15.6706 6.63966 15.0375 7.03016 14.647L9.67689 12.0002L7.03016 9.35325C6.63966 8.96275 6.63966 8.3296 7.03016 7.93909L7.93934 7.02991C8.32985 6.63941 8.963 6.63941 9.35352 7.02991Z"/>
              </svg>
            </div>
            <div>
              <p className="text-xs text-gray-500 font-bold uppercase tracking-wider">Beneficiário</p>
              <p className="text-sm font-bold text-white">{PIX_NOME}</p>
            </div>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-2">Chave PIX · CNPJ</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-rc-surfaceAlt border border-white/[0.08] rounded-lg px-4 py-3">
                <span className="font-mono text-base font-bold text-rc-blue tracking-wider">{PIX_KEY}</span>
              </div>
              <button
                onClick={copyPix}
                className={`flex-shrink-0 h-12 w-12 rounded-lg border flex items-center justify-center transition-all ${
                  copied
                    ? "bg-emerald-400/10 border-emerald-400/40 text-emerald-400"
                    : "bg-white/[0.04] border-white/[0.08] text-gray-400 hover:border-rc-blue/40 hover:text-rc-blue"
                }`}
                title="Copiar chave PIX"
              >
                {copied ? <CheckCircle2 className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
              </button>
            </div>
            <p className="text-[11px] text-gray-500 mt-2">
              Abra o app do seu banco → PIX → Pagar com chave → Cole a chave CNPJ acima.
            </p>
          </div>
        </div>

        {/* Comprovante */}
        <div className="rc-card p-5 mb-6 animate-fade-up" style={{ animationDelay: "180ms" }}>
          <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-4">
            Comprovante de pagamento
          </div>

          {!file ? (
            <label className="block cursor-pointer">
              <div className="border-2 border-dashed border-white/[0.1] hover:border-rc-blue/40 rounded-xl p-8 flex flex-col items-center gap-3 transition-colors text-gray-400 hover:text-rc-blue">
                <Upload className="w-8 h-8" />
                <div className="text-center">
                  <p className="text-sm font-bold uppercase tracking-wider">Anexar comprovante</p>
                  <p className="text-xs mt-1 text-gray-600">JPG, PNG ou PDF · máx. 10MB</p>
                </div>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
            </label>
          ) : (
            <div className="flex items-center gap-3 bg-emerald-400/[0.06] border border-emerald-400/20 rounded-xl px-4 py-3">
              <FileText className="w-5 h-5 text-emerald-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white truncate">{file.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">{(file.size / 1024).toFixed(0)} KB</p>
              </div>
              <button
                onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ""; }}
                className="text-gray-500 hover:text-red-400 transition-colors p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Submit */}
        <button
          onClick={submit}
          disabled={uploading || !file}
          className="rc-btn-primary w-full text-base py-3.5 animate-fade-up"
          style={{ animationDelay: "240ms" }}
        >
          {uploading
            ? <><Loader2 className="w-5 h-5 animate-spin" /> Enviando…</>
            : <><CheckCircle2 className="w-5 h-5" /> Confirmar pagamento <ArrowRight className="w-4 h-4" /></>
          }
        </button>

        <p className="text-center text-xs text-gray-600 mt-4">
          Após a confirmação do pagamento, você será redirecionado para preencher sua ficha pré-consulta.
        </p>
      </div>
    </div>
  );
}
