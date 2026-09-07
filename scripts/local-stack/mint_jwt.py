#!/usr/bin/env python3
"""Mint HS256 JWTs for the LOCAL dev stack (PostgREST).

Mirrors what the Supabase CLI does locally: one long-lived `anon` token for the
browser and one `service_role` token for trusted importers.

    python3 mint_jwt.py anon
    python3 mint_jwt.py service_role
    python3 mint_jwt.py authenticated <user-uuid>   # emulates a signed-in user
"""
import base64
import hashlib
import hmac
import json
import sys
import time

# Same default secret the Supabase CLI uses for local projects.
SECRET = "super-secret-jwt-token-with-at-least-32-characters-long"


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def mint(role: str, years: int = 10, sub: str | None = None) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "role": role,
        "iss": "afg-registry-local",
        "iat": int(time.time()),
        "exp": int(time.time()) + years * 365 * 24 * 3600,
    }
    if sub:
        payload["sub"] = sub
    signing_input = f"{b64(json.dumps(header, separators=(',', ':')).encode())}.{b64(json.dumps(payload, separators=(',', ':')).encode())}"
    sig = hmac.new(SECRET.encode(), signing_input.encode(), hashlib.sha256).digest()
    return f"{signing_input}.{b64(sig)}"


if __name__ == "__main__":
    role = sys.argv[1] if len(sys.argv) > 1 else "anon"
    sub = sys.argv[2] if len(sys.argv) > 2 else None
    print(mint(role, sub=sub))
