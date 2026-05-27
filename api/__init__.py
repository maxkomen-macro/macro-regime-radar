"""Local, read-only HTTP API exposing Macro Regime Radar outputs.

Self-contained package (no src.config import) so it can run without the
FRED_API_KEY that the ingestion pipeline requires. Intended for same-machine
consumers such as Atlas. Run with:

    uvicorn api.main:app --host 127.0.0.1 --port 8787
"""
