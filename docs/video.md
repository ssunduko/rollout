# The video page

Besides the feature page, a site may give each feature video a page of its
own: an item of a video CMS collection, shown by the collection's template —
the video (on YouTube), a description and a summary, the video's transcript,
related videos, a cover image and the fields search engines read. The
`rollout-web-publisher` agent plans it in
`library/features/<slug>/video.json` and, on approval, builds it as a draft
item through the site builder's MCP server; `pipeline/videopage.mjs` reads
the collection, transcribes the video, checks the plan, uploads the images
and records the item. Publishing it is the user's, as for the feature page
(`docs/website.md`, "Publishing").

| Step | Who | What |
|---|---|---|
| read | pipeline | `video-site <slug>`: the collection's fields and items → `output/<slug>/video/site-inventory.json`; the newest published pages' summary and transcript as text → `output/<slug>/video/reference/`; the sort order a new video takes |
| transcribe | pipeline | `video-transcribe <slug>`: the feature video (`video.file`, read from the video source and sent to the studio's speech to text, as for the podcast — an unchanged video is not transcribed again) → `output/<slug>/video/transcript.html` and `.txt`, in paragraphs |
| plan | agent | `video.json`: the YouTube link and every field, in the style of the site's other video pages; an update when the feature already has a page |
| check | pipeline | `video-plan <slug>`: required fields, field names, the video, the slug, the sort order, images, SEO |
| build | agent | after approval: `video-site-assets --yes`, then the draft item (Webflow MCP server); `video-site-record <slug> <itemId>` |

## The connection

The site's connection is the feature page's (`docs/website.md`, "The
connection"), plus:

| `.env` | What |
|---|---|
| `WEBFLOW_VIDEOS_COLLECTION_ID` | the CMS collection video pages are items of. The token needs `cms:read` |

Transcribing uses the podcast's video source and studio
(`PODCAST_VIDEO_SOURCE`, `PODCAST_STUDIO` and their keys, `docs/podcast.md`);
the transcript is shared with the podcast (`output/<slug>/podcast/video-transcript.json`).

## video.json

```json
{
  "video": {
    "url": "https://www.youtube.com/watch?v=<id>",
    "file": "https://drive.google.com/file/d/<id>/view"
  },
  "site": {
    "fields": {
      "name": "Book Meetings Over Text Without Leaving the Conversation",
      "slug": "smart-scheduling",
      "description": "One sentence on what the feature lets you do.",
      "video-url": "https://www.youtube.com/watch?v=<id>",
      "custom-sort-order": 2460,
      "video-summary": "<p>What the video shows, in one paragraph.</p>",
      "video-transcription": "<p>…</p><p>…</p>",
      "cover-image": { "asset": "assets/social/feature-1280x720.png", "alt": "…" },
      "related-videos-link-1": "https://www.acme.example/videos/<slug>",
      "related-videos-name-1": "…",
      "related-video-thumbnail-1": { "url": "https://…/cover.png", "alt": "…" },
      "meta-title": "…",
      "meta-description": "…",
      "keywords": "…"
    }
  }
}
```

| Field | Notes |
|---|---|
| `video.url` | the video's YouTube link (watch, `youtu.be`, embed or Shorts) |
| `video.file` | the feature video in the video source, for `video-transcribe` |
| `video.speakers` | optional: how many people speak (the speech to text's hint) |
| `publish.itemId` | the existing item this page updates, before it is first recorded (e.g. a draft someone started): its slug and sort order then count as the page's own, and `video-site-record` records an update. Once recorded, `video.published.json` names the item and a different `publish.itemId` is an error. Omit for a new item |
| `site.fields` | the page by the collection's field slugs (`video-site` lists them; `*` is required). Images as `{ "asset": "<path in output/<slug>/>", "alt": "…" }` (uploaded by `video-site-assets`) or `{ "url": "https://…", "alt": "…" }` (an image already on the site, e.g. a related video's cover) |

`video-plan` checks:
- the collection's required fields are filled, and no field is unknown;
- every video field plays `video.url`'s video;
- the slug is free, unless it is this page's item (recorded, or `publish.itemId`);
- `publish.itemId` is an item of the collection, and the recorded one once there is a record;
- a new page's sort order is above the newest video's (the site counts up by 10);
- images exist or are https links;
- the search and answer-engine checks of `docs/seo.md` (title, description, keyword, slug, alt text).

## The record

`library/features/<slug>/video.published.json` holds `video` (the
transcribed video) and `site` (the item: id, path, URL, draft, when it last
changed, and the uploaded images by content hash, so unchanged images are
not sent again).
