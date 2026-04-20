---
name: frd-to-blueprint
description: Converts one FRD (Feature Requirements Document) into a feature blueprint that resolves architectural decisions (data model, API contracts, library choices, module layout) before work is decomposed. Reads `projects/{slug}/blueprints/` first to reuse foundation/shared blueprints instead of duplicating shared concerns. Output lands at `projects/{slug}/features/{feature}/blueprint/document.md`. The blueprint becomes shared context for `blueprint-to-tasks` downstream.
---

# FRD to Blueprint

TODO: skill body. See `prd-to-frds` for the upstream producer and `blueprint-to-tasks` for the downstream consumer.
