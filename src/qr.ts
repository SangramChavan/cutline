import qrcode from 'qrcode-generator'
import type { EcLevel } from './model'

export interface QrMatrix {
  size: number
  get(x: number, y: number): boolean
}

// Encode text into a QR module matrix entirely in the browser. No network.
export function qrMatrix(text: string, ec: EcLevel = 'M'): QrMatrix {
  const qr = qrcode(0, ec)
  qr.addData(text)
  qr.make()
  const n = qr.getModuleCount()
  return { size: n, get: (x, y) => x >= 0 && y >= 0 && x < n && y < n && qr.isDark(y, x) }
}

// QR rectangles at the origin, sizeMm square, quiet zone included. Caller wraps
// in a translate/rotate group.
export function qrSvgInner(matrix: QrMatrix, sizeMm: number, quietModules: number, dark: string, light: string, background: boolean): string {
  const total = matrix.size + quietModules * 2
  const cell = sizeMm / total
  const f = (n: number) => n.toFixed(4)
  let rects = ''
  for (let row = 0; row < matrix.size; row++) for (let col = 0; col < matrix.size; col++) if (matrix.get(col, row)) rects += `<rect x="${f((col + quietModules) * cell)}" y="${f((row + quietModules) * cell)}" width="${f(cell)}" height="${f(cell)}"/>`
  const bg = background ? `<rect x="0" y="0" width="${f(sizeMm)}" height="${f(sizeMm)}" fill="${light}"/>` : ''
  return `${bg}<g fill="${dark}">${rects}</g>`
}

// Human-readable scale/contrast warnings. These are guidance, not proof of
// scannability — a physical test scan is still required.
export function qrWarnings(sizeMm: number, matrix: QrMatrix, quietModules: number, dark = '#000000', light = '#ffffff'): string[] {
  const out: string[] = []
  if (!(sizeMm > 0)) out.push('QR size must be greater than zero.')
  const total = matrix.size + quietModules * 2
  const moduleMm = sizeMm / total
  if (sizeMm < 12) out.push(`QR is ${sizeMm.toFixed(1)} mm — small for reliable scanning on acrylic (aim for ≥ 12 mm).`)
  if (moduleMm < 0.4) out.push(`Each QR module is only ${moduleMm.toFixed(2)} mm; printing may merge modules.`)
  if (quietModules < 4) out.push('QR quiet zone is below the 4-module minimum; clear space may be insufficient.')
  const lum = (hex: string) => {
    const v = /^#?([0-9a-f]{6})$/i.exec(hex.trim())?.[1] ?? '000000'
    const lin = (i: number) => { const x = parseInt(v.slice(i, i + 2), 16) / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }
    return 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4)
  }
  const contrast = (Math.max(lum(dark), lum(light)) + 0.05) / (Math.min(lum(dark), lum(light)) + 0.05)
  if (lum(dark) > lum(light)) out.push('QR foreground is lighter than its background; scanners expect dark modules on a light field.')
  if (lum(dark) > 0.6) out.push(`QR contrast ratio is about ${contrast.toFixed(1)}:1 — use darker modules and a lighter background.`)
  return out
}

// Vector QR for the SVG print layer: one <rect> per dark module inside a light
// quiet-zone box. Stays crisp at any print size.
export function qrSvg(matrix: QrMatrix, opts: { x: number; y: number; sizeMm: number; quietModules: number; dark: string; light: string; rotation: number; background: boolean }): string {
  const { x, y, sizeMm, quietModules, dark, light, rotation, background } = opts
  const f = (n: number) => n.toFixed(4)
  const transform = `translate(${f(x)} ${f(y)})` + (rotation ? ` rotate(${f(rotation)} ${f(sizeMm / 2)} ${f(sizeMm / 2)})` : '')
  return `<g transform="${transform}">${qrSvgInner(matrix, sizeMm, quietModules, dark, light, background)}</g>`
}
