"use client";

import { useEffect, useState, type ReactNode } from "react";
import { IconMonitor, IconMoon, IconSun } from "./icons";
import { applyTheme, readTheme, type ThemeChoice } from "./theme";
import styles from "./ThemeSwitch.module.css";

const CHOICES: Array<{ value: ThemeChoice; label: string; icon: ReactNode }> = [
  { value: "system", label: "System theme", icon: <IconMonitor size={16} /> },
  { value: "light", label: "Light theme", icon: <IconSun size={16} /> },
  { value: "dark", label: "Dark theme", icon: <IconMoon size={16} /> },
];

/** A small System / Light / Dark switch. The choice is saved in localStorage. */
export function ThemeSwitch() {
  const [choice, setChoice] = useState<ThemeChoice | null>(null);

  useEffect(() => {
    setChoice(readTheme());
  }, []);

  function pick(value: ThemeChoice) {
    setChoice(value);
    applyTheme(value);
  }

  return (
    <div className={styles.switch} role="group" aria-label="Theme">
      {CHOICES.map((c) => (
        <button
          key={c.value}
          type="button"
          className={choice === c.value ? `${styles.option} ${styles.on}` : styles.option}
          aria-label={c.label}
          aria-pressed={choice === c.value}
          title={c.label}
          onClick={() => pick(c.value)}
        >
          {c.icon}
        </button>
      ))}
    </div>
  );
}
