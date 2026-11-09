# Smart Scheduling (example)

Book a meeting without leaving the text conversation: open times from the
team's calendars, picked by reply, confirmed and reminded automatically.

| | |
|---|---|
| Slug | `smart-scheduling` |
| Target | `demo-app` |
| Input | `input/smart-scheduling/feature.md` |
| Brief, scenes | `library/features/smart-scheduling/brief.json`; `library/scenes/smart-scheduling--*` (hero, suggest-times, calendars, reminders, inbox-rules, reschedule) |
| Status | example: one-pager and web page build from the committed sidecars |

## Where it is

The demo app's conversation composer (Suggest times) and its Settings
(calendars, booking rules per inbox).

## Data it needs

Nothing live: the demo app serves fixed data, so no step mutates.

## Names

Invented throughout (`../../rules.md`, "Invented names in captures").

## Quirks

- `reschedule` is a coming-soon feature, so it is a kit-drawn scene, not a
  capture (`../../rules.md`, "Visuals come from the application").
