import { describe, expect, it } from 'vitest'
import { drawComposition } from './compose'
import type { Design } from './model'

describe('border rendering', () => {
  it('paints the border colour with a 2x-border stroke before clipping the art', async () => {
    const calls: string[] = []
    const ctx: any = new Proxy({}, { get: (_, k: string) => (k === 'fillStyle' || k === 'lineWidth' ? undefined : () => void calls.push(`${k}`)), set: (_, k: string, v) => { calls.push(`${k}=${v}`); return true } })
    const d: Design = { id: 'a', name: 'a', path: 'a', url: '', mime: 'image/png', imageWidth: 1, imageHeight: 1, width: 20, height: 20, quantity: 1, shape: 'rounded', radius: 3, rotation: 0, enabled: true, selected: false, borderMm: 2, borderColor: '#ff0000' }
    await drawComposition(ctx, d, { scale: 10, rotation: 0, image: null })
    expect(calls).toContain('strokeStyle=#ff0000')
    expect(calls).toContain('lineWidth=40')
    expect(calls).toContain('lineJoin=round')
    expect(calls.indexOf('stroke')).toBeLessThan(calls.indexOf('clip'))
  })
  it('draws nothing extra when border is 0', async () => {
    const calls: string[] = []
    const ctx: any = new Proxy({}, { get: (_, k: string) => () => void calls.push(`${k}`), set: () => true })
    await drawComposition(ctx, { id: 'a', name: 'a', path: 'a', url: '', mime: 'image/png', imageWidth: 1, imageHeight: 1, width: 20, height: 20, quantity: 1, shape: 'rectangle', radius: 0, rotation: 0, enabled: true, selected: false, borderMm: 0, borderColor: '#000000' }, { scale: 10, rotation: 0, image: null })
    expect(calls).not.toContain('stroke')
  })
})
