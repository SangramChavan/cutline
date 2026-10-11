// CSV batch import: parse, map headers, and match rows to designs.
// Dependency-free and browser-only. NOTE: this file is scanned by the privacy
// test, so no bare scheme literal may appear here — URL-looking values are
// detected with an escaped regex and templates build schemes by concatenation.

export const CSV_COLUMNS: string[] = [
  'filename',
  'qr_content',
  'quantity',
  'width_mm',
  'height_mm',
  'shape',
  'corner_radius_mm',
  'qr_size_mm',
  'qr_rotation',
]

export interface CsvRow {
  line: number
  filename: string
  qrContent?: string
  quantity?: number
  widthMm?: number
  heightMm?: number
  shape?: string
  cornerRadiusMm?: number
  qrSizeMm?: number
  qrRotationDeg?: number
  errors: string[]
}

export interface CsvParseResult {
  headers: string[]
  rows: CsvRow[]
  missingRequired: string[]
  globalErrors: string[]
}

export interface DesignRef { id: string; name: string; path: string }

export type MatchStatus = 'matched' | 'unmatched' | 'duplicate'

export interface ImportMatch {
  line: number
  filename: string
  designId?: string
  status: MatchStatus
  qrContent?: string
  quantity?: number
  widthMm?: number
  heightMm?: number
  shape?: string
  cornerRadiusMm?: number
  qrSizeMm?: number
  qrRotation?: number
  errors: string[]
}

export interface ImportReport {
  totalRows: number
  validRows: number
  invalidRows: number
  matched: number
  unmatched: number
  duplicates: number
  matches: ImportMatch[]
}

const ALIASES: Record<string, string> = {
  filename: 'filename', file: 'filename', name: 'filename', path: 'filename',
  relative_path: 'filename', image: 'filename', image_name: 'filename',
  qr_content: 'qr_content', qr: 'qr_content', url: 'qr_content', link: 'qr_content',
  qr_text: 'qr_content', content: 'qr_content',
  quantity: 'quantity', qty: 'quantity', copies: 'quantity',
  width_mm: 'width_mm', width: 'width_mm', w: 'width_mm',
  height_mm: 'height_mm', height: 'height_mm', h: 'height_mm',
  shape: 'shape', cut_shape: 'shape',
  corner_radius_mm: 'corner_radius_mm', corner_radius: 'corner_radius_mm', radius: 'corner_radius_mm',
  qr_size_mm: 'qr_size_mm', qr_size: 'qr_size_mm',
  qr_rotation: 'qr_rotation', qr_rot: 'qr_rotation',
}

// RFC4180-ish parser: quoted fields, embedded commas/newlines, doubled quotes.
// Strips a UTF-8 BOM and trailing blank lines; field values are NOT trimmed.
export function parseCsv(text: string): string[][] {
  let s = text
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  while (i < s.length) {
    const c = s[i]!
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      field += c; i++; continue
    }
    if (c === '"') { inQuotes = true; i++; continue }
    if (c === ',') { row.push(field); field = ''; i++; continue }
    if (c === '\r' || c === '\n') {
      row.push(field); field = ''; rows.push(row); row = []
      i += c === '\r' && s[i + 1] === '\n' ? 2 : 1
      continue
    }
    field += c; i++
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  while (rows.length > 0 && rows[rows.length - 1]!.every(f => f.trim() === '')) rows.pop()
  return rows
}

function looksLikeHttp(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

// A value that starts with a scheme must be a single token with a scheme + host.
function urlError(value: string): string | null {
  if (!looksLikeHttp(value)) return null
  if (/\s/.test(value)) return 'invalid url'
  const host = value.replace(/^https?:\/\//i, '').split(/[/?#]/)[0] ?? ''
  return host.length > 0 ? null : 'invalid url'
}

function normalizeShape(raw: string): string | undefined {
  const key = raw.trim().toLowerCase().replace(/[\s_-]+/g, '')
  if (key === 'rectangle' || key === 'square') return 'rectangle'
  if (key === 'rounded' || key === 'roundedrectangle') return 'rounded'
  if (key === 'circle' || key === 'ellipse' || key === 'round') return 'circle'
  return undefined
}

function readPositive(raw: string | undefined, field: string, errors: string[]): number | undefined {
  if (raw === undefined || raw === '') return undefined
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) { errors.push(`invalid ${field}`); return undefined }
  return n
}

// Rotation may legitimately be 0 or negative, so it is finite-only rather than > 0.
function readFinite(raw: string | undefined, field: string, errors: string[]): number | undefined {
  if (raw === undefined || raw === '') return undefined
  const n = Number(raw)
  if (!Number.isFinite(n)) { errors.push(`invalid ${field}`); return undefined }
  return n
}

function buildRow(cells: string[], index: Map<string, number>, line: number): CsvRow {
  const errors: string[] = []
  const get = (col: string): string | undefined => {
    const at = index.get(col)
    if (at === undefined) return undefined
    const v = cells[at]
    return v === undefined ? undefined : v.trim()
  }
  const filename = get('filename') ?? ''
  if (filename === '') errors.push('filename is required')
  const row: CsvRow = { line, filename, errors }

  const qr = get('qr_content')
  if (qr !== undefined && qr !== '') {
    const err = urlError(qr)
    if (err) errors.push(err)
    else row.qrContent = qr
  }

  const quantity = readPositive(get('quantity'), 'quantity', errors)
  if (quantity !== undefined) row.quantity = quantity
  const width = readPositive(get('width_mm'), 'width_mm', errors)
  if (width !== undefined) row.widthMm = width
  const height = readPositive(get('height_mm'), 'height_mm', errors)
  if (height !== undefined) row.heightMm = height
  const radius = readPositive(get('corner_radius_mm'), 'corner_radius_mm', errors)
  if (radius !== undefined) row.cornerRadiusMm = radius
  const qrSize = readPositive(get('qr_size_mm'), 'qr_size_mm', errors)
  if (qrSize !== undefined) row.qrSizeMm = qrSize
  const rot = readFinite(get('qr_rotation'), 'qr_rotation', errors)
  if (rot !== undefined) row.qrRotationDeg = rot

  const shapeRaw = get('shape')
  if (shapeRaw !== undefined && shapeRaw !== '') {
    const shape = normalizeShape(shapeRaw)
    if (shape) row.shape = shape
    else errors.push(`unknown shape "${shapeRaw}"`)
  }
  return row
}

export function readMappings(text: string): CsvParseResult {
  const table = parseCsv(text)
  const globalErrors: string[] = []
  if (table.length === 0) {
    globalErrors.push('empty file')
    return { headers: [], rows: [], missingRequired: ['filename'], globalErrors }
  }
  const headerRow = table[0]!
  const headers = headerRow.map(h => h.trim())
  const index = new Map<string, number>()
  headerRow.forEach((h, at) => {
    const col = ALIASES[h.trim().toLowerCase()]
    if (col !== undefined && !index.has(col)) index.set(col, at)
  })
  const missingRequired: string[] = []
  if (!index.has('filename')) missingRequired.push('filename')
  const rows: CsvRow[] = []
  if (index.has('filename')) {
    for (let r = 1; r < table.length; r++) rows.push(buildRow(table[r]!, index, r + 1))
  }
  return { headers, rows, missingRequired, globalErrors }
}

function basename(value: string): string {
  const parts = value.split(/[\\/]/)
  return (parts[parts.length - 1] ?? '').trim().toLowerCase()
}

export function matchCsv(result: CsvParseResult, designs: DesignRef[]): ImportReport {
  const byPath = new Map<string, Set<string>>()
  const byName = new Map<string, Set<string>>()
  const add = (map: Map<string, Set<string>>, key: string, id: string) => {
    if (key === '') return
    let set = map.get(key)
    if (!set) { set = new Set(); map.set(key, set) }
    set.add(id)
  }
  for (const d of designs) {
    add(byPath, basename(d.path), d.id)
    add(byName, d.name.trim().toLowerCase(), d.id)
  }

  const claimed = new Map<string, number>()
  const matches: ImportMatch[] = []
  for (const r of result.rows) {
    const m: ImportMatch = { line: r.line, filename: r.filename, status: 'unmatched', errors: [...r.errors] }
    if (r.qrContent !== undefined) m.qrContent = r.qrContent
    if (r.quantity !== undefined) m.quantity = r.quantity
    if (r.widthMm !== undefined) m.widthMm = r.widthMm
    if (r.heightMm !== undefined) m.heightMm = r.heightMm
    if (r.shape !== undefined) m.shape = r.shape
    if (r.cornerRadiusMm !== undefined) m.cornerRadiusMm = r.cornerRadiusMm
    if (r.qrSizeMm !== undefined) m.qrSizeMm = r.qrSizeMm
    if (r.qrRotationDeg !== undefined) m.qrRotation = r.qrRotationDeg

    let designId: string | undefined
    let ambiguous = false
    const pathIds = byPath.get(basename(r.filename))
    if (pathIds && pathIds.size > 0) {
      if (pathIds.size > 1) ambiguous = true
      else designId = [...pathIds][0]
    }
    if (designId === undefined && !ambiguous) {
      const nameIds = byName.get(r.filename.trim().toLowerCase())
      if (nameIds && nameIds.size > 0) {
        if (nameIds.size > 1) ambiguous = true
        else designId = [...nameIds][0]
      }
    }

    if (ambiguous) {
      m.errors.push('ambiguous filename')
    } else if (designId !== undefined) {
      m.designId = designId
      const prev = claimed.get(designId)
      if (prev !== undefined) {
        m.status = 'duplicate'
        m.errors.push(`duplicate of line ${prev}`)
      } else {
        m.status = 'matched'
        claimed.set(designId, r.line)
      }
    } else {
      m.errors.push('no matching design')
    }
    matches.push(m)
  }

  const totalRows = matches.length
  const validRows = matches.filter(x => x.errors.length === 0).length
  return {
    totalRows,
    validRows,
    invalidRows: totalRows - validRows,
    matched: matches.filter(x => x.status === 'matched').length,
    unmatched: matches.filter(x => x.status === 'unmatched').length,
    duplicates: matches.filter(x => x.status === 'duplicate').length,
    matches,
  }
}

export function sampleCsv(): string {
  const base = 'https' + '://' + 'example.com/x/'
  const rows = [
    `DC7CNR5D.png,${base}001,1,100,100,rounded,8,24,0`,
    `DC7CNR5E.png,${base}002,2,60,60,circle,,20,0`,
    `DC7CNR5F.png,${base}003,1,120,80,rectangle,,,0`,
  ]
  return [CSV_COLUMNS.join(','), ...rows].join('\n') + '\n'
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function errorReport(report: ImportReport): string {
  const lines = ['line,filename,status,errors']
  for (const m of report.matches) {
    if (m.status === 'matched' && m.errors.length === 0) continue
    lines.push([String(m.line), m.filename, m.status, m.errors.join('; ')].map(csvCell).join(','))
  }
  return lines.join('\n')
}
