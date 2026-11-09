# Example brand

The fictional brand every committed example uses: `brand/example/`, the
`demo-app` target (`npm run demo-app`) and the `smart-scheduling` feature.
Copy this folder's shape for a real brand (gitignored).

| | |
|---|---|
| Brand | `brand/example/` (`BRAND_DIR=brand/example`) |
| Target | `targets/demo-app.json` — logs into `DEMO_APP_URL` with `DEMO_APP_USERNAME` / `DEMO_APP_PASSWORD` |
| Help center, website, podcast | none: the example stops at the built previews |
| Features | [smart-scheduling](smart-scheduling.md) |

## Rules

Brand-only rules go here, in the form of `../../rules.md` (rule, *Why:*,
date). The example has none.

## Application

- The demo app shows a loading spinner and a banner on purpose: the target
  hides the banner and the scenes wait out the spinner.
- Contact details are blurred by the target's `blurSelectors`, to show that
  path working.
