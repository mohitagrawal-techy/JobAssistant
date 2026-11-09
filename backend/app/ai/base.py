"""Provider-neutral AI interfaces. Nothing outside app/ai/ knows which provider is in use."""

from typing import Literal, Protocol, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T", bound=BaseModel)
EmbeddingKind = Literal["document", "query"]


class AIError(Exception):
    """Base class for failures the app handles by falling back to manual entry."""


class AIUnavailable(AIError):
    """The provider could not be reached."""


class AIInvalidOutput(AIError):
    """The provider kept returning output that doesn't match the schema."""


class AIInputTooLong(AIError):
    """The input doesn't fit the model's context. Input is never silently truncated."""


class ToolSpec(BaseModel):
    name: str
    description: str
    parameters: dict


class ToolCall(BaseModel):
    name: str
    arguments: dict = Field(default_factory=dict)


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant", "tool"]
    content: str = ""
    tool_calls: list[ToolCall] = Field(default_factory=list)
    tool_name: str | None = None


class ChatReply(BaseModel):
    text: str = ""
    tool_calls: list[ToolCall] = Field(default_factory=list)


class LLMClient(Protocol):
    model: str

    async def extract(self, system: str, text: str, schema: type[T]) -> T:
        """Return `schema` filled in from untrusted `text`."""
        ...

    async def chat(self, messages: list[ChatMessage], tools: list[ToolSpec]) -> ChatReply:
        """Return the next assistant turn, which may request tool calls."""
        ...


class EmbeddingClient(Protocol):
    model: str

    async def embed(self, texts: list[str], kind: EmbeddingKind) -> list[list[float]]: ...
