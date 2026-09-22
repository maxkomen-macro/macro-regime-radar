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


# ── launch-1 verify loop 1 (item 3) ─────────────────────────────────────────


def _handler_with_filter() -> tuple[logging.Handler, "io.StringIO"]:
    import io

    buf = io.StringIO()
    h = logging.StreamHandler(buf)
    h.setFormatter(logging.Formatter("%(levelname)s %(name)s %(message)s"))
    h.addFilter(logsafe.RedactingFilter())
    return h, buf


def test_the_filter_redacts_a_real_httpx_record_with_a_url_object(secrets):
    """httpx logs the URL as an httpx.URL, not a str; the filter used to look
    at string arguments only, so at INFO the token printed in full."""
    h, buf = _handler_with_filter()
    lg = logging.getLogger("httpx")
    old_level = lg.level
    lg.addHandler(h)
    lg.setLevel(logging.INFO)
    try:
        transport = httpx.MockTransport(lambda r: httpx.Response(200, json={}, request=r))
        with httpx.Client(transport=transport) as c:
            c.get("https://eodhd.com/api/real-time/AAPL.US", params={"api_token": secrets["EODHD_API_TOKEN"], "fmt": "json"})
    finally:
        lg.removeHandler(h)
        lg.setLevel(old_level)
    assert "HTTP Request" in buf.getvalue()
    _assert_clean(buf.getvalue())


def test_the_filter_redacts_a_traceback(secrets):
    h, buf = _handler_with_filter()
    lg = logging.getLogger("mrr.test.traceback")
    lg.addHandler(h)
    try:
        try:
            raise RuntimeError(f"GET https://eodhd.com/api/eod/AAPL.US?api_token={secrets['EODHD_API_TOKEN']}")
        except RuntimeError:
            lg.exception("provider call failed")
    finally:
        lg.removeHandler(h)
    assert "Traceback" in buf.getvalue()
    _assert_clean(buf.getvalue())


def test_signed_download_urls_are_redacted():
    line = ("https://release-assets.githubusercontent.com/x/1/abc?sp=r&se=2026&sig=SIG-SENTINEL&jwt=JWT-SENTINEL"
            "&X-Amz-Credential=AMZ-CRED-SENTINEL&X-Amz-Signature=AMZ-SIG-SENTINEL")
    assert "SENTINEL" not in logsafe.redact(line)


def test_handlers_that_existed_before_install_get_the_filter():
    """uvicorn builds its handlers before the app is imported; install()
    must reach them, not only the root logger's."""
    lg = logging.getLogger("uvicorn.error.launch1test")
    h = logging.StreamHandler()
    lg.handlers.append(h)  # attached without the addHandler hook, as dictConfig-era handlers are
    try:
        logsafe.install()
        assert any(isinstance(f, logsafe.RedactingFilter) for f in h.filters)
    finally:
        lg.handlers.remove(h)


def test_a_token_with_a_trailing_newline_never_reaches_status_or_a_log(monkeypatch, caplog, tmp_path):
    """Defect 1: a GH_DB_TOKEN pasted with a newline made h11 reject the
    header with the token in the message; the text went to the log and to
    the public /api/freshness through bootstrap.last_error."""
    from api import bootstrap, db

    monkeypatch.setenv("GH_DB_TOKEN", "github-SENTINEL-1b8c\n")
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "macro_radar.db")
    assert bootstrap._token() == "github-SENTINEL-1b8c"

    def boom(request):
        raise httpx.LocalProtocolError(f"Illegal header value b'Bearer {request.headers.get('authorization', '')[7:]}\\n'")

    monkeypatch.setattr(bootstrap, "_transport", httpx.MockTransport(boom))
    with caplog.at_level(logging.DEBUG):
        with pytest.raises(Exception):
            bootstrap.refresh_db()
    status_text = str(bootstrap.status())
    assert "SENTINEL" not in status_text and "SENTINEL" not in caplog.text
    assert bootstrap.status()["last_error"]


def test_a_failed_signed_download_keeps_the_url_out_of_status(monkeypatch, caplog, tmp_path):
    from api import bootstrap, db

    monkeypatch.setenv("GH_DB_TOKEN", "github-SENTINEL-1b8c")
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "macro_radar.db")
    signed = "https://release-assets.githubusercontent.com/x/1/abc?sp=r&sig=SIG-SENTINEL&jwt=JWT-SENTINEL"

    def handler(req):
        if req.url.path.endswith("/releases/tags/data-latest"):
            return httpx.Response(200, json={"assets": [{"name": "macro_radar.db", "id": 1, "size": 10,
                                                         "updated_at": "2026-09-21T00:00:00Z",
                                                         "url": "https://api.github.com/repos/x/y/releases/assets/1"}]}, request=req)
        if req.url.host == "api.github.com":
            return httpx.Response(302, headers={"Location": signed}, request=req)
        return httpx.Response(503, text="upstream", request=req)

    monkeypatch.setattr(bootstrap, "_transport", httpx.MockTransport(handler))
    with caplog.at_level(logging.DEBUG):
        with pytest.raises(Exception):
            bootstrap.refresh_db()
    status_text = str(bootstrap.status())
    assert "SENTINEL" not in status_text and "SENTINEL" not in caplog.text
    assert "503" in str(bootstrap.status()["last_error"])


def test_uvicorns_own_formatters_still_work_with_the_filter(secrets, capsys):
    """Item 3 verify loop 2: clearing record.args broke uvicorn's access
    formatter (it unpacks five args) on every request, and its coloured
    startup lines printed raw placeholders. The filter keeps the args' shape
    and redacts inside them."""
    import copy
    import io
    import logging.config

    from uvicorn.config import LOGGING_CONFIG

    cfg = copy.deepcopy(LOGGING_CONFIG)
    buf = io.StringIO()
    for h in cfg["handlers"].values():
        h["class"] = "logging.StreamHandler"
        h["stream"] = buf
    logging.config.dictConfig(cfg)
    try:
        logsafe.install()
        access = logging.getLogger("uvicorn.access")
        access.info('%s - "%s %s HTTP/%s" %d', "203.0.113.7:51234", "GET",
                    f"/api/eod/AAPL.US?api_token={secrets['EODHD_API_TOKEN']}", "1.1", 200)
        logging.getLogger("uvicorn.error").info(
            "Uvicorn running on %s://%s:%d (Press CTRL+C to quit)", "http", "0.0.0.0", 8000,
            extra={"color_message": "Uvicorn running on %s://%s:%d (Press CTRL+C to quit)"})
    finally:
        logging.config.dictConfig({"version": 1, "disable_existing_loggers": False})
    out = buf.getvalue()
    err = capsys.readouterr().err
    assert "Logging error" not in err and "TypeError" not in err, err
    assert '"GET /api/eod/AAPL.US?api_token=*** HTTP/1.1" 200' in out, out
    assert "Uvicorn running on http://0.0.0.0:8000" in out, out
    _assert_clean(out + err)


def test_the_filter_catches_a_secret_split_from_its_key_and_an_exception_message(secrets, capsys):
    """Item 3 verify loop 3 (follow-up): the key in the format string with the
    secret as its own argument, and an exception passed as the message, both
    slipped past per-argument redaction. The rendered text is the last net."""
    h, buf = _handler_with_filter()
    lg = logging.getLogger("mrr.test.shapes")
    lg.addHandler(h)
    try:
        lg.warning("GET %s?api_token=%s", "https://eodhd.com/api/eod/AAPL.US", secrets["EODHD_API_TOKEN"])
        lg.warning(RuntimeError(f"upstream said api_token={secrets['EODHD_API_TOKEN']}"))
        lg.warning("%s items, %d bad", "12", 3)  # no secret: formatting untouched
    finally:
        lg.removeHandler(h)
    out, err = buf.getvalue(), capsys.readouterr().err
    assert "Logging error" not in err, err
    assert "api_token=***" in out and "12 items, 3 bad" in out, out
    _assert_clean(out + err)
