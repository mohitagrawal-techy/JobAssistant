"""Selects AI providers from settings. A hosted API is added here as one new branch."""

from functools import lru_cache

from app.ai.base import EmbeddingClient, LLMClient
from app.ai.fake_client import FakeClient, FakeEmbeddingClient
from app.ai.ollama_client import OllamaClient, OllamaEmbeddingClient
from app.config import get_settings


@lru_cache
def get_llm() -> LLMClient:
    settings = get_settings()
    match settings.llm_provider:
        case "ollama":
            return OllamaClient(settings.llm_model, settings.llm_base_url)
        case "fake":
            return FakeClient()
        case other:
            raise ValueError(f"Unknown LLM_PROVIDER: {other}")


@lru_cache
def get_embedder() -> EmbeddingClient:
    settings = get_settings()
    match settings.embedding_provider:
        case "ollama":
            return OllamaEmbeddingClient(settings.embedding_model, settings.embedding_base_url)
        case "fake":
            return FakeEmbeddingClient()
        case other:
            raise ValueError(f"Unknown EMBEDDING_PROVIDER: {other}")
