"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiFailure, api } from "./api";
import { missedMessage, reminderMessage } from "./reminder-text";
import type { ClientReminder } from "./types";
import styles from "./ReminderBanner.module.css";

export const DUE_POLL_MS = 15_000;
const NOTIFIED_KEY = "anna.notifiedReminders";

// Reminder ids that already had a desktop notification, kept across reloads and tabs. Storage can be unavailable; then it is per page load.
function loadNotified(): Set<string> {
  try {
    const raw = window.localStorage.getItem(NOTIFIED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function saveNotified(ids: Set<string>): void {
  try {
    window.localStorage.setItem(NOTIFIED_KEY, JSON.stringify([...ids].slice(-200)));
  } catch {
    // Not fatal: at worst a reminder notifies again after a reload.
  }
}

/** Sits in the root layout, so a fired reminder shows on every page. */
export function ReminderBanner() {
  const [reminders, setReminders] = useState<ClientReminder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const notified = useRef<Set<string> | null>(null);

  const refresh = useCallback(async () => {
    let due: ClientReminder[];
    try {
      due = (await api.dueReminders()).reminders;
    } catch {
      return; // The server may be restarting. The next tick tries again.
    }
    setReminders(due);

    // A desktop notification once per reminder id, and only if the user already granted permission (never asked from here).
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    notified.current ??= loadNotified();
    const seen = notified.current;
    const fresh = due.filter((r) => !seen.has(r.id));
    if (fresh.length === 0) return;
    for (const r of fresh) {
      seen.add(r.id);
      try {
        new Notification("ANNA", { body: reminderMessage(r), tag: r.id });
      } catch {
        // Some browsers refuse the constructor (e.g. on mobile); the banner still shows.
      }
    }
    saveNotified(seen);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), DUE_POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  async function dismiss(id: string) {
    setError(null);
    try {
      await api.acknowledgeReminder(id);
    } catch (e) {
      // Gone or not fired any more: nothing left to dismiss.
      if (!(e instanceof ApiFailure && (e.status === 404 || e.status === 409))) {
        setError(e instanceof Error ? e.message : "Could not dismiss that.");
        return;
      }
    }
    setReminders((all) => all.filter((r) => r.id !== id));
  }

  if (reminders.length === 0) return null;
  const now = new Date();
  return (
    <div className={styles.banner} role="status" aria-live="polite">
      {reminders.map((r) => (
        <div key={r.id} className={styles.item}>
          <div className={styles.text}>
            <strong>{reminderMessage(r)}</strong>
            {r.missed && <div className={styles.missed}>{missedMessage(r, now)}</div>}
          </div>
          <button type="button" className={styles.dismiss} onClick={() => void dismiss(r.id)}>
            Dismiss
          </button>
        </div>
      ))}
      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
}
