# General-purpose images

Icons as images in the brand's colours, for anything that needs one: blog
posts, help articles, slides, emails, the website. They are drawn from
[Lucide](https://lucide.dev) — about 1,850 line icons on one 24 px grid with
one stroke weight — so a set made today matches one made next year.

The same icons are available inside kit scenes as `<i data-lucide="name">`
(`docs/scene-kit.md`, "Icons").

## Find an icon

```bash
node pipeline/rollout.mjs icons search chat
node pipeline/rollout.mjs icons search calendar clock    # every word must match
```

Each hit prints its name and Lucide's tags. Names are Lucide's own
(`message-square`, `calendar-clock`); old Lucide names still resolve. A name
that does not exist fails with the closest ones to try.

## Make images

```bash
node pipeline/rollout.mjs icons make message-square phone calendar-clock bot
node pipeline/rollout.mjs icons make phone --look solid --size 1024
node pipeline/rollout.mjs icons make phone --look tile --fg navy --bg surface
node pipeline/rollout.mjs icons make phone --brand brand/<name> --out scratch/icons
```

Each icon becomes `<name>-<look>.svg` and `<name>-<look>.png` (transparent
outside its shape) in `output/images/<brand id>/<look>/`. They are build
products, made again by the same command: never edit them by hand. The brand
is `BRAND_DIR`'s unless `--brand` names another folder under `brand/`.

| Look | Shape | Icon colour | Background |
|---|---|---|---|
| `tile` (default) | rounded square | `primary` | `heroTint` |
| `solid` | rounded square | `white` | `primary` |
| `circle` | circle | `primary` | `heroTint` |
| `line` | none | `primary` | transparent |

- `--fg` and `--bg` take a brand colour key (`primary`, `primaryDark`, `cta`,
  `navy`, `ink`, `muted`, `surface`, `heroTint`, `white`, `success`,
  `danger`, `warning`) or a `#hex`. Keys keep the image on brand when the
  brand's colours change; prefer them.
- `--size` is the image's width and height in px (16 to 4096, default 512).
  The stroke is Lucide's, scaled with the icon.
- `--svg-only` skips the PNGs (no Chrome needed).

## Rules

- One look per place: a page or post uses one look throughout.
- Icons, not illustrations: an icon stands for an idea next to text. Product
  visuals still come from the application (`docs/capture.md`).
- No colour in code: looks name brand colour keys, and `loadBrand()` supplies
  the values, so the same command makes every brand's set.
- Images made for a real brand stay on this machine (`output/` is not
  committed).

## Licence

`pipeline/lucide/` holds the Lucide set as path data (`lucide.json`), its
search tags (`lucide-tags.json`) and its ISC licence (`LICENSE-lucide.txt`),
which must stay beside them. The JSON is built from the `lucide-static`
package: each icon's elements as SVG path strings in its 24x24 box, its
tags, and old names as aliases. To update to a newer Lucide, rebuild both
files from that package and replace the licence with the one it ships;
scenes that draw Lucide icons re-render, because their render hash includes
the set's version.
