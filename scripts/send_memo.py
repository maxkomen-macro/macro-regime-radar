"""scripts/send_memo.py — send one memo email with a known SMTP phase (CS-2, design section 5).

Replaces dawidd6/action-send-mail@v18 in the memo workflows with the same secrets
(GMAIL_ADDRESS, GMAIL_APP_PASSWORD, MEMO_RECIPIENTS), server (smtp.gmail.com:465,
implicit TLS), From, subject, HTML body and attachment. The transaction is driven
step by step, so every failure is classified by how far it got:

  connect, TLS, EHLO, AUTH, MAIL FROM; every RCPT refused;
  DATA not answered 354                                 -> not_sent
  a socket error, timeout or disconnect while the body is
  sent or while waiting for the final reply             -> ambiguous
  final reply 250                                       -> sent (a failing QUIT is ignored)
  any other final reply                                 -> not_sent (the server refused it)

Some recipients refused and at least one accepted is `sent`, with the refused
addresses reported. Empty MEMO_RECIPIENTS is `not_sent`. Every socket operation
has a 60 s timeout. The body bytes are the ones smtplib.SMTP.data would send
(CRLF line ends, dot-stuffing, the terminating <CRLF>.<CRLF>).

It writes the outcome file before it exits, and exits 0 only on `sent`. An
`ambiguous` outcome is never resent automatically: SMTP may have accepted it.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import smtplib
import socket
import ssl
import sys
from datetime import datetime, timezone
from email.message import EmailMessage
from email.policy import SMTP as SMTP_POLICY
from email.utils import formataddr
from pathlib import Path
from typing import Callable

HOST, PORT, TIMEOUT_S = "smtp.gmail.com", 465, 60
CRLF = b"\r\n"


def recipients(raw: str) -> list[str]:
    return [r.strip() for r in re.split(r"[,;\n]", raw or "") if r.strip()]


def build_message(sender: str, to: list[str], subject: str, html: str, attachment: Path | None) -> EmailMessage:
    msg = EmailMessage(policy=SMTP_POLICY)
    msg["From"] = formataddr(("Macro Radar", sender))
    msg["To"] = ", ".join(to)
    msg["Subject"] = subject
    msg.set_content(html, subtype="html")
    if attachment is not None:
        msg.add_attachment(attachment.read_bytes(), maintype="text", subtype="html", filename=attachment.name)
    return msg


def wire_body(data: bytes) -> bytes:
    """smtplib.SMTP.data's transformation: dot-stuffing, a final CRLF, then <CRLF>.<CRLF>."""
    q = re.sub(br"(?m)^\.", b"..", data)
    if q[-2:] != CRLF:
        q += CRLF
    return q + b"." + CRLF


def send(user: str, password: str, to: list[str], msg: EmailMessage,
         factory: Callable[..., smtplib.SMTP] | None = None) -> dict:
    """One SMTP transaction. Returns {state, phase, code, refused, detail}."""
    if not to:
        return {"state": "not_sent", "phase": "recipients", "code": None, "refused": [], "detail": "MEMO_RECIPIENTS is empty"}
    phase, refused = "connect", []
    smtp = None
    try:
        if factory is None:
            smtp = smtplib.SMTP_SSL(HOST, PORT, timeout=TIMEOUT_S, context=ssl.create_default_context())
        else:
            smtp = factory()
        phase = "ehlo"
        smtp.ehlo()
        phase = "auth"
        smtp.login(user, password)
        phase = "mail"
        code, resp = smtp.mail(user)
        if code != 250:
            return {"state": "not_sent", "phase": phase, "code": code, "refused": [], "detail": _text(resp)}
        phase = "rcpt"
        accepted = 0
        for r in to:
            code, resp = smtp.rcpt(r)
            if code in (250, 251):
                accepted += 1
            else:
                refused.append({"address": r, "code": code, "reply": _text(resp)})
        if not accepted:
            return {"state": "not_sent", "phase": phase, "code": None, "refused": refused, "detail": "every recipient refused"}
        phase = "data"
        smtp.putcmd("data")
        code, resp = smtp.getreply()
        if code != 354:
            return {"state": "not_sent", "phase": phase, "code": code, "refused": refused, "detail": _text(resp)}
    except (OSError, smtplib.SMTPException) as exc:
        _close(smtp)
        return {"state": "not_sent", "phase": phase, "code": getattr(exc, "smtp_code", None), "refused": refused,
                "detail": f"{type(exc).__name__}: {exc}"[:500]}
    # From here the body may have reached the server: a broken connection is ambiguous.
    phase = "body"
    try:
        smtp.send(wire_body(msg.as_bytes(policy=SMTP_POLICY)))
        phase = "final-reply"
        code, resp = smtp.getreply()
    except (OSError, smtplib.SMTPException, socket.timeout) as exc:
        _close(smtp)
        return {"state": "ambiguous", "phase": phase, "code": None, "refused": refused,
                "detail": f"{type(exc).__name__}: {exc}"[:500]}
    try:
        smtp.quit()
    except (OSError, smtplib.SMTPException):
        pass
    if code == 250:
        return {"state": "sent", "phase": phase, "code": code, "refused": refused, "detail": _text(resp)}
    return {"state": "not_sent", "phase": phase, "code": code, "refused": refused, "detail": _text(resp)}


def _text(resp) -> str:
    return resp.decode("utf-8", "replace")[:500] if isinstance(resp, bytes) else str(resp)[:500]


def _close(smtp) -> None:
    if smtp is not None:
        try:
            smtp.close()
        except OSError:
            pass


def main(argv: list[str] | None = None, env: dict | None = None,
         factory: Callable[..., smtplib.SMTP] | None = None) -> int:
    env = dict(os.environ if env is None else env)
    ap = argparse.ArgumentParser(prog="send_memo")
    ap.add_argument("--subject-file", required=True, type=Path)
    ap.add_argument("--html-file", required=True, type=Path)
    ap.add_argument("--attach", type=Path, default=None)
    ap.add_argument("--out", required=True, type=Path)
    a = ap.parse_args(argv)
    started = datetime.now(timezone.utc)
    try:
        to = recipients(env.get("MEMO_RECIPIENTS", ""))
        sender = env.get("GMAIL_ADDRESS", "")
        msg = build_message(sender, to, a.subject_file.read_text(encoding="utf-8").strip(),
                            a.html_file.read_text(encoding="utf-8"), a.attach)
        out = send(sender, env.get("GMAIL_APP_PASSWORD", ""), to, msg, factory)
    except (OSError, ValueError) as exc:   # the message could not be built: nothing was sent
        out = {"state": "not_sent", "phase": "build", "code": None, "refused": [], "detail": f"{type(exc).__name__}: {exc}"[:500]}
    out.update(started_at=started.strftime("%Y-%m-%dT%H:%M:%SZ"),
               finished_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
               recipients=len(recipients(env.get("MEMO_RECIPIENTS", ""))))
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(out, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    refused = ", ".join(r["address"] for r in out["refused"])
    print(f"memo email: {out['state']} at {out['phase']}" + (f" (refused: {refused})" if refused else ""))
    if out["state"] != "sent":
        print(f"::error::memo email {out['state']} at {out['phase']}: {out['detail']}")
    return 0 if out["state"] == "sent" else 1


if __name__ == "__main__":
    sys.exit(main())
