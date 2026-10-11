import { judge, select, type LayaCandidate, type LayaContext } from './laya'

// Cutline -> real-Laya bridge. The geometric judge in laya.ts stays the
// deterministic offline fallback; when enabled, each placement decision is
// re-asked of the actual Laya System-1 model (@johnhenry/laya, the
// convaiinnovations/laya checkpoints) as a typed `choice` question over the
// enumerated legal candidates. The model answer is verified to be one of the
// enumerated candidates before it is used, so a misbehaving model can never
// produce a touching/overlapping piece.

export interface PredictionAgent {
  predict(state: unknown, questions: unknown): Promise<{ answers?: Record<string, { choice?: string; confidence?: number }> }>
  dispose?(): void
}

export interface DecideOptions {
  modelId?: string
  agent?: PredictionAgent
  status?: (message: string) => void
}

export interface PlacementChoice {
  candidate: LayaCandidate
  confidence: number
  source: 'laya' | 'geo'
}

const DEFAULT_MODEL = 'convaiinnovations/laya'
const MIN_CONFIDENCE = 0.35
const f = (n: number) => Math.round(n * 100) / 100

let agent: PredictionAgent | null = null
let loadedModel: string | null = null

export function geoTarget(candidates: LayaCandidate[], ctx: LayaContext): LayaCandidate {
  return select(candidates.map(c => judge(c, ctx))).candidate
}

async function getAgent(opts: DecideOptions): Promise<PredictionAgent | null> {
  const modelId = opts.modelId || DEFAULT_MODEL
  if (agent && loadedModel === modelId) return agent
  try {
    opts.status?.('Downloading the Laya model… the first nesting run finishes after it loads (~300–800 MB).')
    const { load } = await import('@johnhenry/laya')
    agent = (await load(modelId, {
      onProgress: p => opts.status?.(p.total ? `Laya model: ${p.file.split('/').at(-1)} ${Math.min(100, Math.round(p.loaded / p.total * 100))}%` : `Laya model: downloading ${p.file}…`),
    })) as unknown as PredictionAgent
    loadedModel = modelId
    return agent
  } catch {
    return null
  }
}

export function resetAgent(): void {
  agent?.dispose?.()
  agent = null
  loadedModel = null
}

// Pick the best placement for the current job piece. Laya chooses among the
// enumerated legal candidates; any miss, error, or too-timid confidence is
// resolved to the deterministic geometric target so nesting never stalls.
export async function decidePlacement(candidates: LayaCandidate[], ctx: LayaContext, opts: DecideOptions = {}): Promise<PlacementChoice> {
  const geo = geoTarget(candidates, ctx)
  if (candidates.length < 2) return { candidate: geo, confidence: 1, source: 'geo' }
  const pool = candidates.map((c, i) => ({ key: `p${i}`, c, judgment: judge(c, ctx) }))
  const model = opts.agent ?? (await getAgent(opts))
  if (!model) return { candidate: geo, confidence: 0, source: 'geo' }
  try {
    const state = {
      job: 'acrylic sheet nesting',
      sheet: { widthMm: f(ctx.sheetW), heightMm: f(ctx.sheetH), margins: { topMm: f(ctx.marginTop), bottomMm: f(ctx.marginBottom), leftMm: f(ctx.marginLeft), rightMm: f(ctx.marginRight) } },
      already_placed_pieces: ctx.placed.length,
      candidates: pool.map(s => ({ key: s.key, sheet: s.c.sheet, xMm: f(s.c.x), yMm: f(s.c.y), wMm: f(s.c.w), hMm: f(s.c.h), rotationDeg: s.c.angle, geometric_score: Number(s.judgment.score.toFixed(3)) })),
    }
    const result = await model.predict(state, {
      placement: {
        type: 'choice',
        instructions: 'This is a 2D nesting placement for laser cutting. Choose the placement that packs the sheet most tightly: maximum contact with the sheet edges and already-placed neighbours, filling from the bottom-left. Pick the single best candidate key.',
        criteria: Object.fromEntries(pool.map(s => [s.key, `sheet ${s.c.sheet}, x ${f(s.c.x)} mm, y ${f(s.c.y)} mm, ${f(s.c.w)}×${f(s.c.h)} mm at ${s.c.angle}°, geometric score ${s.judgment.score.toFixed(2)}`])),
      },
    })
    const answer = result?.answers?.placement
    const confidence = typeof answer?.confidence === 'number' ? answer.confidence : 0
    const chosen = pool.find(s => s.key === answer?.choice)?.c
    if (chosen && confidence >= MIN_CONFIDENCE) return { candidate: chosen, confidence, source: 'laya' }
    const geoConfidence = pool.find(s => s.c === geo)?.judgment.confidence ?? 0
    return { candidate: geo, confidence: Math.max(confidence, geoConfidence), source: 'geo' }
  } catch {
    return { candidate: geo, confidence: 0, source: 'geo' }
  }
}