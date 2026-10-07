import type { ClientConversation } from "./types";
import styles from "./Sidebar.module.css";

interface Props {
  conversations: ClientConversation[];
  selectedId: string | null;
  disabled: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
}

export function Sidebar({ conversations, selectedId, disabled, onSelect, onNew }: Props) {
  return (
    <nav className={styles.sidebar} aria-label="Conversations">
      <h1 className={styles.brand}>ANNA</h1>
      <button type="button" className={styles.newButton} onClick={onNew} disabled={disabled}>
        New conversation
      </button>
      <ul className={styles.list}>
        {conversations.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className={c.id === selectedId ? `${styles.item} ${styles.active}` : styles.item}
              aria-current={c.id === selectedId ? "true" : undefined}
              onClick={() => onSelect(c.id)}
              disabled={disabled}
              title={c.title}
            >
              {c.title}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
