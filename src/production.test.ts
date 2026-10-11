import { describe, expect, it } from 'vitest'
import { formatDuration, perimeter, summarize, type ProductionInputs } from './production'
import { pack, type Design, type Sheet } from './model'

const sheet: Sheet = { width: 300, height: 200, unit: 'mm', marginTop: 5, marginRight: 5, marginBottom: 5, marginLeft: 5, clearance: 0 }
function design(overrides: Partial<Design> = {}): Design { return { id: 'a1', name: 'qr.png', path: 'batch/qr.png', url: 'data:image/png;base64,AAAA', mime: 'image/png', imageWidth: 300, imageHeight: 300, width: 40, height: 40, quantity: 2, shape: 'rectangle', radius: 0, rotation: 0, enabled: true, selected: false, ...overrides } }

describe('production summary', () => {
  it('sums the true placed contour length per copy', () => {
    expect(perimeter([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }])).toBe(160)
  })
  it('estimates cut time from contour length and pierce count', async () => {
    const designs = [design({ quantity: 2, width: 40, height: 40 })]
    const layout = await pack(designs, sheet)
    const inputs: ProductionInputs = { sheetPrice: 10, cutRatePerMinute: 6, cutSpeedMmPerSecond: 20, pierceSecondsPerPiece: 2 }
    const summary = summarize(designs, layout, sheet, inputs)
    expect(summary.placedPieces).toBe(2)
    expect(summary.sheets).toBe(1)
    expect(summary.cutLengthMm).toBeCloseTo(320, 4)
    expect(summary.pierceCount).toBe(2)
    expect(summary.estimatedCutSeconds).toBeCloseTo(320 / 20 + 4, 4)
    expect(summary.sheetCost).toBe(10)
    expect(summary.totalCost).toBeCloseTo(10 + summary.estimatedCutSeconds / 60 * 6, 6)
    expect(summary.costPerPiece).toBeCloseTo(summary.totalCost / 2, 6)
    expect(summary.wasteAreaMm2).toBeCloseTo(300 * 200 - 2 * 40 * 40, 4)
  })
  it('reports zero cost per piece when nothing is placed', () => {
    const layout = { sheets: [], unplaced: [], utilization: [] }
    const summary = summarize([], layout, sheet)
    expect(summary.costPerPiece).toBe(0)
    expect(summary.placedPieces).toBe(0)
  })
  it('formats durations for operators', () => {
    expect(formatDuration(0)).toBe('0m')
    expect(formatDuration(45)).toBe('45s')
    expect(formatDuration(150)).toBe('2m 30s')
    expect(formatDuration(3900)).toBe('1h 5m')
  })
})
