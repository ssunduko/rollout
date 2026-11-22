# The changelog entry

The "what's new" note for existing customers: a short entry in the
product's public changelog that says what changed and links to where to
learn more. The `rollout-changelog-writer` agent writes it; the pipeline
checks and builds it and sends it to the changelog service over its API —
as a draft, on the user's approval. Publishing it, and emailing the
changelog's subscribers, are separate approvals.

## The sidecar

`library/features/<slug>/changelog.json` (the example:
`library/features/smart-scheduling/changelog.json`):

```json
{
  "feature": "Smart Scheduling",
  "title": "Smart Scheduling: book meetings inside the conversation",
  "types": ["new"],
  "summary": "You can now book meetings without leaving the text thread. …",
  "image": { "url": "https://www.acme.example/images/smart-scheduling-hero.png", "alt": "…" },
  "video": { "url": "https://www.youtube.com/watch?v=…" },
  "sections": [
    { "title": "Offer open times in the thread", "body": "…" },
    { "title": "What's included", "bullets": ["…", "…"] }
  ],
  "cta": { "label": "See how Smart Scheduling works", "url": "https://www.acme.example/features/smart-scheduling" },
  "labelIds": [],
  "publish": { "status": "draft", "notify": false, "entryId": "…", "lastSaved": "…" }
}
```

| | Limit | Notes |
|---|---|---|
| `title` | warn over 80, at most 150 | what changed, in customers' words |
| `types` | one or more of `new`, `improved`, `fixed` | |
| `summary` | warn over 400, at most 800 | plain sentences; the pipeline formats |
| `sections` | at most 5; title 60, body 400, up to 8 bullets of 160 | each needs a body, bullets, or both |
| `image` | a public https URL, with `alt` (140) | the changelog shows it by URL; optional |
| `video` | an https URL | optional; embedded right under the summary |
| `cta` | label 30; an https URL | warned when missing |
| `labelIds` | label ids | `changelog-check` lists the ones entries use |
| `publish.status` | `draft` (default) or `published` | |
| `publish.notify` | `false` (default) or `true` | emails subscribers when it is published |
| `publish.entryId`, `publish.lastSaved` | an update of an entry found by `changelog-find` | |

The call to action's link is tagged for attribution — `utm_source=changelog`,
`utm_medium=changelog`, `utm_campaign=<campaign or slug>`, `utm_content=cta`
— unless it already has `utm_` parameters.

## Build

```bash
node pipeline/rollout.mjs changelog <slug>
```

writes `output/<slug>/changelog/`:

| File | Holds |
|---|---|
| `entry.md` | the entry's details as Markdown, in the changelog's house style: the summary, the video, the image, each section under a `#` heading, the call to action |
| `entry.json` | title, types, labels, create or update (and which entry), status, notify, what the entry is now, what blocks sending |
| `preview.html` | the entry as it will read |

## Send (on approval)

```bash
node pipeline/rollout.mjs changelog-check                 # the connection; entries by status; the labels in use
node pipeline/rollout.mjs changelog-find <slug> [<words>] # entries that may already announce the feature
node pipeline/rollout.mjs changelog-publish <slug> --yes [--live] [--notify]
```

`changelog-find` matches every word of the feature's name (or the words
given) in an entry's title or text, among the newest 1,000 entries, and saves
each match to `output/<slug>/changelog-live/<id>.json` with its `lastSaved`.

`changelog-publish` builds, then:

- **no entry yet**: creates one, unpublished (a draft);
- **an entry recorded** (`changelog.published.json`) **or named**
  (`publish.entryId`): updates its title, details, types and labels.

Then, only when `publish.status` is `published` and `--live` is given, it
publishes the entry. It reads the entry back and records it in
`library/features/<slug>/changelog.published.json`: its id, URL, status,
types, labels and `lastSaved`. The next send updates the same entry.

It refuses, with the reason:

- an update when the entry was saved in the changelog after it was read
  (`publish.lastSaved`, or the last send) — someone edited it there: read it
  again and merge;
- any change to a published entry without `--live` (it shows at once), and
  `publish.status` `draft` for a published entry (that would unpublish it);
- publishing without `--live`;
- `publish.notify` without `--notify`, or `--notify` without
  `publish.notify` — publishing an entry with notify on emails the
  changelog's subscribers.

Scheduling, and deleting entries, are left to the changelog itself.

## Configuration

| `.env` | |
|---|---|
| `CHANGELOG` | the service: `canny`. Empty: the brand's `changelog.provider` |
| `CHANGELOG_API_KEY` | the service's secret API key (Canny: Settings → API). Sent only to the service, in each request's body. Secret |
| `CHANGELOG_API_URL` | default `https://canny.io/api/v1` |

The adapter is `pipeline/changelog/canny.mjs` (Canny's changelog Entries
API: `entries/list`, `create`, `update`, `change_status`). Another service is
another adapter with the same calls (`pipeline/changelog.mjs`).

## Canny's quirks

- **No call reads one entry**: `get` pages through the list, newest saved
  first, up to 1,000 entries.
- **Create takes one type**; an entry with several gets the rest by an update
  right after.
- **Labels have no list call**: `changelog-check` collects the ones existing
  entries use. A new label is made in Canny.
- **The details are Markdown, in the house style of the existing entries**:
  the summary, then the video embedded with image syntax (`![](<video URL>)`:
  Canny turns an image whose URL is a video into a player), then sections
  under `#` headings, images as `![alt](<URL>)`, and links. The preview
  shows the video as a placeholder. Check the first entry in Canny before
  publishing it.
- **Rate limits** are per key (from 5 requests a second on the free plan); a
  429 names how long to wait.

## When something is refused

- **"no changelog configured"**: set `CHANGELOG=canny` in `.env`.
- **"CHANGELOG_API_KEY is not set"**, or **"invalid api key"**: put the
  company's secret key (Canny: Settings → API) in `.env`.
- **"was saved in the changelog since it was read"**: `changelog-find` again,
  merge the changes into changelog.json, set the new `publish.lastSaved`.
- **"not found"**: the recorded entry was deleted in Canny (or is older than
  the newest 1,000). Remove `publish.entryId` (and the record) to create a new
  one, on approval.
