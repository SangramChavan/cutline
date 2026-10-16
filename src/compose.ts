import { outerSize, pathPoints, type Design, type Piece } from './model'
import { qrMatrix } from './qr'

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(Error('Artwork could not be decoded'))
    image.src = url
  })
}

// Paint one piece's final visual composition — clipped artwork plus QR — into an
// already-transformed context (origin at the piece centre, rotation applied).
// Used for both the print PDF raster and the per-artwork batch image so they are
// pixel-identical. The cutting outline is never drawn here.
export async function drawComposition(ctx: CanvasRenderingContext2D, d: Design, opts: { scale: number; rotation: number; image?: HTMLImageElement | null }) {
  const { scale, rotation } = opts
  const image = opts.image !== undefined ? opts.image : (d.mime.startsWith('image/') ? await loadImage(d.url).catch(() => null) : null)
  ctx.save()
  ctx.rotate(rotation * Math.PI / 180)
  const contour = pathPoints(d)
  const trace = () => {
    ctx.beginPath()
    contour.forEach((pt, i) => { const X = (pt.x - d.width / 2) * scale, Y = (pt.y - d.height / 2) * scale; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y) })
    ctx.closePath()
  }
  const centred = d.borderAlign === 'center'
  const sharp = d.shape === 'rectangle' || d.shape === 'square' || d.shape === 'polygon' || d.shape === 'svg'
  trace()
  if (d.borderMm > 0 && !centred) {
    // Border band outside the artwork: fill + a stroke 2*border wide (outer edge
    // = contour offset by border; round joins give radius + border on curves).
    ctx.save()
    ctx.fillStyle = ctx.strokeStyle = d.borderColor || '#000000'
    ctx.lineWidth = 2 * d.borderMm * scale
    ctx.lineJoin = sharp ? 'miter' : 'round'
    ctx.miterLimit = 10
    ctx.fill(); ctx.stroke()
    ctx.restore()
  }
  ctx.save()
  ctx.clip()
  if (image && image.naturalWidth) {
    const fit = Math.min(d.width * scale / image.naturalWidth, d.height * scale / image.naturalHeight)
    const iw = image.naturalWidth * fit, ih = image.naturalHeight * fit
    ctx.drawImage(image, -iw / 2, -ih / 2, iw, ih)
  }
  const qr = d.qr
  if (qr?.enabled) {
    const size = qr.sizeMm * scale
    const qx = (qr.x - d.width / 2) * scale, qy = (qr.y - d.height / 2) * scale
    ctx.save()
    ctx.translate(qx + size / 2, qy + size / 2)
    ctx.rotate((qr.rotation || 0) * Math.PI / 180)
    ctx.translate(-size / 2, -size / 2)
    if (qr.source === 'image' && qr.imageDataUrl) {
      const qimg = await loadImage(qr.imageDataUrl).catch(() => null)
      if (qimg) ctx.drawImage(qimg, 0, 0, size, size)
    } else {
      const m = qrMatrix(qr.text || ' ', qr.ecLevel)
      const total = m.size + Math.max(0, qr.quietModules) * 2
      const cell = size / total
      if (qr.light !== 'transparent') { ctx.fillStyle = qr.light || '#ffffff'; ctx.fillRect(0, 0, size, size) }
      ctx.fillStyle = qr.dark || '#000000'
      for (let row = 0; row < m.size; row++) for (let col = 0; col < m.size; col++) if (m.get(col, row)) ctx.fillRect((col + qr.quietModules) * cell, (row + qr.quietModules) * cell, cell + 0.5, cell + 0.5)
    }
    ctx.restore()
  }
  ctx.restore()
  if (d.borderMm > 0 && centred) {
    // Band straddles the artwork edge: drawn over the art, half inside, half outside.
    ctx.save()
    ctx.strokeStyle = d.borderColor || '#000000'
    ctx.lineWidth = d.borderMm * scale
    ctx.lineJoin = sharp ? 'miter' : 'round'
    ctx.miterLimit = 10
    trace(); ctx.stroke()
    ctx.restore()
  }
  ctx.restore()
}

// Rotated bounding-box render of one placed copy at print DPI (for the PDF).
export async function renderPieceCanvas(d: Design, piece: Pick<Piece, 'width' | 'height' | 'rotation'>, dpi: number, maxDim = 6000): Promise<HTMLCanvasElement> {
  const pmm = dpi / 25.4
  let pw = Math.max(1, Math.round(piece.width * pmm)), ph = Math.max(1, Math.round(piece.height * pmm))
  const shrink = Math.max(pw / maxDim, ph / maxDim, 1)
  pw = Math.max(1, Math.round(pw / shrink)); ph = Math.max(1, Math.round(ph / shrink))
  const scale = pw / piece.width
  const canvas = document.createElement('canvas')
  canvas.width = pw; canvas.height = ph
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, pw, ph)
  ctx.save()
  ctx.translate(pw / 2, ph / 2)
  await drawComposition(ctx, d, { scale, rotation: piece.rotation })
  ctx.restore()
  return canvas
}

// The finished artwork image on its own rectangle, unrotated, clipped to the
// cut shape, transparency preserved where the source had it. For the batch ZIP.
export async function renderFinalCanvas(d: Design, pxPerMm: number, maxDim = 8000): Promise<HTMLCanvasElement> {
  const o = outerSize(d)
  let pw = Math.max(1, Math.round(o.w * pxPerMm)), ph = Math.max(1, Math.round(o.h * pxPerMm))
  const shrink = Math.max(pw / maxDim, ph / maxDim, 1)
  pw = Math.max(1, Math.round(pw / shrink)); ph = Math.max(1, Math.round(ph / shrink))
  const scale = pw / o.w
  const canvas = document.createElement('canvas')
  canvas.width = pw; canvas.height = ph
  const ctx = canvas.getContext('2d')!
  ctx.translate(pw / 2, ph / 2)
  await drawComposition(ctx, d, { scale, rotation: 0 })
  return canvas
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? void blob.arrayBuffer().then(b => resolve(new Uint8Array(b)), reject) : reject(Error('Canvas to PNG failed')), 'image/png'))
}
