import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { IconSend } from "./icons";
import styles from "./Composer.module.css";

const MAX_LINES = 6;

interface Props {
  /** A reply is in flight: typing is still allowed, sending is not. */
  busy: boolean;
  /** Focus the input whenever this changes (and once on mount). */
  focusKey: number;
  /** Resolves true if the message was accepted, so the input can stay cleared. */
  onSend: (text: string) => Promise<boolean>;
}

export function Composer({ busy, focusKey, onSend }: Props) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [focusKey]);

  // Grow with the text, up to about six lines; scroll after that.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const style = window.getComputedStyle(el);
    const line = parseFloat(style.lineHeight) || 24;
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const max = line * MAX_LINES + padding;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [text]);

  async function submit() {
    const value = text.trim();
    if (!value || busy) return;
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
      className={styles.wrap}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className={styles.box}>
        <textarea
          ref={inputRef}
          className={styles.input}
          value={text}
          rows={1}
          placeholder="Message ANNA"
          aria-label="Message"
          aria-describedby="composer-help"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="submit" className={styles.send} aria-label="Send message" disabled={busy || !text.trim()}>
          <IconSend size={18} />
        </button>
      </div>
      <p id="composer-help" className={styles.help}>
        Enter to send, Shift+Enter for a new line
      </p>
    </form>
  );
}
