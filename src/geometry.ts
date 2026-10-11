import type { Point } from './model'

// Geometric placement judge.
//
// The nesting loop enumerates every legal spot for the next copy (checked
// against real contours first), then hands that finite set of typed outcomes
// to this judge. It scores each one and returns the best, with a confidence
// and a reason. It is deterministic and dependency-free — no network, no key,
// no prompt.

export interface Box { minX: number; maxX: number; minY: number; maxY: number }

export interface Candidate {
  sheet: number
  x: number
  y: number
  angle: number
  pts: Point[]
  w: number
  h: number
}

export interface Context {
  sheetW: number
  sheetH: number
  marginTop: number
  marginRight: number
  marginBottom: number
  marginLeft: number
  placed: { box: Box }[]
}

export interface Judgment {
  candidate: Candidate
  score: number
  confidence: number
  reason: string
}

const EPS = 0.01

function mergedLength(intervals: [number, number][]): number {
  if (!intervals.length) return 0
  intervals.sort((a, b) => a[0] - b[0])
  const first = intervals[0]!
  let start = first[0], end = first[1], total = 0
  for (let i = 1; i < intervals.length; i++) {
    const [a, b] = intervals[i]!
    if (a <= end + EPS) end = Math.max(end, b)
    else { total += end - start; start = a; end = b }
  }
  return total + (end - start)
}

// How much of the candidate outline lies flush against the sheet edge or an
// already-placed piece. More shared edge = fewer holes = tighter nest.
function contactLength(c: Candidate, ctx: Context): number {
  const x1 = c.x + c.w, y1 = c.y + c.h
  const edge =
    (c.y <= ctx.marginBottom + EPS ? c.w : 0) +
    (y1 >= ctx.sheetH - ctx.marginTop - EPS ? c.w : 0) +
    (c.x <= ctx.marginLeft + EPS ? c.h : 0) +
    (x1 >= ctx.sheetW - ctx.marginRight - EPS ? c.h : 0)
  const bottom = ctx.placed.filter(p => Math.abs(p.box.maxY - c.y) <= EPS).map(p => [p.box.minX, p.box.maxX] as [number, number])
  const top = ctx.placed.filter(p => Math.abs(p.box.minY - y1) <= EPS).map(p => [p.box.minX, p.box.maxX] as [number, number])
  const left = ctx.placed.filter(p => Math.abs(p.box.maxX - c.x) <= EPS).map(p => [p.box.minY, p.box.maxY] as [number, number])
  const right = ctx.placed.filter(p => Math.abs(p.box.minX - x1) <= EPS).map(p => [p.box.minY, p.box.maxY] as [number, number])
  return edge + mergedLength(bottom) + mergedLength(top) + mergedLength(left) + mergedLength(right)
}

// Score one verified-legal placement in [0,1]. 60% packing tightness (shared
// outline) + 40% bottom-left bias (fill the sheet bottom-up, then left-right).
export function judge(candidate: Candidate, ctx: Context): Judgment {
  const perimeter = 2 * (candidate.w + candidate.h)
  const contact = perimeter > 0 ? Math.min(1, contactLength(candidate, ctx) / perimeter) : 0
  const usableH = ctx.sheetH - ctx.marginTop - ctx.marginBottom
  const usableW = ctx.sheetW - ctx.marginLeft - ctx.marginRight
  const depth = usableH > 0 ? (candidate.y - ctx.marginBottom) / usableH : 0
  const across = usableW > 0 ? (candidate.x - ctx.marginLeft) / usableW : 0
  const bottomLeft = 1 - Math.min(1, 0.7 * Math.max(0, depth) + 0.3 * Math.max(0, across))
  const score = 0.6 * contact + 0.4 * bottomLeft
  const reason = contact >= 1 - 1e-9 ? 'flush against sheet and neighbours' : contact > 0 ? 'tucked against an existing edge' : 'placed in open space'
  return { candidate, score, confidence: Math.max(0, Math.min(1, score)), reason }
}

// Pick the best judgment. Deterministic: highest score, ties resolved toward
// the bottom-left (then the smallest rotation angle) so a run is reproducible.
export function select(judgments: Judgment[]): Judgment {
  return judgments.reduce((best, j) => {
    if (j.score > best.score + 1e-12) return j
    if (Math.abs(j.score - best.score) <= 1e-12) {
      const a = j.candidate, b = best.candidate
      if (a.y < b.y - 1e-12) return j
      if (Math.abs(a.y - b.y) <= 1e-12 && a.x < b.x - 1e-12) return j
      if (Math.abs(a.y - b.y) <= 1e-12 && Math.abs(a.x - b.x) <= 1e-12 && a.angle < b.angle) return j
    }
    return best
  })
}
