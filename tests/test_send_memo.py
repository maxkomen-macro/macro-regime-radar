"""CS-2: scripts/send_memo.py classifies every SMTP failure by the phase it reached
(design section 5). Against a fake SMTP: nothing here opens a socket."""

from __future__ import annotations

import json
import smtplib
import socket
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts import send_memo as sm  # noqa: E402


class FakeSMTP:
    def __init__(self, fail: str | None = None, mail=250, rcpt=None, data=354, final=250, quit_fails=False):
        self.fail, self.mail_code, self.rcpt_codes, self.data_code, self.final = fail, mail, rcpt or {}, data, final
        self.quit_fails = quit_fails
        self.sent = b""
        self.closed = False
        self.replies = []

    def _maybe(self, phase):
        if self.fail == phase:
            raise {"ehlo": smtplib.SMTPServerDisconnected("gone"), "auth": smtplib.SMTPAuthenticationError(535, b"bad"),
                   "rcpt": socket.timeout("timed out"), "body": socket.timeout("timed out"),
                   "final": smtplib.SMTPServerDisconnected("Connection unexpectedly closed"),
                   "final-reset": ConnectionResetError("reset")}[phase]

    def ehlo(self):
        self._maybe("ehlo")

    def login(self, user, password):
        self._maybe("auth")

    def mail(self, sender):
        return self.mail_code, b"mail"

    def rcpt(self, r):
        self._maybe("rcpt")
        return self.rcpt_codes.get(r, 250), b"rcpt"

    def putcmd(self, cmd):
        assert cmd == "data"
        self.replies = [(self.data_code, b"go ahead")]

    def getreply(self):
        if self.replies:
            return self.replies.pop(0)
        self._maybe("final")
        self._maybe("final-reset")
        return self.final, b"queued as X"

    def send(self, data):
        self._maybe("body")
        self.sent += data

    def quit(self):
        if self.quit_fails:
            raise smtplib.SMTPServerDisconnected("quit")

    def close(self):
        self.closed = True


def msg():
    return sm.build_message("me@example.com", ["a@example.com", "b@example.com"], "Subj", "<p>.dot</p>\n.\n", None)


def run(fake, to=("a@example.com", "b@example.com")):
    return sm.send("me@example.com", "pw", list(to), msg(), factory=lambda: fake)


def test_a_250_final_reply_is_sent_even_when_quit_fails():
    fake = FakeSMTP(quit_fails=True)
    out = run(fake)
    assert out["state"] == "sent" and out["phase"] == "final-reply" and out["code"] == 250 and out["refused"] == []
    assert fake.sent.endswith(b"\r\n.\r\n")


@pytest.mark.parametrize("fake,phase", [
    (FakeSMTP(fail="ehlo"), "ehlo"),
    (FakeSMTP(fail="auth"), "auth"),
    (FakeSMTP(mail=550), "mail"),
    (FakeSMTP(fail="rcpt"), "rcpt"),
    (FakeSMTP(rcpt={"a@example.com": 550, "b@example.com": 553}), "rcpt"),
    (FakeSMTP(data=451), "data"),
])
def test_every_failure_before_the_body_is_not_sent(fake, phase):
    out = run(fake)
    assert out["state"] == "not_sent" and out["phase"] == phase and fake.sent == b""


def test_a_connect_failure_is_not_sent():
    def boom():
        raise OSError("Network is unreachable")
    out = sm.send("me@example.com", "pw", ["a@example.com"], msg(), factory=boom)
    assert out == {"state": "not_sent", "phase": "connect", "code": None, "refused": [],
                   "detail": "OSError: Network is unreachable"}


@pytest.mark.parametrize("fail,phase", [("body", "body"), ("final", "final-reply"), ("final-reset", "final-reply")])
def test_a_broken_connection_after_data_is_ambiguous(fail, phase):
    fake = FakeSMTP(fail=fail)
    out = run(fake)
    assert out["state"] == "ambiguous" and out["phase"] == phase and fake.closed


def test_a_refused_final_reply_is_not_sent():
    out = run(FakeSMTP(final=554))
    assert out["state"] == "not_sent" and out["phase"] == "final-reply" and out["code"] == 554


def test_some_recipients_refused_is_sent_with_them_reported():
    out = run(FakeSMTP(rcpt={"b@example.com": 550}))
    assert out["state"] == "sent" and [(r["recipient"], r["code"]) for r in out["refused"]] == [(2, 550)]


@pytest.mark.parametrize("final", [-1, 221, 251, 354])
def test_a_final_reply_that_is_neither_250_nor_a_refusal_is_ambiguous(final):
    out = run(FakeSMTP(final=final))
    assert out["state"] == "ambiguous" and out["phase"] == "final-reply" and out["code"] == final


@pytest.mark.parametrize("final", [421, 451, 550, 554])
def test_a_4xx_or_5xx_final_reply_is_not_sent(final):
    assert run(FakeSMTP(final=final))["state"] == "not_sent"


class LeakySMTP(FakeSMTP):
    """Replies and errors that quote addresses, as real servers do."""

    def rcpt(self, r):
        code = self.rcpt_codes.get(r, 250)
        return code, (f"5.1.1 <{r}> user unknown" if code >= 400 else f"OK {r}").encode()

    def getreply(self):
        if self.replies:
            return self.replies.pop(0)
        raise smtplib.SMTPServerDisconnected("lost while sending to me@example.com")


def test_no_address_reaches_the_log_or_the_outcome_file(tmp_path, capsys):
    (tmp_path / "s.txt").write_text("Subj\n")
    (tmp_path / "b.html").write_text("<p>x</p>")
    env = {"MEMO_RECIPIENTS": "a@example.com, b@example.com", "GMAIL_ADDRESS": "me@example.com", "GMAIL_APP_PASSWORD": "pw"}
    out_file = tmp_path / "o" / "outcome.json"
    args = ["--subject-file", str(tmp_path / "s.txt"), "--html-file", str(tmp_path / "b.html"), "--out", str(out_file)]
    assert sm.main(args, env=env, factory=lambda: LeakySMTP(rcpt={"b@example.com": 550})) == 1
    log, written = capsys.readouterr().out, out_file.read_text()
    out = json.loads(written)
    assert out["state"] == "ambiguous" and out["refused"] == [{"recipient": 2, "code": 550, "reply": "5.1.1 <<address>> user unknown"}]
    assert "recipient 2 (550)" in log and "<address>" in out["detail"]
    for text in (log, written):
        assert "@" not in text, text


def test_no_recipients_is_not_sent():
    out = sm.send("me@example.com", "pw", [], msg(), factory=lambda: pytest.fail("no connection without recipients"))
    assert out["state"] == "not_sent" and out["phase"] == "recipients"


def test_recipients_split_like_the_old_action():
    assert sm.recipients(" a@x.com, b@x.com;c@x.com\n\nd@x.com ,") == ["a@x.com", "b@x.com", "c@x.com", "d@x.com"]
    assert sm.recipients("") == [] and sm.recipients(None) == []


@pytest.mark.parametrize("data", [b"a\r\n.b\r\n", b"a\r\n.", b".\r\n", b"x", b"line\r\n..two\r\n"])
def test_the_body_bytes_are_smtplibs(data):
    want = smtplib._quote_periods(data)
    if want[-2:] != b"\r\n":
        want += b"\r\n"
    assert sm.wire_body(data) == want + b".\r\n"


def test_the_message_keeps_the_old_from_subject_body_and_attachment(tmp_path):
    att = tmp_path / "daily_memo.html"
    att.write_text("<html>memo</html>")
    m = sm.build_message("me@example.com", ["a@example.com"], "📊 Daily Briefing — 2026-11-16 — Goldilocks", "<p>hi</p>", att)
    assert m["From"] == "Macro Radar <me@example.com>" and m["To"] == "a@example.com"
    assert str(m["Subject"]) == "📊 Daily Briefing — 2026-11-16 — Goldilocks"
    parts = list(m.iter_parts())
    assert parts[0].get_content_type() == "text/html" and parts[0].get_content().strip() == "<p>hi</p>"
    assert parts[1].get_filename() == "daily_memo.html" and parts[1].get_content() == "<html>memo</html>"
    assert b"\r\n" in m.as_bytes(policy=sm.SMTP_POLICY)


def test_main_writes_the_outcome_and_exits_0_only_on_sent(tmp_path):
    (tmp_path / "s.txt").write_text("Subj\n")
    (tmp_path / "b.html").write_text("<p>x</p>")
    env = {"MEMO_RECIPIENTS": "a@example.com", "GMAIL_ADDRESS": "me@example.com", "GMAIL_APP_PASSWORD": "pw"}
    args = ["--subject-file", str(tmp_path / "s.txt"), "--html-file", str(tmp_path / "b.html"), "--out", str(tmp_path / "o" / "outcome.json")]
    assert sm.main(args, env=env, factory=lambda: FakeSMTP()) == 0
    out = json.loads((tmp_path / "o" / "outcome.json").read_text())
    assert out["state"] == "sent" and out["recipients"] == 1 and out["started_at"] <= out["finished_at"]
    assert "pw" not in (tmp_path / "o" / "outcome.json").read_text()
    assert sm.main(args, env=env, factory=lambda: FakeSMTP(fail="body")) == 1
    assert json.loads((tmp_path / "o" / "outcome.json").read_text())["state"] == "ambiguous"
    missing = ["--subject-file", str(tmp_path / "s.txt"), "--html-file", str(tmp_path / "nope.html"), "--out", str(tmp_path / "o" / "outcome.json")]
    assert sm.main(missing, env=env, factory=lambda: pytest.fail("never connects")) == 1
    out = json.loads((tmp_path / "o" / "outcome.json").read_text())
    assert out["state"] == "not_sent" and out["phase"] == "build"


def test_the_production_connection_is_implicit_tls_with_a_timeout():
    assert (sm.HOST, sm.PORT, sm.TIMEOUT_S) == ("smtp.gmail.com", 465, 60)
    src = (ROOT / "scripts" / "send_memo.py").read_text()
    assert "smtplib.SMTP_SSL(HOST, PORT, timeout=TIMEOUT_S, context=ssl.create_default_context())" in src
