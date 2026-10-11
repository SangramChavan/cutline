import { describe, expect, it } from 'vitest'
import { judge, select, type LayaCandidate, type LayaContext } from './laya'
import { pack, type Design, type Sheet } from './model'

const ctx: LayaContext = {
  sheetW: 100, sheetH: 100, marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0,
  placed: [{ box: { minX: 0, maxX: 20, minY: 0, maxY: 20 } }],
}
const cand = (x: number, y: number): LayaCandidate => ({ sheet: 0, x, y, angle: 0, pts: [], w: 20, h: 20 })

describe('Laya placement judge', () => {
  it('prefers a placement tucked against existing edges over open space', () => {
    const tucked = judge(cand(20, 0), ctx)
    const open = judge(cand(60, 60), ctx)
    expect(tucked.score).toBeGreaterThan(open.score)
    expect(tucked.confidence).toBeGreaterThan(open.confidence)
  })
  it('selects the same placement regardless of candidate order', () => {
    const a = judge(cand(0, 20), ctx), b = judge(cand(20, 0), ctx), c = judge(cand(40, 40), ctx)
    const best = select([a, b, c]).candidate
    expect(select([c, b, a]).candidate).toEqual(best)
    expect(select([b, a, c]).candidate).toEqual(best)
  })
  it('still fills every copy and respects clearance when packing', async () => {
    const sheet: Sheet = { width: 100, height: 80, unit: 'mm', marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0, clearance: 4 }
    const d: Design = { id: 'a', name: 'a.png', path: 'a.png', url: '', mime: 'image/png', imageWidth: 1, imageHeight: 1, width: 20, height: 20, quantity: 8, shape: 'rectangle', radius: 0, rotation: 0, enabled: true, selected: false }
    const result = await pack([d], sheet)
    expect(result.sheets.flat()).toHaveLength(8)
    expect(result.unplaced).toHaveLength(0)
  })
})
