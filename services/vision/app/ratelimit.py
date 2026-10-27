"""Tiny in-memory token bucket per client address (single-instance service)."""
from __future__ import annotations

import threading
import time


class RateLimiter:
    def __init__(self, per_minute: int = 20, burst: int = 10):
        self.per_minute = max(1, per_minute)
        self.burst = max(1, burst)
        self._buckets: dict[str, tuple[float, float]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.time()
        rate = self.per_minute / 60.0
        with self._lock:
            tokens, last = self._buckets.get(key, (float(self.burst), now))
            tokens = min(float(self.burst), tokens + (now - last) * rate)
            if tokens < 1.0:
                self._buckets[key] = (tokens, now)
                return False
            self._buckets[key] = (tokens - 1.0, now)
            if len(self._buckets) > 5000:  # forget idle clients
                cutoff = now - 600
                self._buckets = {k: v for k, v in self._buckets.items() if v[1] > cutoff}
            return True
