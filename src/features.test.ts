import { describe, expect, it } from 'vitest'
import { buildCutPdf, buildDxf, buildManifest, buildPdf, buildSvg, cutContours } from './export'
import { holeError, localToSheet, pack, type Design, type QrConfig, type Sheet } from './model'
import { qrMatrix, qrWarnings } from './qr'
import { defaultMachineProfile, estimateCutting } from './production'

const sheet:Sheet={width:300,height:200,unit:'mm',marginTop:5,marginRight:5,marginBottom:5,marginLeft:5,clearance:0}
const hole=(x=20,y=20)=>({id:'h',diameter:4,x,y})
const qr=(over:Partial<QrConfig>={}):QrConfig=>({enabled:true,source:'generated',text:'CUTLINE',ecLevel:'M',sizeMm:16,x:12,y:12,quietModules:4,rotation:0,dark:'#000000',light:'#ffffff',...over})
function design(overrides:Partial<Design>={}):Design{return{id:'a1',name:'qr.png',path:'batch/qr.png',url:'data:image/png;base64,AAAA',mime:'image/png',imageWidth:300,imageHeight:300,width:40,height:40,quantity:2,shape:'rectangle',radius:0,rotation:0,enabled:true,selected:false,borderMm:0,borderColor:'#000000',...overrides}}

describe('keychain holes',()=>{
  it('validates a hole against the true contour, not just the bounding box',()=>{
    const d=design({shape:'circle',width:40,height:40})
    expect(holeError(hole(20,20),d,1)).toBeNull()
    expect(holeError(hole(1,20),d,1)).not.toBeNull()
    expect(holeError(hole(20,20),d,25)).not.toBeNull()
    expect(holeError({id:'h',diameter:0,x:20,y:20},d,1)).not.toBeNull()
  })
  it('keeps a hole glued to the artwork through every nesting rotation',()=>{
    const d=design({shape:'rectangle',width:40,height:40})
    for(const rotation of [0,90,180,270,37]){
      const piece={x:5,y:7,rotation}
      const a=localToSheet({x:10,y:10},piece,d), b=localToSheet({x:30,y:10},piece,d)
      expect(Math.hypot(a.x-b.x,a.y-b.y)).toBeCloseTo(20,6)
    }
  })
  it('cuts holes only on the cut layer, never through the print artwork',async()=>{
    const designs=[design({shape:'circle',width:40,height:40,quantity:1,holes:[hole()],qr:qr()})]
    const layout=await pack(designs,sheet)
    const [svg]=buildSvg(designs,layout,sheet)
    const print=svg!.slice(svg!.indexOf('id="print-artwork"'),svg!.indexOf('id="cut"'))
    const cut=svg!.slice(svg!.indexOf('id="cut"'))
    expect(cut.match(/data-kind="outline"/g)).toHaveLength(1)
    expect(cut.match(/data-kind="hole"/g)).toHaveLength(1)
    expect(print).toContain('<rect')
    expect(cut).not.toContain('<rect')
  })
  it('routes external outlines to CUT and holes to HOLES in the DXF',async()=>{
    const designs=[design({shape:'rectangle',width:40,height:40,quantity:2,holes:[hole()]})]
    const layout=await pack(designs,sheet)
    const [dxf]=buildDxf(designs,layout,sheet)
    expect(dxf!.match(/LWPOLYLINE/g)).toHaveLength(4)
    expect(dxf).toContain('HOLES')
    expect(cutContours(designs,layout).filter(c=>c.kind==='outline')).toHaveLength(2)
    expect(cutContours(designs,layout).filter(c=>c.kind==='hole')).toHaveLength(2)
  })
})

describe('QR codes',()=>{
  it('builds a deterministic square matrix locally',()=>{
    const m=qrMatrix('CUTLINE','M')
    expect(m.size).toBeGreaterThan(0)
    expect(typeof m.get(1,1)).toBe('boolean')
    const m2=qrMatrix('CUTLINE','M')
    let diff=0
    for(let r=0;r<m.size;r++)for(let c=0;c<m.size;c++)if(m.get(c,r)!==m2.get(c,r))diff++
    expect(diff).toBe(0)
  })
  it('warns on too-small codes and quiet zones but passes a well-sized one',()=>{
    expect(qrWarnings(8,qrMatrix('x','M'),2).length).toBeGreaterThan(0)
    expect(qrWarnings(30,qrMatrix('x','M'),4)).toEqual([])
  })
})

describe('print / cut separation',()=>{
  it('produces valid PDFs for print (no cut) and cut (vector only)',async()=>{
    const v=design({mime:'application/octet-stream',quantity:1,shape:'rectangle',width:40,height:40,holes:[hole()]})
    const print=new TextDecoder().decode((await buildPdf([v],await pack([v],sheet),sheet)).slice(0,5))
    const cut=new TextDecoder().decode((await buildCutPdf([v],await pack([v],sheet),sheet)).slice(0,5))
    expect(print).toBe('%PDF-')
    expect(cut).toBe('%PDF-')
  })
  it('records hole count and QR source in the manifest',()=>{
    const d=design({holes:[hole(),hole(15,15)],qr:qr()})
    const layout={sheets:[[{id:'p1',designId:'a1',copy:1,sheet:0,x:0,y:0,width:40,height:40,rotation:0}]],unplaced:[],utilization:[1]}
    const csv=buildManifest([d],layout as never)
    expect(csv).toContain('"hole_count"')
    expect(csv).toContain('"2"')
    expect(csv).toContain('"generated"')
  })
})

describe('cutting-time estimator',()=>{
  it('scales with contour length, holes and feed rate, and flags missing inputs',async()=>{
    const designs=[design({shape:'rectangle',width:40,height:40,quantity:1,holes:[hole()]})]
    const layout=await pack(designs,sheet)
    const p=defaultMachineProfile
    const e=estimateCutting(designs,layout,p)
    expect(e.externalLengthMm).toBeCloseTo(160,1)
    expect(e.holeLengthMm).toBeGreaterThan(12)
    expect(e.contourCount).toBe(2)
    expect(e.laserOnSeconds).toBeCloseTo((e.externalLengthMm+e.holeLengthMm)/p.cutSpeedMmPerSecond,6)
    const fast=estimateCutting(designs,layout,{...p,cutSpeedMmPerSecond:p.cutSpeedMmPerSecond*2})
    expect(fast.laserOnSeconds).toBeCloseTo(e.laserOnSeconds/2,6)
    expect(estimateCutting(designs,layout,{...p,cutSpeedMmPerSecond:0}).missing.join(' ')).toContain('cutting speed')
  })
})
