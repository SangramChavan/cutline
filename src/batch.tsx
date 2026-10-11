import { useState } from 'react'
import { errorReport, sampleCsv, type ImportReport } from './csv'
import { countImageOverrides, countQrOverrides, type GlobalImageSettings, type GlobalQrSettings } from './settings'
import type { Design, EcLevel, Shape } from './model'

export type Scope = 'all' | 'selected'

export interface BatchPanelProps {
  designs: Design[]
  selectedCount: number
  img: GlobalImageSettings
  setImg: (s: GlobalImageSettings) => void
  qr: GlobalQrSettings
  setQr: (s: GlobalQrSettings) => void
  bridge: number
  setBridge: (n: number) => void
  csv: { name: string; report: ImportReport } | null
  onStage: (file: File) => void
  onCommit: () => void
  onApplyImage: (scope: Scope) => void
  onApplyQr: (scope: Scope) => void
  onResetOverrides: (scope: Scope) => void
  onRemoveAllQr: () => void
}

const SHAPE_OPTIONS: Shape[] = ['rectangle', 'rounded', 'circle', 'ellipse']
const EC_LEVELS: EcLevel[] = ['L', 'M', 'Q', 'H']

function saveText(name: string, text: string, mime: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: mime }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export default function BatchPanel(p: BatchPanelProps) {
  const { designs, selectedCount, img, setImg, qr, setQr, bridge, setBridge, csv, onStage, onCommit, onApplyImage, onApplyQr, onResetOverrides, onRemoveAllQr } = p
  const [scope, setScope] = useState<Scope>(selectedCount ? 'selected' : 'all')

  const imgOver = countImageOverrides(designs, img)
  const qrOver = countQrOverrides(designs, qr)
  const withQr = designs.filter(d => d.qr?.enabled).length
  const num = (v: string): number | null => (v === '' ? null : Number(v))
  const previewRows = csv ? csv.report.matches.filter(m => m.status !== 'matched' || m.errors.length).concat(csv.report.matches.filter(m => m.status === 'matched' && !m.errors.length)).slice(0, 50) : []

  return <section className="production-panel batch-panel">
    <div className="export-heading"><div><span className="eyebrow">BATCH TOOLS</span><h3>Apply to many images</h3></div></div>
    <div className="scope-row">
      <span className="scope-label">APPLY TO</span>
      <button type="button" className={scope === 'selected' ? 'active' : ''} onClick={() => setScope('selected')} disabled={!selectedCount}>Selected · {selectedCount}</button>
      <button type="button" className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>All · {designs.length}</button>
    </div>

    <div className="batch-block">
      <div className="export-heading"><div><span className="eyebrow">GLOBAL IMAGE SETTINGS</span><h3>Size, shape & holes</h3></div><span className="override-badge">{imgOver} override{imgOver === 1 ? '' : 's'}</span></div>
      <div className="prod-inputs">
        <label>Width mm<input type="number" min="0.1" step="0.1" placeholder="keep" value={img.widthMm ?? ''} onChange={e => setImg({ ...img, widthMm: num(e.target.value) })}/></label>
        <label>Height mm<input type="number" min="0.1" step="0.1" placeholder="keep" value={img.heightMm ?? ''} onChange={e => setImg({ ...img, heightMm: num(e.target.value) })}/></label>
        <label>Shape<select value={img.shape ?? ''} onChange={e => setImg({ ...img, shape: (e.target.value || null) as Shape | null })}><option value="">keep</option>{SHAPE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
        <label>Corner radius mm<input type="number" min="0" step="0.1" placeholder="keep" value={img.radiusMm ?? ''} onChange={e => setImg({ ...img, radiusMm: num(e.target.value) })}/></label>
        <label>Rotation °<input type="number" step="1" placeholder="keep" value={img.rotationDeg ?? ''} onChange={e => setImg({ ...img, rotationDeg: num(e.target.value) })}/></label>
        <label>Quantity<input type="number" min="1" step="1" placeholder="keep" value={img.quantity ?? ''} onChange={e => setImg({ ...img, quantity: num(e.target.value) })}/></label>
        <label>Keychain hole ⌀ mm<input type="number" min="0" step="0.1" placeholder="keep" value={img.holeDiameterMm ?? ''} onChange={e => setImg({ ...img, holeDiameterMm: num(e.target.value) })}/></label>
        <label className="check-line"><input type="checkbox" checked={img.maintainAspect} onChange={e => setImg({ ...img, maintainAspect: e.target.checked })}/>Keep artwork aspect ratio</label>
      </div>
      <div className="bulk-match">
        <button type="button" onClick={() => onApplyImage(scope)}>Apply image settings</button>
        <button type="button" className="quiet-button" onClick={() => onResetOverrides(scope)}>Reset overrides</button>
      </div>
    </div>

    <div className="batch-block">
      <div className="export-heading"><div><span className="eyebrow">GLOBAL QR SETTINGS</span><h3>Brand & links</h3></div><span className="override-badge">{qrOver} override{qrOver === 1 ? '' : 's'} · {withQr} with QR</span></div>
      <div className="prod-inputs">
        <label>Enabled<select value={qr.enabled === null ? '' : qr.enabled ? 'on' : 'off'} onChange={e => setQr({ ...qr, enabled: e.target.value === '' ? null : e.target.value === 'on' })}><option value="">keep</option><option value="on">on</option><option value="off">off</option></select></label>
        <label className="wide">Content<input value={qr.text ?? ''} placeholder="leave blank to keep each image's QR content" onChange={e => setQr({ ...qr, text: e.target.value === '' ? null : e.target.value })}/></label>
        <label>Error correction<select value={qr.ecLevel ?? ''} onChange={e => setQr({ ...qr, ecLevel: (e.target.value || null) as GlobalQrSettings['ecLevel'] })}><option value="">keep</option>{EC_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}</select></label>
        <label>Size mm<input type="number" min="8" step="0.5" placeholder="keep" value={qr.sizeMm ?? ''} onChange={e => setQr({ ...qr, sizeMm: num(e.target.value) })}/></label>
        <label>Quiet modules<input type="number" min="0" step="1" placeholder="keep" value={qr.quietModules ?? ''} onChange={e => setQr({ ...qr, quietModules: num(e.target.value) })}/></label>
        <label>Rotation °<input type="number" step="1" placeholder="keep" value={qr.rotationDeg ?? ''} onChange={e => setQr({ ...qr, rotationDeg: num(e.target.value) })}/></label>
        <label>Align X<select value={qr.alignX ?? ''} onChange={e => setQr({ ...qr, alignX: (e.target.value || null) as GlobalQrSettings['alignX'] })}><option value="">keep</option><option value="left">left</option><option value="center">center</option><option value="right">right</option></select></label>
        <label>Align Y<select value={qr.alignY ?? ''} onChange={e => setQr({ ...qr, alignY: (e.target.value || null) as GlobalQrSettings['alignY'] })}><option value="">keep</option><option value="top">top</option><option value="center">center</option><option value="bottom">bottom</option></select></label>
        <label>Offset X mm<input type="number" step="0.5" value={qr.offsetXMm} onChange={e => setQr({ ...qr, offsetXMm: Number(e.target.value) || 0 })}/></label>
        <label>Offset Y mm<input type="number" step="0.5" value={qr.offsetYMm} onChange={e => setQr({ ...qr, offsetYMm: Number(e.target.value) || 0 })}/></label>
        <label>Hole edge bridge mm<input type="number" min="0" step="0.5" value={bridge} onChange={e => setBridge(Math.max(0, Number(e.target.value) || 0))}/></label>
      </div>
      <div className="bulk-match">
        <button type="button" onClick={() => onApplyQr(scope)}>Apply QR to {scope === 'selected' ? 'selected' : 'all'}</button>
        <span className="override-badge">{withQr} with QR · {designs.length - withQr} without{qrOver ? ` · ${qrOver} override${qrOver === 1 ? '' : 's'}` : ''}</span>
        <button type="button" className="quiet-button" onClick={() => onResetOverrides(scope)}>Reset overrides</button>
        <button type="button" className="quiet-button" onClick={onRemoveAllQr}>Remove all QRs</button>
      </div>
      <small className="note">Each image keeps its own QR content. Use CSV to assign a unique link per image, or Apply QR to give many images the same position/size and then set content per image in the Holes/QR editor.</small>
    </div>

    <div className="batch-block">
      <div className="export-heading"><div><span className="eyebrow">CSV BATCH IMPORT</span><h3>Unique QR per image</h3></div></div>
      <div className="bulk-match">
        <label className="file-button">↥ Choose CSV…<input type="file" accept=".csv,text/csv" onChange={e => { const f = e.target.files?.[0]; if (f) onStage(f); e.currentTarget.value = '' }}/></label>
        <button type="button" className="quiet-button" onClick={() => saveText('cutline-sample.csv', sampleCsv(), 'text/csv')}>⇩ Sample CSV</button>
        {csv && <button type="button" className="quiet-button" onClick={() => saveText('cutline-csv-errors.csv', errorReport(csv.report), 'text/csv')}>⇩ Error report</button>}
      </div>
      <small className="note">Columns: filename, qr_content, quantity, width_mm, height_mm, shape, corner_radius_mm, qr_size_mm, qr_rotation. Filenames match case-insensitively; extra columns are ignored.</small>
      {csv && <>
        <div className="csv-summary">{csv.name}: rows {csv.report.totalRows} · matched {csv.report.matched} · unmatched {csv.report.unmatched} · duplicates {csv.report.duplicates} · row errors {csv.report.invalidRows}</div>
        <div className="csv-table-wrap"><table className="csv-table"><thead><tr><th>Line</th><th>Status</th><th>Filename</th><th>QR content</th><th>Notes</th></tr></thead><tbody>
          {previewRows.map((m, i) => <tr key={`${m.line}-${i}`} className={m.status === 'matched' && !m.errors.length ? '' : 'warn'}>
            <td>{m.line}</td><td>{m.status}</td><td title={m.filename}>{m.filename}</td><td title={m.qrContent}>{m.qrContent ?? '—'}</td><td>{m.errors.join('; ') || 'ok'}</td>
          </tr>)}
          {!previewRows.length && <tr><td colSpan={5}>No rows found.</td></tr>}
        </tbody></table></div>
        <div className="bulk-match">
          <button type="button" className="primary-button" disabled={!csv.report.matched} onClick={onCommit}>Apply {csv.report.matched} row{csv.report.matched === 1 ? '' : 's'}</button>
          <span className="note">Unmatched rows are never applied; images without a row keep their current settings.</span>
        </div>
      </>}
    </div>

    <div className="batch-block">
      <div className="export-heading"><div><span className="eyebrow">QR STATUS</span><h3>Bulk QR management</h3></div></div>
      <div className="qr-summary">{withQr} image{withQr === 1 ? '' : 's'} with a QR · {designs.length - withQr} without · {qrOver} differing from the global QR settings</div>
      <small className="note">Open any image's ⌾ Holes/QR editor to preview, reposition, reassign or remove its QR. Use the search and filter above the artwork list to isolate images with or without a QR.</small>
    </div>
  </section>
}
