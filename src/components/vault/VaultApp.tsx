"use client";

import { useCallback, useEffect, useState } from "react";

import { LoginForm } from "@/components/LoginForm";
import { LogoutButton } from "@/components/LogoutButton";
import { initializeAuth } from "@/lib/auth/browser";
import {
  clearDeviceEnvelope,
  loadVmkFromDevice,
  saveDeviceEnvelope,
} from "@/lib/crypto/deviceStore";
import {
  deleteNote as pdsDeleteNote,
  getKeyring,
  listNotes,
  newNoteRkey,
  putKeyring,
  putNote,
} from "@/lib/crypto/encStore";
import {
  decryptNote,
  encryptNote,
  generateRecoveryKey,
  generateVmk,
  getVmk,
  lock,
  recoveryKeyFromString,
  recoveryKeyToString,
  setVmk,
  unwrap,
  wrap,
} from "@/lib/crypto/vault";

type Phase = "loading" | "login" | "setup" | "unlock" | "unlocked";

interface NoteItem {
  rkey: string;
  title: string;
  body: string;
}

export function VaultApp() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [did, setDid] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const [recoveryKeyDisplay, setRecoveryKeyDisplay] = useState<string | null>(null);
  const [recoveryInput, setRecoveryInput] = useState("");

  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [activeRkey, setActiveRkey] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");

  const loadAllNotes = useCallback(async () => {
    const records = await listNotes();
    const vmk = getVmk();
    const items: NoteItem[] = [];
    for (const record of records) {
      try {
        const plain = decryptNote(vmk, record);
        items.push({ rkey: record.rkey, title: plain.title, body: plain.body });
      } catch {
        items.push({ rkey: record.rkey, title: "(decryption failed)", body: "" });
      }
    }
    items.sort((a, b) => a.title.localeCompare(b.title));
    setNotes(items);
  }, []);

  const enterUnlocked = useCallback(async () => {
    setPhase("unlocked");
    setStatus("暗号化して同期済み");
    await loadAllNotes();
  }, [loadAllNotes]);

  // Boot: auth + decide phase.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const auth = await initializeAuth();
        if (cancelled) return;
        if (!auth.did) {
          setPhase("login");
          return;
        }
        setDid(auth.did);

        const vmk = await loadVmkFromDevice(auth.did);
        if (vmk) {
          setVmk(vmk);
          await enterUnlocked();
          return;
        }

        const keyring = await getKeyring();
        setPhase(keyring ? "unlock" : "setup");
      } catch (err) {
        if (!cancelled) {
          setStatus(err instanceof Error ? err.message : "Failed to initialize vault");
          setPhase("login");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enterUnlocked]);

  const handleSetup = useCallback(async () => {
    if (!did) return;
    setBusy(true);
    setStatus("Vaultを作成中…");
    try {
      const vmk = generateVmk();
      const recoveryKey = generateRecoveryKey();
      const recoveryEnvelope = wrap(recoveryKey, vmk);
      await putKeyring(recoveryEnvelope);
      await saveDeviceEnvelope(did, vmk);
      setVmk(vmk);
      setRecoveryKeyDisplay(recoveryKeyToString(recoveryKey));
      await enterUnlocked();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to set up vault");
    } finally {
      setBusy(false);
    }
  }, [did, enterUnlocked]);

  const handleUnlockWithRecovery = useCallback(async () => {
    if (!did) return;
    setBusy(true);
    setStatus("Recovery Keyで復号中…");
    try {
      const keyring = await getKeyring();
      if (!keyring) throw new Error("Keyring not found");
      const recoveryKey = recoveryKeyFromString(recoveryInput);
      const vmk = unwrap(recoveryKey, keyring.recoveryEnvelope);
      setVmk(vmk);
      await saveDeviceEnvelope(did, vmk); // this device becomes zero-input from now on
      setRecoveryInput("");
      await enterUnlocked();
    } catch {
      setStatus("Recovery Keyが正しくないか、復号に失敗しました");
    } finally {
      setBusy(false);
    }
  }, [did, enterUnlocked, recoveryInput]);

  const handleNewNote = useCallback(() => {
    setActiveRkey(null);
    setDraftTitle("");
    setDraftBody("");
  }, []);

  const handleSelectNote = useCallback((note: NoteItem) => {
    setActiveRkey(note.rkey);
    setDraftTitle(note.title);
    setDraftBody(note.body);
  }, []);

  const handleSaveNote = useCallback(async () => {
    setBusy(true);
    setStatus("保存中…");
    try {
      const vmk = getVmk();
      const rkey = activeRkey ?? newNoteRkey();
      const enc = encryptNote(vmk, { title: draftTitle, body: draftBody });
      await putNote(rkey, enc);
      setActiveRkey(rkey);
      await loadAllNotes();
      setStatus("暗号化して同期済み");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to save note");
    } finally {
      setBusy(false);
    }
  }, [activeRkey, draftBody, draftTitle, loadAllNotes]);

  const handleDeleteNote = useCallback(async () => {
    if (!activeRkey) return;
    if (!window.confirm("この暗号ノートを削除しますか？")) return;
    setBusy(true);
    try {
      await pdsDeleteNote(activeRkey);
      handleNewNote();
      await loadAllNotes();
      setStatus("削除しました");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to delete note");
    } finally {
      setBusy(false);
    }
  }, [activeRkey, handleNewNote, loadAllNotes]);

  const handleForgetDevice = useCallback(async () => {
    if (!did) return;
    if (
      !window.confirm(
        "この端末の鍵を削除します。次回はRecovery Keyが必要になります（新端末の体験を再現）。よろしいですか？",
      )
    ) {
      return;
    }
    await clearDeviceEnvelope(did);
    lock();
    setNotes([]);
    setPhase("unlock");
    setStatus("この端末の鍵を削除しました");
  }, [did]);

  // ---- Render ----

  if (phase === "loading") {
    return <Shell>Initializing vault…</Shell>;
  }

  if (phase === "login") {
    return (
      <Shell>
        <h1 className="mb-2 text-lg font-semibold">Encrypted Drafts (prototype)</h1>
        <p className="mb-4 text-sm text-slate-600">
          Bluesky (AT Protocol) でログインしてください。
        </p>
        <LoginForm />
      </Shell>
    );
  }

  if (phase === "setup") {
    return (
      <Shell>
        <Intro />
        <h2 className="mt-4 mb-2 text-base font-semibold">暗号Vaultを作成</h2>
        <p className="mb-4 text-sm text-slate-600">
          この端末に非抽出の端末鍵を作り、以後は<strong>入力なしで自動解錠</strong>します。
          別端末で開くための<strong>Recovery Key</strong>も生成します（1回だけ表示・要保管）。
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleSetup()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Vaultを作成して開く
        </button>
        {status ? <p className="mt-3 text-sm text-slate-500">{status}</p> : null}
      </Shell>
    );
  }

  if (phase === "unlock") {
    return (
      <Shell>
        <Intro />
        <h2 className="mt-4 mb-2 text-base font-semibold">別端末として解錠</h2>
        <p className="mb-3 text-sm text-slate-600">
          この端末には鍵がありません。初回に控えた<strong>Recovery Key</strong>を貼り付けてください。
          解錠後、この端末は次回から自動解錠になります。
        </p>
        <textarea
          value={recoveryInput}
          onChange={(e) => setRecoveryInput(e.target.value)}
          placeholder="Recovery Key（url-safe base64）"
          className="mb-3 h-20 w-full rounded-lg border border-slate-300 p-2 font-mono text-xs"
        />
        <button
          type="button"
          disabled={busy || !recoveryInput.trim()}
          onClick={() => void handleUnlockWithRecovery()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          解錠する
        </button>
        {status ? <p className="mt-3 text-sm text-slate-500">{status}</p> : null}
      </Shell>
    );
  }

  // unlocked
  return (
    <Shell wide>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
            🔒 {status || "暗号化して同期済み"}
          </span>
          {busy ? <span className="text-xs text-slate-500">…</span> : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleForgetDevice()}
            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
          >
            この端末の鍵を削除
          </button>
          <LogoutButton />
        </div>
      </div>

      {recoveryKeyDisplay ? (
        <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="mb-1 font-medium">Recovery Key（1回だけ表示・必ず保管）</div>
          <div className="mb-2 break-all rounded bg-white p-2 font-mono text-xs">
            {recoveryKeyDisplay}
          </div>
          <p className="mb-2 text-xs">
            別端末で開くにはこのキーが必要です。<strong>紛失すると復元できません</strong>。
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded border border-amber-400 bg-white px-2 py-1 text-xs hover:bg-amber-100"
              onClick={() => void navigator.clipboard?.writeText(recoveryKeyDisplay)}
            >
              コピー
            </button>
            <button
              type="button"
              className="rounded px-2 py-1 text-xs text-amber-800 hover:underline"
              onClick={() => setRecoveryKeyDisplay(null)}
            >
              保管した（閉じる）
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="rounded-lg border border-slate-200 bg-white p-2">
          <button
            type="button"
            onClick={handleNewNote}
            className="mb-2 w-full rounded bg-slate-800 px-2 py-1 text-xs font-medium text-white hover:bg-slate-700"
          >
            ＋ 新しい下書き
          </button>
          <ul className="space-y-1">
            {notes.length === 0 ? (
              <li className="px-2 py-1 text-xs text-slate-400">まだ暗号下書きはありません</li>
            ) : (
              notes.map((note) => (
                <li key={note.rkey}>
                  <button
                    type="button"
                    onClick={() => handleSelectNote(note)}
                    className={`w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-slate-100 ${
                      note.rkey === activeRkey ? "bg-slate-100 font-medium" : ""
                    }`}
                  >
                    {note.title || "(無題)"}
                  </button>
                </li>
              ))
            )}
          </ul>
        </aside>

        <section className="rounded-lg border border-slate-200 bg-white p-3">
          <input
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            placeholder="タイトル（暗号化されます）"
            className="mb-2 w-full rounded border border-slate-300 px-2 py-1 text-sm"
          />
          <textarea
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            placeholder="本文（暗号化されます）"
            className="mb-3 h-72 w-full rounded border border-slate-300 p-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleSaveNote()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              保存（暗号化して同期）
            </button>
            {activeRkey ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleDeleteNote()}
                className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                削除
              </button>
            ) : null}
          </div>
        </section>
      </div>
    </Shell>
  );
}

function Shell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,_#E9F4FF_0%,_#F8FAFC_45%)] p-4 md:p-6">
      <div
        className={`mx-auto rounded-xl border bg-white p-6 shadow-sm ${wide ? "max-w-5xl" : "max-w-lg"}`}
      >
        {children}
      </div>
    </main>
  );
}

function Intro() {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
      これはE2EE下書きの<strong>プロトタイプ</strong>です。本文・タイトルは端末内で暗号化され、
      暗号文だけがあなたのPDSに保存されます（サーバは中身を読めません）。
      解錠は普段この端末の鍵で自動、別端末はRecovery Keyで。
    </div>
  );
}
