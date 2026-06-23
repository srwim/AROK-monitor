"""AROK Monitor - standalone desktop app with system tray.

- pywebview window on WebView2, FastAPI server in a background thread.
- Closing the window parks AROK in the tray (preference-controlled):
  monitoring keeps running and logging; sampling drops to a low-power
  interval; analytics catch up the moment the window reopens.
- Tray right-click menu: live stats, gaming mode controls, optimize,
  update check, open window, quit.
- Second launch raises the existing window instead of starting twice.

Diagnostics: steps logged to %LOCALAPPDATA%\AROK\desktop.log; fatal
errors shown in a message box.
"""
import os
import socket
import sys
import threading
import time
import traceback
import webbrowser

HOST = "127.0.0.1"
PORT = 8420
NORMAL_INTERVAL = 3
TRAY_INTERVAL = 30  # low-power background sampling

LOG_DIR = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "AROK")
os.makedirs(LOG_DIR, exist_ok=True)
LOG = os.path.join(LOG_DIR, "desktop.log")

# console=False builds have no stdout/stderr - give them real streams
if getattr(sys, "frozen", False):
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w", encoding="utf-8")
    if sys.stderr is None:
        sys.stderr = open(LOG, "a", encoding="utf-8")


def log(msg: str):
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}\n")


def fatal(msg: str):
    log("FATAL: " + msg)
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(
            None, msg[:1500] + f"\n\nFull log: {LOG}", "AROK Monitor - startup error", 0x10
        )
    except Exception:
        pass
    sys.exit(1)


def _port_in_use() -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((HOST, PORT)) == 0


def _raise_existing():
    """Another instance is running - ask it to show its window, then exit."""
    try:
        import urllib.request
        urllib.request.urlopen(f"http://{HOST}:{PORT}/api/desktop/show", data=b"", timeout=5)
        log("raised existing instance's window; exiting")
    except Exception as e:
        log(f"could not raise existing instance: {e}")
    sys.exit(0)


class TrayApp:
    def __init__(self):
        self.window = None
        self.icon = None
        self.hidden = False
        self.quitting = False

    # ---- backend access (same process as the server) ----
    def _modules(self):
        import db, monitor, optimizer, updater, main
        return db, monitor, optimizer, updater, main

    def _pref(self, key) -> bool:
        import db, main
        return main.get_pref(key)

    # ---- window control ----
    def show_window(self):
        if self.window:
            try:
                self.window.show()
                self.window.restore()
            except Exception as e:
                log(f"show_window: {e}")
        self.hidden = False
        self._set_interval(NORMAL_INTERVAL)
        log("window shown - normal sampling")

    def hide_to_tray(self):
        self.hidden = True
        if self._pref("low_power_tray"):
            self._set_interval(TRAY_INTERVAL)
        import db
        db.log_event("tray", f"minimized to tray - background monitoring at {TRAY_INTERVAL if self._pref('low_power_tray') else NORMAL_INTERVAL}s")
        log("window hidden to tray")

    def _set_interval(self, seconds):
        import monitor
        monitor.SAMPLE_INTERVAL = seconds

    def on_closing(self):
        """pywebview closing event: cancel close + hide when pref enabled."""
        if self.quitting or not self._pref("close_to_tray"):
            return True
        # hide instead of close
        threading.Thread(target=self._hide_async, daemon=True).start()
        return False

    def _hide_async(self):
        try:
            self.window.hide()
        except Exception as e:
            log(f"hide: {e}")
        self.hide_to_tray()

    def quit(self, *_):
        self.quitting = True
        log("quit requested from tray")
        try:
            if self.icon:
                self.icon.stop()
        except Exception:
            pass
        try:
            if self.window:
                self.window.destroy()
        except Exception:
            pass

    # ---- tray menu ----
    def _stats_text(self, *_):
        try:
            import monitor
            s = monitor.latest()
            return f"CPU {s['cpu']:.0f}%  ·  MEM {s['mem']:.0f}%  ·  {s['proc_count']} procs"
        except Exception:
            return "stats unavailable"

    def _alerts_text(self, *_):
        try:
            import db
            n = len([a for a in db.recent_alerts(50) if not a["acked"]])
            return f"{n} unacknowledged alert(s)" if n else "No active alerts"
        except Exception:
            return "alerts unavailable"

    def _gaming_on(self, *_):
        import db
        return db.get_setting("gaming_mode", "0") == "1"

    def _auto_on(self, *_):
        import db
        return db.get_setting("gaming_auto", "0") == "1"

    def _toggle_gaming(self, *_):
        import optimizer
        optimizer.set_gaming(not self._gaming_on())

    def _toggle_auto(self, *_):
        import optimizer
        optimizer.set_auto(not self._auto_on())

    def _optimize(self, *_):
        import optimizer, db
        results = optimizer.run()
        db.log_event("tray", f"optimize from tray: {len(results)} action(s)")
        self._notify("AROK Optimize", f"{len(results)} recommendation(s) applied - details in the event log.")

    def _check_updates(self, *_):
        import updater
        info = updater.check()
        if info.get("update_available"):
            self._notify("AROK update available", f"{info['latest']} is out (you have {info['current']}).")
            if info.get("url"):
                webbrowser.open(info["url"])
        elif info.get("error"):
            self._notify("AROK update check failed", str(info["error"])[:120])
        else:
            self._notify("AROK is up to date", f"Version {info['current']} is the latest release.")

    def _notify(self, title, msg):
        try:
            if self.icon:
                self.icon.notify(msg, title)
        except Exception:
            pass

    def _tray_icon_image(self):
        from PIL import Image
        here = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
        for cand in (os.path.join(here, "icon.ico"), os.path.join(here, "..", "branding", "icon.ico")):
            if os.path.exists(cand):
                return Image.open(cand)
        # fallback: plain dark disc
        img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        from PIL import ImageDraw
        ImageDraw.Draw(img).ellipse([4, 4, 60, 60], fill=(52, 66, 84, 255))
        return img

    def build_tray(self):
        import pystray
        from pystray import Menu, MenuItem as Item

        menu = Menu(
            Item("Open AROK Monitor", lambda: self.show_window(), default=True),
            Menu.SEPARATOR,
            Item(self._stats_text, None, enabled=False),
            Item(self._alerts_text, None, enabled=False),
            Menu.SEPARATOR,
            Item("Gaming mode", self._toggle_gaming, checked=self._gaming_on),
            Item("Auto-detect games", self._toggle_auto, checked=self._auto_on),
            Item("Run Optimize now", self._optimize),
            Menu.SEPARATOR,
            Item("Check for updates…", self._check_updates),
            Item(f"Open in browser ({HOST}:{PORT})", lambda: webbrowser.open(f"http://{HOST}:{PORT}")),
            Menu.SEPARATOR,
            Item("Quit AROK (stop monitoring)", self.quit),
        )
        self.icon = pystray.Icon("AROK Monitor", self._tray_icon_image(), "AROK Monitor v1.0", menu)
        self.icon.run_detached()
        log("tray icon running")


def _run_server():
    try:
        import uvicorn
        import main
        log("server thread: starting uvicorn")
        uvicorn.run(main.app, host=HOST, port=PORT, log_config=None, log_level="warning")
    except Exception:
        log("server thread CRASHED:\n" + traceback.format_exc())


def start():
    log(f"=== AROK desktop starting (frozen={getattr(sys, 'frozen', False)}, pid={os.getpid()}) ===")

    if _port_in_use():
        _raise_existing()

    threading.Thread(target=_run_server, daemon=True).start()
    log("waiting for server...")
    for _ in range(100):
        if _port_in_use():
            break
        time.sleep(0.1)
    else:
        fatal("Backend server failed to start within 10 seconds.\nSee desktop.log for the server traceback.")
    log("server is up")

    app = TrayApp()

    # register the window-raise hook for /api/desktop/show + mark desktop mode
    import main
    main.app.state.show_window = app.show_window
    main.app.state.desktop = True

    try:
        log("importing webview")
        import webview
        log(f"pywebview {getattr(webview, '__version__', '?')} imported, creating window")
        app.window = webview.create_window(
            "AROK Monitor",
            f"http://{HOST}:{PORT}",
            width=1280,
            height=820,
            min_size=(960, 640),
            background_color="#07090f",
        )
        app.window.events.closing += app.on_closing
        app.build_tray()
        log("entering webview.start()")
        webview.start()
        log("webview loop ended")
    except Exception:
        fatal("UI failed to start:\n" + traceback.format_exc())
    finally:
        try:
            if app.icon:
                app.icon.stop()
        except Exception:
            pass


if __name__ == "__main__":
    try:
        start()
    except SystemExit:
        raise
    except Exception:
        fatal("Unhandled error:\n" + traceback.format_exc())
