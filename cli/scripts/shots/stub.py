#!/usr/bin/env python3
"""Stub of the nice-api-hub gateway, for screenshotting the real `nah` TUI."""
import json
import os
import sys
from urllib.parse import urlsplit
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8791
BASE = f"http://127.0.0.1:{PORT}"
TODAY = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).strftime("%Y-%m-%d")
ACCT = "11111111-1111-4111-8111-111111111111"


def js(w, status, obj):
    body = json.dumps(obj).encode()
    w.send_response(status)
    w.send_header("Content-Type", "application/json")
    w.send_header("Content-Length", str(len(body)))
    w.end_headers()
    w.wfile.write(body)


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        p = urlsplit(self.path).path
        if p == "/readyz":
            return js(self, 200, {"status": "ready", "checks": {"postgres": True, "redis": True}})
        if p == "/v1/platforms":
            return js(self, 200, {"data": [
                {"id": "tiktok", "name": "TikTok", "status": "operational"},
                {"id": "youtube", "name": "YouTube", "status": "degraded"},
                {"id": "twitter", "name": "X (Twitter)", "status": "operational"},
                {"id": "instagram", "name": "Instagram", "status": "operational"},
                {"id": "soundcloud", "name": "SoundCloud", "status": "operational"},
            ]})
        if p == "/v1/account":
            return js(self, 200, {"data": {"id": ACCT, "name": "Acme Corp", "plan": "pro",
                "limits": {"rps": 1.6667, "burst": 100, "dailyQuota": 10000},
                "platforms": None, "webhookSecret": "s"}})
        if p == "/v1/usage":
            return js(self, 200, {"data": {"plan": "pro",
                "limits": {"rps": 1.6667, "burst": 100, "dailyQuota": 10000},
                "platforms": None,
                "usage": [{"day": TODAY, "platform": "youtube", "requests": 250, "errors": 3, "cache_hits": 40, "rate_limited": 0},
                          {"day": TODAY, "platform": "soundcloud", "requests": 41, "errors": 0, "cache_hits": 12, "rate_limited": 0}]}})
        if p == "/v1/media":
            return js(self, 200, {"data": {
                "platform": "youtube",
                "sourceUrl": "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
                "title": "Big Buck Bunny",
                "author": "Blender Foundation",
                "thumbnail": f"{BASE}/thumb.png",
                "durationSeconds": 635,
                "variants": [
                    {"kind": "video", "url": f"{BASE}/v.mp4", "quality": "1080p", "codec": "avc1",
                     "height": 1080, "hasAudio": False, "protocol": "direct", "ext": "mp4", "sizeBytes": 245000000},
                    {"kind": "video", "url": f"{BASE}/v.mp4", "quality": "720p", "codec": "avc1",
                     "height": 720, "hasAudio": False, "protocol": "direct", "ext": "mp4", "sizeBytes": 96400000},
                    {"kind": "audio", "url": f"{BASE}/a.m4a", "quality": "128kbps", "codec": "mp4a",
                     "protocol": "direct", "ext": "m4a"},
                ],
                "provider": "ytdlp-youtube",
                "fetchedAt": "2026-09-19T15:00:00Z",
            }, "meta": {"requestId": "r", "cached": False, "tookMs": 11800}})
        if p == "/v1/download":
            body = b"fake-mp4-bytes-for-screenshot" * 4
            self.send_response(200)
            self.send_header("Content-Type", "video/mp4")
            self.send_header("Content-Disposition", 'attachment; filename="Big Buck Bunny.mp4"')
            self.send_header("Content-Length", str(len(body)))
            self.send_header("X-Download-Provider", "ytdlp-youtube")
            self.end_headers()
            self.wfile.write(body)
            return
        if p == "/v1/keys":
            return js(self, 200, {"data": [
                {"id": "k-laptop-1111", "accountId": ACCT, "label": "laptop", "prefix": "nah_live_lapt",
                 "environment": "live", "platforms": None, "createdAt": "2026-09-10T10:00:00Z",
                 "expiresAt": None, "revokedAt": None, "lastUsedAt": "2026-09-19T10:00:00Z",
                 "scopes": ["media"], "createdVia": "device", "current": True},
                {"id": "k-script-2222", "accountId": ACCT, "label": "backup-job", "prefix": "nah_live_scpt",
                 "environment": "live", "platforms": None, "createdAt": "2026-09-12T10:00:00Z",
                 "expiresAt": None, "revokedAt": None, "lastUsedAt": None,
                 "scopes": ["media"], "createdVia": "cli", "current": False},
            ]})
        if p == "/thumb.png":
            data = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "thumb.png"), "rb").read()
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        js(self, 404, {"type": "x", "title": "Not Found", "status": 404, "code": "not_found", "detail": p})

    def do_POST(self):
        js(self, 404, {"type": "x", "title": "Not Found", "status": 404, "code": "not_found", "detail": self.path})


if __name__ == "__main__":
    print(f"stub on {BASE}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
