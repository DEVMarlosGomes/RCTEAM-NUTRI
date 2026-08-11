import anthropic


class UserMessage:
    def __init__(self, text: str):
        self.text = text


class LlmChat:
    """Adaptador mínimo para manter uma interface única para o Claude."""

    def __init__(self, api_key: str, session_id: str = "", system_message: str = ""):
        if not api_key:
            raise ValueError("ANTHROPIC_API_KEY não configurada")
        self.api_key = api_key
        self.session_id = session_id
        self.system_message = system_message
        self.model = "claude-sonnet-4-6"

    def with_model(self, provider: str, model: str) -> "LlmChat":
        if provider != "anthropic":
            raise ValueError(f"Provedor de IA não suportado: {provider}")
        self.model = model
        return self

    async def send_message(self, message: UserMessage) -> str:
        client = anthropic.AsyncAnthropic(api_key=self.api_key)
        response = await client.messages.create(
            model=self.model,
            max_tokens=2048,
            system=self.system_message,
            messages=[{"role": "user", "content": message.text}],
        )
        text_blocks = [block.text for block in response.content if getattr(block, "type", None) == "text"]
        if not text_blocks:
            raise ValueError("A Anthropic não retornou conteúdo textual")
        return "\n".join(text_blocks)
