"""Resume file storage. Paths are generated here and never derived from user input."""

import asyncio
import uuid
from pathlib import Path

from app.config import get_settings


class LocalStorage:
    def __init__(self, root: str) -> None:
        self._root = Path(root)

    async def save(self, data: bytes, extension: str) -> str:
        name = f"{uuid.uuid4()}.{extension}"
        await asyncio.to_thread(self._write, name, data)
        return name

    def _write(self, name: str, data: bytes) -> None:
        self._root.mkdir(parents=True, exist_ok=True)
        (self._root / name).write_bytes(data)

    async def read(self, name: str) -> bytes:
        return await asyncio.to_thread((self._root / name).read_bytes)

    async def delete(self, name: str) -> None:
        await asyncio.to_thread((self._root / name).unlink, True)


def get_storage() -> LocalStorage:
    return LocalStorage(get_settings().storage_dir)
