import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/evo-api";
import Dialogo from "./Dialogo";
import Combobox from "./Combobox";
import { nf0 } from "./calculos";
import { payloadDoPlanoSalvo, payloadDoRecordatorio } from "./plano";

const ORIGENS = [
  ["modelos", "Modelos de dieta"],
  ["recordatorio", "Recordatório do paciente"],
  ["outros", "Dietas de outros pacientes"],
];

function Lista({ itens, marcados, setMarcados, rotulo, detalhe, vazio, unico }) {
  if (!itens) return <div className="py-8 flex items-center justify-center gap-2 text-gray-400 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Carregando…</div>;
  if (!itens.length) return <p className="py-6 text-center text-[13px] text-gray-500">{vazio}</p>;
  return (
    <div className="space-y-1">
      {itens.map((it) => (
        <label key={it.id} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 cursor-pointer transition-colors ${marcados[it.id] ? "bg-rc-blue/10" : "hover:bg-white/[0.03]"}`}>
          <input
            type={unico ? "radio" : "checkbox"}
            name="importar-dieta"
            checked={!!marcados[it.id]}
            onChange={() => setMarcados((m) => (unico ? { [it.id]: true } : { ...m, [it.id]: !m[it.id] }))}
            className="accent-[#0081FD] w-4 h-4"
          />
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] text-gray-100 truncate">{rotulo(it)}</span>
            {detalhe && <span className="block text-[12px] text-gray-500 truncate">{detalhe(it)}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}

/** "Importar dieta" do NutriDiet: cria dietas novas a partir de modelos, do recordatório ou de outros pacientes. */
export default function ImportarDieta({ d, onImportado, onClose }) {
  const pid = d.patient.id;
  const [origem, setOrigem] = useState("modelos");
  const [itens, setItens] = useState(null);
  const [marcados, setMarcados] = useState({});
  const [pacientes, setPacientes] = useState([]);
  const [busca, setBusca] = useState("");
  const [outro, setOutro] = useState(null);
  const [importando, setImportando] = useState(false);

  useEffect(() => {
    let ativo = true;
    setItens(null);
    setMarcados({});
    const carregar = async () => {
      if (origem === "modelos") return (await api.get("/plano-templates")).data;
      if (origem === "recordatorio") return (await api.get(`/patients/${pid}/recordatorios`)).data;
      if (!outro) return [];
      return (await api.get(`/patients/${outro.id}/planos-manuais`)).data;
    };
    carregar().then((lista) => { if (ativo) setItens(lista || []); }).catch(() => { if (ativo) setItens([]); });
    return () => { ativo = false; };
  }, [origem, outro, pid]);

  useEffect(() => {
    if (origem !== "outros" || pacientes.length) return;
    api.get("/patients").then(({ data }) => setPacientes((data || []).filter((p) => p.id !== pid))).catch(() => {});
  }, [origem, pacientes.length, pid]);

  const selecionados = (itens || []).filter((it) => marcados[it.id]);

  const importar = async () => {
    if (!selecionados.length) return;
    setImportando(true);
    try {
      let ultimo = null;
      for (const it of selecionados) {
        let resp;
        if (origem === "modelos") resp = await api.post(`/patients/${pid}/plano-templates/${it.id}/aplicar`);
        else if (origem === "recordatorio") resp = await api.post(`/patients/${pid}/planos-manuais`, payloadDoRecordatorio(it));
        else resp = await api.post(`/patients/${pid}/planos-manuais`, payloadDoPlanoSalvo(it, d));
        ultimo = resp.data;
      }
      toast.success(selecionados.length > 1 ? `${selecionados.length} dietas importadas.` : "Dieta importada.");
      onImportado(ultimo?.id);
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail));
    } finally {
      setImportando(false);
    }
  };

  return (
    <Dialogo
      eyebrow="Importar"
      titulo="Importar dieta"
      onClose={onClose}
      largura="sm:max-w-xl"
      rodape={(
        <>
          <button type="button" onClick={onClose} className="rc-btn-secondary">Cancelar</button>
          <button type="button" onClick={importar} disabled={!selecionados.length || importando} className="rc-btn-primary">
            {importando ? "Importando…" : `Importar${selecionados.length ? ` (${selecionados.length})` : ""}`}
          </button>
        </>
      )}
    >
      <label className="rc-label" htmlFor="origem-importacao">Importar de</label>
      <select id="origem-importacao" className="rc-input h-10 mb-4" value={origem} onChange={(e) => { setOrigem(e.target.value); setOutro(null); setBusca(""); }}>
        {ORIGENS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>

      {origem === "outros" && (
        <div className="mb-4">
          <label className="rc-label" htmlFor="outro-paciente">Paciente</label>
          <Combobox
            id="outro-paciente"
            value={busca}
            onChange={(v) => { setBusca(v); if (outro && v !== outro.nome) setOutro(null); }}
            opcoes={pacientes}
            rotulo={(p) => p.nome || ""}
            valorDe={(p) => p.nome || ""}
            onSelect={setOutro}
            placeholder="Digite o nome do paciente"
            inputClassName="rc-input h-10"
          />
        </div>
      )}

      {(origem !== "outros" || outro) && (
        <Lista
          itens={itens}
          marcados={marcados}
          setMarcados={setMarcados}
          unico={origem === "recordatorio"}
          vazio={origem === "modelos" ? "Nenhum modelo de dieta salvo. Use a estrela no topo da dieta para criar um." : origem === "recordatorio" ? "Este paciente não tem recordatório." : "Este paciente não tem dietas."}
          rotulo={(it) => (origem === "modelos" ? it.nome : origem === "recordatorio" ? `Recordatório de ${it.data ? new Date(`${String(it.data).slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "data não informada"}` : it.titulo || "Dieta")}
          detalhe={(it) => {
            const refs = (it.refeicoes || []).length;
            if (origem === "outros") return `${refs} refeições · ${nf0.format(it.totais_dia?.energia_kcal || 0)} kcal`;
            return `${refs} refeições${it.objetivo ? ` · ${it.objetivo}` : ""}`;
          }}
        />
      )}
    </Dialogo>
  );
}
