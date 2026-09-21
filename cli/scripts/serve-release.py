#!/usr/bin/env python3
"""A stand-in for GitHub Releases, for testing the installers and `nah update` without publishing anything.

    serve-release.py DIST_DIR VERSION [--port-file FILE]

Serves the files of DIST_DIR under /dl/ and a list of releases at /releases with the same shape as the GitHub API
(tag_name, draft, prerelease, assets[].name / browser_download_url). Prints the base URL, then serves until killed.
Standard library only, so it runs unchanged on Linux, macOS and Windows runners.
"""
import http.server
import json
import os
import socketserver
import sys
import threading


def main():
    args = sys.argv[1:]
    port_file = None
    if "--port-file" in args:
        i = args.index("--port-file")
        port_file = args[i + 1]
        del args[i : i + 2]
    if len(args) != 2:
        sys.exit(__doc__)
    dist, version = os.path.abspath(args[0]), args[1]

    class Handler(http.server.SimpleHTTPRequestHandler):
        def translate_path(self, path):
            path = path.split("?", 1)[0]
            if path.startswith("/dl/"):
                return os.path.join(dist, os.path.basename(path))
            return os.path.join(dist, "__missing__")

        def do_GET(self):
            if self.path.split("?", 1)[0] == "/releases":
                base = "http://127.0.0.1:%d" % self.server.server_address[1]
                assets = [
                    {"name": n, "browser_download_url": "%s/dl/%s" % (base, n), "size": os.path.getsize(os.path.join(dist, n))}
                    for n in sorted(os.listdir(dist))
                    if os.path.isfile(os.path.join(dist, n))
                ]
                body = json.dumps(
                    [{"tag_name": "cli/v" + version, "name": "nah " + version, "draft": False, "prerelease": "-" in version, "assets": assets}]
                ).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            return super().do_GET()

        def log_message(self, *a):  # keep the test output readable
            pass

    class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
        daemon_threads = True

        def server_bind(self):
            # HTTPServer.server_bind() asks the network for the reverse-DNS name of the address, which can take many seconds
            # (macOS runners) and is useless for a server on 127.0.0.1: bind without it.
            socketserver.TCPServer.server_bind(self)
            self.server_name, self.server_port = self.server_address[0], self.server_address[1]

    server = Server(("127.0.0.1", 0), Handler)
    base = "http://127.0.0.1:%d" % server.server_address[1]
    if port_file:
        with open(port_file, "w") as f:
            f.write(str(server.server_address[1]))
    print(base, flush=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
