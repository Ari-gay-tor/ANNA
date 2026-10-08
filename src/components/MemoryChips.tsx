import { useState } from "react";
import { ApiFailure, api } from "./api";
import { IconBrain, IconX } from "./icons";
import type { ClientOperation } from "./types";
import styles from "./Chips.module.css";

interface Props {
  operations: ClientOperation[];
  /** Memory ids forgotten during this page's lifetime (shared across messages). */
  forgotten: ReadonlySet<string>;
  onForgotten: (memoryId: string) => void;
}

type Shown = Extract<ClientOperation, { kind: "memory.created" | "memory.updated" }>;

/** Chips for memories this reply saved or changed. Rejected and duplicate ops get no chip. */
export function MemoryChips({ operations, forgotten, onForgotten }: Props) {
  const shown = operations.filter((op): op is Shown => op.kind === "memory.created" || op.kind === "memory.updated");
  if (shown.length === 0) return null;
  return (
    <div className={styles.chips}>
      {shown.map((op, i) => (
        <Chip key={`${op.memoryId}-${i}`} op={op} gone={op.exists === false || forgotten.has(op.memoryId)} onForgotten={onForgotten} />
      ))}
    </div>
  );
}

function Chip({ op, gone, onForgotten }: { op: Shown; gone: boolean; onForgotten: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  async function forget() {
    setBusy(true);
    setFailed(null);
    try {
      await api.deleteMemory(op.memoryId);
      onForgotten(op.memoryId);
    } catch (e) {
      // Already deleted elsewhere (e.g. the Memory page): same end state.
      if (e instanceof ApiFailure && e.status === 404) onForgotten(op.memoryId);
      else setFailed(e instanceof Error ? e.message : "Could not forget that.");
    } finally {
      setBusy(false);
    }
  }

  if (gone) {
    return (
      <div className={`${styles.chip} ${styles.gone}`}>
        <IconX size={16} className={styles.icon} />
        <span className={styles.label}>Forgotten</span>
      </div>
    );
  }
  return (
    <div className={styles.chip}>
      <IconBrain size={16} className={styles.icon} />
      <span className={styles.label}>
        {op.kind === "memory.created"
          ? `Remembered: ${op.statement}`
          : `Updated: ${op.statement} (was: ${op.previousStatement})`}
      </span>
      <button type="button" className={styles.action} onClick={forget} disabled={busy}>
        Forget
      </button>
      {failed && <span className={styles.failed}>{failed}</span>}
    </div>
  );
}
