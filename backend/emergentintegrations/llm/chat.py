import anthropic


class UserMessage:
    def __init__(self, text: str):
        self.text = text


class LlmChat:
    def __init__(self, api_key: str, session_id: str = "", system_message: str = ""):
        self.api_key = api_key
        self.session_id = session_id
        self.system_message = system_message
        self._provider = "anthropic"
        self._model = "claude-sonnet-4-5-20250929"

    def with_model(self, provider: str, model: str) -> "LlmChat":
        self._provider = provider
        self._model = model
        return self

    async def send_message(self, message: UserMessage) -> str:
        client = anthropic.AsyncAnthropic(api_key=self.api_key)
        response = await client.messages.create(
            model=self._model,
            max_tokens=2048,
            system=self.system_message,
            messages=[{"role": "user", "content": message.text}],
        )
        return response.content[0].text
