import { PDFDocument, rgb } from 'pdf-lib'
import { holeSheetPolygon, localToSheet, piecePoints, pointsToPath, outerSize, polygonArea, toMm, usableBounds, type Design, type Hole, type Layout, type Piece, type Sheet } from './model'
import { canvasToPng, drawComposition, renderPieceCanvas } from './compose'
import { qrMatrix, qrSvgInner } from './qr'

const encoder = new TextEncoder()
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)
const mm = (n: number) => `${n.toFixed(4)}mm`
const PT_PER_MM = 72 / 25.4

export interface ExportOptions {
  border?: boolean
  // Flip the print left-right (for printing on the reverse side). Print PDF only; cut files are never mirrored.
  mirror?: boolean
  cut?: boolean
  cutColor?: string
  cutWidthMm?: number
  dpi?: number
  marks?: boolean
  scaleMark?: boolean
  jobName?: string
  material?: string
  // Self-contained artwork for the SVG print layer: design id -> data: URL.
  // Falls back to the design's own URL (fine for tests / already-inline art).
  hrefs?: Map<string, string>
}

function hexToRgb(hex: string) {
  const value = /^#?([0-9a-f]{6})$/i.exec(hex.trim())?.[1] ?? 'ff0000'
  return rgb(parseInt(value.slice(0, 2), 16) / 255, parseInt(value.slice(2, 4), 16) / 255, parseInt(value.slice(4, 6), 16) / 255)
}

function piecePath(piece: Piece, design: Design) {
  return pointsToPath(piecePoints(piece, design))
}

function flipX(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = src.width; c.height = src.height
  const ctx = c.getContext('2d')!
  ctx.translate(c.width, 0); ctx.scale(-1, 1)
  ctx.drawImage(src, 0, 0)
  return c
}

function holesOf(design: Design): Hole[] { return design.holes ?? [] }

// Print-ready PDF: arranged artwork (with QR) at 1:1 page size. Cutting geometry
// is NOT drawn here by default, so no red cut border can reach the print.
export async function buildPdf(designs: Design[], layout: Layout, sheet: Sheet, options: ExportOptions = {}) {
  const { border = false, mirror = false, cut = false, cutColor = '#111111', cutWidthMm = 0.25, dpi = 300, marks = false, scaleMark = true, jobName, material } = options
  const pageW = toMm(sheet.width, sheet.unit) * PT_PER_MM, pageH = toMm(sheet.height, sheet.unit) * PT_PER_MM
  const pdf = await PDFDocument.create()
  pdf.setTitle(jobName ? `${jobName} — Cutline print sheets` : 'Cutline print sheets')
  pdf.setProducer('Cutline — local-first production studio')
  if (jobName || material) pdf.setSubject([jobName, material].filter(Boolean).join(' · '))
  for (const pieces of layout.sheets) {
    const page = pdf.addPage([pageW, pageH])
    for (const p of pieces) {
      const d = designs.find(v => v.id === p.designId)!
      const x = (mirror ? pageW / PT_PER_MM - p.x - p.width : p.x) * PT_PER_MM, y = pageH - (p.y + p.height) * PT_PER_MM, w = p.width * PT_PER_MM, h = p.height * PT_PER_MM
      if (d.mime.startsWith('image/')) {
        const raster = mirror ? flipX(await renderPieceCanvas(d, p, dpi)) : await renderPieceCanvas(d, p, dpi)
        page.drawImage(await pdf.embedPng(await canvasToPng(raster)), { x, y, width: w, height: h })
      } else {
        page.drawText(`${d.name}\nArtwork: ${d.mime || 'unknown'}`, { x: x + 4, y: y + h / 2, size: 7, color: rgb(.25, .28, .3), maxWidth: w - 8 })
      }
      if (cut) page.drawSvgPath(piecePath(p, d), { x: 0, y: pageH, scale: PT_PER_MM, borderColor: hexToRgb(cutColor), borderWidth: cutWidthMm })
      if (border) page.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(.1, .12, .15), borderWidth: .35 })
      if (marks) page.drawText(p.id.slice(-5), { x: x + 1, y: y + 1, size: 5, color: rgb(.55, .1, .2) })
    }
    // 1:1 scale reference: a 100 mm bar with end ticks. Print without scaling and
    // measure this to confirm the page is true size before cutting.
    if (scaleMark) {
      const bar = 100 * PT_PER_MM, bx = 6 * PT_PER_MM, by = 6 * PT_PER_MM
      page.drawText('verify 1:1', { x: bx, y: by + 2 * PT_PER_MM, size: 5, color: rgb(.35, .38, .4) })
      page.drawLine({ start: { x: bx, y: by }, end: { x: bx + bar, y: by }, thickness: .6, color: rgb(0, 0, 0) })
      page.drawLine({ start: { x: bx, y: by - 1.5 * PT_PER_MM }, end: { x: bx, y: by + 1.5 * PT_PER_MM }, thickness: .6, color: rgb(0, 0, 0) })
      page.drawLine({ start: { x: bx + bar, y: by - 1.5 * PT_PER_MM }, end: { x: bx + bar, y: by + 1.5 * PT_PER_MM }, thickness: .6, color: rgb(0, 0, 0) })
      page.drawText('100 mm', { x: bx + bar + 1.5 * PT_PER_MM, y: by - .5 * PT_PER_MM, size: 5, color: rgb(.35, .38, .4) })
    }
  }
  return new Uint8Array(await pdf.save())
}

// Cutting-ready PDF: vector cut contours and hole paths only, no artwork. Black
// hairline strokes on a true-size page, one page per sheet.
export async function buildCutPdf(designs: Design[], layout: Layout, sheet: Sheet, options: ExportOptions = {}) {
  const { cutWidthMm = 0.1, jobName, mirror = false } = options
  const pageW = toMm(sheet.width, sheet.unit) * PT_PER_MM, pageH = toMm(sheet.height, sheet.unit) * PT_PER_MM
  // Mirrored outlines flip left-right across the sheet width, matching the mirrored print.
  const path = (pts: { x: number; y: number }[]) => pointsToPath(mirror ? pts.map(q => ({ x: pageW / PT_PER_MM - q.x, y: q.y })) : pts)
  const pdf = await PDFDocument.create()
  pdf.setTitle(jobName ? `${jobName} — Cutline cut paths${mirror ? ' (mirrored)' : ''}` : `Cutline cut paths${mirror ? ' (mirrored)' : ''}`)
  pdf.setProducer('Cutline — local-first production studio')
  for (const pieces of layout.sheets) {
    const page = pdf.addPage([pageW, pageH])
    for (const p of pieces) {
      const d = designs.find(v => v.id === p.designId)!
      page.drawSvgPath(path(piecePoints(p, d)), { x: 0, y: pageH, scale: PT_PER_MM, borderColor: rgb(0, 0, 0), borderWidth: cutWidthMm })
      for (const h of holesOf(d)) page.drawSvgPath(path(holeSheetPolygon(h, p, d, 48)), { x: 0, y: pageH, scale: PT_PER_MM, borderColor: rgb(0, 0, 0), borderWidth: cutWidthMm })
    }
  }
  return new Uint8Array(await pdf.save())
}

function qrGroup(d: Design, piece: Piece): string {
  const qr = d.qr
  if (!qr?.enabled) return ''
  const size = qr.sizeMm
  const centre = localToSheet({ x: qr.x + size / 2, y: qr.y + size / 2 }, piece, d)
  const transform = `translate(${(centre.x - size / 2).toFixed(4)} ${(centre.y - size / 2).toFixed(4)}) rotate(${(piece.rotation + (qr.rotation || 0)).toFixed(4)} ${(size / 2).toFixed(4)} ${(size / 2).toFixed(4)})`
  if (qr.source === 'image' && qr.imageDataUrl?.startsWith('data:')) return `<g transform="${transform}"><image href="${esc(qr.imageDataUrl)}" width="${size.toFixed(4)}" height="${size.toFixed(4)}"/></g>`
  return `<g transform="${transform}">${qrSvgInner(qrMatrix(qr.text || ' ', qr.ecLevel), size, Math.max(0, qr.quietModules), qr.dark || '#000000', qr.light || '#ffffff', qr.light !== 'transparent')}</g>`
}

export function buildSvg(designs: Design[], layout: Layout, sheet: Sheet, options: ExportOptions = {}) {
  const { marks = false, cutColor = '#ff0000', cutWidthMm = 0.01, hrefs, mirror = false } = options
  const widthMm = toMm(sheet.width, sheet.unit), heightMm = toMm(sheet.height, sheet.unit)
  return layout.sheets.map((pieces, i) => {
    const artwork = pieces.map(p => {
      const d = designs.find(v => v.id === p.designId)!
      const clip = `clip-${p.id.replace(/[^\w-]/g, '-')}`
      const path = piecePath(p, d)
      // d.url is a session blob: URL, dead once the tab closes. Embed the real
      // bytes (data: URL) so the exported SVG is self-contained and reusable.
      const href = hrefs?.get(d.id) ?? d.url
      const b = outerSize(d).offset
      return `<defs><clipPath id="${clip}"><path d="${esc(path)}"/></clipPath></defs><g clip-path="url(#${clip})">${b ? `<rect x="${p.x.toFixed(4)}" y="${p.y.toFixed(4)}" width="${p.width.toFixed(4)}" height="${p.height.toFixed(4)}" fill="${esc(d.borderColor)}"/>` : ''}<image href="${esc(href)}" x="${(p.x + b).toFixed(4)}" y="${(p.y + b).toFixed(4)}" width="${(p.width - 2 * b).toFixed(4)}" height="${(p.height - 2 * b).toFixed(4)}" preserveAspectRatio="xMidYMid meet"/>${qrGroup(d, p)}</g>${marks ? `<text x="${p.x}" y="${p.y + 3}" font-size="2">${esc(p.id)}</text>` : ''}`
    }).join('\n')
    const cuts = pieces.map(p => { const d = designs.find(v => v.id === p.designId)!; const holes = holesOf(d).map(h => `<path d="${esc(pointsToPath(holeSheetPolygon(h, p, d, 48)))}" data-kind="hole"/>`).join('\n'); return `<path d="${esc(piecePath(p, d))}" data-kind="outline"/>${holes}` }).join('\n')
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${mm(widthMm)}" height="${mm(heightMm)}" viewBox="0 0 ${widthMm} ${heightMm}"><title>Cutline sheet ${i + 1}${mirror ? ' (mirrored)' : ''}</title><g${mirror ? ` id="mirrored" transform="translate(${widthMm} 0) scale(-1 1)"` : ''}><g id="print-artwork">${artwork}</g><g id="cut" fill="none" stroke="${cutColor}" stroke-width="${cutWidthMm}">${cuts}</g></g></svg>`
  })
}

// Structured cut geometry, the single source shared by DXF, the SVG cut layer,
// the cutting-time estimator and the tests. Outline and internal hole contours
// per placed copy, in sheet mm.
export interface CutContour { kind: 'outline' | 'hole'; designId: string; copy: number; sheet: number; points: { x: number; y: number }[] }
export function cutContours(designs: Design[], layout: Layout): CutContour[] {
  const out: CutContour[] = []
  for (const pieces of layout.sheets) for (const p of pieces) {
    const d = designs.find(v => v.id === p.designId)!
    out.push({ kind: 'outline', designId: d.id, copy: p.copy, sheet: p.sheet, points: piecePoints(p, d) })
    for (const h of holesOf(d)) out.push({ kind: 'hole', designId: d.id, copy: p.copy, sheet: p.sheet, points: holeSheetPolygon(h, p, d, 48) })
  }
  return out
}

// Minimal ASCII DXF (AC1015 / LWPOLYLINE) of the cut geometry, in mm, one closed
// polyline per contour. External outlines go on layer CUT, internal holes on
// layer HOLES — no artwork or QR bitmaps ever reach a cutting layer.
export function buildDxf(designs: Design[], layout: Layout, sheet: Sheet) {
  const heightMm = toMm(sheet.height, sheet.unit)
  const lines = (xs: (string | number)[]) => xs.join('\r\n') + '\r\n'
  const layerDefs = (['CUT', 'HOLES'] as const).map(name => lines([0, 'LAYER', 2, name, 70, 0, 62, 7, 6, 'CONTINUOUS'])).join('')
  return layout.sheets.map(pieces => {
    const entities = pieces.flatMap(p => {
      const d = designs.find(v => v.id === p.designId)!
      const polys = [(['CUT', piecePoints(p, d)] as const), ...holesOf(d).map(h => (['HOLES', holeSheetPolygon(h, p, d, 48)] as const))]
      return polys.map(([layer, pts]) => {
        const verts = pts.map(pt => lines([10, pt.x.toFixed(4), 20, (heightMm - pt.y).toFixed(4)])).join('')
        return lines([0, 'LWPOLYLINE', 8, layer, 100, 'AcDbEntity', 100, 'AcDbPolyline', 90, pts.length, 70, 1]) + verts
      })
    }).join('')
    return lines([0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1015', 9, '$INSUNITS', 70, 4, 0, 'ENDSEC', 0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'LAYER']) + layerDefs + lines([0, 'ENDTAB', 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES']) + entities + lines([0, 'ENDSEC', 0, 'EOF'])
  })
}

export function buildManifest(designs: Design[], layout: Layout) {
  const rows = [['filename', 'design_id', 'copy_number', 'shape', 'width_mm', 'height_mm', 'hole_count', 'qr', 'sheet_number', 'x_mm', 'y_mm', 'rotation_deg', 'placement_status']]
  for (const pieces of layout.sheets) for (const p of pieces) { const d = designs.find(v => v.id === p.designId)!; rows.push([d.path, d.id, String(p.copy), d.shape, outerSize(d).w.toFixed(4), outerSize(d).h.toFixed(4), String(holesOf(d).length), d.qr?.enabled ? (d.qr.source === 'image' ? 'image' : 'generated') : '', String(p.sheet + 1), p.x.toFixed(4), p.y.toFixed(4), String(p.rotation), 'placed']) }
  for (const p of layout.unplaced) { const d = designs.find(v => v.id === p.designId)!; rows.push([d.path, d.id, String(p.copy), d.shape, outerSize(d).w.toFixed(4), outerSize(d).h.toFixed(4), String(holesOf(d).length), d.qr?.enabled ? d.qr.source : '', '', '', '', '', 'unplaced']) }
  return rows.map(row => row.map(v => `"${v.replace(/"/g, '""')}"`).join(',')).join('\r\n')
}

export async function makePng(designs: Design[], pieces: Piece[], sheet: Sheet) {
  const factor = 3, canvas = document.createElement('canvas')
  canvas.width = Math.round(toMm(sheet.width, sheet.unit) * factor); canvas.height = Math.round(toMm(sheet.height, sheet.unit) * factor)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  for (const p of pieces) {
    const d = designs.find(v => v.id === p.designId)!
    const cx = (p.x + p.width / 2) * factor, cy = (p.y + p.height / 2) * factor
    ctx.save(); ctx.translate(cx, cy)
    await drawComposition(ctx, d, { scale: factor, rotation: p.rotation })
    // Preview proof keeps the cut outline visible (this PNG is not the finished
    // product); red is a preview aid, never merged into print exports.
    ctx.beginPath(); piecePoints(p, d).forEach((pt, i) => { const X = (pt.x - (p.x + p.width / 2)) * factor, Y = (pt.y - (p.y + p.height / 2)) * factor; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y) }); ctx.closePath()
    ctx.strokeStyle = '#eb513f'; ctx.lineWidth = 1.25; ctx.stroke()
    for (const h of holesOf(d)) { ctx.beginPath(); holeSheetPolygon(h, p, d, 48).forEach((pt, i) => { const X = (pt.x - (p.x + p.width / 2)) * factor, Y = (pt.y - (p.y + p.height / 2)) * factor; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y) }); ctx.closePath(); ctx.stroke() }
    ctx.restore()
  }
  return new Uint8Array(await new Promise<ArrayBuffer>((resolve, reject) => canvas.toBlob(blob => blob ? void blob.arrayBuffer().then(resolve, reject) : reject(Error('Canvas PNG export failed')), 'image/png')))
}

export function csvTextBlob(text: string) { return new Blob([encoder.encode(text)], { type: 'text/csv;charset=utf-8' }) }

// Human-readable job report bundled with the production exports and shown
// before export. Plain text so it survives any downstream tooling.
export function buildReport(designs: Design[], layout: Layout, sheet: Sheet, options: ExportOptions = {}) {
  const usable = usableBounds(sheet)
  const used = polygonAreaSum(designs, layout)
  const placed = layout.sheets.reduce((n, s) => n + s.length, 0)
  const usedArea = layout.sheets.length * usable.area
  return [
    'CUTLINE JOB REPORT',
    '-------------------',
    `Job name:          ${options.jobName || '—'}`,
    `Material:          ${options.material || '—'}`,
    `Units:             mm (all exports in millimetres)`,
    '',
    `Sheet size:        ${toMm(sheet.width, sheet.unit).toFixed(2)} × ${toMm(sheet.height, sheet.unit).toFixed(2)} mm (input in ${sheet.unit})`,
    `Usable area:       ${usable.width.toFixed(2)} × ${usable.height.toFixed(2)} mm at x=${usable.x.toFixed(2)}, y=${usable.y.toFixed(2)}`,
    `Margins T/R/B/L:   ${sheet.marginTop} / ${sheet.marginRight} / ${sheet.marginBottom} / ${sheet.marginLeft} ${sheet.unit}`,
    `Min clearance:     ${sheet.clearance} ${sheet.unit}`,
    '',
    `Sheets used:       ${layout.sheets.length}`,
    `Pieces placed:     ${placed}`,
    `Pieces unplaced:   ${layout.unplaced.length}`,
    `Used area:         ${(used / 100).toFixed(2)} cm²`,
    `Usable area total: ${(usedArea / 100).toFixed(2)} cm²`,
    `Waste area:        ${((usedArea - used) / 100).toFixed(2)} cm²`,
    `Utilization:       ${(usedArea ? used / usedArea * 100 : 0).toFixed(1)}%`,
    '',
    `Warnings:          ${layout.unplaced.length ? `${layout.unplaced.length} part(s) could not be placed.` : 'none'}`,
  ].join('\n')
}

function polygonAreaSum(designs: Design[], layout: Layout) {
  let sum = 0
  for (const pieces of layout.sheets) for (const p of pieces) { const d = designs.find(v => v.id === p.designId); if (d) sum += polygonArea(piecePoints(p, d)) }
  return sum
}
