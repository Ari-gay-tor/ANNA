"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconGear } from "./icons";
import { ThemeSwitch } from "./ThemeSwitch";
import styles from "./TopNav.module.css";

const OTHER_PAGES = [
  { href: "/memory", label: "Memory" },
  { href: "/reminders", label: "Reminders" },
  { href: "/feedback", label: "Feedback" },
];
const SETTINGS_HREF = "/settings";

export function TopNav() {
  const pathname = usePathname();
  const onSettings = pathname.startsWith(SETTINGS_HREF);
  const onOther = onSettings || OTHER_PAGES.some((p) => pathname.startsWith(p.href));
  const links = [{ href: "/", label: "Chat", active: !onOther }, ...OTHER_PAGES.map((p) => ({ ...p, active: pathname.startsWith(p.href) }))];
  return (
    <header className={styles.bar}>
      <nav className={styles.nav} aria-label="Main">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={link.active ? `${styles.link} ${styles.active}` : styles.link}
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
    </header>
  );
}
