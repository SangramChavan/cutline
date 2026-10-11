import { packBest, type Design, type Layout, type Sheet } from './model'

type Request = { designs: Design[]; sheet: Sheet; angleOptions: number[]; maxSheets: number }

const post = (value: Layout) => (self as unknown as Worker).postMessage(value)

self.onmessage = async (event: MessageEvent) => {
  const { designs, sheet, angleOptions, maxSheets } = event.data as Request
  post(await packBest(designs, sheet, angleOptions, maxSheets))
}
