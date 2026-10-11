import { PDFDocument, rgb } from 'pdf-lib'
import { pathPoints, piecePoints, pointsToPath, polygonArea, toMm, usableBounds, type Design, type Layout, type Piece, type Sheet } from './model'

const encoder = new TextEncoder()
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)
const mm = (n: number) => `${n.toFixed(4)}mm`
const PT_PER_MM = 72 / 25.4

export interface ExportOptions {
  border?: boolean
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

function dataHref(design: Design) {
  return design.url
}

async function bytesOf(design: Design) {
  return fetch(dataHref(design)).then(r => r.arrayBuffer())
}

export async function buildPdf(designs: Design[], layout: Layout, sheet: Sheet, options: ExportOptions = {}) {
  const { border = false, cut = true, cutColor = '#e11d48', cutWidthMm = 0.25, dpi = 300, marks = false, scaleMark = true, jobName, material } = options
  const pageW = toMm(sheet.width, sheet.unit) * PT_PER_MM, pageH = toMm(sheet.height, sheet.unit) * PT_PER_MM
  const pdf = await PDFDocument.create()
  pdf.setTitle(jobName ? `${jobName} — Cutline print sheets` : 'Cutline print sheets')
  pdf.setProducer('Cutline — local-first production studio')
  if (jobName || material) pdf.setSubject([jobName, material].filter(Boolean).join(' · '))
  const embeddedCache = new Map<string, Awaited<ReturnType<typeof pdf.embedPng>>>()
  const embed = async (design: Design) => {
    const cached = embeddedCache.get(design.id)
    if (cached) return cached
    const bytes = await bytesOf(design)
    const image = design.mime === 'image/jpeg' ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes)
    embeddedCache.set(design.id, image)
    return image
  }
  for (const pieces of layout.sheets) {
    const page = pdf.addPage([pageW, pageH])
    for (const p of pieces) {
      const d = designs.find(v => v.id === p.designId)!
      const x = p.x * PT_PER_MM, y = pageH - (p.y + p.height) * PT_PER_MM, w = p.width * PT_PER_MM, h = p.height * PT_PER_MM
      const direct = (d.shape === 'rectangle' || d.shape === 'square') && p.rotation % 360 === 0
      if (direct && (d.mime === 'image/png' || d.mime === 'image/jpeg')) {
        page.drawImage(await embed(d), { x, y, width: w, height: h })
      } else if (d.mime === 'image/png' || d.mime === 'image/jpeg' || d.mime === 'image/webp' || d.mime === 'image/svg+xml') {
        const raster = await rasterizeArtwork(d, p, dpi)
        page.drawImage(await pdf.embedPng(raster), { x, y, width: w, height: h })
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
      page.drawText('verify 1:1 →', { x: bx, y: by + 2 * PT_PER_MM, size: 5, color: rgb(.35, .38, .4) })
      page.drawLine({ start: { x: bx, y: by }, end: { x: bx + bar, y: by }, thickness: .6, color: rgb(0, 0, 0) })
      page.drawLine({ start: { x: bx, y: by - 1.5 * PT_PER_MM }, end: { x: bx, y: by + 1.5 * PT_PER_MM }, thickness: .6, color: rgb(0, 0, 0) })
      page.drawLine({ start: { x: bx + bar, y: by - 1.5 * PT_PER_MM }, end: { x: bx + bar, y: by + 1.5 * PT_PER_MM }, thickness: .6, color: rgb(0, 0, 0) })
      page.drawText('100 mm', { x: bx + bar + 1.5 * PT_PER_MM, y: by - .5 * PT_PER_MM, size: 5, color: rgb(.35, .38, .4) })
    }
  }
  return new Uint8Array(await pdf.save())
}

// Rasterize one placed copy at the target print DPI, clipped to its true rotated
// contour so the printed artwork and the cut line share the same geometry.
async function rasterizeArtwork(d: Design, piece: Pick<Piece, 'width' | 'height' | 'rotation'>, dpi: number, maxDim = 6000) {
  const pmm = dpi / 25.4
  let pw = Math.max(1, Math.round(piece.width * pmm)), ph = Math.max(1, Math.round(piece.height * pmm))
  const shrink = Math.max(pw / maxDim, ph / maxDim, 1)
  pw = Math.max(1, Math.round(pw / shrink)); ph = Math.max(1, Math.round(ph / shrink))
  const scale = pw / piece.width
  const canvas = document.createElement('canvas')
  canvas.width = pw; canvas.height = ph
  const context = canvas.getContext('2d')!
  context.clearRect(0, 0, pw, ph)
  context.save()
  context.translate(pw / 2, ph / 2)
  context.rotate(piece.rotation * Math.PI / 180)
  const points = pathPoints(d)
  context.beginPath()
  points.forEach((pt, i) => {
    const X = (pt.x - d.width / 2) * scale, Y = (pt.y - d.height / 2) * scale
    i ? context.lineTo(X, Y) : context.moveTo(X, Y)
  })
  context.closePath()
  context.clip()
  const image = await loadImage(d.url)
  const fit = Math.min(d.width * scale / image.naturalWidth, d.height * scale / image.naturalHeight)
  const iw = image.naturalWidth * fit, ih = image.naturalHeight * fit
  context.drawImage(image, -iw / 2, -ih / 2, iw, ih)
  context.restore()
  return new Promise<ArrayBuffer>((resolve, reject) => canvas.toBlob(blob => blob ? void blob.arrayBuffer().then(resolve, reject) : reject(Error('Artwork rasterization failed')), 'image/png'))
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(Error('Artwork could not be decoded'))
    image.src = url
  })
}

export function buildSvg(designs: Design[], layout: Layout, sheet: Sheet, options: ExportOptions = {}) {
  const { marks = false, cutColor = '#ff0000', cutWidthMm = 0.01, hrefs } = options
  const widthMm = toMm(sheet.width, sheet.unit), heightMm = toMm(sheet.height, sheet.unit)
  return layout.sheets.map((pieces, i) => {
    const artwork = pieces.map(p => {
      const d = designs.find(v => v.id === p.designId)!
      const clip = `clip-${p.id.replace(/[^\w-]/g, '-')}`
      const path = piecePath(p, d)
      // d.url is a session blob: URL, dead once the tab closes. Embed the real
      // bytes (data: URL) so the exported SVG is self-contained and reusable.
      const href = hrefs?.get(d.id) ?? d.url
      return `<defs><clipPath id="${clip}"><path d="${esc(path)}"/></clipPath></defs><g clip-path="url(#${clip})"><image href="${esc(href)}" x="${p.x.toFixed(4)}" y="${p.y.toFixed(4)}" width="${p.width.toFixed(4)}" height="${p.height.toFixed(4)}" preserveAspectRatio="xMidYMid meet"/></g>${marks ? `<text x="${p.x}" y="${p.y + 3}" font-size="2">${esc(p.id)}</text>` : ''}`
    }).join('\n')
    const cuts = pieces.map(p => { const d = designs.find(v => v.id === p.designId)!; return `<path d="${esc(piecePath(p, d))}"/>` }).join('\n')
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${mm(widthMm)}" height="${mm(heightMm)}" viewBox="0 0 ${widthMm} ${heightMm}"><title>Cutline sheet ${i + 1}</title><g id="print-artwork">${artwork}</g><g id="cut" fill="none" stroke="${cutColor}" stroke-width="${cutWidthMm}">${cuts}</g></svg>`
  })
}

// Minimal ASCII DXF (AC1015 / LWPOLYLINE) of the cut layer, one closed polyline per copy, in mm.
export function buildDxf(designs: Design[], layout: Layout, sheet: Sheet) {
  const heightMm = toMm(sheet.height, sheet.unit)
  const lines = (xs: (string | number)[]) => xs.join('\r\n') + '\r\n'
  return layout.sheets.map(pieces => {
    const entities = pieces.map(p => {
      const d = designs.find(v => v.id === p.designId)!
      const pts = piecePoints(p, d)
      const verts = pts.map(pt => lines([10, pt.x.toFixed(4), 20, (heightMm - pt.y).toFixed(4)])).join('')
      return lines([0, 'LWPOLYLINE', 8, 'CUT', 100, 'AcDbEntity', 100, 'AcDbPolyline', 90, pts.length, 70, 1]) + verts
    }).join('')
    return lines([0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1015', 9, '$INSUNITS', 70, 4, 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES']) + entities + lines([0, 'ENDSEC', 0, 'EOF'])
  })
}

export function buildManifest(designs: Design[], layout: Layout) {
  const rows = [['filename', 'design_id', 'copy_number', 'shape', 'width_mm', 'height_mm', 'sheet_number', 'x_mm', 'y_mm', 'rotation_deg', 'placement_status']]
  for (const pieces of layout.sheets) for (const p of pieces) { const d = designs.find(v => v.id === p.designId)!; rows.push([d.path, d.id, String(p.copy), d.shape, d.width.toFixed(4), d.height.toFixed(4), String(p.sheet + 1), p.x.toFixed(4), p.y.toFixed(4), String(p.rotation), 'placed']) }
  for (const p of layout.unplaced) { const d = designs.find(v => v.id === p.designId)!; rows.push([d.path, d.id, String(p.copy), d.shape, d.width.toFixed(4), d.height.toFixed(4), '', '', '', '', 'unplaced']) }
  return rows.map(row => row.map(v => `"${v.replace(/"/g, '""')}"`).join(',')).join('\r\n')
}

export async function makePng(designs: Design[], pieces: Piece[], sheet: Sheet) {
  const factor = 3, canvas = document.createElement('canvas')
  canvas.width = Math.round(toMm(sheet.width, sheet.unit) * factor); canvas.height = Math.round(toMm(sheet.height, sheet.unit) * factor)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  for (const p of pieces) {
    const d = designs.find(v => v.id === p.designId)!
    const image = await loadImage(d.url)
    ctx.save(); ctx.translate((p.x + p.width / 2) * factor, (p.y + p.height / 2) * factor); ctx.rotate(p.rotation * Math.PI / 180)
    ctx.beginPath(); piecePoints(p, d).forEach((pt, i) => { const X = (pt.x - p.x) * factor, Y = (pt.y - p.y) * factor; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y) }); ctx.closePath(); ctx.clip()
    const fit = Math.min(p.width * factor / image.naturalWidth, p.height * factor / image.naturalHeight)
    ctx.drawImage(image, -p.width * factor / 2, -p.height * factor / 2, image.naturalWidth * fit, image.naturalHeight * fit)
    ctx.strokeStyle = '#eb513f'; ctx.lineWidth = 1.25; ctx.stroke(); ctx.restore()
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
