# Lessons

What QA has caught, written up so the same defect is not made twice
(`memory/rules.md`, "QA findings become lessons"). Each authoring agent reads
its own section and "All agents" before it starts, and applies every lesson
as if it were part of its instructions.

## How a lesson is added

After a QA FAIL or WARN is fixed (with the user's yes), the orchestrator —
the `feature-rollout` skill, step 5 — adds one line per finding to the
section of the agent that owned the fix:

```
- <what to do, as an instruction>. *Caught:* <the defect QA saw> (<YYYY-MM-DD>)
```

- Write it for any brand and any feature: no company, product, person,
  inbox or account name, no slug. "A table's widest column pushed the
  result off the clip" — not "the Calls page in <brand>".
- One lesson per cause. If a lesson already says it, add the date to that
  line instead of a new one; if a lesson turns out wrong, delete it.
- If the pipeline could measure it (a limit, a missing field, a clash it
  can detect), say so to the user: the fix is a check in `pipeline/` with its
  test, after which the line here is marked *(enforced by <check>)*.
- When a lesson changes how an agent must always work, also fold it into
  that agent's instructions (`.claude/agents/`) or the doc it follows, and
  mark it *(in <file>)*.

## All agents

- Every name and identifier drawn from the account is invented and fits the
  business: one "Sales Inbox", one "Marketing Inbox", other inboxes their own
  business names, and fresh contextual names for people, tags, phone numbers,
  broadcasts, campaigns, agents and triggers. *(in memory/rules.md;
  one-to-one enforced by `checkReplace`)* (2026-11-08)

## rollout-copywriter

## rollout-visual-designer

- Avatar initials drawn as images can't be reached by `replace`; blur that
  avatar, and give text initials a `"whole": true` pair matching the
  invented name. *Caught:* real initials beside an invented name (2026-11-08)
- Wait for the real result before the still; fast-forward loading skeletons
  rather than recording them. *Caught:* a skeleton row in the still
  (2026-11-08)
- Never hide conversation history to keep a name out of frame; replace the
  name instead. *(in memory/rules.md)* (2026-11-08)

## rollout-help-writer

## rollout-web-publisher

## rollout-podcast-producer
