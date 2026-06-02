#!/usr/bin/env python3
"""
er-handoff-memo unified transport — ONE executed CLI for all three er-seo-tools
skill handoffs (pillar-analysis / seo-roadmap / keyword-memo).

RUN this script. Do NOT rewrite it inline in the sandbox: re-deriving the fetch
is exactly how the User-Agent and the honest error handling got dropped before,
which made a Cloudflare WAF 403 look like an "egress allowlist" problem and sent
an analyst down the wrong path.

Usage:
  python3 handoff.py fetch --webapp <url> --token <tok> --id <id>
  python3 handoff.py post  --webapp <url> --token <tok> --id <id> [--structured <json>] < doc.md

Routing is by token prefix:
  pat_ -> pillar-analysis  GET /api/pillar-analysis/{id}   PATCH .../narrative  field "narrative"
  srt_ -> seo-roadmap      GET /api/seo-roadmap/{id}        PATCH .../roadmap    field "roadmap"
  krt_ -> keyword-memo     GET /api/keyword-memo/{id}       PATCH .../memo       field "memo"

Always prints ONE JSON object to stdout and never raises to the caller. On
success: the API body. On failure: {"ok": false, "error_kind": "...", ...}
where error_kind is what the SKILL maps to user-facing copy.
"""
import argparse
import json
import sys
import urllib.request
import urllib.error

# A real browser-ish UA. urllib's default ("Python-urllib/3.x") is 403'd by the
# Cloudflare WAF in front of the staging origin. Do not remove this.
USER_AGENT = "Mozilla/5.0 (er-handoff-memo; +https://enrollmentresources.com)"

ROUTES = {
    "pat_": {"workflow": "pillar-analysis",
             "get": "/api/pillar-analysis/{id}",
             "patch": "/api/pillar-analysis/{id}/narrative", "field": "narrative"},
    "srt_": {"workflow": "seo-roadmap",
             "get": "/api/seo-roadmap/{id}",
             "patch": "/api/seo-roadmap/{id}/roadmap", "field": "roadmap"},
    "krt_": {"workflow": "keyword-memo",
             "get": "/api/keyword-memo/{id}",
             "patch": "/api/keyword-memo/{id}/memo", "field": "memo"},
}


def route_for(token):
    for prefix, cfg in ROUTES.items():
        if token.startswith(prefix):
            return cfg
    return None


def _request(url, method, token, data=None):
    headers = {"Authorization": f"Bearer {token}", "User-Agent": USER_AGENT}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
            try:
                return json.loads(raw)
            except ValueError:
                return {"ok": False, "error_kind": "bad_response_body", "status": resp.status,
                        "detail": "Response was not JSON.",
                        "body_preview": raw[:300].decode("utf-8", "replace")}
    except urllib.error.HTTPError as e:
        return _classify_http_error(e, url)
    except urllib.error.URLError as e:
        # DNS / connection refused / TLS / timeout — never reached an HTTP layer.
        return {"ok": False, "error_kind": "network_unreachable", "status": 0,
                "detail": f"Could not reach {url}: {e.reason}"}


def _classify_http_error(e, url):
    hdrs = {k.lower(): v for k, v in (e.headers.items() if e.headers else [])}
    try:
        body = json.loads(e.read())
    except (ValueError, OSError):
        body = {}
    app_error = body.get("error") if isinstance(body, dict) else None
    is_cloudflare = ("cf-ray" in hdrs) or ("cloudflare" in hdrs.get("server", "").lower())

    # 403 — distinguish a Cloudflare/WAF block from a true egress-sandbox block.
    # Only call it egress when there is NO proxy evidence AND no app error body.
    if e.code == 403 and not app_error:
        if is_cloudflare:
            return {"ok": False, "error_kind": "cloudflare_waf", "status": 403,
                    "detail": ("Cloudflare WAF blocked the request (cf-ray present). Usually a "
                               "User-Agent/bot rule. This script already sends a browser UA; if it "
                               "still 403s, the WAF rule needs to allow /api/* for this client."),
                    "cf_ray": hdrs.get("cf-ray")}
        return {"ok": False, "error_kind": "egress_blocked", "status": 403,
                "detail": ("403 with no Cloudflare or app-error evidence — likely an egress sandbox "
                           "blocking the host. Run from Claude Code (local network), or have an "
                           "Anthropic org admin allowlist the domain.")}

    # App password-gate rejection (middleware) vs route-level token rejection.
    if app_error == "auth_required":
        return {"ok": False, "error_kind": "app_gate", "status": e.code,
                "detail": ("The app password gate rejected this BEFORE the token was checked — the "
                           "route is not allowlisted in middleware.ts. This is an app-side fix, not "
                           "a token problem.")}
    if app_error in ("auth_missing", "auth_malformed"):
        return {"ok": False, "error_kind": "token_missing", "status": e.code,
                "detail": "The endpoint received no usable token. Re-copy the prompt for a fresh token."}
    if isinstance(app_error, str) and app_error.startswith("token_"):
        return {"ok": False, "error_kind": app_error, "status": e.code,
                "detail": f"Token rejected by the route ({app_error}). Re-copy the prompt for a fresh token."}
    if e.code == 404:
        return {"ok": False, "error_kind": "not_found", "status": 404,
                "detail": "Record not found — the id may be wrong or the row was deleted."}
    if e.code == 400:
        return {"ok": False, "error_kind": "bad_request", "status": 400,
                "detail": "Request rejected (400) — likely body validation (e.g. doc too long).",
                "app_error": app_error}
    if e.code == 429:
        return {"ok": False, "error_kind": "rate_limited", "status": 429, "detail": "Rate limited; retry shortly."}
    if e.code >= 500:
        return {"ok": False, "error_kind": "server_error", "status": e.code,
                "detail": f"Server error {e.code}.", "app_error": app_error}
    return {"ok": False, "error_kind": app_error or "http_error", "status": e.code,
            "detail": f"HTTP {e.code}.", "app_error": app_error}


def _unknown_prefix():
    return {"ok": False, "error_kind": "unknown_token_prefix", "status": 0,
            "detail": "Token does not start with pat_/srt_/krt_ — cannot route. Re-copy the prompt."}


def cmd_fetch(args):
    cfg = route_for(args.token)
    if not cfg:
        return _unknown_prefix()
    url = args.webapp.rstrip("/") + cfg["get"].format(id=args.id)
    return _request(url, "GET", args.token)


def cmd_post(args):
    cfg = route_for(args.token)
    if not cfg:
        return _unknown_prefix()
    payload = {cfg["field"]: sys.stdin.read()}
    if args.structured:
        try:
            payload["structured"] = json.loads(args.structured)
        except ValueError:
            return {"ok": False, "error_kind": "bad_structured_arg", "status": 0,
                    "detail": "--structured was not valid JSON."}
    url = args.webapp.rstrip("/") + cfg["patch"].format(id=args.id)
    return _request(url, "PATCH", args.token, data=json.dumps(payload).encode())


def main():
    p = argparse.ArgumentParser(description="er-seo-tools unified handoff transport")
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("fetch", "post"):
        sp = sub.add_parser(name)
        sp.add_argument("--webapp", required=True)
        sp.add_argument("--token", required=True)
        sp.add_argument("--id", required=True)
        if name == "post":
            sp.add_argument("--structured", default=None)
    args = p.parse_args()
    result = cmd_fetch(args) if args.cmd == "fetch" else cmd_post(args)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
