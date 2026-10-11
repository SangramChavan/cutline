import { describe, expect, it } from 'vitest'
import { buildDxf, buildManifest, buildSvg } from './export'
import { pack, piecePoints, type Design, type Sheet } from './model'

const sheet:Sheet={width:300,height:200,unit:'mm',marginTop:5,marginRight:5,marginBottom:5,marginLeft:5,clearance:0}
function design(overrides:Partial<Design>={}):Design{return{id:'a1',name:'qr.png',path:'batch/qr.png',url:'data:image/png;base64,AAAA',mime:'image/png',imageWidth:300,imageHeight:300,width:40,height:40,quantity:2,shape:'rectangle',radius:0,rotation:0,enabled:true,selected:false,...overrides}}

describe('export layers match layout',()=>{
  it('emits one SVG per sheet at the exact configured physical size',async()=>{
    const designs=[design({quantity:2,width:40,height:40})]
    const layout=await pack(designs,sheet)
    const svgs=buildSvg(designs,layout,sheet)
    expect(svgs).toHaveLength(1)
    expect(svgs[0]).toContain('width="300.0000mm"')
    expect(svgs[0]).toContain('height="200.0000mm"')
    expect(svgs[0]).toContain('viewBox="0 0 300 200"')
  })
  it('separates print artwork from the cut layer and keeps clean cut geometry',async()=>{
    const designs=[design({shape:'circle',width:40,height:40,quantity:1})]
    const layout=await pack(designs,sheet)
    const [svg]=buildSvg(designs,layout,sheet)
    expect(svg).toContain('id="print-artwork"')
    expect(svg).toContain('id="cut"')
    const cutLayer=svg!.slice(svg!.indexOf('id="cut"'))
    expect(cutLayer.match(/<path/g)?.length).toBe(1)
  })
  it('lists every copy and unplaced piece with physical coordinates in the manifest',async()=>{
    const designs=[design({quantity:2,width:120,height:120}),design({id:'big',path:'big.png',quantity:1,width:400,height:400})]
    const layout=await pack(designs,sheet)
    const csv=buildManifest(designs,layout)
    expect(csv.split('\r\n')).toHaveLength(4)
    expect(csv).toContain('"placed"')
    expect(csv).toContain('"unplaced"')
    expect(csv).toContain('"batch/qr.png"')
  })
  it('emits one closed DXF polyline per placed copy in mm',async()=>{
    const designs=[design({quantity:2,width:40,height:40})]
    const layout=await pack(designs,sheet)
    const dxf=buildDxf(designs,layout,sheet)
    expect(dxf).toHaveLength(1)
    expect(dxf[0]!.match(/LWPOLYLINE/g)?.length).toBe(2)
    expect(dxf[0]).toContain('$INSUNITS')
    expect(dxf[0]!.trimEnd().endsWith('EOF')).toBe(true)
  })
  it('places the cut contour exactly where the preview shows it',async()=>{
    const designs=[design({shape:'rectangle',width:40,height:40,quantity:1})]
    const layout=await pack(designs,sheet)
    const piece=layout.sheets[0]![0]!
    const points=piecePoints(piece,designs[0]!)
    const xs=points.map(p=>p.x),ys=points.map(p=>p.y)
    expect(Math.min(...xs)).toBeCloseTo(piece.x,6)
    expect(Math.min(...ys)).toBeCloseTo(piece.y,6)
    expect(Math.max(...xs)).toBeCloseTo(piece.x+piece.width,6)
    expect(Math.max(...ys)).toBeCloseTo(piece.y+piece.height,6)
  })
  it('sends overflow to unplaced when limited to a single sheet',async()=>{
    const designs=[design({quantity:4,width:120,height:120})]
    const layout=await pack(designs,sheet,[0,90],1)
    expect(layout.sheets).toHaveLength(1)
    expect(layout.sheets[0]!.length+layout.unplaced.length).toBe(4)
    expect(layout.unplaced.length).toBeGreaterThan(0)
  })
})
