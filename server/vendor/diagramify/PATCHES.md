# Local patches

This directory vendors diagramify `2.16.0-dev.0`. Keep `LICENSE` with the vendored files.

## Explainer table of contents

`assets/template.html` contains a local patch in `initExplainerToc()`:

- Select the main diagram SVG and its explainer section groups by `data-section-kind`. The explainer renderer does not add the `data-diagram-type` attribute the original selector expected, so the table of contents could not initialize.
- Build links, badges, and titles with DOM APIs. Put section numbers and titles in `textContent` so authored content cannot become markup.
- Encode section IDs when assigning the link hash and when updating browser history.

## Artifact response policy

The direct artifact response policy is set in `server/diagram-tool.mjs`, outside the vendored source:

```text
default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts allow-downloads
```

The local browser regression coverage is `scripts/test-artifact-isolation.mjs`.
