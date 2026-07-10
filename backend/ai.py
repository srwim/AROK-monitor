"""AROK Monitor — AI narration layer (opt-in). v3.1.1

Ships with AI insights OFF. The user enables insights in the UI, then
chooses engines via independent toggles:
  - Local model (Gemma 2 2B Q4, downloaded in-app with progress)
  - Anthropic API (key entered in the UI, stored in settings)

Engine priority when enabled: local → API → deterministic template.
LLM narrator pattern throughout: detection is deterministic (monitor.py);
the model only narrates findings into prose.
"""
import os
import threading
import time

import db

import sys

if getattr(sys, "frozen", False):
    MODEL_DIR = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "AROK", "models")
else:
    HERE = os.path.dirname(os.path.abspath(__file__))
    MODEL_DIR = os.path.join(HERE, "models")
MODEL_FILE = os.path.join(MODEL_DIR, "gemma-2-2b-it-q4.gguf")
MODEL_NAME = "Gemma 2 2B"
MODEL_SIZE = 1_708_582_752  # gemma-2-2b-it Q4_K_M, exact bytes

# Curated menu of small, open-source, ungated Q4_K_M GGUF models the user can
# download in-app. All narrate fine on CPU; larger ones read more fluently but
# take longer. sizeGB is the on-disk download size. The user can also point AROK
# at a GGUF already on disk (set_local_model_path) instead of downloading.
MODEL_CATALOG = [
    {"id": "qwen2.5-1.5b", "name": "Qwen2.5 1.5B Instruct", "params": "1.5B", "sizeGB": 1.1,
     "note": "Smallest & fastest — good on low-end machines.",
     "url": "https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf"},
    {"id": "gemma-2-2b", "name": "Gemma 2 2B Instruct", "params": "2B", "sizeGB": 1.7,
     "note": "AROK's default — balanced quality and size.",
     "url": "https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q4_K_M.gguf"},
    {"id": "llama-3.2-3b", "name": "Llama 3.2 3B Instruct", "params": "3B", "sizeGB": 2.0,
     "note": "Strong general reasoning for its size.",
     "url": "https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf"},
    {"id": "qwen2.5-3b", "name": "Qwen2.5 3B Instruct", "params": "3B", "sizeGB": 2.0,
     "note": "Excellent instruction following.",
     "url": "https://huggingface.co/bartowski/Qwen2.5-3B-Instruct-GGUF/resolve/main/Qwen2.5-3B-Instruct-Q4_K_M.gguf"},
    {"id": "phi-3.5-mini", "name": "Phi-3.5 Mini Instruct", "params": "3.8B", "sizeGB": 2.4,
     "note": "Microsoft's compact model — sharp on structured tasks.",
     "url": "https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf"},
    {"id": "mistral-7b", "name": "Mistral 7B Instruct v0.3", "params": "7B", "sizeGB": 4.4,
     "note": "Most fluent — needs ~6 GB free RAM and is slower on CPU.",
     "url": "https://huggingface.co/bartowski/Mistral-7B-Instruct-v0.3-GGUF/resolve/main/Mistral-7B-Instruct-v0.3-Q4_K_M.gguf"},
]

# Real, public, ungated GGUF (HuggingFace) so the in-app download works out of
# the box — no longer a demo simulation. Override with AROK_MODEL_URL or the
# stored "ai_model_url" setting (Settings → AI engine) to use a different model.
DEFAULT_MODEL_URL = (
    "https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/"
    "gemma-2-2b-it-Q4_K_M.gguf"
)
DEMO = os.environ.get("AROK_DEMO", "1") == "1"


def model_url() -> str:
    """Resolve the model download URL: stored setting > env var > baked default."""
    return (
        db.get_setting("ai_model_url", "")
        or os.environ.get("AROK_MODEL_URL", "")
        or DEFAULT_MODEL_URL
    )

_download = {"status": "idle", "pct": 0.0, "error": None}
_dl_lock = threading.Lock()
_local_llm = None


# ---------- config ----------

def _flag(key: str) -> bool:
    return db.get_setting(key, "0") == "1"


def _api_key() -> str:
    return db.get_setting("ai_api_key", "") or os.environ.get("AROK_ANTHROPIC_KEY", "")


def _custom_path() -> str:
    """A user-selected GGUF already on disk, if set and present."""
    p = db.get_setting("ai_local_model_path", "") or ""
    return p if (p and os.path.exists(p)) else ""


def _effective_model_file() -> str:
    """The local model AROK should load: a user-picked file wins over the
    in-app downloaded one."""
    return _custom_path() or MODEL_FILE


def model_ready() -> bool:
    return bool(_custom_path()) or os.path.exists(MODEL_FILE)


def _model_simulated() -> bool:
    """True only for the tiny placeholder written by the demo download."""
    if _custom_path():
        return False
    return os.path.exists(MODEL_FILE) and os.path.getsize(MODEL_FILE) < 10_000_000


def get_config() -> dict:
    with _dl_lock:
        dl = dict(_download)
    custom = _custom_path()
    return {
        "enabled": _flag("ai_enabled"),
        "local_enabled": _flag("ai_local_enabled"),
        "api_enabled": _flag("ai_api_enabled"),
        "api_key_set": bool(_api_key()),
        "local_model_ready": model_ready(),
        "local_model_simulated": _model_simulated(),
        "model_name": db.get_setting("ai_model_name", "") or MODEL_NAME,
        "model_url": model_url(),
        "custom_model_path": custom,
        "selected_model_id": db.get_setting("ai_model_id", "") or "gemma-2-2b",
        "catalog": MODEL_CATALOG,
        "download": dl,
        "engine": engine_name(),
    }


def select_model(model_id: str) -> dict:
    """Choose which catalogued model the in-app download will fetch. Clears any
    custom path so the downloaded model becomes the active one."""
    entry = next((m for m in MODEL_CATALOG if m["id"] == model_id), None)
    if not entry:
        return {"ok": False, "detail": "unknown model id"}
    db.set_setting("ai_model_url", entry["url"])
    db.set_setting("ai_model_name", entry["name"])
    db.set_setting("ai_model_id", entry["id"])
    db.set_setting("ai_local_model_path", "")  # downloading supersedes a custom file
    db.log_event("ai", f"selected model {entry['name']}")
    return {"ok": True, "config": get_config()}


def set_local_model_path(path: str) -> dict:
    """Point AROK at a GGUF already on disk instead of downloading. Basic
    validation only; llama-cpp reports load errors at narration time."""
    global _local_llm
    path = (path or "").strip().strip('"')
    if not path:
        db.set_setting("ai_local_model_path", "")
        _local_llm = None
        db.log_event("ai", "custom model path cleared")
        return {"ok": True, "config": get_config()}
    if not os.path.exists(path):
        return {"ok": False, "detail": "file not found"}
    if not path.lower().endswith(".gguf"):
        return {"ok": False, "detail": "not a .gguf file"}
    db.set_setting("ai_local_model_path", path)
    db.set_setting("ai_model_name", os.path.basename(path))
    _local_llm = None  # reload from the new path on next use
    db.log_event("ai", f"using local model file: {os.path.basename(path)}")
    return {"ok": True, "config": get_config()}


def set_config(enabled=None, local_enabled=None, api_enabled=None, api_key=None, model_url=None) -> dict:
    if enabled is not None:
        db.set_setting("ai_enabled", "1" if enabled else "0")
        db.log_event("ai", f"AI insights {'enabled' if enabled else 'disabled'}")
    if local_enabled is not None:
        db.set_setting("ai_local_enabled", "1" if local_enabled else "0")
        db.log_event("ai", f"local engine {'on' if local_enabled else 'off'}")
    if api_enabled is not None:
        db.set_setting("ai_api_enabled", "1" if api_enabled else "0")
        db.log_event("ai", f"API engine {'on' if api_enabled else 'off'}")
    if api_key is not None:
        db.set_setting("ai_api_key", api_key)
        db.log_event("ai", "API key updated" if api_key else "API key cleared")
    if model_url is not None:
        db.set_setting("ai_model_url", model_url.strip())
        db.log_event("ai", "model URL updated" if model_url.strip() else "model URL reset to default")
    return get_config()


def engine_name() -> str:
    if not _flag("ai_enabled"):
        return "off"
    if _flag("ai_local_enabled") and model_ready():
        return "local (simulated)" if _model_simulated() else f"local ({MODEL_NAME})"
    if _flag("ai_api_enabled") and _api_key():
        model = db.get_setting("ai_api_model", "claude-haiku-4-5-20251001") or "claude-haiku-4-5-20251001"
        return f"cloud:{model}"
    return "template"


# ---------- model download ----------

def start_download() -> dict:
    with _dl_lock:
        if _download["status"] == "downloading":
            return dict(_download)
        _download.update({"status": "downloading", "pct": 0.0, "error": None})
    threading.Thread(target=_download_worker, daemon=True).start()
    with _dl_lock:
        return dict(_download)


def _download_worker():
    global _local_llm
    os.makedirs(MODEL_DIR, exist_ok=True)
    try:
        url = model_url()
        if url:
            # real download whenever a model URL is configured (now the default) —
            # independent of demo mode (control actions stay simulated)
            _real_download(url)
        else:
            _simulated_download()
        with _dl_lock:
            _download.update({"status": "ready", "pct": 100.0})
        _local_llm = None  # force llama-cpp to (re)load the fresh model
        db.log_event("ai", "local model download complete")
    except Exception as e:
        with _dl_lock:
            _download.update({"status": "error", "error": str(e)})
        db.log_event("ai", f"local model download failed: {e}")


def _real_download(url: str):
    import urllib.request
    tmp = MODEL_FILE + ".part"
    req = urllib.request.Request(url, headers={"User-Agent": "AROK-Monitor"})
    with urllib.request.urlopen(req, timeout=60) as r, open(tmp, "wb") as f:
        total = int(r.headers.get("Content-Length") or MODEL_SIZE)
        done = 0
        while True:
            chunk = r.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)
            done += len(chunk)
            with _dl_lock:
                _download["pct"] = round(done / total * 100, 1)
    os.replace(tmp, MODEL_FILE)


def _simulated_download():
    """Demo mode: simulate the 1.7 GB download with realistic progress,
    then write a small placeholder so the 'ready' state is persistent."""
    for i in range(1, 41):
        time.sleep(0.2)
        with _dl_lock:
            _download["pct"] = round(i / 40 * 100, 1)
    with open(MODEL_FILE, "wb") as f:
        f.write(b"AROK-DEMO-PLACEHOLDER gemma-2-2b-it-q4.gguf (simulated download)\n")


# ---------- narration ----------

def _try_local():
    global _local_llm
    if _local_llm is not None:
        return _local_llm
    if model_ready() and not _model_simulated():
        try:
            from llama_cpp import Llama
            _local_llm = Llama(model_path=_effective_model_file(), n_ctx=2048, verbose=False)
        except Exception:
            _local_llm = False
    else:
        _local_llm = False
    return _local_llm


def _narrate_with_model(prompt: str) -> str | None:
    if _flag("ai_local_enabled"):
        llm = _try_local()
        if llm:
            try:
                out = llm(prompt, max_tokens=300, temperature=0.3)
                return out["choices"][0]["text"].strip()
            except Exception:
                pass
    if _flag("ai_api_enabled") and _api_key():
        try:
            import urllib.request, json
            model = db.get_setting("ai_api_model", "claude-haiku-4-5-20251001") or "claude-haiku-4-5-20251001"
            max_tok = int(db.get_setting("ai_api_max_tokens", "400") or "400")
            temp = float(db.get_setting("ai_api_temperature", "0.3") or "0.3")
            req = urllib.request.Request(
                "https://api.anthropic.com/v1/messages",
                data=json.dumps({
                    "model": model,
                    "max_tokens": max_tok,
                    "temperature": temp,
                    "messages": [{"role": "user", "content": prompt}],
                }).encode(),
                headers={
                    "x-api-key": _api_key(),
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
            )
            with urllib.request.urlopen(req, timeout=20) as r:
                data = json.loads(r.read())
            return data["content"][0]["text"]
        except Exception:
            pass
    return None


def chat(message: str, history: list | None = None) -> dict:
    """Free-form chat with the active AI engine (local model, else cloud).
    Returns {ok, reply, engine}. Never raises; degrades to a clear message
    when no engine is available."""
    message = (message or "").strip()
    if not message:
        return {"ok": False, "reply": "", "engine": engine_name(), "detail": "empty message"}
    if not _flag("ai_enabled"):
        return {"ok": False, "reply": "AI insights are off — enable them to chat.", "engine": "off"}

    system = ("You are AROK, a concise assistant embedded in a Windows system "
              "monitor. Answer briefly and practically. You cannot see live "
              "metrics in this chat unless the user pastes them.")

    # local model: use its chat template when available
    if _flag("ai_local_enabled"):
        llm = _try_local()
        if llm:
            try:
                msgs = [{"role": "system", "content": system}]
                for turn in (history or [])[-8:]:
                    role = "assistant" if turn.get("role") == "assistant" else "user"
                    msgs.append({"role": role, "content": str(turn.get("content", ""))})
                msgs.append({"role": "user", "content": message})
                out = llm.create_chat_completion(messages=msgs, max_tokens=400, temperature=0.4)
                reply = out["choices"][0]["message"]["content"].strip()
                return {"ok": True, "reply": reply, "engine": engine_name()}
            except Exception as e:
                return {"ok": False, "reply": f"Local model error: {e}", "engine": engine_name()}

    # cloud: reuse the narrator transport with a plain prompt
    if _flag("ai_api_enabled") and _api_key():
        convo = "\n".join(f"{t.get('role','user')}: {t.get('content','')}" for t in (history or [])[-8:])
        prompt = f"{system}\n\n{convo}\nuser: {message}\nassistant:"
        reply = _narrate_with_model(prompt)
        if reply:
            return {"ok": True, "reply": reply.strip(), "engine": engine_name()}

    return {"ok": False, "engine": engine_name(),
            "reply": "No chat-capable engine is active. Download or select a local model, "
                     "or connect the Anthropic API, then try again."}


def narrate_system(latest: dict, alerts: list, history: list, recs: list | None = None) -> dict:
    """Produce an insight narrative from deterministic findings (and
    deterministic optimization recommendations). Returns {"enabled": False}
    when the user hasn't opted in."""
    if not _flag("ai_enabled"):
        return {"enabled": False, "ts": time.time(), "engine": "off"}
    recs = recs or []
    findings = _findings(latest, alerts, history)
    if recs:
        findings.append(
            f"{len(recs)} optimization recommendation(s) available; top: {recs[0]['title']} ({recs[0]['impact']})"
        )
    prompt = (
        "You are AROK, a system monitoring narrator. Turn these findings into a short, "
        "plain-English status narrative (3-5 sentences), ending with the optimization "
        "recommendations if any. Do not invent numbers or recommendations.\n\nFindings:\n"
        + "\n".join(f"- {f}" for f in findings)
    )
    text = _narrate_with_model(prompt)
    if not text:
        text = _template_narrative(latest, alerts, findings, recs)
    return {
        "enabled": True,
        "ts": time.time(),
        "engine": engine_name(),
        "findings": findings,
        "narrative": text,
    }


def _findings(latest: dict, alerts: list, history: list) -> list[str]:
    f = []
    f.append(f"CPU at {latest.get('cpu', 0):.1f}%, memory at {latest.get('mem', 0):.1f}%, disk at {latest.get('disk', 0):.1f}%")
    f.append(f"{latest.get('proc_count', 0)} processes running")
    rate = latest.get("net_recv", 0) / 1024
    f.append(f"Network receive rate {rate:.1f} KB/s, send rate {latest.get('net_sent', 0)/1024:.1f} KB/s")
    if history:
        cpus = [h["cpu"] for h in history]
        f.append(f"CPU over the window: min {min(cpus):.1f}%, max {max(cpus):.1f}%, avg {sum(cpus)/len(cpus):.1f}%")
    unacked = [a for a in alerts if not a.get("acked")]
    if unacked:
        f.append(f"{len(unacked)} unacknowledged alert(s); most recent: {unacked[0]['message']}")
    else:
        f.append("No active alerts")
    return f


def _template_narrative(latest: dict, alerts: list, findings: list, recs: list | None = None) -> str:
    cpu, mem = latest.get("cpu", 0), latest.get("mem", 0)
    load = "light" if cpu < 30 else "moderate" if cpu < 70 else "heavy"
    pressure = "comfortable" if mem < 60 else "elevated" if mem < 85 else "critical"
    unacked = [a for a in alerts if not a.get("acked")]
    parts = [
        f"System load is {load} with CPU at {cpu:.1f}% and memory pressure is {pressure} at {mem:.1f}%.",
        f"{latest.get('proc_count', 0)} processes are active and network throughput is "
        f"{(latest.get('net_recv', 0) + latest.get('net_sent', 0))/1024:.1f} KB/s combined.",
    ]
    if unacked:
        parts.append(f"Attention needed: {len(unacked)} unacknowledged alert(s) — most recent is \"{unacked[0]['message']}\".")
    else:
        parts.append("No anomalies detected; all metrics are within normal operating bounds.")
    if recs:
        top = recs[0]
        more = f" plus {len(recs) - 1} more" if len(recs) > 1 else ""
        parts.append(f"Recommended optimization: {top['title'].lower()} — {top['impact']}{more}. Use the Optimize button to apply.")
    return " ".join(parts)
