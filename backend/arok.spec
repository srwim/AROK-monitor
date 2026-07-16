# PyInstaller spec — build with: pyinstaller arok.spec
# Produces dist/AROK/AROK.exe (one-folder build: faster startup than one-file)
import importlib.util
import os

block_cipher = None

# Local-AI runtime (llama-cpp-python) is optional: bundle it when installed —
# including its native DLLs in llama_cpp/lib — but never fail the build over it.
if importlib.util.find_spec("llama_cpp"):
    from PyInstaller.utils.hooks import collect_all
    _llama_datas, _llama_bins, _llama_hidden = collect_all("llama_cpp")
    print("arok.spec: bundling local-AI runtime (llama_cpp)")
else:
    _llama_datas, _llama_bins, _llama_hidden = [], [], []
    print("arok.spec: llama_cpp not installed - exe ships without local AI")

a = Analysis(
    ["desktop.py"],
    pathex=["."],
    binaries=_llama_bins,
    datas=[
        ("../frontend/dist", "frontend/dist"),  # React build (dual-serving)
        ("index.html", "."),                    # legacy fallback UI
        ("icon.ico", "."),                      # tray icon
    ] + ([("license_pub.hex", ".")] if os.path.exists("license_pub.hex") else [])
      + _llama_datas,
    hiddenimports=_llama_hidden + [
        "uvicorn.logging", "uvicorn.loops", "uvicorn.loops.auto",
        "uvicorn.protocols", "uvicorn.protocols.http", "uvicorn.protocols.http.auto",
        "uvicorn.protocols.websockets", "uvicorn.protocols.websockets.auto",
        "uvicorn.lifespan", "uvicorn.lifespan.on",
        # pywebview Windows backend (WebView2 via .NET)
        "webview.platforms.winforms", "webview.platforms.edgechromium",
        "clr_loader", "pythonnet",
        # system tray
        "pystray._win32", "PIL.Image", "PIL.ImageDraw",
        # hardware inventory via WMI (GPU, motherboard, RAM type/speed)
        "wmi", "win32com", "win32com.client", "win32timezone", "pythoncom", "pywintypes",
    ],
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib"],
    cipher=block_cipher,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="AROK",
    debug=False,
    strip=False,
    upx=False,
    console=False,  # no console window
    icon="icon.ico",  # caged-orb brand mark
)

coll = COLLECT(exe, a.binaries, a.zipfiles, a.datas, strip=False, upx=False, name="AROK")
