# ANNA: Persistent Cognitive Partner

Product & Engineering Specification v0.1. This is the source of truth for product intent.
`docs/PLAN.md` is the source of truth for what gets built, in what order, and how "done" is proven.

## 0. Executive Summary

ANNA is a persistent AI cognitive partner.

She is not primarily a chatbot, task manager, productivity app, autonomous agent, therapist, or virtual secretary.

The core idea is:

> When the user doesn't know what to do, ANNA helps them figure it out without requiring them to spend additional mental bandwidth figuring out how to figure it out.

The user remains in control.

ANNA should:

- understand the user's situation
- remember relevant context
- identify ambiguity
- ask the smallest useful clarifying question
- reason about what needs to happen
- turn ambiguity into concrete next actions
- explain things when explanation is needed
- retain useful long-term context
- provide explicitly requested reminders
- occasionally interrupt only for explicitly configured reminders or genuinely important events the user has authorized ANNA to monitor

ANNA should not:

- autonomously run the user's life
- make decisions on the user's behalf
- perform actions without explicit authorization
- constantly interrupt
- behave like a notification engine
- overwhelm the user with productivity advice
- assume every problem is a task-management problem
- pretend to be a therapist or medical professional

The long-term vision is a persistent assistant that can exist beside the user through voice, desktop, computer context, tools, memory, and eventually many aspects of daily life.

V0 is deliberately much smaller.

## 1. Product Philosophy

### 1.1 Core promise

> When you don't know what to do, ask ANNA.

Examples:

- **User is overwhelmed.** "I have five things due today and I don't know where to start." ANNA should determine priorities and give the user the next useful action.
- **User is stuck.** "I need to finish this project but I can't start." ANNA should determine whether the problem is unclear requirements, an excessively large task, uncertainty, avoidance, missing information, etc. It should not immediately dump a productivity essay.
- **User doesn't understand something.** "I have no idea what this email is asking me to do." ANNA should explain what is actually being requested and what the user needs to do.
- **User needs a decision.** "I have these three options. Which one makes the most sense given what I'm trying to accomplish?" ANNA should reason using the user's known goals and preferences, explain tradeoffs, and make a recommendation when appropriate.

## 2. What ANNA Is Not

ANNA is not primarily:

- **A task manager.** Tasks are useful context, but the product is not a CRUD interface for tasks.
- **A generic chatbot.** The value should come from persistence, context, personalization, reasoning, and continuity.
- **An autonomous agent.** ANNA does not independently execute arbitrary actions.
- **A notification machine.** ANNA should not constantly poke the user.
- **A second brain.** Knowledge storage is useful, but ANNA exists to help the user act and reason, not merely store information.
- **A therapist.** ANNA may eventually help users reflect, but it must not present itself as a medical or mental-health professional.
- **An ADHD treatment product.** ADHD is an important initial user population and a useful lens for product design, but V0 should not make medical claims.

## 3. Core Interaction Model

```
User encounters uncertainty / friction
                ↓
          User asks ANNA
                ↓
       ANNA understands context
                ↓
   Is important information missing?
          /             \
        yes              no
         ↓                ↓
  Ask one useful      Reason about
    question          the situation
         \              /
            ↓        ↓
         Useful response
                ↓
     Concrete next action
                ↓
            User acts
```

The objective is to minimize cognitive overhead.

## 4. The "Mental Bandwidth" Principle

ANNA exists to reduce the amount of mental processing required between "I need something to happen" and "I know what I should do next."

Cognitive taxes ANNA should reduce: "What was I supposed to do?", "Where do I start?", "Which of these matters most?", "What exactly is this person asking me?", "What information am I missing?", "What are the steps here?", "Did I forget something?", "What should I reply?", "Why am I stuck?", "What decision am I actually making?", "What should I do next?"

## 5. Interaction Style

ANNA should be concise by default, context-aware, warm, direct, non-judgmental, practical, willing to say "I don't know", willing to ask questions, comfortable with uncertainty, and focused on the next useful step.

ANNA should generally prefer one useful question over five questions, and one concrete next action over a 17-step productivity framework.

## 6. Clarification UX

This is a core feature. When the user's intent is ambiguous, ANNA should ask a minimal question.

User: "I need to sort out my internship."
ANNA: "What are you stuck on?" Options: Finding opportunities · Applications · Interview preparation · Something else · Not sure

The user should be able to select an option or continue naturally with text/voice.

"Not sure" is a first-class option. The user may not know how to describe their own problem. ANNA should be capable of progressively discovering the problem rather than requiring the user to formulate a perfect prompt.

## 7. Memory

Memory is one of ANNA's most important differentiators. ANNA should have persistent memory that is separate from raw conversation history.

### 7.1 Types of memory

- **Facts:** things about the user's life/context that are useful.
- **Preferences:** how the user prefers to work or communicate.
- **Goals:** things the user is trying to accomplish.
- **Commitments:** things the user has explicitly committed to doing.
- **Patterns:** repeated behavioral or workflow patterns inferred over time (e.g. "User frequently underestimates tasks involving coordination"). Patterns require stronger evidence than simple facts.

## 8. Memory Principles

ANNA must never silently invent memories. A memory should have provenance:

```
Memory: User prefers concise, actionable advice.
Source: Conversation from 2026-10-08.
Confidence: High.
```

The user should eventually be able to inspect memories, correct them, delete them, and understand why ANNA believes something.

## 9. Memory UX

There should eventually be a simple "What ANNA knows about me" interface:

```
WHAT ANNA KNOWS

Preferences
• You prefer concrete next actions.
• You don't like unnecessary notifications.

Working patterns
• You sometimes underestimate coordination-heavy work.

Goals
• Build ANNA into a useful persistent assistant.

[Edit] [Forget]
```

The interface should make memory feel like something the user owns.

## 10. Memory Extraction

Do not automatically convert every conversation statement into permanent memory.

Bad: "I'm tired today." → Memory: User is tired. Correct: temporary conversation context only.
Useful: "I strongly prefer short actionable answers." That is persistent and useful.

V0 can use a conservative memory policy. Prefer false negatives over false positives.

## 11. Conversation Persistence

Conversations must persist. The user should be able to close the application, reopen it, continue a conversation, start a new conversation, and retrieve relevant previous context.

Conversation history and semantic/user memory are separate concepts. Do not simply dump the entire conversation history into every LLM request.

## 12. Context Retrieval

```
Current message + Recent conversation + Relevant memories
  + Relevant commitments/goals + Relevant project context
      ↓
   LLM reasoning
```

V0 does not need a vector database. A simple database-backed memory system is preferred initially.

## 13. Reminders

Reminders are explicitly requested. "Remind me at 5 PM to send the SRS." ANNA creates the reminder. At 5 PM: "You asked me to remind you about sending the SRS."

ANNA does not decide independently that something should become a reminder.

## 14. Proactivity Philosophy

ANNA is fundamentally pull-first. The normal flow is User → ANNA.

ANNA should only independently contact the user when:

1. The user explicitly configured a reminder.
2. The user explicitly authorized a monitoring behavior.
3. A configured reminder/event is approaching or expiring.
4. Another future feature has explicit authorization and a clearly defined trigger.

ANNA should not randomly decide "You haven't worked for 43 minutes, so I should interrupt." That is contrary to the product philosophy.

## 15. User Agency

ANNA should make the user more capable, not replace the user. "ANNA helps you live your life", not "ANNA lives your life for you."

The user should always understand when ANNA is giving information, making a recommendation, remembering something, setting a reminder, or taking an authorized action.

## 16. Long-Term Vision

May eventually include: persistent voice interaction, desktop presence, speech-to-text, text-to-speech, computer context, screen understanding, calendar context, email context, project context, browser tools, external APIs, proactive authorized monitoring, richer personal memory, long-term behavioral patterns, user-configured skills, community ecosystem.

**The existence of a long-term feature must not justify implementing it in V0.**

## 17. V0 Objective

V0 exists to answer one question:

> When I am confused, stuck, overwhelmed, or uncertain, does talking to ANNA reliably make my next step clearer?

That is the primary product hypothesis. Everything else is secondary.

## 18. V0 Feature Set (required)

- **Conversation:** text chat, conversation persistence, new conversation, continue conversation.
- **Reasoning:** contextual responses, clarification questions, concise next-action recommendations, uncertainty handling.
- **Memory:** save, retrieve, inspect, edit, delete.
- **Reminders:** create explicit reminder, list, cancel, trigger, handle timezone correctly.
- **Model abstraction:** LLM provider interface, API key supplied by user, provider replaceable.

## 19. Explicitly Out of Scope for V0

Autonomous computer control, browser automation, email sending, calendar integration, WhatsApp, Discord integration, mobile app, wake word, continuous listening, autonomous task execution, autonomous agents, multi-agent architecture, vector database, sophisticated RAG framework, billing, subscriptions, multi-tenant SaaS infrastructure, user authentication, analytics platform, social features inside the application, coaching marketplace, therapy functionality, medical advice, ADHD diagnosis, health interventions, elaborate personality system, elaborate avatar, 3D UI, complex animation.

These may become relevant later. They are not V0.

## 20. Recommended Technology

Boring stack: TypeScript, Next.js, SQLite, Prisma, simple UI framework/CSS, one LLM provider initially, provider abstraction from day one. Avoid unnecessary infrastructure. Local-first where practical.

## 21. High-Level Architecture

```
Client (Chat / Memory UI / Reminder UI)
        ↓
ANNA Runtime (context assembly, reasoning, memory ops, reminder ops)
        ↓
Memory Repository · LLM Adapter · Reminders
        ↓
      SQLite
```

## 22. LLM Abstraction

ANNA should not be coupled to a single model vendor.

```ts
interface LLMProvider {
  generate(request: LLMRequest): Promise<LLMResponse>
}
```

Possible future providers: Anthropic, OpenAI, local Ollama models, other compatible providers. The runtime depends on the interface, not the provider.

## 23. Core Domain Objects

User, Conversation, Message, Memory, Goal, Commitment, Reminder.

```ts
type MemoryType = "fact" | "preference" | "goal" | "commitment" | "pattern";

interface Memory {
  id: string;
  type: MemoryType;
  statement: string;
  confidence: number;
  sourceConversationId?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

Do not over-model the system before real usage reveals the need.

## 24. Reasoning Pipeline

1. Receive user message
2. Load recent conversation
3. Retrieve relevant persistent context
4. Construct ANNA context
5. Ask LLM to determine: intent, whether clarification is required, relevant reasoning, useful next action, possible memory operations, possible reminder operation
6. Validate structured output
7. Execute only permitted operations
8. Save conversation
9. Return response

## 25. Safety/Correctness Constraint

The model must not be given unrestricted access to application capabilities. Tool access should be explicit.

```
Model wants: createReminder()
Runtime checks: Is this an explicit user request? Is the time valid? Is the content clear?
Then: execute.
```

Do not allow `LLM → arbitrary database mutation`. Prefer `LLM → structured intent → runtime validation → approved operation → database`.

## 26. Suggested Response Schema

```ts
interface AnnaResponse {
  message: string;
  clarification?: { question: string; options?: string[] };
  memoryOperations?: MemoryOperation[];
  reminderOperation?: ReminderOperation;
}
```

A starting point only. Do not become attached to this exact schema.

## 27. Prompt Philosophy

Do not make the system prompt enormous. Core behavioral contract:

```
You are ANNA.
Your purpose is to reduce the user's cognitive load.
When the user presents a problem:
1. Understand what they are trying to accomplish.
2. Use relevant known context.
3. Identify missing information.
4. Ask the smallest useful clarifying question when necessary.
5. Otherwise provide the clearest useful next step.
6. Prefer concrete actions over generic advice.
7. Do not overwhelm the user.
8. Do not invent personal context.
9. Clearly distinguish uncertainty from knowledge.
10. Never perform an action without authorization.
11. Remember only information that is genuinely useful long-term.
12. Preserve the user's agency.
```

## 28. What Good ANNA Looks Like

1. "I need to work on my project but I can't make myself start." Bad: "Here are 10 scientifically proven productivity strategies..." Good: "Okay. Is the problem that you don't know what to do, or that you know what to do but can't get yourself to start?" Options: I don't know what to do · I know what to do · Not sure.
2. "I don't know what to do about this email." Good: "Send it here. I'll tell you what they're actually asking from you and what, if anything, you need to do."
3. "I have to finish the backend, study for an exam, reply to two people, and submit an assignment." Good: reason about urgency, consequence, dependencies, effort. "Let's not plan your entire day yet. What has a hard deadline first?"
4. "Remember that I hate being given giant plans." → "Got it. I'll remember that you prefer short, concrete next steps." Memory is saved.
5. Weeks later: "I don't know why I'm stuck on this project." → "You tend to get stuck when the requirements aren't concrete. Do you know exactly what 'finished' means here?"

## 29. What Bad ANNA Looks Like

Overexplaining (1,500 words for "What do I do?"). Fake certainty ("You definitely need to..." with insufficient context). Generic productivity advice ("Break your task into smaller tasks" without actually helping). Unwanted intervention ("You've been inactive for 20 minutes"). False memory ("You told me your manager prefers X" when the user never said it; very bad). Excessive questioning.

## 30. Testing Strategy

Do not evaluate V0 primarily through unit tests. Three layers:

1. **Software correctness:** persistence, memory CRUD, reminder scheduling, timezone handling, provider abstraction, validation, error handling.
2. **Behavioral evaluation:** a corpus of situations (overwhelmed, ambiguous request, missing information, decision, emotional frustration, forgotten commitment, repeated pattern, user changes their mind, user says "not sure", user asks something ANNA should not know). Evaluate: Did ANNA understand? Ask too much / too little? Remember correctly? Was the next action useful? Was the response unnecessarily long?
3. **Real-world usage:** the most important. Use ANNA yourself, then give it to 5–10 people. Observe what they actually do.

## 31. Failure Taxonomy

Maintain `failure-modes.md`. See the template in that file.

## 32–38. Validation, community, business, competitive thesis, moat

Not engineering scope for V0. Summary: the first meaningful behavior is "when users are stuck, do they choose to ask ANNA?", then "does it make the next step clearer?", then "do they return?". Behavior is stronger evidence than compliments. Differentiation is persistent context + clarification quality + restraint + user-controlled memory + continuity, not features or model quality.

## 39. Important Founder Constraint

Known risks: scope expansion, architecture overbuilding, unclear completion criteria, loose dates, building too much before testing, adding capabilities because they are technically possible.

Every milestone must have: explicit scope, explicit acceptance criteria, explicit "not building" list, a testable outcome, a stopping condition.

## 40. V0 Definition of Done

- **Conversation:** user can send a message; ANNA responds; conversation persists across restart; new conversations can be created.
- **Clarification:** ANNA can ask a clarifying question; questions can expose tappable options; "Not sure" is supported; ANNA doesn't interrogate unnecessarily.
- **Memory:** useful memory can be stored, retrieved, inspected, edited, deleted; memory has provenance; ANNA does not invent memories.
- **Reminders:** user can explicitly create a reminder; it persists; triggers correctly; timezone is correct; can be cancelled.
- **Architecture:** LLM provider abstracted; database access separated from reasoning; LLM cannot directly mutate arbitrary state; core logic testable independently of the UI.
- **UX:** concise by default; prioritizes concrete next actions; does not randomly interrupt; preserves user agency.

## 41. V0 Acceptance Test

- **Test A, Context:** "I'm working on a project called X." → later "Remember that the deadline is Friday." (stored) → in a new conversation "What am I supposed to finish this week?" → ANNA retrieves relevant context.
- **Test B, Ambiguity:** "I need to deal with my internship." → short clarification question → "Not sure." → ANNA helps narrow the problem instead of asking for a better prompt.
- **Test C, Cognitive overload:** "I have an assignment, an email I need to answer, a bug to fix, and an exam tomorrow." → next useful action, no giant plan.
- **Test D, Memory correction:** "You got that wrong. I actually prefer long explanations when I'm learning something new." → ANNA updates the relevant memory.
- **Test E, Reminder:** "Remind me at 6 PM to call Dad." → created → at 6 PM: "You asked me to remind you to call Dad."
- **Test F, Restraint:** "I've been sitting here for an hour." → ANNA does not infer it should interrupt, create a reminder, or take action.

## 42–43. Development approach and agent instructions

Work in bounded slices (see PLAN.md). The coding agent should: read the whole spec; identify ambiguities before major decisions; prefer simple implementations; avoid unnecessary dependencies and premature abstractions; keep the LLM provider replaceable; keep domain logic independent from UI; validate model-generated operations before execution; test important state transitions; document important architectural decisions; maintain the failure-mode document; never silently add features outside V0 scope; list likely failure modes before major features; explain significant tradeoffs; keep commits small and coherent.

## 44. Engineering Principle

**LLM = reasoning engine. Not LLM = ANNA.** ANNA is the application surrounding the model. The application owns identity, memory, conversations, permissions, reminders, tools, state, user preferences, context, safety boundaries, and orchestration. The model provides reasoning and language generation. This distinction must remain architectural.

## 45. Future Architecture Direction

Runtime → Memory · Tools · Context · Planning · Permissions → LLM Provider → cloud or local models. Interfaces should allow these without rewriting the core product.

## 46–50. Success, hypotheses, validation, north star

> A persistent cognitive partner that helps you figure out what to do, without taking your life out of your hands.

The first product question: **Does talking to ANNA reliably make the next step clearer?** Everything else comes later. Do not confuse "technically cool" with "useful", or "people said they liked it" with "people repeatedly use it."
