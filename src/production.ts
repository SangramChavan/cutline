import { holeSheetPolygon, piecePoints, polygonArea, toMm, usableBounds, type Design, type Layout, type Sheet } from './model'

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
  usableAreaMm2: number
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
  const usableAreaMm2 = usableBounds(sheet).area
  let placedPieces = 0, usedAreaMm2 = 0, cutLengthMm = 0
  for (const pieces of layout.sheets) {
    for (const p of pieces) {
      const d = designs.find(v => v.id === p.designId)!
      placedPieces++
      usedAreaMm2 += polygonArea(piecePoints(p, d))
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
    usableAreaMm2,
    sheetAreaMm2,
    wasteAreaMm2: sheets * usableAreaMm2 - usedAreaMm2,
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

// --- Machine / material cutting-time model ---------------------------------
// Thickness alone never determines a cutting speed: a real speed belongs to a
// material + thickness + machine profile the operator has actually tested.

export interface MachineProfile {
  name: string
  material: string
  thicknessMm: number
  powerW: number
  powerPercent: number
  cutSpeedMmPerSecond: number
  passes: number
  pierceSeconds: number
  leadInMm: number
  leadOutMm: number
  travelSpeedMmPerSecond: number
  travelBetweenMm: number
  setupSeconds: number
  handlingSecondsPerSheet: number
  additionalCutMm: number
  sheetPrice: number
  cutRatePerMinute: number
}

export const defaultMachineProfile: MachineProfile = {
  name: 'Default profile', material: 'Cast acrylic', thicknessMm: 3, powerW: 40, powerPercent: 60,
  cutSpeedMmPerSecond: 20, passes: 1, pierceSeconds: 0.5, leadInMm: 0, leadOutMm: 0, travelSpeedMmPerSecond: 0, travelBetweenMm: 0,
  setupSeconds: 0, handlingSecondsPerSheet: 0, additionalCutMm: 0, sheetPrice: 0, cutRatePerMinute: 0,
}

// Rough STARTING points only, to be replaced with tested values. Explicitly not
// production-verified: acrylic and plywood cut speeds vary widely by tube power,
// lens and air assist. Displayed as estimates, never as guarantees.
export const suggestedProfiles: { material: string; thicknessMm: number; speedMmPerSecond: number; passes: number }[] = [
  { material: 'Cast acrylic', thicknessMm: 2, speedMmPerSecond: 25, passes: 1 },
  { material: 'Cast acrylic', thicknessMm: 3, speedMmPerSecond: 18, passes: 1 },
  { material: 'Cast acrylic', thicknessMm: 5, speedMmPerSecond: 10, passes: 1 },
  { material: 'Extruded acrylic', thicknessMm: 3, speedMmPerSecond: 16, passes: 1 },
  { material: 'Plywood', thicknessMm: 3, speedMmPerSecond: 20, passes: 1 },
  { material: 'Plywood', thicknessMm: 6, speedMmPerSecond: 8, passes: 2 },
]

export interface CuttingEstimate {
  externalLengthMm: number
  holeLengthMm: number
  additionalLengthMm: number
  totalCutLengthMm: number
  contourCount: number
  pierceCount: number
  passes: number
  laserOnSeconds: number
  piercingSeconds: number
  travelSeconds: number | null
  handlingSeconds: number
  setupSeconds: number
  totalSeconds: number
  secondsPerSheet: number
  secondsPerPart: number
  sheets: number
  parts: number
  sheetCost: number
  cutCost: number
  totalCost: number
  missing: string[]
}

export function estimateCutting(designs: Design[], layout: Layout, profile: MachineProfile): CuttingEstimate {
  let external = 0, hole = 0, contours = 0, parts = 0
  for (const pieces of layout.sheets) for (const p of pieces) {
    const d = designs.find(v => v.id === p.designId)!
    parts++
    external += perimeter(piecePoints(p, d)); contours++
    for (const h of d.holes ?? []) { hole += perimeter(holeSheetPolygon(h, p, d, 48)); contours++ }
  }
  const sheets = layout.sheets.length
  const passes = Math.max(1, Math.floor(profile.passes) || 1)
  const speed = Math.max(0, profile.cutSpeedMmPerSecond)
  const lead = Math.max(0, profile.leadInMm) + Math.max(0, profile.leadOutMm)
  const additional = Math.max(0, profile.additionalCutMm) * parts
  const cuttingLength = (external + hole + additional) * passes
  const leadLength = lead * contours * passes
  const laserOnSeconds = speed > 0 ? (cuttingLength + leadLength) / speed : 0
  const pierceCount = contours * passes
  const piercingSeconds = pierceCount * Math.max(0, profile.pierceSeconds)
  const travelSeconds = profile.travelSpeedMmPerSecond > 0 ? pierceCount * Math.max(0, profile.travelBetweenMm) / profile.travelSpeedMmPerSecond : null
  const handlingSeconds = Math.max(0, profile.handlingSecondsPerSheet) * sheets
  const setupSeconds = Math.max(0, profile.setupSeconds)
  const totalSeconds = laserOnSeconds + piercingSeconds + (travelSeconds ?? 0) + handlingSeconds + setupSeconds
  const sheetCost = sheets * Math.max(0, profile.sheetPrice)
  const cutCost = laserOnSeconds / 60 * Math.max(0, profile.cutRatePerMinute)
  const missing: string[] = []
  if (!(profile.thicknessMm > 0)) missing.push('material thickness')
  if (!(speed > 0)) missing.push('cutting speed')
  if (profile.travelSpeedMmPerSecond <= 0) missing.push('machine travel speed (travel time not modelled)')
  return {
    externalLengthMm: external, holeLengthMm: hole, additionalLengthMm: additional,
    totalCutLengthMm: external + hole + additional, contourCount: contours, pierceCount, passes,
    laserOnSeconds, piercingSeconds, travelSeconds, handlingSeconds, setupSeconds, totalSeconds,
    secondsPerSheet: sheets ? totalSeconds / sheets : 0, secondsPerPart: parts ? totalSeconds / parts : 0,
    sheets, parts, sheetCost, cutCost, totalCost: sheetCost + cutCost, missing,
  }
}
