# Structured data for every page type

Search engines and answer engines read a page's structured data — schema.org
JSON-LD in a `<script type="application/ld+json">` — to know what the page is:
an article and its author, a video and its date, an event and when it starts.
It does not change the page; it describes it. Pages with the right types and
properties can show as rich results, and are easier for AI answers to cite.

`pipeline/schema.mjs` defines one shape per kind of page and renders it three
ways: JSON-LD for one page, the head code for a CMS template, and a check of
what a published page carries. The site-wide `Organization` and `WebSite`
blocks stay in the site's own head code; these shapes are what each page adds.

| Page type | schema.org | Rich result needs |
|---|---|---|
| `article` — blog post, guide, playbook | `BlogPosting` (or `schemaType`, e.g. `Article`) + `BreadcrumbList` | headline, image, datePublished, author |
| `video` — video page | `VideoObject` + `BreadcrumbList` | name, thumbnailUrl, uploadDate |
| `feature` — feature page | `WebPage` about a `SoftwareApplication` (+ `VideoObject`) + `BreadcrumbList` | the application's offers or aggregateRating (from `product`) |
| `podcast` — episode page | `PodcastEpisode` in its `PodcastSeries` + `BreadcrumbList` | name, url |
| `event` — webinar | `Event`, online, at its own page (+ its recording) + `BreadcrumbList` | name, startDate, location |
| `story` — customer story | `Article` about the customer's `Organization` + `BreadcrumbList` | headline, image, datePublished |
| `profile` — author page | `ProfilePage` of a `Person` + `BreadcrumbList` | mainEntity |
| `partner` — partner or expert directory | `ProfilePage` of a `ProfessionalService` + `BreadcrumbList` | mainEntity |
| `comparison` — "X vs Y" page | `WebPage` about the product + `BreadcrumbList` | name |
| `page` — static page (pricing, legal, about) | `WebPage` or a subtype (`AboutPage`, `ContactPage`…), optional `BreadcrumbList` and `FAQPage` | name |

## Configuration

Which field feeds which property is a fact about the site, so it lives in the
brand's `brand.json`, under `web.schema` (`brand/example/brand.json` has one
of each):

```json
"schema": {
  "language": "en",
  "authorPath": "/author",
  "organization": { "name": "Acme", "logo": "https://…/logo.svg" },
  "product": { "name": "Acme Cloud", "operatingSystem": "Web, iOS, Android",
               "offers": { "price": "29", "priceCurrency": "USD" },
               "aggregateRating": { "ratingValue": "4.7", "reviewCount": "448" } },
  "templates": {
    "blog": {
      "type": "article", "collectionId": "<the collection's id>",
      "path": "/blog/{slug}", "section": { "name": "Blog", "path": "/blog" },
      "fields": { "headline": "title", "description": "meta-description", "image": "main-image",
                  "datePublished": "date", "dateModified": "updated-on",
                  "authorName": "author:name", "authorUrl": "author:slug" }
    }
  },
  "pages": {
    "/pricing": { "name": "Pricing", "breadcrumb": { "name": "Pricing" } },
    "/about": { "name": "About us", "schemaType": "AboutPage" }
  }
}
```

- `fields` maps each property the type takes to a field slug. A referenced
  item's field is `reference:field` (`author:name`). Every item's own dates
  bind without a field: `published-on`, `updated-on`, `created-on`.
- `section` is the breadcrumb step between Home and the page: the listing
  page's name and path. Leave out its `path` when there is no listing page;
  the step is then left out (a breadcrumb step must link somewhere).
- Per template: `schemaType` overrides the main type, `series` names a
  podcast's show, `free: true` gives a webinar a free offer.
- `organization.name` overrides the brand name as the publisher (the name the
  site's own `Organization` block uses).
- `owner` (on a template or a page) names who writes its structured data:
  left out, or `rollout`, Rollout does; any other value names the tool that
  does, and Rollout then generates nothing for it (see "Who owns each page").

## Who owns each page

A page should carry one description of itself: one article, one breadcrumb,
one profile. Two tools writing structured data for the same page type — one
into the site builder's schema setting, one into the template's head code —
give it two of each, under different `@id`s, which search engines read as two
different things.

So each template and static page has one owner, set in `web.schema`:

```json
"templates": {
  "blog":   { "type": "article", "owner": "site-schema-tool", "…": "…" },
  "videos": { "type": "video", "…": "…" }
},
"pages": {
  "/pricing": { "name": "Pricing", "owner": "site-schema-tool" }
}
```

For one owned elsewhere, `schema templates` writes no file (and removes one
left from an earlier run, so nobody pastes it), and `schema preview` and
`schema page` refuse. Before giving a page type to Rollout, read what its
published pages carry with `schema check`; before giving one away, remove
Rollout's code from the template's head.

`schema check` warns when a page carries a kind of node that belongs once —
`BreadcrumbList`, `WebPage`, `ProfilePage`, `FAQPage`, an article, `Product`,
`SoftwareApplication`, `VideoObject`, `PodcastEpisode`, `Event` — more than
once across its blocks (nodes with the same `@id` count once): the sign that
two tools write it.

To add what an owner leaves out (a `VideoObject` on video pages, say), add it
in the owner's block, with the owner's `@id`s, rather than as a second block.

## CMS templates

A CMS item cannot carry code of its own: its structured data is written once
in the collection's template page, with each value bound to the item's field.

```bash
node pipeline/rollout.mjs schema templates [--check]
```

writes `output/schema/<brand>/templates/<template>.html` for each template and
lists the fields it binds. `--check` reads each collection (`collectionId`)
and reports a field the collection does not have; a required property no
field feeds is reported either way.

Someone with design access pastes each file into the template page's
**Page settings › Custom code › Inside `<head>` tag**, and publishes. The
bindings are written as Webflow's custom code stores them
(`{{wf {"path":"title","type":"PlainText"} }}`, quotes as `&quot;`); if a
binding shows as text after pasting, delete it and insert the same field with
**+ Add field** at that spot. The agents never change templates
(`docs/website.md`).

Before pasting, see what one item's page will carry:

```bash
node pipeline/rollout.mjs schema preview <template> <item slug>
```

fills the template with that live item (references resolved), prints the
JSON-LD and checks it. It warns on a field empty on that item (its property is
left out) and on a value with a double quote, a backslash or a line break:
Webflow inserts values as they are, so such a value breaks that page's JSON —
reword it, or bind a field without one.

## Static pages

```bash
node pipeline/rollout.mjs schema page <path> [--faq-live]
```

writes the JSON-LD for a page listed in `web.schema.pages` to
`output/schema/<brand>/pages/`, and checks it. `--faq-live` reads the
published page and adds an `FAQPage` from its questions (headings ending in
"?" and the paragraphs after them). The JSON-LD goes in the page's
**Page settings › Custom code › Inside `<head>` tag**, or through the site
builder's API as the page's schema markup — like everything sent to the
website, only on request and as a draft change (`memory/rules.md`).

## Checking published pages

```bash
node pipeline/rollout.mjs schema check <url>...
```

reads each page and checks every JSON-LD block: that it parses, each type's
required properties (a rich result is impossible without them: **fail**) and
recommended ones (**warn**), ISO 8601 dates, absolute URLs, a headline under
110 characters and not ending with the site's name, FAQ questions with
answers, breadcrumb positions and links. It also follows references between
blocks: an object holding only an `@id` (`"publisher": {"@id": "…/#organization"}`)
must name a node that some block on the page defines with that `@id` —
usually the site-wide `Organization` — resolved against the page's address,
so `#organization` and `https://site/blog/x#organization` are the same. A
reference nothing defines leaves the property empty for search engines, and
fails. It warns on a kind of node said twice on one page ("Who owns each
page"). A failing page fails the command.
`seo <slug> --live` runs the same checks on a feature's pages
(`docs/seo.md`). After a change goes live, confirm with Google's Rich Results
Test.
