"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./TopNav.module.css";

export function TopNav() {
  const onMemory = usePathname().startsWith("/memory");
  return (
    <nav className={styles.nav} aria-label="Main">
      <Link href="/" className={onMemory ? styles.link : `${styles.link} ${styles.active}`} aria-current={onMemory ? undefined : "page"}>
        Chat
      </Link>
      <Link href="/memory" className={onMemory ? `${styles.link} ${styles.active}` : styles.link} aria-current={onMemory ? "page" : undefined}>
        Memory
      </Link>
    </nav>
  );
}
