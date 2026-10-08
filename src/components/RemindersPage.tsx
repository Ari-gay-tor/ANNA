"use client";

import { useCallback, useEffect, useState } from "react";
import { formatReminderDue } from "@/core/time/format-reminder-time";
import { api } from "./api";
import { IconBell, IconCheck, IconX } from "./icons";
import type { ClientReminder } from "./types";
import styles from "./Page.module.css";

const REFRESH_MS = 15_000;

type Permission = "unsupported" | NotificationPermission;

export function RemindersPage() {
  const [data, setData] = useState<{ upcoming: ClientReminder[]; recent: ClientReminder[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.listReminders());
      setError(null);
    } catch (e) {
      setError(messageOf(e));
    }
  }, []);

  // Refresh every 15 s so an upcoming reminder moves to Recent when it fires.
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const empty = data !== null && data.upcoming.length === 0 && data.recent.length === 0;
  const now = new Date();

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <h1 className={styles.title}>Reminders</h1>
        <NotificationButton />
        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}
        {data === null && !error && <p className={`${styles.muted} ${styles.lead}`}>Loading…</p>}
        {empty && <p className={styles.empty}>No reminders. Ask ANNA: &apos;Remind me at 6 PM to call Dad.&apos;</p>}

        {data && data.upcoming.length > 0 && (
          <section className={styles.group}>
            <h2 className={styles.groupTitle}>Upcoming</h2>
            <ul className={styles.list}>
              {data.upcoming.map((r) => (
                <UpcomingItem key={r.id} reminder={r} now={now} onChanged={load} />
              ))}
            </ul>
          </section>
        )}

        {data && data.recent.length > 0 && (
          <section className={styles.group}>
            <h2 className={styles.groupTitle}>Recent</h2>
            <ul className={styles.list}>
              {data.recent.map((r) => (
                <li key={r.id} className={styles.card}>
                  <div className={styles.rowTop}>
                    <span className={styles.rowIcon}>{r.status === "cancelled" ? <IconX size={18} /> : <IconCheck size={18} />}</span>
                    <div className={styles.rowBody}>
                      <p className={styles.text}>{r.text}</p>
                      <div className={styles.meta}>
                        <span>{formatReminderDue(new Date(r.dueAt), r.timezone, now)}</span>
                        <span className={styles.pill}>{recentLabel(r)}</span>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function recentLabel(r: ClientReminder): string {
  if (r.status === "cancelled") return "Cancelled";
  return r.missed ? "Missed (ANNA wasn't running)" : "Fired";
}

function UpcomingItem({ reminder, now, onChanged }: { reminder: ClientReminder; now: Date; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await api.cancelReminder(reminder.id);
    } catch (e) {
      // 409 means it already fired or was cancelled; reloading shows where it went.
      setError(messageOf(e));
    }
    await onChanged();
    setBusy(false);
  }

  return (
    <li className={styles.card}>
      <div className={styles.rowTop}>
        <span className={styles.rowIcon}>
          <IconBell size={18} />
        </span>
        <div className={styles.rowBody}>
          <p className={styles.text}>{reminder.text}</p>
          <div className={styles.meta}>
            <span>{formatReminderDue(new Date(reminder.dueAt), reminder.timezone, now)}</span>
          </div>
        </div>
        <button type="button" className="btn btn-sm" onClick={cancel} disabled={busy}>
          Cancel
        </button>
      </div>
      {error && (
        <p className={styles.itemError} role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

/** The only place desktop-notification permission is ever requested, and only when the button is clicked. */
function NotificationButton() {
  const [permission, setPermission] = useState<Permission | null>(null);

  useEffect(() => {
    setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);

  async function enable() {
    try {
      setPermission(await Notification.requestPermission());
    } catch {
      setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
    }
  }

  if (permission === null) return null;
  return (
    <div className={styles.notify}>
      {permission === "default" && (
        <button type="button" className="btn btn-sm" onClick={() => void enable()}>
          <IconBell size={15} />
          Turn on desktop notifications
        </button>
      )}
      {permission === "granted" && <span className={styles.muted}>Desktop notifications are on.</span>}
      {permission === "denied" && <span className={styles.muted}>Desktop notifications are blocked in your browser settings.</span>}
      {permission === "unsupported" && <span className={styles.muted}>This browser does not support desktop notifications.</span>}
    </div>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
