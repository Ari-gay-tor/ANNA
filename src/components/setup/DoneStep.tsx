import { AnnaMark } from "../AnnaMark";
import styles from "./SetupFlow.module.css";

interface Props {
  name: string;
  /** Some answers were saved as memories, so point to the Memory page. */
  savedSomething: boolean;
  busy: boolean;
  /** Leave setup and go here. */
  onFinish: (to: string) => void;
}

export function DoneStep({ name, savedSomething, busy, onFinish }: Props) {
  return (
    <>
      <AnnaMark size={52} />
      <h1 className={styles.title} tabIndex={-1}>
        {name ? `You're all set, ${name}.` : "You're all set."}
      </h1>
      <p className={styles.lead}>Next time you&apos;re stuck, overwhelmed or unsure, just tell me.</p>
      {savedSomething && (
        <p className={styles.doneNote}>
          I saved what you told me as memories. You can see, edit or delete them on the{" "}
          <a
            href="/memory"
            onClick={(event) => {
              event.preventDefault();
              onFinish("/memory");
            }}
          >
            Memory page
          </a>
          .
        </p>
      )}
      <button type="button" className={`btn btn-primary ${styles.primary}`} onClick={() => onFinish("/")} disabled={busy}>
        Start chatting
      </button>
    </>
  );
}
