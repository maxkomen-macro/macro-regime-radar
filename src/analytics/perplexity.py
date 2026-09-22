"""src/analytics/perplexity.py — Perplexity Sonar research client.

Thin wrapper around the Perplexity Sonar chat-completions endpoint used by
the news pipeline and daily memo for grounded, source-cited research.

`sonar_call` never raises and returns what the spend ledger needs (usage,
HTTP status, a short error label, finish reason). `sonar_research` keeps the
original contract: content and citations, or an empty payload on any failure
(missing key, network error, malformed response), so the pipeline is never
broken by a Perplexity outage.
"""

from __future__ import annotations

import requests

_API_URL = "https://api.perplexity.ai/chat/completions"
_MODEL   = "sonar"


def _citations(data: dict) -> list[str]:
    raw_citations = data.get("citations") or data.get("search_results") or []
    citations: list[str] = []
    for c in raw_citations:
        if isinstance(c, str):
            citations.append(c)
        elif isinstance(c, dict):
            url = c.get("url") or c.get("link") or ""
            if url:
                citations.append(url)
    return citations


def sonar_call(
    query: str,
    system_prompt: str,
    api_key: str,
    max_tokens: int = 350,
    timeout: int = 20,
) -> dict:
    """One Sonar request, with what the spend ledger needs.

    Returns
    -------
    dict
        {"ok": bool, "content": str, "citations": list[str], "usage": dict | None,
         "model": str, "http_status": int | None, "error": str | None,
         "finish_reason": str | None}. `ok` means a 2xx reply that parsed.
        `error` is a short label (an exception class name, "http",
        "bad_json", "not_called"), never exception text, which can carry a URL.
    """
    out = {
        "ok": False, "content": "", "citations": [], "usage": None, "model": _MODEL,
        "http_status": None, "error": None, "finish_reason": None,
    }
    if not api_key or not query:
        out["error"] = "not_called"
        return out
    try:
        resp = requests.post(
            _API_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type":  "application/json",
            },
            json={
                "model":      _MODEL,
                "max_tokens": max_tokens,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user",   "content": query},
                ],
            },
            timeout=timeout,
        )
    except Exception as exc:
        out["error"] = type(exc).__name__
        return out
    try:
        status = resp.status_code if isinstance(resp.status_code, int) else None
        out["http_status"] = status
        try:
            data = resp.json()
        except Exception:
            data = None
        if isinstance(data, dict) and isinstance(data.get("usage"), dict):
            out["usage"] = data["usage"]
        if status is None or not 200 <= status < 300:
            out["error"] = "http"
            return out
        if not isinstance(data, dict):
            out["error"] = "bad_json"
            return out
        choice = (data.get("choices") or [{}])[0] or {}
        out["content"] = ((choice.get("message") or {}).get("content") or "").strip()
        out["finish_reason"] = choice.get("finish_reason")
        out["citations"] = _citations(data)
        out["model"] = data.get("model") or _MODEL
        out["ok"] = True
    except Exception as exc:
        out["ok"] = False
        out["error"] = type(exc).__name__
    return out


def sonar_research(
    query: str,
    system_prompt: str,
    api_key: str,
    max_tokens: int = 350,
    timeout: int = 20,
) -> dict:
    """Call Perplexity Sonar and return grounded research with citations.

    Returns
    -------
    dict
        {"content": str, "citations": list[str]}.
        Empty content and citations on any failure.
    """
    res = sonar_call(query, system_prompt, api_key, max_tokens=max_tokens, timeout=timeout)
    if not res["ok"]:
        return {"content": "", "citations": []}
    return {"content": res["content"], "citations": res["citations"]}


def format_with_citations(result: dict, max_sources: int = 5) -> str:
    """Append a `Sources:` section to the research content.

    Used by news.py when persisting to `news_feed.perplexity_research` so
    the dashboard detail card can render the sources inline.
    """
    content = (result or {}).get("content", "").strip()
    if not content:
        return ""
    citations = (result or {}).get("citations", []) or []
    if not citations:
        return content
    sources_block = "\n\nSources:\n" + "\n".join(
        f"- {url}" for url in citations[:max_sources]
    )
    return content + sources_block
