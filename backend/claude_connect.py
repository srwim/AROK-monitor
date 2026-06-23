"""AROK Monitor — Anthropic API key connect flow.

Replaces raw key entry with a guided browser flow:
  1. AROK opens console.anthropic.com/settings/keys in the default browser.
  2. User creates or copies an existing API key.
  3. User pastes the key into AROK's polished connect dialog.
  4. AROK validates live against /v1/models, fetches the real model list,
     and persists everything to the settings DB.

Endpoint surface (wired in main.py):
  POST /api/ai/connect/open     → opens browser, returns guide text
  POST /api/ai/connect          → {key} validate + store + return connection
  GET  /api/ai/connect          → current connection state + model list
  POST /api/ai/model            → {model?, max_tokens?, temperature?}
  DELETE /api/ai/connect        → disconnect (clear key + model)
"""
import json
import os
import urllib.error
import urllib.request
import webbrowser

import db

CONSOLE_URL = "https://console.anthropic.com/settings/keys"
ANTHROPIC_API = "https://api.anthropic.com/v1"
ANTHROPIC_VERSION = "2023-06-01"

DEFAULT_MAX_TOKENS = 1024
DEFAULT_TEMPERATURE = 0.3

# Static fallback when the /v1/models call fails (key valid but network edge case).
KNOWN_MODELS = [
    {"id": "claude-opus-4-8",        "display": "Claude Opus 4.8 — most capable"},
    {"id": "claude-sonnet-4-6",       "display": "Claude Sonnet 4.6 — balanced"},
    {"id": "claude-haiku-4-5-20251001","display": "Claude Haiku 4.5 — fastest"},
]


def open_console() -> dict:
    """Open the Claude API key management page in the system default browser."""
    webbrowser.open(CONSOLE_URL)
    db.log_event("ai", "opened Claude console for API key setup")
    return {
        "ok": True,
        "url": CONSOLE_URL,
        "guide": (
            "The Claude console is opening in your browser. "
            "Create a new API key (or copy an existing one), "
            "then paste it below to connect AROK."
        ),
    }


def validate_and_connect(api_key: str) -> dict:
    """Validate the key against /v1/models, fetch the model list, persist."""
    api_key = api_key.strip()
    if not api_key:
        return {"connected": False, "error": "No key provided"}
    try:
        models = _fetch_models(api_key)
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            return {"connected": False, "error": "Invalid API key — authentication failed"}
        return {"connected": False, "error": f"Anthropic API error {exc.code}"}
    except Exception as exc:
        return {"connected": False, "error": f"Connection failed: {exc}"}

    db.set_setting("ai_api_key", api_key)
    db.set_setting("ai_api_enabled", "1")
    db.set_setting("ai_api_models", json.dumps(models))
    if not db.get_setting("ai_api_model", ""):
        default = models[0]["id"] if models else "claude-haiku-4-5-20251001"
        db.set_setting("ai_api_model", default)
    db.log_event("ai", f"Anthropic API connected — {len(models)} model(s) available")
    return get_connection()


def get_connection() -> dict:
    key = db.get_setting("ai_api_key", "")
    models_raw = db.get_setting("ai_api_models", "")
    try:
        models = json.loads(models_raw) if models_raw else KNOWN_MODELS
    except Exception:
        models = KNOWN_MODELS
    selected = db.get_setting("ai_api_model", models[0]["id"] if models else "")
    return {
        "connected": bool(key),
        "models": models,
        "selected_model": selected,
        "max_tokens": int(db.get_setting("ai_api_max_tokens", str(DEFAULT_MAX_TOKENS))),
        "temperature": float(db.get_setting("ai_api_temperature", str(DEFAULT_TEMPERATURE))),
        "enabled": db.get_setting("ai_api_enabled", "0") == "1",
    }


def set_model_params(model: str = "", max_tokens: int = 0, temperature: float = -1.0) -> dict:
    if model:
        db.set_setting("ai_api_model", model)
    if max_tokens > 0:
        db.set_setting("ai_api_max_tokens", str(max_tokens))
    if temperature >= 0:
        db.set_setting("ai_api_temperature", f"{temperature:.3f}")
    parts = []
    if model:
        parts.append(f"model={model}")
    if max_tokens > 0:
        parts.append(f"max_tokens={max_tokens}")
    if temperature >= 0:
        parts.append(f"temperature={temperature:.3f}")
    db.log_event("ai", f"model params updated: {', '.join(parts) or 'no changes'}")
    return get_connection()


def disconnect() -> dict:
    for key in ("ai_api_key", "ai_api_enabled", "ai_api_models", "ai_api_model"):
        db.set_setting(key, "")
    db.log_event("ai", "Anthropic API disconnected")
    return {
        "connected": False,
        "models": KNOWN_MODELS,
        "selected_model": "",
        "max_tokens": DEFAULT_MAX_TOKENS,
        "temperature": DEFAULT_TEMPERATURE,
        "enabled": False,
    }


def _fetch_models(api_key: str) -> list[dict]:
    req = urllib.request.Request(
        f"{ANTHROPIC_API}/models",
        headers={
            "x-api-key": api_key,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        data = json.loads(r.read())
    raw = data.get("data", [])
    if not raw:
        return KNOWN_MODELS
    return [{"id": m["id"], "display": _model_display(m["id"])} for m in raw]


def _model_display(model_id: str) -> str:
    labels = {
        "claude-opus-4-8":         "Claude Opus 4.8 — most capable",
        "claude-sonnet-4-6":        "Claude Sonnet 4.6 — balanced",
        "claude-haiku-4-5-20251001":"Claude Haiku 4.5 — fastest",
    }
    return labels.get(model_id, model_id)
