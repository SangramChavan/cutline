# Cutline — Acrylic Production Studio

Browser-based nesting and print tool for acrylic (and similar flat-stock) production.
Upload a ZIP of artwork, assign the physical shape and size of each design, nest the
pieces on any custom sheet size, preview the layout, and export an aligned print PDF
with a real vector cut layer, plus cutting SVG and DXF files (with a manifest,
preview PNG, production-cost table and a bundled ZIP).

Everything runs locally in the browser. Artwork is never uploaded.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build to dist/
npm test         # vitest acceptance suite
```

## Workflow

1. **Artwork files** — drop files or a ZIP (folders inside a ZIP are preserved as
   the design `path`). PNG / JPG / WEBP / SVG are supported as artwork; a `.csv`
   inside the ZIP is applied automatically as production settings.
2. **Sheet & clearance** — set sheet width/height (mm, cm or in), edge margins and
   the minimum clearance between pieces.
3. **Designs** — per artwork: physical width/height, quantity, cutting shape
   (rectangle, rounded, circle, ellipse, polygon, custom SVG path), rotation.
4. **Nest** — preflight blocks nesting when a design has missing dimensions or
   invalid cutting geometry; otherwise pieces are placed across as many sheets as
   needed (run in a Web Worker, cancelable; tick **Single sheet** to force one
   sheet only). Import/export a settings CSV to fill dimensions in bulk. Duplicate
   files are flagged by content hash; repeated filenames by name.
5. **Review** — switch sheet tabs, zoom/pan, lock or drag pieces. Click a piece to
   inspect its design, placement and cost; click the canvas to clear.
6. **Production summary** — placed/unplaced counts, sheet utilization, used/waste
   area, total cut length, estimated cut time and per-piece/sheet/total cost
   (sheet price, cut speed, cut rate, pierce time are editable).
7. **Export** — Print PDF (one page per sheet at the exact mm size, artwork at
   print DPI **plus a vector cut layer**: true scaled contour paths at 0.25 mm
   in the selected cut color), Outline PDF (vector cut outline + holes) and Mirror outline,
   Cutting **DXF** (mm units, `CUT` layer), Manifest CSV, Preview PNG, or a ZIP
   containing all of them.

## Settings CSV

```csv
path,width,height,quantity,shape,radius
batch/square-40.png,50,50,6,rectangle,0
batch/qr-tag-A.png,30,30,8,circle,0
```

Rows match by the design `path` (nested path) or file name; unmatched rows leave
the design unchanged.

## Architecture

- `src/geometry.ts` — the geometric placement judge. Each copy's legal spots are
  enumerated and verified against real contours, then the judge scores them
  (60% shared-edge packing tightness + 40% bottom-left bias), returns a
  confidence and a reason, and the best is committed. Deterministic, offline,
  no key.
- `src/model.ts` — types, mm/unit conversion, contour geometry
  (`pathPoints`, `piecePoints`, `polygonsOverlap`, `validatePolygon`), the `pack()`
  nesting engine (single/multi-sheet aware).
- `src/export.ts` — `buildPdf` (vector cut layer + DPI-aware artwork), `buildSvg`,
  `buildDxf`, `buildManifest`, `makePng`.
- `src/production.ts` — placed/unplaced counts, utilization, cut length/time,
  cost calculator (`summarize`).
- `src/nest.worker.ts` — Web Worker wrapper around `pack()` so large batches keep
  the UI responsive and can be cancelled.
- `src/ui.tsx` — the whole app UI and workflow wiring.
- `src/model.test.ts`, `src/geometry.test.ts`, `src/export.test.ts`, `src/production.test.ts` — acceptance tests.
- `scripts/make-fixtures.mjs` — writes `fixtures/acrylic-batch.zip`.

## Tests

`npm test` covers: exact quantities at physical size, circle contour zero-gap
tangency, multi-sheet overflow with impossible pieces rejected (single-sheet mode
too), clearance as a minimum gap, mixed-shape batches, invalid geometry, SVG-path
parsing, a 500-piece performance guard, export layer correctness (PDF page box =
sheet size, one cut path per piece, DXF structure and mm scale, transformed piece
contours, manifest rows), and the production calculator (counts, utilization,
cut length/time, costs, duration formatting).

## Known limitations

- **No automatic outline tracing.** A PNG's transparent boundary is *not*
  auto-traced; irregular shapes are entered manually as polygon vertices or as a
  closed SVG path (`M x y L x y ... Z`). Configurable trace tolerance/smoothing is
  therefore not available.
- **SVG outline parsing is basic.** Only absolute `M`/`L` polygon paths (or bare
  `x y` point pairs) are read; relative commands, arcs and Bézier curves are not
  interpreted — their numbers are extracted as points.
- **Rotated non-square contours in the print layer.** The cutting SVG/DXF always
  use the exact rotated contour. For `ellipse` and `rounded` shapes rotated away
  from 0°, the *print artwork* is placed at print DPI and masked to the rotated
  contour (a raster mask in the PDF, a `clipPath` in the SVG), so print-to-cut
  alignment is exact; the masked image is what is burned. Rectangles, squares and
  circles with 0°/90° rotation skip re-rasterization entirely and embed the
  original file directly.
- **PNG preview** clips artwork to the true cutting contour (there is no shadow or
  pad), and is a visual preview only — the manifest is the production reference.
- **Collision detection is a probe heuristic** (vertices, edge midpoints, centroid
  plus strict segment intersection). It is exact for the convex built-in shapes;
  for concave custom polygons very thin overlaps could in principle be missed.
- **Nesting quality**, not optimality: the geometric judge evaluates a bounded
  set of legal placements per sheet (shared-edge contact + bottom-left bias)
  instead of taking the first fit; 0/90° or 15°-step rotations per mode.
  Utilization is reported per sheet.
- **Non-image, non-SVG artwork** (e.g. unknown MIME) is drawn as a text placeholder
  in the PDF and cannot be nested as a contour.
- Large batches are handled (~500 pieces ≈ 1 s); the candidate list uses an O(n²)
  sorted insert, fine to a few thousand pieces.
