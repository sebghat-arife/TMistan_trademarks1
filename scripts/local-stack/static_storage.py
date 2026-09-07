#!/usr/bin/env python3
"""LOCAL DEV: serve ./local-storage/<bucket>/<path> like Supabase Storage's public URLs."""
import http.server, os, sys, functools
root = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "..", "local-storage")
port = int(sys.argv[2]) if len(sys.argv) > 2 else 54322
class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".webp": "image/webp"}
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "public, max-age=3600")
        super().end_headers()
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(("0.0.0.0", port), functools.partial(H, directory=os.path.abspath(root))).serve_forever()
