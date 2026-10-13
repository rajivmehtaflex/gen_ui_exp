# Vendored diagramify subset

This directory contains a deliberately bounded subset of the MIT-licensed
`diagramify` package. The source identity and the SHA-256 digest of every
imported file are recorded in [`vendor-manifest.json`](./vendor-manifest.json).

## Source and subset

- Repository: <https://github.com/rajivmehtaflex/diagramify>
- Verified revision: `748549b5b6e5687cd6c111dfa130d4ac7714b600`
- Git tree: `0e40abe39cbc72fcb52ffc1ba34b8dec96f234b5`
- Package version: `2.16.0-dev.0`
- Source archive: 17,305,594 bytes, SHA-256 `800de93b2010db347f40a319d5fd24d617cbb441100f4b16c5dcc71531c2abe1`
- Import commit in this repository: `77f3c7d06a9cd7e1f8c10d29b8cc8b8413f17e21`

The import history did not record an upstream revision. This revision is the
one whose files reproduce the current import: 65 files are byte-identical,
`assets/template.html` has the local Task 5 patch, and `PATCHES.md` is local
documentation. It is evidence for the imported bytes, not a claim about which
revision the original importer used. Pin this hash for future comparisons; the
fact that it was also upstream `main` when verified is not a moving pin.

The path mapping is `diagramify/<path>` to this directory's `<path>`, except
`LICENSE`, which is copied from the upstream repository root. The root and
package copies of that MIT license are byte-identical. Of the 174 files under
upstream `diagramify/`, this subset contains 66 upstream files. It excludes
the 94-file upstream test suite, 8 HTML examples, 4 references, the scenario
recipe, and `SKILL.md`. The original generator scripts and package lockfile are
included so both shipped derived assets can be reproduced.

`vendor-manifest.json` covers all 67 files in the vendor subset, including the
local `PATCHES.md`. The manifest and this narrative document are excluded from
their own file inventory; the manifest cannot hash itself. The manifest keeps
the pristine source hash and current hash for the patched template.

## Local patch

Task 5 changes only `assets/template.html`, inside `initExplainerToc()`. It
creates TOC links and labels with DOM APIs and `textContent`, and safely encodes
section IDs for hash navigation. The pristine upstream hash is
`15d9e25f6577ecd572ea73a103cdccdbc32a956cd08542a00957d524c3d220a5`; the
current patched hash and patch inventory are in the manifest and
[`PATCHES.md`](./PATCHES.md). The response sandbox policy lives in the app-owned
`server/diagram-tool.mjs`, outside this vendor subset.

## Reproducible derived files

The authentic upstream generators are:

- `scripts/generate-validators.mjs` reads the seven JSON schemas and writes
  `renderers/shared/generated-validators.mjs`.
- `scripts/generate-brand-marks.mjs` reads `brand-marks/catalog.json` and the
  pinned Simple Icons catalog, then writes
  `renderers/shared/generated-brand-marks.mjs`.

Their required versions are Ajv `8.20.0` and Simple Icons `16.28.0`. They are
root development dependencies because they are build-time tools, not runtime
imports of the shipped CLI. The vendor package lock also pins the upstream
generator dependency tree. The brand generator reads its provider version
from `node_modules` under its package root; run it directly after
`npm ci --prefix server/vendor/diagramify` when using the upstream package
scripts.

For the repository gate, run:

```sh
npm ci
npm run check:vendor
```

`check:vendor` verifies source identity, file coverage, hashes, the license,
and the one documented patch. It copies the vendor tree to a temporary
directory, links the already-installed root development dependencies there,
runs both authentic generators against that copy, and compares their output
byte-for-byte with the shipped files. It never replaces a shipped generated
file. The regression checks also prove that a schema or catalog change makes
the corresponding generated asset check fail and that missing generators have
an actionable error.

The upstream `test/` tree is not included. In particular, upstream package
scripts that call omitted release scripts, gallery builders, or test fixtures
are not available here and are not represented as passing. The supported
vendor checks for this subset are the root `check:vendor` gate and the seven
fixture CLI gate `npm run check:diagram`.
