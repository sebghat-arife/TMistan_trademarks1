#!/usr/bin/env python3
"""LOCAL DEV ONLY: a tiny stand-in for Supabase Storage.

Serves ./local-storage/<bucket>/<path> like Supabase's public object URLs and
accepts the subset of the Storage API that the Admin Import Center uses, so the
whole import flow can be rehearsed offline:

    GET    /<bucket>/<path>                     public object (VITE_LOCAL_STORAGE_BASE)
    GET    /object/public/<bucket>/<path>       same, Supabase-style URL
    POST   /object/<bucket>/<path>              upload (multipart or raw body, x-upsert)
    DELETE /object/<bucket>                     JSON {"prefixes": [..]}

There is NO authentication here beyond requiring *some* bearer token on writes;
never expose this server outside a developer machine. Production uses the real
Supabase Storage service, where storage.objects RLS (migration 0400) restricts
writes to administrators.
"""
import functools
import http.server
import json
import os
import shutil
import sys
from email.parser import BytesParser
from email.policy import default as email_policy

root = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "..", "local-storage")
port = int(sys.argv[2]) if len(sys.argv) > 2 else 54322
root = os.path.abspath(root)
os.makedirs(root, exist_ok=True)


class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".webp": "image/webp"}

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        if self.command == "GET":
            self.send_header("Cache-Control", "public, max-age=60")
        super().end_headers()

    def log_message(self, *a):
        pass

    # ----------------------------------------------------------------- helpers
    def _json(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _safe_path(self, bucket, key):
        target = os.path.abspath(os.path.join(root, bucket, key))
        if not target.startswith(root + os.sep) or ".." in key.split("/"):
            return None
        return target

    def _object_parts(self):
        # /object/<bucket>/<key...>   (query string ignored)
        path = self.path.split("?", 1)[0]
        if not path.startswith("/object/"):
            return None, None
        rest = path[len("/object/"):]
        if rest.startswith("public/"):
            rest = rest[len("public/"):]
        bucket, _, key = rest.partition("/")
        return bucket, key

    # ------------------------------------------------------------------ routes
    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        bucket, key = self._object_parts()
        if bucket is not None:
            target = self._safe_path(bucket, key) if key else None
            if not target or not os.path.isfile(target):
                return self._json(400, {"statusCode": "404", "error": "not_found", "message": "Object not found"})
            self.path = "/" + bucket + "/" + key
        return super().do_GET()

    def do_POST(self):
        bucket, key = self._object_parts()
        if bucket is None or not key:
            return self._json(404, {"error": "not_found", "message": "unknown route"})
        if not self.headers.get("Authorization", "").startswith("Bearer "):
            return self._json(401, {"statusCode": "401", "error": "Unauthorized", "message": "missing bearer token"})
        target = self._safe_path(bucket, key)
        if not target:
            return self._json(400, {"error": "invalid_key", "message": "invalid object key"})
        upsert = self.headers.get("x-upsert", "false").lower() == "true"
        if os.path.exists(target) and not upsert:
            return self._json(400, {"statusCode": "409", "error": "Duplicate", "message": "The resource already exists"})
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length)
        ctype = self.headers.get("Content-Type", "application/octet-stream")
        body = raw
        if ctype.startswith("multipart/form-data"):
            msg = BytesParser(policy=email_policy).parsebytes(b"Content-Type: " + ctype.encode() + b"\r\n\r\n" + raw)
            body = None
            for part in msg.iter_parts():
                if part.get_filename() is not None or part.get_param("name", header="content-disposition") in ("", None):
                    body = part.get_payload(decode=True)
            if body is None:
                return self._json(400, {"error": "invalid_body", "message": "no file part"})
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "wb") as f:
            f.write(body)
        return self._json(200, {"Key": f"{bucket}/{key}", "Id": key})

    def do_DELETE(self):
        bucket, key = self._object_parts()
        if bucket is None:
            return self._json(404, {"error": "not_found", "message": "unknown route"})
        if not self.headers.get("Authorization", "").startswith("Bearer "):
            return self._json(401, {"statusCode": "401", "error": "Unauthorized", "message": "missing bearer token"})
        length = int(self.headers.get("Content-Length", "0"))
        prefixes = []
        if key:
            prefixes = [key]
        elif length:
            try:
                prefixes = json.loads(self.rfile.read(length)).get("prefixes", [])
            except json.JSONDecodeError:
                return self._json(400, {"error": "invalid_body", "message": "expected JSON"})
        removed = []
        for p in prefixes:
            target = self._safe_path(bucket, p)
            if target and os.path.isfile(target):
                os.remove(target)
                removed.append({"name": p, "bucket_id": bucket})
        return self._json(200, removed)


if __name__ == "__main__":
    shutil.os.makedirs(root, exist_ok=True)
    print(f"local storage: {root} on 0.0.0.0:{port}")
    http.server.ThreadingHTTPServer(("0.0.0.0", port), functools.partial(H, directory=root)).serve_forever()
