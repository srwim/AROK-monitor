import { useState } from "react";
import { AlertTriangle, ShieldCheck, Trash2, ExternalLink } from "lucide-react";
import { api, type RegistryIssue } from "../api";
import { Panel, Badge, Button } from "../components/ui";

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-800/60 bg-amber-950/30 px-4 py-3">
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-400" />
      <div className="text-sm leading-relaxed text-amber-200/90">{children}</div>
    </div>
  );
}

// ── Registry cleaner ──────────────────────────────────────────────────────────
function RegistrySection() {
  const [issues, setIssues] = useState<RegistryIssue[] | null>(null);
  const [supported, setSupported] = useState(true);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [consent, setConsent] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const scan = async () => {
    setScanning(true);
    setResult(null);
    try {
      const r = await api.registryScan();
      setSupported(r.supported);
      setIssues(r.issues);
      setSel(new Set(r.issues.map((i) => i.id))); // pre-select all found
    } finally {
      setScanning(false);
    }
  };

  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const clean = async () => {
    if (!issues || !consent || sel.size === 0 || busy) return;
    setBusy(true);
    setResult(null);
    try {
      // restore point first — hard gate
      const rp = await api.cleanupRestorePoint();
      if (!rp.ok) {
        setResult(`Restore point failed, cleanup aborted. ${rp.detail ?? ""}`);
        return;
      }
      const r = await api.registryClean([...sel], issues);
      setResult(
        `${r.detail ?? "Done."}` + (r.backup_dir ? ` Backups saved to ${r.backup_dir}.` : "")
      );
      await scan(); // refresh
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="Registry Cleaner (conservative, known-safe only)"
      action={<Button onClick={scan} disabled={scanning}>{scanning ? "Scanning…" : "Scan"}</Button>}
    >
      <Notice>
        Editing the Windows registry can destabilize your system. AROK only targets well-understood
        leftovers (dead startup entries, orphaned uninstall records), and <strong>always creates a
        restore point and exports a <code>.reg</code> backup</strong> of every key before removing it.
      </Notice>

      {!supported && (
        <p className="mt-4 text-sm text-slate-500">Registry tools are available on Windows only.</p>
      )}

      {issues && supported && (
        issues.length === 0 ? (
          <p className="mt-4 text-sm text-emerald-400">No known-safe registry issues found.</p>
        ) : (
          <div className="mt-4 space-y-2">
            {issues.map((it) => (
              <label key={it.id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
                <input type="checkbox" checked={sel.has(it.id)} onChange={() => toggle(it.id)} className="mt-1 accent-cyan-500" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge tone="amber">{it.category}</Badge>
                    <span className="text-sm text-slate-300">{it.name}</span>
                    <span className="text-[10px] uppercase text-slate-600">{it.hive}</span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-slate-500">{it.detail}</div>
                </div>
              </label>
            ))}

            <label className="mt-2 flex items-center gap-2 text-xs text-slate-400">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="accent-cyan-500" />
              I understand a restore point + .reg backup will be made, and I want to remove the selected entries.
            </label>
            <Button danger onClick={clean} disabled={!consent || sel.size === 0 || busy}>
              {busy ? "Cleaning…" : `Create Restore Point & Clean ${sel.size} Selected`}
            </Button>
          </div>
        )
      )}

      {result && <p className="mt-3 text-sm text-cyan-300">{result}</p>}
    </Panel>
  );
}

// ── Guided Tron launcher ──────────────────────────────────────────────────────
function TronSection() {
  const [path, setPath] = useState("");
  const [sha, setSha] = useState("");
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [consent, setConsent] = useState(false);
  const [launchMsg, setLaunchMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const verify = async () => {
    setVerifyMsg(null);
    const r = await api.tronVerify(path, sha);
    setVerified(r.ok);
    setVerifyMsg(r.detail ?? (r.ok ? "Verified." : "Checksum mismatch."));
  };

  const browse = async () => {
    try {
      const r = await api.pickFile(["Batch files (*.bat)", "All files (*.*)"]);
      if (r.path) {
        setPath(r.path);
        setVerified(false);
      } else if (r.detail) {
        setVerifyMsg(r.detail);
      }
    } catch {
      setVerifyMsg("Couldn’t open the file picker — type the path manually.");
    }
  };

  const launch = async () => {
    if (!verified || !consent || busy) return;
    setBusy(true);
    setLaunchMsg(null);
    try {
      const r = await api.tronLaunch(path, true);
      setLaunchMsg(r.detail ?? (r.ok ? "Launched." : "Failed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Tron — Deep Clean & Debloat (guided)">
      <Notice>
        Tron is a powerful third-party maintenance script that makes aggressive system changes. AROK
        does <strong>not</strong> auto-download it (official distribution uses rotating mirrors). Download it
        yourself, paste the SHA-256 from the official thread, and AROK will verify the file and create a
        restore point before launching it.
      </Notice>

      <ol className="mt-4 space-y-3 text-sm text-slate-400">
        <li>
          1. Get Tron from the official source:{" "}
          <a href="https://old.reddit.com/r/TronScript/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-cyan-400 hover:underline">
            r/TronScript <ExternalLink size={11} />
          </a>{" "}
          ·{" "}
          <a href="https://github.com/bmrf/tron" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-cyan-400 hover:underline">
            bmrf/tron <ExternalLink size={11} />
          </a>
        </li>
        <li>
          2. Path to <code>tron.bat</code> (inside the extracted folder):
          <div className="mt-1 flex gap-2">
            <input
              value={path}
              onChange={(e) => { setPath(e.target.value); setVerified(false); }}
              placeholder={"C:\\Users\\you\\Downloads\\Tron\\tron.bat"}
              className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 font-mono text-xs text-slate-200 placeholder:text-slate-600 focus:border-cyan-700 focus:outline-none"
            />
            <Button onClick={browse}>Browse…</Button>
          </div>
        </li>
        <li>
          3. Official SHA-256 (paste from the release thread):
          <div className="mt-1 flex gap-2">
            <input
              value={sha}
              onChange={(e) => { setSha(e.target.value); setVerified(false); }}
              placeholder="e3b0c44298fc1c14…"
              className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 font-mono text-xs text-slate-200 placeholder:text-slate-600 focus:border-cyan-700 focus:outline-none"
            />
            <Button onClick={verify} disabled={!path || !sha}>Verify</Button>
          </div>
          {verifyMsg && (
            <p className={`mt-1 text-xs ${verified ? "text-emerald-400" : "text-red-400"}`}>
              {verified ? <ShieldCheck size={12} className="mr-1 inline" /> : null}
              {verifyMsg}
            </p>
          )}
        </li>
        <li>
          4. Launch:
          <label className="mt-1 flex items-center gap-2 text-xs text-slate-400">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="accent-cyan-500" disabled={!verified} />
            I verified the checksum and consent to AROK creating a restore point and launching Tron elevated.
          </label>
          <Button danger onClick={launch} disabled={!verified || !consent || busy}>
            {busy ? "Launching…" : "Create Restore Point & Launch Tron"}
          </Button>
          {launchMsg && <p className="mt-1 text-xs text-cyan-300">{launchMsg}</p>}
        </li>
      </ol>
    </Panel>
  );
}

// ── Temp cleanup ──────────────────────────────────────────────────────────────
function TempSection() {
  const [mb, setMb] = useState<number | null>(null);
  const [files, setFiles] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const scan = async () => {
    const r = await api.tempScan();
    setMb(r.mb);
    setFiles(r.files);
    setMsg(null);
  };
  const clean = async () => {
    setBusy(true);
    try {
      const r = await api.tempClean();
      setMsg(`Freed ${r.freed_mb ?? 0} MB (${r.removed ?? 0} files). Files in use were skipped.`);
      await scan();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="Temporary Files"
      action={<Button onClick={scan}>Scan</Button>}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">
          {mb === null ? "Scan to estimate reclaimable temp space." : `${mb} MB across ${files} files in temp folders.`}
        </p>
        <Button danger onClick={clean} disabled={busy || mb === null}>
          <Trash2 size={12} className="mr-1 inline" />
          {busy ? "Cleaning…" : "Clean Temp"}
        </Button>
      </div>
      {msg && <p className="mt-2 text-sm text-cyan-300">{msg}</p>}
    </Panel>
  );
}

export default function CleanupTab() {
  const [rpMsg, setRpMsg] = useState<string | null>(null);
  const [rpBusy, setRpBusy] = useState(false);

  const makeRestorePoint = async () => {
    setRpBusy(true);
    try {
      const r = await api.cleanupRestorePoint();
      setRpMsg(r.detail ?? (r.ok ? "Restore point created." : "Failed."));
    } finally {
      setRpBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-200">Cleanup</h2>
        <Button onClick={makeRestorePoint} disabled={rpBusy}>
          <ShieldCheck size={13} className="mr-1 inline" />
          {rpBusy ? "Creating…" : "Create Restore Point Now"}
        </Button>
      </div>
      {rpMsg && (
        <div className="rounded-lg border border-cyan-900 bg-cyan-950/40 px-4 py-2 text-sm text-cyan-300">
          {rpMsg} <button className="ml-2 text-cyan-500" onClick={() => setRpMsg(null)}>dismiss</button>
        </div>
      )}

      <TempSection />
      <RegistrySection />
      <TronSection />
    </div>
  );
}
