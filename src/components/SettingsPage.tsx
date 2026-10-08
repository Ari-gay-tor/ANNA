"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { KeyForm } from "./KeyForm";
import type { KeyStatus } from "./types";
import styles from "./Page.module.css";

export function SettingsPage() {
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await api.keyStatus());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <h1 className={styles.title}>Settings</h1>
        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}
        {status === null && !error && <p className={`${styles.muted} ${styles.lead}`}>Loading…</p>}
        {status && (
          <>
            <section className={styles.group}>
              <h2 className={styles.groupTitle}>Gemini key</h2>
              <div className={`${styles.card} ${styles.stack}`}>
                <div>
                  {status.configured ? (
                    <p className={styles.maskedKey}>
                      Saved key: <span aria-label={status.last4 ? `ends in ${status.last4}` : "saved"}>{status.last4 ? `••••••••${status.last4}` : "••••••••"}</span>
                    </p>
                  ) : (
                    <p>No key saved yet.</p>
                  )}
                  <p className={styles.sectionNote}>
                    ANNA shows only the last 4 characters. To change it, paste a new key below. Use a Google account or project without billing.
                  </p>
                </div>
                <KeyForm
                  label="New Gemini key"
                  onSaved={() => {
                    setSaved(true);
                    void load();
                  }}
                />
                {saved && (
                  <p className={styles.sectionNote} role="status">
                    Saved. ANNA is using the new key now.
                  </p>
                )}
              </div>
            </section>

            <section className={styles.group}>
              <h2 className={styles.groupTitle}>Your data</h2>
              <div className={styles.card}>
                {status.dataDir ? (
                  <>
                    <p>Everything ANNA remembers is stored only on this PC.</p>
                    <p className={styles.sectionNote}>Folder: {status.dataDir}</p>
                  </>
                ) : (
                  <p>Everything ANNA remembers is stored in the ANNA folder on this PC.</p>
                )}
              </div>
            </section>

            <p className={styles.version}>ANNA v{status.version}</p>
          </>
        )}
      </div>
    </div>
  );
}
