import { describe, expect, it } from 'vitest'
import type { Design, QrConfig } from './model'
import {
  QR_MARGIN_MM, applyBorderToTargets, sanitizeBorder, applyImageSettings, applyImageToTargets, applyQrSettings, applyQrToTargets,
  countImageOverrides, countQrOverrides, emptyImageSettings, emptyQrSettings,
  imageHasOverride, qrHasOverride, type GlobalImageSettings, type GlobalQrSettings,
} from './settings'

function design(over: Partial<Design> = {}): Design {
  return {
    id: 'a1', name: 'art.png', path: 'a.png', url: '', mime: 'image/png',
    imageWidth: 200, imageHeight: 100, width: 40, height: 20, quantity: 1,
    shape: 'rectangle', radius: 0, rotation: 0, enabled: true, selected: false, borderMm: 0, borderColor: '#000000', ...over,
  }
}

const qrBase: QrConfig = { enabled: true, source: 'generated', text: 'hello', ecLevel: 'M', sizeMm: 20, x: 3, y: 3, quietModules: 2, rotation: 0 }

describe('applyImageSettings', () => {
  it('leaves qr, holes and enabled untouched and returns a new object', () => {
    const d = design({ qr: qrBase, holes: [{ id: 'h', diameter: 5, x: 10, y: 10 }], enabled: false })
    const before = JSON.stringify(d)
    const out = applyImageSettings(d, { ...emptyImageSettings(), widthMm: 30 })
    expect(out).not.toBe(d)
    expect(out.qr).toEqual(qrBase)
    expect(out.holes).toEqual([{ id: 'h', diameter: 5, x: 10, y: 10 }])
    expect(out.enabled).toBe(false)
    expect(JSON.stringify(d)).toBe(before)
  })

  it('derives height from width and width from height using the image aspect', () => {
    const d = design({ width: 40, height: 20, imageWidth: 200, imageHeight: 100 })
    const byW = applyImageSettings(d, { ...emptyImageSettings(), widthMm: 50 })
    expect(byW.width).toBe(50)
    expect(byW.height).toBeCloseTo(25)
    const byH = applyImageSettings(d, { ...emptyImageSettings(), heightMm: 50 })
    expect(byH.height).toBe(50)
    expect(byH.width).toBeCloseTo(100)
    const both = applyImageSettings(d, { ...emptyImageSettings(), widthMm: 50, heightMm: 10 })
    expect(both.width).toBe(50)
    expect(both.height).toBeCloseTo(25)
  })

  it('clamps radius to min(w,h)/2 and ignores it for non-rounded shapes', () => {
    const d = design({ shape: 'rounded', width: 40, height: 20, radius: 2 })
    expect(applyImageSettings(d, { ...emptyImageSettings(), radiusMm: 100 }).radius).toBe(10)
    expect(applyImageSettings(d, { ...emptyImageSettings(), radiusMm: -5 }).radius).toBe(0)
    expect(applyImageSettings(design({ shape: 'rectangle', radius: 0 }), { ...emptyImageSettings(), radiusMm: 10 }).radius).toBe(0)
  })

  it('clamps quantity to an integer >= 1', () => {
    const d = design()
    expect(applyImageSettings(d, { ...emptyImageSettings(), quantity: 0 }).quantity).toBe(1)
    expect(applyImageSettings(d, { ...emptyImageSettings(), quantity: -3 }).quantity).toBe(1)
    expect(applyImageSettings(d, { ...emptyImageSettings(), quantity: 4.6 }).quantity).toBe(5)
  })

  it('holeDiameterMm replaces holes with one top-centred hole; null leaves them', () => {
    const d = design({ width: 40, height: 30, holes: [{ id: 'x', diameter: 3, x: 1, y: 1 }] })
    const withHole = applyImageSettings(d, { ...emptyImageSettings(), holeDiameterMm: 6 })
    expect(withHole.holes).toHaveLength(1)
    expect(withHole.holes![0]).toMatchObject({ id: 'global', diameter: 6 })
    expect(withHole.holes![0]!.x).toBeCloseTo(20)
    expect(withHole.holes![0]!.y).toBeCloseTo(7)
    const inset = applyImageSettings(design({ width: 40, height: 30 }), { ...emptyImageSettings(), holeDiameterMm: 100 })
    expect(inset.holes![0]!.y).toBeCloseTo(15)
    expect(applyImageSettings(d, { ...emptyImageSettings(), holeDiameterMm: null }).holes).toEqual([{ id: 'x', diameter: 3, x: 1, y: 1 }])
  })
})

describe('applyQrSettings', () => {
  it('preserves text when text is null and when enabled is false', () => {
    const d = design({ qr: qrBase })
    expect(applyQrSettings(d, { ...emptyQrSettings(), text: null }).qr!.text).toBe('hello')
    const off = applyQrSettings(d, { ...emptyQrSettings(), enabled: false })
    expect(off.qr!.enabled).toBe(false)
    expect(off.qr!.text).toBe('hello')
    expect(applyQrSettings(d, { ...emptyQrSettings(), text: 'bye' }).qr!.text).toBe('bye')
  })

  it('computes x/y from alignment and offsets with QR_MARGIN_MM', () => {
    const d = design({ width: 100, height: 60 })
    expect(QR_MARGIN_MM).toBe(3)
    const tl = applyQrSettings(d, { ...emptyQrSettings(), sizeMm: 20, alignX: 'left', alignY: 'top' })
    expect(tl.qr!.x).toBeCloseTo(3)
    expect(tl.qr!.y).toBeCloseTo(3)
    const cc = applyQrSettings(d, { ...emptyQrSettings(), sizeMm: 20, alignX: 'center', alignY: 'center' })
    expect(cc.qr!.x).toBeCloseTo(40)
    expect(cc.qr!.y).toBeCloseTo(20)
    const rb = applyQrSettings(d, { ...emptyQrSettings(), sizeMm: 20, alignX: 'right', alignY: 'bottom' })
    expect(rb.qr!.x).toBeCloseTo(77)
    expect(rb.qr!.y).toBeCloseTo(37)
    const off = applyQrSettings(d, { ...emptyQrSettings(), sizeMm: 20, alignX: 'center', alignY: 'center', offsetXMm: 5, offsetYMm: -2 })
    expect(off.qr!.x).toBeCloseTo(45)
    expect(off.qr!.y).toBeCloseTo(18)
  })

  it('clamps size to [8, min(w,h)] and keeps x/y in bounds', () => {
    const d = design({ width: 20, height: 40 })
    const q = applyQrSettings(d, { ...emptyQrSettings(), sizeMm: 100, alignX: 'right', alignY: 'top' }).qr!
    expect(q.sizeMm).toBe(20)
    expect(q.x).toBe(0)
    const small = applyQrSettings(d, { ...emptyQrSettings(), sizeMm: 2 }).qr!
    expect(small.sizeMm).toBe(8)
  })

  it('does not reposition x/y when no alignment or offset is given', () => {
    const d = design({ qr: { ...qrBase, x: 7, y: 9 } })
    const out = applyQrSettings(d, { ...emptyQrSettings(), ecLevel: 'H' })
    expect(out.qr!.x).toBe(7)
    expect(out.qr!.y).toBe(9)
    expect(out.qr!.ecLevel).toBe('H')
  })
})

describe('applyToTargets', () => {
  const ds = [design({ id: 'a' }), design({ id: 'b' })]

  it('image: null applies to all, a set applies only to members', () => {
    const all = applyImageToTargets(ds, null, { ...emptyImageSettings(), widthMm: 50 })
    expect(all.map(d => d.width)).toEqual([50, 50])
    const onlyA = applyImageToTargets(ds, new Set(['a']), { ...emptyImageSettings(), widthMm: 50 })
    expect(onlyA[0]!.width).toBe(50)
    expect(onlyA[1]!.width).toBe(40)
    expect(onlyA[1]).toBe(ds[1])
  })

  it('qr: null applies to all, a set applies only to members', () => {
    const g: GlobalQrSettings = { ...emptyQrSettings(), text: 'z' }
    const all = applyQrToTargets(ds, null, g)
    expect(all.every(d => d.qr!.text === 'z')).toBe(true)
    const onlyA = applyQrToTargets(ds, new Set(['a']), g)
    expect(onlyA[0]!.qr!.text).toBe('z')
    expect(onlyA[1]!.qr).toBeUndefined()
  })
})

describe('override detection', () => {
  it('image: equal designs are clean, modified ones are flagged, counts add up', () => {
    const g: GlobalImageSettings = { widthMm: 40, heightMm: 20, maintainAspect: true, shape: 'rounded', radiusMm: 5, rotationDeg: 0, quantity: 2, holeDiameterMm: null }
    const clean = design({ width: 40, height: 20, shape: 'rounded', radius: 5, quantity: 2 })
    expect(imageHasOverride(clean, g)).toBe(false)
    const modified = design({ width: 40, height: 20, shape: 'rectangle', radius: 0, quantity: 3 })
    expect(imageHasOverride(modified, g)).toBe(true)
    expect(countImageOverrides([clean, modified], g)).toBe(1)
    expect(countImageOverrides([clean], emptyImageSettings())).toBe(0)
  })

  it('qr: equal designs are clean, modified ones are flagged, counts add up', () => {
    const g: GlobalQrSettings = { ...emptyQrSettings(), enabled: true, text: 'x', ecLevel: 'M', sizeMm: 20, quietModules: 2, rotationDeg: 0 }
    const clean = design({ qr: { ...qrBase, text: 'x' } })
    expect(qrHasOverride(clean, g)).toBe(false)
    const modified = design({ qr: { ...qrBase, text: 'different' } })
    expect(qrHasOverride(modified, g)).toBe(true)
    expect(qrHasOverride(design(), g)).toBe(true)
    expect(countQrOverrides([clean, modified], g)).toBe(1)
    expect(countQrOverrides([design()], emptyQrSettings())).toBe(0)
  })
})

describe('border settings', () => {
  it('sanitizes missing / bad values from old saves', () => {
    expect(sanitizeBorder({})).toMatchObject({ borderMm: 0, borderColor: '#000000' })
    expect(sanitizeBorder({ borderMm: 999, borderColor: 'red' })).toMatchObject({ borderMm: 50, borderColor: '#000000' })
    expect(sanitizeBorder({ borderMm: -3, borderColor: '#AABBCC' })).toMatchObject({ borderMm: 0, borderColor: '#aabbcc' })
    expect(sanitizeBorder({ borderMm: NaN as number }).borderMm).toBe(0)
  })
  it('applies to selected only and clamps', () => {
    const out = applyBorderToTargets([design({ id: 'a' }), design({ id: 'b' })], new Set(['a']), 80, '#ff0000')
    expect(out[0]).toMatchObject({ borderMm: 50, borderColor: '#ff0000' })
    expect(out[1]!.borderMm).toBe(0)
  })
})
