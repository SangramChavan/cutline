import { describe, expect, it } from 'vitest'
import { buildDxf, buildManifest, buildSvg, cutContours } from './export'
import { clampBorder, cutPoints, holeClearance, holeError, holePreset, normalizeBorderColor, outerSize, pack, piecePoints, polygonArea, polygonsOverlap, usableBounds, type Design, type Sheet } from './model'
import { summarize } from './production'

const sheet: Sheet = { width: 200, height: 150, unit: 'mm', marginTop: 5, marginRight: 5, marginBottom: 5, marginLeft: 5, clearance: 1 }
const design = (o: Partial<Design> = {}): Design => ({ id: 'a', name: 'a.png', path: 'a.png', url: '', mime: 'image/png', imageWidth: 1, imageHeight: 1, width: 30, height: 30, quantity: 40, shape: 'rectangle', radius: 0, rotation: 0, enabled: true, selected: false, borderMm: 0, borderColor: '#000000', ...o })
const bbox = (pts: { x: number; y: number }[]) => ({ w: Math.max(...pts.map(p => p.x)) - Math.min(...pts.map(p => p.x)), h: Math.max(...pts.map(p => p.y)) - Math.min(...pts.map(p => p.y)) })

describe('border geometry', () => {
  it('clamps and defaults', () => {
    expect([clampBorder(NaN), clampBorder(-3), clampBorder(99), clampBorder(4)]).toEqual([0, 0, 50, 4])
    expect(normalizeBorderColor('zz')).toBe('#000000')
    expect(normalizeBorderColor('#FF0000')).toBe('#ff0000')
    expect(outerSize({ width: 30, height: 20, borderMm: 3 })).toEqual({ w: 36, h: 26, offset: 3 })
  })
  it('pieces per sheet falls as the border grows; no overlaps, all inside', async () => {
    const counts: number[] = []
    for (const b of [0, 2, 6]) {
      const designs = [design({ borderMm: b })]
      const layout = await pack(designs, sheet)
      const placed = layout.sheets[0]!
      counts.push(placed.length)
      const u = usableBounds(sheet)
      const polys = placed.map(p => piecePoints(p, designs[0]!))
      for (const pts of polys) for (const q of pts) { expect(q.x).toBeGreaterThanOrEqual(u.x - 1e-6); expect(q.x).toBeLessThanOrEqual(u.x + u.width + 1e-6); expect(q.y).toBeGreaterThanOrEqual(u.y - 1e-6); expect(q.y).toBeLessThanOrEqual(u.y + u.height + 1e-6) }
      for (let i = 0; i < polys.length; i++) for (let j = i + 1; j < polys.length; j++) expect(polygonsOverlap(polys[i]!, polys[j]!, 1 - 1e-6)).toBe(false)
    }
    expect(counts[0]!).toBeGreaterThan(counts[1]!)
    expect(counts[1]!).toBeGreaterThan(counts[2]!)
  })
  it('cut path equals the outer shape (rect, rounded, circle, polygon)', () => {
    const b = 4
    const r = bbox(cutPoints(design({ borderMm: b })))
    expect([r.w, r.h]).toEqual([38, 38])
    const circle = design({ shape: 'circle', borderMm: b })
    expect(polygonArea(piecePoints({ x: 0, y: 0, rotation: 0, width: 38, height: 38 }, circle))).toBeCloseTo(Math.PI * 19 * 19, -2)
    const rounded = design({ shape: 'rounded', radius: 5, borderMm: b })
    expect(bbox(cutPoints(rounded))).toEqual({ w: 38, h: 38 })
    const poly = design({ shape: 'polygon', points: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }, { x: 0, y: 30 }], borderMm: b })
    const pb = bbox(cutPoints(poly))
    expect(pb.w).toBeCloseTo(38, 6); expect(pb.h).toBeCloseTo(38, 6)
  })
  it('holes shift into outer coordinates and are checked against the outer edge', () => {
    const d = design({ borderMm: 5 })
    // artwork-local (-3,15) is 2 mm from the outer left edge
    expect(holeClearance({ id: 'h', diameter: 2, x: -3, y: 15 }, d)).toBeCloseTo(1, 6)
    expect(holeError({ id: 'h', diameter: 2, x: -3, y: 15 }, d, 1)).toBeNull()
    expect(holeError({ id: 'h', diameter: 2, x: -4.5, y: 15 }, d, 1)).not.toBeNull()
    for (const key of ['top-centre', 'top-left', 'top-right', 'two-top'] as const)
      for (const h of holePreset(key, d, 4)) expect(holeError(h, d, 1)).toBeNull()
  })
  it('manifest, DXF, estimates use the outer size; border 0 unchanged', async () => {
    const d = design({ borderMm: 3, quantity: 2 })
    const layout = await pack([d], sheet)
    expect(buildManifest([d], layout)).toContain('"36.0000","36.0000"')
    const contour = cutContours([d], layout)[0]!
    expect(bbox(contour.points)).toEqual({ w: 36, h: 36 })
    expect(buildDxf([d], layout, sheet)[0]).toContain('LWPOLYLINE')
    const s = summarize([d], layout, sheet)
    expect(s.cutLengthMm).toBeCloseTo(2 * 144, 6)
    const d0 = design({ quantity: 2 })
    expect(cutPoints(d0)).toEqual(cutPoints({ ...d0, borderMm: undefined } as unknown as Design))
    expect(bbox(cutPoints(d0))).toEqual({ w: 30, h: 30 })
  })
})

describe('centred border alignment', () => {
  it('grows the piece by half the border per side', () => {
    expect(outerSize({ width: 30, height: 20, borderMm: 4, borderAlign: 'center' })).toEqual({ w: 34, h: 24, offset: 2 })
    expect(outerSize({ width: 30, height: 20, borderMm: 4, borderAlign: 'outside' })).toEqual({ w: 38, h: 28, offset: 4 })
  })
  it('cut contour follows the half-grown outline and rounded radius grows by half', () => {
    const d = design({ borderMm: 4, borderAlign: 'center', shape: 'rounded', radius: 6 })
    expect(bbox(cutPoints(d))).toEqual({ w: 34, h: 34 })
  })
  it('fits more pieces than an outside border of the same thickness', async () => {
    const n = async (a: 'outside' | 'center') => (await pack([design({ borderMm: 6, borderAlign: a })], sheet, [0, 90])).sheets[0]!.length
    expect(await n('center')).toBeGreaterThan(await n('outside'))
  })
})

describe('mirrored outline svg', () => {
  it('wraps both layers in a left-right flip about the sheet width and is unchanged otherwise', () => {
    const layout = { sheets: [[{ id: 'a-1', designId: 'a', copy: 1, x: 10, y: 10, width: 30, height: 30, rotation: 0, sheet: 0, path: '' }]], unplaced: [], utilization: [0.1] }
    const normal = buildSvg([design()], layout, sheet)[0]!, flipped = buildSvg([design()], layout, sheet, { mirror: true })[0]!
    expect(normal).not.toContain('scale(-1 1)')
    expect(flipped).toContain('transform="translate(200 0) scale(-1 1)"')
    expect(flipped.indexOf('id="print-artwork"')).toBeGreaterThan(flipped.indexOf('scale(-1 1)'))
    expect(flipped.indexOf('id="cut"')).toBeGreaterThan(flipped.indexOf('scale(-1 1)'))
  })
})
