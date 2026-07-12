#!/usr/bin/env python3
"""
er-handoff-memo unified transport — ONE executed CLI for all three er-seo-tools
skill handoffs (pillar-analysis / seo-roadmap / keyword-memo).

RUN this script. Do NOT rewrite it inline in the sandbox: re-deriving the fetch
is exactly how the User-Agent and the honest error handling got dropped before,
which made a Cloudflare WAF 403 look like an "egress allowlist" problem and sent
an analyst down the wrong path.

Usage:
  python3 handoff.py fetch    --webapp <url> --token <tok> --id <id>
  python3 handoff.py post     --webapp <url> --token <tok> --id <id> [--structured <json>] < doc.md
  python3 handoff.py volumes  --webapp <url> --token <tok> --id <id> --keywords '<json array>' [--idempotency-key <key>]
  python3 handoff.py page     --webapp <url> --token <tok> --id <id> --url <page-url>   (cat_ only)
  python3 handoff.py findings --webapp <url> --token <tok> --id <id> < findings.json    (cat_ only)

Routing is by token prefix:
  pat_ -> pillar-analysis   GET /api/pillar-analysis/{id}    PATCH .../narrative  field "narrative"
  srt_ -> seo-roadmap       GET /api/seo-roadmap/{id}        PATCH .../roadmap    field "roadmap"
  krt_ -> keyword-memo      GET /api/keyword-memo/{id}       PATCH .../memo       field "memo"
  kst_ -> keyword-strategy  GET /api/keyword-strategy/{id}   PATCH .../memo       field "memo"
                            POST .../volumes (billable volume lookup — `volumes` subcommand)
  cat_ -> content-audit     GET /api/content-audit/{id}/manifest  (`fetch`)
                            GET /api/content-audit/{id}/page?url=  (`page`, one page's stripped text)
                            PATCH /api/content-audit/{id}/findings (`findings`, structured — NOT a doc)

Always prints ONE JSON object to stdout and never raises to the caller. On
success: the API body. On failure: {"ok": false, "error_kind": "...", ...}
where error_kind is what the SKILL maps to user-facing copy.
"""
import argparse
import json
import sys
import urllib.request
import urllib.error
import urllib.parse
import uuid

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
    # kst_ MUST precede any future prefix that shares its first chars; the
    # volumes endpoint is BILLABLE (DataForSEO) — only kst_ tokens carry the
    # volume-lookup scope, and the server enforces it regardless.
    "kst_": {"workflow": "keyword-strategy",
             "get": "/api/keyword-strategy/{id}",
             "patch": "/api/keyword-strategy/{id}/memo", "field": "memo",
             "volumes": "/api/keyword-strategy/{id}/volumes"},
    # qct_ has no markdown post-back; its write-back is the `receipt` subcommand.
    "qct_": {"workflow": "quarter-push",
             "get": "/api/quarter-plan/push/{id}",
             "receipt": "/api/quarter-plan/push/{id}/receipt"},
    # cat_ (content audit) is manifest→pages→structured-findings, NOT a document.
    # `get` = the manifest (the `fetch` subcommand); `page` fetches one page's
    # stripped text; `findings` PATCHes the structured typed findings. No `field`
    # (the body is {findings:[...]}, not a single markdown string), so `post`
    # intentionally errors for cat_ — use the `findings` subcommand.
    "cat_": {"workflow": "content-audit",
             "get": "/api/content-audit/{id}/manifest",
             "page": "/api/content-audit/{id}/page",
             "findings": "/api/content-audit/{id}/findings"},
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
            "detail": "Token does not start with pat_/srt_/krt_/kst_/qct_/cat_ — cannot route. Re-copy the prompt."}


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
    if "patch" not in cfg:
        return {"ok": False, "error_kind": "wrong_command", "status": 0,
                "detail": ("This token has no document post-back — qct_ uses the `receipt` "
                           "subcommand; cat_ (content audit) uses the `findings` subcommand.")}
    payload = {cfg["field"]: sys.stdin.read()}
    if args.structured:
        try:
            payload["structured"] = json.loads(args.structured)
        except ValueError:
            return {"ok": False, "error_kind": "bad_structured_arg", "status": 0,
                    "detail": "--structured was not valid JSON."}
    url = args.webapp.rstrip("/") + cfg["patch"].format(id=args.id)
    return _request(url, "PATCH", args.token, data=json.dumps(payload).encode())


def cmd_volumes(args):
    cfg = route_for(args.token)
    if not cfg:
        return _unknown_prefix()
    if "volumes" not in cfg:
        return {"ok": False, "error_kind": "wrong_command", "status": 0,
                "detail": "`volumes` is only valid for kst_ (keyword strategy) tokens — "
                          "the volume-lookup scope exists only on that family."}
    try:
        keywords = json.loads(args.keywords)
    except ValueError:
        return {"ok": False, "error_kind": "bad_keywords_arg", "status": 0,
                "detail": "--keywords was not valid JSON."}
    if not isinstance(keywords, list) or not all(isinstance(k, str) for k in keywords):
        return {"ok": False, "error_kind": "bad_keywords_arg", "status": 0,
                "detail": "--keywords must be a JSON array of strings."}
    # One idempotency key per LOGICAL call. On a transport retry of the SAME
    # logical call, pass the printed key back via --idempotency-key: a settled
    # duplicate replays the stored result; a fresh ask uses a fresh key.
    key = args.idempotency_key or str(uuid.uuid4())
    payload = {"idempotencyKey": key, "keywords": keywords}
    url = args.webapp.rstrip("/") + cfg["volumes"].format(id=args.id)
    result = _request(url, "POST", args.token, data=json.dumps(payload).encode())
    if isinstance(result, dict):
        result.setdefault("idempotencyKey", key)
    return result


def cmd_page(args):
    """cat_ only: fetch ONE page's stripped main-content text from the manifest set.
    A 410 (text_unavailable) means the retention window closed — fall back to
    web-fetching the URL. A 404 means the URL isn't in this audit's eligible set."""
    cfg = route_for(args.token)
    if not cfg:
        return _unknown_prefix()
    if "page" not in cfg:
        return {"ok": False, "error_kind": "wrong_command", "status": 0,
                "detail": "`page` is only valid for cat_ (content audit) tokens."}
    qs = urllib.parse.urlencode({"url": args.url})
    url = args.webapp.rstrip("/") + cfg["page"].format(id=args.id) + "?" + qs
    return _request(url, "GET", args.token)


def cmd_findings(args):
    """cat_ only: PATCH the structured content-audit findings. Reads the findings
    from stdin — either a bare JSON array or an object {"findings":[...]}. The
    body sent is always {"findings":[...]} (last-writer-wins on the server)."""
    cfg = route_for(args.token)
    if not cfg:
        return _unknown_prefix()
    if "findings" not in cfg:
        return {"ok": False, "error_kind": "wrong_command", "status": 0,
                "detail": "`findings` is only valid for cat_ (content audit) tokens."}
    try:
        parsed = json.loads(sys.stdin.read())
    except ValueError:
        return {"ok": False, "error_kind": "bad_findings_body", "status": 0,
                "detail": "stdin was not valid JSON (expected a findings array or {\"findings\":[...]})."}
    if isinstance(parsed, dict) and "findings" in parsed:
        findings = parsed["findings"]
    else:
        findings = parsed
    if not isinstance(findings, list):
        return {"ok": False, "error_kind": "bad_findings_body", "status": 0,
                "detail": "findings must be a JSON array."}
    url = args.webapp.rstrip("/") + cfg["findings"].format(id=args.id)
    return _request(url, "PATCH", args.token, data=json.dumps({"findings": findings}).encode())


def cmd_receipt(args):
    cfg = route_for(args.token)
    if not cfg or "receipt" not in cfg:
        return {"ok": False, "error_kind": "wrong_command", "status": 0,
                "detail": "`receipt` is only valid for qct_ (quarter push) tokens."}
    try:
        counts = json.loads(args.counts)
    except ValueError:
        return {"ok": False, "error_kind": "bad_counts_arg", "status": 0,
                "detail": "--counts was not valid JSON."}
    url = args.webapp.rstrip("/") + cfg["receipt"].format(id=args.id)
    return _request(url, "POST", args.token, data=json.dumps(counts).encode())


def main():
    p = argparse.ArgumentParser(description="er-seo-tools unified handoff transport")
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("fetch", "post", "receipt", "volumes", "page", "findings"):
        sp = sub.add_parser(name)
        sp.add_argument("--webapp", required=True)
        sp.add_argument("--token", required=True)
        sp.add_argument("--id", required=True)
        if name == "post":
            sp.add_argument("--structured", default=None)
        if name == "receipt":
            sp.add_argument("--counts", required=True)
        if name == "volumes":
            sp.add_argument("--keywords", required=True)
            sp.add_argument("--idempotency-key", dest="idempotency_key", default=None)
        if name == "page":
            sp.add_argument("--url", required=True)
    args = p.parse_args()
    result = {"fetch": cmd_fetch, "post": cmd_post, "receipt": cmd_receipt,
              "volumes": cmd_volumes, "page": cmd_page, "findings": cmd_findings}[args.cmd](args)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
