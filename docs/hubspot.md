# The HubSpot launch: email and social posts

The outbound side of a rollout: the marketing email that tells customers and
prospects about the feature, and the posts on the brand's social accounts,
sent from the brand's HubSpot account. The `rollout-hubspot-marketer` agent
writes them; the pipeline checks and builds them; HubSpot's own tools create
them — as drafts, on the user's approval. Scheduling and sending stay with
the user, in HubSpot.

## The sidecar

`library/features/<slug>/hubspot.json` (the example:
`library/features/smart-scheduling/hubspot.json`):

```json
{
  "campaign": "smart-scheduling-launch",
  "email": {
    "name": "Smart Scheduling — launch announcement",
    "subject": "Book meetings without leaving the text thread",
    "previewText": "Offer open times, sync calendars and send reminders automatically.",
    "headline": "Book meetings right inside the conversation",
    "intro": "…",
    "image": "email-1100x600.png",
    "imageAlt": "A text conversation offering three open meeting times",
    "sections": [{ "title": "Offer open times in one tap", "body": "…" }],
    "cta": { "label": "See how it works", "url": "https://www.acme.example/features/smart-scheduling" },
    "ps": "optional"
  },
  "social": [
    { "network": "LINKEDIN", "content": "…", "image": "slide-1-cover-1080x1350.png", "link": "https://…" },
    { "network": "INSTAGRAM", "content": "… link in bio.", "image": "slide-1-cover-1080x1350.png" }
  ]
}
```

Images are files of the social pack (`output/<slug>/assets/social/`,
`docs/social.md`), so `build <slug>` comes first. Either part may be left
out. `fromName` may be set on the email; otherwise it is chosen when the
email is created.

| | Limit | Notes |
|---|---|---|
| `email.subject` | warn over 60, at most 150 | inboxes cut long subjects |
| `email.previewText` | 40–110 reads in full, at most 200 | never the subject again |
| `email.headline` / `intro` | 80 / 400 | |
| `email.sections` | at most 3; title 60, body 300 | the page tells the rest |
| `email.cta` | label 25; an https URL | |
| `email.image` | required, with `imageAlt` (140) | |
| LinkedIn | 3,000 characters, 5 hashtags | links work |
| Facebook | 5,000 characters, 3 hashtags | links work |
| X (`TWITTER`) | 280 characters, every link counts as 23, 2 hashtags | |
| Instagram | 2,200 characters, 10 hashtags, an image required | captions don't link: "link in bio" |

One post per network. Every link is tagged for attribution —
`utm_source=hubspot`, `utm_medium=email|social`, `utm_campaign=<campaign>`
(the slug when not set), `utm_content=<network|button|image>` — unless it
already has `utm_` parameters. A post's link goes on a line of its own after
its words.

## Build

```bash
node pipeline/rollout.mjs hubspot <slug>
```

writes `output/<slug>/hubspot/`:

| File | Holds |
|---|---|
| `email.json` | name, subject, preview text, from name, the image's HubSpot file, what blocks creating it |
| `email.layout.json` | the email's content in HubSpot's email editor format: one 600px column — image, headline, intro, sections, the button in the brand's CTA colour, the footer with the unsubscribe links |
| `posts.json` | each post: network, its final text with the tagged link, its length and limit, its image and file id |
| `preview.html` | the email and the posts as they will read |

It lists, as `todo`, each image not in HubSpot yet.

## Create (on approval)

```bash
node pipeline/rollout.mjs hubspot-check     # the token's account and scopes; fails without "files"
node pipeline/rollout.mjs hubspot-assets <slug> --yes
```

`hubspot-assets` uploads the email's and posts' images to HubSpot's File
Manager (public, not indexed, in `HUBSPOT_FILES_FOLDER`, default
`/rollout/<slug>`), each once — files are recorded by content in
`library/features/<slug>/hubspot.published.json`, so an unchanged image is
never uploaded twice — and builds again with their URLs (the email needs
public URLs) and file ids (social posts need File Manager files).

Three gates, each the user's:

1. **Plan** (no writes): the agent picks the company channel on each
   network (`get_social_channels`; several on one network: the user
   chooses), and looks for posts the team already made about the same
   launch — `read_social_posts` searched by topic (the feature's name) and
   by a few words of the copy, over the weeks around today, because teams
   rewrite copy. Anything found is listed; creating alongside it is the
   user's call.
2. **Preview** (on approval): `hubspot-assets`, then HubSpot's own preview
   of each post — the same call with `confirmed: false` writes nothing —
   and of the email's settings. The agent stops and shows them.
3. **Create** (on approval of those previews): the identical calls with
   `confirmed: true`. The email: a batch marketing email with the approved
   from name, reply-to, subscription type, template (or blank) and lists,
   its content from `email.layout.json`. Each post: a draft with its text
   and image. Then each is recorded:
   `hubspot-record <slug> --email <id> [--url <link>]` and
   `hubspot-record <slug> --network LINKEDIN --guid <id> --channel <id> --url <link>`.
   Later builds show what was created beside each item.

Nothing is scheduled, published or sent by the pipeline or the agent.

## Configuration

| `.env` | |
|---|---|
| `HUBSPOT_PRIVATE_APP_TOKEN` | a HubSpot private app's access token with the `files` scope, or its granular `files.write` (for `hubspot-assets`); the same private app other projects use works here. Secret. In a cloud session, leave it unset and add the token as a network secret for `api.hubapi.com`: the proxy adds the header |
| `HUBSPOT_API_URL` | default `https://api.hubapi.com` |
| `HUBSPOT_FILES_FOLDER` | the File Manager folder for uploads; `{slug}` is replaced. Default `/rollout/{slug}` |

Creating the email and the posts goes through the HubSpot connector the
session has (its marketing email and social tools).

## When something is refused

- **401 on upload**: `HUBSPOT_PRIVATE_APP_TOKEN` is missing or wrong (or, in
  a cloud session, the `api.hubapi.com` network secret). **403**: the
  private app lacks the `files` scope — `hubspot-check` lists its scopes.
- **The connector needs the Social and Marketing email permissions.**
  Reconnect HubSpot with them ticked; a lock means a HubSpot admin has to
  allow them for the app.
- **So does your HubSpot user.** A connector can never do more than the
  user it signs in as. If `get_social_channels` lists every channel with
  `READ` only, give your user draft access to Social and add it as a
  publisher on each social account (Settings → Marketing → Social →
  Accounts).
