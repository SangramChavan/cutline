import { judge, select, type Candidate, type Context } from './geometry'

export type Shape = 'rectangle' | 'square' | 'rounded' | 'circle' | 'ellipse' | 'polygon' | 'svg'
export type Point = { x: number; y: number }

// Nesting engine budgets: probe at most SCAN_CAP candidate anchors per sheet and
// judge at most MAX_CANDIDATES legal placements, so scoring stays bounded as a
// batch grows. ponytail: heuristic ceilings; raise if very dense sheets under-fill.
const SCAN_CAP = 256
const MAX_CANDIDATES = 8

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
  const rotated = rotatePoints(pathPoints(design), piece.rotation)
  const box = boundsOf(rotated)
  return translatePoints(rotated, piece.x - box.minX, piece.y - box.minY)
}

export function pointsToPath(points: Point[], precision = 4): string {
  const f = (n: number) => n.toFixed(precision)
  return `M ${points.map(p => `${f(p.x)} ${f(p.y)}`).join(' L ')} Z`
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

export async function pack(designs: Design[], sheet: Sheet, angleOptions: number[] = [0, 90], maxSheets = Infinity): Promise<Layout> {
  const unit = sheet.unit
  const width=toMm(sheet.width,unit), height=toMm(sheet.height,unit)
  const m=[sheet.marginTop,sheet.marginRight,sheet.marginBottom,sheet.marginLeft].map(v=>toMm(v,unit))
  const clearance=toMm(sheet.clearance,unit)
  const items=designs.filter(d=>d.enabled).flatMap(d=>Array.from({length:Math.max(0,Math.floor(d.quantity))},(_,i)=>({d,copy:i+1}))).sort((a,b)=>b.d.width*b.d.height-a.d.width*a.d.height)
  const sheets:Piece[][]=[[]], unplaced:Piece[]=[]
  const bounds=(pts:Point[])=>({minX:Math.min(...pts.map(p=>p.x)),maxX:Math.max(...pts.map(p=>p.x)),minY:Math.min(...pts.map(p=>p.y)),maxY:Math.max(...pts.map(p=>p.y))})
  type Box={minX:number,maxX:number,minY:number,maxY:number}
  const placedAt=new Map<string,{pts:Point[];box:Box}>()
  const aabb=(a:Box,b:Box,pad:number)=>a.minX-pad<b.maxX&&b.minX-pad<a.maxX&&a.minY-pad<b.maxY&&b.minY-pad<a.maxY
  const validAngles=(design:Design)=>angleOptions.filter(a=>a===0||a===90||a===180||a===270).filter(a=>design.rotation===0||a%360===design.rotation%360||design.rotation===90&&a%180===90)
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
    const piece:Piece={id,designId:d.id,copy,x:spot.x,y:spot.y,width:spot.w,height:spot.h,rotation:spot.angle,sheet:si,path:shapePath(d)}
    sheets[si]!.push(piece)
    placedAt.set(id,{pts:spot.pts,box:spot.box})
    addCand(si,piece.x+piece.width+clearance,piece.y)
    addCand(si,piece.x,piece.y+piece.height+clearance)
    addCand(si,piece.x+piece.width+clearance,piece.y+piece.height+clearance)
  }
  for(const {d,copy} of items){
    const opts=validAngles(d).map(angle=>{const rp=rotatePoints(pathPoints(d),angle),b=bounds(rp);return{angle,pts:rp.map(p=>({x:p.x-b.minX,y:p.y-b.minY})),w:b.maxX-b.minX,h:b.maxY-b.minY}})
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
    if(spot){ place(onSheet,spot,d,copy) } else unplaced.push({id:`${d.id}-${copy}`,designId:d.id,copy,x:0,y:0,width:d.width,height:d.height,rotation:0,sheet:0,path:shapePath(d)})
  }
  while(sheets.length>1&&!sheets.at(-1)!.length) sheets.pop()
  if(sheets.length===1&&!sheets[0]!.length) sheets.pop()
  const sheetArea=width*height
  return {sheets,unplaced,utilization:sheets.map(group=>group.reduce((sum,p)=>{const d=designs.find(v=>v.id===p.designId)!; return sum+(d.width*d.height)},0)/sheetArea*100)}
}
