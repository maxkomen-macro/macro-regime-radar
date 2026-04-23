"""src/analytics/perplexity.py — Perplexity Sonar research client.

Thin wrapper around the Perplexity Sonar chat-completions endpoint used by
the news pipeline and daily memo for grounded, source-cited research.

Every call is wrapped in try/except and returns an empty payload on any
failure (missing key, network error, malformed response), so the existing
pipeline is never broken by a Perplexity outage.
"""

from __future__ import annotations

import requests

_API_URL = "https://api.perplexity.ai/chat/completions"
_MODEL   = "sonar"


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
    if not api_key or not query:
        return {"content": "", "citations": []}

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
        resp.raise_for_status()
        data = resp.json()

        content = (
            data.get("choices", [{}])[0]
                .get("message", {})
                .get("content", "")
                or ""
        ).strip()

        raw_citations = data.get("citations") or data.get("search_results") or []
        citations: list[str] = []
        for c in raw_citations:
            if isinstance(c, str):
                citations.append(c)
            elif isinstance(c, dict):
                url = c.get("url") or c.get("link") or ""
                if url:
                    citations.append(url)
        return {"content": content, "citations": citations}
    except Exception:
        return {"content": "", "citations": []}


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
