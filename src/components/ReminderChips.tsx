import { useState } from "react";
import { formatReminderDue } from "@/core/time/format-reminder-time";
import { ApiFailure, api } from "./api";
import { IconBell, IconCheck, IconX } from "./icons";
import type { ClientOperation } from "./types";
import styles from "./Chips.module.css";

type Shown = Extract<ClientOperation, { kind: "reminder.created" }>;
type ChipStatus = "pending" | "fired" | "cancelled";

/** A chip for each reminder this reply set. Rejected reminders get a line in the reply text instead of a chip. */
export function ReminderChips({ operations }: { operations: ClientOperation[] }) {
  const shown = operations.filter((op): op is Shown => op.kind === "reminder.created");
  if (shown.length === 0) return null;
  return (
    <div className={styles.chips}>
      {shown.map((op) => (
        <Chip key={op.reminderId} op={op} />
      ))}
    </div>
  );
}

function Chip({ op }: { op: Shown }) {
  // A reply that was just generated carries no status yet; it is pending until the conversation is loaded again or the user acts.
  const [status, setStatus] = useState<ChipStatus>(op.status === "fired" || op.status === "cancelled" ? op.status : op.status === "missing" ? "cancelled" : "pending");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  async function cancel() {
    setBusy(true);
    setFailed(null);
    try {
      await api.cancelReminder(op.reminderId);
      setStatus("cancelled");
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 409) {
        // It is no longer pending: it fired (or was cancelled elsewhere) since this chip was drawn. Ask which.
        const { recent } = await api.listReminders().catch(() => ({ recent: [] }));
        setStatus(recent.find((r) => r.id === op.reminderId)?.status === "cancelled" ? "cancelled" : "fired");
      } else {
        setFailed(e instanceof Error ? e.message : "Could not cancel that.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (status !== "pending") {
    const cancelled = status === "cancelled";
    return (
      <div className={`${styles.chip} ${styles.gone}`}>
        {cancelled ? <IconX size={16} className={styles.icon} /> : <IconCheck size={16} className={styles.icon} />}
        <span className={styles.label}>{cancelled ? "Cancelled" : "Done"}</span>
      </div>
    );
  }
  return (
    <div className={styles.chip}>
      <IconBell size={16} className={styles.icon} />
      <span className={styles.label}>
        Reminder set: {op.text} · {formatReminderDue(new Date(op.dueAt), op.timezone, new Date())}
      </span>
      <button type="button" className={styles.action} onClick={cancel} disabled={busy}>
        Cancel
      </button>
      {failed && <span className={styles.failed}>{failed}</span>}
    </div>
  );
}
