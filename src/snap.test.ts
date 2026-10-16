import { describe, expect, it } from 'vitest'
import { snapPosition } from './model'

const bounds = { minX: 5, minY: 5, maxX: 205, maxY: 105 }
const nb = { x: 50, y: 20, width: 40, height: 30 }

describe('snapPosition', () => {
  it('snaps to the usable-area edges within the threshold', () => {
    expect(snapPosition({ x: 7, y: 6, width: 20, height: 20 }, [], bounds, 0, 3)).toEqual({ x: 5, y: 5 })
    expect(snapPosition({ x: 183, y: 84, width: 20, height: 20 }, [], bounds, 0, 3)).toEqual({ x: 185, y: 85 })
  })
  it('leaves the position alone beyond the threshold', () => {
    expect(snapPosition({ x: 20, y: 40, width: 20, height: 20 }, [], bounds, 0, 3)).toEqual({ x: 20, y: 40 })
  })
  it('snaps flush to a neighbour, offset by clearance', () => {
    expect(snapPosition({ x: 92, y: 22, width: 20, height: 20 }, [nb], bounds, 0, 3)).toEqual({ x: 90, y: 20 })
    expect(snapPosition({ x: 92, y: 22, width: 20, height: 20 }, [nb], bounds, 2, 3)).toEqual({ x: 92, y: 20 })
    expect(snapPosition({ x: 28, y: 22, width: 20, height: 20 }, [nb], bounds, 2, 3)).toEqual({ x: 28, y: 20 })
  })
  it('ignores neighbours that are not alongside', () => {
    expect(snapPosition({ x: 92, y: 80, width: 20, height: 20 }, [nb], bounds, 0, 3)).toEqual({ x: 92, y: 80 })
  })
})
