# C4 diagrams

The architecture in [C4](https://c4model.com) form, as PlantUML using the
C4-PlantUML library that ships with PlantUML (`!include <C4/...>`). The prose
version, with the sidecar tables, is [`../ARCHITECTURE.md`](../ARCHITECTURE.md).

| File | Level | Shows |
|---|---|---|
| `1-system-context.puml` | 1 · System context | Rollout, the person driving it, Claude Code, the product application, the help center (Intercom), the image store (S3), the website builder (Webflow), Chrome/ffmpeg |
| `2-containers.puml` | 2 · Containers | the skill and five agents, the pipeline CLI, scene kit, example app, the sidecar stores (`input/`, `brand/`, `.env`/`targets/`/`profiles/`, `library/`, `output/`), and Intercom, S3, the Webflow Data API and the Webflow MCP server |
| `3-components-pipeline.puml` | 3 · Components | the modules of `pipeline/`, including the help-center, image-store and website adapters, and how they depend on each other and on Chrome, ffmpeg, the app, Intercom, S3 and Webflow |
| `4-dynamic-rollout.puml` | Dynamic | one "roll out {slug}" run, then the help article and the website page on request, step by step, with the approval gates |

Placeholders are written `{slug}`, `{id}`, `{hash}` (angle brackets are
markup in PlantUML labels).

## Rendering

Any of:

- IDE: the PlantUML plugin for JetBrains IDEs or VS Code previews `.puml` files.
- Command line (Java + Graphviz):
  `java -jar plantuml.jar -tsvg docs/c4/*.puml`
- Docker: `docker run --rm -v "$PWD/docs/c4:/data" plantuml/plantuml -tsvg /data/*.puml`

Generated images are not committed; regenerate them from the `.puml` files.

Keep the diagrams in step with the code: a new pipeline module belongs in
`3-components-pipeline.puml`, a new agent, store or external service in
`2-containers.puml` (and `1-system-context.puml` for a new external system).
