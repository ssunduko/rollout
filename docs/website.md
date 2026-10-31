# The feature page on the website

The rollout's web page (`output/<slug>/web/`) is a standalone page. The
`rollout-web-publisher` agent rebuilds it on the brand's own website, in the
site builder, **out of the site's existing components**, so it looks like the
rest of the site and the site's editors can change it there. When the site has
no component for a part of the page, the agent creates one, built for reuse,
so the next feature page uses it as is.

Many sites keep their feature pages in a CMS collection instead — one item per
feature, all shown by the collection's template. When
`WEBFLOW_FEATURES_COLLECTION_ID` names that collection, the agent plans the
feature page as an item there ("The cms form" below), so it matches every other
feature page by construction, and no component is created.

Nothing goes to the site without the user's approval, and the page is built as
a **draft**: publishing the site ships everyone's pending changes, so people
publish it from the site builder.

## How it works

| Step | Who | What |
|---|---|---|
| read | pipeline | `rollout.mjs site-find <slug>` reads every page and component into `output/<slug>/site/inventory.json` |
| plan | agent | studies how the site's pages are composed, maps each part of `output/<slug>/web/page.json` to a component, writes `library/features/<slug>/site.json`, reports |
| check | pipeline | `rollout.mjs site-plan <slug>` checks the plan against the inventory and the built page |
| images | pipeline | `rollout.mjs site-assets <slug> --yes` uploads the plan's images to the site's assets (unchanged ones are reused) |
| build | agent | after approval, creates the missing components, then the draft page, and fills every component through its props (Webflow MCP server) |
| record | pipeline | `rollout.mjs site-record <slug> <pageId>` writes `library/features/<slug>/site.published.json` |

The pipeline talks to the site builder's REST API (reading, uploading assets);
building pages and components goes through the site builder's MCP server,
which the agent drives — the REST API cannot compose pages from components.

## The connection

| `.env` key | What |
|---|---|
| `WEBSITE` | the adapter in `pipeline/website/` (`webflow`); empty: the brand's `web.provider` |
| `WEBFLOW_API_TOKEN` | a site API token with `sites:read`, `pages:read`, `components:read`, `assets:read`, `assets:write` and `cms:read`. Secret |
| `WEBFLOW_SITE_ID` | the site. `rollout.mjs site` lists the sites the token can reach |
| `WEBFLOW_FEATURES_COLLECTION_ID` | the CMS collection the site keeps its feature pages in; set, the page is an item there. Needs `cms:read` on the token |
| `WEBFLOW_PAGE_FOLDER_ID` | the page folder new feature pages go in (`rollout.mjs site` lists folders); empty: the site root |
| `WEBFLOW_COMPONENT_GROUP` | the group new components join; empty: `Rollout` |
| `WEBFLOW_API_URL` | empty: `https://api.webflow.com/v2` |

The Webflow MCP server is connected in Claude (the Webflow connector) and
signs in on its own; the agent's tools are `mcp__claude_ai_Webflow__*`.

## site.json

```json
{
  "page": {
    "title": "Smart Scheduling",
    "slug": "smart-scheduling",
    "folderId": null,
    "seo": { "title": "Smart Scheduling | Acme", "description": "…" },
    "openGraph": { "title": "…", "description": "…", "image": { "asset": "og-image.png" } }
  },
  "reference": {
    "pages": ["<pageId>", "<pageId>"],
    "why": "landing pages built from the Landing Template components"
  },
  "sections": [
    { "component": "Top Navigation", "from": "header" },
    {
      "component": "Landing Template | Hero Banner",
      "from": "hero",
      "props": {
        "Heading": "Book the right time in one tap",
        "Text": "…",
        "Image": { "asset": "video-poster.png" },
        "Button link": { "url": "https://www.acme.example/signup" }
      }
    },
    {
      "component": "Feature | Media Right",
      "from": "sections[0]",
      "create": {
        "basedOn": "Landing Template | Right text feature",
        "group": "Rollout",
        "description": "A feature section: heading, body, button and an animated framed GIF on the right."
      },
      "props": { "Heading": "…", "Body": "…", "Media": { "asset": "smart-scheduling--slots.gif" } }
    },
    { "component": "Footer", "from": "footer" }
  ],
  "publish": { "pageId": null, "updatedAt": null }
}
```

| Field | What |
|---|---|
| `page.title`, `page.slug` | the page's name and URL slug (lower-case words joined by hyphens) |
| `page.folderId` | the page folder; empty: `WEBFLOW_PAGE_FOLDER_ID`, else the site root |
| `page.seo`, `page.openGraph` | from `page.json`; the description should stay near 160 characters |
| `reference` | the pages whose composition the plan follows, and why |
| `sections[]` | the page top to bottom: one component instance each |
| `sections[].component` | the component's name in the site |
| `sections[].from` | the part of `page.json` it shows (`hero`, `sections[2]`, `cta`, …) |
| `sections[].props` | prop values by prop name — `"<group> / <name>"` when the component has several props of that name (`"Media block / Image"`): text, number, `true`/`false`, `{ "asset": "<file>" }` (a file in `output/<slug>/web/assets/`, uploaded by `site-assets`), `{ "siteAsset": "<asset id>" }` (an image already in the site's assets, such as a partner logo), `{ "url": "<link>" }` |
| `sections[].create` | only for a component the site lacks: `basedOn` (the component duplicated and adapted; else built from the page's markup), `group`, `description` (required) |
| `publish.pageId`, `publish.updatedAt` | for an update: the page and the `updatedAt` read with `site-get` |

`site-plan` refuses a component the site does not have (unless the section
creates it), a `create` whose name already exists, `basedOn` naming no
component, and images the web page did not build.

## The cms form

With a feature collection, `site.json` holds the item instead of `sections`:

```json
{
  "cms": {
    "collectionId": "<WEBFLOW_FEATURES_COLLECTION_ID>",
    "fields": {
      "name": "Book the right time in one tap",
      "slug": "smart-scheduling",
      "subtitle": "<p>…</p>",
      "meta-description": "…",
      "main-image": { "asset": "assets/social/feature-1280x720.png", "alt": "…" },
      "step-by-step-1-screenshot": { "asset": "smart-scheduling--slots.gif", "alt": "…" },
      "step-by-step-1-content": "<h1><strong>…</strong></h1><p>…</p>",
      "video-link": null
    }
  },
  "publish": { "itemId": null, "updatedAt": null }
}
```

- `fields` are the collection's field slugs (`site-find` reads them into
  `inventory.json` `collection.fields`); `name` and `slug` are required, and so
  is any field the collection requires. `null` leaves a field empty.
- An image is `{ "asset": "<file>", "alt": "…" }`: a plain file name is in
  `output/<slug>/web/assets/`, a path (`assets/social/feature-1280x720.png`)
  is relative to `output/<slug>/`. `site-assets` uploads it; the item gets the
  asset's id and URL.
- The agent fills the fields the way the collection's recent items do (which
  field holds the headline, how rich text is marked up).
- `site-plan` refuses unknown fields, missing required ones and a slug another
  item already has. For an update, `publish.itemId` and `publish.updatedAt`
  (from `site-get <slug> <itemId> --item`).
- The item is created as a draft. Publishing it is the user's, from the CMS.

## Rules the agent follows

- Reuse an existing component whenever its props can carry the content; fill
  components only through their props.
- A new component is named for what it is (not for the feature), uses the
  site's existing classes and variables, and has a prop for every piece of
  content.
- Never change an existing component's definition (every page using it would
  change), unlink an instance, delete anything, or publish.
- Update the page recorded in `site.published.json`; if it changed in the site
  builder since it was read (`site-get` shows a newer `updatedAt`), stop and
  plan again from the page as it is.

## The record

`library/features/<slug>/site.published.json` (written by the pipeline): the
site, page id (or collection and item id), path, URL, draft state, `updatedAt`, the plan's component
order (`plan`), the new components that exist in the site with their ids
(`created`) and those that do not yet (`notCreated`), and each uploaded image
by content hash with its asset id and URL, so later runs reuse it.
