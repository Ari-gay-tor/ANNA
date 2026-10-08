"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { ConfirmDialog } from "./ConfirmDialog";
import { IconDownload, IconFlag, IconTrash } from "./icons";
import type { ClientFeedback } from "./types";
import styles from "./Page.module.css";

export function FeedbackPage() {
  const [items, setItems] = useState<ClientFeedback[] | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api.listFeedback();
      setItems(result.items);
      setVersion(result.version);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const empty = items !== null && items.length === 0;

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <h1 className={styles.title}>Feedback</h1>
        <p className={`${styles.lead}`}>Replies you flagged as not helpful. They stay on this PC until you export them.</p>
        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}
        {items === null && !error && <p className={`${styles.muted} ${styles.lead}`}>Loading…</p>}
        {empty && <p className={styles.empty}>Nothing flagged yet. When a reply doesn&apos;t help, click the flag under it.</p>}

        {items && (
          <div className={styles.exportBox}>
            <p>This file contains the flagged messages and the turns just before them. Read it before you send it.</p>
            {items.length > 0 ? (
              <a className={`btn btn-primary ${styles.linkButton}`} href="/api/feedback/export" download>
                <IconDownload size={16} />
                Export for Ari
              </a>
            ) : (
              <button type="button" className="btn btn-primary" disabled>
                <IconDownload size={16} />
                Export for Ari
              </button>
            )}
          </div>
        )}

        {items && items.length > 0 && (
          <ul className={`${styles.list} ${styles.group}`}>
            {items.map((item) => (
              <FeedbackCard key={item.id} item={item} onDeleted={(id) => setItems((all) => all?.filter((i) => i.id !== id) ?? null)} />
            ))}
          </ul>
        )}

        {version && <p className={styles.version}>ANNA v{version}</p>}
      </div>
    </div>
  );
}

function FeedbackCard({ item, onDeleted }: { item: ClientFeedback; onDeleted: (id: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api.deleteFeedback(item.id);
      onDeleted(item.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setConfirming(false);
      setBusy(false);
    }
  }

  return (
    <li className={styles.card}>
      <div className={styles.rowTop}>
        <span className={styles.rowIcon}>
          <IconFlag size={18} />
        </span>
        <div className={styles.rowBody}>
          <div className={styles.meta}>
            <span>{new Date(item.createdAt).toLocaleDateString("en-CA")}</span>
            {item.conversationExists ? (
              <Link href={`/?c=${encodeURIComponent(item.conversationId)}`}>Open conversation</Link>
            ) : (
              <span>from a deleted conversation</span>
            )}
          </div>
          {item.userText && (
            <>
              <p className={styles.fieldLabel}>You said</p>
              <p className={styles.fieldText}>{item.userText}</p>
            </>
          )}
          <p className={styles.fieldLabel}>ANNA replied</p>
          <p className={styles.fieldText}>{item.replyText}</p>
          {item.note && (
            <>
              <p className={styles.fieldLabel}>What you needed instead</p>
              <p className={styles.fieldText}>{item.note}</p>
            </>
          )}
          <div className={styles.actions}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(true)} disabled={busy}>
              <IconTrash size={15} />
              Delete
            </button>
          </div>
        </div>
      </div>
      {error && (
        <p className={styles.itemError} role="alert">
          {error}
        </p>
      )}
      {confirming && (
        <ConfirmDialog title="Delete this feedback?" confirmLabel="Delete" busy={busy} onCancel={() => setConfirming(false)} onConfirm={() => void remove()}>
          <p>It will not be in your export.</p>
        </ConfirmDialog>
      )}
    </li>
  );
}
