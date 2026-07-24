# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, TimeoutError
from typing import Any, Callable


class SandboxExecutor:
    """A light sandbox facade with timeout boundaries for plugin operations."""

    def __init__(self, max_workers: int = 8):
        self._executor = ThreadPoolExecutor(max_workers=max_workers)

    def run(self, fn: Callable[..., Any], *args: Any, timeout: float = 3.0, **kwargs: Any) -> Any:
        future = self._executor.submit(fn, *args, **kwargs)
        try:
            return future.result(timeout=timeout)
        except TimeoutError as exc:
            raise RuntimeError("Sandbox execution timeout") from exc

    def shutdown(self) -> None:
        self._executor.shutdown(wait=False)
