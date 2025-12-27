import { animationManager } from './animation-manager.ts'
import { defaultTheme, type Theme } from './syntax.ts'

export type PopupCanvasPointerEvent = {
  clientX: number
  clientY: number
}

export type PopupCanvasHitRegion = {
  left: number
  top: number
  width: number
  height: number
  onHover?: () => void
  onSelect?: () => void
}

export type PopupCanvasDrawInput = {
  context: CanvasRenderingContext2D
  width: number
  height: number
  pixelRatio: number
}

export type PopupCanvasDrawable = {
  priority?: number
  wantsPointer?: boolean
  draw: (input: PopupCanvasDrawInput) => PopupCanvasHitRegion[] | null | undefined
}

type PopupCanvasEntry = {
  id: string
  drawable: PopupCanvasDrawable
}

type PopupCanvasState = {
  canvas: HTMLCanvasElement | null
  context: CanvasRenderingContext2D | null
  entries: Map<string, PopupCanvasEntry>
  hitRegions: PopupCanvasHitRegion[]
  wantsPointer: boolean
  lastHoverIndex: number
  onResize: (() => void) | null
  onPointerMove: ((event: PointerEvent) => void) | null
  onPointerDown: ((event: PointerEvent) => void) | null
}

const state: PopupCanvasState = {
  canvas: null,
  context: null,
  entries: new Map(),
  hitRegions: [],
  wantsPointer: false,
  lastHoverIndex: -1,
  onResize: null,
  onPointerMove: null,
  onPointerDown: null,
}

const ensureCanvas = () => {
  if (typeof window === 'undefined') return
  if (state.canvas && state.context) return

  const canvas = document.createElement('canvas')
  canvas.style.position = 'fixed'
  canvas.style.left = '0'
  canvas.style.top = '0'
  canvas.style.width = '100dvw'
  canvas.style.height = '100dvh'
  canvas.style.zIndex = '999999'
  canvas.style.pointerEvents = 'none'
  canvas.style.userSelect = 'none'
  canvas.style.touchAction = 'none'

  const context = canvas.getContext('2d', { alpha: true })
  if (!context) return

  const onPointerMove = (event: PointerEvent) => {
    if (!state.wantsPointer) return
    const x = event.clientX
    const y = event.clientY
    let index = -1
    for (let i = 0; i < state.hitRegions.length; i++) {
      const region = state.hitRegions[i]
      if (x >= region.left && x <= region.left + region.width && y >= region.top && y <= region.top + region.height) {
        index = i
        break
      }
    }
    if (index !== state.lastHoverIndex) {
      state.lastHoverIndex = index
      state.hitRegions[index]?.onHover?.()
    }
  }

  const onPointerDown = (event: PointerEvent) => {
    if (!state.wantsPointer) return
    const x = event.clientX
    const y = event.clientY
    for (const region of state.hitRegions) {
      if (x >= region.left && x <= region.left + region.width && y >= region.top && y <= region.top + region.height) {
        event.preventDefault()
        event.stopPropagation()
        region.onSelect?.()
        break
      }
    }
  }

  state.onPointerMove = onPointerMove
  state.onPointerDown = onPointerDown
  window.addEventListener('pointermove', onPointerMove, { passive: true, capture: true })
  window.addEventListener('pointerdown', onPointerDown, { capture: true })

  const resize = () => {
    const pixelRatio = window.devicePixelRatio || 1
    const width = Math.max(1, Math.floor(window.innerWidth * pixelRatio))
    const height = Math.max(1, Math.floor(window.innerHeight * pixelRatio))
    if (canvas.width !== width) canvas.width = width
    if (canvas.height !== height) canvas.height = height
    scheduleDraw()
  }

  state.onResize = resize
  window.addEventListener('resize', resize, { passive: true })
  resize()

  document.body.appendChild(canvas)

  state.canvas = canvas
  state.context = context
}

const destroyCanvasIfUnused = () => {
  if (typeof window === 'undefined') return
  if (state.entries.size !== 0) return
  if (!state.canvas) return

  state.hitRegions = []
  state.wantsPointer = false
  state.lastHoverIndex = -1

  if (state.onResize) window.removeEventListener('resize', state.onResize)
  state.onResize = null
  if (state.onPointerMove) window.removeEventListener('pointermove', state.onPointerMove, true)
  if (state.onPointerDown) window.removeEventListener('pointerdown', state.onPointerDown, true)
  state.onPointerMove = null
  state.onPointerDown = null

  state.canvas.remove()
  state.canvas = null
  state.context = null
}

const scheduleDraw = () => {
  if (typeof window === 'undefined') return
  if (animationManager.isRegistered('popupCanvasDraw')) return
  animationManager.nextFrame('popupCanvasDraw', () => {
    draw()
  })
}

const draw = () => {
  const canvas = state.canvas
  const context = state.context
  if (!canvas || !context) return

  const pixelRatio = window.devicePixelRatio || 1
  const width = Math.max(1, Math.floor(canvas.width / pixelRatio))
  const height = Math.max(1, Math.floor(canvas.height / pixelRatio))

  context.setTransform(1, 0, 0, 1, 0, 0)
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.scale(pixelRatio, pixelRatio)

  const items = [...state.entries.values()]
    .sort((a, b) => (a.drawable.priority ?? 0) - (b.drawable.priority ?? 0))

  const hitRegions: PopupCanvasHitRegion[] = []
  let wantsPointer = false
  for (const item of items) {
    wantsPointer = wantsPointer || !!item.drawable.wantsPointer
    const regions = item.drawable.draw({ context, width, height, pixelRatio })
    if (regions?.length) hitRegions.push(...regions)
  }

  state.hitRegions = hitRegions
  state.wantsPointer = wantsPointer
  if (!wantsPointer) state.lastHoverIndex = -1
}

export const setPopupCanvasDrawable = (id: string, drawable: PopupCanvasDrawable | null) => {
  if (typeof window === 'undefined') return
  if (!drawable) {
    state.entries.delete(id)
    scheduleDraw()
    destroyCanvasIfUnused()
    return
  }
  ensureCanvas()
  state.entries.set(id, { id, drawable })
  scheduleDraw()
}

export const popupCanvasThemeFallback = (theme?: Theme) => theme ?? defaultTheme

let inheritedFontFamily: string | null = null
export const getPopupCanvasInheritedFontFamily = () => {
  if (typeof window === 'undefined') return 'system-ui, sans-serif'
  if (!inheritedFontFamily) {
    inheritedFontFamily = window.getComputedStyle(document.body).fontFamily
  }
  return inheritedFontFamily || 'system-ui, sans-serif'
}

export const popupCanvasUiFont = (sizePx: number, lineHeightPx: number, weight: number) => {
  const family = getPopupCanvasInheritedFontFamily()
  return `${weight} ${sizePx}px/${lineHeightPx}px ${family}`
}
