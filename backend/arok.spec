# PyInstaller spec — build with: pyinstaller arok.spec
# Produces dist/AROK/AROK.exe (one-folder build: faster startup than one-file)
import os

block_cipher = None

a = Analysis(
    ["desktop.py"],
    pathex=["."],
    binaries=[],
    datas=[
        ("../frontend/dist", "frontend/dist"),  # React build (dual-serving)
        ("index.html", "."),                    # legacy fallback UI
        ("icon.ico", "."),                      # tray icon
    ] + ([("license_pub.hex", ".")] if os.path.exists("license_pub.hex") else []),
    hiddenimports=[
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
