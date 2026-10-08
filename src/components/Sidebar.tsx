"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AnnaMark } from "./AnnaMark";
import { ConfirmDialog } from "./ConfirmDialog";
import { groupConversations } from "./conversation-groups";
import { IconMore, IconPencil, IconPlus, IconTrash, IconX } from "./icons";
import { isMac, NEW_CHAT_HINT } from "./shortcuts";
import type { ClientConversation } from "./types";
import styles from "./Sidebar.module.css";

/** Keep in step with TITLE_MAX_LENGTH in src/core/runtime/anna.ts (the server checks it too). */
const MAX_TITLE = 60;

interface Props {
  conversations: ClientConversation[];
  selectedId: string | null;
  /** A reply is in flight: switching or starting a chat would orphan it, so those are held. */
  busy: boolean;
  /** Narrow screens: whether the drawer is showing. Ignored on wide screens. */
  open: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

interface MenuState {
  id: string;
  top: number;
  right: number;
}

export function Sidebar({ conversations, selectedId, busy, open, onClose, onSelect, onNew, onRename, onDelete }: Props) {
  const [hint, setHint] = useState<string>(NEW_CHAT_HINT.windows);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ClientConversation | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (isMac()) setHint(NEW_CHAT_HINT.mac);
  }, []);

  // The groups depend on today's date, so recompute when the list changes (a reply moves a chat to Today).
  useEffect(() => {
    setNow(new Date());
  }, [conversations]);
  const groups = useMemo(() => groupConversations(conversations, now), [conversations, now]);

  const menuConversation = menu ? conversations.find((c) => c.id === menu.id) ?? null : null;

  return (
    <>
      <div className={open ? `${styles.backdrop} ${styles.backdropOpen}` : styles.backdrop} onClick={onClose} aria-hidden="true" />
      <nav className={open ? `${styles.sidebar} ${styles.open}` : styles.sidebar} aria-label="Conversations">
        <div className={styles.header}>
          <h1 className={styles.brand}>
            <AnnaMark size={28} />
            <span>ANNA</span>
          </h1>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close conversations">
            <IconX size={18} />
          </button>
        </div>

        <button type="button" className={styles.newButton} onClick={onNew} disabled={busy}>
          <IconPlus size={16} />
          <span>New chat</span>
          <kbd className={styles.hint}>{hint}</kbd>
        </button>

        <div className={styles.scroll}>
          {groups.map((group) => (
            <section key={group.label} className={styles.group}>
              <h2 className={styles.groupLabel}>{group.label}</h2>
              <ul className={styles.list}>
                {group.items.map((c) => (
                  <Row
                    key={c.id}
                    conversation={c}
                    active={c.id === selectedId}
                    menuOpen={menu?.id === c.id}
                    renaming={renamingId === c.id}
                    busy={busy}
                    onSelect={() => onSelect(c.id)}
                    onOpenMenu={(button) => {
                      const rect = button.getBoundingClientRect();
                      setMenu({ id: c.id, top: rect.bottom + 4, right: window.innerWidth - rect.right });
                    }}
                    onCloseMenu={() => setMenu(null)}
                    onRenameSubmit={async (title) => {
                      await onRename(c.id, title);
                      setRenamingId(null);
                    }}
                    onRenameCancel={() => setRenamingId(null)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </nav>

      {menu && menuConversation && (
        <RowMenu
          position={menu}
          canDelete={!(busy && menuConversation.id === selectedId)}
          onRename={() => {
            setRenamingId(menuConversation.id);
            setMenu(null);
          }}
          onDelete={() => {
            setDeleting(menuConversation);
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
      )}

      {deleting && (
        <DeleteDialog
          conversation={deleting}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            await onDelete(deleting.id);
            setDeleting(null);
          }}
        />
      )}
    </>
  );
}

function Row(props: {
  conversation: ClientConversation;
  active: boolean;
  menuOpen: boolean;
  renaming: boolean;
  busy: boolean;
  onSelect: () => void;
  onOpenMenu: (button: HTMLButtonElement) => void;
  onCloseMenu: () => void;
  onRenameSubmit: (title: string) => Promise<void>;
  onRenameCancel: () => void;
}) {
  const { conversation, active, menuOpen, renaming, busy } = props;
  const moreRef = useRef<HTMLButtonElement>(null);
  const className = [styles.row, active ? styles.rowActive : "", menuOpen ? styles.rowMenuOpen : ""].filter(Boolean).join(" ");

  if (renaming) return <RenameRow conversation={conversation} onSubmit={props.onRenameSubmit} onCancel={props.onRenameCancel} />;

  return (
    <li className={className}>
      <button
        type="button"
        className={styles.item}
        aria-current={active ? "true" : undefined}
        onClick={props.onSelect}
        disabled={busy && !active}
        title={conversation.title}
      >
        {conversation.title}
      </button>
      <button
        ref={moreRef}
        type="button"
        className={styles.more}
        aria-label={`Options for ${conversation.title}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => (menuOpen ? props.onCloseMenu() : moreRef.current && props.onOpenMenu(moreRef.current))}
      >
        <IconMore size={18} />
      </button>
    </li>
  );
}

function RenameRow({
  conversation,
  onSubmit,
  onCancel,
}: {
  conversation: ClientConversation;
  onSubmit: (title: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(conversation.title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const settled = useRef(false); // Enter, Esc and blur can all fire for one edit; only the first counts.

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  async function save() {
    if (settled.current) return;
    const title = draft.trim();
    if (!title || title === conversation.title) {
      settled.current = true;
      onCancel();
      return;
    }
    settled.current = true;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(title);
    } catch (e) {
      settled.current = false; // let them fix it and try again
      setSaving(false);
      setError(e instanceof Error ? e.message : "Could not rename that.");
      inputRef.current?.focus();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void save();
    } else if (event.key === "Escape") {
      event.preventDefault();
      settled.current = true;
      onCancel();
    }
  }

  return (
    <li className={styles.renameRow}>
      <input
        ref={inputRef}
        className={styles.renameInput}
        value={draft}
        maxLength={MAX_TITLE}
        aria-label="Conversation name"
        aria-invalid={error ? true : undefined}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => void save()}
      />
      {error && (
        <p className={styles.renameError} role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

function RowMenu({
  position,
  canDelete,
  onRename,
  onDelete,
  onClose,
}: {
  position: MenuState;
  canDelete: boolean;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose; // the parent passes a new function each render; the listeners below must not be re-added for it

  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>("[role=menuitem]:not(:disabled)")?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      // The trigger button toggles the menu itself.
      if (menuRef.current?.contains(target) || target?.closest("[aria-haspopup=menu]")) return;
      closeRef.current();
    };
    const close = () => closeRef.current();
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not(:disabled)") ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      items[(index + 1) % items.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    } else if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") event.preventDefault();
      onClose();
      // Back to the button that opened it.
      document.querySelector<HTMLElement>("[aria-haspopup=menu][aria-expanded=true]")?.focus();
    }
  }

  return (
    <div
      ref={menuRef}
      className={styles.menu}
      role="menu"
      aria-label="Conversation options"
      style={{ top: position.top, right: position.right }}
      onKeyDown={onKeyDown}
    >
      <button type="button" role="menuitem" className={styles.menuItem} onClick={onRename}>
        <IconPencil size={16} />
        Rename
      </button>
      <button type="button" role="menuitem" className={`${styles.menuItem} ${styles.menuDanger}`} onClick={onDelete} disabled={!canDelete}>
        <IconTrash size={16} />
        Delete
      </button>
    </div>
  );
}

function DeleteDialog({
  conversation,
  onCancel,
  onConfirm,
}: {
  conversation: ClientConversation;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <ConfirmDialog
      title="Delete this chat?"
      confirmLabel="Delete"
      busy={busy}
      error={error}
      onCancel={onCancel}
      onConfirm={async () => {
        setBusy(true);
        setError(null);
        try {
          await onConfirm();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Could not delete that.");
          setBusy(false);
        }
      }}
    >
      <p>
        &ldquo;{conversation.title}&rdquo; and its messages will be removed. Anything ANNA remembered or set as a reminder from it stays.
      </p>
    </ConfirmDialog>
  );
}
