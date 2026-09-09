from .settings import DonatoSettings


class DonatoProviderUnavailable(RuntimeError):
    pass


def get_openai_client(settings: DonatoSettings):
    if not settings.openai_api_key:
        raise DonatoProviderUnavailable("OPENAI_API_KEY nao configurada")
    try:
        from openai import AsyncOpenAI
    except Exception as exc:
        raise DonatoProviderUnavailable("Pacote openai nao instalado") from exc
    return AsyncOpenAI(api_key=settings.openai_api_key)
