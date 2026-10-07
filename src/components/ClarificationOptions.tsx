import styles from "./ClarificationOptions.module.css";

interface Props {
  options: string[];
  /** True while a request is in flight. */
  disabled: boolean;
  onSelect: (option: string) => void;
}

/** Pill buttons for the options ANNA offered. The parent decides when they are shown (latest message only). */
export function ClarificationOptions({ options, disabled, onSelect }: Props) {
  if (options.length === 0) return null;
  return (
    <div className={styles.options} role="group" aria-label="Answer options">
      {options.map((option) => (
        <button key={option} type="button" className={styles.option} disabled={disabled} onClick={() => onSelect(option)}>
          {option}
        </button>
      ))}
    </div>
  );
}
