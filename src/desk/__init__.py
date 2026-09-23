"""The Desk (analyst workspace) backend: the series registry and, later, the
event-study engine. Stdlib-only modules import nothing from src.config, so the
API process (which has no FRED_API_KEY) can import them."""
