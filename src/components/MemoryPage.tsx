"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { confidenceLabel, MAX_STATEMENT_LENGTH, type MemoryOrigin, type MemoryType } from "@/core/domain/memory";
import { api } from "./api";
import { ConfirmDialog } from "./ConfirmDialog";
import { IconPencil, IconTrash } from "./icons";
import type { ClientMemory } from "./types";
import styles from "./Page.module.css";

const GROUPS: Array<{ type: MemoryType; title: string }> = [
  { type: "preference", title: "Preferences" },
  { type: "goal", title: "Goals" },
  { type: "commitment", title: "Commitments" },
  { type: "fact", title: "Facts" },
  { type: "pattern", title: "Patterns" },
];

const ORIGIN_LABEL: Record<MemoryOrigin, string> = {
  stated: "Said by you",
  inferred: "Inferred",
  edited: "Edited by you",
};

export function MemoryPage() {
  const [memories, setMemories] = useState<ClientMemory[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setMemories((await api.listMemories()).memories);
      setError(null);
    } catch (e) {
      setError(messageOf(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // An edit returns the memory without sourceExists; keep the value the list already had.
  const replace = (updated: ClientMemory) => setMemories((all) => all?.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)) ?? null);
  const remove = (id: string) => setMemories((all) => all?.filter((m) => m.id !== id) ?? null);

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <h1 className={styles.title}>What ANNA knows about you</h1>
        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}
        {memories === null && !error && <p className={`${styles.muted} ${styles.lead}`}>Loading…</p>}
        {memories !== null && memories.length === 0 && <p className={styles.empty}>Nothing saved yet. Tell ANNA to remember something.</p>}
        {memories?.length
          ? GROUPS.map(({ type, title }) => {
              const items = memories.filter((m) => m.type === type);
              if (items.length === 0) return null;
              return (
                <section key={type} className={styles.group}>
                  <h2 className={styles.groupTitle}>{title}</h2>
                  <ul className={styles.list}>
                    {items.map((m) => (
                      <MemoryItem key={m.id} memory={m} onSaved={replace} onDeleted={remove} />
                    ))}
                  </ul>
                </section>
              );
            })
          : null}
      </div>
    </div>
  );
}

function MemoryItem({
  memory,
  onSaved,
  onDeleted,
}: {
  memory: ClientMemory;
  onSaved: (memory: ClientMemory) => void;
  onDeleted: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState(memory.statement);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      onSaved((await api.editMemory(memory.id, draft)).memory);
      setEditing(false);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function del() {
    setBusy(true);
    setError(null);
    try {
      await api.deleteMemory(memory.id);
      onDeleted(memory.id);
    } catch (e) {
      setConfirming(false);
      setError(messageOf(e));
      setBusy(false);
    }
  }

  return (
    <li className={styles.card}>
      {editing ? (
        <>
          <textarea
            className={styles.editor}
            value={draft}
            maxLength={MAX_STATEMENT_LENGTH}
            rows={3}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Memory text"
            autoFocus
          />
          <div className={styles.actions}>
            <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={busy || draft.trim() === ""}>
              Save
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setEditing(false);
                setDraft(memory.statement);
                setError(null);
              }}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p className={styles.statement}>{memory.statement}</p>
          <div className={styles.meta}>
            <span className={`${styles.pill} ${styles.pillSoft}`}>{confidenceLabel(memory.confidence)} confidence</span>
            <span className={styles.pill}>{ORIGIN_LABEL[memory.origin]}</span>
            <span>{new Date(memory.createdAt).toLocaleDateString("en-CA")}</span>
            {memory.sourceKind === "setup" && <span>From setup</span>}
            {memory.sourceKind !== "setup" &&
              memory.sourceConversationId &&
              (memory.sourceExists === false ? (
                <span>from a deleted conversation</span>
              ) : (
                <Link href={`/?c=${encodeURIComponent(memory.sourceConversationId)}`}>Open conversation</Link>
              ))}
          </div>
          {memory.evidenceQuote && <q className={styles.quote}>{memory.evidenceQuote}</q>}
          <div className={styles.actions}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setDraft(memory.statement);
                setEditing(true);
              }}
              disabled={busy}
            >
              <IconPencil size={15} />
              Edit
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(true)} disabled={busy}>
              <IconTrash size={15} />
              Delete
            </button>
          </div>
        </>
      )}
      {error && (
        <p className={styles.itemError} role="alert">
          {error}
        </p>
      )}
      {confirming && (
        <ConfirmDialog title="Delete this memory?" confirmLabel="Delete" busy={busy} onCancel={() => setConfirming(false)} onConfirm={() => void del()}>
          <p>ANNA will no longer know it.</p>
        </ConfirmDialog>
      )}
    </li>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
