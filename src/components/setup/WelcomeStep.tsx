import { AnnaMark } from "../AnnaMark";
import styles from "./SetupFlow.module.css";

/** What ANNA does and does not do (spec sections 0, 2, 8, 13 and 14), in her own voice. */
const POINTS = [
  "I remember things when they're useful, and you can see, edit or delete everything I know.",
  "I set reminders only when you ask.",
  "Otherwise I won't nag you or interrupt you.",
  "I'm not a therapist or a doctor.",
];

export function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <>
      <AnnaMark size={52} />
      <h1 className={styles.title} tabIndex={-1}>
        Hi, I&apos;m ANNA.
      </h1>
      <p className={styles.lead}>When you don&apos;t know what to do, ask me. I&apos;ll help you find the next step.</p>
      <ul className={styles.points}>
        {POINTS.map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ul>
      <button type="button" className={`btn btn-primary ${styles.primary}`} onClick={onNext}>
        Get started
      </button>
    </>
  );
}
