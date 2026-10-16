import { judge, select, type Candidate, type Context } from './geometry'

export type Shape = 'rectangle' | 'square' | 'rounded' | 'circle' | 'ellipse' | 'polygon' | 'svg'
export type Point = { x: number; y: number }

// Nesting engine budgets: probe at most SCAN_CAP candidate anchors per sheet and
// judge at most MAX_CANDIDATES legal placements, so scoring stays bounded as a
// batch grows. ponytail: heuristic ceilings; raise if very dense sheets under-fill.
const SCAN_CAP = 256
const MAX_CANDIDATES = 8

// A keychain hole is an internal cut path. Coordinates are the hole centre in
// millimetres, measured from the piece's top-left in its unrotated frame, so a
// hole stays glued to the artwork through rotation and placement.
export interface Hole {
  id: string
  diameter: number
  x: number
  y: number
}

export type EcLevel = 'L' | 'M' | 'Q' | 'H'

// QR placed on a piece. x/y is the top-left of the QR box (quiet zone included)
// in design millimetres; sizeMm is the full box edge (square, never stretched).
export interface QrConfig {
  enabled: boolean
  source: 'generated' | 'image'
  text: string
  ecLevel: EcLevel
  sizeMm: number
  x: number
  y: number
  quietModules: number
  rotation: number
  imageDataUrl?: string
  dark?: string
  light?: string
}

export interface Design {
  id: string
  name: string
  path: string
  url: string
  mime: string
  imageWidth: number
  imageHeight: number
  width: number
  height: number
  quantity: number
  shape: Shape
  radius: number
  rotation: number
  enabled: boolean
  selected: boolean
  hash?: string
  svgPath?: string
  points?: Point[]
  lockRatio?: boolean
  holes?: Hole[]
  qr?: QrConfig
  // Minimum material bridge kept between a hole and the external edge, in mm.
  bridgeMm?: number
  // Border placed OUTSIDE the artwork, in mm (0 = off, clamped 0..50) and its colour.
  borderMm: number
  borderColor: string
  // 'outside' (default): band sits wholly outside the artwork. 'center': band straddles the artwork edge.
  borderAlign?: 'outside' | 'center'
}

export const MAX_BORDER_MM = 50
export const DEFAULT_BORDER_COLOR = '#000000'
export const clampBorder = (v: unknown): number => typeof v === 'number' && Number.isFinite(v) ? Math.min(MAX_BORDER_MM, Math.max(0, v)) : 0
export const normalizeBorderColor = (v: unknown): string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : DEFAULT_BORDER_COLOR

// Size of the finished piece including its border. `offset` maps artwork-local
// mm into outer-local mm. Nesting, cutting and estimates all use this.
// How far the piece grows past the artwork edge: the full border, or half when centred on the edge.
export const borderOut = (d: { borderMm?: number; borderAlign?: string }): number => clampBorder(d.borderMm) * (d.borderAlign === 'center' ? 0.5 : 1)

export function outerSize(d: Pick<Design, 'width' | 'height'> & { borderMm?: number; borderAlign?: string }) {
  const offset = borderOut(d)
  return { w: d.width + 2 * offset, h: d.height + 2 * offset, offset }
}


export interface Sheet {
  width: number
  height: number
  unit: 'mm' | 'cm' | 'in'
  marginTop: number
  marginRight: number
  marginBottom: number
  marginLeft: number
  clearance: number
}

export interface Piece {
  id: string
  designId: string
  copy: number
  x: number
  y: number
  width: number
  height: number
  rotation: number
  sheet: number
  path: string
}

export interface Layout {
  sheets: Piece[][]
  unplaced: Piece[]
  utilization: number[]
}

export const toMm = (n: number, unit: Sheet['unit']) => n * (unit === 'cm' ? 10 : unit === 'in' ? 25.4 : 1)
export const fromMm = (n: number, unit: Sheet['unit']) => n / (unit === 'cm' ? 10 : unit === 'in' ? 25.4 : 1)

// Default physical size for a freshly imported artwork: preserve its aspect
// ratio, fitted so the longest edge is maxEdge mm.
export function fitSize(imageWidth: number, imageHeight: number, maxEdge = 50): { width: number; height: number } {
  if (!(imageWidth > 0) || !(imageHeight > 0)) return { width: maxEdge, height: maxEdge }
  const scale = maxEdge / Math.max(imageWidth, imageHeight)
  return { width: imageWidth * scale, height: imageHeight * scale }
}

// Shoelace area of a closed contour (absolute, so winding order is irrelevant).
export function polygonArea(points: Point[]): number {
  let a = 0
  for (let i = 0; i < points.length; i++) { const p = points[i]!, q = points[(i + 1) % points.length]!; a += p.x * q.y - q.x * p.y }
  return Math.abs(a) / 2
}

// The usable rectangle implied by the four edge margins, in mm.
export function usableBounds(sheet: Sheet) {
  const ml = toMm(sheet.marginLeft, sheet.unit), mr = toMm(sheet.marginRight, sheet.unit), mt = toMm(sheet.marginTop, sheet.unit), mb = toMm(sheet.marginBottom, sheet.unit)
  const width = Math.max(0, toMm(sheet.width, sheet.unit) - ml - mr), height = Math.max(0, toMm(sheet.height, sheet.unit) - mt - mb)
  return { x: ml, y: mb, width, height, area: width * height }
}

export interface UsableRect { x: number; y: number; width: number; height: number }

// A custom usable rectangle (in sheet units) is exactly the margin rectangle
// the nesting engine already supports, expressed as X / Y / width / height.
export function marginsFromUsable(sheet: Sheet, rect: UsableRect): Sheet {
  return {
    ...sheet,
    marginLeft: rect.x,
    marginBottom: rect.y,
    marginRight: Math.max(0, sheet.width - rect.x - rect.width),
    marginTop: Math.max(0, sheet.height - rect.y - rect.height),
  }
}

export function validateUsableRect(sheet: Sheet, rect: UsableRect): string | null {
  if (!(rect.width > 0) || !(rect.height > 0)) return 'Usable area needs a positive width and height.'
  if (rect.x < 0 || rect.y < 0) return 'Usable area X and Y must be zero or greater.'
  if (rect.x + rect.width > sheet.width + 1e-6 || rect.y + rect.height > sheet.height + 1e-6) return 'Usable area extends past the sheet edge. Reduce X, Y, width or height.'
  return null
}

export function shapePath(d: Pick<Design, 'shape' | 'width' | 'height' | 'radius' | 'points' | 'svgPath'>): string {
  const { width: w, height: h } = d
  if (d.shape === 'svg' && d.svgPath) return d.svgPath
  if (d.shape === 'circle') return `M ${w / 2} 0 A ${w / 2} ${h / 2} 0 1 1 ${w / 2} ${h} A ${w / 2} ${h / 2} 0 1 1 ${w / 2} 0 Z`
  if (d.shape === 'ellipse') return `M ${w / 2} 0 A ${w / 2} ${h / 2} 0 1 1 ${w / 2} ${h} A ${w / 2} ${h / 2} 0 1 1 ${w / 2} 0 Z`
  if (d.shape === 'polygon' && d.points?.length) return `M ${d.points.map(p => `${p.x} ${p.y}`).join(' L ')} Z`
  if (d.shape === 'rounded') {
    const r = Math.min(d.radius, w / 2, h / 2)
    return `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`
  }
  return `M 0 0 H ${w} V ${h} H 0 Z`
}

type ShapeSrc = Pick<Design, 'shape' | 'width' | 'height' | 'radius' | 'points' | 'svgPath'> & { borderMm?: number; borderAlign?: string }

// Miter-offset a polygon outward by b (miter length capped), re-anchored so the
// result keeps the same origin convention (bbox min stays where it was).
function offsetPolygon(pts: Point[], b: number): Point[] {
  const n = pts.length
  let area = 0
  for (let i = 0; i < n; i++) { const a = pts[i]!, c = pts[(i + 1) % n]!; area += a.x * c.y - c.x * a.y }
  const sign = area >= 0 ? 1 : -1 // outward normal of edge (dx,dy) is (dy,-dx)*sign
  const norm = (a: Point, c: Point) => { const dx = c.x - a.x, dy = c.y - a.y, l = Math.hypot(dx, dy) || 1; return { x: dy / l * sign, y: -dx / l * sign } }
  return pts.map((p, i) => {
    const n1 = norm(pts[(i + n - 1) % n]!, p), n2 = norm(p, pts[(i + 1) % n]!)
    const mx = n1.x + n2.x, my = n1.y + n2.y, k = 1 + n1.x * n2.x + n1.y * n2.y
    const scale = b / Math.max(k, 0.25) // cap miter at 2x b
    return { x: p.x + mx * scale + b, y: p.y + my * scale + b }
  })
}

// The cut shape: the artwork shape grown by borderMm on every side. With no
// border it is the design itself, so output is identical to before.
export function outerShape(d: ShapeSrc): ShapeSrc {
  const b = borderOut(d)
  if (!b) return d
  const { w, h } = outerSize(d)
  if ((d.shape === 'polygon' && d.points?.length) || (d.shape === 'svg' && d.svgPath)) {
    const pts = pathPoints(d)
    if (pts.length >= 3) return { shape: 'polygon', width: w, height: h, radius: 0, points: offsetPolygon(pts, b) }
  }
  const radius = d.shape === 'rounded' ? Math.min(d.radius, d.width / 2, d.height / 2) + b : d.radius
  return { shape: d.shape === 'svg' || d.shape === 'polygon' ? 'rectangle' : d.shape, width: w, height: h, radius, points: undefined, svgPath: undefined }
}

// Outer cut contour in outer-local mm (top-left origin).
export const cutPoints = (d: ShapeSrc): Point[] => pathPoints(outerShape(d))

export function pathPoints(d: Pick<Design, 'shape' | 'width' | 'height' | 'radius' | 'points' | 'svgPath'>, steps = 32): Point[] {
  if (d.shape === 'circle' || d.shape === 'ellipse') return Array.from({ length: steps }, (_, i) => ({ x: d.width / 2 + d.width / 2 * Math.cos(i * Math.PI * 2 / steps), y: d.height / 2 + d.height / 2 * Math.sin(i * Math.PI * 2 / steps) }))
  if (d.shape === 'polygon' && d.points?.length) return d.points
  if (d.shape === 'svg' && d.svgPath) {
    const numbers = d.svgPath.match(/-?\d*\.?\d+/g)?.map(Number) ?? []
    if (numbers.length >= 6 && numbers.length % 2 === 0) {
      const pts = Array.from({ length: numbers.length / 2 }, (_, i) => ({ x: numbers[i * 2]!, y: numbers[i * 2 + 1]! }))
      const dedup = pts.filter((p, i) => i === 0 || p.x !== pts[i - 1]!.x || p.y !== pts[i - 1]!.y)
      const last = dedup[dedup.length - 1]!, first = dedup[0]!
      return dedup.length > 1 && last.x === first.x && last.y === first.y ? dedup.slice(0, -1) : dedup
    }
  }
  if (d.shape === 'rounded') {
    const r = Math.min(d.radius, d.width / 2, d.height / 2)
    const corners: Point[] = []
    for (const [cx, cy, start] of [[d.width-r,r,-90],[d.width-r,d.height-r,0],[r,d.height-r,90],[r,r,180]] as const) {
      for (let i = 0; i <= 6; i++) { const a = (start + i * 90 / 6) * Math.PI / 180; corners.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }) }
    }
    return corners
  }
  return [{ x: 0, y: 0 }, { x: d.width, y: 0 }, { x: d.width, y: d.height }, { x: 0, y: d.height }]
}

export function rotatePoints(points: Point[], angle: number): Point[] {
  const r = angle * Math.PI / 180
  const cos = Math.cos(r), sin = Math.sin(r)
  const rotated=points.map(p => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }))
  const minX=Math.min(0,...rotated.map(p=>p.x)),minY=Math.min(0,...rotated.map(p=>p.y))
  return rotated.map(p=>({x:p.x-minX,y:p.y-minY}))
}

export function boundsOf(points: Point[]) {
  return {
    minX: Math.min(...points.map(p => p.x)),
    minY: Math.min(...points.map(p => p.y)),
    maxX: Math.max(...points.map(p => p.x)),
    maxY: Math.max(...points.map(p => p.y)),
  }
}

export function translatePoints(points: Point[], dx: number, dy: number): Point[] {
  return points.map(p => ({ x: p.x + dx, y: p.y + dy }))
}

// Single source of truth for a placed copy's real cutting contour: design outline
// rotated by the copy angle, then translated so its bounding box sits at (piece.x,piece.y).
export function piecePoints(piece: Pick<Piece, 'x' | 'y' | 'rotation' | 'width' | 'height'>, design: Design): Point[] {
  const rotated = rotatePoints(cutPoints(design), piece.rotation)
  const box = boundsOf(rotated)
  return translatePoints(rotated, piece.x - box.minX, piece.y - box.minY)
}

export function pointsToPath(points: Point[], precision = 4): string {
  const f = (n: number) => n.toFixed(precision)
  return `M ${points.map(p => `${f(p.x)} ${f(p.y)}`).join(' L ')} Z`
}

// --- Holes & QR geometry -------------------------------------------------

export function circlePoints(cx: number, cy: number, diameter: number, steps = 48): Point[] {
  const r = Math.max(0, diameter) / 2
  return Array.from({ length: steps }, (_, i) => { const a = i * Math.PI * 2 / steps; return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) } })
}

// Map a point from design-local mm (top-left origin, unrotated) onto the sheet,
// using the exact same rotate+normalise+translate the cut contour uses. This is
// what keeps a hole or QR aligned with the artwork after nesting rotates it.
export function localToSheet(local: Point, piece: Pick<Piece, 'x' | 'y' | 'rotation'>, design: Design): Point {
  const r = piece.rotation * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r)
  const { offset } = outerSize(design)
  local = { x: local.x + offset, y: local.y + offset }
  const raw = cutPoints(design).map(p => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }))
  const minX = Math.min(0, ...raw.map(p => p.x)), minY = Math.min(0, ...raw.map(p => p.y))
  return { x: local.x * cos - local.y * sin - minX + piece.x, y: local.x * sin + local.y * cos - minY + piece.y }
}

// The placed hole as a closed contour on the sheet (rotation-independent circle).
export function holeSheetPolygon(hole: Hole, piece: Pick<Piece, 'x' | 'y' | 'rotation'>, design: Design, steps = 48): Point[] {
  const c = localToSheet({ x: hole.x, y: hole.y }, piece, design)
  return circlePoints(c.x, c.y, hole.diameter, steps)
}

export function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

export function minDistanceToContour(p: Point, contour: Point[]): number {
  let min = Infinity
  for (let i = 0; i < contour.length; i++) min = Math.min(min, pointSegmentDistance(p, contour[i]!, contour[(i + 1) % contour.length]!))
  return min
}

export function pointInContour(p: Point, poly: Point[]): boolean { return pointInPolygon(p, poly) }

// Validate a hole against the real cut boundary. bridgeMm is the minimum
// material left between the hole edge and the nearest external edge.
export function holeError(hole: Hole, design: Design, bridgeMm = 1): string | null {
  if (!(hole.diameter > 0)) return 'Hole diameter must be greater than zero.'
  const contour = cutPoints(design)
  const { offset } = outerSize(design)
  const centre = { x: hole.x + offset, y: hole.y + offset }
  if (!pointInContour(centre, contour)) return 'Hole centre is outside the part outline.'
  const clearance = minDistanceToContour(centre, contour) - hole.diameter / 2
  if (clearance < bridgeMm - 1e-6) return `Hole is ${clearance.toFixed(2)} mm from the edge; a ${bridgeMm.toFixed(2)} mm material bridge is required.`
  return null
}

export function holeClearance(hole: Hole, design: Design): number {
  const { offset } = outerSize(design)
  return minDistanceToContour({ x: hole.x + offset, y: hole.y + offset }, cutPoints(design)) - hole.diameter / 2
}

// Preset hole placements, in design-local mm.
export function holePreset(preset: 'top-centre' | 'top-left' | 'top-right' | 'two-top' | 'centre', design: Pick<Design, 'width' | 'height'> & { borderMm?: number; borderAlign?: string }, diameter: number, edgeGap = 4): Hole[] {
  // Edge gap is measured from the OUTER edge; coordinates stay artwork-local (may be negative inside the border).
  const o = outerSize(design).offset
  const r = diameter / 2, g = edgeGap
  const cx = design.width / 2, cy = g + r - o
  if (preset === 'top-left') return [{ id: 'h', diameter, x: g + r - o, y: cy }]
  if (preset === 'top-right') return [{ id: 'h', diameter, x: design.width + o - g - r, y: cy }]
  if (preset === 'two-top') return [{ id: 'h1', diameter, x: design.width * 0.25 - o / 2, y: cy }, { id: 'h2', diameter, x: design.width * 0.75 + o / 2, y: cy }]
  if (preset === 'centre') return [{ id: 'h', diameter, x: cx, y: design.height / 2 }]
  return [{ id: 'h', diameter, x: cx, y: cy }]
}

function cross(a: Point, b: Point, c: Point) { return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x) }
function onSegment(a: Point, b: Point, p: Point, eps = 1e-8) { return Math.abs(cross(a,b,p)) < eps && p.x >= Math.min(a.x,b.x)-eps && p.x <= Math.max(a.x,b.x)+eps && p.y >= Math.min(a.y,b.y)-eps && p.y <= Math.max(a.y,b.y)+eps }
function properIntersect(a: Point, b: Point, c: Point, d: Point) {
  const ab1 = cross(a,b,c), ab2 = cross(a,b,d), cd1 = cross(c,d,a), cd2 = cross(c,d,b)
  return ((ab1 > 0 && ab2 < 0) || (ab1 < 0 && ab2 > 0)) && ((cd1 > 0 && cd2 < 0) || (cd1 < 0 && cd2 > 0))
}

export function validatePolygon(points: Point[]): string | null {
  if (points.length < 3) return 'A closed cutting path needs at least 3 vertices.'
  if (points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return 'Cutting path contains invalid coordinates.'
  let area = 0
  for (let i = 0; i < points.length; i++) { const a=points[i]!, b=points[(i+1)%points.length]!; area += a.x*b.y-b.x*a.y }
  for (let i = 0; i < points.length; i++) for (let j = i+1; j < points.length; j++) {
    if (j === i || j === i+1 || (i === 0 && j === points.length-1)) continue
    if (properIntersect(points[i]!, points[(i+1)%points.length]!, points[j]!, points[(j+1)%points.length]!)) return 'Cutting path self-intersects.'
  }
  if (Math.abs(area) < 1e-7) return 'Cutting path has zero area.'
  return null
}

function pointInPolygon(p: Point, poly: Point[]) {
  let inside=false
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){ const a=poly[i]!,b=poly[j]!; if(onSegment(a,b,p)) return false; if(((a.y>p.y)!==(b.y>p.y)) && p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) inside=!inside }
  return inside
}
const centroid=(p:Point[])=>({x:p.reduce((s,q)=>s+q.x,0)/p.length,y:p.reduce((s,q)=>s+q.y,0)/p.length})
const probes=(p:Point[])=>{const out:Point[]=[];for(let i=0;i<p.length;i++){const a=p[i]!,b=p[(i+1)%p.length]!;out.push(a,{x:(a.x+b.x)/2,y:(a.y+b.y)/2})}out.push(centroid(p));return out}

export function polygonsOverlap(a: Point[], b: Point[], clearance = 0): boolean {
  const minMax = (p: Point[]) => ({ minX: Math.min(...p.map(q=>q.x)), maxX: Math.max(...p.map(q=>q.x)), minY: Math.min(...p.map(q=>q.y)), maxY: Math.max(...p.map(q=>q.y)) })
  const aa=minMax(a),bb=minMax(b)
  if(aa.maxX+clearance<bb.minX || bb.maxX+clearance<aa.minX || aa.maxY+clearance<bb.minY || bb.maxY+clearance<aa.minY) return false
  for(let i=0;i<a.length;i++) for(let j=0;j<b.length;j++) if(properIntersect(a[i]!,a[(i+1)%a.length]!,b[j]!,b[(j+1)%b.length]!)) return true
  const pa=probes(a),pb=probes(b)
  if(pa.some(p=>pointInPolygon(p,b))||pb.some(p=>pointInPolygon(p,a))) return true
  if(clearance>0){const dist=segmentDistance;for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++){if(dist(a[i]!,a[(i+1)%a.length]!,b[j]!,b[(j+1)%b.length]!)<clearance)return true}}
  return false
}
function segmentDistance(a:Point,b:Point,c:Point,d:Point){
  const dist=(p:Point,q:Point)=>Math.hypot(p.x-q.x,p.y-q.y)
  const pointLine=(p:Point,x:Point,y:Point)=>{const dx=y.x-x.x,dy=y.y-x.y,t=Math.max(0,Math.min(1,((p.x-x.x)*dx+(p.y-x.y)*dy)/(dx*dx+dy*dy||1)));return dist(p,{x:x.x+t*dx,y:x.y+t*dy})}
  if(properIntersect(a,b,c,d)||onSegment(a,b,c)||onSegment(a,b,d)||onSegment(c,d,a)||onSegment(c,d,b)) return 0
  return Math.min(pointLine(a,c,d),pointLine(b,c,d),pointLine(c,a,b),pointLine(d,a,b))
}

const outerArea = (d: Design) => { const o = outerSize(d); return o.w * o.h }

export async function pack(designs: Design[], sheet: Sheet, angleOptions: number[] = [0, 90], maxSheets = Infinity, compare?: (a: Design, b: Design) => number): Promise<Layout> {
  const unit = sheet.unit
  const width=toMm(sheet.width,unit), height=toMm(sheet.height,unit)
  const m=[sheet.marginTop,sheet.marginRight,sheet.marginBottom,sheet.marginLeft].map(v=>toMm(v,unit))
  const usableW=Math.max(0,width-m[3]-m[1]), usableH=Math.max(0,height-m[0]-m[2]), usableArea=usableW*usableH
  const clearance=toMm(sheet.clearance,unit)
  const items=designs.filter(d=>d.enabled).flatMap(d=>Array.from({length:Math.max(0,Math.floor(d.quantity))},(_,i)=>({d,copy:i+1}))).sort((a,b)=>compare?compare(a.d,b.d):outerArea(b.d)-outerArea(a.d))
  const sheets:Piece[][]=[[]], unplaced:Piece[]=[]
  const bounds=(pts:Point[])=>({minX:Math.min(...pts.map(p=>p.x)),maxX:Math.max(...pts.map(p=>p.x)),minY:Math.min(...pts.map(p=>p.y)),maxY:Math.max(...pts.map(p=>p.y))})
  type Box={minX:number,maxX:number,minY:number,maxY:number}
  const placedAt=new Map<string,{pts:Point[];box:Box}>()
  const aabb=(a:Box,b:Box,pad:number)=>a.minX-pad<b.maxX&&b.minX-pad<a.maxX&&a.minY-pad<b.maxY&&b.minY-pad<a.maxY
  // The angle set offered by the UI (90° steps or 15° steps) is honoured as-is;
  // a per-design fixed rotation restricts it further. (Previously a hard
  // multiple-of-90 filter discarded every 15° angle, so "free" mode never rotated.)
  const validAngles=(design:Design)=>angleOptions.filter(a=>design.rotation===0||a%360===design.rotation%360||design.rotation===90&&a%180===90)
  const candList=new Map<number,Point[]>(), candKeys=new Map<number,Set<string>>()
  const ensure=(si:number)=>{ if(!candList.has(si)){ candList.set(si,[{x:m[3],y:m[0]}]); candKeys.set(si,new Set([`${m[3]}:${m[0]}`])) } }
  const addCand=(si:number,x:number,y:number)=>{
    // ponytail: sorted-array insert is O(n) per candidate (O(n^2) over a sheet); fine to ~2k pieces, switch to a heap/quadtree if batches grow.
    const key=`${x}:${y}`, keys=candKeys.get(si)!
    if(keys.has(key)) return
    keys.add(key)
    const arr=candList.get(si)!
    let lo=0,hi=arr.length
    while(lo<hi){ const mid=(lo+hi)>>1, c=arr[mid]!; if(c.y<y||(c.y===y&&c.x<x)) lo=mid+1; else hi=mid }
    arr.splice(lo,0,{x,y})
  }
  const findSpot=(si:number,opts:{angle:number;pts:Point[];w:number;h:number}[])=>{
    const group=sheets[si]!
    const candidates:Candidate[]=[]
    let scanned=0
    scan:
    for(const {pts,w,h,angle} of opts){
      if(w>width-m[1]-m[3]||h>height-m[0]-m[2]) continue
      for(const {x,y} of candList.get(si)!){
        if(scanned++>=SCAN_CAP) break scan
        if(x+w>width-m[1]+1e-7||y+h>height-m[2]+1e-7||x<m[3]-1e-7||y<m[0]-1e-7) continue
        const box={minX:x,maxX:x+w,minY:y,maxY:y+h}
        const abs=pts.map(p=>({x:p.x+x,y:p.y+y}))
        let hit=false
        for(const other of group){
          const oi=placedAt.get(other.id)!
          if(!aabb(box,oi.box,clearance)) continue
          if(polygonsOverlap(abs,oi.pts,clearance)){hit=true;break}
        }
        if(hit) continue
        candidates.push({sheet:si,x,y,angle,pts:abs,w,h})
        if(candidates.length>=MAX_CANDIDATES) break scan
      }
    }
    if(!candidates.length) return null
    // Verify is done above (every candidate is overlap-free); the judge picks
    // the tightest, most bottom-left of the legal set.
    const ctx:Context={sheetW:width,sheetH:height,marginTop:m[0],marginRight:m[1],marginBottom:m[2],marginLeft:m[3],placed:group.map(o=>placedAt.get(o.id)!)}
    const best=select(candidates.map(c=>judge(c,ctx))).candidate
    return {x:best.x,y:best.y,angle:best.angle,pts:best.pts,box:{minX:best.x,maxX:best.x+best.w,minY:best.y,maxY:best.y+best.h},w:best.w,h:best.h}
  }
  const place=(si:number,spot:{x:number,y:number;angle:number;pts:Point[];box:Box;w:number;h:number},d:Design,copy:number)=>{
    const id=`${d.id}-${copy}`
    const piece:Piece={id,designId:d.id,copy,x:spot.x,y:spot.y,width:spot.w,height:spot.h,rotation:spot.angle,sheet:si,path:shapePath(outerShape(d))}
    sheets[si]!.push(piece)
    placedAt.set(id,{pts:spot.pts,box:spot.box})
    addCand(si,piece.x+piece.width+clearance,piece.y)
    addCand(si,piece.x,piece.y+piece.height+clearance)
    addCand(si,piece.x+piece.width+clearance,piece.y+piece.height+clearance)
  }
  for(const {d,copy} of items){
    const opts=validAngles(d).map(angle=>{const rp=rotatePoints(cutPoints(d),angle),b=bounds(rp);return{angle,pts:rp.map(p=>({x:p.x-b.minX,y:p.y-b.minY})),w:b.maxX-b.minX,h:b.maxY-b.minY}})
    let spot=null, onSheet=-1
    for(let si=0;si<sheets.length&&!spot;si++){ ensure(si); const found=findSpot(si,opts); if(found){spot=found;onSheet=si} }
    if(!spot){
      const smallest=[...opts].sort((a,b)=>a.w*a.h-b.w*b.h)[0]
      if(smallest&&sheets.length<maxSheets&&smallest.w<=width-m[1]-m[3]&&smallest.h<=height-m[0]-m[2]){
        if(sheets.at(-1)!.length) sheets.push([])
        onSheet=sheets.length-1
        ensure(onSheet)
        spot={x:m[3],y:m[0],angle:smallest.angle,pts:smallest.pts.map(p=>({x:p.x+m[3],y:p.y+m[0]})),box:{minX:m[3],maxX:m[3]+smallest.w,minY:m[0],maxY:m[0]+smallest.h},w:smallest.w,h:smallest.h}
      }
    }
    if(spot){ place(onSheet,spot,d,copy) } else unplaced.push({id:`${d.id}-${copy}`,designId:d.id,copy,x:0,y:0,width:outerSize(d).w,height:outerSize(d).h,rotation:0,sheet:0,path:shapePath(outerShape(d))})
  }
  while(sheets.length>1&&!sheets.at(-1)!.length) sheets.pop()
  if(sheets.length===1&&!sheets[0]!.length) sheets.pop()
  // Utilization is true contour area over the *usable* area, so circles and
  // other non-rectangular parts are not flattered by their bounding box.
  const denom=usableArea>0?usableArea:(width*height)||1
  return {sheets,unplaced,utilization:sheets.map(group=>group.reduce((sum,p)=>{const d=designs.find(v=>v.id===p.designId)!; return sum+polygonArea(cutPoints(d))},0)/denom*100)}
}

// Try several placement orderings and keep the best valid result within a time
// budget. Deterministic: the same inputs always yield the same chosen layout.
export async function packBest(designs: Design[], sheet: Sheet, angleOptions: number[] = [0, 90], maxSheets = Infinity, budgetMs = 1500): Promise<Layout> {
  const strategies: ((a: Design, b: Design) => number)[] = [
    (a, b) => outerArea(b) - outerArea(a) || outerSize(b).h - outerSize(a).h,
    (a, b) => Math.max(outerSize(b).w, outerSize(b).h) - Math.max(outerSize(a).w, outerSize(a).h),
    (a, b) => outerSize(b).h - outerSize(a).h || outerSize(b).w - outerSize(a).w,
  ]
  const better = (a: Layout, b: Layout) => {
    if (a.unplaced.length !== b.unplaced.length) return a.unplaced.length < b.unplaced.length
    if (a.sheets.length !== b.sheets.length) return a.sheets.length < b.sheets.length
    return a.utilization.reduce((s, u) => s + u, 0) > b.utilization.reduce((s, u) => s + u, 0)
  }
  const deadline = Date.now() + Math.max(0, budgetMs)
  let best: Layout | null = null
  for (let i = 0; i < strategies.length; i++) {
    if (i > 0 && Date.now() > deadline) break
    const layout = await pack(designs, sheet, angleOptions, maxSheets, strategies[i])
    if (!best || better(layout, best)) best = layout
  }
  return best!
}

type Rect = { x: number; y: number; width: number; height: number }

// Snap a dragged piece's bounding box to the usable-area edges and to its
// neighbours' edges (flush, or leaving `clearance`), each axis independently,
// within `threshold` mm. Only neighbours whose span overlaps on the other axis
// count, so a piece never snaps to something it is not beside.
export function snapPosition(p: Rect, others: Rect[], bounds: { minX: number; minY: number; maxX: number; maxY: number }, clearance: number, threshold: number): { x: number; y: number } {
  const near = (lo: number, hi: number, olo: number, ohi: number) => lo < ohi + threshold + clearance && olo < hi + threshold + clearance
  const pick = (v: number, targets: number[]) => { let best = v, d = threshold + 1e-9; for (const t of targets) if (Math.abs(t - v) < d) { best = t; d = Math.abs(t - v) } return best }
  const xs = [bounds.minX, bounds.maxX - p.width], ys = [bounds.minY, bounds.maxY - p.height]
  const xt = [...xs], yt = [...ys]
  for (const o of others) {
    if (near(p.y, p.y + p.height, o.y, o.y + o.height)) xt.push(o.x + o.width + clearance, o.x - clearance - p.width, o.x, o.x + o.width - p.width)
    if (near(p.x, p.x + p.width, o.x, o.x + o.width)) yt.push(o.y + o.height + clearance, o.y - clearance - p.height, o.y, o.y + o.height - p.height)
  }
  return { x: pick(p.x, xt), y: pick(p.y, yt) }
}
