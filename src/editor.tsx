import { useRef, useState } from 'react'
import { holeClearance, holeError, holePreset, type Design, type Hole, type QrConfig } from './model'
import { qrMatrix, qrWarnings } from './qr'

export function defaultQr(d: Pick<Design, 'width' | 'height'>, seed?: Partial<QrConfig>): QrConfig {
  const sizeMm = seed?.sizeMm ?? Math.max(8, Math.min(24, d.width * 0.3))
  return { enabled: true, source: 'generated', text: seed?.text ?? '', ecLevel: seed?.ecLevel ?? 'M', sizeMm, x: Math.round((d.width - sizeMm) / 2), y: Math.round((d.height - sizeMm) / 2), quietModules: 4, rotation: 0, dark: '#000000', light: '#ffffff' }
}

const HOLE_PRESETS: { key: 'top-centre' | 'top-left' | 'top-right' | 'two-top' | 'centre'; label: string }[] = [
  { key: 'top-centre', label: 'Top centre' }, { key: 'top-left', label: 'Top left' }, { key: 'top-right', label: 'Top right' }, { key: 'two-top', label: 'Two top' }, { key: 'centre', label: 'Centre' },
]

function QrMini({ text, ec, quiet, size }: { text: string; ec: QrConfig['ecLevel']; quiet: number; size: number }) {
  const m = qrMatrix(text || ' ', ec)
  const total = m.size + quiet * 2
  const cell = size / total
  const rects = []
  for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) if (m.get(c, r)) rects.push(<rect key={`${r}-${c}`} x={(c + quiet) * cell} y={(r + quiet) * cell} width={cell} height={cell} />)
  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges"><rect width={size} height={size} fill="#fff" /><g fill="#000">{rects}</g></svg>
}

export default function PieceEditor({ design, bridge, onChange, onApplyQrToAll }: { design: Design; bridge: number; onChange: (patch: Partial<Design>) => void; onApplyQrToAll: (qr: QrConfig) => void }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const previewW = 260
  const pxPerMm = previewW / design.width
  const previewH = design.height * pxPerMm
  const holes = design.holes ?? []
  const qr = design.qr
  const [activeHole, setActiveHole] = useState(0)

  const setHoles = (next: Hole[]) => onChange({ holes: next })
  const setQr = (patch: Partial<QrConfig>) => onChange({ qr: { ...(qr ?? defaultQr(design)), ...patch } })
  const alignX = (kind: 'left' | 'mid' | 'right') => { const q = qr!; const m = 2; const x = kind === 'left' ? m : kind === 'right' ? design.width - q.sizeMm - m : (design.width - q.sizeMm) / 2; onChange({ qr: { ...q, x: Math.round(x) } }) }
  const alignY = (kind: 'top' | 'mid' | 'bottom') => { const q = qr!; const m = 2; const y = kind === 'top' ? m : kind === 'bottom' ? design.height - q.sizeMm - m : (design.height - q.sizeMm) / 2; onChange({ qr: { ...q, y: Math.round(y) } }) }

  function drag(set: (p: { x: number; y: number }) => void) {
    return (event: React.PointerEvent) => {
      event.preventDefault(); event.stopPropagation()
      const rect = boxRef.current!.getBoundingClientRect()
      const move = (e: PointerEvent) => set({ x: Math.max(0, Math.min(design.width, (e.clientX - rect.left) / pxPerMm)), y: Math.max(0, Math.min(design.height, (e.clientY - rect.top) / pxPerMm)) })
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
    }
  }

  function addHole(key: typeof HOLE_PRESETS[number]['key']) {
    const made = holePreset(key, design, 4).map((h, i) => ({ ...h, id: `h${holes.length + i}` }))
    onChange({ holes: [...holes, ...made] })
  }

  const warnings = qr?.enabled ? qrWarnings(qr.sizeMm, qrMatrix(qr.text || ' ', qr.ecLevel), qr.quietModules, qr.dark, qr.light) : []

  return (
    <div className="piece-editor">
      <div className="editor-preview" ref={boxRef} style={{ width: previewW, height: previewH }}
        onClick={e => { const rect = boxRef.current!.getBoundingClientRect(); onChange({ holes: [...holes, { id: `h${holes.length}`, diameter: 4, x: (e.clientX - rect.left) / pxPerMm, y: (e.clientY - rect.top) / pxPerMm }] }) }}>
        <img src={design.url} alt={design.name} />
        {holes.map((h, i) => (
          <div key={h.id} className={`hole-marker ${activeHole === i ? 'active' : ''}`}
            style={{ left: h.x * pxPerMm, top: h.y * pxPerMm, width: h.diameter * pxPerMm, height: h.diameter * pxPerMm }}
            onPointerDown={drag(p => setHoles(holes.map((o, j) => j === activeHole ? { ...o, x: p.x, y: p.y } : o)))}
            onClick={e => { e.stopPropagation(); setActiveHole(i) }}
            title={`Hole #${i + 1}: ${holeClearance(h, design).toFixed(2)} mm edge clearance`} />
        ))}
        {qr?.enabled && (
          <div className="qr-marker" style={{ left: qr.x * pxPerMm, top: qr.y * pxPerMm, width: qr.sizeMm * pxPerMm, height: qr.sizeMm * pxPerMm }}
            onPointerDown={drag(p => setQr({ x: p.x, y: p.y }))} title="Drag the QR code">
            <QrMini text={qr.text} ec={qr.ecLevel} quiet={qr.quietModules} size={Math.max(8, qr.sizeMm * pxPerMm)} />
          </div>
        )}
      </div>

      <div className="editor-controls">
        <div className="editor-block">
          <div className="editor-block-head"><b>Keychain holes</b><span>{holes.length} hole{holes.length === 1 ? '' : 's'}</span></div>
          <div className="editor-row">
            <select aria-label="Hole preset" defaultValue="" onChange={e => { if (e.target.value) addHole(e.target.value as typeof HOLE_PRESETS[number]['key']); e.currentTarget.value = '' }}>
              <option value="" disabled>Add preset…</option>
              {HOLE_PRESETS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
            <span className="hint">Bridge ≥ {bridge.toFixed(1)} mm · click the artwork to add a custom hole</span>
          </div>
          {holes.map((h, i) => {
            const err = holeError(h, design, bridge)
            return (
              <div className={`hole-row ${err ? 'invalid' : ''}`} key={h.id}>
                <span>#{i + 1}</span>
                <label>⌀<input type="number" min="0.5" step="0.1" value={Number(h.diameter.toFixed(2))} onChange={e => onChange({ holes: holes.map((o, j) => j === i ? { ...o, diameter: Math.max(0, Number(e.target.value)) } : o) })}/></label>
                <label>X<input type="number" step="0.1" value={Number(h.x.toFixed(2))} onChange={e => onChange({ holes: holes.map((o, j) => j === i ? { ...o, x: Number(e.target.value) } : o) })}/></label>
                <label>Y<input type="number" step="0.1" value={Number(h.y.toFixed(2))} onChange={e => onChange({ holes: holes.map((o, j) => j === i ? { ...o, y: Number(e.target.value) } : o) })}/></label>
                <span className="clearance">{holeClearance(h, design).toFixed(2)} mm</span>
                <button type="button" className="delete-button" aria-label="Remove hole" onClick={() => onChange({ holes: holes.filter((_, j) => j !== i) })}>×</button>
                {err && <div className="validation">! {err}</div>}
              </div>
            )
          })}
        </div>

        <div className="editor-block">
          <div className="editor-block-head"><b>QR code</b><label className="toggle-line"><input type="checkbox" checked={!!qr?.enabled} onChange={e => onChange({ qr: { ...(qr ?? defaultQr(design)), enabled: e.target.checked } })}/> enabled</label></div>
          {qr?.enabled && <>
            <label className="editor-field">Content<textarea value={qr.text} placeholder="Text or URL to encode" onChange={e => setQr({ text: e.target.value })}/></label>
            <div className="editor-row">
              <label className="mini">EC<select value={qr.ecLevel} onChange={e => setQr({ ecLevel: e.target.value as QrConfig['ecLevel'] })}>{['L', 'M', 'Q', 'H'].map(l => <option key={l} value={l}>{l}</option>)}</select></label>
              <label className="mini">Size<input type="number" min="4" step="0.5" value={Number(qr.sizeMm.toFixed(2))} onChange={e => { const s = Math.max(4, Number(e.target.value)); onChange({ qr: { ...qr, sizeMm: s, x: Math.min(qr.x, Math.max(0, design.width - s)), y: Math.min(qr.y, Math.max(0, design.height - s)) } }) }}/></label>
              <label className="mini">Quiet<input type="number" min="0" step="1" value={qr.quietModules} onChange={e => setQr({ quietModules: Math.max(0, Math.floor(Number(e.target.value))) })}/></label>
              <label className="mini">Rot°<input type="number" step="15" value={qr.rotation} onChange={e => setQr({ rotation: Number(e.target.value) })}/></label>
            </div>
            <div className="editor-row align-row">
              <span>Align</span>
              <button type="button" onClick={() => alignX('left')} title="Left">⇤</button>
              <button type="button" onClick={() => alignX('mid')} title="Centre horizontally">↔</button>
              <button type="button" onClick={() => alignX('right')} title="Right">⇥</button>
              <button type="button" onClick={() => alignY('top')} title="Top">⇧</button>
              <button type="button" onClick={() => alignY('mid')} title="Centre vertically">↕</button>
              <button type="button" onClick={() => alignY('bottom')} title="Bottom">⇩</button>
              <button type="button" className="quiet-button" onClick={() => onApplyQrToAll(qr)}>Apply to all</button>
            </div>
            {warnings.map(w => <div className="validation" key={w}>! {w}</div>)}
            <small className="hint">Preview is not proof of scannability — test-scan the finished material.</small>
          </>}
        </div>
      </div>
    </div>
  )
}
