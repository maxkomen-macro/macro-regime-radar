"""Provider error hierarchy. Every error carries a closed `kind`, the provider
that raised it, an HTTP status when one exists, a retryable flag, and a
`public` message safe to return to a browser (no URLs, no tokens, no stack
text). Internal detail stays in `detail` for logs only."""

from __future__ import annotations


class ProviderError(Exception):
    kind = "unavailable"
    retryable = False
    http_status = 502

    def __init__(self, provider: str, public: str | None = None, *, status: int | None = None, detail: str = "") -> None:
        # Single-argument form (message only) keeps the pre-provider call
        # sites and tests valid: the provider is then the API layer itself.
        if public is None:
            provider, public = "api", provider
        super().__init__(public)
        self.provider = provider
        self.public = public
        self.status = status
        self.detail = detail

    def __repr__(self) -> str:  # pragma: no cover — logging aid
        return f"{type(self).__name__}({self.provider}, {self.kind}, status={self.status})"


class MissingToken(ProviderError):
    kind = "missing_token"
    http_status = 503


class Unauthorized(ProviderError):
    """401/403: the plan does not include this family, or the token is bad."""

    kind = "unauthorized"
    http_status = 403


class UnknownSymbol(ProviderError):
    kind = "unknown_symbol"
    http_status = 404


class UnsupportedInstrument(ProviderError):
    """The family exists but not for this instrument (ticks for non-US, options for FX…)."""

    kind = "unsupported"
    http_status = 422


class RateLimited(ProviderError):
    kind = "rate_limited"
    retryable = True
    http_status = 429


class ProviderTimeout(ProviderError):
    kind = "timeout"
    retryable = True
    http_status = 504


class ProviderUnavailable(ProviderError):
    kind = "unavailable"
    retryable = True
    http_status = 502


class MalformedResponse(ProviderError):
    kind = "malformed"
    http_status = 502


class EmptyResult(ProviderError):
    """A valid, authorized call that returned nothing (e.g. no bars in range)."""

    kind = "empty"
    http_status = 404
