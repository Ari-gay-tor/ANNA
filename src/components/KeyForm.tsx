"use client";

import { useState, type FormEvent } from "react";
import { api } from "./api";
import { IconEye, IconEyeOff } from "./icons";
import type { KeySaved } from "./types";
import styles from "./KeyForm.module.css";

interface Props {
  /** Called after the key was checked and saved. The key itself is already cleared from the form. */
  onSaved: (result: KeySaved) => void;
  autoFocus?: boolean;
  label?: string;
}

/** The Gemini key field (hidden by default, with show/hide) and the "Check and save" button. Shared by Setup and Settings. */
export function KeyForm({ onSaved, autoFocus = false, label = "Your Gemini key" }: Props) {
  const [key, setKey] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = key.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.saveKey(trimmed);
      setKey("");
      setShown(false);
      if (result.status === "quota" && result.message) setNotice(result.message);
      onSaved(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <label className={styles.label} htmlFor="gemini-key">
        {label}
      </label>
      <div className={styles.field}>
        <input
          id="gemini-key"
          className={styles.input}
          type={shown ? "text" : "password"}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          autoFocus={autoFocus}
          maxLength={300}
          placeholder="Paste it here"
          data-1p-ignore
        />
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setShown((s) => !s)}
          aria-pressed={shown}
          aria-label={shown ? "Hide key" : "Show key"}
          title={shown ? "Hide key" : "Show key"}
        >
          {shown ? <IconEyeOff size={18} /> : <IconEye size={18} />}
        </button>
      </div>
      <button type="submit" className={`btn btn-primary ${styles.submit}`} disabled={busy || key.trim() === ""}>
        {busy ? "Checking…" : "Check and save"}
      </button>
      {error && (
        <p className={`${styles.message} ${styles.error}`} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={`${styles.message} ${styles.notice}`} role="status">
          {notice}
        </p>
      )}
    </form>
  );
}
