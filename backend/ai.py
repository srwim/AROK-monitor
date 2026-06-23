"""AROK Monitor — AI narration layer (opt-in). v3.1.1

Ships with AI insights OFF. The user enables insights in the UI, then
chooses engines via independent toggles:
  - Local model (Gemma 3 2B, downloaded in-app with progress)
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
MODEL_FILE = os.path.join(MODEL_DIR, "gemma-3-2b-q4.gguf")
MODEL_SIZE = 1_700_000_000  # ~1.7 GB
MODEL_URL = os.environ.get("AROK_MODEL_URL", "")  # set for production downloads
DEMO = os.environ.get("AROK_DEMO", "1") == "1"

_download = {"status": "idle", "pct": 0.0, "error": None}
_dl_lock = threading.Lock()
_local_llm = None


# ---------- config ----------

def _flag(key: str) -> bool:
    return db.get_setting(key, "0") == "1"


def _api_key() -> str:
    return db.get_setting("ai_api_key", "") or os.environ.get("AROK_ANTHROPIC_KEY", "")


def model_ready() -> bool:
    return os.path.exists(MODEL_FILE)


def _model_simulated() -> bool:
    return model_ready() and os.path.getsize(MODEL_FILE) < 10_000_000


def get_config() -> dict:
    with _dl_lock:
        dl = dict(_download)
    return {
        "enabled": _flag("ai_enabled"),
        "local_enabled": _flag("ai_local_enabled"),
        "api_enabled": _flag("ai_api_enabled"),
        "api_key_set": bool(_api_key()),
        "local_model_ready": model_ready(),
        "local_model_simulated": _model_simulated(),
        "download": dl,
        "engine": engine_name(),
    }


def set_config(enabled=None, local_enabled=None, api_enabled=None, api_key=None) -> dict:
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
    return get_config()


def engine_name() -> str:
    if not _flag("ai_enabled"):
        return "off"
    if _flag("ai_local_enabled") and model_ready():
        return "local (simulated)" if _model_simulated() else "local (Gemma 3 2B)"
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
        if MODEL_URL:
            # real download whenever a model URL is configured —
            # independent of demo mode (control actions stay simulated)
            _real_download()
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


def _real_download():
    import urllib.request
    tmp = MODEL_FILE + ".part"
    with urllib.request.urlopen(MODEL_URL, timeout=60) as r, open(tmp, "wb") as f:
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
        f.write(b"AROK-DEMO-PLACEHOLDER gemma-3-2b-q4.gguf (simulated download)\n")


# ---------- narration ----------

def _try_local():
    global _local_llm
    if _local_llm is not None:
        return _local_llm
    if model_ready() and not _model_simulated():
        try:
            from llama_cpp import Llama
            _local_llm = Llama(model_path=MODEL_FILE, n_ctx=2048, verbose=False)
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
