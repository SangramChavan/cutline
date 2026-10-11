import { useEffect, useMemo, useRef, useState } from 'react'
import JSZip from 'jszip'
import { buildDxf, buildManifest, buildPdf, buildSvg, makePng } from './export'
import { fromMm, pack, pathPoints, toMm, validatePolygon, type Decide, type Design, type Layout, type Shape, type Sheet } from './model'
import { decidePlacement } from './layaBridge'
import { defaultProductionInputs, formatDuration, summarize, type ProductionInputs } from './production'
import NestWorker from './nest.worker?worker'

const extensions = new Set(['png','jpg','jpeg','webp','svg'])
const initialSheet: Sheet = {width:600,height:400,unit:'mm',marginTop:10,marginRight:10,marginBottom:10,marginLeft:10,clearance:0}
const id=()=>crypto.randomUUID()
const imageMime=(name:string)=>({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',svg:'image/svg+xml'}[name.split('.').at(-1)!.toLowerCase()]||'')
const shapes: Shape[]=['rectangle','square','rounded','circle','ellipse','polygon','svg']
async function fileHash(file:Blob){const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')}
function newDesign(name:string,path:string,url:string,mime:string,w:number,h:number):Design{return{id:id(),name,path,url,mime,imageWidth:w,imageHeight:h,width:50,height:50,quantity:1,shape:'rectangle',radius:5,rotation:0,enabled:true,selected:false}}
function designError(d:Design):string|null{
  if(d.width<=0||d.height<=0)return 'Set the physical piece dimensions'
  if(d.shape==='polygon'&&(!d.points||d.points.length<3))return 'Add at least 3 polygon vertices'
  if(d.shape==='svg'&&!d.svgPath)return 'Paste a closed polygon SVG outline'
  if(d.shape==='polygon'||d.shape==='svg')return validatePolygon(pathPoints(d))
  return null
}
const DEFAULT_LAYA_MODEL='convaiinnovations/laya'
function readLayaPrefs(){try{const p=JSON.parse(localStorage.getItem('cutline-laya')||'{}');return{on:!!p.on,model:typeof p.model==='string'&&p.model.trim()?p.model:DEFAULT_LAYA_MODEL}}catch{return{on:false,model:DEFAULT_LAYA_MODEL}}}

export default function App(){
  const [designs,setDesigns]=useState<Design[]>([])
  const [sheet,setSheet]=useState(initialSheet)
  const [layout,setLayout]=useState<Layout>({sheets:[],unplaced:[],utilization:[]})
  const [activeSheet,setActiveSheet]=useState(0)
  const [busy,setBusy]=useState('')
  const [message,setMessage]=useState('')
  const [angleMode,setAngleMode]=useState<'free'|'90'>('90')
  const [zoom,setZoom]=useState(1)
  const [border,setBorder]=useState(false)
  const [borderColor,setBorderColor]=useState('#ec644f')
  const [history,setHistory]=useState<Layout[]>([])
  const [future,setFuture]=useState<Layout[]>([])
  const [profileName,setProfileName]=useState('')
  const [bulk,setBulk]=useState({w:'',h:'',q:''})
  const [pxScale,setPxScale]=useState(1)
  const [locked,setLocked]=useState<string[]>([])
  const [prod,setProd]=useState<ProductionInputs>(defaultProductionInputs)
  const [inspect,setInspect]=useState<string|null>(null)
  const [singleSheet,setSingleSheet]=useState(false)
  const [layaOn,setLayaOn]=useState(readLayaPrefs().on)
  const [layaModel,setLayaModel]=useState(readLayaPrefs().model)
  const fileRef=useRef<HTMLInputElement>(null)
  const canvasRef=useRef<HTMLDivElement>(null)
  const fileUrls=useRef<string[]>([])
  const nestRef=useRef<Worker|null>(null)
  const activePieces=layout.sheets[activeSheet]??[]
  const activeDesigns=useMemo(()=>new Map(designs.map(d=>[d.id,d])),[designs])
  const summary=useMemo(()=>summarize(designs,layout,sheet,prod),[designs,layout,sheet,prod])
  const inspected=activePieces.find(p=>p.id===inspect)??null
  const inspectedDesign=inspected?activeDesigns.get(inspected.designId)??null:null

  useEffect(()=>()=>{fileUrls.current.forEach(URL.revokeObjectURL);nestRef.current?.terminate()},[])
  useEffect(()=>{localStorage.setItem('cutline-sheet-profile',JSON.stringify(sheet))},[sheet])
  useEffect(()=>{localStorage.setItem('cutline-laya',JSON.stringify({on:layaOn,model:layaModel}))},[layaOn,layaModel])

  async function addFiles(files:FileList|File[]){
    const list=Array.from(files);setBusy(`Reading ${list.length} files…`);setMessage('')
    const fresh:Design[]=[]
    for(let i=0;i<list.length;i++){
      const file=list[i]!,ext=file.name.split('.').at(-1)?.toLowerCase()||''
      if(!extensions.has(ext)){setMessage(`${file.name}: unsupported format. Supported formats: PNG, JPG, JPEG, WebP and SVG.`);continue}
      const url=URL.createObjectURL(file);fileUrls.current.push(url)
      const path=(file as File&{webkitRelativePath?:string}).webkitRelativePath||file.name
      const hash=await fileHash(file).catch(()=>'')
      try{
        if(ext==='svg'){
          const text=await file.text();const doc=new DOMParser().parseFromString(text,'image/svg+xml')
          if(doc.querySelector('parsererror')||!doc.documentElement.matches('svg'))throw Error('Invalid SVG document')
          const vb=doc.documentElement.getAttribute('viewBox')?.split(/[ ,]+/).map(Number)
          const width=Number(doc.documentElement.getAttribute('width')?.replace(/[a-z%]+/ig,''))||vb?.[2]||300,height=Number(doc.documentElement.getAttribute('height')?.replace(/[a-z%]+/ig,''))||vb?.[3]||300
          const d=newDesign(file.name,path,url,'image/svg+xml',width,height)
          d.hash=hash
          const paths=Array.from(doc.querySelectorAll('path')).map(e=>e.getAttribute('d')||'').filter(Boolean)
          if(paths.length===1&&/^\s*M[\d\s.,+-]+(?:L[\d\s.,+-]+)+Z\s*$/i.test(paths[0]!))d.svgPath=paths[0]
          fresh.push(d)
        }else{
          const image=new Image();image.src=url;await image.decode();fresh.push({...newDesign(file.name,path,url,imageMime(file.name),image.naturalWidth,image.naturalHeight),hash})
        }
      }catch(e){setMessage(`${file.name}: ${e instanceof Error?e.message:'could not read file'}. It was skipped and not added.`)}
      if(i%12===11)await new Promise(resolve=>setTimeout(resolve,0))
    }
    setDesigns(old=>[...old,...fresh]);setBusy('');if(fresh.length)setMessage(`Added ${fresh.length} artwork file${fresh.length===1?'':'s'}. Assign and validate the physical shape before nesting.`)
  }
  async function handleZip(file:File){
    setBusy('Extracting ZIP locally…');try{const zip=await JSZip.loadAsync(file);const images=Object.values(zip.files).filter(f=>!f.dir&&extensions.has(f.name.split('.').at(-1)?.toLowerCase()||''));const extracted:File[]=[];for(let i=0;i<images.length;i++){const entry=images[i]!;const blob=await entry.async('blob');extracted.push(new File([blob],entry.name.split('/').at(-1)!,{type:imageMime(entry.name)}));Object.defineProperty(extracted.at(-1),'webkitRelativePath',{value:entry.name});if(i%12===11)await new Promise(resolve=>setTimeout(resolve,0))}await addFiles(extracted)}catch(e){setBusy('');setMessage(`ZIP could not be read: ${e instanceof Error?e.message:'invalid archive'}`)}
  }
  function changeDesign(idValue:string,patch:Partial<Design>){setDesigns(old=>old.map(d=>d.id===idValue?{...d,...patch}:d))}
  const selectedCount=designs.filter(d=>d.selected).length
  const allSelected=designs.length>0&&designs.every(d=>d.selected)
  const bulkTargets=selectedCount?designs.filter(d=>d.selected):designs
  function applyBulk(){
    const patch:Partial<Design>={}
    if(bulk.w!=='')patch.width=toMm(Number(bulk.w),sheet.unit)
    if(bulk.h!=='')patch.height=toMm(Number(bulk.h),sheet.unit)
    if(bulk.q!=='')patch.quantity=Math.max(0,Math.floor(Number(bulk.q)))
    if(!Object.keys(patch).length){setMessage('Enter a width, height or quantity to apply to the selection.');return}
    const ids=new Set(bulkTargets.map(d=>d.id))
    setDesigns(old=>old.map(d=>ids.has(d.id)?{...d,...patch}:d))
    setMessage(`Applied to ${ids.size} design${ids.size===1?'':'s'}${selectedCount?' (selected)':' (all images)'}.`)
  }
  function matchImageSize(){
    const scale=pxScale>0?pxScale:1
    const ids=new Set(bulkTargets.map(d=>d.id))
    setDesigns(old=>old.map(d=>ids.has(d.id)&&d.imageWidth>0&&d.imageHeight>0?{...d,width:d.imageWidth*scale,height:d.imageHeight*scale}:d))
    setMessage(`Set ${ids.size} design${ids.size===1?'':'s'} to their image size at ${scale} mm/px${selectedCount?' (selected)':' (all images)'}.`)
  }
  function applyLayout(next:Layout){
    setLayout(next);setActiveSheet(0);setBusy('')
    setMessage(next.unplaced.length?`${next.unplaced.length} piece(s) cannot fit. Adjust dimensions, sheet, quantity${singleSheet?' or single-sheet mode':' or clearance'}.`:`Nesting complete: ${next.sheets.reduce((n,s)=>n+s.length,0)} exact copies across ${next.sheets.length} sheet(s).`)
  }
  function recalculate(){
    const invalid=designs.filter(d=>d.enabled&&designError(d))
    if(invalid.length){setMessage(`Preflight blocked: ${invalid.length} design(s) have missing dimensions, quantity, or invalid cutting geometry. Review highlighted designs.`);return}
    if(!designs.some(d=>d.enabled)){setMessage('Add and enable artwork before nesting.');return}
    const angleOptions=angleMode==='90'?[0,90,180,270]:[0,15,30,45,60,75,90,105,120,135,150,165,180,195,210,225,240,255,270,285,300,315,330,345]
    const maxSheets=singleSheet?1:Infinity
    setHistory(old=>[...old,layout]);setFuture([])
    if(layaOn){
      setBusy('Nesting with Laya model judgment…')
      const decide:Decide=(candidates,ctx)=>decidePlacement(candidates,ctx,{modelId:layaModel,status:setBusy}).then(choice=>choice.candidate)
      void pack(designs,sheet,angleOptions,maxSheets,{decide}).then(applyLayout)
      return
    }
    setBusy('Nesting actual piece outlines…')
    const run=()=>void pack(designs,sheet,angleOptions,maxSheets).then(applyLayout)
    nestRef.current?.terminate()
    try{
      const worker=new NestWorker()
      nestRef.current=worker
      worker.onmessage=(e:MessageEvent<Layout>)=>{worker.terminate();nestRef.current=null;applyLayout(e.data)}
      worker.onerror=()=>{worker.terminate();nestRef.current=null;run()}
      worker.postMessage({designs,sheet,angleOptions,maxSheets})
    }catch{window.setTimeout(run,0)}
  }
  function cancelNesting(){nestRef.current?.terminate();nestRef.current=null;setBusy('');setMessage('Nesting cancelled. The previous layout is unchanged.')}
  function updateSheet(key:keyof Sheet,value:number|string){setSheet(old=>({...old,[key]:value} as Sheet));setLayout({sheets:[],unplaced:[],utilization:[]})}
  function download(name:string,blob:Blob){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
  async function exportOne(kind:'pdf'|'svg'|'dxf'|'manifest'|'png'|'zip'){
    if(!layout.sheets.length){setMessage('Nest the job before exporting.');return}
    if(layout.unplaced.length){setMessage('Export blocked: place or remove unplaced pieces first so production files match the requested quantity.');return}
    setBusy(`Preparing ${kind.toUpperCase()}…`)
    const opts={border,cut:true,cutColor:borderColor,cutWidthMm:0.25,marks:true}
    try{
      if(kind==='pdf')download('cutline-print.pdf',new Blob([await buildPdf(designs,layout,sheet,opts)],{type:'application/pdf'}))
      if(kind==='svg')buildSvg(designs,layout,sheet,opts).forEach((s,i)=>download(`cut-sheet-${i+1}.svg`,new Blob([s],{type:'image/svg+xml'})))
      if(kind==='dxf')buildDxf(designs,layout,sheet).forEach((s,i)=>download(`cut-sheet-${i+1}.dxf`,new Blob([s],{type:'application/dxf'})))
      if(kind==='manifest')download('production-manifest.csv',new Blob([buildManifest(designs,layout)],{type:'text/csv'}))
      if(kind==='png')download('layout-preview.png',new Blob([await makePng(designs,activePieces,sheet)],{type:'image/png'}))
      if(kind==='zip'){
        const zip=new JSZip();zip.file('print.pdf',await buildPdf(designs,layout,sheet,opts));buildSvg(designs,layout,sheet,opts).forEach((s,i)=>zip.file(`cut-sheet-${i+1}.svg`,s));buildDxf(designs,layout,sheet).forEach((s,i)=>zip.file(`cut-sheet-${i+1}.dxf`,s));zip.file('production-manifest.csv',buildManifest(designs,layout));zip.file('layout-preview.png',await makePng(designs,activePieces,sheet));download('cutline-production-files.zip',await zip.generateAsync({type:'blob'}))
      }
    }catch(e){setMessage(`Export failed: ${e instanceof Error?e.message:'unknown export error'}`)}finally{setBusy('')}
  }
  async function importCsv(file:File){
    const text=await file.text(),lines=text.split(/\r?\n/).filter(Boolean),header=(lines.shift()||'').split(',').map(s=>s.replace(/^"|"$/g,'').trim().toLowerCase()),index=(...keys:string[])=>header.findIndex(h=>keys.includes(h))
    const pathCol=index('path','relative_path','filename','name'),wCol=index('width','width_mm','piece_width'),hCol=index('height','height_mm','piece_height'),qCol=index('quantity','qty'),shapeCol=index('shape','cut_shape'),rCol=index('radius','corner_radius')
    if(pathCol<0||wCol<0||hCol<0){setMessage('CSV needs filename/path, width and height columns. Dimensions are interpreted in the selected sheet unit.');return}
    const rows=lines.map(line=>line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(v=>v.replace(/^"|"$/g,'').replace(/""/g,'"')))
    let missed=0
    setDesigns(old=>old.map(d=>{const row=rows.find(r=>r[pathCol]===d.path||r[pathCol]===d.name);if(!row){missed++;return d};const width=Number(row[wCol]),height=Number(row[hCol]),shape=(row[shapeCol]||d.shape).toLowerCase() as Shape;return{...d,width:toMm(width,sheet.unit),height:toMm(height,sheet.unit),quantity:qCol>=0?Math.max(1,Number(row[qCol])||1):d.quantity,shape:shapes.includes(shape)?shape:d.shape,radius:rCol>=0?Number(row[rCol])||d.radius:d.radius}}))
    setMessage(`Applied CSV settings. ${missed} artwork item(s) had no matching row and kept their current settings.`)
  }
  function saveProfile(){if(!profileName.trim())return;const profiles=JSON.parse(localStorage.getItem('cutline-profiles')||'{}');profiles[profileName]={sheet,designDefaults:{shape:'rectangle',width:50,height:50,quantity:1},border,borderColor,angleMode};localStorage.setItem('cutline-profiles',JSON.stringify(profiles));setMessage(`Saved profile “${profileName}” in this browser.`)}
  function loadProfiles(){return Object.keys(JSON.parse(localStorage.getItem('cutline-profiles')||'{}'))}
  function undo(){if(history.length){setFuture(old=>[layout,...old]);setLayout(history.at(-1)!);setHistory(history.slice(0,-1))}}
  function redo(){if(future.length){setHistory(old=>[...old,layout]);setLayout(future[0]!);setFuture(future.slice(1))}}
  function movePiece(piece:Layout['sheets'][number][number],event:React.PointerEvent){
    const rect=canvasRef.current!.getBoundingClientRect(),scale=Math.min(rect.width/toMm(sheet.width,sheet.unit),rect.height/toMm(sheet.height,sheet.unit))*zoom
    const startX=event.clientX,startY=event.clientY,ox=piece.x,oy=piece.y
    const onMove=(e:PointerEvent)=>{const x=Math.max(sheet.marginLeft,Math.min(toMm(sheet.width,sheet.unit)-piece.width-sheet.marginRight,ox+(e.clientX-startX)/scale)),y=Math.max(sheet.marginTop,Math.min(toMm(sheet.height,sheet.unit)-piece.height-sheet.marginBottom,oy+(e.clientY-startY)/scale));setLayout(old=>({...old,sheets:old.sheets.map((group,idx)=>idx===activeSheet?group.map(p=>p.id===piece.id?{...p,x,y}:p):group)}))}
    const onUp=()=>{window.removeEventListener('pointermove',onMove);window.removeEventListener('pointerup',onUp)}
    window.addEventListener('pointermove',onMove);window.addEventListener('pointerup',onUp)
  }

  const maxW=toMm(sheet.width,sheet.unit),maxH=toMm(sheet.height,sheet.unit)
  const maxPacks=designs.reduce((n,d)=>n+(d.enabled?d.quantity:0),0)
  return <main className="app-shell">
    <header className="topbar"><a className="brand" href="#"><span className="brand-mark">C</span><span>CUTLINE<small>ACRYLIC PRODUCTION STUDIO</small></span></a><div className="top-status"><span className="live-dot"/> LOCAL WORKSPACE <span className="top-divider"/> JOB · {designs.length?`${designs.length} DESIGNS`:'UNTITLED'}</div><button className="quiet-button" onClick={()=>{if(confirm('Start a new job? Current artwork is removed from memory.')){setDesigns([]);setLayout({sheets:[],unplaced:[],utilization:[]})}}}>New job <span>↗</span></button></header>
    <div className="workspace">
      <aside className="side-panel">
        <div className="panel-heading"><div><span className="eyebrow">PRODUCTION SETUP</span><h1>Build a cut layout</h1></div><span className="step-count">01 / 04</span></div>
        <div className="section-label"><span>01</span> ARTWORK FILES <b>{designs.length.toString().padStart(2,'0')}</b></div>
        <button className="upload-zone" onClick={()=>fileRef.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const f=Array.from(e.dataTransfer.files);if(f.length===1&&f[0]!.name.toLowerCase().endsWith('.zip'))void handleZip(f[0]!);else void addFiles(f)}}>
          <span className="upload-icon">↑</span><strong>Drop artwork or a ZIP here</strong><span>PNG · JPG · WEBP · SVG · CSV settings</span><small>Files stay on this device</small>
        </button><input hidden ref={fileRef} type="file" multiple accept=".png,.jpg,.jpeg,.webp,.svg,.zip" onChange={e=>{const f=Array.from(e.target.files||[]);for(const file of f)if(file.name.toLowerCase().endsWith('.zip'))void handleZip(file);else if(file.name.toLowerCase().endsWith('.csv'))void importCsv(file);else void addFiles([file]);e.currentTarget.value=''}}/>
        <div className="quick-row"><label className="file-button">＋ Add artwork<input type="file" multiple accept=".png,.jpg,.jpeg,.webp,.svg" onChange={e=>e.target.files&&void addFiles(e.target.files)}/></label><label className="file-button secondary">↥ Import CSV<input type="file" accept=".csv" onChange={e=>e.target.files?.[0]&&void importCsv(e.target.files[0])}/></label></div>
        {designs.length>0&&<div className="bulk-bar">
          <label className="select-all"><input type="checkbox" checked={allSelected} onChange={e=>setDesigns(old=>old.map(d=>({...d,selected:e.target.checked})))}/><b>{selectedCount?`${selectedCount} selected`:'Select all'}</b></label>
          <div className="bulk-fields"><span className="bulk-scope">{selectedCount?'→ SELECTED':'→ ALL'}</span><label>W<input type="number" min="0.1" step="0.1" placeholder="—" value={bulk.w} onChange={e=>setBulk(b=>({...b,w:e.target.value}))}/></label><label>H<input type="number" min="0.1" step="0.1" placeholder="—" value={bulk.h} onChange={e=>setBulk(b=>({...b,h:e.target.value}))}/></label><label>QTY<input type="number" min="1" step="1" placeholder="—" value={bulk.q} onChange={e=>setBulk(b=>({...b,q:e.target.value}))}/></label><button className="bulk-apply" onClick={applyBulk}>Apply</button></div>
          <div className="bulk-match"><span>px→mm</span><input type="number" min="0.01" step="0.1" value={pxScale} onChange={e=>setPxScale(Number(e.target.value)||1)}/><button onClick={matchImageSize}>Size = image</button></div>
        </div>}
        <section className="design-list">
          {designs.length===0?<div className="empty-art"><div className="empty-art-icon">▧</div><p>Your artwork will appear here</p><span>Add a ZIP to keep a production batch together.</span></div>:designs.map((d,i)=>{
            const error=designError(d)
            const duplicate=designs.some((other,j)=>j!==i&&(d.hash?other.hash===d.hash:other.name===d.name))
            return <article className={`design-card ${error?'invalid':''}`} key={d.id}>
              <div className="design-main"><input type="checkbox" className="pick" aria-label={`Select ${d.name}`} checked={!!d.selected} onChange={()=>changeDesign(d.id,{selected:!d.selected})}/><div className="thumb">{d.mime==='image/svg+xml'?<img src={d.url} alt=""/>:<img src={d.url} alt=""/>}</div><div className="design-name"><strong title={d.path}>{d.name}</strong><span title={d.path}>{d.path}</span><small>{d.imageWidth} × {d.imageHeight} px{duplicate?(d.hash?' · duplicate file':' · duplicate filename'):''}</small></div><button className={`toggle ${d.enabled?'on':''}`} aria-label="Toggle design" onClick={()=>changeDesign(d.id,{enabled:!d.enabled})}>{d.enabled?'✓':'−'}</button></div>
              <div className="design-fields"><label>W <input aria-label="Piece width mm" type="number" min="0.1" step="0.1" value={Number(fromMm(d.width,sheet.unit).toFixed(2))} onChange={e=>changeDesign(d.id,{width:toMm(Number(e.target.value),sheet.unit)})}/><i>{sheet.unit}</i></label><label>H <input aria-label="Piece height mm" type="number" min="0.1" step="0.1" value={Number(fromMm(d.height,sheet.unit).toFixed(2))} onChange={e=>changeDesign(d.id,{height:toMm(Number(e.target.value),sheet.unit)})}/><i>{sheet.unit}</i></label><label>QTY <input aria-label="Quantity" type="number" min="1" step="1" value={d.quantity} onChange={e=>changeDesign(d.id,{quantity:Math.max(0,Number(e.target.value))})}/></label></div>
              <div className="design-fields secondary-fields"><label className="shape-select">SHAPE <select aria-label="Cutting shape" value={d.shape} onChange={e=>changeDesign(d.id,{shape:e.target.value as Shape})}>{shapes.map(s=><option value={s} key={s}>{s.toUpperCase()}</option>)}</select></label>{d.shape==='rounded'&&<label>R <input type="number" value={d.radius} onChange={e=>changeDesign(d.id,{radius:Number(e.target.value)})}/><i>{sheet.unit}</i></label>}<label>ROT° <select value={d.rotation} onChange={e=>changeDesign(d.id,{rotation:Number(e.target.value)})}><option value="0">0°</option><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option></select></label><button className="delete-button" aria-label="Remove design" onClick={()=>setDesigns(old=>old.filter(v=>v.id!==d.id))}>×</button></div>
              {d.shape==='polygon'&&<label className="svg-input">Vertices (x,y in physical units)<textarea placeholder="0,0  40,0  35,30  5,35" value={d.points?.map(p=>`${p.x},${p.y}`).join(' ')||''} onChange={e=>{const points=e.target.value.trim().split(/\s+/).map(pair=>pair.split(',').map(Number)).filter(pair=>pair.length===2&&pair.every(Number.isFinite)).map(([x,y])=>({x:x!,y:y!}));changeDesign(d.id,{points})}}/></label>}
              {d.shape==='svg'&&<label className="svg-input">Closed polygon SVG outline <textarea placeholder="M 0 0 L 40 0 L 35 30 L 0 25 Z" value={d.svgPath||''} onChange={e=>changeDesign(d.id,{svgPath:e.target.value})}/><small>SVG artwork is separate; enter a simple closed polygon path here.</small></label>}
              {error&&<div className="validation">! {error}</div>}
            </article>
          })}
        </section>
        <div className="side-divider"/><div className="section-label"><span>02</span> SHEET & CLEARANCE</div>
        <div className="sheet-dimensions"><label>WIDTH <div className="unit-input"><input type="number" min="1" value={sheet.width} onChange={e=>updateSheet('width',Number(e.target.value))}/><span>{sheet.unit}</span></div></label><button className="orientation" title="Swap width and height" onClick={()=>setSheet(s=>({...s,width:s.height,height:s.width}))}>⇄</button><label>HEIGHT <div className="unit-input"><input type="number" min="1" value={sheet.height} onChange={e=>updateSheet('height',Number(e.target.value))}/><span>{sheet.unit}</span></div></label><select aria-label="Units" className="unit-select" value={sheet.unit} onChange={e=>updateSheet('unit',e.target.value)}><option value="mm">mm</option><option value="cm">cm</option><option value="in">in</option></select></div>
        <div className="margin-label">EDGE MARGINS <span>Top · Right · Bottom · Left</span></div><div className="margins">{(['marginTop','marginRight','marginBottom','marginLeft'] as const).map((key,i)=><label key={key} title={['Top','Right','Bottom','Left'][i]}><span>{['T','R','B','L'][i]}</span><input type="number" min="0" value={sheet[key]} onChange={e=>updateSheet(key,Number(e.target.value))}/></label>)}</div>
        <label className="clearance-row"><span>Minimum clearance <small>0 = true zero-gap</small></span><span className="clearance-input"><input type="number" min="0" step="0.1" value={sheet.clearance} onChange={e=>updateSheet('clearance',Number(e.target.value))}/><i>{sheet.unit}</i></span></label>
        <div className="margin-label">NESTING ROTATION</div><div className="rotation-choice"><button className={angleMode==='90'?'active':''} onClick={()=>setAngleMode('90')}>90° increments</button><button className={angleMode==='free'?'active':''} onClick={()=>setAngleMode('free')}>15° increments</button></div><label className="single-sheet"><input type="checkbox" checked={singleSheet} onChange={e=>setSingleSheet(e.target.checked)}/>Single sheet only</label>
        <div className="margin-label">NESTING JUDGMENT</div>
        <label className="single-sheet" title="Ask the real Laya System-1 model to pick each placement; falls back to the built-in geometric judge when the model is unavailable."><input type="checkbox" checked={layaOn} onChange={e=>setLayaOn(e.target.checked)}/>Use Laya model judgment <small style={{color:'#a2a49c'}}>first run downloads it</small></label>
        {layaOn&&<label className="clearance-row"><span>Model <small>Hugging Face repo or URL</small></span><span className="clearance-input" style={{width:'170px'}}><input type="text" value={layaModel} onChange={e=>setLayaModel(e.target.value)}/></span></label>}
        <label className="clearance-row" style={{marginTop:8}}><span>Judgment source</span><span>{layaOn?'Laya ↔ geo fallback':'Geometric judge'}</span></label>
        <small className="note">Heuristic nesting by default; Laya judgment is local ONNX in this browser (weights ~300–800 MB). Polygon approximations use actual contour collision tests.</small>
        <div className="profile-row"><input value={profileName} placeholder="Profile name" onChange={e=>setProfileName(e.target.value)}/><button onClick={saveProfile}>Save profile</button><select aria-label="Load profile" value="" onChange={e=>{const profiles=JSON.parse(localStorage.getItem('cutline-profiles')||'{}');if(profiles[e.target.value]){const p=profiles[e.target.value];setSheet(p.sheet);setBorder(p.border);setBorderColor(p.borderColor);setAngleMode(p.angleMode)}}}><option value="" disabled>Load…</option>{loadProfiles().map(p=><option key={p}>{p}</option>)}</select></div>
      </aside>
      <section className="stage">
        <div className="stage-head"><div><span className="eyebrow">NESTING PREVIEW · LAYA</span><h2>Sheet composition</h2></div><div className="stage-actions"><button className="icon-button" disabled={!history.length} onClick={undo} title="Undo">↶</button><button className="icon-button" disabled={!future.length} onClick={redo} title="Redo">↷</button><button className="icon-button" onClick={()=>setZoom(z=>Math.min(2.5,z+.15))} title="Zoom in">＋</button><button className="icon-button" onClick={()=>setZoom(z=>Math.max(.5,z-.15))} title="Zoom out">−</button><button className="icon-button fit-button" onClick={()=>setZoom(1)}>Fit</button></div></div>
        <div className="canvas-wrap"><div className="canvas-meta"><span><i className="legend-sheet"/> SHEET BOUNDARY</span><span><i className="legend-cut"/> CUT PATH</span><span><i className="legend-image"/> PRINT ARTWORK</span><span>{sheet.width} × {sheet.height} {sheet.unit}</span></div>
          {activePieces.length?<div className="canvas-viewport"><div className="sheet-canvas" ref={canvasRef} onClick={()=>setInspect(null)} style={{aspectRatio:`${maxW}/${maxH}`,transform:`scale(${zoom})`}}><div className="sheet-margins" style={{top:`${sheet.marginTop/maxH*100}%`,right:`${sheet.marginRight/maxW*100}%`,bottom:`${sheet.marginBottom/maxH*100}%`,left:`${sheet.marginLeft/maxW*100}%`}}/>{activePieces.map(p=>{const d=activeDesigns.get(p.designId)!;return <div key={p.id} className={`piece ${locked.includes(p.id)?'locked':''} ${inspect===p.id?'inspected':''}`} title={`${d.name} · copy ${p.copy} · ${p.width.toFixed(1)}×${p.height.toFixed(1)} mm`} onPointerDown={e=>{if(!locked.includes(p.id))movePiece(p,e)}} onClick={e=>{e.stopPropagation();setInspect(p.id)}} style={{left:`${p.x/maxW*100}%`,top:`${p.y/maxH*100}%`,width:`${p.width/maxW*100}%`,height:`${p.height/maxH*100}%`,borderRadius:d.shape==='circle'?'50%':d.shape==='rounded'?`${d.radius/maxW*100}%`:undefined,transform:`rotate(${p.rotation}deg)`,borderColor:borderColor}}><img src={d.url} alt=""/><span>{p.id.slice(-5)}</span><button className="lock-piece" title="Lock position" onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();setLocked(a=>a.includes(p.id)?a.filter(v=>v!==p.id):[...a,p.id])}}>{locked.includes(p.id)?'●':'○'}</button></div>})}</div></div>:<div className="stage-empty"><div className="stage-empty-mark"><span>+</span></div><h3>Your sheet is ready for nesting</h3><p>Configure each piece outline and the material dimensions. Your layout will appear here.</p><button className="primary-button" onClick={recalculate} disabled={!designs.length}>Calculate nesting <span>→</span></button></div>}
        </div>
        <div className="metrics"><div><span className="metric-icon">▧</span><span>DESIGNS <strong>{designs.filter(d=>d.enabled).length.toString().padStart(2,'0')}</strong></span></div><div><span className="metric-icon">▣</span><span>PIECES <strong>{maxPacks.toString().padStart(2,'0')}</strong></span></div><div><span className="metric-icon">▤</span><span>SHEETS <strong>{layout.sheets.length.toString().padStart(2,'0')}</strong></span></div><div><span className="metric-icon">◩</span><span>UTILIZATION <strong>{layout.utilization[activeSheet]?.toFixed(1)||'0.0'}%</strong></span></div></div>
        <div className="sheet-nav"><div className="tabs">{layout.sheets.map((pieces,i)=><button key={i} className={activeSheet===i?'selected':''} onClick={()=>setActiveSheet(i)}>Sheet {String(i+1).padStart(2,'0')} <span>{pieces.length} pcs</span></button>)}</div><div className="nest-actions">{busy&&<button className="quiet-button" onClick={cancelNesting}>Cancel</button>}<button className="primary-button nest-button" disabled={!!busy||!designs.length} onClick={recalculate}>{busy||'Recalculate layout'} <span>↻</span></button></div></div>
        {message&&<div className="message" role="status">{message}<button onClick={()=>setMessage('')}>×</button></div>}
        {layout.unplaced.length>0&&<div className="unplaced">{layout.unplaced.length} unplaced pieces: {layout.unplaced.slice(0,4).map(p=>p.id).join(', ')}{layout.unplaced.length>4?'…':''}</div>}
        {inspected&&inspectedDesign&&<section className="inspector-panel"><div className="inspector-head"><span className="eyebrow">PIECE INSPECTOR</span><button aria-label="Close inspector" onClick={()=>setInspect(null)}>×</button></div><dl><div><dt>Design</dt><dd>{inspectedDesign.name}</dd></div><div><dt>Source file</dt><dd title={inspectedDesign.path}>{inspectedDesign.path}</dd></div><div><dt>Copy</dt><dd>#{inspected.copy}</dd></div><div><dt>Sheet</dt><dd>{activeSheet+1} of {layout.sheets.length}</dd></div><div><dt>Position</dt><dd>{inspected.x.toFixed(1)}, {inspected.y.toFixed(1)} {sheet.unit}</dd></div><div><dt>Size</dt><dd>{inspected.width.toFixed(1)} × {inspected.height.toFixed(1)} {sheet.unit}</dd></div><div><dt>Rotation</dt><dd>{inspected.rotation}°</dd></div><div><dt>Shape</dt><dd>{inspectedDesign.shape}{locked.includes(inspected.id)?' · locked':''}</dd></div></dl></section>}
        <section className="production-panel"><div className="export-heading"><div><span className="eyebrow">PRODUCTION SUMMARY</span><h3>Material & time estimate</h3></div></div><div className="prod-grid"><div><span>Pieces placed</span><strong>{summary.placedPieces}</strong></div><div><span>Unplaced</span><strong>{summary.unplacedPieces}</strong></div><div><span>Sheets</span><strong>{summary.sheets}</strong></div><div><span>Avg. utilization</span><strong>{(summary.utilization*100).toFixed(1)}%</strong></div><div><span>Cut length</span><strong>{(summary.cutLengthMm/1000).toFixed(2)} m</strong></div><div><span>Est. cut time</span><strong>{formatDuration(summary.estimatedCutSeconds)}</strong></div><div><span>Waste area</span><strong>{(summary.wasteAreaMm2/1e6).toFixed(3)} m²</strong></div>{summary.totalCost>0&&<div><span>Total cost</span><strong>{summary.totalCost.toFixed(2)}</strong></div>}{summary.totalCost>0&&summary.placedPieces>0&&<div><span>Cost / piece</span><strong>{summary.costPerPiece.toFixed(3)}</strong></div>}</div><div className="prod-inputs"><label>Sheet price<input type="number" min="0" step="0.01" value={prod.sheetPrice} onChange={e=>setProd(p=>({...p,sheetPrice:Number(e.target.value)||0}))}/></label><label>Cut speed mm/s<input type="number" min="1" step="1" value={prod.cutSpeedMmPerSecond} onChange={e=>setProd(p=>({...p,cutSpeedMmPerSecond:Math.max(1,Number(e.target.value)||1)}))}/></label><label>Cut rate / min<input type="number" min="0" step="0.01" value={prod.cutRatePerMinute} onChange={e=>setProd(p=>({...p,cutRatePerMinute:Number(e.target.value)||0}))}/></label><label>Pierce sec/pc<input type="number" min="0" step="0.1" value={prod.pierceSecondsPerPiece} onChange={e=>setProd(p=>({...p,pierceSecondsPerPiece:Number(e.target.value)||0}))}/></label></div><small className="note">Estimates only: cut time = contour length ÷ feed rate plus pierce time. Real machines vary with material and toolpath.</small></section>
        <section className="export-panel"><div className="export-heading"><div><span className="eyebrow">PRODUCTION OUTPUT</span><h3>Export files</h3></div><div className="export-toggles"><label className="border-toggle"><input type="checkbox" checked={border} onChange={e=>setBorder(e.target.checked)}/>Print border</label><label className="cut-color">Cut line<input type="color" value={borderColor} onChange={e=>setBorderColor(e.target.value)}/></label></div></div><p>Every output shares one geometry source: the true rotated contour used in the preview. The PDF carries a vector cut layer plus DPI-aware artwork; SVG and DXF are one file per sheet.</p><div className="export-buttons"><button onClick={()=>void exportOne('pdf')}>▤ <span>Print + cut PDF</span><small>Artwork + vector cut lines</small></button><button onClick={()=>void exportOne('svg')}>⌁ <span>Cutting SVG</span><small>One file per sheet</small></button><button onClick={()=>void exportOne('dxf')}>⌗ <span>Cutting DXF</span><small>CAD / laser handoff</small></button><button onClick={()=>void exportOne('manifest')}>▦ <span>Manifest CSV</span><small>Piece-level positions</small></button><button onClick={()=>void exportOne('png')}>▧ <span>Preview PNG</span><small>Active sheet proof</small></button><button className="zip-export" onClick={()=>void exportOne('zip')}>↓ <span>Production ZIP</span><small>All outputs, packaged</small></button></div><div className="export-footnote">*PDF artwork is browser-embedded RGB; a color-managed RIP conversion may still be required. Cut contours for circles and curves are polygon approximations. Always verify scale and seam in your cutter software at 100% before production.</div></section>
        <footer>BUILT FOR THE DETAILS THAT MATTER <span>•</span> LOCAL-FIRST PRODUCTION</footer>
      </section>
    </div>
    {busy&&<div className="busy-bar"><span className="spinner"/>{busy}</div>}
  </main>
}
