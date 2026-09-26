"""api/desk_v2.py — the Desk v2 routes under /api/desk (desk/frame-3-api, B1).

DESK_FRAME3_SPEC §12: nine GET routes answering the §12.0 envelope
(api/desk_envelope.py), and the deferred resources of §12.13 as GET-only
stubs answering the awaiting envelope. The handlers are thin: each runs in
`desk_envelope.answer`, which holds the error map, and every result they
serve is a worker item they look up (docs/desk/FRAME3_API_PLAN.md §0.2).

Built so far (plan §7 commit 1): the six stubs. A removed write
(`POST /positions`, `POST /basket/price`) answers the enveloped 405 through
api/main.py's 405 handler, which asks `method_not_allowed` here and leaves
every other 405 as FastAPI answers it.

api/desk.py's routes (/event-study, /event-study/assets, /pipeline/inventory)
keep their own contracts and are not touched here. Like api/desk.py, this
module never imports src.config, and every heavy dependency is imported at
the point of use.
"""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.routing import APIRoute
from starlette.responses import Response

from api import desk_envelope as env

PREFIX = "/api/desk"
router = APIRouter(prefix=PREFIX)


def _response(r: env.Reply) -> Response:
    return Response(content=r.body, status_code=r.status_code, headers=r.headers, media_type=r.media_type)


# ── §12.13 deferred stubs: GET-only, awaiting at once ───────────────────────
# /basket/price is declared before /basket/{basket_id}, which would match it.

@router.get("/sectors")
def desk_sectors() -> Response:
    return _response(env.deferred("/sectors"))


@router.get("/vol")
def desk_vol() -> Response:
    return _response(env.deferred("/vol"))


@router.get("/positions")
def desk_positions() -> Response:
    return _response(env.deferred("/positions"))


@router.get("/basket/price")
def desk_basket_price() -> Response:
    return _response(env.deferred("/basket/price"))


@router.get("/basket/{basket_id}")
def desk_basket(basket_id: str) -> Response:
    return _response(env.deferred("/basket"))


@router.get("/hedge")
def desk_hedge() -> Response:
    return _response(env.deferred("/hedge"))


# ── The enveloped 405 ───────────────────────────────────────────────────────

def serves(path: str) -> bool:
    """Whether a request path is one of this router's routes. The 405's scope:
    under the built bundle the SPA catch-all turns any other POST under /api
    into a 405 as well, and those keep FastAPI's answer."""
    return any(r.path_regex.match(path) for r in router.routes if isinstance(r, APIRoute))


def method_not_allowed(request: Request) -> Response | None:
    """The enveloped 405 for a write to an enveloped route, or None when the
    path is not this router's (the caller answers as FastAPI does)."""
    path = request.url.path
    if not serves(path) or env.route_of(path[len(PREFIX):]) not in env.ENVELOPED_ROUTES:
        return None
    return _response(env.method_not_allowed(request.method))
