import { useEffect, useState, type ReactNode } from "react";
import { AnnaMark } from "./AnnaMark";
import { api } from "./api";
import { greetingFor } from "./greeting";
import styles from "./StartScreen.module.css";

export const STARTERS = ["I'm stuck on something", "I have too much to do", "Help me decide something"] as const;

interface Props {
  disabled: boolean;
  /** A starter was tapped: it is sent straight away as a normal message. */
  onStarter: (text: string) => void;
  /** Shown under the starters (the error card, if a send failed). */
  footer?: ReactNode;
}

/** The empty conversation: ANNA's mark, a greeting for the time of day (with the name from setup, if given), and three ways to begin. */
export function StartScreen({ disabled, onStarter, footer }: Props) {
  // The clock is the browser's, so it is read after mount (not during the server render).
  // The name comes from the saved setup answers; if it cannot be read the greeting is simply without it.
  const [greeting, setGreeting] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const base = greetingFor(new Date());
    api
      .onboarding()
      .then((status) => status.answers?.name || null)
      .catch(() => null)
      .then((name) => {
        if (!cancelled) setGreeting(name ? `${base}, ${name}` : base);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={styles.scroll}>
      <div className={styles.start}>
        <AnnaMark size={52} />
        <h2 className={styles.greeting} aria-live="off">
          {greeting ?? " "}
        </h2>
        <p className={styles.prompt}>What&apos;s on your mind?</p>
        <div className={styles.starters}>
          {STARTERS.map((text) => (
            <button key={text} type="button" className={styles.starter} disabled={disabled} onClick={() => onStarter(text)}>
              {text}
            </button>
          ))}
        </div>
        {footer}
      </div>
    </div>
  );
}
