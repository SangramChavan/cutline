import { describe, expect, it } from 'vitest'
import {
  CSV_COLUMNS,
  errorReport,
  matchCsv,
  parseCsv,
  readMappings,
  sampleCsv,
  type DesignRef,
} from './csv'

describe('parseCsv', () => {
  it('parses a quoted field with an embedded comma and newline as one field', () => {
    expect(parseCsv('a,"b,c\nd",e\n')).toEqual([['a', 'b,c\nd', 'e']])
  })

  it('round-trips an escaped double-quote', () => {
    expect(parseCsv('"he said ""hi""",x')).toEqual([['he said "hi"', 'x']])
  })

  it('strips a UTF-8 BOM and handles CRLF line endings', () => {
    expect(parseCsv('\uFEFFa,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']])
    expect(parseCsv('\uFEFFcol\n')).toEqual([['col']])
  })

  it('drops trailing blank lines', () => {
    expect(parseCsv('a,b\n\n\n')).toEqual([['a', 'b']])
  })
})

describe('readMappings', () => {
  it('reports missingRequired when the filename column is absent', () => {
    const result = readMappings('qty,width\n1,10\n')
    expect(result.missingRequired).toEqual(['filename'])
    expect(result.rows).toEqual([])
  })

  it('maps case-insensitive and aliased headers', () => {
    const result = readMappings('FILE,Qty,W,H,Shape\nqr.png,2,10,20,rounded\n')
    expect(result.missingRequired).toEqual([])
    const row = result.rows[0]!
    expect(row.filename).toBe('qr.png')
    expect(row.quantity).toBe(2)
    expect(row.widthMm).toBe(10)
    expect(row.heightMm).toBe(20)
    expect(row.shape).toBe('rounded')
    expect(row.errors).toEqual([])
  })

  it('flags an invalid numeric cell and omits that field', () => {
    const row = readMappings('filename,quantity\nqr.png,abc\n').rows[0]!
    expect(row.quantity).toBeUndefined()
    expect(row.errors).toContain('invalid quantity')

    const zero = readMappings('filename,width_mm\nqr.png,0\n').rows[0]!
    expect(zero.widthMm).toBeUndefined()
    expect(zero.errors).toContain('invalid width_mm')
  })

  it('normalizes shape values and rejects unknown shapes', () => {
    expect(readMappings('filename,shape\na.png,Square\n').rows[0]!.shape).toBe('rectangle')
    expect(readMappings('filename,shape\na.png,rounded-rectangle\n').rows[0]!.shape).toBe('rounded')
    expect(readMappings('filename,shape\na.png,ellipse\n').rows[0]!.shape).toBe('circle')
    const bad = readMappings('filename,shape\na.png,hexagon\n').rows[0]!
    expect(bad.shape).toBeUndefined()
    expect(bad.errors).toContain('unknown shape "hexagon"')
  })

  it('validates URL-looking qr_content, rejecting whitespace', () => {
    const ok = readMappings('filename,qr_content\nqr.png,https://example.com/a\n').rows[0]!
    expect(ok.qrContent).toBe('https://example.com/a')
    expect(ok.errors).toEqual([])

    const bad = readMappings('filename,qr_content\nqr.png,https://example.com/a b\n').rows[0]!
    expect(bad.qrContent).toBeUndefined()
    expect(bad.errors).toContain('invalid url')

    const plain = readMappings('filename,qr_content\nqr.png,plain text\n').rows[0]!
    expect(plain.qrContent).toBe('plain text')
    expect(plain.errors).toEqual([])
  })
})

describe('matchCsv', () => {
  const designs: DesignRef[] = [
    { id: 'd1', name: 'qr.png', path: 'batch/qr.png' },
    { id: 'd2', name: 'logo.svg', path: 'art/logo.svg' },
    { id: 'd3', name: 'dup.png', path: 'x/dup.png' },
    { id: 'd4', name: 'other.png', path: 'y/dup.png' },
  ]

  function report() {
    const csv = 'filename,quantity\nqr.png,1\nmissing.png,1\nqr.png,1\ndup.png,1\n'
    return matchCsv(readMappings(csv), designs)
  }

  it('covers matched, unmatched, duplicate and ambiguous rows', () => {
    const r = report()
    expect(r.matches[0]!.status).toBe('matched')
    expect(r.matches[0]!.designId).toBe('d1')

    expect(r.matches[1]!.status).toBe('unmatched')
    expect(r.matches[1]!.designId).toBeUndefined()

    expect(r.matches[2]!.status).toBe('duplicate')
    expect(r.matches[2]!.designId).toBe('d1')
    expect(r.matches[2]!.errors.some(e => e.includes('duplicate of line 2'))).toBe(true)

    expect(r.matches[3]!.status).toBe('unmatched')
    expect(r.matches[3]!.errors).toContain('ambiguous filename')
  })

  it('matches by design name when the path basename does not match', () => {
    const r = matchCsv(readMappings('filename\nlogo.svg\n'), designs)
    expect(r.matches[0]!.status).toBe('matched')
    expect(r.matches[0]!.designId).toBe('d2')
  })

  it('produces counts consistent with the rows', () => {
    const r = report()
    expect(r.totalRows).toBe(4)
    expect(r.validRows).toBe(1)
    expect(r.invalidRows).toBe(3)
    expect(r.matched).toBe(1)
    expect(r.unmatched).toBe(2)
    expect(r.duplicates).toBe(1)
    expect(r.validRows + r.invalidRows).toBe(r.totalRows)
    expect(r.matched + r.unmatched + r.duplicates).toBe(r.totalRows)
    expect(r.matches.length).toBe(r.totalRows)
  })

  it('reports only problem rows', () => {
    const lines = errorReport(report()).split('\n')
    expect(lines.length).toBe(1 + 3)
    expect(lines[0]).toBe('line,filename,status,errors')
    expect(lines.join('\n')).toContain('ambiguous filename')
    expect(lines.join('\n')).toContain('duplicate of line 2')
  })
})

describe('sampleCsv', () => {
  it('parses back to the canonical header plus three data rows', () => {
    const table = parseCsv(sampleCsv())
    expect(table[0]).toEqual(CSV_COLUMNS)
    expect(CSV_COLUMNS.length).toBe(9)
    expect(table.length).toBe(4)
    expect(table[0]!.length).toBe(9)
  })

  it('is a valid, error-free template through readMappings', () => {
    const parsed = readMappings(sampleCsv())
    expect(parsed.missingRequired).toEqual([])
    expect(parsed.rows.length).toBe(3)
    expect(parsed.rows.every(r => r.errors.length === 0)).toBe(true)
  })
})
