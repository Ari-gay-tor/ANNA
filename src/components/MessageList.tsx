import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnnaMark } from "./AnnaMark";
import { ClarificationOptions } from "./ClarificationOptions";
import { MemoryChips } from "./MemoryChips";
import { ReminderChips } from "./ReminderChips";
import type { ClientMessage } from "./types";
import styles from "./MessageList.module.css";

interface Props {
  messages: ClientMessage[];
  thinking: boolean;
  /** A clarification option was tapped. Sends its text as a user message with selectedOption. */
  onSelectOption: (text: string) => void;
  /** Rendered after the last message, inside the scrolling column (the error card). */
  footer?: ReactNode;
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function MessageList({ messages, thinking, onSelectOption, footer }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const hasFooter = Boolean(footer); // not the element itself: that is a new object every render and would re-scroll
  // Memories forgotten from a chip. Shared, so every chip pointing at the same memory flips together.
  const [forgotten, setForgotten] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, thinking, hasFooter]);

  return (
    <div className={styles.scroll}>
      <div className={styles.column} role="log" aria-label="Conversation">
        {messages.map((m, index) => {
          const time = (
            <time className={styles.time} dateTime={m.createdAt} title={new Date(m.createdAt).toLocaleString()}>
              {timeOf(m.createdAt)}
            </time>
          );
          if (m.role === "user") {
            return (
              <div key={m.id} className={`${styles.row} ${styles.user}`}>
                <div className={styles.bubble}>{m.content}</div>
                <div className={styles.meta}>
                  {m.selectedOption && <span className={styles.tag}>option</span>}
                  {time}
                </div>
              </div>
            );
          }
          return (
            <div key={m.id} className={`${styles.row} ${styles.assistant}`}>
              <div className={styles.markSlot}>
                <AnnaMark size={26} />
              </div>
              <div className={styles.body}>
                <div className={styles.text}>{m.content}</div>
                {m.operations && (
                  <MemoryChips
                    operations={m.operations}
                    forgotten={forgotten}
                    onForgotten={(id) => setForgotten((prev) => new Set(prev).add(id))}
                  />
                )}
                {m.operations && <ReminderChips operations={m.operations} />}
                {/* Buttons only on the very last message: any user message after it (typed or tapped) removes them. */}
                {m.clarification && index === messages.length - 1 && (
                  <ClarificationOptions options={m.clarification.options} disabled={thinking} onSelect={onSelectOption} />
                )}
                <div className={styles.meta}>{time}</div>
              </div>
            </div>
          );
        })}
        {thinking && (
          <div className={`${styles.row} ${styles.assistant}`} role="status" aria-label="ANNA is thinking">
            <div className={styles.markSlot}>
              <AnnaMark size={26} />
            </div>
            <div className={styles.dots} aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
        {footer}
        <div ref={endRef} />
      </div>
    </div>
  );
}
