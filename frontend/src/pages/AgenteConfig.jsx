import { useState, useRef, useEffect } from "react";

const DEFAULT_CONFIG = {
  nome_nutricionista: "Rogério Costa",
  nome_agente: "RC Nutri",
  saudacao: "Olá {nome} tudo bem? SEJA MUITO BEM VINDO(A),\n\nVou te explicar todos os detalhes da minha consultoria online.\nAntes eu preciso fazer algumas perguntas para ver se essa consultoria serve para você, ok?",
  objetivo_pergunta: "Qual perfil e objetivo abaixo que você se encaixa atualmente?",
  objetivos: [
    { id: "hipertrofia", label: "Quero ganhar massa e volume muscular" },
    { id: "emagrecimento", label: "Quero perder barriga, definir o corpo e emagrecer sem flacidez" },
    { id: "manutencao", label: "Apenas manutenção da saúde, sem fins estéticos" },
  ],
  detalhes_pergunta: "Agora compreendi perfeitamente seu objetivo 😊\n\nVou te ajudar nessa jornada! 👊 Últimos detalhes para eu entender 100% se meu método pode te ajudar!",
  perguntas_detalhes: [
    "Qual sua idade, peso e altura ATUAL?",
    "Você já teve alguma experiencia com consultoria de treino e acompanhamento nutricional?",
    "Qual sua maior dificuldade em atingir o objetivo?",
  ],
  corpo_pergunta: "Perfeito, obrigado pelas informações, só me diz mais uma coisa!",
  corpo_instrucoes: [
    "Qual das imagens abaixo representa seu corpo HOJE?",
    "Qual imagem representa o CORPO que você DESEJA TER?",
  ],
  faixas_gordura: [
    { id: 1, label: "10-12%", descricao: "Muito definido, músculos aparentes" },
    { id: 2, label: "15-17%", descricao: "Boa definição, forma atlética" },
    { id: 3, label: "20-22%", descricao: "Forma saudável, pouca definição" },
    { id: 4, label: "25%", descricao: "Acima do ideal, pouca tonicidade" },
    { id: 5, label: "30%", descricao: "Sobrepeso moderado" },
    { id: 6, label: "35%", descricao: "Sobrepeso significativo" },
    { id: 7, label: "40%", descricao: "Obesidade moderada" },
    { id: 8, label: "45%", descricao: "Obesidade severa" },
    { id: 9, label: "50%+", descricao: "Obesidade mórbida" },
  ],
  oferta_titulo: "COMO FUNCIONA A CONSULTORIA FITNESS GOLD 🏆",
  oferta_beneficios: [
    "🏋 AVALIAÇÃO FÍSICA/ CONSULTA - para traçar a melhor estratégia\nNesta avaliação irei fazer uma análise do seu condicionamento físico atual e rotina, para o planejamento perfeito",
    "📱 ACESSO EXCLUSIVO AO APP\nAplicativo com vídeos ensinando a forma correta de fazer cada exercício + Pdf com planejamento nutricional 🍎🥗",
    "💎 MEU SUPORTE VIP e ILIMITADO\nAcesso ao meu WhatsApp particular para tirar dúvidas sempre que você precisar.",
    "✅ FEEDBACK SEMANAL para um acompanhamento mais próximo e possíveis ajustes do planejamento",
  ],
  oferta_pergunta: "É esse tipo de acompanhamento PERSONALIZADO que você está procurando?\n\nPois já vou te passar o valor promocional",
  planos: [
    { id: "treino", nome: "Plano Treino", duracao: "2 meses de acompanhamento", preco: "", desconto: "", destaque: false },
    { id: "nutricao", nome: "Plano Nutrição", duracao: "2 meses de acompanhamento", preco: "", desconto: "", destaque: false },
    { id: "gold", nome: "Consultoria Gold", duracao: "2 meses de acompanhamento", preco: "", desconto: "10%", destaque: true },
  ],
  urgencia: "Restam apenas {vagas} vagas para a consultoria Gold Fitness mês, oferta válida até o dia {data} ou enquanto durarem as vagas",
  planos_pergunta: "Qual plano fica melhor para você? 😊",
  encerramento: "Perfeito, ótima escolha! 🎉\n\nJá vou processar suas informações e entrar em contato para finalizar sua inscrição.\n\nFique de olho no seu WhatsApp 📱",
  tom: "motivador",
  instrucoes_extra: "Seja empático, motivador e use linguagem informal mas profissional. Sempre valide as respostas do paciente antes de prosseguir. Use emojis moderadamente.",
};

const TOM_OPTIONS = [
  { value: "motivador", label: "Motivador & Energético" },
  { value: "clinico", label: "Clínico & Profissional" },
  { value: "amigavel", label: "Amigável & Descontraído" },
  { value: "premium", label: "Premium & Exclusivo" },
];

function buildSystemPrompt(config) {
  return `Você é ${config.nome_agente}, o assistente de primeiro contato do nutricionista e treinador ${config.nome_nutricionista}.

Seu objetivo é realizar o primeiro contato com o potencial paciente, coletar informações essenciais, qualificá-lo e apresentar os planos da consultoria.

Tom de comunicação: ${config.tom}
${config.instrucoes_extra}

FLUXO OBRIGATÓRIO DA CONVERSA (siga exatamente esta ordem):

ETAPA 1 - SAUDAÇÃO:
Use exatamente este texto adaptando {nome} com o nome do paciente:
"${config.saudacao}"

Depois pergunte: "${config.objetivo_pergunta}"
Apresente as opções:
${config.objetivos.map((o, i) => `${i + 1}. ${o.label}`).join("\n")}

ETAPA 2 - DETALHES PESSOAIS:
Após o paciente escolher o objetivo, responda com:
"${config.detalhes_pergunta}"

Pergunte as seguintes informações (pode ser em uma mensagem só):
${config.perguntas_detalhes.map((p, i) => `${i + 1}. ${p}`).join("\n")}

ETAPA 3 - AVALIAÇÃO CORPORAL:
Após coletar os detalhes, diga:
"${config.corpo_pergunta}"

Instrua o paciente:
${config.corpo_instrucoes.map((c, i) => `${i + 1}. ${c}`).join("\n")}

Explique as faixas de percentual de gordura disponíveis (1 a 9):
${config.faixas_gordura.map((f) => `Faixa ${f.id} (${f.label}): ${f.descricao}`).join("\n")}

Peça que o paciente informe o número da faixa que representa seu corpo ATUAL e o número que representa onde quer CHEGAR.

ETAPA 4 - APRESENTAÇÃO DA OFERTA:
Após coletar as informações corporais, apresente a consultoria com entusiasmo:

"${config.oferta_titulo}

${config.oferta_beneficios.join("\n\n")}

${config.oferta_pergunta}"

Em seguida, apresente os planos disponíveis:
${config.planos.map((p) => `- ${p.nome}${p.duracao ? ` (${p.duracao})` : ""}${p.preco ? `: ${p.preco}` : ""}${p.desconto ? ` — ${p.desconto} de desconto` : ""}${p.destaque ? " ⭐ MAIS POPULAR" : ""}`).join("\n")}

Crie urgência informando:
"${config.urgencia}"

Finalize com:
"${config.planos_pergunta}"

ETAPA 5 - ENCERRAMENTO:
Após o paciente escolher um plano, envie:
"${config.encerramento}"

REGRAS IMPORTANTES:
- Nunca pule etapas
- Sempre valide e reconheça a resposta do paciente antes de avançar
- Mantenha o contexto de tudo que o paciente disse
- Na etapa 4, seja entusiasmado e apresente os benefícios de forma envolvente
- Registre mentalmente: nome, objetivo, idade/peso/altura, experiência prévia, maior dificuldade, corpo atual (faixa), corpo desejado (faixa), plano escolhido
- Ao final do fluxo, faça um RESUMO interno de todos os dados coletados em formato JSON assim:
DADOS_COLETADOS: {"nome": "", "objetivo": "", "idade": "", "peso": "", "altura": "", "experiencia_previa": "", "maior_dificuldade": "", "gordura_atual_faixa": "", "gordura_desejada_faixa": "", "plano_escolhido": ""}

Seja caloroso, motivador e faça o paciente sentir que está recebendo atenção personalizada.`;
}

export default function AgenteConfig() {
  const [tab, setTab] = useState("config");
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [pacienteNome, setPacienteNome] = useState("Maria");
  const [chatStarted, setChatStarted] = useState(false);
  const [collectedData, setCollectedData] = useState(null);
  const chatEndRef = useRef(null);
  const [saveStatus, setSaveStatus] = useState("");

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const updateConfig = (key, value) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const updateObjetivo = (index, field, value) => {
    const novos = [...config.objetivos];
    novos[index] = { ...novos[index], [field]: value };
    setConfig((prev) => ({ ...prev, objetivos: novos }));
  };

  const addObjetivo = () => {
    setConfig((prev) => ({
      ...prev,
      objetivos: [...prev.objetivos, { id: `obj_${Date.now()}`, label: "Novo objetivo" }],
    }));
  };

  const removeObjetivo = (index) => {
    setConfig((prev) => ({
      ...prev,
      objetivos: prev.objetivos.filter((_, i) => i !== index),
    }));
  };

  const updatePergunta = (index, value) => {
    const novas = [...config.perguntas_detalhes];
    novas[index] = value;
    setConfig((prev) => ({ ...prev, perguntas_detalhes: novas }));
  };

  const addPergunta = () => {
    setConfig((prev) => ({
      ...prev,
      perguntas_detalhes: [...prev.perguntas_detalhes, "Nova pergunta"],
    }));
  };

  const updateFaixa = (index, field, value) => {
    const novas = [...config.faixas_gordura];
    novas[index] = { ...novas[index], [field]: value };
    setConfig((prev) => ({ ...prev, faixas_gordura: novas }));
  };

  const updateBeneficio = (index, value) => {
    const novos = [...config.oferta_beneficios];
    novos[index] = value;
    setConfig((prev) => ({ ...prev, oferta_beneficios: novos }));
  };

  const addBeneficio = () => {
    setConfig((prev) => ({
      ...prev,
      oferta_beneficios: [...prev.oferta_beneficios, "Novo benefício"],
    }));
  };

  const removeBeneficio = (index) => {
    setConfig((prev) => ({
      ...prev,
      oferta_beneficios: prev.oferta_beneficios.filter((_, i) => i !== index),
    }));
  };

  const updatePlano = (index, field, value) => {
    const novos = [...config.planos];
    novos[index] = { ...novos[index], [field]: value };
    setConfig((prev) => ({ ...prev, planos: novos }));
  };

  const startChat = async () => {
    setChatMessages([]);
    setChatStarted(true);
    setCollectedData(null);
    setChatLoading(true);
    const systemPrompt = buildSystemPrompt(config);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: systemPrompt,
          messages: [{ role: "user", content: `Meu nome é ${pacienteNome}. Olá!` }],
        }),
      });
      const data = await res.json();
      const text = data.content?.map((c) => c.text || "").join("") || "";
      setChatMessages([
        { role: "user", content: `Olá! Meu nome é ${pacienteNome}.` },
        { role: "assistant", content: text },
      ]);
    } catch (e) {
      setChatMessages([{ role: "assistant", content: "❌ Erro ao conectar com a API." }]);
    }
    setChatLoading(false);
  };

  const sendMessage = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const userMsg = chatInput.trim();
    setChatInput("");
    const newMessages = [...chatMessages, { role: "user", content: userMsg }];
    setChatMessages(newMessages);
    setChatLoading(true);
    const systemPrompt = buildSystemPrompt(config);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: systemPrompt,
          messages: newMessages,
        }),
      });
      const data = await res.json();
      const text = data.content?.map((c) => c.text || "").join("") || "";
      const updatedMessages = [...newMessages, { role: "assistant", content: text }];
      setChatMessages(updatedMessages);
      if (text.includes("DADOS_COLETADOS:")) {
        try {
          const jsonStr = text.match(/DADOS_COLETADOS:\s*(\{[\s\S]*?\})/)?.[1];
          if (jsonStr) setCollectedData(JSON.parse(jsonStr));
        } catch {}
      }
    } catch (e) {
      setChatMessages([...newMessages, { role: "assistant", content: "❌ Erro ao processar resposta." }]);
    }
    setChatLoading(false);
  };

  const handleSave = () => {
    setSaveStatus("Configuração salva!");
    setTimeout(() => setSaveStatus(""), 2000);
  };

  const cardStyle = {
    background: "var(--color-background-primary)",
    border: "0.5px solid var(--color-border-tertiary)",
    borderRadius: "var(--border-radius-lg)",
    padding: "1.25rem",
    marginBottom: "1rem",
  };

  const labelStyle = {
    fontSize: "12px",
    fontWeight: 500,
    color: "var(--color-text-secondary)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginBottom: "6px",
    display: "block",
  };

  const sectionTitleStyle = {
    fontSize: "14px",
    fontWeight: 500,
    color: "var(--color-text-primary)",
    marginBottom: "1rem",
    display: "flex",
    alignItems: "center",
    gap: "8px",
  };

  const badgeStyle = (color) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    fontSize: "11px",
    fontWeight: 500,
    padding: "3px 10px",
    borderRadius: "999px",
    background: `var(--color-background-${color})`,
    color: `var(--color-text-${color})`,
  });

  const tabBtnStyle = (active) => ({
    padding: "8px 18px",
    fontSize: "13px",
    fontWeight: 500,
    borderRadius: "var(--border-radius-md)",
    border: active ? "2px solid var(--color-border-info)" : "0.5px solid var(--color-border-tertiary)",
    background: active ? "var(--color-background-info)" : "transparent",
    color: active ? "var(--color-text-info)" : "var(--color-text-secondary)",
    cursor: "pointer",
  });

  return (
    <div style={{ fontFamily: "var(--font-sans)", maxWidth: "100%", padding: "1rem 0" }}>
      <h2 className="sr-only">Editor e simulador do agente de primeiro contato</h2>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{
            width: "36px", height: "36px", borderRadius: "50%",
            background: "var(--color-background-info)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <i className="ti ti-robot" style={{ fontSize: "18px", color: "var(--color-text-info)" }} aria-hidden="true" />
          </div>
          <div>
            <p style={{ fontSize: "15px", fontWeight: 500, margin: 0 }}>Agente de Primeiro Contato</p>
            <p style={{ fontSize: "12px", color: "var(--color-text-secondary)", margin: 0 }}>Configure e treine o comportamento do agente</p>
          </div>
        </div>
        <span style={badgeStyle("success")}>
          <i className="ti ti-circle-check" style={{ fontSize: "13px" }} aria-hidden="true" />
          Ativo
        </span>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "1.5rem" }}>
        <button style={tabBtnStyle(tab === "config")} onClick={() => setTab("config")}>
          <i className="ti ti-settings" style={{ fontSize: "13px", marginRight: "5px" }} aria-hidden="true" />
          Configuração
        </button>
        <button style={tabBtnStyle(tab === "simulacao")} onClick={() => setTab("simulacao")}>
          <i className="ti ti-message-circle" style={{ fontSize: "13px", marginRight: "5px" }} aria-hidden="true" />
          Simulação
        </button>
        <button style={tabBtnStyle(tab === "fluxo")} onClick={() => setTab("fluxo")}>
          <i className="ti ti-git-branch" style={{ fontSize: "13px", marginRight: "5px" }} aria-hidden="true" />
          Fluxo
        </button>
      </div>

      {/* CONFIG TAB */}
      {tab === "config" && (
        <div>
          {/* Identidade */}
          <div style={cardStyle}>
            <p style={sectionTitleStyle}>
              <i className="ti ti-id-badge" style={{ fontSize: "16px", color: "var(--color-text-info)" }} aria-hidden="true" />
              Identidade do Agente
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div>
                <label style={labelStyle}>Nome do Nutricionista</label>
                <input value={config.nome_nutricionista} onChange={(e) => updateConfig("nome_nutricionista", e.target.value)} style={{ width: "100%" }} />
              </div>
              <div>
                <label style={labelStyle}>Nome do Agente</label>
                <input value={config.nome_agente} onChange={(e) => updateConfig("nome_agente", e.target.value)} style={{ width: "100%" }} />
              </div>
            </div>
            <div style={{ marginTop: "12px" }}>
              <label style={labelStyle}>Tom de Comunicação</label>
              <select value={config.tom} onChange={(e) => updateConfig("tom", e.target.value)} style={{ width: "100%" }}>
                {TOM_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div style={{ marginTop: "12px" }}>
              <label style={labelStyle}>Instruções Extras para o Agente</label>
              <textarea rows={3} value={config.instrucoes_extra} onChange={(e) => updateConfig("instrucoes_extra", e.target.value)} style={{ width: "100%", resize: "vertical" }} />
            </div>
          </div>

          {/* Etapa 1 - Saudação */}
          <div style={cardStyle}>
            <p style={sectionTitleStyle}>
              <span style={{ ...badgeStyle("info"), marginRight: "4px" }}>Etapa 1</span>
              Saudação & Objetivos
            </p>
            <div style={{ marginBottom: "12px" }}>
              <label style={labelStyle}>Mensagem de Saudação <span style={{ color: "var(--color-text-tertiary)", fontWeight: 400 }}>(use {"{nome}"} para o nome do paciente)</span></label>
              <textarea rows={4} value={config.saudacao} onChange={(e) => updateConfig("saudacao", e.target.value)} style={{ width: "100%", resize: "vertical" }} />
            </div>
            <div style={{ marginBottom: "12px" }}>
              <label style={labelStyle}>Pergunta de Objetivo</label>
              <input value={config.objetivo_pergunta} onChange={(e) => updateConfig("objetivo_pergunta", e.target.value)} style={{ width: "100%" }} />
            </div>
            <label style={labelStyle}>Opções de Objetivo</label>
            {config.objetivos.map((obj, i) => (
              <div key={obj.id} style={{ display: "flex", gap: "8px", marginBottom: "8px", alignItems: "center" }}>
                <span style={{ fontSize: "12px", color: "var(--color-text-tertiary)", minWidth: "20px" }}>{i + 1}.</span>
                <input value={obj.label} onChange={(e) => updateObjetivo(i, "label", e.target.value)} style={{ flex: 1 }} />
                <button onClick={() => removeObjetivo(i)} style={{ padding: "6px 8px", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-md)", background: "transparent", cursor: "pointer" }}>
                  <i className="ti ti-trash" style={{ fontSize: "14px", color: "var(--color-text-danger)" }} aria-hidden="true" />
                </button>
              </div>
            ))}
            <button onClick={addObjetivo} style={{ fontSize: "13px", color: "var(--color-text-info)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
              <i className="ti ti-plus" style={{ fontSize: "13px", marginRight: "4px" }} aria-hidden="true" />
              Adicionar opção
            </button>
          </div>

          {/* Etapa 2 - Detalhes */}
          <div style={cardStyle}>
            <p style={sectionTitleStyle}>
              <span style={{ ...badgeStyle("warning"), marginRight: "4px" }}>Etapa 2</span>
              Detalhes Pessoais
            </p>
            <div style={{ marginBottom: "12px" }}>
              <label style={labelStyle}>Mensagem de Transição</label>
              <textarea rows={3} value={config.detalhes_pergunta} onChange={(e) => updateConfig("detalhes_pergunta", e.target.value)} style={{ width: "100%", resize: "vertical" }} />
            </div>
            <label style={labelStyle}>Perguntas de Detalhamento</label>
            {config.perguntas_detalhes.map((p, i) => (
              <div key={i} style={{ display: "flex", gap: "8px", marginBottom: "8px", alignItems: "center" }}>
                <span style={{ fontSize: "12px", color: "var(--color-text-tertiary)", minWidth: "20px" }}>{i + 1}.</span>
                <input value={p} onChange={(e) => updatePergunta(i, e.target.value)} style={{ flex: 1 }} />
              </div>
            ))}
            <button onClick={addPergunta} style={{ fontSize: "13px", color: "var(--color-text-info)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
              <i className="ti ti-plus" style={{ fontSize: "13px", marginRight: "4px" }} aria-hidden="true" />
              Adicionar pergunta
            </button>
          </div>

          {/* Etapa 3 - Avaliação Corporal */}
          <div style={cardStyle}>
            <p style={sectionTitleStyle}>
              <span style={{ ...badgeStyle("success"), marginRight: "4px" }}>Etapa 3</span>
              Avaliação de % Gordura
            </p>
            <div style={{ marginBottom: "12px" }}>
              <label style={labelStyle}>Mensagem de Transição</label>
              <input value={config.corpo_pergunta} onChange={(e) => updateConfig("corpo_pergunta", e.target.value)} style={{ width: "100%" }} />
            </div>
            <label style={labelStyle}>Faixas de Percentual de Gordura</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
              {config.faixas_gordura.map((f, i) => (
                <div key={f.id} style={{ background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: "10px", border: "0.5px solid var(--color-border-tertiary)" }}>
                  <p style={{ fontSize: "11px", fontWeight: 500, color: "var(--color-text-secondary)", margin: "0 0 4px" }}>Faixa {f.id}</p>
                  <input value={f.label} onChange={(e) => updateFaixa(i, "label", e.target.value)} style={{ width: "100%", fontSize: "12px", marginBottom: "4px" }} placeholder="% gordura" />
                  <input value={f.descricao} onChange={(e) => updateFaixa(i, "descricao", e.target.value)} style={{ width: "100%", fontSize: "11px" }} placeholder="Descrição" />
                </div>
              ))}
            </div>
          </div>

          {/* Etapa 4 - Apresentação da Oferta */}
          <div style={cardStyle}>
            <p style={sectionTitleStyle}>
              <span style={{ ...badgeStyle("warning"), marginRight: "4px" }}>Etapa 4</span>
              Apresentação da Oferta
            </p>

            {/* Título da oferta */}
            <div style={{ marginBottom: "12px" }}>
              <label style={labelStyle}>Título da Oferta</label>
              <input value={config.oferta_titulo} onChange={(e) => updateConfig("oferta_titulo", e.target.value)} style={{ width: "100%" }} placeholder="COMO FUNCIONA A CONSULTORIA FITNESS GOLD 🏆" />
            </div>

            {/* Benefícios */}
            <label style={labelStyle}>Benefícios Incluídos</label>
            {config.oferta_beneficios.map((b, i) => (
              <div key={i} style={{ display: "flex", gap: "8px", marginBottom: "8px", alignItems: "flex-start" }}>
                <span style={{ fontSize: "12px", color: "var(--color-text-tertiary)", minWidth: "20px", paddingTop: "6px" }}>{i + 1}.</span>
                <textarea
                  rows={2}
                  value={b}
                  onChange={(e) => updateBeneficio(i, e.target.value)}
                  style={{ flex: 1, resize: "vertical", fontSize: "13px" }}
                />
                <button onClick={() => removeBeneficio(i)} style={{ padding: "6px 8px", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-md)", background: "transparent", cursor: "pointer", marginTop: "2px" }}>
                  <i className="ti ti-trash" style={{ fontSize: "14px", color: "var(--color-text-danger)" }} aria-hidden="true" />
                </button>
              </div>
            ))}
            <button onClick={addBeneficio} style={{ fontSize: "13px", color: "var(--color-text-info)", background: "transparent", border: "none", cursor: "pointer", padding: 0, marginBottom: "16px" }}>
              <i className="ti ti-plus" style={{ fontSize: "13px", marginRight: "4px" }} aria-hidden="true" />
              Adicionar benefício
            </button>

            {/* Pergunta da oferta */}
            <div style={{ marginBottom: "16px" }}>
              <label style={labelStyle}>Pergunta após os Benefícios</label>
              <textarea rows={3} value={config.oferta_pergunta} onChange={(e) => updateConfig("oferta_pergunta", e.target.value)} style={{ width: "100%", resize: "vertical" }} />
            </div>

            {/* Planos */}
            <label style={labelStyle}>Planos Disponíveis</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px", marginBottom: "16px" }}>
              {config.planos.map((p, i) => (
                <div key={p.id} style={{
                  background: p.destaque ? "var(--color-background-warning)" : "var(--color-background-secondary)",
                  borderRadius: "var(--border-radius-md)",
                  padding: "12px",
                  border: p.destaque ? "1px solid var(--color-border-warning)" : "0.5px solid var(--color-border-tertiary)",
                }}>
                  {p.destaque && (
                    <p style={{ fontSize: "10px", fontWeight: 700, color: "var(--color-text-warning)", margin: "0 0 6px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      ⭐ Mais popular
                    </p>
                  )}
                  <div style={{ marginBottom: "6px" }}>
                    <label style={{ ...labelStyle, marginBottom: "3px" }}>Nome</label>
                    <input value={p.nome} onChange={(e) => updatePlano(i, "nome", e.target.value)} style={{ width: "100%", fontSize: "12px" }} />
                  </div>
                  <div style={{ marginBottom: "6px" }}>
                    <label style={{ ...labelStyle, marginBottom: "3px" }}>Duração</label>
                    <input value={p.duracao} onChange={(e) => updatePlano(i, "duracao", e.target.value)} style={{ width: "100%", fontSize: "12px" }} placeholder="Ex: 2 meses" />
                  </div>
                  <div style={{ marginBottom: "6px" }}>
                    <label style={{ ...labelStyle, marginBottom: "3px" }}>Preço</label>
                    <input value={p.preco} onChange={(e) => updatePlano(i, "preco", e.target.value)} style={{ width: "100%", fontSize: "12px" }} placeholder="Ex: R$ 197" />
                  </div>
                  <div>
                    <label style={{ ...labelStyle, marginBottom: "3px" }}>Desconto</label>
                    <input value={p.desconto} onChange={(e) => updatePlano(i, "desconto", e.target.value)} style={{ width: "100%", fontSize: "12px" }} placeholder="Ex: 10%" />
                  </div>
                </div>
              ))}
            </div>

            {/* Urgência */}
            <div style={{ marginBottom: "12px" }}>
              <label style={labelStyle}>
                Mensagem de Urgência
                <span style={{ color: "var(--color-text-tertiary)", fontWeight: 400, marginLeft: "6px" }}>(use {"{vagas}"} e {"{data}"} para personalizar)</span>
              </label>
              <textarea rows={2} value={config.urgencia} onChange={(e) => updateConfig("urgencia", e.target.value)} style={{ width: "100%", resize: "vertical" }} />
            </div>

            {/* Pergunta dos planos */}
            <div>
              <label style={labelStyle}>Pergunta Final dos Planos</label>
              <input value={config.planos_pergunta} onChange={(e) => updateConfig("planos_pergunta", e.target.value)} style={{ width: "100%" }} />
            </div>
          </div>

          {/* Etapa 5 - Encerramento */}
          <div style={cardStyle}>
            <p style={sectionTitleStyle}>
              <span style={{ ...badgeStyle("success"), marginRight: "4px" }}>Etapa 5</span>
              Mensagem de Encerramento
            </p>
            <textarea rows={4} value={config.encerramento} onChange={(e) => updateConfig("encerramento", e.target.value)} style={{ width: "100%", resize: "vertical" }} />
          </div>

          {/* Save */}
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <button onClick={handleSave} style={{ padding: "10px 24px", background: "var(--color-background-info)", color: "var(--color-text-info)", border: "0.5px solid var(--color-border-info)", borderRadius: "var(--border-radius-md)", fontWeight: 500, cursor: "pointer", fontSize: "14px" }}>
              <i className="ti ti-device-floppy" style={{ fontSize: "14px", marginRight: "6px" }} aria-hidden="true" />
              Salvar Configuração
            </button>
            {saveStatus && <span style={{ fontSize: "13px", color: "var(--color-text-success)" }}>✓ {saveStatus}</span>}
          </div>
        </div>
      )}

      {/* SIMULAÇÃO TAB */}
      {tab === "simulacao" && (
        <div>
          {!chatStarted ? (
            <div style={{ ...cardStyle, textAlign: "center", padding: "2.5rem" }}>
              <i className="ti ti-player-play" style={{ fontSize: "48px", color: "var(--color-text-info)", display: "block", marginBottom: "1rem" }} aria-hidden="true" />
              <p style={{ fontSize: "15px", fontWeight: 500, marginBottom: "0.5rem" }}>Simular Conversa com Paciente</p>
              <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", marginBottom: "1.5rem" }}>
                Teste o agente como se fosse um novo paciente chegando pelo WhatsApp
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", justifyContent: "center", marginBottom: "1.5rem" }}>
                <label style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>Nome do paciente simulado:</label>
                <input value={pacienteNome} onChange={(e) => setPacienteNome(e.target.value)} style={{ width: "160px" }} placeholder="Ex: Maria" />
              </div>
              <button onClick={startChat} style={{ padding: "10px 28px", background: "var(--color-background-info)", color: "var(--color-text-info)", border: "0.5px solid var(--color-border-info)", borderRadius: "var(--border-radius-md)", fontWeight: 500, cursor: "pointer", fontSize: "14px" }}>
                Iniciar Simulação ↗
              </button>
            </div>
          ) : (
            <div>
              {/* Chat window */}
              <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
                {/* Chat header */}
                <div style={{ padding: "12px 16px", borderBottom: "0.5px solid var(--color-border-tertiary)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: "var(--color-background-success)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <i className="ti ti-robot" style={{ fontSize: "16px", color: "var(--color-text-success)" }} aria-hidden="true" />
                    </div>
                    <div>
                      <p style={{ fontSize: "13px", fontWeight: 500, margin: 0 }}>{config.nome_agente}</p>
                      <p style={{ fontSize: "11px", color: "var(--color-text-secondary)", margin: 0 }}>Agente de Primeiro Contato</p>
                    </div>
                  </div>
                  <button onClick={() => { setChatStarted(false); setChatMessages([]); setCollectedData(null); }} style={{ fontSize: "12px", color: "var(--color-text-secondary)", background: "transparent", border: "none", cursor: "pointer" }}>
                    <i className="ti ti-refresh" style={{ fontSize: "14px" }} aria-hidden="true" /> Reiniciar
                  </button>
                </div>

                {/* Messages */}
                <div style={{ height: "420px", overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: "12px", background: "var(--color-background-secondary)" }}>
                  {chatMessages.map((msg, i) => (
                    <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: msg.role === "user" ? "flex-end" : "flex-start" }}>
                      <div style={{
                        maxWidth: "78%",
                        padding: "10px 14px",
                        borderRadius: msg.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                        background: msg.role === "user" ? "var(--color-background-info)" : "var(--color-background-primary)",
                        border: msg.role === "user" ? "none" : "0.5px solid var(--color-border-tertiary)",
                        fontSize: "13px",
                        lineHeight: "1.6",
                        color: msg.role === "user" ? "var(--color-text-info)" : "var(--color-text-primary)",
                        whiteSpace: "pre-wrap",
                      }}>
                        {msg.content.replace(/DADOS_COLETADOS:[\s\S]*$/, "").trim()}
                      </div>
                      <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", marginTop: "3px" }}>
                        {msg.role === "user" ? pacienteNome : config.nome_agente}
                      </span>
                    </div>
                  ))}
                  {chatLoading && (
                    <div style={{ display: "flex", alignItems: "flex-start" }}>
                      <div style={{ padding: "10px 14px", borderRadius: "16px 16px 16px 4px", background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
                        Digitando...
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                {/* Input */}
                <div style={{ padding: "12px 16px", borderTop: "0.5px solid var(--color-border-tertiary)", display: "flex", gap: "8px" }}>
                  <input
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
                    placeholder={`Responda como ${pacienteNome}...`}
                    style={{ flex: 1, fontSize: "13px" }}
                    disabled={chatLoading}
                  />
                  <button onClick={sendMessage} disabled={chatLoading || !chatInput.trim()} style={{ padding: "8px 16px", background: "var(--color-background-info)", color: "var(--color-text-info)", border: "none", borderRadius: "var(--border-radius-md)", cursor: "pointer", fontWeight: 500, fontSize: "13px" }}>
                    <i className="ti ti-send" style={{ fontSize: "14px" }} aria-hidden="true" />
                  </button>
                </div>
              </div>

              {/* Dados coletados */}
              {collectedData && (
                <div style={{ ...cardStyle, marginTop: "1rem" }}>
                  <p style={sectionTitleStyle}>
                    <i className="ti ti-clipboard-data" style={{ fontSize: "16px", color: "var(--color-text-success)" }} aria-hidden="true" />
                    Dados Coletados pelo Agente
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    {Object.entries(collectedData).filter(([, v]) => v).map(([k, v]) => (
                      <div key={k} style={{
                        background: k === "plano_escolhido" ? "var(--color-background-warning)" : "var(--color-background-secondary)",
                        borderRadius: "var(--border-radius-md)",
                        padding: "10px 12px",
                        border: k === "plano_escolhido" ? "1px solid var(--color-border-warning)" : "none",
                      }}>
                        <p style={{ fontSize: "10px", color: "var(--color-text-secondary)", margin: "0 0 3px", textTransform: "uppercase", letterSpacing: "0.05em" }}>{k.replace(/_/g, " ")}</p>
                        <p style={{ fontSize: "13px", fontWeight: k === "plano_escolhido" ? 700 : 500, margin: 0 }}>{v}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* FLUXO TAB */}
      {tab === "fluxo" && (
        <div>
          <div style={cardStyle}>
            <p style={sectionTitleStyle}>
              <i className="ti ti-git-branch" style={{ fontSize: "16px", color: "var(--color-text-info)" }} aria-hidden="true" />
              Fluxo do Agente de Primeiro Contato
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
              {[
                {
                  num: 1, cor: "info", icon: "ti-hand-stop",
                  titulo: "Gatilho",
                  desc: "Paciente chega pelo WhatsApp / formulário",
                  sub: "Lead criado automaticamente no sistema",
                },
                {
                  num: 2, cor: "info", icon: "ti-message",
                  titulo: "Saudação & Qualificação de Objetivo",
                  desc: config.saudacao.substring(0, 80) + "...",
                  sub: `Tom: ${TOM_OPTIONS.find((t) => t.value === config.tom)?.label} · ${config.objetivos.length} opções`,
                },
                {
                  num: 3, cor: "warning", icon: "ti-user-search",
                  titulo: "Coleta de Dados Pessoais",
                  desc: `${config.perguntas_detalhes.length} perguntas: idade, peso, altura, experiência`,
                  sub: "Dificuldades e barreiras identificadas",
                },
                {
                  num: 4, cor: "warning", icon: "ti-body-scan",
                  titulo: "Avaliação Corporal",
                  desc: `${config.faixas_gordura.length} faixas de % gordura (corpo atual e desejado)`,
                  sub: "Mapeamento visual via referências numéricas",
                },
                {
                  num: 5, cor: "success", icon: "ti-star",
                  titulo: "Apresentação da Oferta",
                  desc: config.oferta_titulo,
                  sub: `${config.oferta_beneficios.length} benefícios · ${config.planos.length} planos disponíveis`,
                },
                {
                  num: 6, cor: "success", icon: "ti-check",
                  titulo: "Encerramento & Lead Qualificado",
                  desc: "Plano escolhido · dados consolidados ao nutricionista",
                  sub: "Paciente avança para anamnese completa",
                },
              ].map((step, i, arr) => (
                <div key={step.num} style={{ display: "flex", gap: "0" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "40px" }}>
                    <div style={{
                      width: "32px", height: "32px", borderRadius: "50%",
                      background: `var(--color-background-${step.cor})`,
                      border: `2px solid var(--color-border-${step.cor})`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0,
                    }}>
                      <span style={{ fontSize: "12px", fontWeight: 500, color: `var(--color-text-${step.cor})` }}>{step.num}</span>
                    </div>
                    {i < arr.length - 1 && <div style={{ width: "1.5px", flex: 1, background: "var(--color-border-tertiary)", minHeight: "24px" }} />}
                  </div>
                  <div style={{ paddingLeft: "12px", paddingBottom: i < arr.length - 1 ? "20px" : "0", paddingTop: "4px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "3px" }}>
                      <i className={`ti ${step.icon}`} style={{ fontSize: "14px", color: `var(--color-text-${step.cor})` }} aria-hidden="true" />
                      <p style={{ fontSize: "13px", fontWeight: 500, margin: 0 }}>{step.titulo}</p>
                    </div>
                    <p style={{ fontSize: "12px", color: "var(--color-text-primary)", margin: "0 0 2px" }}>{step.desc}</p>
                    <p style={{ fontSize: "11px", color: "var(--color-text-tertiary)", margin: 0 }}>{step.sub}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={cardStyle}>
            <p style={sectionTitleStyle}>
              <i className="ti ti-code" style={{ fontSize: "16px", color: "var(--color-text-secondary)" }} aria-hidden="true" />
              System Prompt Atual (Preview)
            </p>
            <pre style={{ fontSize: "11px", color: "var(--color-text-secondary)", background: "var(--color-background-secondary)", padding: "12px", borderRadius: "var(--border-radius-md)", overflow: "auto", maxHeight: "320px", whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}>
              {buildSystemPrompt(config)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
