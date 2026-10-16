import type { Design, EcLevel, QrConfig, Shape } from './model'

// Bulk "global" settings applied across a batch. A null means "leave this field
// as the design already has it"; only non-null fields are written through.
export interface GlobalImageSettings {
  widthMm: number | null
  heightMm: number | null
  maintainAspect: boolean
  shape: Shape | null
  radiusMm: number | null
  rotationDeg: number | null
  quantity: number | null
  holeDiameterMm: number | null
}

export interface GlobalQrSettings {
  enabled: boolean | null
  text: string | null
  ecLevel: EcLevel | null
  sizeMm: number | null
  quietModules: number | null
  rotationDeg: number | null
  alignX: 'left' | 'center' | 'right' | null
  alignY: 'top' | 'center' | 'bottom' | null
  offsetXMm: number
  offsetYMm: number
}

// Default edge margin (mm) used when aligning a QR to a piece edge.
export const QR_MARGIN_MM = 3

const DEFAULT_QR: QrConfig = { enabled: true, source: 'generated', text: '', ecLevel: 'M', sizeMm: 25, x: 3, y: 3, quietModules: 2, rotation: 0, dark: '#111111', light: '#ffffff' }

export const emptyImageSettings = (): GlobalImageSettings => ({
  widthMm: null, heightMm: null, maintainAspect: true, shape: null, radiusMm: null, rotationDeg: null, quantity: null, holeDiameterMm: null,
})

export const emptyQrSettings = (): GlobalQrSettings => ({
  enabled: null, text: null, ecLevel: null, sizeMm: null, quietModules: null, rotationDeg: null, alignX: null, alignY: null, offsetXMm: 0, offsetYMm: 0,
})

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)
const TOL = 0.5
const near = (a: number, b: number) => Math.abs(a - b) < TOL

export const MAX_BORDER_MM = 50
export const sanitizeBorderMm = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? clamp(n, 0, MAX_BORDER_MM) : 0 }
export const sanitizeBorderColor = (v: unknown): string => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : '#000000')
// Fill defaults / clamp the border fields of a design loaded from an older save.
export const sanitizeBorder = <T extends Partial<Pick<Design, 'borderMm' | 'borderColor'>>>(d: T): T & Pick<Design, 'borderMm' | 'borderColor'> => ({ ...d, borderMm: sanitizeBorderMm(d.borderMm), borderColor: sanitizeBorderColor(d.borderColor) })

// Border-only apply (the border panel's own "Apply to selected / all").
export function applyBorderToTargets(designs: Design[], ids: Set<string> | null, mm: number, color: string, align: 'outside' | 'center' = 'outside'): Design[] {
  const borderMm = sanitizeBorderMm(mm), borderColor = sanitizeBorderColor(color), borderAlign = align === 'center' ? 'center' : 'outside'
  return designs.map(d => (ids === null || ids.has(d.id)) ? { ...d, borderMm, borderColor, borderAlign } : d)
}

export function applyImageSettings(d: Design, g: GlobalImageSettings): Design {
  const out: Design = { ...d }

  const hasW = g.widthMm !== null
  const hasH = g.heightMm !== null
  if (g.maintainAspect) {
    if (hasW) {
      out.width = g.widthMm!
      out.height = d.imageWidth > 0 ? g.widthMm! * d.imageHeight / d.imageWidth : d.height
    } else if (hasH) {
      out.height = g.heightMm!
      out.width = d.imageHeight > 0 ? g.heightMm! * d.imageWidth / d.imageHeight : d.width
    }
  } else {
    if (hasW) out.width = g.widthMm!
    if (hasH) out.height = g.heightMm!
  }

  if (g.shape !== null) out.shape = g.shape
  if (g.radiusMm !== null && out.shape === 'rounded') {
    out.radius = clamp(g.radiusMm, 0, Math.min(out.width, out.height) / 2)
  }
  if (g.quantity !== null) out.quantity = Math.max(1, Math.round(g.quantity))
  if (g.rotationDeg !== null) out.rotation = g.rotationDeg

  if (g.holeDiameterMm !== null && g.holeDiameterMm > 0) {
    out.holes = [{ id: 'global', diameter: g.holeDiameterMm, x: out.width / 2, y: Math.min(g.holeDiameterMm / 2 + 4, out.height / 2) }]
  }

  return out
}

export function applyQrSettings(d: Design, g: GlobalQrSettings): Design {
  const base: QrConfig = d.qr ? { ...d.qr } : { ...DEFAULT_QR }

  if (g.enabled !== null) base.enabled = g.enabled
  if (g.text !== null) base.text = g.text
  if (g.ecLevel !== null) base.ecLevel = g.ecLevel
  if (g.quietModules !== null) base.quietModules = g.quietModules
  if (g.rotationDeg !== null) base.rotation = g.rotationDeg
  if (g.sizeMm !== null) base.sizeMm = clamp(g.sizeMm, 8, Math.max(8, Math.min(d.width, d.height)))

  const applyPos = g.alignX !== null || g.alignY !== null || g.offsetXMm !== 0 || g.offsetYMm !== 0
  if (applyPos) {
    const size = base.sizeMm
    const startX = g.alignX === 'left' ? QR_MARGIN_MM
      : g.alignX === 'right' ? d.width - size - QR_MARGIN_MM
      : g.alignX === 'center' ? (d.width - size) / 2
      : base.x
    const startY = g.alignY === 'top' ? QR_MARGIN_MM
      : g.alignY === 'bottom' ? d.height - size - QR_MARGIN_MM
      : g.alignY === 'center' ? (d.height - size) / 2
      : base.y
    base.x = clamp(startX + g.offsetXMm, 0, Math.max(0, d.width - size))
    base.y = clamp(startY + g.offsetYMm, 0, Math.max(0, d.height - size))
  }

  return { ...d, qr: base }
}

export function applyImageToTargets(designs: Design[], ids: Set<string> | null, g: GlobalImageSettings): Design[] {
  return designs.map(d => (ids === null || ids.has(d.id)) ? applyImageSettings(d, g) : d)
}

export function applyQrToTargets(designs: Design[], ids: Set<string> | null, g: GlobalQrSettings): Design[] {
  return designs.map(d => (ids === null || ids.has(d.id)) ? applyQrSettings(d, g) : d)
}

export function imageHasOverride(d: Design, g: GlobalImageSettings): boolean {
  const t = applyImageSettings(d, g)
  if ((g.widthMm !== null || g.heightMm !== null) && (!near(d.width, t.width) || !near(d.height, t.height))) return true
  if (g.shape !== null && d.shape !== t.shape) return true
  if (g.radiusMm !== null && !near(d.radius, t.radius)) return true
  if (g.rotationDeg !== null && !near(d.rotation, t.rotation)) return true
  if (g.quantity !== null && d.quantity !== t.quantity) return true
  if (g.holeDiameterMm !== null && g.holeDiameterMm > 0) {
    const cur = d.holes ?? [], ref = t.holes ?? []
    if (cur.length !== ref.length || !ref.length) return true
    if (!near(cur[0]!.diameter, ref[0]!.diameter) || !near(cur[0]!.x, ref[0]!.x) || !near(cur[0]!.y, ref[0]!.y)) return true
  }
  return false
}

export function qrHasOverride(d: Design, g: GlobalQrSettings): boolean {
  const specifies = g.enabled !== null || g.text !== null || g.ecLevel !== null || g.sizeMm !== null
    || g.quietModules !== null || g.rotationDeg !== null || g.alignX !== null || g.alignY !== null
    || g.offsetXMm !== 0 || g.offsetYMm !== 0
  if (!specifies) return false
  if (!d.qr) return true

  const t = applyQrSettings(d, g).qr!
  if (g.enabled !== null && d.qr.enabled !== t.enabled) return true
  if (g.text !== null && d.qr.text !== t.text) return true
  if (g.ecLevel !== null && d.qr.ecLevel !== t.ecLevel) return true
  if (g.sizeMm !== null && !near(d.qr.sizeMm, t.sizeMm)) return true
  if (g.quietModules !== null && d.qr.quietModules !== t.quietModules) return true
  if (g.rotationDeg !== null && !near(d.qr.rotation, t.rotation)) return true

  const pos = g.alignX !== null || g.alignY !== null || g.offsetXMm !== 0 || g.offsetYMm !== 0
  if (pos && (!near(d.qr.x, t.x) || !near(d.qr.y, t.y))) return true
  return false
}

export const countImageOverrides = (designs: Design[], g: GlobalImageSettings): number => designs.filter(d => imageHasOverride(d, g)).length
export const countQrOverrides = (designs: Design[], g: GlobalQrSettings): number => designs.filter(d => qrHasOverride(d, g)).length
