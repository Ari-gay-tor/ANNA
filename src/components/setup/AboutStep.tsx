"use client";

import { useState, type FormEvent } from "react";
import {
  ANSWER_STYLES,
  ANSWER_STYLE_LABELS,
  SETUP_LIMITS,
  TROUBLE_CHIPS,
  type AnswerStyle,
  type SetupAnswers,
  type TroubleId,
} from "@/core/domain/setup";
import styles from "./SetupFlow.module.css";

interface Props {
  /** The earlier answers when setup is run again, otherwise empty. */
  initial: SetupAnswers;
  busy: boolean;
  onSave: (answers: SetupAnswers) => void;
  /** "Skip this": go on without saving anything. */
  onSkipStep: () => void;
}

/** Four optional questions. The server validates and trims; the limits here only stop typing early. */
export function AboutStep({ initial, busy, onSave, onSkipStep }: Props) {
  const [name, setName] = useState(initial.name);
  const [answerStyle, setAnswerStyle] = useState<AnswerStyle>(initial.answerStyle);
  const [workingOn, setWorkingOn] = useState(initial.workingOn);
  const [troubles, setTroubles] = useState<TroubleId[]>(initial.troubles);
  const [troubleOther, setTroubleOther] = useState(initial.troubleOther);

  function toggle(id: TroubleId) {
    setTroubles((current) => (current.includes(id) ? current.filter((t) => t !== id) : [...current, id]));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    onSave({ name, answerStyle, workingOn, troubles, troubleOther });
  }

  return (
    <>
      <h1 className={`${styles.title} ${styles.markless}`} tabIndex={-1}>
        A few things about you
      </h1>
      <p className={styles.lead}>Optional. ANNA saves these as memories you can see and change on the Memory page.</p>

      <form className={styles.form} onSubmit={submit}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="setup-name">
            What should I call you?
          </label>
          <input
            id="setup-name"
            className={styles.input}
            type="text"
            value={name}
            maxLength={SETUP_LIMITS.name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            data-1p-ignore
          />
        </div>

        <fieldset className={styles.group}>
          <legend className={styles.label}>How do you like answers?</legend>
          <div className={styles.options}>
            {ANSWER_STYLES.map((value) => (
              <label key={value} className={styles.option}>
                <input type="radio" name="answer-style" value={value} checked={answerStyle === value} onChange={() => setAnswerStyle(value)} />
                {ANSWER_STYLE_LABELS[value]}
              </label>
            ))}
          </div>
        </fieldset>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="setup-working-on">
            What are you working on right now?
          </label>
          <input
            id="setup-working-on"
            className={styles.input}
            type="text"
            value={workingOn}
            maxLength={SETUP_LIMITS.workingOn}
            placeholder="finishing my thesis, job hunting"
            onChange={(e) => setWorkingOn(e.target.value)}
            autoComplete="off"
            data-1p-ignore
          />
        </div>

        <fieldset className={styles.group}>
          <legend className={styles.label}>What tends to trip you up?</legend>
          <div className={styles.chips}>
            {TROUBLE_CHIPS.map((chip) => (
              <label key={chip.id} className={styles.chip}>
                <input type="checkbox" checked={troubles.includes(chip.id)} onChange={() => toggle(chip.id)} />
                {chip.label}
              </label>
            ))}
          </div>
          <label className="sr-only" htmlFor="setup-trouble-other">
            Something else
          </label>
          <input
            id="setup-trouble-other"
            className={styles.input}
            type="text"
            value={troubleOther}
            maxLength={SETUP_LIMITS.troubleOther}
            placeholder="Something else (optional)"
            onChange={(e) => setTroubleOther(e.target.value)}
            autoComplete="off"
            data-1p-ignore
          />
        </fieldset>

        <div className={styles.formActions}>
          <button type="button" className={styles.skip} onClick={onSkipStep} disabled={busy}>
            Skip this
          </button>
          <button type="submit" className={`btn btn-primary ${styles.primary}`} disabled={busy}>
            {busy ? "Saving…" : "Save and continue"}
          </button>
        </div>
      </form>
    </>
  );
}
