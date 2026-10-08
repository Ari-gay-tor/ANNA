import styles from "./AnnaMark.module.css";

/** ANNA's small round mark: the accent circle with an "A", matching the app icon. Decorative. */
export function AnnaMark({ size = 24 }: { size?: number }) {
  return (
    <span className={styles.mark} style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }} aria-hidden="true">
      A
    </span>
  );
}
