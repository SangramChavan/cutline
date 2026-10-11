import { describe, expect, it } from 'vitest'
import { pack, pathPoints, polygonsOverlap, validatePolygon, type Design, type Sheet } from './model'

const sheet:Sheet={width:100,height:80,unit:'mm',marginTop:0,marginRight:0,marginBottom:0,marginLeft:0,clearance:0}
function design(overrides:Partial<Design>={}):Design{return{id:'a',name:'tag.png',path:'tag.png',url:'',mime:'image/png',imageWidth:300,imageHeight:300,width:20,height:20,quantity:1,shape:'rectangle',radius:0,rotation:0,enabled:true,selected:false,...overrides}}

describe('production nesting acceptance',()=>{
  it('packs square quantities exactly at configured physical size',async()=>{
    const result=await pack([design({quantity:12,width:20,height:20})],sheet)
    expect(result.sheets.flat()).toHaveLength(12)
    expect(new Set(result.sheets.flat().map(p=>p.id)).size).toBe(12)
    expect(result.unplaced).toHaveLength(0)
  })
  it('packs circles using their contours with true zero-gap tangency',async()=>{
    const result=await pack([design({shape:'circle',width:20,height:20,quantity:4})],sheet)
    expect(result.sheets.flat()).toHaveLength(4)
    const pieces=result.sheets.flat()
    const circle=design({shape:'circle',width:20,height:20}),contours=pieces.map(p=>pathPoints(circle).map(point=>({x:point.x+p.x,y:point.y+p.y})))
    expect(polygonsOverlap(contours[0]!,contours[1]!)).toBe(false)
  })
  it('uses multiple sheets for overflow and rejects an impossible piece',async()=>{
    expect((await pack([design({quantity:8,width:50,height:40})],sheet)).sheets.length).toBeGreaterThan(1)
    const impossible=await pack([design({quantity:2,width:120,height:120})],sheet)
    expect(impossible.unplaced).toHaveLength(2)
    expect(impossible.sheets).toHaveLength(0)
  })
  it('treats clearance as the minimum allowed gap between outlines',()=>{
    const c1=pathPoints(design({shape:'circle',width:20,height:20})).map(p=>({x:p.x,y:p.y}))
    const c2=c1.map(p=>({x:p.x+21,y:p.y}))
    expect(polygonsOverlap(c1,c2,0)).toBe(false)
    expect(polygonsOverlap(c1,c2,2)).toBe(true)
  })
  it('enforces the nesting clearance when packing',async()=>{
    const result=await pack([design({shape:'circle',width:20,height:20,quantity:2})],{...sheet,clearance:6})
    const pieces=result.sheets.flat()
    expect(pieces).toHaveLength(2)
    const d=design({shape:'circle',width:20,height:20,quantity:2}),contours=pieces.map(p=>pathPoints(d).map(pt=>({x:pt.x+p.x,y:pt.y+p.y})))
    expect(polygonsOverlap(contours[0]!,contours[1]!,6)).toBe(false)
  })
  it('honors non-zero clearance and supports mixed shape batches',async()=>{
    const mixed=[design({id:'r',shape:'rounded',radius:5,width:32,height:20}),design({id:'c',shape:'circle',width:25,height:25}),design({id:'p',shape:'polygon',points:[{x:0,y:0},{x:30,y:0},{x:20,y:20},{x:5,y:25}]})]
    const result=await pack(mixed,{...sheet,clearance:2})
    expect(result.sheets.flat()).toHaveLength(3)
    expect(result.unplaced).toHaveLength(0)
  })
  it('flags invalid self-intersecting and open geometry',()=>{
    expect(validatePolygon([{x:0,y:0},{x:20,y:20},{x:0,y:20},{x:20,y:0}])).toContain('self-intersects')
    expect(validatePolygon([{x:0,y:0},{x:20,y:0}])).toContain('at least 3')
  })
  it('parses an SVG outline into a closed contour without a duplicate vertex',()=>{
    expect(pathPoints(design({shape:'svg',svgPath:'M 0 40 L 20 0 L 40 40 L 0 40 Z'}))).toHaveLength(3)
    expect(pathPoints(design({shape:'svg',svgPath:'M 0 0 L 30 0 L 30 20 L 0 20'}))).toHaveLength(4)
    expect(validatePolygon(pathPoints(design({shape:'svg',svgPath:'M 0 40 L 20 0 L 40 40 Z'})))).toBeNull()
  })
  it('packs a 500-piece batch without a quadratic stall',async()=>{
    const start=performance.now()
    const result=await pack([design({quantity:500,width:50,height:50})],{...sheet,width:600,height:400})
    expect(result.sheets.flat().length+result.unplaced.length).toBe(500)
    expect(performance.now()-start).toBeLessThan(4000)
  })
})
