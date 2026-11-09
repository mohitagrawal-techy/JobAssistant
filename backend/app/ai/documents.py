"""Validates uploaded resumes and turns them into plain text."""

import io
import logging
import zipfile

import docx
from pypdf import PdfReader

logger = logging.getLogger(__name__)


class DocumentError(Exception):
    """The file can't be used. The message is safe to show to the user."""


def detect_extension(data: bytes) -> str:
    """Identify the file type from its content, ignoring its claimed name and MIME type."""
    if data.startswith(b"%PDF-"):
        return "pdf"
    if data.startswith(b"PK\x03\x04"):
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                if "word/document.xml" in archive.namelist():
                    return "docx"
        except zipfile.BadZipFile:
            pass
    raise DocumentError("Please upload a PDF or DOCX file")


def extract_text(data: bytes, extension: str) -> str:
    try:
        text = _read_pdf(data) if extension == "pdf" else _read_docx(data)
    except Exception as exc:  # parsers raise many types on malformed files
        logger.info("Could not read uploaded %s: %s", extension, exc)
        raise DocumentError("This file could not be read. Please fill in the form.") from exc
    if not text.strip():
        raise DocumentError(
            "No text found in this file. Scanned resumes aren't supported yet, "
            "so please fill in the form."
        )
    return text


def _read_pdf(data: bytes) -> str:
    reader = PdfReader(io.BytesIO(data))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def _read_docx(data: bytes) -> str:
    document = docx.Document(io.BytesIO(data))
    parts = [paragraph.text for paragraph in document.paragraphs]
    for table in document.tables:
        for row in table.rows:
            parts.append(" | ".join(cell.text for cell in row.cells))
    return "\n".join(parts)
