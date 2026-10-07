"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { confidenceLabel, MAX_STATEMENT_LENGTH, type MemoryOrigin, type MemoryType } from "@/core/domain/memory";
import { api } from "./api";
import type { ClientMemory } from "./types";
import styles from "./MemoryPage.module.css";

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

  const replace = (updated: ClientMemory) => setMemories((all) => all?.map((m) => (m.id === updated.id ? updated : m)) ?? null);
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
        {memories === null && !error && <p className={styles.muted}>Loading…</p>}
        {memories !== null && memories.length === 0 && (
          <p className={styles.muted}>Nothing saved yet. Tell ANNA to remember something.</p>
        )}
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
    if (!window.confirm("Delete this memory? ANNA will no longer know it.")) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteMemory(memory.id);
      onDeleted(memory.id);
    } catch (e) {
      setError(messageOf(e));
      setBusy(false);
    }
  }

  return (
    <li className={styles.item}>
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
            <button type="button" onClick={save} disabled={busy || draft.trim() === ""}>
              Save
            </button>
            <button
              type="button"
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
          <p className={styles.meta}>
            <span>{confidenceLabel(memory.confidence)} confidence</span>
            <span>{ORIGIN_LABEL[memory.origin]}</span>
          </p>
          <p className={styles.source}>
            <span>{new Date(memory.createdAt).toLocaleDateString("en-CA")}</span>
            {memory.sourceConversationId && (
              <Link href={`/?c=${encodeURIComponent(memory.sourceConversationId)}`}>Open conversation</Link>
            )}
            {memory.evidenceQuote && <q className={styles.quote}>{memory.evidenceQuote}</q>}
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              onClick={() => {
                setDraft(memory.statement);
                setEditing(true);
              }}
              disabled={busy}
            >
              Edit
            </button>
            <button type="button" onClick={del} disabled={busy}>
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
    </li>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
