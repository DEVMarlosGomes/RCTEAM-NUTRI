import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/evo-api";

export const CONFIG_VAZIA = {
  refeicoes_iniciais: 6,
  tabelas_alimentos: [],
  forma_calculo: "medida",
  layout_calculos: "medida_gramas",
  layout_linhas: "iguais",
  incluir_observacoes: true,
  layout_lista_substituicao: "lista",
  incluir_macros_pdf: false,
  objetivos: [],
  titulos: [],
  nomes_refeicao: [],
  refeicoes_padrao: [],
  observacoes_refeicao: [],
  observacoes_alimento: [],
};

let cache = null;

/** Configuracoes da dieta do nutricionista (listas de autocompletar, forma de calculo, layout do PDF). */
export default function useDietaConfig() {
  const [config, setConfig] = useState(cache || CONFIG_VAZIA);

  const recarregar = useCallback(async () => {
    try {
      const { data } = await api.get("/dieta/config");
      cache = { ...CONFIG_VAZIA, ...data };
      setConfig(cache);
    } catch { /* mantem o padrao */ }
    return cache || CONFIG_VAZIA;
  }, []);

  useEffect(() => { if (!cache) recarregar(); }, [recarregar]);

  const salvar = useCallback(async (patch) => {
    const { data } = await api.put("/dieta/config", patch);
    cache = { ...CONFIG_VAZIA, ...data };
    setConfig(cache);
    return cache;
  }, []);

  return { config, recarregar, salvar };
}
