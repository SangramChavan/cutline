import { describe, expect, it } from 'vitest'
import { decidePlacement, geoTarget, type PredictionAgent } from './layaBridge'
import { type LayaCandidate, type LayaContext } from './laya'

const ctx: LayaContext = {
  sheetW: 100, sheetH: 100, marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0,
  placed: [{ box: { minX: 0, maxX: 20, minY: 0, maxY: 20 } }],
}
const cand = (x: number, y: number): LayaCandidate => ({ sheet: 0, x, y, angle: 0, pts: [], w: 20, h: 20 })
const fake = (choice: string, confidence: number): PredictionAgent => ({ predict: async () => ({ answers: { placement: { choice, confidence } } }) })

describe('Laya model bridge', () => {
  it('returns the model choice when it is one of the candidates and confident', async () => {
    const c0 = cand(60, 60), c1 = cand(20, 0)
    const out = await decidePlacement([c0, c1], ctx, { agent: fake('p1', 0.92) })
    expect(out.source).toBe('laya')
    expect(out.candidate).toBe(c1)
    expect(out.confidence).toBe(0.92)
  })
  it('falls back to the geometric target when confidence is too low', async () => {
    const c0 = cand(60, 60), c1 = cand(20, 0)
    const out = await decidePlacement([c0, c1], ctx, { agent: fake('p1', 0.1) })
    expect(out.source).toBe('geo')
    expect(out.candidate).toEqual(geoTarget([c0, c1], ctx))
  })
  it('falls back to geometry when the model picks an unknown key or errors', async () => {
    const c0 = cand(60, 60), c1 = cand(20, 0)
    const picked = await decidePlacement([c0, c1], ctx, { agent: fake('p99', 0.9) })
    const errored = await decidePlacement([c0, c1], ctx, { agent: { predict: async () => { throw new Error('boom') } } })
    expect(picked.source).toBe('geo')
    expect(errored.source).toBe('geo')
    expect(errored.candidate).toEqual(geoTarget([c0, c1], ctx))
  })
  it('serves the only candidate without ever calling the model', async () => {
    const c0 = cand(20, 0)
    let called = false
    const out = await decidePlacement([c0], ctx, { agent: { predict: async () => { called = true; return { answers: { placement: { choice: 'p0', confidence: 0.9 } } } } } })
    expect(called).toBe(false)
    expect(out.candidate).toBe(c0)
    expect(out.source).toBe('geo')
  })
})