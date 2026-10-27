"""Minimal PostgREST / Storage client.

The service holds NO privileged database credential by default: administrative
RPCs are called with the *administrator's own* Supabase access token, which the
browser sends along with the request, and the database functions enforce the
administrator role themselves (admin_assert). An optional service-role key can
be supplied through the environment for unattended CLI indexing runs only.
"""
from __future__ import annotations

import json
import os
from typing import Any

import httpx


class RpcError(RuntimeError):
    def __init__(self, status: int, payload: Any):
        self.status = status
        self.payload = payload
        msg = payload.get("message") if isinstance(payload, dict) else str(payload)
        super().__init__(msg or f"HTTP {status}")

    @property
    def code(self) -> str | None:
        return self.payload.get("code") if isinstance(self.payload, dict) else None


class Supabase:
    def __init__(self, url: str | None = None, anon_key: str | None = None, timeout: float = 60.0):
        self.url = (url or os.environ.get("SUPABASE_URL", "")).rstrip("/")
        self.rest_url = os.environ.get("SUPABASE_REST_URL", "").rstrip("/") or f"{self.url}/rest/v1"
        self.anon_key = anon_key or os.environ.get("SUPABASE_PUBLISHABLE_KEY") or os.environ.get("SUPABASE_ANON_KEY", "")
        self.timeout = timeout

    @property
    def configured(self) -> bool:
        return bool(self.url and self.anon_key)

    def rpc(self, fn: str, args: dict, bearer: str | None) -> Any:
        if not self.configured:
            raise RpcError(503, {"message": "SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY are not configured on the vision service"})
        headers = {
            "apikey": self.anon_key,
            "Authorization": f"Bearer {bearer or self.anon_key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }
        with httpx.Client(timeout=self.timeout) as c:
            r = c.post(f"{self.rest_url}/rpc/{fn}", headers=headers, content=json.dumps(args))
        if r.status_code >= 400:
            try:
                payload = r.json()
            except ValueError:
                payload = {"message": r.text[:300]}
            raise RpcError(r.status_code, payload)
        if not r.content:
            return None
        return r.json()

    def public_object_url(self, bucket: str, path: str) -> str:
        base = os.environ.get("STORAGE_PUBLIC_BASE", "").rstrip("/") or f"{self.url}/storage/v1/object/public"
        return f"{base}/{bucket}/{path}"

    def download(self, bucket: str, path: str, max_bytes: int) -> bytes:
        with httpx.Client(timeout=self.timeout, follow_redirects=True) as c:
            with c.stream("GET", self.public_object_url(bucket, path)) as r:
                if r.status_code >= 400:
                    raise RuntimeError(f"Download failed (HTTP {r.status_code})")
                buf = bytearray()
                for chunk in r.iter_bytes():
                    buf.extend(chunk)
                    if len(buf) > max_bytes:
                        raise RuntimeError("Object larger than the configured limit")
        return bytes(buf)
