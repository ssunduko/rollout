# Tests

```
npm test                    # everything
npm run test:unit           # the modules, in seconds; no network (a few use Chrome and ffmpeg)
npm run test:integration    # the CLI, the demo app, the podcast and the whole pipeline
```

Node's own test runner (`node:test`), no other dependency. GitHub Actions runs
both on every pull request (`.github/workflows/test.yml`): unit tests on Linux
and Windows with ffmpeg installed, integration tests on Linux with Chrome and
ffmpeg.

## What keeps them safe to run

- **Never the real `.env`.** Every test file imports `setup.mjs` first: it
  clears the keys `.env.example` lists from the environment and sets
  `ENV_FILE=.env.example`, so the pipeline reads the example's settings — the
  example brand, the demo app, every secret empty.
- **Never the real library.** `setup.mjs` copies the committed example feature
  (`input/smart-scheduling`, its brief, help and scenes) into a temporary
  folder and points `INPUT_DIR`, `LIBRARY_DIR` and `OUTPUT_DIR` there; it is
  removed when the test file's process exits. (`target.test.mjs` writes
  short-lived `targets/zz-test-*.json` files, removed after it.)
- **Never a real service.** Unit tests replace `fetch` (`mockFetch` in
  `helpers.mjs`); integration tests run fake help-center and studio servers
  on a local port (`fakes.mjs`) and point `HELP_CENTER_API_URL` /
  `ELEVENLABS_API_URL` at them. Captures sign in to the demo app
  (`demo-app/server.mjs`) on a free port.

## Layout

| Folder | What |
|---|---|
| `unit/` | one file per pipeline module and adapter: validation rules, HTML builders, the render cache, every API call's method, URL, headers and body, the S3 signature against AWS's published examples |
| `integration/cli.test.mjs` | the CLI as run: init, status, validate, brand, targets, library; every outward step refusing without `--yes`; missing keys named; `seo` auditing a served page |
| `integration/demo-app.test.mjs` | the example app: login, session, pages, the blur and hide markers |
| `integration/pipeline.test.mjs` | `build` on the example (captures from the demo app, kit scenes, PDF, web page, social pack, help article), the cached rebuild, `qa`, `serve`, and `help-publish` create → update → refused after an edit in the help center |
| `integration/podcast.test.mjs` | `podcast-script` and `podcast --yes`: voiced in parts, joined by ffmpeg, the transcript, a rerun spending nothing, a changed script only with `--force` |
| `fixtures/` | sidecars the example does not have (social, site, podcast); fictional (Acme) only |

Without Chrome or ffmpeg, the tests that need them are skipped locally; in CI
(`CI` set) they fail instead. `CHROME_PATH` and `FFMPEG` point at other
installs.

## Adding tests

A test file starts with `import '../setup.mjs';`, before any pipeline import.
New pipeline code gets unit tests next to the module's others; a new command
or service gets an integration test, with a fake server in `fakes.mjs` when it
talks to one. A test that finds a bug the change does not fix is marked
`{ todo: 'why' }`, never deleted.
