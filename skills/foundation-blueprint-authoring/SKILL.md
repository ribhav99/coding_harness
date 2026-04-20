---
name: foundation-blueprint-authoring
description: Interactive authoring of project-wide blueprints — foundation patterns (auth, data model, error handling) and system diagrams. Output lands at `projects/{slug}/blueprints/{blueprint-slug}/document.md` with `blueprint_type` set to FOUNDATION or SYSTEM_DIAGRAM in the meta file. Feature blueprints (produced by `frd-to-blueprint`) reference these instead of duplicating shared concerns.
---

# Foundation Blueprint Authoring

TODO: skill body. Consumed by: `frd-to-blueprint` (which checks `projects/{slug}/blueprints/` before defining shared concerns in a feature blueprint).
