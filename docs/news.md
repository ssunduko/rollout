# The in-app news item

The announcement customers see inside the product: a short item in the
messenger's newsfeed that says what's new and links to where to learn more.
The `rollout-news-writer` agent writes it; the pipeline checks and builds it
and sends it to the news service over its API — as a draft, on the user's
approval. Setting it live, and showing the notification badge, are separate
approvals.

The in-app **post** (a full-screen message) has no public API, so the
pipeline never creates one. The item's body, `output/<slug>/news/item.html`,
pastes into a post by hand.

## The sidecar

`library/features/<slug>/news.json` (the example:
`library/features/smart-scheduling/news.json`):

```json
{
  "feature": "Smart Scheduling",
  "title": "Book meetings right inside the conversation",
  "summary": "Smart Scheduling is here: …",
  "coverImage": "https://www.acme.example/images/smart-scheduling-cover.png",
  "image": { "url": "https://…/suggest-times.gif", "alt": "…" },
  "video": { "url": "https://www.youtube.com/watch?v=…", "label": "Watch the video" },
  "sections": [{ "title": "How it works", "bullets": ["…", "…"] }],
  "cta": { "label": "See how it works", "url": "https://www.acme.example/features/smart-scheduling" },
  "labels": ["New feature"],
  "newsfeedIds": ["…"],
  "reactions": ["🎉", "👍", "😐"],
  "publish": { "state": "draft", "notify": false, "senderId": "…", "itemId": "…", "updatedAt": 0 }
}
```

| | Limit | Notes |
|---|---|---|
| `title` | warn over 70, at most 150 | the messenger is narrow |
| `summary` | warn over 300, at most 600 | plain sentences; the pipeline formats |
| `sections` | at most 4; title 60, body 300, up to 6 bullets of 140 | each needs a body, bullets, or both |
| `coverImage` | a public https URL with lower-case `.png` or `.jpg` | the API rejects `.jpeg`, `.PNG` and others; it copies the image |
| `image` | a public https URL, with `alt` (140) | inside the body; a GIF works |
| `video` | an https URL | a link in the body |
| `cta` | label 30; an https URL | warned when missing |
| `labels` | names, 5 or fewer | `news-check` lists the ones in use |
| `newsfeedIds` | newsfeed ids | empty: `NEWS_NEWSFEED_IDS`; a live item needs one |
| `reactions` | up to 5, each one emoji code point | no skin tones, joiners or variation selectors; `[]` for none |
| `publish.state` | `draft` (default) or `live` | |
| `publish.notify` | `false` (default) or `true` | `true` shows the notification badge when live |
| `publish.senderId` | a teammate id | empty: `NEWS_SENDER_ID`, else `HELP_AUTHOR_ID` |
| `publish.itemId`, `publish.updatedAt` | an update of an item found by `news-find` | |

The call to action's link is tagged for attribution — `utm_source=intercom`,
`utm_medium=news`, `utm_campaign=<campaign or slug>`, `utm_content=cta` —
unless it already has `utm_` parameters.

## Build

```bash
node pipeline/rollout.mjs news <slug>
```

writes `output/<slug>/news/`:

| File | Holds |
|---|---|
| `item.html` | the body as HTML: the summary, the image, each section under a heading, the video's link, the call to action |
| `item.json` | title, labels, newsfeeds, reactions, cover, sender, create or update, state, notify, what blocks sending (no sender, no newsfeed) |
| `preview.html` | the item as it will read, at the messenger's width |

## Send (on approval)

```bash
node pipeline/rollout.mjs news-check                 # the connection; newsfeeds, senders and labels in use
node pipeline/rollout.mjs news-find <slug> [<words>] # items that may already announce the feature
node pipeline/rollout.mjs news-publish <slug> --yes [--live] [--notify]
```

`news-find` matches every word of the feature's name (or the words given) in
an item's title or text, and saves each match to
`output/<slug>/news-live/<id>.json` with its `updatedAt`.

`news-publish` builds, then creates the item (a draft unless
`publish.state` is `live` and `--live` is given), or updates the one
recorded (`news.published.json`) or named (`publish.itemId`). Every update
sends the full lists — labels, newsfeeds and reactions — because the API
clears any left out. It reads the item back and records it in
`library/features/<slug>/news.published.json`: its id, state, newsfeeds,
labels, whether it is silent, and `updatedAt`. The next send updates the same
item.

It refuses, with the reason:

- an update when the item changed in the news service after it was read
  (`publish.updatedAt`, or the last send) — someone edited it there: read it
  again and merge;
- any change to a live item without `--live` (it shows at once), and
  `publish.state` `draft` for a live item (that would take it down);
- setting it live without `--live`, or with no newsfeed;
- `publish.notify` without `--notify`, or `--notify` without
  `publish.notify`;
- no sender.

The pipeline never deletes an item; a draft no longer wanted is deleted in
the news service.

## Configuration

| `.env` | |
|---|---|
| `NEWS` | the service: `intercom`. Empty: the brand's `news.provider` |
| `NEWS_TOKEN` | an access token with read and write access to news (Intercom: `read_write_news_scope`). Empty: `HELP_CENTER_TOKEN`, when the help center is the same workspace. Secret |
| `NEWS_API_URL`, `NEWS_API_VERSION` | empty: `HELP_CENTER_API_URL` / `HELP_CENTER_API_VERSION`, else `https://api.intercom.io` and `2.14` |
| `NEWS_SENDER_ID` | the teammate items are sent from. Empty: `HELP_AUTHOR_ID` |
| `NEWS_NEWSFEED_IDS` | the newsfeeds an item goes to when news.json names none, comma-separated |

The adapter is `pipeline/news/intercom.mjs` (Intercom's News API: news
items and newsfeeds). Another service is another adapter with the same calls
(`pipeline/news.mjs`).

## Intercom's quirks

- **Lists are cleared when left out of an update** (labels, newsfeeds), and
  reactions are disabled: the adapter always sends them whole.
- **`sender_id` is required on every update**, not just on create.
- **The cover image URL must contain lower-case `.png` or `.jpg`**; Intercom
  copies it and serves its own copy.
- **Reactions are single code points**: ❤️ (with its variation selector) and
  skin-tone emoji are rejected; more than five is a 400 that still saves the
  item as a draft, without reactions or cover.
- **A draft is not shown to users** in its newsfeeds until it is set live.
- **Intercom rewrites the body when it saves it**, without changing what it
  says: images are copied to Intercom's own host and served from a signed
  URL that expires (wrapped in an `intercom-container`), `h2` headings are
  stored as `h1`, and links get Intercom's class and `rel`. So the stored
  body never equals `item.html`; the pipeline sends `item.html` again on
  every update, and Intercom copies the images again.
- **News must be enabled on the workspace**; otherwise the API answers 404
  with no body.

## Trying it: a sample draft

Send a sample draft under a slug of its own (git-ignored), with a title
that says it is a sample, `publish.state` `draft` and `publish.notify`
`false`; look at it in Intercom (Proactive Support → News), then delete it
there. Never send the committed example feature (`smart-scheduling`): its
folder is committed, so its record would put a real item's id in the
repository.

## When something is refused

- **"no news service configured"**: set `NEWS=intercom` in `.env`.
- **"NEWS_TOKEN is not set"**, or a **401**: a token with read and write
  access to news, in `NEWS_TOKEN` (or the help center's, if it has that
  access).
- **"was changed in the news service since it was read"**: `news-find`
  again, merge the changes into news.json, set the new `publish.updatedAt`.
- **"no sender"**: `NEWS_SENDER_ID` in `.env` (`news-check` lists
  teammates).
