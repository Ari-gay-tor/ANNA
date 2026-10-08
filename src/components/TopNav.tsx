"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { IconGear, IconMore } from "./icons";
import { ThemeSwitch } from "./ThemeSwitch";
import styles from "./TopNav.module.css";

const PRIMARY_PAGES = [
  { href: "/memory", label: "Memory" },
  { href: "/reminders", label: "Reminders" },
];
const FEEDBACK = { href: "/feedback", label: "Feedback" };
const SETTINGS_HREF = "/settings";

export function TopNav() {
  const pathname = usePathname();
  const onSettings = pathname.startsWith(SETTINGS_HREF);
  const onFeedback = pathname.startsWith(FEEDBACK.href);
  const onPrimary = PRIMARY_PAGES.some((p) => pathname.startsWith(p.href));
  const onChat = !(onSettings || onFeedback || onPrimary);
  const links = [
    { href: "/", label: "Chat", active: onChat, secondary: false },
    ...PRIMARY_PAGES.map((p) => ({ ...p, active: pathname.startsWith(p.href), secondary: false })),
    // Under 760px Feedback moves into the More menu (with Settings and the theme).
    { ...FEEDBACK, active: onFeedback, secondary: true },
  ];

  return (
    <header className={styles.bar}>
      <nav className={styles.nav} aria-label="Main">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={[styles.link, link.active ? styles.active : "", link.secondary ? styles.secondary : ""].filter(Boolean).join(" ")}
            aria-current={link.active ? "page" : undefined}
          >
            {link.label}
          </Link>
        ))}
      </nav>
      <div className={styles.tools}>
        <Link
          href={SETTINGS_HREF}
          className={onSettings ? `${styles.gear} ${styles.active}` : styles.gear}
          aria-label="Settings"
          aria-current={onSettings ? "page" : undefined}
          title="Settings"
        >
          <IconGear size={18} />
        </Link>
        <ThemeSwitch />
      </div>
      <MoreMenu pathname={pathname} highlighted={onFeedback || onSettings} onFeedback={onFeedback} onSettings={onSettings} />
    </header>
  );
}

/** Phone width only: Feedback, Settings and the theme switch behind one button. Esc, a click elsewhere, or leaving it with Tab closes it. */
function MoreMenu(props: { pathname: string; highlighted: boolean; onFeedback: boolean; onSettings: boolean }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Going to a page closes it.
  useEffect(() => setOpen(false), [props.pathname]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div
      className={styles.more}
      ref={wrapRef}
      onBlur={(event) => {
        // Tabbing to something outside the button and panel closes it. (No target means a click on the panel's own padding, or the
        // window losing focus: the click-outside listener handles real outside clicks.)
        const next = event.relatedTarget as Node | null;
        if (open && next && !wrapRef.current?.contains(next)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className={props.highlighted ? `${styles.moreButton} ${styles.active}` : styles.moreButton}
        aria-expanded={open}
        aria-controls="more-menu"
        aria-label="More: Feedback, Settings and theme"
        onClick={() => setOpen((o) => !o)}
      >
        <IconMore size={18} />
        <span aria-hidden="true">More</span>
      </button>
      {open && (
        <div id="more-menu" className={styles.panel} role="group" aria-label="More">
          <Link
            href={FEEDBACK.href}
            className={props.onFeedback ? `${styles.panelLink} ${styles.active}` : styles.panelLink}
            aria-current={props.onFeedback ? "page" : undefined}
          >
            Feedback
          </Link>
          <Link
            href={SETTINGS_HREF}
            className={props.onSettings ? `${styles.panelLink} ${styles.active}` : styles.panelLink}
            aria-current={props.onSettings ? "page" : undefined}
          >
            Settings
          </Link>
          <div className={styles.panelTheme}>
            <span className={styles.panelLabel}>Theme</span>
            <ThemeSwitch />
          </div>
        </div>
      )}
    </div>
  );
}
