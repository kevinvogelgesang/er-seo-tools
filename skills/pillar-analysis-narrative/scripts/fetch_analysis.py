"""
Reference: GET the structured pillar analysis for the given access token.

The skill model reads this file to understand the API shape, then writes
equivalent code in its code-execution sandbox.
"""
import json
import sys
import urllib.request
import urllib.error

def fetch_analysis(webapp_url: str, analysis_id: str, token: str) -> dict:
    url = f"{webapp_url.rstrip('/')}/api/pillar-analysis/{analysis_id}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        # 403 from cloud-Claude egress proxies (not from our webapp) typically
        # means the host isn't on the bash sandbox's allowlist. Surface the
        # response headers so the analyst can see exactly what blocked the
        # request without a second debugging round-trip.
        if e.code == 403:
            headers = {k.lower(): v for k, v in (e.headers.items() if e.headers else [])}
            return {
                "_status": 403,
                "error": "network_blocked",
                "reason": (
                    "Egress proxy blocked the request before it reached the webapp. "
                    "If you're in Claude Desktop / web / cloud sandbox, the host "
                    "is not on the bash sandbox allowlist. Switch to Claude Code "
                    "(local network) or have an Anthropic org admin add the domain."
                ),
                "host": webapp_url,
                "response_headers": headers,
            }
        # Surface the structured error body for the skill to map to user-facing copy.
        try:
            body = json.loads(e.read())
        except (ValueError, OSError):
            body = {"error": "unparseable_response"}
        return {"_status": e.code, **body}
    except urllib.error.URLError as e:
        # Network-level failure (DNS, refused, timeout). No structured body.
        return {"_status": 0, "error": "network_error", "reason": str(e.reason)}

if __name__ == "__main__":
    webapp, aid, tok = sys.argv[1], sys.argv[2], sys.argv[3]
    print(json.dumps(fetch_analysis(webapp, aid, tok), indent=2))
