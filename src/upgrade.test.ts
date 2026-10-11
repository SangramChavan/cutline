import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildReport, buildSvg } from './export'
import { fitSize, marginsFromUsable, pack, packBest, pathPoints, polygonArea, toMm, usableBounds, validateUsableRect, type Design, type Sheet } from './model'

const sheet: Sheet = { width: 300, height: 200, unit: 'mm', marginTop: 5, marginRight: 5, marginBottom: 5, marginLeft: 5, clearance: 0 }
function design(overrides: Partial<Design> = {}): Design { return { id: 'a1', name: 'qr.png', path: 'batch/qr.png', url: 'data:image/png;base64,AAAA', mime: 'image/png', imageWidth: 300, imageHeight: 300, width: 40, height: 40, quantity: 1, shape: 'rectangle', radius: 0, rotation: 0, enabled: true, selected: false, ...overrides } }

describe('unit & geometry helpers', () => {
  it('converts imperial sheet sizes exactly (2 ft = 609.6 mm)', () => {
    expect(toMm(24, 'in')).toBeCloseTo(609.6, 6)
    expect(toMm(2, 'cm')).toBeCloseTo(20, 6)
    expect(toMm(300, 'mm')).toBe(300)
  })
  it('fits an imported artwork onto a 50 mm long edge preserving aspect ratio', () => {
    expect(fitSize(300, 150)).toEqual({ width: 50, height: 25 })
    expect(fitSize(100, 400)).toEqual({ width: 12.5, height: 50 })
    expect(fitSize(0, 0)).toEqual({ width: 50, height: 50 })
  })
  it('measures true contour area, not bounding box (circle ≈ πr²)', () => {
    const area = polygonArea(pathPoints(design({ shape: 'circle', width: 20, height: 20 })))
    expect(area).toBeCloseTo(Math.PI * 10 * 10, -1)
    expect(area).toBeLessThan(20 * 20)
  })
  it('maps the four margins to a usable rectangle and back', () => {
    const usable = usableBounds(sheet)
    expect(usable).toMatchObject({ x: 5, y: 5, width: 290, height: 190 })
    const custom = marginsFromUsable(sheet, { x: 10, y: 20, width: 100, height: 80 })
    expect(custom).toMatchObject({ marginLeft: 10, marginTop: 100, marginRight: 190, marginBottom: 20 })
    expect(usableBounds(custom)).toMatchObject({ x: 10, y: 20, width: 100, height: 80 })
  })
  it('rejects a usable rectangle outside the sheet', () => {
    expect(validateUsableRect(sheet, { x: 0, y: 0, width: 400, height: 100 })).toContain('sheet edge')
    expect(validateUsableRect(sheet, { x: 0, y: 0, width: 100, height: 100 })).toBeNull()
  })
})

describe('nesting upgrades', () => {
  it('honours non-90° rotations when the angle set allows them', async () => {
    const result = await pack([design({ width: 20, height: 20, quantity: 1 })], sheet, [45])
    expect(result.sheets.flat()[0]!.rotation).toBe(45)
  })
  it('packBest is deterministic and never worse than plain size-ordered pack', async () => {
    const designs = [design({ id: 's', width: 20, height: 20, quantity: 9 }), design({ id: 't', width: 45, height: 30, quantity: 4 })]
    const a = await packBest(designs, sheet), b = await packBest(designs, sheet)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    const plain = await pack(designs, sheet)
    expect(a.unplaced.length).toBeLessThanOrEqual(plain.unplaced.length)
  })
})

describe('export upgrades', () => {
  it('embeds provided data: hrefs so the SVG is self-contained', async () => {
    const designs = [design({ quantity: 1 })]
    const layout = await pack(designs, sheet)
    const [svg] = buildSvg(designs, layout, sheet, { hrefs: new Map([['a1', 'data:image/png;base64,ZZZ']]) })
    expect(svg).toContain('data:image/png;base64,ZZZ')
    expect(svg).not.toContain('base64,AAAA')
  })
  it('reports the job name, material and usable area', async () => {
    const designs = [design({ quantity: 1 })]
    const layout = await pack(designs, sheet)
    const report = buildReport(designs, layout, sheet, { jobName: 'Signage batch', material: '3 mm acrylic' })
    expect(report).toContain('Signage batch')
    expect(report).toContain('3 mm acrylic')
    expect(report).toContain('290.00 × 190.00 mm')
    expect(report).toContain('CUTLINE JOB REPORT')
  })
})

describe('privacy: no runtime network calls from app source', () => {
  it('contains no external URLs or network APIs', () => {
    const dir = fileURLToPath(new URL('.', import.meta.url))
    const files = readdirSync(dir).filter(f => /\.(ts|tsx|css)$/.test(f) && !f.endsWith('.test.ts'))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      // w3.org strings are SVG XML namespace identifiers, not requests.
      const text = readFileSync(`${dir}${file}`, 'utf8').replace(/https?:\/\/www\.w3\.org\/[^\s"')]+/g, '')
      expect(text, `${file} has an external URL`).not.toMatch(/https?:\/\//)
      expect(text, `${file} uses a network API`).not.toMatch(/XMLHttpRequest|new WebSocket|sendBeacon|fonts\.googleapis/)
    }
  })
})
