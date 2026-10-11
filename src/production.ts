import { piecePoints, toMm, type Design, type Layout, type Sheet } from './model'

export interface ProductionInputs {
  sheetPrice: number
  cutRatePerMinute: number
  cutSpeedMmPerSecond: number
  pierceSecondsPerPiece: number
}

export interface ProductionSummary {
  placedPieces: number
  unplacedPieces: number
  sheets: number
  piecesPerSheet: number
  utilization: number
  usedAreaMm2: number
  sheetAreaMm2: number
  wasteAreaMm2: number
  cutLengthMm: number
  pierceCount: number
  estimatedCutSeconds: number
  sheetCost: number
  cutCost: number
  totalCost: number
  costPerPiece: number
}

export const defaultProductionInputs: ProductionInputs = { sheetPrice: 0, cutRatePerMinute: 0, cutSpeedMmPerSecond: 20, pierceSecondsPerPiece: 2 }

export function perimeter(points: { x: number; y: number }[]): number {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!, b = points[(i + 1) % points.length]!
    sum += Math.hypot(a.x - b.x, a.y - b.y)
  }
  return sum
}

export function summarize(designs: Design[], layout: Layout, sheet: Sheet, inputs: ProductionInputs = defaultProductionInputs): ProductionSummary {
  const sheetAreaMm2 = toMm(sheet.width, sheet.unit) * toMm(sheet.height, sheet.unit)
  let placedPieces = 0, usedAreaMm2 = 0, cutLengthMm = 0
  for (const pieces of layout.sheets) {
    for (const p of pieces) {
      const d = designs.find(v => v.id === p.designId)!
      placedPieces++
      usedAreaMm2 += p.width * p.height
      cutLengthMm += perimeter(piecePoints(p, d))
    }
  }
  const sheets = layout.sheets.length
  const utilization = sheets ? layout.utilization.reduce((a, b) => a + b, 0) / sheets / 100 : 0
  const estimatedCutSeconds = cutLengthMm / Math.max(1, inputs.cutSpeedMmPerSecond) + placedPieces * inputs.pierceSecondsPerPiece
  const sheetCost = sheets * inputs.sheetPrice
  const cutCost = estimatedCutSeconds / 60 * inputs.cutRatePerMinute
  const totalCost = sheetCost + cutCost
  return {
    placedPieces,
    unplacedPieces: layout.unplaced.length,
    sheets,
    piecesPerSheet: sheets ? placedPieces / sheets : 0,
    utilization,
    usedAreaMm2,
    sheetAreaMm2,
    wasteAreaMm2: sheets * sheetAreaMm2 - usedAreaMm2,
    cutLengthMm,
    pierceCount: placedPieces,
    estimatedCutSeconds,
    sheetCost,
    cutCost,
    totalCost,
    costPerPiece: placedPieces ? totalCost / placedPieces : 0,
  }
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0m'
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hours) return `${hours}h ${minutes}m`
  return minutes ? `${minutes}m ${secs}s` : `${secs}s`
}
