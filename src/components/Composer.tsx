import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import styles from "./Composer.module.css";

interface Props {
  disabled: boolean;
  /** Resolves true if the message was accepted, so the input can stay cleared. */
  onSend: (text: string) => Promise<boolean>;
}

export function Composer({ disabled, onSend }: Props) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled]);

  async function submit() {
    const value = text.trim();
    if (!value || disabled) return;
    setText("");
    const accepted = await onSend(value);
    if (!accepted) setText((current) => current || value); // put it back so nothing is lost
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <form
      className={styles.composer}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <textarea
        ref={inputRef}
        className={styles.input}
        value={text}
        rows={2}
        placeholder="Message ANNA (Enter to send, Shift+Enter for a new line)"
        aria-label="Message"
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <button type="submit" className={styles.send} disabled={disabled || !text.trim()}>
        Send
      </button>
    </form>
  );
}
