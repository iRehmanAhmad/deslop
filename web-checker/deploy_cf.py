#!/usr/bin/env python3
"""Deploy the deslop-checker Worker via the Cloudflare API.

Modeled on the ReIndexer deploy (custom.backlink-indexer/bin/cf_deploy.py):
multipart module upload with the custom.cloudflare surrogate credential.
Uploads worker.js + engine.js as modules, then:
  1. tries to attach the custom domain deslop-checker.rehmanahmad.com,
  2. enables the workers.dev subdomain as a fallback route.
Does not touch any other Worker, route or secret.
"""
import json
import sys
import urllib.error
import urllib.request
import uuid

sys.path.insert(0, "/opt/muse/skills/custom-connector-setup/bin")
from dynamic_credentials import add_surrogate_to_request, read_json_response  # noqa: E402

API = "https://api.cloudflare.com/client/v4"
ACCT = "3c1481e4bc4e8ed685b35584b5e074c5"
SCRIPT = "deslop-checker"
HOSTNAME = "deslop-checker.rehmanahmad.com"
HERE = "/home/hatch/workspace/deslop-repo/web-checker"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise RuntimeError("redirect refused")


def call(method, path, data=None, content_type=None):
    headers = {}
    if content_type:
        headers["Content-Type"] = content_type
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    add_surrogate_to_request(req, "custom.cloudflare", allowed_hosts=("api.cloudflare.com",))
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=90) as resp:
            return resp.status, read_json_response(resp)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8", "replace"))
        except Exception:
            return e.code, {}


def main() -> None:
    worker = open(f"{HERE}/worker.js", "rb").read()
    engine = open(f"{HERE}/engine.js", "rb").read()
    boundary = "----deslop" + uuid.uuid4().hex
    parts = []

    def part(name, body, filename=None, ctype=None):
        disp = f'Content-Disposition: form-data; name="{name}"'
        if filename:
            disp += f'; filename="{filename}"'
        head = f"--{boundary}\r\n{disp}\r\n"
        if ctype:
            head += f"Content-Type: {ctype}\r\n"
        parts.append(head.encode() + b"\r\n" + body + b"\r\n")

    part("metadata", json.dumps({
        "main_module": "worker.js",
        "compatibility_date": "2025-06-01",
    }).encode(), ctype="application/json")
    part("worker.js", worker, filename="worker.js", ctype="application/javascript+module")
    part("engine.js", engine, filename="engine.js", ctype="application/javascript+module")
    parts.append(f"--{boundary}--\r\n".encode())

    status, out = call("PUT", f"/accounts/{ACCT}/workers/scripts/{SCRIPT}",
                       data=b"".join(parts),
                       content_type=f"multipart/form-data; boundary={boundary}")
    print("UPLOAD:", status, "success:", out.get("success"), "errors:", out.get("errors"))
    if not out.get("success"):
        raise SystemExit("upload failed — stopping")

    # workers.dev fallback route first (harmless if custom domain also works)
    status, out = call("POST", f"/accounts/{ACCT}/workers/scripts/{SCRIPT}/subdomain",
                       data=json.dumps({"enabled": True}).encode(),
                       content_type="application/json")
    print("SUBDOMAIN ENABLE:", status, "success:", out.get("success"), "errors:", out.get("errors"))
    status, out = call("GET", f"/accounts/{ACCT}/workers/subdomain")
    acct_sub = (out.get("result") or {}).get("subdomain")
    if acct_sub:
        print("WORKERS_DEV_URL:", f"https://{SCRIPT}.{acct_sub}.workers.dev")

    # custom domain
    status, out = call("GET", "/zones?name=rehmanahmad.com")
    zones = out.get("result") or []
    if not zones:
        print("CUSTOM DOMAIN: zone rehmanahmad.com not found — skipping")
        return
    zone_id = zones[0]["id"]
    status, out = call("PUT", f"/zones/{zone_id}/workers/domains",
                       data=json.dumps({
                           "hostname": HOSTNAME,
                           "service": SCRIPT,
                           "environment": "production",
                       }).encode(),
                       content_type="application/json")
    print("CUSTOM DOMAIN:", status, "success:", out.get("success"),
          "errors:", out.get("errors"), "result:", out.get("result"))


if __name__ == "__main__":
    main()
