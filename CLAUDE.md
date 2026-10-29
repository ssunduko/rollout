# Rollout

Agents author a feature's one-pager PDF, web page, social images and launch
copy from a plain-English description, or from tickets. Full docs: `README.md`. Architecture (sidecar pattern):
`docs/ARCHITECTURE.md`.

To make one, use the `feature-rollout` skill ("roll out <slug>"). It runs the
`rollout-scope` (from tickets), `rollout-copywriter`, `rollout-visual-designer` and `rollout-qa` agents
(`.claude/agents/`) around `node pipeline/rollout.mjs`.

## Ground rules

@docs/rules.md

## Where things go

- Inputs a person writes (or the scope agent, from confirmed tickets):
  `input/<slug>/feature.md`, `feature.json`, `assets/`.
- Agent-authored, kept forever: `library/features/<slug>/brief.json`,
  `social.json`, `copy.json`, `library/scenes/<id>/`. Renders are cached in `library/renders/<hash>/`;
  `library/index.json` is derived — never edit it.
- Build products, regenerable: `output/<slug>/`. Never edit by hand. The
  social pack (cover, carousel, thumbnails, email and signature images) is
  built into `output/<slug>/assets/social/` from
  `library/features/<slug>/social.json`: `docs/social.md`. The copy pack
  (email, posts, podcast brief) is built into `output/<slug>/copy/` from
  `library/features/<slug>/copy.json`: `docs/copy.md`.
- Tickets are read, never written: the scope agent's tracker settings are
  `TRACKER_*` in `.env`; what it used is `sources` in `feature.json`.
- Brand: the folder under `brand/` that `BRAND_DIR` names in `.env`
  (`brand/example/` is the generic example). No brand value in code.
- Visuals are captured from the logged-in application: `docs/capture.md`.
  Targets in `targets/` (secrets in `.env` or `*.local.json`, never
  committed); signed-in profiles in `profiles/` (gitignored). The example
  app: `npm run demo-app`.
- Every `.env` key the code reads is listed in `.env.example`; add new ones
  there in the same change.
- When the kit gains a class or icon, document it in `docs/scene-kit.md`; when
  the brief gains a field or limit, in `docs/brief.md`; when the copy pack
  does, in `docs/copy.md`.
