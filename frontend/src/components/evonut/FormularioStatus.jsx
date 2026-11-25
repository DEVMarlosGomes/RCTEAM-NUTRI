import React, { useEffect, useState } from "react";
import { AlertTriangle, Copy, MessageCircle, RotateCcw, Send } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/evo-api";
import { respostasPlanas } from "@/lib/anamnese";

/**
 * Topo da Anamnese (ajustes do Rogério): status do formulário com data da resposta, Reenviar formulário /
 * Enviar retorno, resumo com alertas (lesão, medicação, alergia, sono, intestino, exames), fotos do formulário
 * e os questionários de retorno respondidos.
 */
const dataBR = (v) => (v ? new Date(v).toLocaleDateString("pt-BR") : "");
const negativo = (v) => /^\s*(n[ãa]o|nenhum[a]?|nada|n\/a|-)\b/i.test(String(v || ""));
const texto = (v) => (Array.isArray(v) ? v.join(", ") : String(v ?? "")).trim();

export function alertasDaAnamnese(planas) {
  const a = [];
  const add = (rotulo, valor, grave = true) => { if (texto(valor) && !negativo(valor)) a.push({ rotulo, valor: texto(valor), grave }); };
  add("Lesão / restrição", planas.lesoes);
  const doencas = (Array.isArray(planas.doencas) ? planas.doencas : [planas.doencas]).filter((x) => x && x !== "Nenhuma" && x !== "Outra");
  add("Doenças", [...doencas, planas.doencas_outras].filter(Boolean).join(", "));
  add("Medicação", planas.medicacao);
  add("Alergia / intolerância", planas.alergias);
  add("Esteroides", planas.esteroides);
  if (planas.gestante_lactante === "Sim") a.push({ rotulo: "Gestante ou amamentando", valor: "Sim", grave: true });
  const sono = (Array.isArray(planas.sono) ? planas.sono : []).filter((x) => !/boa qualidade/i.test(x));
  if (sono.length) a.push({ rotulo: "Sono", valor: sono.join(", "), grave: false });
  if (planas.intestino && !/^Bem/i.test(planas.intestino)) a.push({ rotulo: "Intestino", valor: planas.intestino, grave: false });
  if (planas.exames_recentes === "Não") a.push({ rotulo: "Exames", valor: "Sem exames de sangue nos últimos 6 meses", grave: false });
  else if (planas.exames_recentes === "Sim") {
    const n = (planas.exames_arquivos || []).length;
    a.push({ rotulo: "Exames", valor: n ? `${n} arquivo(s) anexado(s): veja a aba Exames` : "Fez exames, mas não anexou", grave: !n });
  }
  return a;
}

export default function FormularioStatus({ d, reload }) {
  const p = d.patient;
  const anam = d.anamnese_v2 || {};
  const planas = respostasPlanas(anam.formulario);
  const f = p.formulario || (p.preconsulta_enviada_em ? { tipo: "inicial", estado: "respondido", respondido_em: p.preconsulta_enviada_em } : { tipo: "inicial", estado: "aberto" });
  const alertas = alertasDaAnamnese(planas);
  const retornos = [...(anam.retornos || [])].reverse();
  const [fotos, setFotos] = useState([]);
  const [enviando, setEnviando] = useState("");

  useEffect(() => {
    api.get(`/patients/${p.id}/fotos-avaliacoes`).then((r) => setFotos((r.data || []).filter((x) => x.origem === "formulario" || x.avaliacao_id === "preconsulta"))).catch(() => {});
  }, [p.id]);

  const enviar = async (tipo) => {
    if (tipo === "inicial" && f.estado === "respondido" && !window.confirm("Reenviar o formulário? O paciente poderá responder de novo pelo mesmo link.")) return;
    setEnviando(tipo);
    try {
      const { data } = await api.post(`/patients/${p.id}/formulario/enviar`, { tipo });
      const link = `${window.location.origin}/pre-consulta/${data.token}`;
      try { await navigator.clipboard.writeText(link); } catch { /* sem área de transferência */ }
      const msg = tipo === "retorno"
        ? `Oi, ${(p.nome || "").split(" ")[0]}! Antes da nossa reavaliação, responde este questionário rápido de retorno: ${link}`
        : `Oi, ${(p.nome || "").split(" ")[0]}! Segue o link do formulário pré-consulta: ${link}`;
      const fone = String(p.telefone || "").replace(/\D/g, "");
      if (fone) window.open(`https://wa.me/${fone.length <= 11 ? `55${fone}` : fone}?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
      toast.success(`${tipo === "retorno" ? "Questionário de retorno liberado" : "Formulário liberado de novo"}. Link copiado.`);
      reload?.();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); } finally { setEnviando(""); }
  };

  const rotuloEstado = f.estado === "respondido"
    ? `${f.tipo === "retorno" ? "Retorno" : "Formulário"} respondido em ${dataBR(f.respondido_em)}`
    : f.tipo === "retorno" ? `Retorno enviado em ${dataBR(f.enviado_em)} · aguardando resposta` : f.enviado_em ? `Formulário reenviado em ${dataBR(f.enviado_em)} · aguardando resposta` : "Aguardando o formulário pré-consulta";

  return (
    <section className="rc-card p-5 space-y-4" data-testid="formulario-status">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`inline-flex h-2.5 w-2.5 rounded-full ${f.estado === "respondido" ? "bg-rc-lime" : "bg-rc-amber"}`} />
        <span className="text-[14px] font-semibold text-white" data-testid="formulario-estado">{rotuloEstado}</span>
        {anam.consentimento_lgpd_em && <span className="text-[11.5px] text-gray-500">LGPD aceito em {dataBR(anam.consentimento_lgpd_em)}</span>}
        <div className="ml-auto flex flex-wrap gap-2">
          <button type="button" onClick={() => enviar("inicial")} disabled={!!enviando} className="rc-btn-secondary h-9" data-testid="reenviar-formulario"><RotateCcw className="h-4 w-4" /> Reenviar formulário</button>
          <button type="button" onClick={() => enviar("retorno")} disabled={!!enviando} className="rc-btn-primary h-9" data-testid="enviar-retorno"><Send className="h-4 w-4" /> Enviar retorno</button>
          {p.lead_token && (
            <button type="button" className="rc-btn-ghost h-9" title="Copiar o link do formulário" aria-label="Copiar o link do formulário"
              onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/pre-consulta/${p.lead_token}`).then(() => toast.success("Link copiado."), () => {})}>
              <Copy className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {alertas.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" data-testid="alertas-anamnese">
          {alertas.map((a) => (
            <div key={a.rotulo} className={`flex gap-2.5 rounded-xl px-3 py-2.5 ring-1 ${a.grave ? "bg-rc-coral/[0.08] ring-rc-coral/25" : "bg-rc-amber/[0.07] ring-rc-amber/20"}`}>
              <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${a.grave ? "text-rc-coral" : "text-rc-amber"}`} />
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-[0.12em] text-gray-400">{a.rotulo}</div>
                <div className="text-[13px] text-gray-100 leading-snug">{a.valor}</div>
              </div>
            </div>
          ))}
        </div>
      ) : f.estado === "respondido" && <p className="text-[13px] text-gray-400">Sem alertas nas respostas (lesão, medicação, alergia, sono, intestino e exames).</p>}

      {fotos.length > 0 && (
        <div>
          <div className="mb-2 text-[11px] uppercase tracking-[0.12em] text-gray-500">Fotos enviadas pelo formulário</div>
          <div className="flex flex-wrap gap-2">
            {fotos.map((x) => (
              <a key={x.id} href={x.data_url} target="_blank" rel="noreferrer" className="block w-20 overflow-hidden rounded-lg ring-1 ring-white/[0.08]" title={`${x.pose} · ${x.avaliacao_id}`}>
                <img src={x.data_url} alt={`Foto ${x.pose}`} className="aspect-[3/4] w-full object-cover" />
              </a>
            ))}
          </div>
        </div>
      )}

      {retornos.length > 0 && (
        <details className="rounded-xl bg-white/[0.02] ring-1 ring-white/[0.06]" open>
          <summary className="cursor-pointer px-4 py-3 text-[13px] font-semibold text-white"><MessageCircle className="mr-2 inline h-4 w-4 text-rc-blueLight" />Questionários de retorno ({retornos.length})</summary>
          <div className="space-y-4 px-4 pb-4">
            {retornos.map((r) => (
              <div key={r.id} className="border-t border-white/[0.06] pt-3">
                <div className="mb-2 text-[12px] text-gray-400">Respondido em {dataBR(r.respondido_em)}</div>
                <dl className="grid gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2">
                  {Object.entries(ROTULOS_RETORNO).filter(([k]) => r.respostas?.[k] != null && r.respostas[k] !== "" && k !== "ret_fotos").map(([k, l]) => (
                    <div key={k}><dt className="text-gray-500">{l}</dt><dd className="text-gray-100">{texto(r.respostas[k])}</dd></div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

const ROTULOS_RETORNO = {
  ret_peso: "Peso hoje (kg)", ret_adesao: "Seguiu o plano (0 a 10)", ret_treino: "Seguiu o treino (0 a 10)", ret_dificuldades: "Mais difícil",
  ret_fome: "Fome", ret_intestino: "Intestino", ret_sono: "Sono e disposição", ret_mudancas: "Mudanças", ret_gostaria: "Gostaria de mudar",
};
