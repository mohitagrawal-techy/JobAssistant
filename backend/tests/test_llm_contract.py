"""Every LLMClient must meet this contract. Add new provider adapters to CLIENTS."""

import os

import pytest

from app.ai.agent import normalize_refs
from app.ai.base import ChatMessage, ToolSpec
from app.ai.documents import extract_text
from app.ai.fake_client import FakeClient
from app.ai.ollama_client import OllamaClient
from app.ai.schemas import JobExtraction, MatchExplanation, ResumeExtraction

CLIENTS = [pytest.param(FakeClient, id="fake")]
if url := os.environ.get("OLLAMA_TEST_URL"):
    model = os.environ.get("OLLAMA_TEST_MODEL", "gpt-oss:20b")
    CLIENTS.append(pytest.param(lambda: OllamaClient(model, url), id="ollama"))


@pytest.mark.parametrize("factory", CLIENTS)
async def test_extracts_resume(factory):
    result = await factory().extract(
        "Extract resume data.",
        "Backend Engineer. 5 years of experience. Skills: python, docker.",
        ResumeExtraction,
    )
    assert isinstance(result, ResumeExtraction)
    assert {"python", "docker"} <= {skill.lower() for skill in result.skills}


@pytest.mark.parametrize("factory", CLIENTS)
async def test_extracts_job(factory):
    result = await factory().extract(
        "Extract job data.", "Backend Engineer. Required: python.", JobExtraction
    )
    assert isinstance(result, JobExtraction)
    assert "python" in {skill.lower() for skill in result.required_skills}


@pytest.mark.parametrize("factory", CLIENTS)
async def test_explains_match(factory):
    facts = '{"matched_skills": ["python"], "missing_skills": ["go"], "total_score": 60}'
    result = await factory().extract("Explain this match.", facts, MatchExplanation)
    assert isinstance(result, MatchExplanation)
    assert result.summary


def _minimal_pdf(text: str) -> bytes:
    stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    output = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(output))
        output += b"%d 0 obj\n%s\nendobj\n" % (number, body)
    xref = len(output)
    output += b"xref\n0 6\n0000000000 65535 f \n"
    for offset in offsets:
        output += b"%010d 00000 n \n" % offset
    output += b"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF" % xref
    return bytes(output)


def test_extracts_text_from_pdf():
    assert "Python developer" in extract_text(_minimal_pdf("Python developer"), "pdf")


@pytest.mark.parametrize("factory", CLIENTS)
async def test_chat_requests_tool_and_uses_result(factory):
    client = factory()
    tool = ToolSpec(
        name="find_candidates",
        description="Find candidates for the job.",
        parameters={"type": "object", "properties": {}},
    )
    messages = [
        ChatMessage(role="system", content="Use find_candidates to answer. Use exact references."),
        ChatMessage(role="user", content="Who is the best candidate?"),
    ]
    first = await client.chat(messages, [tool])
    assert [call.name for call in first.tool_calls] == ["find_candidates"]

    messages += [
        ChatMessage(role="assistant", tool_calls=first.tool_calls),
        ChatMessage(role="tool", tool_name="find_candidates", content='{"best": "C-abc123"}'),
    ]
    second = await client.chat(messages, [tool])
    assert not second.tool_calls
    assert "C-abc123" in normalize_refs(second.text)
