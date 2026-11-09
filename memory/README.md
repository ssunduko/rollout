# Memory

What this project has learned while making rollouts, kept in the repo so every
session (and every person) starts from it instead of relearning it. `docs/`
says how the pipeline works; `memory/` says what was decided and learned.

| File | Holds |
|---|---|
| [rules.md](rules.md) | Standing rules for every rollout, each with its reason and date. They override defaults. `CLAUDE.md` imports it, so every session loads it. |
| [lessons.md](lessons.md) | What QA has caught, one section per agent, as instructions. Every agent reads its section before it starts; the orchestrator adds to it after each fixed QA finding. |
| [features/](features/) | One folder per brand (named as its folder in `brand/`): `README.md` with the brand's and its application's own rules and facts, plus one page per feature rolled out. |

## Brands

Each brand is a folder under `features/`. Its `README.md` holds what is true
for that brand only: where its help center, website and image hosting are and
how they behave, its application's quirks, its own rules. The other `.md`
pages are its features (`<slug>.md`). Only `features/example/` is committed;
every real brand's folder is gitignored and exists only on the machines that
work on it (`rules.md`, "Nothing brand-specific in the repo").

A feature page holds what the inputs and sidecars don't:

| | |
|---|---|
| Header table | slug, target, input, brief and scenes, status, last observed |
| Where it is | how to reach the feature in the application |
| Data it needs | the state a capture needs (test inboxes, contacts, settings), and what may be changed |
| Names | which invented name stands for which kind of real one (no real personal data) |
| Quirks | what the application does that cost a re-capture |
| Status | what was built, sent and published, with dates |

The feature's spec stays `input/<slug>/feature.md` (the person's words), its
copy `library/features/<slug>/brief.json`, its scenes `library/scenes/`. A
page points at them rather than copying them.

## Reading and writing it

- **Before** a rollout: `rules.md`, `lessons.md` (your agent's section and
  "All agents"), the brand's `README.md` and the feature's page (create it
  if the feature is new, from `features/example/smart-scheduling.md`).
- **After** a QA verdict is fixed: a line in `lessons.md` per cause
  (its "How a lesson is added").
- **After** a capture, a publish or a decision: update the feature page's
  quirks and status, and the brand's `README.md` for anything true of every
  feature of that brand.
- A new standing rule from the user goes in `rules.md`, with why and the date.
- Write facts, not narratives. Date anything that can change ("as of
  2026-11-08"). Delete what turns out to be wrong.
- Never write credentials, tokens or real customers' personal data here.
  Ids and secrets go in `.env`.
