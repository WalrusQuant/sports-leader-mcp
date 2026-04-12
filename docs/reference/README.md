# Reference

Deep reference material for the ESPN APIs that power sports-leader-mcp.

> **Note:** Most users don't need to read these — the [MCP tools](tools/) handle URL construction, parameter formatting, and known gotchas for you. This reference is for understanding what's happening under the hood, or for using `espn_fetch` with endpoints not covered by a dedicated tool.

## Sections

- **[API Endpoints](reference/endpoints.md)** — Complete catalog of every ESPN API endpoint across 8 domains (Site API, Core v2/v3, Web v3, CDN, Now API, Fantasy API). Over 100 endpoints documented with URL patterns and query parameters.

- **[Response Schemas](reference/response-schemas.md)** — Annotated JSON examples for 14 major endpoint types. Shows you what fields to expect and what they mean.

- **[League & Sport Slugs](reference/league-slugs.md)** — All 139 leagues mapped to their sport categories with the exact slug values to use. Includes conference/group IDs for college sports and CDN slug mappings.

- **[Gotchas & Pitfalls](reference/gotchas.md)** — 16 common mistakes when working with ESPN's APIs, with correct vs. incorrect examples. Covers the standings path trap, CDN requirements, pagination defaults, and sport-specific quirks.
