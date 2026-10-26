import React, { useEffect, useState } from "react";
import { MessageCircle, Save, X } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/evo-api";

export const PLANOS_PADRAO = [
  { plano: "Plano Treino", duracao_meses: 2 },
  { plano: "Plano Nutrição", duracao_meses: 2 },
  { plano: "Consultoria Gold", duracao_meses: 2 },
];

export const FORMAS_PAGAMENTO = [
  ["pix", "PIX"],
  ["cartao_credito", "Cartão de crédito"],
  ["cartao_debito", "Cartão de débito"],
  ["dinheiro", "Dinheiro"],
  ["transferencia", "Transferência"],
  ["boleto", "Boleto"],
  ["outro", "Outro"],
];

export const FORMA_LABEL = Object.fromEntries(FORMAS_PAGAMENTO);

const STATUS_STYLE = {
  vencido: "bg-rc-coral/[0.14] text-rc-coral",
  vencendo: "bg-rc-amber/[0.13] text-rc-amber",
  em_dia: "bg-rc-lime/[0.12] text-rc-lime",
  sem_plano: "bg-white/[0.06] text-gray-400",
  cancelado: "bg-white/[0.06] text-gray-500",
};

export const moeda = (valor) => Number(valor || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const dataBR = (iso) => {
  if (!iso) return "–";
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString("pt-BR");
};

export const hojeISO = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export const somarMesesISO = (iso, meses) => {
  const [y, m, d] = iso.split("-").map(Number);
  const alvo = new Date(y, m - 1 + meses, 1);
  const ultimoDia = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
  alvo.setDate(Math.min(d, ultimoDia));
  return `${alvo.getFullYear()}-${String(alvo.getMonth() + 1).padStart(2, "0")}-${String(alvo.getDate()).padStart(2, "0")}`;
};

export function textoPrazo(aluno) {
  const { status, dias } = aluno;
  if (status === "sem_plano") return "Sem plano";
  if (status === "cancelado") return "Cancelado";
  if (dias < 0) return `Venceu há ${-dias} ${dias === -1 ? "dia" : "dias"}`;
  if (dias === 0) return "Vence hoje";
  if (dias === 1) return "Vence amanhã";
  return `Vence em ${dias} dias`;
}

export function PlanoStatusBadge({ aluno }) {
  return (
    <span className={`rc-chip whitespace-nowrap ${STATUS_STYLE[aluno.status] || STATUS_STYLE.sem_plano}`}>
      <span className="w-1.5 h-1.5 rounded-[2px] bg-current" />
      {textoPrazo(aluno)}
    </span>
  );
}

function telefoneWhatsApp(telefone) {
  const digitos = String(telefone || "").replace(/\D/g, "");
  if (!digitos) return null;
  return digitos.length <= 11 ? `55${digitos}` : digitos;
}

export function mensagemCobranca(aluno) {
  const nome = (aluno.nome || "").trim().split(/\s+/)[0] || "";
  const a = aluno.assinatura || {};
  const venc = dataBR(a.vencimento);
  const prazo = aluno.dias < 0 ? `venceu em ${venc}` : aluno.dias === 0 ? "vence hoje" : `vence em ${venc}`;
  const valor = a.valor ? ` (${moeda(a.valor)})` : "";
  return `Olá, ${nome}! Tudo bem? Passando para lembrar que o seu ${a.plano || "plano"} ${prazo}${valor}. `
    + "Para renovar e seguir no acompanhamento, é só me responder por aqui. — Rogério Costa";
}

// Abre o WhatsApp com a mensagem pronta e registra a cobrança no histórico do aluno.
export async function cobrarPorWhatsApp(aluno) {
  const fone = telefoneWhatsApp(aluno.telefone);
  if (!fone) {
    toast.error("Aluno sem telefone cadastrado.");
    return false;
  }
  window.open(`https://wa.me/${fone}?text=${encodeURIComponent(mensagemCobranca(aluno))}`, "_blank", "noopener");
  try {
    await api.post(`/patients/${aluno.id}/cobranca`, { canal: "whatsapp" });
    return true;
  } catch (error) {
    toast.error(formatApiError(error.response?.data?.detail));
    return false;
  }
}

export function CobrarButton({ aluno, onDone, compact = false }) {
  const [busy, setBusy] = useState(false);
  const click = async () => {
    setBusy(true);
    const ok = await cobrarPorWhatsApp(aluno);
    setBusy(false);
    if (ok) onDone?.();
  };
  return (
    <button type="button" onClick={click} disabled={busy} className={`rc-btn-secondary ${compact ? "px-2.5 py-1.5 text-[12.5px]" : ""}`}>
      <MessageCircle className="w-3.5 h-3.5" strokeWidth={1.75} /> Cobrar
    </button>
  );
}

function Modal({ title, subtitle, onClose, children }) {
  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="rc-card w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-b-none sm:rounded-2xl animate-fade-up"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div>
            <h2 className="rc-h3">{title}</h2>
            {subtitle && <p className="text-[12.5px] text-gray-500 mt-1">{subtitle}</p>}
          </div>
          <button type="button" aria-label="Fechar" onClick={onClose} className="rc-btn-ghost p-2 -mr-2"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function Campo({ label, children }) {
  return (
    <label className="block">
      <span className="rc-label">{label}</span>
      {children}
    </label>
  );
}

export function PlanoModal({ aluno, onClose, onSaved }) {
  const atual = aluno.assinatura?.ativo === false ? {} : aluno.assinatura || {};
  const [form, setForm] = useState({
    plano: atual.plano || PLANOS_PADRAO[0].plano,
    valor: atual.valor ?? "",
    duracao_meses: atual.duracao_meses || PLANOS_PADRAO[0].duracao_meses,
    inicio: atual.inicio || hojeISO(),
    vencimento: atual.vencimento || somarMesesISO(hojeISO(), atual.duracao_meses || PLANOS_PADRAO[0].duracao_meses),
    observacao: atual.observacao || "",
  });
  const [saving, setSaving] = useState(false);
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const escolherPreset = (preset) => setForm((f) => ({
    ...f,
    plano: preset.plano,
    duracao_meses: preset.duracao_meses,
    vencimento: somarMesesISO(f.inicio || hojeISO(), preset.duracao_meses),
  }));

  const save = async () => {
    if (!form.plano.trim() || form.valor === "" || !form.vencimento) {
      toast.error("Informe plano, valor e vencimento.");
      return;
    }
    setSaving(true);
    try {
      await api.put(`/patients/${aluno.id}/assinatura`, {
        ...form,
        valor: Number(String(form.valor).replace(",", ".")),
        duracao_meses: Number(form.duracao_meses),
      });
      toast.success("Plano salvo.");
      onSaved?.();
      onClose();
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={atual.plano ? "Editar plano" : "Cadastrar plano"} subtitle={aluno.nome} onClose={onClose}>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {PLANOS_PADRAO.map((preset) => (
          <button
            key={preset.plano}
            type="button"
            onClick={() => escolherPreset(preset)}
            className={`rc-chip py-1 px-2.5 transition-colors ${form.plano === preset.plano ? "bg-rc-lime/[0.14] text-rc-lime" : "bg-white/[0.05] text-gray-300 hover:bg-white/[0.09]"}`}
          >
            {preset.plano}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Campo label="Plano"><input className="rc-input" value={form.plano} onChange={(e) => set("plano", e.target.value)} /></Campo></div>
        <Campo label="Valor (R$)"><input className="rc-input" inputMode="decimal" value={form.valor} onChange={(e) => set("valor", e.target.value)} placeholder="0,00" /></Campo>
        <Campo label="Duração (meses)">
          <input
            className="rc-input"
            type="number"
            min="1"
            max="24"
            value={form.duracao_meses}
            onChange={(e) => {
              const meses = Number(e.target.value) || 1;
              setForm((f) => ({ ...f, duracao_meses: e.target.value, vencimento: somarMesesISO(f.inicio || hojeISO(), meses) }));
            }}
          />
        </Campo>
        <Campo label="Início">
          <input
            className="rc-input"
            type="date"
            value={form.inicio}
            onChange={(e) => setForm((f) => ({ ...f, inicio: e.target.value, vencimento: e.target.value ? somarMesesISO(e.target.value, Number(f.duracao_meses) || 1) : f.vencimento }))}
          />
        </Campo>
        <Campo label="Vencimento"><input className="rc-input" type="date" value={form.vencimento} onChange={(e) => set("vencimento", e.target.value)} /></Campo>
        <div className="col-span-2"><Campo label="Observação"><input className="rc-input" value={form.observacao} onChange={(e) => set("observacao", e.target.value)} placeholder="Ex.: desconto de indicação" /></Campo></div>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button type="button" onClick={onClose} className="rc-btn-ghost">Cancelar</button>
        <button type="button" onClick={save} disabled={saving} className="rc-btn-primary"><Save className="w-4 h-4" />{saving ? "Salvando..." : "Salvar plano"}</button>
      </div>
    </Modal>
  );
}

export function PagamentoModal({ aluno, onClose, onSaved }) {
  const assinatura = aluno.assinatura || {};
  const temPlano = Boolean(assinatura.plano) && assinatura.ativo !== false;
  const [form, setForm] = useState({
    valor: assinatura.valor ?? "",
    data_pagamento: hojeISO(),
    forma: "pix",
    observacao: "",
    renovar: temPlano,
  });
  const [saving, setSaving] = useState(false);
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  // Mesma regra do backend: pagou antes de vencer mantém o ciclo; atrasado recomeça na data do pagamento.
  const previsto = (() => {
    if (!form.renovar || !temPlano || !form.data_pagamento) return null;
    const base = assinatura.vencimento && assinatura.vencimento >= form.data_pagamento ? assinatura.vencimento : form.data_pagamento;
    return somarMesesISO(base, Number(assinatura.duracao_meses) || 1);
  })();

  const save = async () => {
    const valor = Number(String(form.valor).replace(",", "."));
    if (!valor || valor <= 0) {
      toast.error("Informe o valor recebido.");
      return;
    }
    setSaving(true);
    try {
      await api.post(`/patients/${aluno.id}/pagamentos`, { ...form, valor });
      toast.success(previsto ? `Pagamento registrado. Novo vencimento: ${dataBR(previsto)}.` : "Pagamento registrado.");
      onSaved?.();
      onClose();
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Registrar pagamento" subtitle={`${aluno.nome}${temPlano ? ` · ${assinatura.plano}` : ""}`} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Campo label="Valor (R$)"><input className="rc-input" inputMode="decimal" value={form.valor} onChange={(e) => set("valor", e.target.value)} placeholder="0,00" /></Campo>
        <Campo label="Data"><input className="rc-input" type="date" value={form.data_pagamento} onChange={(e) => set("data_pagamento", e.target.value)} /></Campo>
        <div className="col-span-2">
          <Campo label="Forma de pagamento">
            <select className="rc-input" value={form.forma} onChange={(e) => set("forma", e.target.value)}>
              {FORMAS_PAGAMENTO.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Campo>
        </div>
        <div className="col-span-2"><Campo label="Observação"><input className="rc-input" value={form.observacao} onChange={(e) => set("observacao", e.target.value)} /></Campo></div>
      </div>
      {temPlano ? (
        <label className="rc-well flex items-start gap-3 p-3.5 mt-4 cursor-pointer">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#C3F53C]" checked={form.renovar} onChange={(e) => set("renovar", e.target.checked)} />
          <span className="text-[13px] text-gray-300">
            Renovar o plano por {assinatura.duracao_meses || 1} {Number(assinatura.duracao_meses) === 1 ? "mês" : "meses"}
            <span className="block text-[12px] text-gray-500 mt-0.5">
              Vencimento atual {dataBR(assinatura.vencimento)}{previsto ? <> → novo <span className="text-rc-lime">{dataBR(previsto)}</span></> : ""}
            </span>
          </span>
        </label>
      ) : (
        <p className="text-[12.5px] text-gray-500 mt-4">Aluno sem plano ativo: o pagamento fica no histórico, sem renovar vencimento.</p>
      )}
      <div className="flex justify-end gap-2 mt-5">
        <button type="button" onClick={onClose} className="rc-btn-ghost">Cancelar</button>
        <button type="button" onClick={save} disabled={saving} className="rc-btn-primary"><Save className="w-4 h-4" />{saving ? "Salvando..." : "Registrar"}</button>
      </div>
    </Modal>
  );
}
