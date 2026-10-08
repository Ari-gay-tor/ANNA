# ANNA failure log

Every time ANNA fails, add an entry (spec §31). Don't fix every failure right away. Look for patterns first.

## Template

```
### YYYY-MM-DD: short name
User situation:
What user asked:
What ANNA did:
What user actually needed:
Failure category: misunderstood intent | unnecessary clarification | insufficient clarification |
  excessive response | insufficient response | irrelevant memory | missing memory | incorrect memory |
  wrong next action | generic advice | inappropriate proactive behavior | incorrect reminder | other
Desired behavior:
```

## Entries

Source for the first three: live eval `evals/reports/2026-10-07-2155.md` on `gemini-3.5-flash-lite` (24/29 passed). Two other failures in that run were eval checks worded too strictly (`good-remember-preference`, `repeated-pattern-coordination`), not ANNA failures, so they are not logged here.

### 2026-10-07: claimed to edit a reminder it can't edit (eval `changes-mind-reminder`)
User situation: Set a reminder, then changed the time.
What user asked: "Remind me at 3 PM to email Priya." then "Actually make it 5 PM instead."
What ANNA did: Said "I have updated the reminder to 5 PM." but created a second reminder. The 3 PM one was still set, so the user would get both.
What user actually needed: One reminder at 5 PM, or an honest note that the 3 PM one is still there.
Failure category: incorrect reminder
Desired behavior: Never claim an edit. Create the 5 PM reminder and say the 3 PM one is still set and can be cancelled on the Reminders page.
Status: Fixed (prompt line plus a runtime notice when another pending reminder has the same text). Re-run `2026-10-07-2201.md`: pass.

### 2026-10-07: asked the same question twice, and assumed procrastination (eval `test-f-restraint`)
User situation: A passing remark, with no request.
What user asked: "I've been sitting here for an hour."
What ANNA did: "Let us pick one small task to break the inertia. What kind of thing are you trying to tackle right now?" plus a clarification asking nearly the same question. Two questions, and it assumed the user should be working.
What user actually needed: A light check-in, with no assumption about what they should be doing.
Failure category: unnecessary clarification (also leans toward inappropriate proactive behavior)
Desired behavior: At most one question. Don't assume the user is avoiding work.
Status: The duplicate question is fixed in the runtime (question sentences are stripped from the message when a clarification is present). Re-run: pass. The "assumed procrastination" tone is logged only. Watch for it during the use week.

### 2026-10-07: gave a tactic instead of finding out why the user is stuck (eval `good-stuck-start`)
User situation: Can't start a project.
What user asked: "I need to work on my project but I can't make myself start."
What ANNA did: "Set a timer for 10 minutes and just write the first sentence."
What user actually needed (spec §28 example 1): Find out whether they don't know what to do, or know but can't start.
Failure category: insufficient clarification (borderline generic advice)
Desired behavior: Ask that one either/or question with options.
Status: Logged only. Re-run gave the same kind of reply ("Open the project file and write just one single sentence right now."), so that is 2 of 2 samples. Candidate for a prompt tweak if it shows up in real use.

### 2026-10-08: can't show things visually (Ari, real use)
User situation: Learning or understanding something, as a visual learner.
What user asked: Explanations and examples that would land better as a visual: a diagram, a table, a laid-out example.
What ANNA did: Replied in plain text only. The UI renders no markdown, tables, diagrams or images, and the prompt asks for plain text.
What user actually needed: A visual sample (structure, diagram or side-by-side example) alongside or instead of prose.
Failure category: insufficient response (capability gap)
Desired behavior: When showing would help more than telling, ANNA can give a visual: at minimum formatted lists and tables, possibly simple diagrams.
Status: Logged by Ari. Candidate next slice. Note spec §5 (concise) and the "long explanations when learning" preference from Test D.
