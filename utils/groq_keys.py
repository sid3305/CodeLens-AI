"""
A pool of Groq API keys (free tiers have small per-minute limits; several
keys spread the load).

Keys come from ``GROQ_API_KEYS`` (separated by commas, spaces or new lines)
and ``GROQ_API_KEY``; duplicates are dropped. Requests take keys in turn
(round robin). A key that hits its rate limit rests until its limit resets,
and a key Groq rejects is not used again until the backend restarts.

Keys are never logged or shown: only their position in the pool (#1, #2...).
"""

import os
import re
import threading
import time

DEFAULT_COOLDOWN_SECONDS = 60.0
MAX_COOLDOWN_SECONDS = 15 * 60.0


def configured_keys() -> tuple[str, ...]:
    raw = [os.getenv("GROQ_API_KEYS") or "", os.getenv("GROQ_API_KEY") or ""]
    keys: list[str] = []
    for value in raw:
        for key in re.split(r"[\s,;]+", value):
            if key and key not in keys:
                keys.append(key)
    return tuple(keys)


class KeyPool:
    def __init__(self, keys: tuple[str, ...], clock=time.monotonic):
        self.keys = keys
        self._clock = clock
        self._lock = threading.Lock()
        self._next = 0
        self._resting_until: dict[int, float] = {}
        self._rejected: set[int] = set()

    def __len__(self) -> int:
        return len(self.keys)

    def acquire(self, skip: set[int] = frozenset()) -> int | None:
        """The index of the next usable key (round robin), or None."""

        with self._lock:
            now = self._clock()
            for offset in range(len(self.keys)):
                index = (self._next + offset) % len(self.keys)
                if index in skip or index in self._rejected:
                    continue
                if self._resting_until.get(index, 0.0) > now:
                    continue
                self._next = (index + 1) % len(self.keys)
                return index
            return None

    def rest(self, index: int, seconds: float | None) -> None:
        seconds = DEFAULT_COOLDOWN_SECONDS if not seconds or seconds <= 0 else min(seconds, MAX_COOLDOWN_SECONDS)
        with self._lock:
            self._resting_until[index] = self._clock() + seconds

    def reject(self, index: int) -> None:
        with self._lock:
            self._rejected.add(index)

    def status(self) -> dict[str, int | float]:
        """Counts only, safe to show: usable, resting and rejected keys."""

        with self._lock:
            now = self._clock()
            resting = [until - now for i, until in self._resting_until.items() if until > now and i not in self._rejected]
            rejected = len(self._rejected)
            return {
                "total": len(self.keys),
                "usable": len(self.keys) - rejected - len(resting),
                "resting": len(resting),
                "rejected": rejected,
                "next_ready_seconds": round(min(resting), 1) if resting else 0.0,
            }


_pool: KeyPool | None = None
_pool_lock = threading.Lock()


def get_pool() -> KeyPool:
    """The shared pool; rebuilt when the configured keys change."""

    global _pool
    keys = configured_keys()
    with _pool_lock:
        if _pool is None or _pool.keys != keys:
            _pool = KeyPool(keys)
        return _pool


def retry_after_seconds(error: Exception) -> float | None:
    """Groq's retry-after header (seconds), when the error carries one."""

    response = getattr(error, "response", None)
    headers = getattr(response, "headers", None)
    if not headers:
        return None
    for name in ("retry-after", "x-ratelimit-reset-tokens", "x-ratelimit-reset-requests"):
        value = headers.get(name)
        if not value:
            continue
        seconds = _duration(str(value))
        if seconds is not None:
            return seconds
    return None


def _duration(text: str) -> float | None:
    """'12', '7.5s', '1m30s', '250ms' -> seconds."""

    try:
        return float(text)
    except ValueError:
        pass
    total = 0.0
    matched = False
    for amount, unit in re.findall(r"([\d.]+)(ms|h|m|s)", text):
        matched = True
        total += float(amount) * {"ms": 0.001, "s": 1, "m": 60, "h": 3600}[unit]
    return total if matched else None
