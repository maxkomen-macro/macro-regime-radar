"""tests/test_no_secret_in_logs.py — nothing secret reaches a log line (launch-1).

The deploy holds five secrets: the EODHD token, the Finnhub key, the Anthropic
key, the GitHub read token and the ops key. Provider tokens are the dangerous
ones because EODHD authenticates with a query parameter, and httpx logs whole
URLs at INFO. api/logsafe.py holds httpx at WARNING and redacts what slips
through; this pins it, on the paths that actually log.
"""

from __future__ import annotations

import logging

import httpx
import pytest

from api import logsafe
from api import stream
from api.providers import eodhd as eod
from api.providers import finnhub as fh
from api.providers.errors import ProviderError

SENTINELS = {
    "EODHD_API_TOKEN": "eodhd-SENTINEL-6f1a",
    "FINNHUB_API_KEY": "finnhub-SENTINEL-9c2b",
    "ANTHROPIC_API_KEY": "sk-ant-SENTINEL-4d7e",
    "GH_DB_TOKEN": "github-SENTINEL-1b8c",
    "OPS_ACCESS_KEY": "ops-SENTINEL-3a5d",
    "ASSISTANT_ACCESS_KEY": "assistant-SENTINEL-2e9f",
}


@pytest.fixture()
def secrets(monkeypatch):
    for k, v in SENTINELS.items():
        monkeypatch.setenv(k, v)
    logsafe.install()
    yield SENTINELS


def _assert_clean(text: str) -> None:
    for name, value in SENTINELS.items():
        assert value not in text, f"{name} reached a log line"
    assert "SENTINEL" not in text


def test_httpx_is_held_at_warning_so_urls_never_print(secrets, caplog):
    with caplog.at_level(logging.DEBUG):
        logging.getLogger("httpx").info(
            "HTTP Request: GET https://eodhd.com/api/eod/AAPL.US?api_token=%s&fmt=json", secrets["EODHD_API_TOKEN"]
        )
    _assert_clean(caplog.text)


def test_a_url_that_slips_through_is_redacted(secrets):
    line = f"HTTP Request: GET https://eodhd.com/api/eod/AAPL.US?api_token={secrets['EODHD_API_TOKEN']}&fmt=json"
    redacted = logsafe.redact(line)
    assert "api_token=***" in redacted
    _assert_clean(redacted)


def test_an_eodhd_failure_logs_and_raises_without_the_token(secrets, caplog):
    def handler(request: httpx.Request) -> httpx.Response:
        # The token is on the wire, as EODHD requires.
        assert request.url.params.get("api_token") == secrets["EODHD_API_TOKEN"]
        return httpx.Response(500, text=f"upstream said no for api_token={secrets['EODHD_API_TOKEN']}", request=request)

    client = eod.EodhdClient(secrets["EODHD_API_TOKEN"], max_retries=0, transport=httpx.MockTransport(handler))
    with caplog.at_level(logging.DEBUG):
        with pytest.raises(ProviderError) as ei:
            client.eod("AAPL.US", from_=None, to=None)
    _assert_clean(caplog.text)
    _assert_clean(str(ei.value.public))
    _assert_clean(str(getattr(ei.value, "detail", "")))


def test_a_finnhub_failure_never_carries_the_key(secrets, caplog):
    def handler(request: httpx.Request) -> httpx.Response:
        # The key rides in a header, so it cannot reach a URL at all.
        assert request.headers["X-Finnhub-Token"] == secrets["FINNHUB_API_KEY"]
        assert secrets["FINNHUB_API_KEY"] not in str(request.url)
        return httpx.Response(500, json={"error": "boom"}, request=request)

    fh.set_client_for_tests(fh.FinnhubClient(secrets["FINNHUB_API_KEY"], transport=httpx.MockTransport(handler)))
    try:
        with caplog.at_level(logging.DEBUG):
            with pytest.raises(ProviderError) as ei:
                fh.fundamentals("AAPL")
        _assert_clean(caplog.text)
        _assert_clean(str(ei.value.public) + str(getattr(ei.value, "detail", "")))
    finally:
        fh.set_client_for_tests(None)


def test_the_relay_redacts_its_own_token(secrets):
    hub = stream.QuoteHub()
    hub.token = secrets["EODHD_API_TOKEN"]
    text = hub._redact(f"cannot connect to wss://ws.eodhistoricaldata.com/ws/us?api_token={secrets['EODHD_API_TOKEN']}")
    _assert_clean(text)
    assert "***" in text


def test_the_startup_block_states_presence_only(secrets, caplog):
    from api import main as main_mod

    with caplog.at_level(logging.INFO):
        main_mod._log_startup_state()
    _assert_clean(caplog.text)
    assert "GH_DB_TOKEN yes" in caplog.text or "GH_DB_TOKEN no" in caplog.text


def test_the_ops_and_assistant_keys_never_reach_a_response(secrets):
    from fastapi.testclient import TestClient

    from api.main import app

    client = TestClient(app)
    r = client.get("/api/stream/debug")
    assert r.status_code == 401  # a key is configured, and none was sent
    _assert_clean(r.text)
    r = client.get("/api/stream/debug", headers={"X-Ops-Key": secrets["OPS_ACCESS_KEY"]})
    assert r.status_code == 200
    _assert_clean(r.text)
