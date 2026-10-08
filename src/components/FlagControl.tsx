"use client";

import { useId, useState, type FormEvent, type KeyboardEvent } from "react";
import { api } from "./api";
import { IconFlag } from "./icons";
import styles from "./FlagControl.module.css";

interface Props {
  messageId: string;
  initialFlagged: boolean;
  /** Extra class for the button, so the message row can show it only on hover or focus. */
  buttonClassName?: string;
}

/**
 * "Not helpful" under an ANNA reply: a quiet flag button that opens a short form (the note is optional).
 * Once saved, the reply shows a subtle "Flagged". Rendered inside the message's meta row; the form takes a full row.
 */
export function FlagControl({ messageId, initialFlagged, buttonClassName = "" }: Props) {
  const [flagged, setFlagged] = useState(initialFlagged);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();

  if (flagged) {
    return (
      <span className={styles.flagged}>
        <IconFlag size={13} />
        Flagged
      </span>
    );
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.flagMessage(messageId, note.trim());
      setFlagged(true);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void save();
    }
  }

  return (
    <>
      <button
        type="button"
        className={`${styles.flag} ${buttonClassName}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="This reply wasn't helpful"
      >
        <IconFlag size={14} />
        Not helpful
      </button>
      {open && (
        <form className={styles.form} onSubmit={save} onKeyDown={onKeyDown}>
          <label className={styles.label} htmlFor={fieldId}>
            What did you need instead? <span className={styles.hint}>(optional)</span>
          </label>
          <textarea id={fieldId} className={styles.note} rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
          <div className={styles.actions}>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
              Save
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
          </div>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </>
  );
}
