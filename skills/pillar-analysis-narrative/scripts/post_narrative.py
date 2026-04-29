"""
Reference: PATCH the narrative memo back to the analysis row.
"""
import json
import sys
import urllib.request
import urllib.error

def post_narrative(webapp_url: str, analysis_id: str, token: str, narrative: str) -> dict:
    url = f"{webapp_url.rstrip('/')}/api/pillar-analysis/{analysis_id}/narrative"
    body = json.dumps({"narrative": narrative}).encode()
    req = urllib.request.Request(
        url, data=body, method="PATCH",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read())
        except (ValueError, OSError):
            body = {"error": "unparseable_response"}
        return {"_status": e.code, **body}
    except urllib.error.URLError as e:
        return {"_status": 0, "error": "network_error", "reason": str(e.reason)}

if __name__ == "__main__":
    webapp, aid, tok = sys.argv[1], sys.argv[2], sys.argv[3]
    narrative = sys.stdin.read()
    print(json.dumps(post_narrative(webapp, aid, tok, narrative), indent=2))
