"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./TopNav.module.css";

const OTHER_PAGES = [
  { href: "/memory", label: "Memory" },
  { href: "/reminders", label: "Reminders" },
];

export function TopNav() {
  const pathname = usePathname();
  const onOther = OTHER_PAGES.some((p) => pathname.startsWith(p.href));
  const links = [{ href: "/", label: "Chat", active: !onOther }, ...OTHER_PAGES.map((p) => ({ ...p, active: pathname.startsWith(p.href) }))];
  return (
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
  );
}
