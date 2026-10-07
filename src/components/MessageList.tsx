import { useEffect, useRef, useState } from "react";
import { ClarificationOptions } from "./ClarificationOptions";
import { MemoryChips } from "./MemoryChips";
import type { ClientMessage } from "./types";
import styles from "./MessageList.module.css";

interface Props {
  messages: ClientMessage[];
  thinking: boolean;
  /** True while the selected conversation is being fetched, so the empty hint does not flash. */
  loading: boolean;
  /** A clarification option was tapped. Sends its text as a user message with selectedOption. */
  onSelectOption: (text: string) => void;
}

export function MessageList({ messages, thinking, loading, onSelectOption }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  // Memories forgotten from a chip. Shared, so every chip pointing at the same memory flips together.
  const [forgotten, setForgotten] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, thinking]);

  return (
    <div className={styles.list}>
      {messages.length === 0 && !thinking && !loading && <p className={styles.empty}>Say something to start.</p>}
      {messages.map((m, index) => (
        <div key={m.id} className={m.role === "user" ? `${styles.message} ${styles.user}` : styles.message}>
          <div className={styles.author}>
            {m.role === "user" ? "You" : "ANNA"}
            {m.role === "user" && m.selectedOption && <span className={styles.tag}>option</span>}
          </div>
          <div className={styles.content}>{m.content}</div>
          {m.role === "assistant" && m.operations && (
            <MemoryChips
              operations={m.operations}
              forgotten={forgotten}
              onForgotten={(id) => setForgotten((prev) => new Set(prev).add(id))}
            />
          )}
          {/* Buttons only on the very last message: any user message after it (typed or tapped) removes them. */}
          {m.role === "assistant" && m.clarification && index === messages.length - 1 && (
            <ClarificationOptions options={m.clarification.options} disabled={thinking} onSelect={onSelectOption} />
          )}
        </div>
      ))}
      {thinking && <div className={styles.thinking}>thinking…</div>}
      <div ref={endRef} />
    </div>
  );
}
