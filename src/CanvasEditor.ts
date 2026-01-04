import { animationManager } from './animation-manager.ts'
import {
  type AutocompleteInfo,
  calculateAutocompletePosition,
  findCurrentWord,
  getAutocompleteSuggestions,
  KEYWORDS,
} from './autocomplete.ts'
import type { EditorError } from './editor-error.ts'
import {
  calculatePopupPosition,
  findFunctionCallContext,
  type FunctionCallInfo,
} from './function-signature.ts'
import type { FunctionSignature } from './function-signature.ts'
import type { InputState } from './input.ts'
import { drawTokensWithCustomLigatures, extractTokensForSegment } from './mono-text.ts'
import { type PopupCanvasDrawable, setPopupCanvasDrawable } from './popup-canvas.ts'
import {
  drawErrorPopup,
  drawFunctionSignaturePopup,
  type ErrorPopupCache,
  type FunctionSignaturePopupCache,
} from './popup-drawables.ts'
import {
  defaultTheme,
  defaultTokenizer,
  highlightCode,
  type HighlightedLine,
  type Theme,
  type Token,
  type Tokenizer,
} from './syntax.ts'

const findMatchingBrace = (
  highlightedCode: HighlightedLine[],
  cursorLine: number,
  cursorColumn: number,
): {
  line: number
  tokenIndex: number
  token: Token
  matchingLine: number
  matchingTokenIndex: number
  matchingToken: Token
} | null => {
  // Find all braces and their positions
  const braces: {
    char: string
    line: number
    tokenIndex: number
    token: Token
    position: number
    isOpening: boolean
    depth: number
  }[] = []

  const openingBraces = new Set(['{', '(', '['])

  for (let lineIndex = 0; lineIndex < highlightedCode.length; lineIndex++) {
    const line = highlightedCode[lineIndex]
    let currentColumn = 0
    for (let tokenIndex = 0; tokenIndex < line.tokens.length; tokenIndex++) {
      const token = line.tokens[tokenIndex]

      // Check for opening braces
      if (token.type.startsWith('brace-open-')) {
        const depth = parseInt(token.type.split('-').pop() || '0')
        braces.push({
          char: token.content,
          line: lineIndex,
          tokenIndex,
          token,
          position: currentColumn,
          isOpening: true,
          depth,
        })
      }
      // Check for closing braces
      else if (token.type.startsWith('brace-close-')) {
        const depth = parseInt(token.type.split('-').pop() || '0')
        braces.push({
          char: token.content,
          line: lineIndex,
          tokenIndex,
          token,
          position: currentColumn,
          isOpening: false,
          depth,
        })
      }
      // Check for unmatched braces
      else if (token.type === 'brace-unmatched') {
        braces.push({
          char: token.content,
          line: lineIndex,
          tokenIndex,
          token,
          position: currentColumn,
          isOpening: openingBraces.has(token.content),
          depth: -1, // Unmatched braces get depth -1
        })
      }

      currentColumn += token.length
    }
  }

  // Convert cursor position to global position
  const clampedCursorLine = Math.max(0, Math.min(cursorLine, highlightedCode.length))
  let cursorGlobalPos = 0
  for (let i = 0; i < clampedCursorLine; i++) {
    const line = highlightedCode[i]
    const textLength = line && typeof line.text === 'string' ? line.text.length : 0
    cursorGlobalPos += textLength + 1 // +1 for newline
  }
  cursorGlobalPos += cursorColumn

  // Helper function to calculate global position for a brace
  const getBraceGlobalPos = (brace: { line: number; position: number }): number => {
    let globalPos = 0
    const upTo = Math.max(0, Math.min(brace.line, highlightedCode.length))
    for (let i = 0; i < upTo; i++) {
      const line = highlightedCode[i]
      const textLength = line && typeof line.text === 'string' ? line.text.length : 0
      globalPos += textLength + 1 // +1 for newline
    }
    globalPos += brace.position
    return globalPos
  }

  // Find all matched brace pairs using the depth information
  const matchedPairs: { openIndex: number; closeIndex: number }[] = []

  // Use a stack-based approach to match braces correctly
  const stack: { char: string; index: number; depth: number }[] = []

  for (let i = 0; i < braces.length; i++) {
    const brace = braces[i]

    if (brace.isOpening) {
      // Opening brace - push to stack
      stack.push({ char: brace.char, index: i, depth: brace.depth })
    }
    else if (!brace.isOpening && brace.depth !== -1) {
      // Closing brace - find matching opening
      const expectedOpen = getMatchingOpenBrace(brace.char)

      // Find the most recent matching opening brace
      for (let j = stack.length - 1; j >= 0; j--) {
        if (stack[j].char === expectedOpen) {
          // Found matching pair
          matchedPairs.push({
            openIndex: stack[j].index,
            closeIndex: i,
          })

          // Remove from stack
          stack.splice(j, 1)
          break
        }
      }
    }
    // Skip unmatched braces (depth === -1)
  }

  // Helper function to get matching opening brace
  function getMatchingOpenBrace(closeChar: string): string {
    switch (closeChar) {
      case '}':
        return '{'
      case ')':
        return '('
      case ']':
        return '['
      default:
        return ''
    }
  }

  // Find the innermost pair containing the cursor
  let innermostPair: { openIndex: number; closeIndex: number } | null = null
  let smallestRange = Infinity

  const getTokenLength = (token: Token): number => {
    if (typeof token.length === 'number') return token.length
    if (typeof token.content === 'string' && token.content.length > 0) {
      return token.content.length
    }
    return 1
  }

  for (const pair of matchedPairs) {
    const openBrace = braces[pair.openIndex]
    const closeBrace = braces[pair.closeIndex]

    // Calculate global positions and extents for this pair
    const openStart = getBraceGlobalPos(openBrace)
    const closeStart = getBraceGlobalPos(closeBrace)
    const openEnd = openStart + getTokenLength(openBrace.token)
    const closeEnd = closeStart + getTokenLength(closeBrace.token)

    const isCursorInside = cursorGlobalPos > openStart && cursorGlobalPos < closeEnd
    const touchesOuterEdge = cursorGlobalPos === openStart || cursorGlobalPos === closeEnd

    // Check if cursor is inside this brace pair or touching from the outside
    if (isCursorInside || touchesOuterEdge) {
      const range = closeEnd - openStart
      if (range < smallestRange) {
        smallestRange = range
        innermostPair = pair
      }
    }
  }

  if (!innermostPair) return null

  const openBrace = braces[innermostPair.openIndex]
  const closeBrace = braces[innermostPair.closeIndex]

  return {
    line: openBrace.line,
    tokenIndex: openBrace.tokenIndex,
    token: openBrace.token,
    matchingLine: closeBrace.line,
    matchingTokenIndex: closeBrace.tokenIndex,
    matchingToken: closeBrace.token,
  }
}

export interface EditorWidget {
  /** Widget placement type: 'above' | 'overlay' | 'inline' | 'below' */
  type: 'above' | 'overlay' | 'inline' | 'below'
  /** Line number (1-based, matching displayed line numbers) */
  line: number
  /** Column position (1-based, matching displayed column positions) */
  column: number
  /** Width in characters */
  length: number
  /** Height in pixels (optional: defaults to 20 for above/below, lineHeight for overlay/inline) */
  height?: number
  /** Enable X-axis viewport culling for this widget (default: true) */
  culling?: boolean
  /** Called to render the widget */
  render(canvasCtx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, viewX: number,
    viewWidth: number, viewY: number): void
  /** Called when widget is clicked (x, y are canvas coordinates, offsetX, offsetY are relative to widget) */
  pointerDown?(x: number, y: number, offsetX: number, offsetY: number): void
  /** Called when pointer moves (x, y are canvas coordinates, offsetX, offsetY are relative to widget) */
  pointerMove?(x: number, y: number, offsetX: number, offsetY: number): void
  /** Called when pointer is released */
  pointerUp?(): void
}

export interface EditorHeader {
  /** Height in pixels */
  height: number
  /** Called to render the header */
  render(
    canvasCtx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    viewX: number,
    viewWidth: number,
  ): void
  /** Called when header is clicked */
  pointerDown?(event: PointerEvent, x: number, y: number, offsetX: number, offsetY: number): void
  /** Called when pointer moves while header is active */
  pointerMove?(x: number, y: number, offsetX: number, offsetY: number): void
  /** Called when pointer is released */
  pointerUp?(): void
}

export interface CanvasEditorCallbacks {
  onFunctionCallChange?: (callInfo: FunctionCallInfo | null) => void
  onPopupPositionChange?: (position: { x: number; y: number }) => void
  onAutocompleteChange?: (autocompleteInfo: AutocompleteInfo | null) => void
  onAutocompletePositionChange?: (position: { x: number; y: number }) => void
  onScrollChange?: (scrollX: number, scrollY: number) => void
  onScrollMetricsChange?: (metrics: {
    scrollX: number
    scrollY: number
    viewportWidth: number
    viewportHeight: number
    contentWidth: number
    contentHeight: number
  }) => void
  onErrorHover?: (error: EditorError | null) => void
  onErrorPositionChange?: (position: { x: number; y: number }) => void
}

export interface CanvasEditorOptions {
  wordWrap?: boolean
  gutter?: boolean
  theme?: Theme
  tokenizer?: Tokenizer
  widgets?: EditorWidget[]
  header?: EditorHeader
  keywords?: string[]
  isAnimating?: boolean
  onBeforeDraw?: () => void
}

interface WrappedLine {
  logicalLine: number
  text: string
  startColumn: number
  endColumn: number
}

const hashString = (h: number, s: string): number => {
  let x = h >>> 0
  for (let i = 0; i < s.length; i++) {
    x ^= s.charCodeAt(i)
    x = Math.imul(x, 16777619)
  }
  return x >>> 0
}

const hashNumber = (h: number, n: number): number => {
  let x = h >>> 0
  x ^= n >>> 0
  x = Math.imul(x, 16777619)
  return x >>> 0
}

const findFirstChangedLine = (a: string[], b: string[]): number | null => {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return i
  }
  if (a.length !== b.length) return n
  return null
}

const findChangedLogicalLines = (a: string[], b: string[]): Set<number> => {
  const changed = new Set<number>()
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) changed.add(i)
  }
  // If lengths differ, all lines from the min length onward are considered changed
  const maxLen = Math.max(a.length, b.length)
  for (let i = n; i < maxLen; i++) {
    changed.add(i)
  }
  return changed
}

type OffscreenLineEntry = {
  id: string
  key: number
  logicalLine: number
  canvas: OffscreenCanvas
  ctx: OffscreenCanvasRenderingContext2D
  cssWidth: number
  cssHeight: number
  lastUsed: number
}

class OffscreenLineCache {
  private entries = new Map<string, OffscreenLineEntry>()
  private useCounter = 0
  private dpr = 1
  private capacity = 300

  public setDpr(dpr: number) {
    const next = dpr || 1
    if (Math.abs(next - this.dpr) > 0.01) {
      this.entries.clear()
      this.dpr = next
    }
  }

  public setCapacity(capacity: number) {
    const next = Math.max(50, Math.floor(capacity))
    if (next === this.capacity) return
    this.capacity = next
    this.evictIfNeeded()
  }

  public clear() {
    this.entries.clear()
  }

  public invalidateFromLogicalLine(fromLogicalLine: number) {
    for (const [id, entry] of this.entries) {
      if (entry.logicalLine >= fromLogicalLine) this.entries.delete(id)
    }
  }

  public invalidateLogicalLines(changedLogicalLines: Set<number>) {
    for (const [id, entry] of this.entries) {
      if (changedLogicalLines.has(entry.logicalLine)) this.entries.delete(id)
    }
  }

  public get(
    id: string,
    logicalLine: number,
    minCssWidth: number,
    cssHeight: number,
  ): OffscreenLineEntry | null {
    if (typeof OffscreenCanvas === 'undefined') return null

    const minWidth = Math.max(1, Math.ceil(minCssWidth))
    const height = Math.max(1, Math.ceil(cssHeight))

    const existing = this.entries.get(id)
    if (existing) {
      existing.lastUsed = ++this.useCounter
      existing.logicalLine = logicalLine
      return existing
    }

    const canvas = new OffscreenCanvas(Math.ceil(minWidth * this.dpr), Math.ceil(height * this.dpr))
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    const entry: OffscreenLineEntry = {
      id,
      key: 0,
      logicalLine,
      canvas,
      ctx,
      cssWidth: minWidth,
      cssHeight: height,
      lastUsed: ++this.useCounter,
    }

    this.entries.set(id, entry)
    this.evictIfNeeded()
    return entry
  }

  public ensureCanvasSize(entry: OffscreenLineEntry) {
    const w = Math.ceil(entry.cssWidth * this.dpr)
    const h = Math.ceil(entry.cssHeight * this.dpr)
    if (entry.canvas.width !== w) entry.canvas.width = w
    if (entry.canvas.height !== h) entry.canvas.height = h
    entry.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    entry.ctx.textBaseline = 'top'
  }

  public fitWidthInBlocks(entry: OffscreenLineEntry, minWidth: number, neededWidth: number) {
    const min = Math.max(1, Math.ceil(minWidth))
    const needed = Math.max(1, Math.ceil(neededWidth))

    let w = Math.max(entry.cssWidth, min)
    while (w < needed) w *= 2

    if (needed < w / 3 && w > min) {
      while (w / 2 >= min && w / 2 >= needed) w = Math.floor(w / 2)
    }

    entry.cssWidth = w
  }

  private evictIfNeeded() {
    if (this.entries.size <= this.capacity) return

    while (this.entries.size > this.capacity) {
      let oldestId: string | null = null
      let oldestUse = Infinity
      for (const [id, entry] of this.entries) {
        if (entry.lastUsed < oldestUse) {
          oldestUse = entry.lastUsed
          oldestId = id
        }
      }
      if (!oldestId) break
      this.entries.delete(oldestId)
    }
  }
}

export class CanvasEditor {
  private static instanceCounter = 0
  private readonly instanceId = ++CanvasEditor.instanceCounter

  private animId(name: string): string {
    return `${name}:${this.instanceId}`
  }

  private canvas: HTMLCanvasElement
  private container: HTMLElement
  private inputState: InputState
  private callbacks: CanvasEditorCallbacks
  private options: CanvasEditorOptions
  private resizeHandler: (() => void) | null = null
  private wheelHandler: ((e: WheelEvent) => void) | null = null
  private touchStartHandler: ((e: TouchEvent) => void) | null = null
  private touchMoveHandler: ((e: TouchEvent) => void) | null = null
  private touchEndHandler: ((e: TouchEvent) => void) | null = null
  private touchStartX: number | null = null
  private touchStartY: number | null = null
  private touchStartScrollX: number = 0
  private touchStartScrollY: number = 0
  private isTouchScrolling: boolean = false
  private isTouchGesture: boolean = false
  private touchScrolled: boolean = false
  private touchVelocityX: number = 0
  private touchVelocityY: number = 0
  private lastTouchMoveTime: number = 0
  private lastTouchMoveX: number = 0
  private lastTouchMoveY: number = 0
  private touchStartTime: number = 0
  private velocitySamples: Array<{ time: number; vx: number; vy: number }> = []
  private lastFunctionCallInfo: FunctionCallInfo | null = null
  // When user explicitly hides the signature popup (e.g. pressing Escape),
  // suppress reopening it until input/caret changes.
  private suppressSignatureUntil: { line: number; column: number; text: string } | null = null
  private lastPopupPosition: {
    x: number
    y: number
  } | null = null
  private lastAutocompleteInfo: AutocompleteInfo | null = null
  private lastAutocompletePosition: {
    x: number
    y: number
  } | null = null
  private autocompleteInputSource: 'keyboard' | 'mouse' = 'keyboard'
  private functionDefinitions: Record<string, FunctionSignature> = {}
  private keywords: string[] = [...KEYWORDS]
  private highlightCache: { code: string; result: HighlightedLine[] } | null = null
  private resizeObserver: ResizeObserver | null = null
  private scrollX = 0
  private scrollY = 0
  private readonly padding = 16
  private readonly lineHeight = 20
  private isActive = false
  private autocompleteDebounceTimer: number | null = null
  private wheelScrollDebounceTimer: number | null = null
  private isWheelScrolling: boolean = false
  private dominantAxisTimer: number | null = null
  private currentDominantAxis: 'horizontal' | 'vertical' | null = null
  private lastCaretContentX: number | null = null
  private lastCaretContentY: number | null = null
  private signatureEnabled = true
  private hoverSignatureEnabled = true
  private scrollbarWidth = 10
  private scrollMetrics = {
    viewportWidth: 0,
    viewportHeight: 0,
    contentWidth: 0,
    contentHeight: 0,
    scrollX: 0,
    scrollY: 0,
  }
  private hoveredScrollbar: 'vertical' | 'horizontal' | null = null
  private lastDpr = window.devicePixelRatio || 1
  private popupDimensions = { width: 400, height: 300 }
  private errors: EditorError[] = []
  private hoveredError: EditorError | null = null
  private isHoveringGutter: boolean = false
  private hoverTimeoutId: number | null = null
  private hoveredFunction: {
    functionName: string
    parameterIndex?: number
    parameterName?: string
  } | null = null
  private hoverSignaturePopupId = `hsig_${Math.random().toString(36).slice(2)}`
  private hoverSignaturePopupCache: FunctionSignaturePopupCache = {
    exampleLigatureCache: {},
    lastDimensions: null,
  }
  private hoverSignaturePopupState: {
    signature: FunctionSignature
    callInfo: FunctionCallInfo
    position: { x: number; y: number }
  } | null = null
  private hoverSignaturePopupDrawable: PopupCanvasDrawable = {
    priority: 11,
    wantsPointer: false,
    draw: ({ context, width, height }) => {
      const s = this.hoverSignaturePopupState
      if (!s) return null
      if (width < 600) return null
      drawFunctionSignaturePopup({
        context,
        width,
        height,
        position: s.position,
        signature: s.signature,
        currentArgumentIndex: s.callInfo.currentArgumentIndex,
        currentParameterName: s.callInfo.currentParameterName,
        theme: this.options.theme,
        tokenizer: this.options.tokenizer,
        cache: this.hoverSignaturePopupCache,
        onDimensionsChange: (w, h) => this.setPopupDimensions(w, h),
      })
      return null
    },
  }
  private signaturePopupId = `sig_${Math.random().toString(36).slice(2)}`
  private signaturePopupCache: FunctionSignaturePopupCache = {
    exampleLigatureCache: {},
    lastDimensions: null,
  }
  private signaturePopupState: {
    signature: FunctionSignature
    callInfo: FunctionCallInfo
    position: { x: number; y: number }
  } | null = null
  private signaturePopupDrawable: PopupCanvasDrawable = {
    priority: 10,
    wantsPointer: false,
    draw: ({ context, width, height }) => {
      const s = this.signaturePopupState
      if (!s) return null
      if (width < 600) return null
      drawFunctionSignaturePopup({
        context,
        width,
        height,
        position: s.position,
        signature: s.signature,
        currentArgumentIndex: s.callInfo.currentArgumentIndex,
        currentParameterName: s.callInfo.currentParameterName,
        theme: this.options.theme,
        tokenizer: this.options.tokenizer,
        cache: this.signaturePopupCache,
        onDimensionsChange: (w, h) => this.setPopupDimensions(w, h),
      })
      return null
    },
  }
  private errorPopupId = `err_${Math.random().toString(36).slice(2)}`
  private errorPopupCache: ErrorPopupCache = { lastDimensions: null }
  private errorPopupState: { error: EditorError; position: { x: number; y: number } } | null = null
  private errorPopupDrawable: PopupCanvasDrawable = {
    priority: 30,
    wantsPointer: false,
    draw: ({ context, width, height }) => {
      const s = this.errorPopupState
      if (!s) return null
      drawErrorPopup({
        context,
        width,
        height,
        position: s.position,
        error: s.error,
        theme: this.options.theme,
        cache: this.errorPopupCache,
      })
      return null
    },
  }
  private autoScrollDirection: { x: number; y: number } | null = null
  private autoScrollLastTime: number | null = null
  private caretOpacity: number = 1
  private caretBlinkStartTime: number = 0
  private lastCaretActivityTime: number = 0
  private activeWidget: EditorWidget | null = null
  private isWidgetPointerDown = false
  private isHeaderPointerDown = false
  private widgetPositions: Map<EditorWidget, { x: number; y: number; width: number; height: number }> = new Map()
  private activeWidgetPosition: { x: number; y: number; width: number; height: number } | null = null
  private widgetUpdateTimeout: number | null = null
  private widgetAdjustments: Map<EditorWidget, { startVisualLine: number; anchorVisualLine: number }> = new Map()
  private pendingWidgets: EditorWidget[] | null = null
  private currentCodeFileRef: unknown = null
  private justRestoredFromHistory: boolean = false

  // Measurement caches for performance
  private measurementCache: {
    charWidth?: number
    ligatureArrowWidth?: number
    ligatureLineArrowWidth?: number
    spaceWidth?: number
  } = {}
  private fontMeasureKey: number | null = null
  private gutterWidthCache: number | null = null
  private textPaddingCache: number | null = null
  private lineWidthCache: Map<string, number> = new Map()
  private offscreenLineCache = new OffscreenLineCache()
  private offscreenLineRenderVersion = 1

  private setFont(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) {
    const theme = this.options.theme || defaultTheme
    ctx.font = theme.font
  }

  private ensureFontCaches(ctx: CanvasRenderingContext2D) {
    this.setFont(ctx)

    // Fonts may load asynchronously; if metrics change, cached wrapping/layout/widths become invalid.
    const key = ctx.measureText('0').width
      + ctx.measureText('m').width
      + ctx.measureText('|>').width
    if (this.fontMeasureKey === null) {
      this.fontMeasureKey = key
      return
    }
    if (Math.abs(key - this.fontMeasureKey) > 0.01) {
      this.fontMeasureKey = key
      this.wrappedLinesCache = null
      this.pendingWrappedLines = null
      this.invalidateMeasurementCaches()
      this.offscreenLineCache.clear()
      this.offscreenLineRenderVersion++
    }
  }

  private adjustWrapEndForLigatures(
    line: string,
    start: number,
    end: number,
    maxWidth: number,
    ctx: CanvasRenderingContext2D,
  ): number {
    if (end <= start || end >= line.length) return end

    const a = line[end - 1]
    const b = line[end]
    const splitsArrow = (a === '|' || a === '-') && b === '>'
    if (!splitsArrow) return end

    // Prefer keeping the arrow operator together on the next line (break before it),
    // but never return a non-progressing end.
    const before = end - 1
    if (before > start) {
      const w = ctx.measureText(line.substring(start, before)).width
      if (w <= maxWidth) return before
    }

    const after = end + 1
    if (after <= line.length) {
      const w = ctx.measureText(line.substring(start, after)).width
      if (w <= maxWidth) return after
    }

    return end
  }

  private clampWrapEndToFit(
    line: string,
    start: number,
    end: number,
    maxWidth: number,
    ctx: CanvasRenderingContext2D,
  ): number {
    const minEnd = Math.min(start + 1, line.length)
    if (end <= minEnd) return minEnd

    if (ctx.measureText(line.substring(start, end)).width <= maxWidth) {
      return end
    }

    let left = minEnd
    let right = Math.min(end, line.length)
    let best = minEnd

    while (left <= right) {
      const mid = Math.floor((left + right) / 2)
      const w = ctx.measureText(line.substring(start, mid)).width
      if (w <= maxWidth) {
        best = mid
        left = mid + 1
      }
      else {
        right = mid - 1
      }
    }

    return best
  }

  private findRawPunctuationBreak(
    line: string,
    start: number,
    bestEnd: number,
  ): number {
    const upper = Math.min(bestEnd, line.length)
    if (upper <= start) return -1

    const consumeTrailingWhitespace = (end: number): number => {
      let i = end
      while (i < line.length && i < upper && (line[i] === ' ' || line[i] === '\t')) {
        i++
      }
      return i
    }

    // 1) Prefer breaking on whitespace (consume it).
    for (let i = upper - 1; i >= start; i--) {
      const ch = line[i]
      if (ch !== ' ' && ch !== '\t') continue
      return consumeTrailingWhitespace(i + 1)
    }

    // 2) Then commas
    const commaIndex = line.lastIndexOf(',', upper - 1)
    if (commaIndex >= start) {
      const end = consumeTrailingWhitespace(commaIndex + 1)
      if (end > start) return end
    }

    // 3) Then other punctuation
    const isPunct = (ch: string): boolean =>
      ch === ';'
      || ch === ':'
      || ch === ')'
      || ch === ']'
      || ch === '}'
      || ch === '|'
      || ch === '='

    for (let i = upper - 1; i >= start; i--) {
      const ch = line[i]
      if (!isPunct(ch)) continue
      const end = consumeTrailingWhitespace(i + 1)
      if (end > start) return end
    }

    return -1
  }

  private getWrapWidgetsKey(): number {
    if (!this.options.widgets || this.options.widgets.length === 0) return 0

    let h = 2166136261
    h = hashNumber(h, this.options.widgets.length)
    for (const w of this.options.widgets) {
      h = hashString(h, w.type)
      h = hashNumber(h, w.line)
      h = hashNumber(h, w.column)
      h = hashNumber(h, w.length)
      h = hashNumber(h, w.height ?? -1)
      h = hashNumber(h, w.culling === false ? 1 : 0)
    }
    return h >>> 0
  }

  private invalidateMeasurementCaches() {
    this.measurementCache = {}
    this.gutterWidthCache = null
    this.textPaddingCache = null
    this.lineWidthCache.clear()
    this.widgetPositions.clear()
    this.widgetAdjustments.clear()
  }

  private getGutterWidth(): number {
    if (!this.options.gutter) return 0

    if (this.gutterWidthCache !== null) {
      return this.gutterWidthCache
    }

    const lineCount = this.inputState.lines.length
    const maxLineNumber = lineCount.toString().length

    // Get canvas context to measure actual character width
    const ctx = this.canvas.getContext('2d')!
    this.ensureFontCaches(ctx)

    if (!this.measurementCache.charWidth) {
      this.measurementCache.charWidth = ctx.measureText('0').width
    }

    // Calculate width needed for line numbers + some padding
    this.gutterWidthCache = maxLineNumber * this.measurementCache.charWidth + 2
    return this.gutterWidthCache
  }

  private getSpaceWidth(ctx: CanvasRenderingContext2D): number {
    if (!this.measurementCache.spaceWidth) {
      this.measurementCache.spaceWidth = ctx.measureText(' ').width
    }
    return this.measurementCache.spaceWidth
  }

  private getTextPadding(): number {
    if (this.textPaddingCache !== null) {
      return this.textPaddingCache
    }
    this.textPaddingCache = this.options.gutter
      ? this.padding + this.getGutterWidth() + 8
      : this.padding
    return this.textPaddingCache
  }
  private wrappedLinesCache: {
    code: string
    viewportWidth: number
    result: WrappedLine[]
    widgetsKey: number
  } | null = null
  private pendingWrappedLines: WrappedLine[] | null = null

  constructor(
    canvas: HTMLCanvasElement,
    container: HTMLElement,
    initialState: InputState,
    callbacks: CanvasEditorCallbacks = {},
    options: CanvasEditorOptions = {},
  ) {
    this.canvas = canvas
    this.container = container
    this.inputState = initialState
    this.callbacks = callbacks
    this.options = { tokenizer: defaultTokenizer, ...options }
    this.keywords = options.keywords ? [...options.keywords] : [...KEYWORDS]

    this.updateCanvasSize()
    this.maybeDraw()
    this.setupResize()
    this.setupWheel()
    this.setupTouch()

    if (this.options.isAnimating) {
      this.startAnimationLoop()
    }
  }

  public setActive(active: boolean) {
    if (this.isActive === active) return
    this.isActive = active
    this.maybeDraw()
    if (!this.isActive) {
      // Don't clear state when deactivating - just hide via rendering
      // This allows popups to reappear when reactivating without recalculation
      this.stopCaretBlink()
      this.clearSignaturePopupCanvas()
      this.clearErrorPopupCanvas()
    }
    else {
      this.startCaretBlink()
      // this.updateAutocomplete()
      // this.updateFunctionSignature()
    }
  }

  private getWidgetHeight(widget: EditorWidget): number {
    if (widget.height !== undefined) {
      return widget.height
    }
    if (widget.type === 'above' || widget.type === 'below') {
      return 20
    }
    return this.lineHeight
  }

  private getAboveSpacingHeight(
    wrappedLines: WrappedLine[],
    visualIndex: number,
    aboveWidgets: EditorWidget[],
  ): number {
    if (aboveWidgets.length === 0) return 0

    if (this.options.wordWrap && visualIndex > 0) {
      const prev = wrappedLines[visualIndex - 1]
      const cur = wrappedLines[visualIndex]
      if (prev && cur && prev.logicalLine === cur.logicalLine) {
        const spacingWidgets = aboveWidgets.filter(w => w.culling !== false)
        return spacingWidgets.length > 0
          ? Math.max(...spacingWidgets.map(w => this.getWidgetHeight(w)))
          : 0
      }
    }

    return Math.max(...aboveWidgets.map(w => this.getWidgetHeight(w)))
  }

  private getHeaderHeight(): number {
    return this.options.header?.height ?? 0
  }

  private getWrappedLines(ctx: CanvasRenderingContext2D): WrappedLine[] {
    if (!this.options.wordWrap) {
      // No wrapping - return original lines as single wrapped lines
      return this.inputState.lines.map((line, index) => ({
        logicalLine: index,
        text: line,
        startColumn: 0,
        endColumn: line.length,
      }))
    }

    this.ensureFontCaches(ctx)
    const viewportWidth = this.canvas.width / (window.devicePixelRatio || 1)
    const textPadding = this.getTextPadding()
    const maxWidth = Math.max(100, viewportWidth - textPadding - this.padding)

    // Check cache
    const code = this.inputState.lines.join('\n')
    const widgetsKey = this.getWrapWidgetsKey()
    if (this.wrappedLinesCache) {
      if (
        this.wrappedLinesCache.code === code
        && this.wrappedLinesCache.viewportWidth === viewportWidth
        && this.wrappedLinesCache.widgetsKey === widgetsKey
      ) {
        return this.wrappedLinesCache.result
      }
    }

    // Get syntax highlighting for token-aware wrapping
    const theme = this.options.theme || defaultTheme
    const tokenizer = this.options.tokenizer || defaultTokenizer
    let highlightedCode: HighlightedLine[]
    if (this.highlightCache && this.highlightCache.code === code) {
      highlightedCode = this.highlightCache.result
    }
    else {
      highlightedCode = highlightCode(code, tokenizer, theme)
    }

    const wrappedLines: WrappedLine[] = []

    // Widgets define unbreakable spans in column space (we avoid wrapping inside their ranges),
    // but only inline widgets affect horizontal layout and should influence wrap measurement.
    const inlineWidgetsByLine = new Map<number, { column: number; widthPx: number }[]>()
    // Collect widget ranges per line (convert from 1-based to 0-based)
    const widgetRangesByLine = new Map<number, { start: number; end: number }[]>()
    if (this.options.widgets) {
      for (const widget of this.options.widgets) {
        const logicalLine = widget.line - 1
        const widgetColumn = widget.column - 1
        if (widget.length !== undefined && widget.length > 0) {
          if (widget.type === 'inline') {
            const ws = inlineWidgetsByLine.get(logicalLine) || []
            ws.push({ column: widgetColumn, widthPx: ctx.measureText('X'.repeat(widget.length)).width })
            inlineWidgetsByLine.set(logicalLine, ws)
          }

          const ranges = widgetRangesByLine.get(logicalLine) || []
          ranges.push({
            start: widgetColumn,
            end: widgetColumn + widget.length,
          })
          widgetRangesByLine.set(logicalLine, ranges)
        }
      }
    }

    for (let lineIndex = 0; lineIndex < this.inputState.lines.length; lineIndex++) {
      const line = this.inputState.lines[lineIndex] || ''
      const tokens = highlightedCode[lineIndex]?.tokens || []
      const widgetRanges = widgetRangesByLine.get(lineIndex) || []
      const inlineWidgets = inlineWidgetsByLine.get(lineIndex) || []
      if (inlineWidgets.length > 1) inlineWidgets.sort((a, b) => a.column - b.column)

      const measure = (start: number, end: number): number => {
        let w = ctx.measureText(line.substring(start, end)).width
        if (inlineWidgets.length > 0) {
          for (const iw of inlineWidgets) {
            if (iw.column >= start && iw.column < end) w += iw.widthPx
          }
        }
        return w
      }

      const minAllowedEnd = (start: number): number => {
        let minEnd = Math.min(start + 1, line.length)
        for (const range of widgetRanges) {
          if (start >= range.start && start < range.end) {
            // Only force consuming the whole widget span if it actually fits;
            // otherwise allow wrapping within it so the line can continue wrapping.
            if (measure(start, range.end) <= maxWidth) {
              minEnd = Math.max(minEnd, Math.min(range.end, line.length))
            }
          }
        }
        return minEnd
      }

      const clampEndToFit = (start: number, end: number): number => {
        const minEnd = minAllowedEnd(start)
        if (end <= minEnd) return minEnd

        if (measure(start, end) <= maxWidth) return end

        let left = minEnd
        let right = Math.min(end, line.length)
        let best = minEnd
        while (left <= right) {
          const mid = Math.floor((left + right) / 2)
          const w = measure(start, mid)
          if (w <= maxWidth) {
            best = mid
            left = mid + 1
          }
          else {
            right = mid - 1
          }
        }
        return best
      }

      if (line.length === 0) {
        // Empty line
        wrappedLines.push({
          logicalLine: lineIndex,
          text: '',
          startColumn: 0,
          endColumn: 0,
        })
        continue
      }

      // Pre-compute token boundaries and space positions once per line
      const tokenBoundaries: number[] = []
      let currentColumn = 0
      for (const token of tokens) {
        const tokenEnd = currentColumn + token.content.length
        tokenBoundaries.push(tokenEnd)

        currentColumn = tokenEnd
      }

      let startColumn = 0
      while (startColumn < line.length) {
        // Try to fit as much as possible
        const fullText = line.substring(startColumn)
        const fullWidth = measure(startColumn, line.length)

        // If everything fits, use it all
        if (fullWidth <= maxWidth) {
          wrappedLines.push({
            logicalLine: lineIndex,
            text: fullText,
            startColumn,
            endColumn: line.length,
          })
          break
        }

        // Binary search to find the longest substring that fits
        let left = minAllowedEnd(startColumn)
        let right = line.length
        let bestEnd = left

        while (left <= right) {
          const mid = Math.floor((left + right) / 2)
          const testText = line.substring(startColumn, mid)
          const width = measure(startColumn, mid)

          if (width <= maxWidth) {
            bestEnd = mid
            left = mid + 1
          }
          else {
            right = mid - 1
          }
        }

        // Try to break at better boundaries (in order of preference):
        // 0. Move a whole call-like segment (name(...)) to the next line if it fits by itself
        // 1. Widget boundary (don't break within widget ranges)
        // 2. Token boundary
        // 3. Word boundary (space)
        // 4. Character boundary
        let finalEnd = bestEnd

        const widgetFitsFromStart = (range: { start: number; end: number }): boolean =>
          measure(startColumn, range.end) <= maxWidth
        const widgetFitsAlone = (range: { start: number; end: number }): boolean =>
          measure(range.start, range.end) <= maxWidth

        // Check if finalEnd would break a widget range.
        // Prefer pushing the widget to the next visual line (break before it) if possible.
        // If the widget span can't fit anyway, allow breaking within it.
        for (const range of widgetRanges) {
          if (finalEnd > range.start && finalEnd < range.end) {
            if (range.start > startColumn && widgetFitsAlone(range)) {
              finalEnd = range.start
            }
            else if (widgetFitsFromStart(range)) {
              finalEnd = range.end
            }
            break
          }
        }

        // Find best token boundary before bestEnd
        let lastTokenBoundary = -1
        for (let i = tokenBoundaries.length - 1; i >= 0; i--) {
          const boundary = tokenBoundaries[i]
          if (boundary <= bestEnd && boundary > startColumn) {
            lastTokenBoundary = boundary
            break
          }
        }

        const rawBreak = this.findRawPunctuationBreak(line, startColumn, bestEnd)

        const findMovableCallStart = (): number => {
          const upper = Math.min(bestEnd, line.length)
          for (let i = upper - 1; i >= startColumn; i--) {
            if (line[i] !== '(') continue

            // Find identifier start before '('
            let j = i - 1
            while (j >= startColumn) {
              const ch = line[j]
              const ok = (ch >= 'a' && ch <= 'z')
                || (ch >= 'A' && ch <= 'Z')
                || (ch >= '0' && ch <= '9')
                || ch === '_'
                || ch === '$'
              if (!ok) break
              j--
            }
            const nameStart = j + 1
            if (nameStart <= startColumn || nameStart >= i) continue

            // Find matching ')'
            let depth = 0
            let close = -1
            for (let k = i; k < line.length; k++) {
              const ch = line[k]
              if (ch === '(') depth++
              else if (ch === ')') {
                depth--
                if (depth === 0) {
                  close = k
                  break
                }
              }
            }
            if (close === -1) continue

            const callEnd = close + 1
            // Only useful if we would otherwise split inside it
            if (callEnd <= bestEnd) continue

            // Don't move into the middle of an unbreakable widget span
            let startsInsideWidget = false
            for (const range of widgetRanges) {
              if (nameStart > range.start && nameStart < range.end) {
                startsInsideWidget = true
                break
              }
            }
            if (startsInsideWidget) continue

            // If the whole call fits on its own line, move it down.
            if (measure(nameStart, callEnd) <= maxWidth) {
              return nameStart
            }
          }
          return -1
        }

        const findMovableWordStart = (): number => {
          // If bestEnd splits a non-whitespace run, and that whole run fits on its own line,
          // move the whole run down instead of splitting characters.
          if (bestEnd <= startColumn || bestEnd >= line.length) return -1
          const isWs = (ch: string): boolean => ch === ' ' || ch === '\t'

          // If the character before bestEnd is whitespace, we are not splitting a run.
          if (isWs(line[bestEnd - 1] || '')) return -1

          // Find run start
          let runStart = bestEnd - 1
          while (runStart > startColumn && !isWs(line[runStart - 1] || '')) {
            runStart--
          }
          if (runStart <= startColumn) return -1

          // Find run end
          let runEnd = bestEnd
          while (runEnd < line.length && !isWs(line[runEnd] || '')) {
            runEnd++
          }

          if (measure(runStart, runEnd) <= maxWidth) {
            return runStart
          }
          return -1
        }

        let candidateEnd = finalEnd
        if (bestEnd < line.length) {
          // Prefer token boundary if close enough to bestEnd (within 20% of maxWidth),
          // measured in pixels (not columns).
          const movableWordStart = findMovableWordStart()
          if (movableWordStart > startColumn && measure(startColumn, movableWordStart) <= maxWidth) {
            candidateEnd = movableWordStart
          }
          else {
            const movableCallStart = findMovableCallStart()
            if (movableCallStart > startColumn && measure(startColumn, movableCallStart) <= maxWidth) {
              candidateEnd = movableCallStart
            }
            else if (rawBreak > startColumn) {
              candidateEnd = rawBreak
            }
            else if (lastTokenBoundary > startColumn) {
              const bestWidth = measure(startColumn, bestEnd)
              const tokenWidth = measure(startColumn, lastTokenBoundary)
              if ((bestWidth - tokenWidth) < maxWidth * 0.2) {
                candidateEnd = lastTokenBoundary
              }
              else {
                candidateEnd = bestEnd
              }
            }
            else {
              candidateEnd = bestEnd
            }
          }
        }
        else {
          candidateEnd = bestEnd
        }

        // If the chosen candidate would split a widget span, prefer pushing the whole widget to the next
        // wrapped segment when the widget span can fit on its own.
        for (const range of widgetRanges) {
          if (candidateEnd > range.start && candidateEnd < range.end) {
            if (range.start > startColumn && widgetFitsAlone(range)) {
              candidateEnd = range.start
            }
            else if (widgetFitsFromStart(range)) {
              candidateEnd = range.end
            }
            break
          }
        }

        // Verify candidate doesn't break widget ranges
        let candidateBreaksWidget = false
        for (const range of widgetRanges) {
          if (candidateEnd > range.start && candidateEnd < range.end) {
            // Only treat it as "breaking a widget" if we could have kept the widget intact.
            if (widgetFitsFromStart(range) || (range.start > startColumn && widgetFitsAlone(range))) {
              candidateBreaksWidget = true
            }
            break
          }
        }

        if (!candidateBreaksWidget) {
          finalEnd = candidateEnd
        }

        finalEnd = this.adjustWrapEndForLigatures(line, startColumn, finalEnd, maxWidth, ctx)
        finalEnd = clampEndToFit(startColumn, finalEnd)

        wrappedLines.push({
          logicalLine: lineIndex,
          text: line.substring(startColumn, finalEnd),
          startColumn,
          endColumn: finalEnd,
        })

        startColumn = finalEnd
      }
    }

    // Cache the result
    this.wrappedLinesCache = {
      code,
      viewportWidth,
      result: wrappedLines,
      widgetsKey,
    }

    return wrappedLines
  }

  private logicalToVisualPosition(
    logicalLine: number,
    logicalColumn: number,
    wrappedLines: WrappedLine[],
  ): { visualLine: number; visualColumn: number } {
    for (let i = 0; i < wrappedLines.length; i++) {
      const wrapped = wrappedLines[i]
      if (wrapped.logicalLine !== logicalLine) continue

      // Inside this wrapped segment
      if (logicalColumn >= wrapped.startColumn && logicalColumn < wrapped.endColumn) {
        return {
          visualLine: i,
          visualColumn: logicalColumn - wrapped.startColumn,
        }
      }

      // Exactly at the boundary: prefer the end of this segment instead of start of next
      if (logicalColumn === wrapped.endColumn) {
        return { visualLine: i, visualColumn: wrapped.text.length }
      }
    }

    // Fallback: place at end of the last segment for this logical line
    for (let i = wrappedLines.length - 1; i >= 0; i--) {
      const wrapped = wrappedLines[i]
      if (wrapped.logicalLine === logicalLine) {
        return {
          visualLine: i,
          visualColumn: wrapped.text.length,
        }
      }
    }

    return { visualLine: 0, visualColumn: 0 }
  }

  private visualToLogicalPosition(
    visualLine: number,
    visualColumn: number,
    wrappedLines: WrappedLine[],
  ): { logicalLine: number; logicalColumn: number } {
    if (visualLine >= wrappedLines.length) {
      // Beyond the last line
      const lastWrapped = wrappedLines[wrappedLines.length - 1]
      return {
        logicalLine: lastWrapped?.logicalLine || 0,
        logicalColumn: lastWrapped ? lastWrapped.endColumn : 0,
      }
    }

    const wrapped = wrappedLines[visualLine]
    const clampedColumn = Math.min(visualColumn, wrapped.text.length)
    return {
      logicalLine: wrapped.logicalLine,
      logicalColumn: wrapped.startColumn + clampedColumn,
    }
  }

  private getContentSizeWithWrapping(
    ctx: CanvasRenderingContext2D,
    wrappedLines: WrappedLine[],
  ): { width: number; height: number } {
    // Calculate widget layout for content size
    const widgetLayout = this.calculateWidgetLayout(ctx, wrappedLines)
    return this.getContentSizeWithWrappingUsingLayout(ctx, wrappedLines, widgetLayout)
  }

  private getContentSizeWithWrappingUsingLayout(
    ctx: CanvasRenderingContext2D,
    wrappedLines: WrappedLine[],
    widgetLayout: {
      widgetsByVisualLine: Map<number, { above: EditorWidget[]; below: EditorWidget[] }>
      inlineWidgets: Map<number, { widget: EditorWidget; column: number }[]>
      overlayWidgets: EditorWidget[]
      yOffsets: Map<number, number>
    },
  ): { width: number; height: number } {
    if (!this.options.wordWrap) {
      // Use original method when not wrapping
      return this.getContentSize(ctx)
    }

    let maxLineWidth = 0
    for (const wrappedLine of wrappedLines) {
      let w = this.lineWidthCache.get(wrappedLine.text)
      if (w === undefined) {
        w = ctx.measureText(wrappedLine.text).width
        this.lineWidthCache.set(wrappedLine.text, w)
      }
      if (w > maxLineWidth) maxLineWidth = w
    }
    const textPadding = this.getTextPadding()
    const viewportWidth = this.canvas.width / (window.devicePixelRatio || 1)
    const width = Math.min(textPadding + maxLineWidth + this.padding, viewportWidth)

    // Calculate base height
    let height = this.padding + wrappedLines.length * this.lineHeight + this.padding

    // Add extra height for widgets
    const totalOffset = widgetLayout.yOffsets.get(wrappedLines.length) || 0
    height += totalOffset

    return { width, height }
  }

  private drawSelectionWithWrapping(
    ctx: CanvasRenderingContext2D,
    inputState: InputState,
    wrappedLines: WrappedLine[],
    scrollY: number,
    viewportHeight: number,
    yOffsets: Map<number, number>,
    widgetsByVisualLine: Map<number, { above: EditorWidget[]; below: EditorWidget[] }>,
    inlineWidgets: Map<number, { widget: EditorWidget; column: number }[]>,
  ) {
    if (!inputState.selection) return

    const { start, end } = inputState.selection

    // Normalize selection (ensure start comes before end)
    const normalizedStart = start.line < end.line || (start.line === end.line && start.column <= end.column)
      ? start
      : end
    const normalizedEnd = start.line < end.line || (start.line === end.line && start.column <= end.column) ? end : start

    // Don't draw selection if start === end (zero-length selection)
    if (
      normalizedStart.line === normalizedEnd.line
      && normalizedStart.column === normalizedEnd.column
    ) {
      return
    }

    const selectionPadding = 4
    const selectionHeight = this.lineHeight
    const selectionY = (visualLine: number, isFirstLine: boolean) => {
      const yOffset = yOffsets.get(visualLine) || 0
      // Add max height of 'above' widgets on this line (they are in the same row)
      let aboveHeight = 0
      const widgets = widgetsByVisualLine.get(visualLine)
      if (widgets?.above && widgets.above.length > 0) {
        aboveHeight = this.getAboveSpacingHeight(wrappedLines, visualLine, widgets.above)
      }
      return this.padding + visualLine * this.lineHeight + yOffset + aboveHeight + (isFirstLine ? 1 : 0) - 5
    }

    // Convert logical selection to visual positions
    const startVisual = this.logicalToVisualPosition(
      normalizedStart.line,
      normalizedStart.column,
      wrappedLines,
    )
    const endVisual = this.logicalToVisualPosition(
      normalizedEnd.line,
      normalizedEnd.column,
      wrappedLines,
    )

    // Viewport culling: skip if selection is not visible
    const startYOffset = yOffsets.get(startVisual.visualLine) || 0
    const endYOffset = yOffsets.get(endVisual.visualLine) || 0
    let startAboveHeight = 0
    const startWidgets = widgetsByVisualLine.get(startVisual.visualLine)
    if (startWidgets?.above && startWidgets.above.length > 0) {
      startAboveHeight = this.getAboveSpacingHeight(wrappedLines, startVisual.visualLine, startWidgets.above)
    }
    let endAboveHeight = 0
    let endBelowHeight = 0
    const endWidgets = widgetsByVisualLine.get(endVisual.visualLine)
    if (endWidgets?.above && endWidgets.above.length > 0) {
      endAboveHeight = this.getAboveSpacingHeight(wrappedLines, endVisual.visualLine, endWidgets.above)
    }
    if (endWidgets?.below && endWidgets.below.length > 0) {
      endBelowHeight = Math.max(...endWidgets.below.map(w => this.getWidgetHeight(w)))
    }
    const selectionStartY = this.padding + startVisual.visualLine * this.lineHeight + startYOffset + startAboveHeight
    const selectionEndY = this.padding + (endVisual.visualLine + 1) * this.lineHeight + endYOffset + endAboveHeight
      + endBelowHeight
    const visibleStartY = scrollY
    const visibleEndY = scrollY + viewportHeight

    if (selectionEndY < visibleStartY || selectionStartY > visibleEndY) {
      return
    }

    if (startVisual.visualLine === endVisual.visualLine) {
      // Single visual line selection
      const wrappedLine = wrappedLines[startVisual.visualLine]
      if (wrappedLine) {
        const startText = wrappedLine.text.substring(0, startVisual.visualColumn)
        const selectedText = wrappedLine.text.substring(
          startVisual.visualColumn,
          endVisual.visualColumn,
        )

        const textPadding = this.getTextPadding()
        let startX = textPadding + ctx.measureText(startText).width

        // Account for inline widgets before selection start
        const inlineWidgetsForLine = inlineWidgets.get(startVisual.visualLine) || []
        for (const { widget, column } of inlineWidgetsForLine) {
          const columnInWrappedLine = column - wrappedLine.startColumn
          if (columnInWrappedLine < startVisual.visualColumn) {
            startX += ctx.measureText('X'.repeat(widget.length)).width
          }
        }

        // Calculate selected width including inline widgets in selection
        let selectedWidth = ctx.measureText(selectedText).width
        for (const { widget, column } of inlineWidgetsForLine) {
          const columnInWrappedLine = column - wrappedLine.startColumn
          if (columnInWrappedLine >= startVisual.visualColumn && columnInWrappedLine < endVisual.visualColumn) {
            selectedWidth += ctx.measureText('X'.repeat(widget.length)).width
          }
        }
        // Add padding if selection ends at end of logical line (newline included)
        const logicalLine = wrappedLine.logicalLine
        const logicalLineLength = this.inputState.lines[logicalLine]?.length || 0
        const isLastWrappedSegment = wrappedLine.endColumn === logicalLineLength
        if (isLastWrappedSegment) {
          if (logicalLine < normalizedEnd.line
            || (logicalLine === normalizedEnd.line && normalizedEnd.column === logicalLineLength))
          {
            selectedWidth += selectionPadding
          }
        }

        const y = selectionY(startVisual.visualLine, true)

        ctx.fillRect(startX, y, selectedWidth, selectionHeight)
      }
    }
    else {
      // Multi-visual-line selection
      const textPadding = this.getTextPadding()

      // Clamp the visual line range to only visible lines, accounting for widget heights
      const getLineY = (visualLine: number) => {
        const yOffset = yOffsets.get(visualLine) || 0
        let aboveHeight = 0
        const widgets = widgetsByVisualLine.get(visualLine)
        if (widgets?.above && widgets.above.length > 0) {
          aboveHeight = this.getAboveSpacingHeight(wrappedLines, visualLine, widgets.above)
        }
        return this.padding + visualLine * this.lineHeight + yOffset + aboveHeight
      }

      const getLineBottomY = (visualLine: number) => {
        const yOffset = yOffsets.get(visualLine) || 0
        let aboveHeight = 0
        let belowHeight = 0
        const widgets = widgetsByVisualLine.get(visualLine)
        if (widgets?.above && widgets.above.length > 0) {
          aboveHeight = this.getAboveSpacingHeight(wrappedLines, visualLine, widgets.above)
        }
        if (widgets?.below && widgets.below.length > 0) {
          belowHeight = Math.max(...widgets.below.map(w => this.getWidgetHeight(w)))
        }
        return this.padding + (visualLine + 1) * this.lineHeight + yOffset + aboveHeight + belowHeight
      }

      // Find first visible line by checking actual Y positions
      let firstVisibleLine = startVisual.visualLine
      for (let visualLine = startVisual.visualLine; visualLine <= endVisual.visualLine; visualLine++) {
        const lineBottomY = getLineBottomY(visualLine)
        if (lineBottomY >= visibleStartY) {
          firstVisibleLine = visualLine
          break
        }
      }

      // Find last visible line by checking actual Y positions
      let lastVisibleLine = endVisual.visualLine
      for (let visualLine = endVisual.visualLine; visualLine >= startVisual.visualLine; visualLine--) {
        const lineY = getLineY(visualLine)
        if (lineY <= visibleEndY) {
          lastVisibleLine = visualLine
          break
        }
      }

      for (let visualLine = firstVisibleLine; visualLine <= lastVisibleLine; visualLine++) {
        const wrappedLine = wrappedLines[visualLine]
        if (!wrappedLine) continue

        const isFirstLine = visualLine === startVisual.visualLine
        const y = selectionY(visualLine, isFirstLine)

        const inlineWidgetsForLine = inlineWidgets.get(visualLine) || []

        if (visualLine === startVisual.visualLine) {
          // First visual line: from start column to end of visual line
          const startText = wrappedLine.text.substring(0, startVisual.visualColumn)
          const selectedText = wrappedLine.text.substring(startVisual.visualColumn)
          let startX = textPadding + ctx.measureText(startText).width

          // Account for inline widgets before selection start
          for (const { widget, column } of inlineWidgetsForLine) {
            const columnInWrappedLine = column - wrappedLine.startColumn
            if (columnInWrappedLine < startVisual.visualColumn) {
              startX += ctx.measureText('X'.repeat(widget.length)).width
            }
          }

          // Calculate selected width including inline widgets in selection
          let selectedWidth = ctx.measureText(selectedText).width
          for (const { widget, column } of inlineWidgetsForLine) {
            const columnInWrappedLine = column - wrappedLine.startColumn
            if (columnInWrappedLine >= startVisual.visualColumn) {
              selectedWidth += ctx.measureText('X'.repeat(widget.length)).width
            }
          }
          // Add padding if this is the last wrapped segment of the logical line and newline is included
          const logicalLine = wrappedLine.logicalLine
          const logicalLineLength = this.inputState.lines[logicalLine]?.length || 0
          const isLastWrappedSegment = wrappedLine.endColumn === logicalLineLength
          if (isLastWrappedSegment) {
            if (logicalLine < normalizedEnd.line
              || (logicalLine === normalizedEnd.line && normalizedEnd.column === logicalLineLength))
            {
              selectedWidth += selectionPadding
            }
          }

          ctx.fillRect(startX, y, selectedWidth, selectionHeight)
        }
        else if (visualLine === endVisual.visualLine) {
          // Last visual line: from start of visual line to end column
          const selectedText = wrappedLine.text.substring(0, endVisual.visualColumn)
          let selectedWidth = ctx.measureText(selectedText).width

          // Account for inline widgets in selection
          for (const { widget, column } of inlineWidgetsForLine) {
            const columnInWrappedLine = column - wrappedLine.startColumn
            if (columnInWrappedLine < endVisual.visualColumn) {
              selectedWidth += ctx.measureText('X'.repeat(widget.length)).width
            }
          }
          // Add padding if this is the last wrapped segment of the logical line and newline is included
          const logicalLine = wrappedLine.logicalLine
          const logicalLineLength = this.inputState.lines[logicalLine]?.length || 0
          const isLastWrappedSegment = wrappedLine.endColumn === logicalLineLength
          if (isLastWrappedSegment) {
            if (logicalLine < normalizedEnd.line
              || (logicalLine === normalizedEnd.line && normalizedEnd.column === logicalLineLength))
            {
              selectedWidth += selectionPadding
            }
          }

          ctx.fillRect(textPadding, y, selectedWidth, selectionHeight)
        }
        else {
          // Middle visual lines: entire visual line
          let selectedWidth = ctx.measureText(wrappedLine.text).width

          // Account for all inline widgets on this line
          for (const { widget } of inlineWidgetsForLine) {
            selectedWidth += ctx.measureText('X'.repeat(widget.length)).width
          }
          // Add padding if this is the last wrapped segment of the logical line and newline is included
          const logicalLine = wrappedLine.logicalLine
          const logicalLineLength = this.inputState.lines[logicalLine]?.length || 0
          const isLastWrappedSegment = wrappedLine.endColumn === logicalLineLength
          if (isLastWrappedSegment) {
            if (logicalLine < normalizedEnd.line
              || (logicalLine === normalizedEnd.line && normalizedEnd.column === logicalLineLength))
            {
              selectedWidth += selectionPadding
            }
          }

          ctx.fillRect(textPadding, y, selectedWidth, selectionHeight)
        }
      }
    }
  }

  private drawBraceMatchingForWrappedLine(
    ctx: CanvasRenderingContext2D,
    highlightedCode: HighlightedLine[],
    wrappedLine: WrappedLine,
    visualIndex: number,
    y: number,
    theme: Theme,
    matchingBraces: NonNullable<ReturnType<typeof findMatchingBrace>>,
  ) {
    // Check if opening brace is in this wrapped line segment
    if (matchingBraces.line === wrappedLine.logicalLine) {
      const braceColumn = this.getBraceColumnInLogicalLine(
        highlightedCode[matchingBraces.line],
        matchingBraces.tokenIndex,
      )
      if (braceColumn >= wrappedLine.startColumn && braceColumn < wrappedLine.endColumn) {
        const textPadding = this.getTextPadding()
        const braceX = textPadding
          + ctx.measureText(wrappedLine.text.substring(0, braceColumn - wrappedLine.startColumn))
            .width

        ctx.strokeStyle = theme.braceMatch
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(braceX, y + 18)
        ctx.lineTo(braceX + ctx.measureText(matchingBraces.token.content).width, y + 18)
        ctx.stroke()
      }
    }

    // Check if closing brace is in this wrapped line segment
    if (matchingBraces.matchingLine === wrappedLine.logicalLine) {
      const braceColumn = this.getBraceColumnInLogicalLine(
        highlightedCode[matchingBraces.matchingLine],
        matchingBraces.matchingTokenIndex,
      )
      if (braceColumn >= wrappedLine.startColumn && braceColumn < wrappedLine.endColumn) {
        const textPadding = this.getTextPadding()
        const braceX = textPadding
          + ctx.measureText(wrappedLine.text.substring(0, braceColumn - wrappedLine.startColumn))
            .width

        ctx.strokeStyle = theme.braceMatch
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(braceX, y + 18)
        ctx.lineTo(braceX + ctx.measureText(matchingBraces.matchingToken.content).width, y + 18)
        ctx.stroke()
      }
    }
  }

  private getBraceColumnInLogicalLine(
    highlightedLine: HighlightedLine,
    tokenIndex: number,
  ): number {
    let column = 0
    for (let i = 0; i < tokenIndex; i++) {
      column += highlightedLine.tokens[i].content.length
    }
    return column
  }

  private adjustScrollAfterResize(
    oldWidth: number,
    oldHeight: number,
    newWidth: number,
    newHeight: number,
  ) {
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return

    this.setFont(ctx)

    // Get content size with new dimensions
    const contentSize = this.options.wordWrap
      ? this.getContentSizeWithWrapping(ctx, this.getWrappedLines(ctx))
      : this.getContentSize(ctx)

    const headerHeight = this.getHeaderHeight()
    const newContentHeight = newHeight - headerHeight

    // Calculate new maximum scroll values
    const maxScrollX = Math.max(0, contentSize.width - newWidth)
    const maxScrollY = Math.max(0, contentSize.height - newContentHeight)

    // Adjust horizontal scroll to keep content visible
    // When wordWrap is false, preserve the leftmost scroll position
    if (!this.options.wordWrap) {
      // Preserve scrollX (leftmost position) - just clamp to new maximum
    }
    else if (newWidth < oldWidth) {
      // Canvas got narrower - adjust scroll to keep right edge visible
      const rightEdge = this.scrollX + oldWidth
      if (rightEdge > newWidth) {
        this.scrollX = Math.max(0, rightEdge - newWidth)
      }
    }

    // Adjust vertical scroll to keep content visible
    const oldContentHeight = oldHeight - headerHeight
    if (newContentHeight < oldContentHeight) {
      // Canvas got shorter - adjust scroll to keep bottom edge visible
      const bottomEdge = this.scrollY + oldContentHeight
      if (bottomEdge > newContentHeight) {
        this.scrollY = Math.max(0, bottomEdge - newContentHeight)
      }
    }

    // Clamp scroll values to new maximums
    this.scrollX = Math.min(Math.max(this.scrollX, 0), maxScrollX)
    this.scrollY = Math.min(Math.max(this.scrollY, 0), maxScrollY)

    // Notify about scroll changes
    this.callbacks.onScrollChange?.(this.scrollX, this.scrollY)
  }

  public getCaretPositionFromCoordinates(
    x: number,
    y: number,
  ): { line: number; column: number; columnIntent: number } {
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return { line: 0, column: 0, columnIntent: 0 }

    this.setFont(ctx)
    const wrappedLines = this.getWrappedLines(ctx)
    const widgetLayout = this.calculateWidgetLayout(ctx, wrappedLines)

    // Adjust for scroll offset and header offset
    const headerHeight = this.getHeaderHeight()
    const adjustedY = y - headerHeight + this.scrollY
    const adjustedX = x + this.scrollX

    // Calculate visual line number accounting for widget heights
    const clampedVisualLineIndex = this.getVisualLineFromY(adjustedY, wrappedLines, widgetLayout)

    // Get the wrapped line
    const wrappedLine = wrappedLines[clampedVisualLineIndex]
    if (!wrappedLine) {
      return { line: 0, column: 0, columnIntent: 0 }
    }

    // Calculate column position within the visual line, accounting for inline widgets
    const textPadding = this.getTextPadding()
    const inlineWidgetsForLine = widgetLayout.inlineWidgets.get(clampedVisualLineIndex) || []
    const sortedInlineWidgets = [...inlineWidgetsForLine].sort((a, b) => a.column - b.column)

    let xAdjusted = adjustedX - textPadding
    let visualColumn = 0
    let currentX = 0
    let foundPosition = false

    for (const { widget, column } of sortedInlineWidgets) {
      const columnInWrappedLine = column - wrappedLine.startColumn
      const textSegment = wrappedLine.text.substring(visualColumn, columnInWrappedLine)
      const textWidth = ctx.measureText(textSegment).width
      const widgetWidth = ctx.measureText('X'.repeat(widget.length)).width

      if (xAdjusted < currentX + textWidth) {
        // Click is in text before this widget
        const relativeColumn = this.getColumnFromX(xAdjusted - currentX, textSegment, ctx)
        visualColumn = visualColumn + relativeColumn
        foundPosition = true
        break
      }

      currentX += textWidth
      if (xAdjusted < currentX + widgetWidth) {
        // Click is on the widget - place caret at widget position
        visualColumn = columnInWrappedLine
        foundPosition = true
        break
      }

      // Move past widget
      currentX += widgetWidth
      // After this widget, next text starts at same column (widget doesn't consume text)
      visualColumn = columnInWrappedLine
    }

    // Check remaining text after all widgets
    if (!foundPosition) {
      const remainingText = wrappedLine.text.substring(visualColumn)
      if (remainingText.length > 0) {
        const relativeColumn = this.getColumnFromX(xAdjusted - currentX, remainingText, ctx)
        visualColumn = visualColumn + relativeColumn
      }
    }

    // If we're at the start of a wrapped segment (visualColumn = 0) and this is a continuation
    // of the previous segment (same logical line), place caret at end of previous segment instead
    if (visualColumn === 0 && clampedVisualLineIndex > 0) {
      const prevWrappedLine = wrappedLines[clampedVisualLineIndex - 1]
      if (prevWrappedLine && prevWrappedLine.logicalLine === wrappedLine.logicalLine) {
        // Place caret at end of previous segment
        return {
          line: prevWrappedLine.logicalLine,
          column: prevWrappedLine.endColumn,
          columnIntent: prevWrappedLine.endColumn,
        }
      }
    }

    // Convert visual position to logical position
    const logicalPosition = this.visualToLogicalPosition(
      clampedVisualLineIndex,
      visualColumn,
      wrappedLines,
    )

    return {
      line: logicalPosition.logicalLine,
      column: logicalPosition.logicalColumn,
      columnIntent: logicalPosition.logicalColumn,
    }
  }

  public getCaretForHorizontalMove(
    direction: 'left' | 'right',
    line: number,
    column: number,
  ): { line: number; column: number; columnIntent: number } | null {
    if (!this.options.wordWrap) {
      return null // Fall back to normal handling
    }

    const ctx = this.canvas.getContext('2d')
    if (!ctx) return null

    this.setFont(ctx)
    const wrappedLines = this.getWrappedLines(ctx)

    // Find current visual position
    const currentVisual = this.logicalToVisualPosition(line, column, wrappedLines)
    if (currentVisual.visualLine < 0 || currentVisual.visualLine >= wrappedLines.length) {
      return null
    }

    const currentWrapped = wrappedLines[currentVisual.visualLine]
    let nextVisualLine: number
    let nextVisualColumn: number

    if (direction === 'left') {
      if (currentVisual.visualColumn > 0) {
        // Move left within current segment
        nextVisualLine = currentVisual.visualLine
        nextVisualColumn = currentVisual.visualColumn - 1
      }
      else if (currentVisual.visualLine > 0) {
        const prevWrapped = wrappedLines[currentVisual.visualLine - 1]
        // Check if we're at the start of a wrapped segment (not first segment of logical line)
        if (prevWrapped.logicalLine === currentWrapped.logicalLine) {
          // Move to end of previous segment of same logical line
          // Use length - 1 to land ON the last character, not after it
          // (otherwise conversion back to logical would snap to next segment start)
          nextVisualLine = currentVisual.visualLine - 1
          nextVisualColumn = Math.max(0, prevWrapped.text.length - 1)
        }
        else {
          // We're at the start of the first segment of this logical line
          // Move to end of previous logical line
          if (line > 0) {
            const prevLine = line - 1
            const prevLineText = this.inputState.lines[prevLine] || ''
            return {
              line: prevLine,
              column: prevLineText.length,
              columnIntent: prevLineText.length,
            }
          }
          return null
        }
      }
      else {
        // At start of first visual line
        return null
      }
    }
    else {
      // right
      if (currentVisual.visualColumn < currentWrapped.text.length) {
        // Move right within current segment
        nextVisualLine = currentVisual.visualLine
        nextVisualColumn = currentVisual.visualColumn + 1
      }
      else if (currentVisual.visualLine < wrappedLines.length - 1) {
        // Move to next segment
        nextVisualLine = currentVisual.visualLine + 1
        const nextWrapped = wrappedLines[nextVisualLine]
        // If next segment is part of same logical line, move to position 1 (inside the segment)
        // to avoid being placed back at end of previous segment, but only if segment has content
        if (nextWrapped.logicalLine === currentWrapped.logicalLine && nextWrapped.text.length > 1) {
          nextVisualColumn = 1
        }
        else {
          nextVisualColumn = 0
        }
      }
      else {
        // At end of last segment, try to move to next line
        if (line < this.inputState.lines.length - 1) {
          return {
            line: line + 1,
            column: 0,
            columnIntent: 0,
          }
        }
        return null
      }
    }

    // Convert visual position back to logical
    const logical = this.visualToLogicalPosition(nextVisualLine, nextVisualColumn, wrappedLines)

    // For horizontal movement, columnIntent should be the visual position within the current wrapped segment
    // This ensures that when moving vertically later, we maintain the intended visual position
    const targetWrapped = wrappedLines[nextVisualLine]
    const visualColumnIntent = Math.min(nextVisualColumn, targetWrapped.text.length)

    const result = {
      line: logical.logicalLine,
      column: logical.logicalColumn,
      columnIntent: visualColumnIntent, // Use visual position, not absolute logical position
    }

    return result
  }

  public getCaretForVerticalMove(
    direction: 'up' | 'down',
    line: number,
    columnIntent: number,
  ): { line: number; column: number; columnIntent?: number } | null {
    if (!this.options.wordWrap) {
      return null // Fall back to normal handling
    }

    const ctx = this.canvas.getContext('2d')
    if (!ctx) {
      return { line, column: Math.min(columnIntent, (this.inputState.lines[line] || '').length) }
    }

    this.setFont(ctx)
    const wrappedLines = this.getWrappedLines(ctx)

    // Current visual position (using actual current column, not columnIntent)
    const currentColumn = Math.min(
      this.inputState.caret.column,
      (this.inputState.lines[line] || '').length,
    )
    const currentVisual = this.logicalToVisualPosition(line, currentColumn, wrappedLines)

    let nextVisualLine: number
    if (direction === 'down') {
      nextVisualLine = currentVisual.visualLine + 1
      if (nextVisualLine >= wrappedLines.length) {
        return { line, column: currentColumn } // Already at last line
      }
    }
    else {
      nextVisualLine = currentVisual.visualLine - 1
      if (nextVisualLine < 0) {
        return { line, column: currentColumn } // Already at first line
      }
    }

    const currentWrapped = wrappedLines[currentVisual.visualLine]
    const nextWrapped = wrappedLines[nextVisualLine]

    // Determine the visual column intent
    // When at the start of a wrapped segment (visualColumn 0), always use 0 as intent
    // When at end or in an empty line, preserve the intent
    // Otherwise, use the max of current position and stored intent
    const atStartOfSegment = currentVisual.visualColumn === 0 && currentColumn > 0
    const atEndOfLine = currentVisual.visualColumn >= currentWrapped.text.length
    const visualIntent = atStartOfSegment
      ? 0
      : atEndOfLine
      ? columnIntent
      : Math.max(currentVisual.visualColumn, columnIntent)
    const clampedVisualIntent = Math.min(Math.max(visualIntent, 0), nextWrapped.text.length)

    // Convert visual position to logical position within the target wrapped segment
    const logical = this.visualToLogicalPosition(nextVisualLine, clampedVisualIntent, wrappedLines)

    // Preserve the unclamped visual intent so column position is remembered through short lines
    return {
      line: logical.logicalLine,
      column: logical.logicalColumn,
      columnIntent: visualIntent, // Preserve the desired visual column
    }
  }

  public getCaretForLineStart(
    line: number,
    column: number,
  ): { line: number; column: number; columnIntent: number } | null {
    // Smart Home behavior at logical line level:
    // 1. If at beginning (column 0) → move to first non-whitespace
    // 2. If at first non-whitespace → move to beginning (column 0)
    // 3. If in middle (after first non-whitespace) → move to first non-whitespace
    const currentLine = this.inputState.lines[line] || ''
    const firstNonWhitespace = currentLine.search(/\S/)
    const firstNonWhitespaceColumn = firstNonWhitespace === -1 ? currentLine.length : firstNonWhitespace

    let targetColumn: number
    if (column === 0) {
      // At beginning → move to first non-whitespace
      targetColumn = firstNonWhitespaceColumn
    }
    else if (column === firstNonWhitespaceColumn) {
      // At first non-whitespace → move to beginning
      targetColumn = 0
    }
    else {
      // In middle → move to first non-whitespace
      targetColumn = firstNonWhitespaceColumn
    }

    if (this.options.wordWrap) {
      // For word wrap mode, we need to handle visual positioning
      const ctx = this.canvas.getContext('2d')
      if (!ctx) return null

      this.setFont(ctx)
      const wrappedLines = this.getWrappedLines(ctx)

      // Find visual position for target column
      const targetVisual = this.logicalToVisualPosition(line, targetColumn, wrappedLines)
      if (targetVisual.visualLine < 0 || targetVisual.visualLine >= wrappedLines.length) {
        return null
      }

      // Get the logical position for the start of the visual line containing the target
      const logical = this.visualToLogicalPosition(targetVisual.visualLine, 0, wrappedLines)

      return {
        line: logical.logicalLine,
        column: targetColumn,
        columnIntent: targetColumn,
      }
    }

    // For non-word-wrap mode, just return the target column
    return {
      line,
      column: targetColumn,
      columnIntent: targetColumn,
    }
  }

  public getCaretForLineEnd(
    line: number,
    column: number,
  ): { line: number; column: number; columnIntent: number } | null {
    if (!this.options.wordWrap) {
      return null // Fall back to normal handling
    }

    const ctx = this.canvas.getContext('2d')
    if (!ctx) return null

    this.setFont(ctx)
    const wrappedLines = this.getWrappedLines(ctx)

    // Find current visual position
    const currentVisual = this.logicalToVisualPosition(line, column, wrappedLines)
    if (currentVisual.visualLine < 0 || currentVisual.visualLine >= wrappedLines.length) {
      return null
    }

    // Move to end of current wrapped line segment
    const wrapped = wrappedLines[currentVisual.visualLine]
    const logical = this.visualToLogicalPosition(
      currentVisual.visualLine,
      wrapped.text.length,
      wrappedLines,
    )

    return {
      line: logical.logicalLine,
      column: logical.logicalColumn,
      columnIntent: logical.logicalColumn,
    }
  }

  private getColumnFromX(x: number, line: string, ctx: CanvasRenderingContext2D): number {
    if (x <= 0) return 0

    // Measure text width to find the closest character position
    let currentWidth = 0
    for (let i = 0; i < line.length; i++) {
      const charWidth = ctx.measureText(line[i]).width
      const nextWidth = currentWidth + charWidth

      // If x is closer to the middle of this character, return this position
      if (x <= currentWidth + charWidth / 2) {
        return i
      }

      currentWidth = nextWidth
    }

    // If we've gone through all characters, return the end of the line
    return line.length
  }

  public updateState(newState: InputState, ensureCaretVisible = false,
    widgetData?: Array<{ line: number; column: number; type: string; length: number; height?: number }>)
  {
    // Invalidate wrapped lines cache if lines changed
    const oldLines = this.inputState.lines
    const linesChanged = oldLines !== newState.lines
    const changedLogicalLines = linesChanged ? findChangedLogicalLines(oldLines, newState.lines) : new Set<number>()

    // Track caret position change before updating state
    const caretChanged = this.inputState.caret.line !== newState.caret.line
      || this.inputState.caret.column !== newState.caret.column

    // Apply widget data from history if provided (undo/redo)
    if (widgetData && widgetData.length > 0) {
      if (!this.options.widgets || this.options.widgets.length === 0) {
        // No widgets to restore to - this shouldn't happen but handle gracefully
      }
      else {
        // Restore widgets exactly as they were in history
        // Match widgets from history to existing widgets by type and length, then update positions
        const usedWidgets = new Set<EditorWidget>()
        let restoredCount = 0

        for (const data of widgetData) {
          // Find best matching widget by type and length, preferring closest position
          let bestMatch: EditorWidget | null = null
          let bestDistance = Infinity

          for (const widget of this.options.widgets) {
            if (usedWidgets.has(widget)) continue

            if (widget.type === data.type && widget.length === data.length) {
              // Calculate distance to prefer widgets that are closer to the history position
              const distance = Math.abs(widget.line - data.line) + Math.abs(widget.column - data.column)
              if (distance < bestDistance) {
                bestDistance = distance
                bestMatch = widget
              }
            }
          }

          if (bestMatch) {
            // Update position and height from history
            bestMatch.line = data.line
            bestMatch.column = data.column
            if (data.height !== undefined) {
              bestMatch.height = data.height
            }
            usedWidgets.add(bestMatch)
            restoredCount++
          }
          else {
          }
        }

        // Clear any pending widget updates to prevent props from overwriting restored positions
        if (this.widgetUpdateTimeout !== null) {
          clearTimeout(this.widgetUpdateTimeout)
          this.widgetUpdateTimeout = null
        }
        this.pendingWidgets = null

        // Mark that we just restored from history - prevent props from overwriting for 1 second
        this.justRestoredFromHistory = true
        setTimeout(() => {
          this.justRestoredFromHistory = false
        }, 1000)

        // Force a redraw to show restored positions
        this.maybeDraw()
      }
    }
    else {
      this.justRestoredFromHistory = false
    }

    // Track if we were at the bottom before update (must check before invalidating cache)
    const ctx = this.canvas.getContext('2d')

    if (linesChanged) {
      this.wrappedLinesCache = null
      this.invalidateMeasurementCaches()
      if (changedLogicalLines.size > 0) {
        // Invalidate only the specific changed logical lines (assuming syntax highlighting doesn't cascade)
        this.offscreenLineCache.invalidateLogicalLines(changedLogicalLines)
      }
    }

    this.inputState = newState

    // Pre-calculate wrapped lines for draw() to avoid double calculation
    if (ctx) {
      this.setFont(ctx)
      this.pendingWrappedLines = this.getWrappedLines(ctx)
    }
    else {
      this.pendingWrappedLines = null
    }

    // Reset caret activity time on input/movement (caret becomes visible when active)
    if (this.isActive && caretChanged) {
      this.lastCaretActivityTime = performance.now()
      this.caretOpacity = 1
    }
    if (this.isActive && (ensureCaretVisible || linesChanged)) {
      queueMicrotask(() => {
        this.ensureCaretVisible()
      })
    }
    this.maybeDraw()
    // Only update autocomplete when text changes (typing), not on navigation
    if (linesChanged) {
      this.updateAutocomplete()
    }
    this.updateFunctionSignature()
  }

  public resize() {
    // Invalidate wrapped lines cache on resize
    this.wrappedLinesCache = null
    this.invalidateMeasurementCaches()
    this.offscreenLineCache.clear()
    this.offscreenLineRenderVersion++

    // Store old dimensions before updating
    const oldWidth = this.canvas.width / (window.devicePixelRatio || 1)
    const oldHeight = this.canvas.height / (window.devicePixelRatio || 1)

    this.updateCanvasSize()

    // Get new dimensions
    const newWidth = this.canvas.width / (window.devicePixelRatio || 1)
    const newHeight = this.canvas.height / (window.devicePixelRatio || 1)

    // Adjust scroll position to keep content properly visible after resize
    this.adjustScrollAfterResize(oldWidth, oldHeight, newWidth, newHeight)

    this.draw()
    this.updateFunctionSignature() // Need to update popup positions when canvas resizes
  }

  public destroy() {
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler)
      this.resizeHandler = null
    }
    if (this.wheelHandler) {
      this.canvas.removeEventListener('wheel', this.wheelHandler as EventListener)
      this.wheelHandler = null
    }
    if (this.wheelScrollDebounceTimer !== null) {
      clearTimeout(this.wheelScrollDebounceTimer)
      this.wheelScrollDebounceTimer = null
    }
    if (this.dominantAxisTimer !== null) {
      clearTimeout(this.dominantAxisTimer)
      this.dominantAxisTimer = null
    }
    this.currentDominantAxis = null
    if (this.touchStartHandler) {
      this.canvas.removeEventListener('touchstart', this.touchStartHandler as EventListener)
      this.touchStartHandler = null
    }
    if (this.touchMoveHandler) {
      this.canvas.removeEventListener('touchmove', this.touchMoveHandler as EventListener)
      this.touchMoveHandler = null
    }
    if (this.touchEndHandler) {
      this.canvas.removeEventListener('touchend', this.touchEndHandler as EventListener)
      this.canvas.removeEventListener('touchcancel', this.touchEndHandler as EventListener)
      this.touchEndHandler = null
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect()
      this.resizeObserver = null
    }
    if (this.autocompleteDebounceTimer !== null) {
      clearTimeout(this.autocompleteDebounceTimer)
      this.autocompleteDebounceTimer = null
    }
    if (this.widgetUpdateTimeout !== null) {
      clearTimeout(this.widgetUpdateTimeout)
      this.widgetUpdateTimeout = null
    }
    this.stopAutoScroll()
    this.stopMomentumScroll()
    this.stopCaretBlink()
    this.stopAnimationLoop()
    this.clearSignaturePopupCanvas()
    this.clearErrorPopupCanvas()
  }

  public setScroll(x: number | null, y: number | null) {
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return
    this.setFont(ctx)

    const dpr = window.devicePixelRatio || 1
    const viewportWidth = this.canvas.width / dpr
    const headerHeight = this.getHeaderHeight()
    const viewportHeight = (this.canvas.height / dpr) - headerHeight
    const contentSize = this.options.wordWrap
      ? this.getContentSizeWithWrapping(ctx, this.getWrappedLines(ctx))
      : this.getContentSize(ctx)
    const maxScrollX = Math.max(0, contentSize.width - viewportWidth)
    const maxScrollY = Math.max(0, contentSize.height - viewportHeight)

    const nextScrollX = x === null ? this.scrollX : Math.min(Math.max(x, 0), maxScrollX)
    const nextScrollY = y === null ? this.scrollY : Math.min(Math.max(y, 0), maxScrollY)

    if (nextScrollX !== this.scrollX || nextScrollY !== this.scrollY) {
      this.scrollX = nextScrollX
      this.scrollY = nextScrollY
      this.callbacks.onScrollChange?.(this.scrollX, this.scrollY)
      this.publishScrollMetrics(
        ctx,
        viewportWidth,
        viewportHeight,
        contentSize.width,
        contentSize.height,
      )
      this.maybeDraw()
      this.updateFunctionSignature()
    }
    else {
      this.publishScrollMetrics(
        ctx,
        viewportWidth,
        viewportHeight,
        contentSize.width,
        contentSize.height,
      )
    }
  }

  public setScrollWithoutDraw(x: number | null, y: number | null) {
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return
    this.setFont(ctx)

    const dpr = window.devicePixelRatio || 1
    const viewportWidth = this.canvas.width / dpr
    const headerHeight = this.getHeaderHeight()
    const viewportHeight = (this.canvas.height / dpr) - headerHeight
    const contentSize = this.options.wordWrap
      ? this.getContentSizeWithWrapping(ctx, this.getWrappedLines(ctx))
      : this.getContentSize(ctx)
    const maxScrollX = Math.max(0, contentSize.width - viewportWidth)
    const maxScrollY = Math.max(0, contentSize.height - viewportHeight)

    const nextScrollX = x === null ? this.scrollX : Math.min(Math.max(x, 0), maxScrollX)
    const nextScrollY = y === null ? this.scrollY : Math.min(Math.max(y, 0), maxScrollY)

    if (nextScrollX !== this.scrollX || nextScrollY !== this.scrollY) {
      this.scrollX = nextScrollX
      this.scrollY = nextScrollY
      this.callbacks.onScrollChange?.(this.scrollX, this.scrollY)
      this.publishScrollMetrics(
        ctx,
        viewportWidth,
        viewportHeight,
        contentSize.width,
        contentSize.height,
      )
    }
    else {
      this.publishScrollMetrics(
        ctx,
        viewportWidth,
        viewportHeight,
        contentSize.width,
        contentSize.height,
      )
    }
  }

  public getScrollMetrics(): {
    scrollX: number
    scrollY: number
    viewportWidth: number
    viewportHeight: number
    contentWidth: number
    contentHeight: number
  } | null {
    // Ensure canvas size is up to date before calculating metrics
    this.updateCanvasSize()

    const ctx = this.canvas.getContext('2d')
    if (!ctx) return null
    this.setFont(ctx)

    const dpr = window.devicePixelRatio || 1
    const viewportWidth = this.canvas.width / dpr
    const headerHeight = this.getHeaderHeight()
    const viewportHeight = (this.canvas.height / dpr) - headerHeight
    const wrappedLines = this.getWrappedLines(ctx)
    const content = this.getContentSizeWithWrapping(ctx, wrappedLines)
    return {
      scrollX: this.scrollX,
      scrollY: this.scrollY,
      viewportWidth,
      viewportHeight,
      contentWidth: content.width,
      contentHeight: content.height,
    }
  }

  public isTouchScrollingActive(): boolean {
    return this.isTouchScrolling
  }

  public isTouchGestureActive(): boolean {
    return this.isTouchGesture || this.touchStartX !== null
  }

  public didTouchScroll(): boolean {
    // Check if total movement exceeds tap threshold
    if (this.touchStartX !== null && this.touchStartY !== null) {
      const totalMovement = Math.sqrt(
        Math.pow(this.touchStartX - this.lastTouchMoveX, 2)
          + Math.pow(this.touchStartY - this.lastTouchMoveY, 2),
      )
      const tapThreshold = 15
      return totalMovement >= tapThreshold
    }
    return this.touchScrolled
  }

  public clearTouchScrollFlag(): void {
    this.touchScrolled = false
  }

  public getTextPaddingValue(): number {
    return this.getTextPadding()
  }

  private setupResize() {
    let resizeTimeout: number | null = null

    const handleResize = () => {
      // Check if DPR changed (e.g., browser zoom)
      const currentDpr = window.devicePixelRatio || 1
      const dprChanged = Math.abs(currentDpr - this.lastDpr) > 0.01

      if (dprChanged) {
        // DPR changed - update immediately without throttle
        this.lastDpr = currentDpr
        if (resizeTimeout) {
          clearTimeout(resizeTimeout)
          resizeTimeout = null
        }
        this.resize()
      }
      else {
        if (resizeTimeout) {
          clearTimeout(resizeTimeout)
          resizeTimeout = null
        }
        this.resize()
        // Normal resize - throttle
        // if (resizeTimeout) {
        //   clearTimeout(resizeTimeout)
        // }
        // resizeTimeout = setTimeout(() => {
        //   this.resize()
        // }, 16) // ~60fps throttle
      }
    }

    window.addEventListener('resize', handleResize)
    this.resizeHandler = handleResize

    // Observe container size changes (e.g., flex layout, pane resizers)
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        handleResize()
      })
      observer.observe(this.container)
      this.resizeObserver = observer
    }
  }

  private setupWheel() {
    const handleWheel = (e: WheelEvent) => {
      const dpr = window.devicePixelRatio || 1
      const viewportWidth = this.canvas.width / dpr
      const headerHeight = this.getHeaderHeight()
      const viewportHeight = (this.canvas.height / dpr) - headerHeight

      const ctx = this.canvas.getContext('2d')
      if (!ctx) return
      this.setFont(ctx)

      const contentSize = this.options.wordWrap
        ? this.getContentSizeWithWrapping(ctx, this.getWrappedLines(ctx))
        : this.getContentSize(ctx)

      // Natural scrolling: use deltaX/deltaY; shift can swap intent
      const effectiveDeltaX = e.deltaX || (e.shiftKey ? e.deltaY : 0)
      const effectiveDeltaY = e.shiftKey ? 0 : e.deltaY

      // Determine dominant scroll axis with debounced switching
      const absX = Math.abs(effectiveDeltaX)
      const absY = Math.abs(effectiveDeltaY)
      const newDominantAxis = absX > absY ? 'horizontal' : 'vertical'

      // Initialize dominant axis on first scroll
      if (this.currentDominantAxis === null) {
        this.currentDominantAxis = newDominantAxis
      }

      // Handle axis switching with debounce
      const axisChanged = newDominantAxis !== this.currentDominantAxis

      if (axisChanged) {
        // Clear existing timer
        if (this.dominantAxisTimer !== null) {
          clearTimeout(this.dominantAxisTimer)
          this.dominantAxisTimer = null
        }

        // Start debounce timer to change axis
        // this.dominantAxisTimer = window.setTimeout(() => {
        this.currentDominantAxis = newDominantAxis
        this.dominantAxisTimer = null
        // }, 0)
      }
      else {
        // Same axis, clear any pending timer
        if (this.dominantAxisTimer !== null) {
          clearTimeout(this.dominantAxisTimer)
          this.dominantAxisTimer = null
        }
      }

      // Apply only current dominant axis
      const finalDeltaX = this.currentDominantAxis === 'horizontal' ? effectiveDeltaX : 0
      const finalDeltaY = this.currentDominantAxis === 'vertical' ? effectiveDeltaY : 0

      const maxScrollX = Math.max(0, contentSize.width - viewportWidth)
      const maxScrollY = Math.max(0, contentSize.height - viewportHeight)

      // If nothing is scrollable, allow page to handle it
      if (maxScrollX === 0 && maxScrollY === 0) {
        return
      }

      // Determine dominant intent and only prevent default if that axis can scroll
      const horizontalIntent = this.currentDominantAxis === 'horizontal'
      // Treat very small remaining scroll room as non-scrollable to avoid trapping the page
      const epsilon = 1
      const canScrollHorizontally = finalDeltaX !== 0 && maxScrollX > epsilon
      const canScrollVertically = finalDeltaY !== 0 && maxScrollY > epsilon

      // Check if we can actually scroll in the direction we're trying to scroll
      const canScrollXInDirection = canScrollHorizontally
        && ((finalDeltaX > 0 && this.scrollX < maxScrollX)
          || (finalDeltaX < 0 && this.scrollX > 0))
      const canScrollYInDirection = canScrollVertically
        && ((finalDeltaY > 0 && this.scrollY < maxScrollY)
          || (finalDeltaY < 0 && this.scrollY > 0))

      // Check if there's more scroll available in the y direction
      // For vertical scrolling, check if we can scroll in that direction
      // For horizontal scrolling, check if there's any vertical scroll room
      const hasMoreScrollY = maxScrollY > epsilon
        && (finalDeltaY !== 0
          ? canScrollYInDirection
          : (this.scrollY < maxScrollY || this.scrollY > 0))

      // Check if we're at the end of vertical scroll
      const isAtEndY = maxScrollY > epsilon
        && ((finalDeltaY > 0 && this.scrollY >= maxScrollY)
          || (finalDeltaY < 0 && this.scrollY <= 0)
          || (finalDeltaY === 0 && this.scrollY >= maxScrollY))

      // Clear existing debounce timer
      if (this.wheelScrollDebounceTimer !== null) {
        clearTimeout(this.wheelScrollDebounceTimer)
        this.wheelScrollDebounceTimer = null
      }

      // If we're actively scrolling (debounce active), always prevent default (even at the end)
      // If we're not actively scrolling (debounce completed), only prevent if there's more scroll (not at the end)
      // If there's more vertical scroll available, always prevent default regardless of dominant scroll intent
      const hasScrollToPrevent = hasMoreScrollY
        ? true
        : (horizontalIntent ? canScrollXInDirection : canScrollYInDirection)

      const shouldPrevent = this.isWheelScrolling
        ? (hasScrollToPrevent || isAtEndY)
        : hasScrollToPrevent

      if (!shouldPrevent) {
        // Set debounce timer to mark scrolling as stopped
        this.wheelScrollDebounceTimer = window.setTimeout(() => {
          this.isWheelScrolling = false
          this.wheelScrollDebounceTimer = null
        }, 100)
        return
      }

      // Mark as actively scrolling
      this.isWheelScrolling = true

      // Set debounce timer to mark scrolling as stopped after inactivity
      this.wheelScrollDebounceTimer = window.setTimeout(() => {
        this.isWheelScrolling = false
        this.wheelScrollDebounceTimer = null
      }, 100)

      e.preventDefault()

      const nextScrollX = Math.min(Math.max(this.scrollX + finalDeltaX, 0), maxScrollX)
      const nextScrollY = Math.min(Math.max(this.scrollY + finalDeltaY, 0), maxScrollY)

      if (nextScrollX !== this.scrollX || nextScrollY !== this.scrollY) {
        this.scrollX = nextScrollX
        this.scrollY = nextScrollY
        this.callbacks.onScrollChange?.(this.scrollX, this.scrollY)
        this.publishScrollMetrics(
          ctx,
          viewportWidth,
          viewportHeight,
          contentSize.width,
          contentSize.height,
        )
        this.maybeDraw()
        this.updateFunctionSignature()
      }
    }

    this.canvas.addEventListener('wheel', handleWheel, { passive: false })
    this.wheelHandler = handleWheel
  }

  private setupTouch() {
    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return

      // Don't start touch scrolling if a widget is being handled
      if (this.isWidgetPointerDown) return

      // Stop any active momentum scroll first to get the current scroll position
      this.stopMomentumScroll()

      const touch = e.touches[0]
      const now = performance.now()
      this.touchStartX = touch.clientX
      this.touchStartY = touch.clientY
      this.touchStartTime = now
      // Capture scroll position after stopping momentum to avoid jumps
      this.touchStartScrollX = this.scrollX
      this.touchStartScrollY = this.scrollY
      this.isTouchScrolling = false
      this.isTouchGesture = true
      this.touchScrolled = false
      this.lastTouchMoveTime = now
      this.lastTouchMoveX = touch.clientX
      this.lastTouchMoveY = touch.clientY
      this.touchVelocityX = 0
      this.touchVelocityY = 0
      this.velocitySamples = []

      const dpr = window.devicePixelRatio || 1
      const viewportWidth = this.canvas.width / dpr
      const headerHeight = this.getHeaderHeight()
      const viewportHeight = (this.canvas.height / dpr) - headerHeight

      const ctx = this.canvas.getContext('2d')
      if (!ctx) return
      this.setFont(ctx)

      const contentSize = this.options.wordWrap
        ? this.getContentSizeWithWrapping(ctx, this.getWrappedLines(ctx))
        : this.getContentSize(ctx)

      const maxScrollX = Math.max(0, contentSize.width - viewportWidth)
      const maxScrollY = Math.max(0, contentSize.height - viewportHeight)

      if (maxScrollX > 0 || maxScrollY > 0) {
        e.preventDefault()
      }
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1 || this.touchStartX === null || this.touchStartY === null) return

      // Don't handle touch scrolling if a widget is being handled
      if (this.isWidgetPointerDown) return

      const touch = e.touches[0]
      const now = performance.now()
      const deltaX = this.touchStartX - touch.clientX
      const deltaY = this.touchStartY - touch.clientY

      const absX = Math.abs(deltaX)
      const absY = Math.abs(deltaY)
      const movementThreshold = 10

      if (absX > movementThreshold || absY > movementThreshold) {
        this.isTouchScrolling = true
        e.preventDefault()
      }

      // Calculate velocity for momentum scrolling (pixels per frame, assuming ~60fps)
      if (this.lastTouchMoveTime > 0) {
        const timeDelta = now - this.lastTouchMoveTime
        if (timeDelta > 0 && timeDelta < 100) {
          const moveDeltaX = this.lastTouchMoveX - touch.clientX
          const moveDeltaY = this.lastTouchMoveY - touch.clientY
          // Convert to pixels per frame (assuming 60fps = 16.67ms per frame)
          const frames = timeDelta / 16.67
          const vx = moveDeltaX / frames
          const vy = moveDeltaY / frames

          // Store velocity sample for averaging
          this.velocitySamples.push({ time: now, vx, vy })
          // Keep only last 5 samples (last ~80ms at 60fps)
          if (this.velocitySamples.length > 5) {
            this.velocitySamples.shift()
          }

          // Use weighted average of recent samples (more recent = higher weight)
          let totalWeight = 0
          let weightedVx = 0
          let weightedVy = 0
          for (let i = 0; i < this.velocitySamples.length; i++) {
            const weight = i + 1
            weightedVx += this.velocitySamples[i].vx * weight
            weightedVy += this.velocitySamples[i].vy * weight
            totalWeight += weight
          }
          this.touchVelocityX = weightedVx / totalWeight
          this.touchVelocityY = weightedVy / totalWeight
        }
      }
      this.lastTouchMoveTime = now
      this.lastTouchMoveX = touch.clientX
      this.lastTouchMoveY = touch.clientY

      const dpr = window.devicePixelRatio || 1
      const viewportWidth = this.canvas.width / dpr
      const headerHeight = this.getHeaderHeight()
      const viewportHeight = (this.canvas.height / dpr) - headerHeight

      const ctx = this.canvas.getContext('2d')
      if (!ctx) return
      this.setFont(ctx)

      const contentSize = this.options.wordWrap
        ? this.getContentSizeWithWrapping(ctx, this.getWrappedLines(ctx))
        : this.getContentSize(ctx)

      const maxScrollX = Math.max(0, contentSize.width - viewportWidth)
      const maxScrollY = Math.max(0, contentSize.height - viewportHeight)

      if (maxScrollX === 0 && maxScrollY === 0) {
        return
      }

      const horizontalIntent = absX > absY

      const epsilon = 1
      const canScrollHorizontally = deltaX !== 0 && maxScrollX > epsilon
      const canScrollVertically = deltaY !== 0 && maxScrollY > epsilon

      const canScrollXInDirection = canScrollHorizontally
        && ((deltaX > 0 && this.touchStartScrollX < maxScrollX)
          || (deltaX < 0 && this.touchStartScrollX > 0))
      const canScrollYInDirection = canScrollVertically
        && ((deltaY > 0 && this.touchStartScrollY < maxScrollY)
          || (deltaY < 0 && this.touchStartScrollY > 0))

      const shouldPrevent = horizontalIntent ? canScrollXInDirection : canScrollYInDirection
      if (!shouldPrevent) {
        return
      }

      e.preventDefault()

      const nextScrollX = Math.min(Math.max(this.touchStartScrollX + deltaX, 0), maxScrollX)
      const nextScrollY = Math.min(Math.max(this.touchStartScrollY + deltaY, 0), maxScrollY)

      if (nextScrollX !== this.scrollX || nextScrollY !== this.scrollY) {
        this.scrollX = nextScrollX
        this.scrollY = nextScrollY
        this.touchScrolled = true
        this.callbacks.onScrollChange?.(this.scrollX, this.scrollY)
        this.publishScrollMetrics(
          ctx,
          viewportWidth,
          viewportHeight,
          contentSize.width,
          contentSize.height,
        )
        this.maybeDraw()
        this.updateFunctionSignature()
      }
    }

    const handleTouchEnd = () => {
      // Check if total movement was small enough to be considered a tap
      const totalMovement = this.touchStartX !== null && this.touchStartY !== null
        ? Math.sqrt(
          Math.pow(this.touchStartX - this.lastTouchMoveX, 2)
            + Math.pow(this.touchStartY - this.lastTouchMoveY, 2),
        )
        : 0

      const tapThreshold = 15
      const isTap = totalMovement < tapThreshold

      // Only calculate momentum if it wasn't a tap
      if (!isTap) {
        // Calculate overall gesture velocity based on total distance and time
        const now = performance.now()
        const totalTime = now - this.touchStartTime
        if (totalTime > 0 && this.touchStartX !== null && this.touchStartY !== null) {
          const totalDeltaX = this.touchStartX - this.lastTouchMoveX
          const totalDeltaY = this.touchStartY - this.lastTouchMoveY
          const overallVx = (totalDeltaX / totalTime) * 16.67
          const overallVy = (totalDeltaY / totalTime) * 16.67

          // Use the maximum of instantaneous velocity and overall velocity
          // This gives stronger momentum for fast gestures
          const speed = Math.sqrt(overallVx * overallVx + overallVy * overallVy)
          const speedMultiplier = Math.min(speed / 20, 1.5)
          this.touchVelocityX = Math.max(Math.abs(this.touchVelocityX), Math.abs(overallVx))
            * Math.sign(this.touchVelocityX || overallVx) * (1 + speedMultiplier * 0.4)
          this.touchVelocityY = Math.max(Math.abs(this.touchVelocityY), Math.abs(overallVy))
            * Math.sign(this.touchVelocityY || overallVy) * (1 + speedMultiplier * 0.4)
        }

        // Start momentum scrolling if there's velocity
        const velocityThreshold = 0.1
        if (Math.abs(this.touchVelocityX) > velocityThreshold || Math.abs(this.touchVelocityY) > velocityThreshold) {
          this.startMomentumScroll()
        }
      }
      else {
        // Clear velocity for taps
        this.touchVelocityX = 0
        this.touchVelocityY = 0
      }

      this.touchStartX = null
      this.touchStartY = null
      this.isTouchScrolling = false
      this.isTouchGesture = false
      this.lastTouchMoveTime = 0
      this.velocitySamples = []
      // Keep touchScrolled flag until pointerup checks it
    }

    this.canvas.addEventListener('touchstart', handleTouchStart, { passive: false })
    this.canvas.addEventListener('touchmove', handleTouchMove, { passive: false })
    this.canvas.addEventListener('touchend', handleTouchEnd, { passive: true })
    this.canvas.addEventListener('touchcancel', handleTouchEnd, { passive: true })

    this.touchStartHandler = handleTouchStart
    this.touchMoveHandler = handleTouchMove
    this.touchEndHandler = handleTouchEnd
  }

  private getContentSize(ctx: CanvasRenderingContext2D): { width: number; height: number } {
    let maxLineWidth = 0
    for (let i = 0; i < this.inputState.lines.length; i++) {
      const line = this.inputState.lines[i] || ''
      let w = this.lineWidthCache.get(line)
      if (w === undefined) {
        w = ctx.measureText(line).width
        this.lineWidthCache.set(line, w)
      }
      if (w > maxLineWidth) maxLineWidth = w
    }
    const textPadding = this.getTextPadding()
    const width = textPadding + maxLineWidth + this.padding

    // Calculate base height
    let height = this.padding + this.inputState.lines.length * this.lineHeight + this.padding

    // Add extra height for widgets
    const wrappedLines = this.getWrappedLines(ctx)
    const widgetLayout = this.calculateWidgetLayout(ctx, wrappedLines)
    const totalOffset = widgetLayout.yOffsets.get(wrappedLines.length) || 0
    height += totalOffset

    return { width, height }
  }

  private publishScrollMetrics(
    ctx: CanvasRenderingContext2D,
    viewportWidth: number,
    viewportHeight: number,
    contentWidth: number,
    contentHeight: number,
  ) {
    // Only notify if metrics actually changed to prevent infinite update loops
    const changed = this.scrollMetrics.viewportWidth !== viewportWidth
      || this.scrollMetrics.viewportHeight !== viewportHeight
      || this.scrollMetrics.contentWidth !== contentWidth
      || this.scrollMetrics.contentHeight !== contentHeight
      || this.scrollMetrics.scrollX !== this.scrollX
      || this.scrollMetrics.scrollY !== this.scrollY

    this.scrollMetrics = { viewportWidth, viewportHeight, contentWidth, contentHeight, scrollX: this.scrollX,
      scrollY: this.scrollY }

    if (changed) {
      this.callbacks.onScrollMetricsChange?.({
        scrollX: this.scrollX,
        scrollY: this.scrollY,
        viewportWidth,
        viewportHeight,
        contentWidth,
        contentHeight,
      })
    }
  }

  private ensureCaretVisible() {
    if (this.isWidgetPointerDown) return

    const ctx = this.canvas.getContext('2d')
    if (!ctx) return

    this.setFont(ctx)

    const dpr = window.devicePixelRatio || 1
    const viewportWidth = this.canvas.width / dpr
    const headerHeight = this.getHeaderHeight()
    const viewportHeight = (this.canvas.height / dpr) - headerHeight

    let caretX: number, caretTop: number, caretBottom: number
    let contentSize: { width: number; height: number }

    if (this.options.wordWrap) {
      // Get wrapped lines and convert logical position to visual position
      const wrappedLines = this.getWrappedLines(ctx)
      const widgetLayout = this.calculateWidgetLayout(ctx, wrappedLines)
      const visualPos = this.logicalToVisualPosition(
        this.inputState.caret.line,
        this.inputState.caret.column,
        wrappedLines,
      )

      const textPadding = this.getTextPadding()
      const wrappedLine = wrappedLines[visualPos.visualLine]
      if (wrappedLine) {
        const caretText = wrappedLine.text.substring(0, visualPos.visualColumn)
        caretX = textPadding + ctx.measureText(caretText).width

        // Account for inline widgets before the caret
        const inlineWidgetsForLine = widgetLayout.inlineWidgets.get(visualPos.visualLine) || []
        for (const { widget, column } of inlineWidgetsForLine) {
          const columnInWrappedLine = column - wrappedLine.startColumn
          if (columnInWrappedLine <= visualPos.visualColumn) {
            caretX += ctx.measureText('X'.repeat(widget.length)).width
          }
        }

        const yOffset = widgetLayout.yOffsets.get(visualPos.visualLine) || 0
        // Add max height of 'above' widgets on this line (they are in the same row)
        let aboveHeight = 0
        const widgets = widgetLayout.widgetsByVisualLine.get(visualPos.visualLine)
        if (widgets?.above && widgets.above.length > 0) {
          aboveHeight = this.getAboveSpacingHeight(wrappedLines, visualPos.visualLine, widgets.above)
        }
        caretTop = this.padding + visualPos.visualLine * this.lineHeight + yOffset + aboveHeight
        caretBottom = caretTop + this.lineHeight
      }
      else {
        // Fallback
        caretX = textPadding
        caretTop = this.padding
        caretBottom = caretTop + this.lineHeight
      }

      contentSize = this.getContentSizeWithWrapping(ctx, wrappedLines)
    }
    else {
      // Compute caret content-space coordinates (original logic)
      const textPadding = this.getTextPadding()
      const wrappedLines = this.getWrappedLines(ctx)
      const widgetLayout = this.calculateWidgetLayout(ctx, wrappedLines)

      const caretLine = this.inputState.lines[this.inputState.caret.line] || ''
      const caretText = caretLine.substring(0, this.inputState.caret.column)
      caretX = textPadding + ctx.measureText(caretText).width

      // Account for inline widgets before the caret
      const inlineWidgetsForLine = widgetLayout.inlineWidgets.get(this.inputState.caret.line) || []
      for (const { widget, column } of inlineWidgetsForLine) {
        if (column <= this.inputState.caret.column) {
          caretX += ctx.measureText('X'.repeat(widget.length)).width
        }
      }
      const yOffset = widgetLayout.yOffsets.get(this.inputState.caret.line) || 0
      // Add max height of 'above' widgets on this line (they are in the same row)
      let aboveHeight = 0
      const widgets = widgetLayout.widgetsByVisualLine.get(this.inputState.caret.line)
      if (widgets?.above && widgets.above.length > 0) {
        aboveHeight = Math.max(...widgets.above.map(w => this.getWidgetHeight(w)))
      }
      caretTop = this.padding + this.inputState.caret.line * this.lineHeight + yOffset + aboveHeight
      caretBottom = caretTop + this.lineHeight

      contentSize = this.getContentSize(ctx)
    }

    // Margins so caret isn't flush to edge
    const margin = 50

    // Check if vertical scrollbar is visible (same logic as in render)
    const showVBar = contentSize.height > viewportHeight + 1
    const scrollbarWidth = showVBar ? this.scrollbarWidth : 0

    // Effective viewport width accounting for scrollbar
    const effectiveViewportWidth = viewportWidth - scrollbarWidth

    // Check if caret is already fully visible
    // When gutter is enabled, the effective viewport for text starts after the gutter
    const effectiveViewportLeft = this.scrollX
      + (this.options.gutter ? this.padding + this.getGutterWidth() : this.padding)
    const caretVisibleX = caretX >= effectiveViewportLeft + margin
      && caretX <= this.scrollX + effectiveViewportWidth - margin
    const caretVisibleY = caretTop >= this.scrollY + margin && caretBottom <= this.scrollY + viewportHeight - margin

    // If caret is already fully visible, don't change scroll position
    if (caretVisibleX && caretVisibleY) {
      return
    }

    let nextScrollX = this.scrollX
    let nextScrollY = this.scrollY

    // Horizontal scrolling
    if (!caretVisibleX) {
      if (caretX < effectiveViewportLeft + margin) {
        // Scroll left to make caret visible, accounting for gutter
        nextScrollX = Math.max(0,
          caretX - (this.options.gutter ? this.padding + this.getGutterWidth() + margin : margin))
      }
      else if (caretX > this.scrollX + effectiveViewportWidth - margin) {
        nextScrollX = caretX - (effectiveViewportWidth - margin)
      }
    }

    // Vertical scrolling
    if (!caretVisibleY) {
      if (caretTop < this.scrollY + margin) {
        nextScrollY = Math.max(0, caretTop - margin)
      }
      else if (caretBottom > this.scrollY + viewportHeight - margin) {
        nextScrollY = caretBottom - (viewportHeight - margin)
      }
    }

    // Clamp to content size
    const maxScrollX = Math.max(0, contentSize.width - effectiveViewportWidth)
    const maxScrollY = Math.max(0, contentSize.height - viewportHeight)

    nextScrollX = Math.min(Math.max(nextScrollX, 0), maxScrollX)
    nextScrollY = Math.min(Math.max(nextScrollY, 0), maxScrollY)

    if (nextScrollX !== this.scrollX || nextScrollY !== this.scrollY) {
      this.scrollX = nextScrollX
      this.scrollY = nextScrollY
      queueMicrotask(() => {
        this.callbacks.onScrollChange?.(this.scrollX, this.scrollY)
      })
      // This eliminates a weird flicker probably caused by some other reactive change
      animationManager.nextFrame(this.animId('scrollFlickerFix'), () => {
        this.scrollX = nextScrollX
        this.scrollY = nextScrollY
        queueMicrotask(() => {
          this.callbacks.onScrollChange?.(this.scrollX, this.scrollY)
        })
      })
    }
  }

  public updateAutoScroll(windowX: number, windowY: number) {
    const rect = this.canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const viewportWidth = this.canvas.width / dpr
    const headerHeight = this.getHeaderHeight()
    const viewportHeight = (this.canvas.height / dpr) - headerHeight

    // Convert window coordinates to canvas-relative coordinates
    const canvasX = windowX - rect.left
    const canvasY = windowY - rect.top - headerHeight

    const boundaryZone = 20
    let scrollX = 0
    let scrollY = 0

    // Get content size to check scroll boundaries
    const ctx = this.canvas.getContext('2d')
    let maxScrollX = 0
    let maxScrollY = 0
    if (ctx) {
      this.setFont(ctx)
      const contentSize = this.options.wordWrap
        ? this.getContentSizeWithWrapping(ctx, this.getWrappedLines(ctx))
        : this.getContentSize(ctx)
      maxScrollX = Math.max(0, contentSize.width - viewportWidth)
      maxScrollY = Math.max(0, contentSize.height - viewportHeight)
    }

    // Check if mouse is outside canvas bounds
    const isOutsideX = canvasX < 0 || canvasX > viewportWidth
    const isOutsideY = canvasY < 0 || canvasY > viewportHeight

    // If outside canvas, continue scrolling in the direction we were going
    if (isOutsideX || isOutsideY) {
      // Determine direction based on which side of canvas we're on
      if (canvasX < 0) {
        scrollX = -1
      }
      else if (canvasX > viewportWidth) {
        scrollX = 1
      }

      if (canvasY < 0) {
        scrollY = -1
      }
      else if (canvasY > viewportHeight) {
        scrollY = 1
      }
    }
    else {
      // Inside canvas - check boundary zones
      if (canvasX < boundaryZone) {
        scrollX = -1
      }
      else if (canvasX > viewportWidth - boundaryZone) {
        scrollX = 1
      }

      if (canvasY < boundaryZone) {
        scrollY = -1
      }
      else if (canvasY > viewportHeight - boundaryZone) {
        scrollY = 1
      }
    }

    // Don't scroll if already at boundary
    if (scrollX < 0 && this.scrollX <= 0) scrollX = 0
    if (scrollX > 0 && this.scrollX >= maxScrollX) scrollX = 0
    if (scrollY < 0 && this.scrollY <= 0) scrollY = 0
    if (scrollY > 0 && this.scrollY >= maxScrollY) scrollY = 0

    if (scrollX === 0 && scrollY === 0) {
      this.stopAutoScroll()
      return
    }

    const newDirection = { x: scrollX, y: scrollY }
    const directionChanged = !this.autoScrollDirection
      || this.autoScrollDirection.x !== newDirection.x
      || this.autoScrollDirection.y !== newDirection.y

    this.autoScrollDirection = newDirection

    if (directionChanged) {
      this.startAutoScroll()
    }
  }

  public stopAutoScroll() {
    animationManager.unregister(this.animId('autoScroll'))
    this.autoScrollDirection = null
    this.autoScrollLastTime = null
  }

  private startMomentumScroll() {
    // Stop any existing momentum scroll first
    if (animationManager.isRegistered(this.animId('momentumScroll'))) {
      animationManager.unregister(this.animId('momentumScroll'))
    }

    const deceleration = 0.95
    const minVelocity = 0.5
    let velocityX = this.touchVelocityX
    let velocityY = this.touchVelocityY

    const momentum = () => {
      const dpr = window.devicePixelRatio || 1
      const viewportWidth = this.canvas.width / dpr
      const headerHeight = this.getHeaderHeight()
      const viewportHeight = (this.canvas.height / dpr) - headerHeight

      const ctx = this.canvas.getContext('2d')
      if (!ctx) {
        animationManager.unregister(this.animId('momentumScroll'))
        return
      }

      this.setFont(ctx)

      const contentSize = this.options.wordWrap
        ? this.getContentSizeWithWrapping(ctx, this.getWrappedLines(ctx))
        : this.getContentSize(ctx)

      const maxScrollX = Math.max(0, contentSize.width - viewportWidth)
      const maxScrollY = Math.max(0, contentSize.height - viewportHeight)

      // Apply velocity
      let nextScrollX = this.scrollX + velocityX
      let nextScrollY = this.scrollY + velocityY

      // Clamp to bounds
      if (nextScrollX < 0) {
        nextScrollX = 0
        velocityX = 0
      }
      else if (nextScrollX > maxScrollX) {
        nextScrollX = maxScrollX
        velocityX = 0
      }

      if (nextScrollY < 0) {
        nextScrollY = 0
        velocityY = 0
      }
      else if (nextScrollY > maxScrollY) {
        nextScrollY = maxScrollY
        velocityY = 0
      }

      // Update scroll position
      if (nextScrollX !== this.scrollX || nextScrollY !== this.scrollY) {
        this.scrollX = nextScrollX
        this.scrollY = nextScrollY
        this.callbacks.onScrollChange?.(this.scrollX, this.scrollY)
        this.publishScrollMetrics(
          ctx,
          viewportWidth,
          viewportHeight,
          contentSize.width,
          contentSize.height,
        )
        this.maybeDraw()
        this.updateFunctionSignature()
      }

      // Apply deceleration
      velocityX *= deceleration
      velocityY *= deceleration

      // Stop if velocity is too low
      if (Math.abs(velocityX) < minVelocity && Math.abs(velocityY) < minVelocity) {
        animationManager.unregister(this.animId('momentumScroll'))
        return
      }
    }

    animationManager.register(this.animId('momentumScroll'), momentum)
  }

  private stopMomentumScroll() {
    animationManager.unregister(this.animId('momentumScroll'))
    this.touchVelocityX = 0
    this.touchVelocityY = 0
  }

  private startAutoScroll() {
    if (animationManager.isRegistered(this.animId('autoScroll'))) {
      animationManager.unregister(this.animId('autoScroll'))
    }

    this.autoScrollLastTime = performance.now()

    const scroll = (currentTime: number) => {
      if (!this.autoScrollDirection) {
        animationManager.unregister(this.animId('autoScroll'))
        this.autoScrollLastTime = null
        return
      }

      const dpr = window.devicePixelRatio || 1
      const viewportWidth = this.canvas.width / dpr
      const headerHeight = this.getHeaderHeight()
      const viewportHeight = (this.canvas.height / dpr) - headerHeight

      const ctx = this.canvas.getContext('2d')
      if (!ctx) {
        animationManager.unregister(this.animId('autoScroll'))
        this.autoScrollLastTime = null
        return
      }

      this.setFont(ctx)

      let contentSize: { width: number; height: number }
      if (this.options.wordWrap) {
        const wrappedLines = this.getWrappedLines(ctx)
        contentSize = this.getContentSizeWithWrapping(ctx, wrappedLines)
      }
      else {
        contentSize = this.getContentSize(ctx)
      }

      const maxScrollX = Math.max(0, contentSize.width - viewportWidth)
      const maxScrollY = Math.max(0, contentSize.height - viewportHeight)

      // Constant speed in pixels per second (independent of frame rate)
      const scrollSpeedPxPerSecond = 400
      const deltaTime = this.autoScrollLastTime ? (currentTime - this.autoScrollLastTime) / 1000 : 0
      this.autoScrollLastTime = currentTime

      const scrollDistance = scrollSpeedPxPerSecond * deltaTime
      let nextScrollX = this.scrollX
      let nextScrollY = this.scrollY

      if (this.autoScrollDirection.x !== 0) {
        nextScrollX = Math.max(
          0,
          Math.min(maxScrollX, this.scrollX + this.autoScrollDirection.x * scrollDistance),
        )
      }

      if (this.autoScrollDirection.y !== 0) {
        nextScrollY = Math.max(
          0,
          Math.min(maxScrollY, this.scrollY + this.autoScrollDirection.y * scrollDistance),
        )
      }

      if (nextScrollX !== this.scrollX || nextScrollY !== this.scrollY) {
        this.scrollX = nextScrollX
        this.scrollY = nextScrollY
        this.callbacks.onScrollChange?.(this.scrollX, this.scrollY)
        this.maybeDraw()
        this.updateFunctionSignature()
      }

      if (!this.autoScrollDirection) {
        animationManager.unregister(this.animId('autoScroll'))
        this.autoScrollLastTime = null
      }
    }

    animationManager.register(this.animId('autoScroll'), scroll)
  }

  private startCaretBlink() {
    if (animationManager.isRegistered(this.animId('caretBlink'))) return
    this.caretBlinkStartTime = performance.now()
    this.lastCaretActivityTime = performance.now()
    this.caretOpacity = 1

    const blink = () => {
      if (!this.isActive) {
        animationManager.unregister(this.animId('caretBlink'))
        return
      }

      const now = performance.now()
      const timeSinceActivity = now - this.lastCaretActivityTime

      // Only blink after 500ms of inactivity
      if (timeSinceActivity < 500) {
        // Show fully when active
        this.caretOpacity = 1
      }
      else {
        // Smooth cosine wave for fade in/out (1 second cycle) starting fully visible
        const blinkElapsed = now - (this.lastCaretActivityTime + 500)
        const cycle = (blinkElapsed % 1000) / 1000
        this.caretOpacity = (Math.cos(cycle * Math.PI * 2) + 1) / 2
      }

      this.maybeDraw()
    }

    animationManager.register(this.animId('caretBlink'), blink)
  }

  private stopCaretBlink() {
    animationManager.unregister(this.animId('caretBlink'))
    this.caretOpacity = 1
  }

  public setAnimating(animating: boolean) {
    if (animating) {
      this.startAnimationLoop()
    }
    else {
      this.stopAnimationLoop()
    }
  }

  public setOnBeforeDraw(callback: (() => void) | undefined) {
    this.options.onBeforeDraw = callback
  }

  private startAnimationLoop() {
    if (animationManager.isRegistered(this.animId('mainAnimation'))) return

    const animate = () => {
      this.draw()
    }

    animationManager.register(this.animId('mainAnimation'), animate, -1000) // High priority
  }

  private stopAnimationLoop() {
    animationManager.unregister(this.animId('mainAnimation'))
  }

  private updateCanvasSize() {
    const rect = this.container.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1

    const displayWidth = rect.width
    const displayHeight = rect.height
    const canvasWidth = Math.round(displayWidth * dpr)
    const canvasHeight = Math.round(displayHeight * dpr)

    // Set display size to match container precisely
    this.canvas.style.width = `${displayWidth}px`
    this.canvas.style.height = `${displayHeight}px`

    // Check if size actually changed to avoid unnecessary operations
    if (this.canvas.width === canvasWidth && this.canvas.height === canvasHeight) {
      // Size didn't change, but we still need to update the transform in case DPR changed
      const ctx = this.canvas.getContext('2d')
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      }
      return
    }

    // Set actual size in memory (scaled for DPR)
    this.canvas.width = canvasWidth
    this.canvas.height = canvasHeight

    // Scale the drawing context
    const ctx = this.canvas.getContext('2d')
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
  }

  private getVisualLineFromY(
    adjustedY: number,
    wrappedLines: WrappedLine[],
    widgetLayout: {
      widgetsByVisualLine: Map<number, { above: EditorWidget[]; below: EditorWidget[] }>
      inlineWidgets: Map<number, { widget: EditorWidget; column: number }[]>
      overlayWidgets: EditorWidget[]
      yOffsets: Map<number, number>
    },
  ): number {
    for (let i = 0; i < wrappedLines.length; i++) {
      const yOffset = widgetLayout.yOffsets.get(i) || 0
      const widgets = widgetLayout.widgetsByVisualLine.get(i)
      let aboveHeight = 0
      if (widgets?.above && widgets.above.length > 0) {
        aboveHeight = this.getAboveSpacingHeight(wrappedLines, i, widgets.above)
      }

      const lineY = this.padding + i * this.lineHeight + yOffset + aboveHeight
      const lineEndY = lineY + this.lineHeight

      if (adjustedY < lineEndY) {
        return i
      }

      if (i === wrappedLines.length - 1) {
        return i
      }
    }
    return 0
  }

  private calculateWidgetLayout(
    ctx: CanvasRenderingContext2D,
    wrappedLines: WrappedLine[],
  ): {
    widgetsByVisualLine: Map<number, { above: EditorWidget[]; below: EditorWidget[] }>
    inlineWidgets: Map<number, { widget: EditorWidget; column: number }[]>
    overlayWidgets: EditorWidget[]
    yOffsets: Map<number, number>
  } {
    const widgetsByVisualLine = new Map<number, { above: EditorWidget[]; below: EditorWidget[] }>()
    const inlineWidgets = new Map<number, { widget: EditorWidget; column: number }[]>()
    const overlayWidgets: EditorWidget[] = []
    const yOffsets = new Map<number, number>()

    if (!this.options.widgets) {
      return { widgetsByVisualLine, inlineWidgets, overlayWidgets, yOffsets }
    }

    // Map logical lines to visual lines
    const logicalToVisual = new Map<number, number[]>()
    wrappedLines.forEach((line, visualIndex) => {
      const visualLines = logicalToVisual.get(line.logicalLine) || []
      visualLines.push(visualIndex)
      logicalToVisual.set(line.logicalLine, visualLines)
    })

    const hasEmptyLogicalLineAbove = (logicalLine: number): boolean =>
      logicalLine > 0 && (this.inputState.lines[logicalLine - 1] || '').trim().length === 0

    // Organize widgets by their target visual line
    for (const widget of this.options.widgets) {
      // Convert from 1-based line number to 0-based
      const logicalLine = widget.line - 1
      const visualLines = logicalToVisual.get(logicalLine) || []
      if (visualLines.length === 0) continue

      // Find the visual line that contains the widget's column (convert from 1-based to 0-based)
      const widgetColumn = widget.column - 1
      let targetVisualLine = visualLines[visualLines.length - 1]

      for (const visualIndex of visualLines) {
        const wrappedLine = wrappedLines[visualIndex]
        if (!wrappedLine) continue

        if (
          widgetColumn >= wrappedLine.startColumn
          && widgetColumn < wrappedLine.endColumn
        ) {
          targetVisualLine = visualIndex
          break
        }
        // Boundary: if column lands exactly at the end of a segment, prefer the next segment (start column),
        // so widgets at wrap boundaries appear at the start of the following visual segment.
        if (widgetColumn === wrappedLine.endColumn && wrappedLine.endColumn > wrappedLine.startColumn) {
          const nextVisualLine = visualIndex + 1
          const nextWrappedLine = wrappedLines[nextVisualLine]
          if (nextWrappedLine && nextWrappedLine.logicalLine === wrappedLine.logicalLine) {
            targetVisualLine = nextVisualLine
          }
          else {
            targetVisualLine = visualIndex
          }
          break
        }
      }

      if (widget.type === 'overlay') {
        overlayWidgets.push(widget)
      }
      else if (widget.type === 'inline') {
        const widgets = inlineWidgets.get(targetVisualLine) || []
        widgets.push({ widget, column: widgetColumn })
        inlineWidgets.set(targetVisualLine, widgets)
      }
      else {
        const widgets = widgetsByVisualLine.get(targetVisualLine) || { above: [], below: [] }
        if (widget.type === 'above') {
          widgets.above.push(widget)
        }
        else {
          widgets.below.push(widget)
        }
        widgetsByVisualLine.set(targetVisualLine, widgets)
      }
    }

    const widgetAdjustments = new Map<EditorWidget, { startVisualLine: number; anchorVisualLine: number }>()
    if (this.options.wordWrap) {
      // In wordWrap mode, only the first wrapped segment of a logical line expands into empty logical lines above.
      // Other wrapped segments rely on gapAbove to maintain consistent spacing.
      const firstEmptyVisualLineAbove = (logicalLine: number): number | null => {
        if (!hasEmptyLogicalLineAbove(logicalLine)) return null

        let emptyLinesAbove = 0
        for (let i = logicalLine - 1; i >= 0; i--) {
          const originalLine = this.inputState.lines[i] || ''
          if (originalLine.trim().length === 0) {
            emptyLinesAbove++
          }
          else {
            break
          }
        }
        const firstEmptyLogicalLine = logicalLine - emptyLinesAbove
        return logicalToVisual.get(firstEmptyLogicalLine)?.[0] ?? null
      }

      for (let visualIndex = 0; visualIndex < wrappedLines.length; visualIndex++) {
        const ws = widgetsByVisualLine.get(visualIndex)
        if (!ws?.above || ws.above.length === 0) continue

        const logicalLine = wrappedLines[visualIndex].logicalLine
        const firstVisualLine = logicalToVisual.get(logicalLine)?.[0]

        // Only apply widgetAdjustments to widgets on the first wrapped segment
        if (firstVisualLine !== visualIndex) continue

        const startVisualLine = firstEmptyVisualLineAbove(logicalLine)
        if (startVisualLine === null) continue

        for (const widget of ws.above) {
          widgetAdjustments.set(widget, { startVisualLine, anchorVisualLine: visualIndex })
        }
      }

      // If the logical line has no empty logical line above, 'above' widgets must be hidden for all
      // wrapped segments of that logical line (wrapping does not create space above the first segment).
      for (const [visualIndex, ws] of widgetsByVisualLine.entries()) {
        if (!ws.above || ws.above.length === 0) continue
        const filteredAbove = ws.above.filter(w => hasEmptyLogicalLineAbove(w.line - 1))
        if (filteredAbove.length !== ws.above.length) {
          ws.above = filteredAbove
          widgetsByVisualLine.set(visualIndex, ws)
        }
      }
    }
    if (!this.options.wordWrap) {
      // In non-wrapped mode, keep the original behavior: above widgets expand upward into consecutive
      // empty logical lines above the defining line.
      for (let visualIndex = 0; visualIndex < wrappedLines.length; visualIndex++) {
        const widgets = widgetsByVisualLine.get(visualIndex)
        if (!widgets?.above || widgets.above.length === 0) continue

        for (const widget of widgets.above) {
          const logicalLine = widget.line - 1
          if (!hasEmptyLogicalLineAbove(logicalLine)) continue

          let emptyLinesAbove = 0
          for (let i = logicalLine - 1; i >= 0; i--) {
            const originalLine = this.inputState.lines[i] || ''
            if (originalLine.trim().length === 0) {
              emptyLinesAbove++
            }
            else {
              break
            }
          }
          const firstEmptyLogicalLine = logicalLine - emptyLinesAbove
          const startVisualLine = logicalToVisual.get(firstEmptyLogicalLine)?.[0] ?? (visualIndex - 1)
          if (startVisualLine >= 0) {
            widgetAdjustments.set(widget, { startVisualLine, anchorVisualLine: visualIndex })
          }
        }
      }

      // Filter out 'above' widgets that had no empty lines above (we only want to render above widgets
      // that expand into empty lines). This prevents non-expanded 'above' widgets from affecting layout.
      for (const [visualIndex, ws] of widgetsByVisualLine.entries()) {
        if (ws.above && ws.above.length > 0) {
          const filteredAbove = ws.above.filter(w => widgetAdjustments.has(w))
          if (filteredAbove.length !== ws.above.length) {
            ws.above = filteredAbove
            widgetsByVisualLine.set(visualIndex, ws)
          }
        }
      }
    }

    // Calculate cumulative y offsets for each visual line
    // yOffset[N] represents the cumulative vertical space added by all widgets before line N
    let cumulativeOffset = 0
    for (let visualIndex = 0; visualIndex < wrappedLines.length; visualIndex++) {
      const widgets = widgetsByVisualLine.get(visualIndex)
      if (this.options.wordWrap && widgets?.above && widgets.above.length > 0) {
        const logicalLine = wrappedLines[visualIndex].logicalLine
        const firstVisualLine = logicalToVisual.get(logicalLine)?.[0] ?? visualIndex
        if (visualIndex !== firstVisualLine) {
          if (this.getAboveSpacingHeight(wrappedLines, visualIndex, widgets.above) > 0) {
            cumulativeOffset += this.lineHeight
          }
        }
      }

      // For word-wrapped lines, ensure the first logical line retains the maximum height
      // of above widgets even if all widget segments are now in below visual lines
      if (this.options.wordWrap) {
        const logicalLine = wrappedLines[visualIndex].logicalLine
        const firstVisualLine = logicalToVisual.get(logicalLine)?.[0] ?? visualIndex
        if (visualIndex === firstVisualLine) {
          const firstAboveHeight = widgets?.above && widgets.above.length > 0
            ? Math.max(...widgets.above.map(w => this.getWidgetHeight(w)))
            : 0

          // If culling:false widgets ended up on wrapped segments below, their spacing belongs to the
          // logical line (first segment), not the segment they landed on.
          let maxCullingFalseAboveHeight = 0
          for (let checkVisualIndex = visualIndex + 1; checkVisualIndex < wrappedLines.length; checkVisualIndex++) {
            if (wrappedLines[checkVisualIndex].logicalLine !== logicalLine) break
            const checkWidgets = widgetsByVisualLine.get(checkVisualIndex)
            if (checkWidgets?.above && checkWidgets.above.length > 0) {
              for (const w of checkWidgets.above) {
                if (w.culling === false) {
                  maxCullingFalseAboveHeight = Math.max(maxCullingFalseAboveHeight, this.getWidgetHeight(w))
                }
              }
            }
          }
          const extra = Math.max(0, maxCullingFalseAboveHeight - firstAboveHeight)
          if (extra > 0) {
            cumulativeOffset += extra
          }
        }
      }

      // Set offset for this line (before adding this line's widgets)
      yOffsets.set(visualIndex, cumulativeOffset)

      if (widgets) {
        // Add max height of 'above' widgets for this line (they are in the same row)
        // Use base height (not adjusted) so line spacing isn't affected by upward expansion
        if (widgets.above.length > 0) {
          const maxAboveHeight = this.getAboveSpacingHeight(wrappedLines, visualIndex, widgets.above)
          if (maxAboveHeight > 0) {
            cumulativeOffset += maxAboveHeight
          }
        }
        // Add max height of 'below' widgets for this line (they are in the same row)
        if (widgets.below.length > 0) {
          const maxBelowHeight = Math.max(...widgets.below.map(w => this.getWidgetHeight(w)))
          cumulativeOffset += maxBelowHeight
        }
      }

      // Add height for inline widgets (if they exceed line height)
      const inline = inlineWidgets.get(visualIndex)
      if (inline && inline.length > 0) {
        const maxHeight = Math.max(...inline.map(w => this.getWidgetHeight(w.widget)))
        if (maxHeight > this.lineHeight) {
          cumulativeOffset += maxHeight - this.lineHeight
        }
      }
    }

    // Also store the total extra offset after the final line so content height can include
    // widgets on the last line (yOffsets[N] is "offset before line N").
    yOffsets.set(wrappedLines.length, cumulativeOffset)

    // Store widget adjustments for use in drawing
    this.widgetAdjustments = widgetAdjustments

    return { widgetsByVisualLine, inlineWidgets, overlayWidgets, yOffsets }
  }

  private getWrappedLineOffscreenKey(
    wrappedLine: WrappedLine,
    segmentTokens: Token[] | null,
    inlineWidgets: { widget: EditorWidget; column: number }[],
    textPadding: number,
    theme: Theme,
  ): number {
    let h = 2166136261
    h = hashNumber(h, this.offscreenLineRenderVersion)
    h = hashNumber(h, wrappedLine.logicalLine)
    h = hashNumber(h, wrappedLine.startColumn)
    h = hashNumber(h, wrappedLine.endColumn)
    h = hashNumber(h, textPadding)
    h = hashString(h, theme.font)

    if (segmentTokens) {
      h = hashNumber(h, segmentTokens.length)
      for (const t of segmentTokens) {
        h = hashString(h, t.type)
        h = hashString(h, t.content)
      }
    }
    else {
      h = hashString(h, wrappedLine.text)
    }

    if (inlineWidgets.length > 0) {
      h = hashNumber(h, inlineWidgets.length)
      for (const { widget, column } of inlineWidgets) {
        h = hashNumber(h, column)
        h = hashNumber(h, widget.length)
      }
    }

    return h >>> 0
  }

  private drawWrappedLineText(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    wrappedLine: WrappedLine,
    y: number,
    theme: Theme,
    textPadding: number,
    segmentTokens: Token[] | null,
    inlineWidgets: { widget: EditorWidget; column: number }[],
  ): number {
    let currentX = textPadding

    if (segmentTokens) {
      const columnInWrappedLine = (col: number) => col - wrappedLine.startColumn
      let tokenIndex = 0
      let tokenOffset = 0

      for (const { widget, column } of inlineWidgets) {
        const targetColumn = columnInWrappedLine(column)
        let accumulatedLength = 0

        while (
          tokenIndex < segmentTokens.length
          && accumulatedLength + segmentTokens[tokenIndex].length - tokenOffset <= targetColumn
        ) {
          const token = segmentTokens[tokenIndex]
          const remainingContent = token.content.substring(tokenOffset)
          currentX = drawTokensWithCustomLigatures(
            ctx,
            [{ ...token, content: remainingContent, length: remainingContent.length }],
            currentX,
            y,
            theme,
            { lineHeight: this.lineHeight, cache: this.measurementCache },
          )
          accumulatedLength += token.length - tokenOffset
          tokenIndex++
          tokenOffset = 0
        }

        if (tokenIndex < segmentTokens.length && accumulatedLength < targetColumn) {
          const token = segmentTokens[tokenIndex]
          const charsNeeded = targetColumn - accumulatedLength
          const partialContent = token.content.substring(tokenOffset, tokenOffset + charsNeeded)
          currentX = drawTokensWithCustomLigatures(
            ctx,
            [{ ...token, content: partialContent, length: partialContent.length }],
            currentX,
            y,
            theme,
            { lineHeight: this.lineHeight, cache: this.measurementCache },
          )
          tokenOffset += charsNeeded
          accumulatedLength += charsNeeded
        }

        currentX += ctx.measureText('X'.repeat(widget.length)).width
      }

      while (tokenIndex < segmentTokens.length) {
        const token = segmentTokens[tokenIndex]
        const remainingContent = token.content.substring(tokenOffset)
        currentX = drawTokensWithCustomLigatures(
          ctx,
          [{ ...token, content: remainingContent, length: remainingContent.length }],
          currentX,
          y,
          theme,
          { lineHeight: this.lineHeight, cache: this.measurementCache },
        )
        tokenIndex++
        tokenOffset = 0
      }

      return currentX
    }

    let lastColumn = 0
    for (const { widget, column } of inlineWidgets) {
      const columnInWrappedLine = column - wrappedLine.startColumn

      if (columnInWrappedLine > lastColumn) {
        const textSegment = wrappedLine.text.substring(lastColumn, columnInWrappedLine)
        currentX = drawTokensWithCustomLigatures(
          ctx,
          [{ type: 'plain', content: textSegment, length: textSegment.length }],
          currentX,
          y,
          theme,
          { lineHeight: this.lineHeight, cache: this.measurementCache },
        )
      }

      currentX += ctx.measureText('X'.repeat(widget.length)).width
      lastColumn = columnInWrappedLine
    }

    if (lastColumn < wrappedLine.text.length) {
      const textSegment = wrappedLine.text.substring(lastColumn)
      currentX = drawTokensWithCustomLigatures(
        ctx,
        [{ type: 'plain', content: textSegment, length: textSegment.length }],
        currentX,
        y,
        theme,
        { lineHeight: this.lineHeight, cache: this.measurementCache },
      )
    }

    return currentX
  }

  private draw() {
    this.options.onBeforeDraw?.()

    const ctx = this.canvas.getContext('2d')
    if (!ctx) return

    // Use canvas dimensions instead of getBoundingClientRect to avoid layout reflow
    const width = this.canvas.width / (window.devicePixelRatio || 1)
    const height = this.canvas.height / (window.devicePixelRatio || 1)
    const headerHeight = this.getHeaderHeight()
    const contentHeight = height - headerHeight

    // Configure text rendering
    this.setFont(ctx)
    ctx.textBaseline = 'top'

    // Get wrapped lines - use pre-calculated from updateState if available
    const wrappedLines = this.pendingWrappedLines ?? this.getWrappedLines(ctx)
    this.pendingWrappedLines = null

    // Calculate widget layout once for all operations (content size and drawing)
    const widgetLayout = this.calculateWidgetLayout(ctx, wrappedLines)

    // Cache syntax highlighting to avoid re-processing the same code
    const code = this.inputState.lines.join('\n')
    let highlightedCode: HighlightedLine[]
    const theme = this.options.theme || defaultTheme
    const tokenizer = this.options.tokenizer || defaultTokenizer

    if (this.highlightCache && this.highlightCache.code === code) {
      highlightedCode = this.highlightCache.result
    }
    else {
      highlightedCode = highlightCode(code, tokenizer, theme)
      this.highlightCache = { code, result: highlightedCode }
    }

    // Clear canvas
    if (theme.background === 'transparent') {
      ctx.clearRect(0, 0, width, height)
    }
    else {
      ctx.fillStyle = theme.background
      ctx.fillRect(0, 0, width, height)
    }

    // Publish metrics for consumers (use content height for viewport)
    const content = this.getContentSizeWithWrappingUsingLayout(ctx, wrappedLines, widgetLayout)
    this.publishScrollMetrics(ctx, width, contentHeight, content.width, content.height)

    // Clamp scroll position to content bounds before drawing (use content height)
    const maxScrollX = Math.max(0, content.width - width)
    const maxScrollY = Math.max(0, content.height - contentHeight)
    const clampedScrollX = Math.min(Math.max(this.scrollX, 0), maxScrollX)
    const clampedScrollY = Math.min(Math.max(this.scrollY, 0), maxScrollY)

    if (clampedScrollX !== this.scrollX || clampedScrollY !== this.scrollY) {
      this.scrollX = clampedScrollX
      this.scrollY = clampedScrollY
      this.callbacks.onScrollChange?.(this.scrollX, this.scrollY)
      // Re-publish metrics with updated scroll position
      this.publishScrollMetrics(ctx, width, contentHeight, content.width, content.height)
    }
    this.widgetPositions.clear()

    // Apply scroll offset and header offset for content rendering
    ctx.save()
    ctx.translate(-this.scrollX, headerHeight - this.scrollY)

    // Draw selection background if exists
    if (this.inputState.selection) {
      ctx.fillStyle = theme.selection
      this.drawSelectionWithWrapping(
        ctx,
        this.inputState,
        wrappedLines,
        this.scrollY,
        contentHeight,
        widgetLayout.yOffsets,
        widgetLayout.widgetsByVisualLine,
        widgetLayout.inlineWidgets,
      )
    }

    // Draw wrapped lines
    const textPadding = this.getTextPadding()

    // Calculate visible line range for viewport culling
    const visibleStartY = this.scrollY - headerHeight
    const visibleEndY = this.scrollY + contentHeight

    const firstVisualLineByLogicalLine = new Map<number, number>()
    for (let visualIndex = 0; visualIndex < wrappedLines.length; visualIndex++) {
      const logicalLine = wrappedLines[visualIndex]?.logicalLine
      if (logicalLine === undefined) continue
      if (!firstVisualLineByLogicalLine.has(logicalLine)) {
        firstVisualLineByLogicalLine.set(logicalLine, visualIndex)
      }
    }

    const hasAboveWidgetsByLogicalLine = new Set<number>()
    for (const [visualIndex, ws] of widgetLayout.widgetsByVisualLine.entries()) {
      if (!ws.above || ws.above.length === 0) continue
      const logicalLine = wrappedLines[visualIndex]?.logicalLine
      if (logicalLine === undefined) continue
      hasAboveWidgetsByLogicalLine.add(logicalLine)
    }

    const viewYByLogicalLine = new Map<number, number>()
    for (const [logicalLine, firstVisualLine] of firstVisualLineByLogicalLine.entries()) {
      let startVisualLine = firstVisualLine
      if (hasAboveWidgetsByLogicalLine.has(logicalLine)) {
        let l = logicalLine
        while (l > 0 && (this.inputState.lines[l - 1] || '').trim().length === 0) {
          l--
        }
        startVisualLine = firstVisualLineByLogicalLine.get(l) ?? startVisualLine
      }
      const yOffset = widgetLayout.yOffsets.get(startVisualLine) || 0
      viewYByLogicalLine.set(logicalLine, this.padding + startVisualLine * this.lineHeight + yOffset - 1.5)
    }

    // Draw overlay widgets behind text (no pointer events, truly behind)
    for (const widget of widgetLayout.overlayWidgets) {
      // Find the visual line for this widget (convert from 1-based to 0-based)
      let visualPos = this.logicalToVisualPosition(widget.line - 1, widget.column - 1, wrappedLines)
      let wrappedLine = wrappedLines[visualPos.visualLine]

      // If the widget's column is at the end of a wrapped line segment, wrap to the next visible line
      if (wrappedLine && visualPos.visualColumn === wrappedLine.text.length) {
        // Check if there's a next wrapped line segment for the same logical line
        const nextVisualLine = visualPos.visualLine + 1
        if (nextVisualLine < wrappedLines.length) {
          const nextWrappedLine = wrappedLines[nextVisualLine]
          if (nextWrappedLine && nextWrappedLine.logicalLine === wrappedLine.logicalLine) {
            // Use the next visual line with column 0
            visualPos = { visualLine: nextVisualLine, visualColumn: 0 }
            wrappedLine = nextWrappedLine
          }
        }
      }

      if (wrappedLine) {
        const yOffset = widgetLayout.yOffsets.get(visualPos.visualLine) || 0
        // Add max height of 'above' widgets on this line (they are in the same row)
        let aboveHeight = 0
        const widgets = widgetLayout.widgetsByVisualLine.get(visualPos.visualLine)
        if (widgets?.above && widgets.above.length > 0) {
          aboveHeight = this.getAboveSpacingHeight(wrappedLines, visualPos.visualLine, widgets.above)
        }
        const widgetY = this.padding + visualPos.visualLine * this.lineHeight + yOffset + aboveHeight
        const textBeforeWidget = wrappedLine.text.substring(0, visualPos.visualColumn)
        let widgetX = textPadding + ctx.measureText(textBeforeWidget).width

        // Account for inline widgets before the overlay widget
        const inlineWidgetsForLine = widgetLayout.inlineWidgets.get(visualPos.visualLine) || []
        for (const { widget: inlineWidget, column } of inlineWidgetsForLine) {
          const columnInWrappedLine = column - wrappedLine.startColumn
          if (columnInWrappedLine <= visualPos.visualColumn) {
            widgetX += ctx.measureText('X'.repeat(inlineWidget.length)).width
          }
        }

        const widgetWidth = ctx.measureText('X'.repeat(widget.length)).width

        // Don't add overlay widgets to widgetPositions (no pointer events)

        const widgetHeight = this.getWidgetHeight(widget)
        if (widgetY + widgetHeight < visibleStartY) continue

        // In wordWrap mode, keep rendering widgets until their logical line scrolls out below.
        const viewY = viewYByLogicalLine.get(widget.line - 1) ?? widgetY
        const isBelowViewport = this.options.wordWrap
          ? viewY > visibleEndY
          : widgetY > visibleEndY

        if (isBelowViewport) continue

        // View area (content-space) excluding gutter/padding and scrollbar width
        const showVBar = content.height > height + 1
        const viewX = this.scrollX + textPadding
        const viewWidth = Math.max(0, width - textPadding - this.padding - (showVBar ? this.scrollbarWidth : 0))

        // Skip overlay widgets that are completely outside the X axis viewport
        if (widget.culling !== false && (widgetX + widgetWidth < viewX || widgetX > viewX + viewWidth)) continue

        widget.render(ctx, widgetX, widgetY - 2, widgetWidth, widgetHeight + 1, viewX, viewWidth, viewY)
      }
    }

    // Build a Set of error line numbers for faster lookups
    const errorLineSet = new Set(this.errors.map(e => e.line))

    // Cache brace matching result once for all lines
    const matchingBraces = this.isActive
      ? findMatchingBrace(highlightedCode, this.inputState.caret.line, this.inputState.caret.column)
      : null

    // Pass 1: Calculate positions and render all widgets
    const showVBar = content.height > height + 1
    const viewX = this.scrollX + textPadding
    const viewWidth = Math.max(0, width - textPadding - this.padding / 2 - (showVBar ? this.scrollbarWidth : 0))

    const widgetRenderInfo = new Map<EditorWidget,
      { x: number; y: number; width: number; height: number; viewY: number }>()

    wrappedLines.forEach((wrappedLine: WrappedLine, visualIndex: number) => {
      const yOffset = widgetLayout.yOffsets.get(visualIndex) || 0
      let y = this.padding + visualIndex * this.lineHeight + yOffset - 1.5

      const widgets = widgetLayout.widgetsByVisualLine.get(visualIndex)

      // Handle 'above' widgets
      if (widgets?.above && widgets.above.length > 0) {
        const lineViewY = viewYByLogicalLine.get(wrappedLine.logicalLine) ?? y
        const inlineWidgetsForAbove = widgetLayout.inlineWidgets.get(visualIndex) || []
        // In wordWrap mode, non-first wrapped segments need extra lineHeight gap for consistent spacing
        let gapAbove = 0
        if (this.options.wordWrap && visualIndex > 0) {
          const prevWrappedLine = wrappedLines[visualIndex - 1]
          // Check if this is a continuation of the same logical line (not the first segment)
          if (prevWrappedLine && prevWrappedLine.logicalLine === wrappedLine.logicalLine) {
            gapAbove = this.lineHeight
          }
        }
        const maxAboveHeight = this.getAboveSpacingHeight(wrappedLines, visualIndex, widgets.above)

        // Create a map of widget widths calculated from column order.
        // Rendering order is handled separately (arrival order), but geometry must be column-based
        // so "reduce width if there is a widget after" remains correct even if widgets arrive out of order.
        const widgetWidths = new Map<EditorWidget, number>()
        const widgetsForWidth = [...widgets.above].sort((a, b) => (a.column - 1) - (b.column - 1))

        for (let i = 0; i < widgetsForWidth.length; i++) {
          const widget = widgetsForWidth[i]
          const widgetColumn = widget.column - 1
          const columnInWrappedLine = widgetColumn - wrappedLine.startColumn
          const textBeforeWidget = wrappedLine.text.substring(0, Math.max(0, columnInWrappedLine))
          let widgetX = textPadding + ctx.measureText(textBeforeWidget).width
          for (const { widget: inlineWidget, column } of inlineWidgetsForAbove) {
            const colInWrapped = column - wrappedLine.startColumn
            if (colInWrapped <= columnInWrappedLine) {
              widgetX += ctx.measureText('X'.repeat(inlineWidget.length)).width
            }
          }

          // Calculate natural width from widget length
          const naturalWidgetWidth = ctx.measureText('X'.repeat(widget.length)).width

          // Calculate width to span to end of wrapped line segment
          const textAfterWidget = wrappedLine.text.substring(columnInWrappedLine)
          let remainingLineWidth = ctx.measureText(textAfterWidget).width
          // Account for inline widgets that come after this above widget
          for (const { widget: inlineWidget, column } of inlineWidgetsForAbove) {
            const colInWrapped = column - wrappedLine.startColumn
            if (colInWrapped > columnInWrappedLine) {
              remainingLineWidth += ctx.measureText('X'.repeat(inlineWidget.length)).width
            }
          }
          const maxWidgetWidth = remainingLineWidth

          // If there's a next widget, reduce width only if it would overlap
          let widgetWidth = Math.min(naturalWidgetWidth, maxWidgetWidth)
          if (i < widgetsForWidth.length - 1) {
            const nextWidget = widgetsForWidth[i + 1]
            const nextWidgetColumn = nextWidget.column - 1
            const nextColumnInWrappedLine = nextWidgetColumn - wrappedLine.startColumn
            const textBeforeNextWidget = wrappedLine.text.substring(0, Math.max(0, nextColumnInWrappedLine))
            let nextWidgetX = textPadding + ctx.measureText(textBeforeNextWidget).width
            for (const { widget: inlineWidget, column } of inlineWidgetsForAbove) {
              const colInWrapped = column - wrappedLine.startColumn
              if (colInWrapped <= nextColumnInWrappedLine) {
                nextWidgetX += ctx.measureText('X'.repeat(inlineWidget.length)).width
              }
            }
            const margin = ctx.measureText('X').width // One character width margin between widgets

            // Only reduce width if the next widget would overlap with the natural width
            if (widgetX + naturalWidgetWidth + margin > nextWidgetX) {
              widgetWidth = Math.max(0, nextWidgetX - widgetX - margin)
            }
          }

          widgetWidths.set(widget, widgetWidth)
        }

        // Draw widgets in their original order (only those on this segment)
        for (const widget of widgets.above) {
          const widgetColumn = widget.column - 1
          const adjustment = this.widgetAdjustments.get(widget)
          const columnInWrappedLine = widgetColumn - wrappedLine.startColumn
          const textBeforeWidget = wrappedLine.text.substring(0, Math.max(0, columnInWrappedLine))
          let widgetX = textPadding + ctx.measureText(textBeforeWidget).width
          for (const { widget: inlineWidget, column } of inlineWidgetsForAbove) {
            const colInWrapped = column - wrappedLine.startColumn
            if (colInWrapped <= columnInWrappedLine) {
              widgetX += ctx.measureText('X'.repeat(inlineWidget.length)).width
            }
          }
          const widgetWidth = widgetWidths.get(widget) ?? ctx.measureText('X'.repeat(widget.length)).width

          const baseHeight = this.getWidgetHeight(widget)
          let widgetY = y
          let widgetHeight = baseHeight
          if (adjustment) {
            const startOffset = widgetLayout.yOffsets.get(adjustment.startVisualLine) || 0
            widgetY = this.padding + adjustment.startVisualLine * this.lineHeight + startOffset - 1.5

            const anchorOffset = widgetLayout.yOffsets.get(adjustment.anchorVisualLine) || 0
            const anchorY = this.padding + adjustment.anchorVisualLine * this.lineHeight + anchorOffset - 1.5
            widgetHeight = baseHeight + (anchorY - widgetY)
          }
          else if (gapAbove > 0) {
            widgetY = y - gapAbove
            widgetHeight = baseHeight + gapAbove
          }
          this.widgetPositions.set(widget, {
            x: widgetX,
            y: widgetY,
            width: widgetWidth,
            height: widgetHeight,
          })
          widgetRenderInfo.set(widget, { x: widgetX, y: widgetY - 2.5, width: widgetWidth, height: widgetHeight,
            viewY: lineViewY - 2.5 })
        }
        y += maxAboveHeight
      }

      // Handle inline widgets
      const inlineWidgetsForLine = widgetLayout.inlineWidgets.get(visualIndex) || []
      if (inlineWidgetsForLine.length > 0) {
        const lineViewY = viewYByLogicalLine.get(wrappedLine.logicalLine) ?? y
        const logicalHighlighted = highlightedCode[wrappedLine.logicalLine]
        if (logicalHighlighted) {
          const segmentTokens = extractTokensForSegment(
            logicalHighlighted.tokens,
            wrappedLine.startColumn,
            wrappedLine.endColumn,
          )
          const columnInWrappedLine = (col: number) => col - wrappedLine.startColumn
          const sortedInlineWidgets = [...inlineWidgetsForLine].sort((a, b) => a.column - b.column)

          let currentX = textPadding
          let tokenIndex = 0
          let tokenOffset = 0

          for (const { widget, column } of sortedInlineWidgets) {
            const targetColumn = columnInWrappedLine(column)
            let accumulatedLength = 0

            while (tokenIndex < segmentTokens.length
              && accumulatedLength + segmentTokens[tokenIndex].length - tokenOffset <= targetColumn)
            {
              const token = segmentTokens[tokenIndex]
              currentX += ctx.measureText(token.content.substring(tokenOffset)).width
              accumulatedLength += token.length - tokenOffset
              tokenIndex++
              tokenOffset = 0
            }

            if (tokenIndex < segmentTokens.length && accumulatedLength < targetColumn) {
              const token = segmentTokens[tokenIndex]
              const charsNeeded = targetColumn - accumulatedLength
              const partialContent = token.content.substring(tokenOffset, tokenOffset + charsNeeded)
              currentX += ctx.measureText(partialContent).width
              tokenOffset += charsNeeded
            }

            const widgetX = currentX
            const widgetY = y - 0.5
            const widgetWidth = ctx.measureText('X'.repeat(widget.length)).width
            const widgetHeight = this.getWidgetHeight(widget)
            this.widgetPositions.set(widget, {
              x: widgetX,
              y: widgetY,
              width: widgetWidth,
              height: widgetHeight,
            })
            widgetRenderInfo.set(widget, { x: widgetX, y: widgetY, width: widgetWidth, height: widgetHeight,
              viewY: lineViewY })
            currentX += widgetWidth
          }
        }
        else {
          let currentX = textPadding
          const sortedInlineWidgets = [...inlineWidgetsForLine].sort((a, b) => a.column - b.column)

          for (const { widget, column } of sortedInlineWidgets) {
            const columnInWrappedLine = column - wrappedLine.startColumn
            if (columnInWrappedLine > 0) {
              const textSegment = wrappedLine.text.substring(0, columnInWrappedLine)
              currentX += ctx.measureText(textSegment).width
            }

            const widgetX = currentX
            const widgetY = y - 0.5
            const widgetWidth = ctx.measureText('X'.repeat(widget.length)).width
            const widgetHeight = this.getWidgetHeight(widget)
            this.widgetPositions.set(widget, {
              x: widgetX,
              y: widgetY,
              width: widgetWidth,
              height: widgetHeight,
            })
            widgetRenderInfo.set(widget, { x: widgetX, y: widgetY, width: widgetWidth, height: widgetHeight,
              viewY: lineViewY })
            currentX += widgetWidth
          }
        }
      }

      // Handle 'below' widgets
      if (widgets?.below && widgets.below.length > 0) {
        const lineViewY = viewYByLogicalLine.get(wrappedLine.logicalLine) ?? y
        const widgetY = y + this.lineHeight
        for (const widget of widgets.below) {
          const widgetColumn = widget.column - 1
          const columnInWrappedLine = widgetColumn - wrappedLine.startColumn
          const textBeforeWidget = wrappedLine.text.substring(0, Math.max(0, columnInWrappedLine))
          const widgetX = textPadding + ctx.measureText(textBeforeWidget).width
          const widgetWidth = ctx.measureText('X'.repeat(widget.length)).width
          const widgetHeight = this.getWidgetHeight(widget)
          this.widgetPositions.set(widget, {
            x: widgetX,
            y: widgetY,
            width: widgetWidth,
            height: widgetHeight,
          })
          widgetRenderInfo.set(widget, { x: widgetX, y: widgetY, width: widgetWidth, height: widgetHeight,
            viewY: lineViewY })
        }
      }
    })

    // Render widgets in arrival order, regardless of which wrapped segment they fall in.
    if (this.options.widgets) {
      for (const widget of this.options.widgets) {
        if (widget.type === 'overlay') continue
        const info = widgetRenderInfo.get(widget)
        if (!info) continue
        if (info.y + info.height < visibleStartY) continue

        const isBelowViewport = this.options.wordWrap
          ? info.viewY > visibleEndY
          : info.y > visibleEndY

        if (isBelowViewport) continue

        // Skip widgets that are completely outside the X axis viewport
        if (widget.culling !== false && (info.x + info.width < viewX || info.x > viewX + viewWidth)) continue

        widget.render(ctx, info.x, info.y, info.width, info.height, viewX, viewWidth, info.viewY)
      }
    }

    // Pass 2: Draw all lines with text and syntax highlighting
    this.offscreenLineCache.setDpr(window.devicePixelRatio || 1)
    this.offscreenLineCache.setCapacity(wrappedLines.length + 200)

    wrappedLines.forEach((wrappedLine: WrappedLine, visualIndex: number) => {
      const yOffset = widgetLayout.yOffsets.get(visualIndex) || 0
      let y = this.padding + visualIndex * this.lineHeight + yOffset - 1.5

      const widgets = widgetLayout.widgetsByVisualLine.get(visualIndex)
      if (widgets?.above && widgets.above.length > 0) {
        y += this.getAboveSpacingHeight(wrappedLines, visualIndex, widgets.above)
      }

      if (y + this.lineHeight < visibleStartY || y > visibleEndY) {
        return
      }

      const inlineWidgetsForLine = widgetLayout.inlineWidgets.get(visualIndex) || []
      const logicalHighlighted = highlightedCode[wrappedLine.logicalLine]

      const sortedInlineWidgets = inlineWidgetsForLine.length <= 1
        ? inlineWidgetsForLine
        : [...inlineWidgetsForLine].sort((a, b) => a.column - b.column)

      const segmentTokens = logicalHighlighted
        ? extractTokensForSegment(
          logicalHighlighted.tokens,
          wrappedLine.startColumn,
          wrappedLine.endColumn,
        )
        : null

      const key = this.getWrappedLineOffscreenKey(
        wrappedLine,
        segmentTokens,
        sortedInlineWidgets,
        textPadding,
        theme,
      )

      const id = `${wrappedLine.logicalLine}:${wrappedLine.startColumn}:${wrappedLine.endColumn}`
      const entry = this.offscreenLineCache.get(id, wrappedLine.logicalLine, width, this.lineHeight + 12)

      if (entry) {
        const needsRender = entry.key !== key
        if (needsRender) {
          entry.key = key
          entry.cssWidth = Math.max(entry.cssWidth, Math.ceil(width))

          const render = (): number => {
            this.offscreenLineCache.ensureCanvasSize(entry)
            this.setFont(entry.ctx)
            entry.ctx.clearRect(0, 0, entry.cssWidth, entry.cssHeight)
            return this.drawWrappedLineText(
              entry.ctx,
              wrappedLine,
              6,
              theme,
              textPadding,
              segmentTokens,
              sortedInlineWidgets,
            )
          }

          const usedX = render()
          const prevWidth = entry.cssWidth
          this.offscreenLineCache.fitWidthInBlocks(entry, width, usedX + 2)
          if (entry.cssWidth !== prevWidth) {
            render()
          }
        }

        ctx.drawImage(
          entry.canvas,
          0,
          0,
          entry.canvas.width,
          entry.canvas.height,
          0,
          y - 6,
          entry.cssWidth,
          entry.cssHeight,
        )
      }
      else {
        this.drawWrappedLineText(
          ctx,
          wrappedLine,
          y,
          theme,
          textPadding,
          segmentTokens,
          sortedInlineWidgets,
        )
      }

      if (matchingBraces && logicalHighlighted) {
        this.drawBraceMatchingForWrappedLine(
          ctx,
          highlightedCode,
          wrappedLine,
          visualIndex,
          y,
          theme,
          matchingBraces,
        )
      }
    })

    // Draw error squiggles
    if (this.errors.length > 0) {
      this.drawErrorSquiggles(
        ctx,
        wrappedLines,
        theme,
        this.scrollY,
        contentHeight,
        widgetLayout.yOffsets,
        widgetLayout.widgetsByVisualLine,
        widgetLayout.inlineWidgets,
      )
    }

    // Draw caret only if active
    if (this.isActive) {
      const visualPos = this.logicalToVisualPosition(
        this.inputState.caret.line,
        this.inputState.caret.column,
        wrappedLines,
      )
      const wrappedLine = wrappedLines[visualPos.visualLine]
      if (wrappedLine) {
        const yOffset = widgetLayout.yOffsets.get(visualPos.visualLine) || 0
        // Add max height of 'above' widgets on this line (they are in the same row)
        let aboveHeight = 0
        const widgets = widgetLayout.widgetsByVisualLine.get(visualPos.visualLine)
        if (widgets?.above && widgets.above.length > 0) {
          aboveHeight = this.getAboveSpacingHeight(wrappedLines, visualPos.visualLine, widgets.above)
        }
        const caretY = this.padding + visualPos.visualLine * this.lineHeight + yOffset + aboveHeight - 2
        const caretText = wrappedLine.text.substring(0, visualPos.visualColumn)
        let caretX = textPadding + ctx.measureText(caretText).width

        // Account for inline widgets before the caret
        const inlineWidgetsForLine = widgetLayout.inlineWidgets.get(visualPos.visualLine) || []
        for (const { widget, column } of inlineWidgetsForLine) {
          const columnInWrappedLine = column - wrappedLine.startColumn
          if (columnInWrappedLine <= visualPos.visualColumn) {
            caretX += ctx.measureText('X'.repeat(widget.length)).width
          }
        }

        // Apply opacity for smooth blinking
        ctx.save()
        ctx.globalAlpha = this.caretOpacity
        ctx.fillStyle = theme.caret
        ctx.fillRect(caretX - .75, caretY - 1.5, 1.5, this.lineHeight - 1)
        ctx.restore()

        // Record caret content-space coordinates precisely for popup positioning
        let lastCaretContentX = textPadding + ctx.measureText(caretText).width

        // Account for inline widgets before the caret
        for (const { widget, column } of inlineWidgetsForLine) {
          const columnInWrappedLine = column - wrappedLine.startColumn
          if (columnInWrappedLine <= visualPos.visualColumn) {
            lastCaretContentX += ctx.measureText('X'.repeat(widget.length)).width
          }
        }

        this.lastCaretContentX = lastCaretContentX
        this.lastCaretContentY = this.padding + visualPos.visualLine * this.lineHeight + yOffset + aboveHeight
      }
    }

    ctx.restore()

    // Draw gutter on top of text (after restore so it's not affected by scroll transform and covers text)
    if (this.options.gutter) {
      const gutterWidth = this.getGutterWidth()
      const errorLineSet = new Set(this.errors.map(e => e.line))
      const headerHeight = this.getHeaderHeight()
      const contentHeight = height - headerHeight

      // Draw gutter background (covers header and content area)
      ctx.fillStyle = theme.gutterBackground
      ctx.fillRect(0, 0, this.padding + gutterWidth, height)

      // Draw gutter separator line
      ctx.strokeStyle = theme.gutterBorder
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(this.padding + gutterWidth - 1, 0)
      ctx.lineTo(this.padding + gutterWidth - 1, height)
      ctx.stroke()

      // Draw line numbers (convert from content space to screen space)
      wrappedLines.forEach((wrappedLine: WrappedLine, visualIndex: number) => {
        const yOffset = widgetLayout.yOffsets.get(visualIndex) || 0
        const yContent = this.padding + visualIndex * this.lineHeight + yOffset - 1.5
        // Account for header: content is rendered starting at headerHeight on screen
        let yScreen = yContent - this.scrollY + headerHeight

        // Check if this line has 'above' widgets - if so, position line number at bottom (next to code)
        const widgets = widgetLayout.widgetsByVisualLine.get(visualIndex)
        let aboveHeight = 0
        if (widgets?.above && widgets.above.length > 0) {
          aboveHeight = this.getAboveSpacingHeight(wrappedLines, visualIndex, widgets.above)
          // Adjust yScreen to position line number at the bottom (next to the code)
          yScreen += aboveHeight
        }

        // Skip lines outside the visible content viewport (accounting for header)
        if (yScreen + this.lineHeight < 0 || yScreen > height) {
          return
        }

        const lineNumber = wrappedLine.logicalLine + 1
        const isFirstVisualLine = visualIndex === 0
          || (visualIndex > 0 && wrappedLines[visualIndex - 1].logicalLine !== wrappedLine.logicalLine)

        if (isFirstVisualLine) {
          const hasErrorOnLine = errorLineSet.has(wrappedLine.logicalLine)

          if (hasErrorOnLine) {
            ctx.fillStyle = theme.errorGutterColor
            ctx.fillRect(0, yScreen - 3, this.padding + gutterWidth - 1, this.lineHeight - 2)
          }

          ctx.fillStyle = hasErrorOnLine ? '#ffffff' : theme.gutterText
          ctx.textAlign = 'right'
          ctx.fillText(lineNumber.toString(), this.padding + gutterWidth - 8, yScreen)
          ctx.textAlign = 'left'
        }
      })
    }

    // Draw scrollbars (after restore so they're not affected by scroll transform)
    this.drawScrollbars(ctx, width, height, theme)

    // Draw header if present
    if (this.options.header) {
      const showVBar = content.height > contentHeight + 1
      const viewX = textPadding + 1
      const viewWidth = Math.max(0, width - textPadding - this.padding / 2 - (showVBar ? this.scrollbarWidth : 0))
      this.options.header.render(ctx, 0, 0, width, headerHeight, viewX, viewWidth)
    }
  }

  private maybeDraw() {
    // Only draw if not animating (animation loop handles drawing)
    if (animationManager.isRegistered(this.animId('mainAnimation'))) {
      return
    }

    // Batch multiple draw calls in the same frame using AnimationManager
    if (!animationManager.isRegistered(this.animId('drawBatch'))) {
      animationManager.nextFrame(this.animId('drawBatch'), () => {
        this.draw()
      })
    }
  }

  private drawScrollbars(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    theme: Theme,
  ) {
    const headerHeight = this.getHeaderHeight()
    const contentHeight = height - headerHeight
    const { viewportWidth, viewportHeight, contentWidth, contentHeight: contentTotalHeight } = this.scrollMetrics

    const showVBar = contentTotalHeight > viewportHeight + 1
    const showHBar = contentWidth > viewportWidth + 1

    // Vertical scrollbar (positioned below header)
    if (showVBar) {
      const trackHeight = contentHeight
      const thumbHeight = Math.max(20, (viewportHeight / contentTotalHeight) * trackHeight)
      const maxTravel = trackHeight - thumbHeight
      const thumbTop = headerHeight + (this.scrollY / Math.max(1, contentTotalHeight - viewportHeight)) * maxTravel

      // Draw track (optional, currently transparent)
      if (theme.scrollbarTrack !== 'transparent') {
        ctx.fillStyle = theme.scrollbarTrack
        ctx.fillRect(width - this.scrollbarWidth, headerHeight, this.scrollbarWidth, contentHeight)
      }

      // Draw thumb
      ctx.fillStyle = this.hoveredScrollbar === 'vertical' ? theme.scrollbarThumbHover : theme.scrollbarThumb
      ctx.fillRect(width - this.scrollbarWidth, thumbTop, this.scrollbarWidth, thumbHeight)
    }

    // Horizontal scrollbar
    if (showHBar) {
      const trackWidth = width
      const thumbWidth = Math.max(20, (viewportWidth / contentWidth) * trackWidth)
      const maxTravel = trackWidth - thumbWidth
      const thumbLeft = (this.scrollX / Math.max(1, contentWidth - viewportWidth)) * maxTravel

      // Draw track (optional, currently transparent)
      if (theme.scrollbarTrack !== 'transparent') {
        ctx.fillStyle = theme.scrollbarTrack
        ctx.fillRect(0, height - this.scrollbarWidth, width, this.scrollbarWidth)
      }

      // Draw thumb
      ctx.fillStyle = this.hoveredScrollbar === 'horizontal' ? theme.scrollbarThumbHover : theme.scrollbarThumb
      ctx.fillRect(thumbLeft, height - this.scrollbarWidth, thumbWidth, this.scrollbarWidth)
    }
  }

  private updateFunctionSignature() {
    if (!this.isActive || !this.signatureEnabled) {
      this.clearSignaturePopupCanvas()
      return
    }
    // Hover signature (or its pending delay) should take precedence over caret-based signature popup.
    if (this.hoverTimeoutId !== null || this.hoverSignaturePopupState !== null) {
      this.clearSignaturePopupCanvas()
      return
    }
    // If the user recently hid the signature popup explicitly (e.g. pressed Escape),
    // and the caret/text haven't changed since, keep it suppressed.
    if (this.suppressSignatureUntil) {
      const s = this.suppressSignatureUntil
      const currentText = this.inputState.lines.join('\n')
      const sameCaret = this.inputState.caret.line === s.line && this.inputState.caret.column === s.column
      const sameText = currentText === s.text
      if (sameCaret && sameText) {
        // Still suppressed — don't compute or reopen the popup.
        this.clearSignaturePopupCanvas()
        return
      }
      // Caret or text changed — clear suppression and continue.
      this.suppressSignatureUntil = null
    }
    const callInfo = findFunctionCallContext(
      this.inputState.lines,
      this.inputState.caret.line,
      this.inputState.caret.column,
      this.functionDefinitions,
    )

    // Only update function call info if it actually changed
    const callInfoChanged = !this.areCallInfosEqual(this.lastFunctionCallInfo, callInfo)
    if (callInfoChanged) {
      this.lastFunctionCallInfo = callInfo
      this.callbacks.onFunctionCallChange?.(this.signatureEnabled ? callInfo : null)
    }

    if (callInfo) {
      const ctx = this.canvas.getContext('2d')
      if (ctx) {
        this.setFont(ctx)
        const rect = this.container.getBoundingClientRect()
        const textPadding = this.getTextPadding()

        // Calculate visual line positions (works for both wordwrap and non-wordwrap modes)
        let preCalculatedContentY: number | undefined
        let preCalculatedCaretContentY: number | undefined
        let preCalculatedContentX: number | undefined
        let preCalculatedCaretContentX: number | undefined

        const wrappedLines = this.getWrappedLines(ctx)
        const widgetLayout = this.calculateWidgetLayout(ctx, wrappedLines)

        const visualPos = this.logicalToVisualPosition(
          callInfo.openParenPosition.line,
          callInfo.openParenPosition.column,
          wrappedLines,
        )
        const yOffset = widgetLayout.yOffsets.get(visualPos.visualLine) || 0
        let aboveHeight = 0
        const widgets = widgetLayout.widgetsByVisualLine.get(visualPos.visualLine)
        if (widgets?.above && widgets.above.length > 0) {
          aboveHeight = this.getAboveSpacingHeight(wrappedLines, visualPos.visualLine, widgets.above)
        }
        preCalculatedContentY = this.padding + visualPos.visualLine * this.lineHeight + yOffset + aboveHeight

        // Calculate X position based on wrapped line segment
        const wrappedLine = wrappedLines[visualPos.visualLine]
        if (wrappedLine) {
          const textBeforeParenInSegment = wrappedLine.text.substring(0, visualPos.visualColumn)
          preCalculatedContentX = textPadding + ctx.measureText(textBeforeParenInSegment).width
        }

        const caretVisualPos = this.logicalToVisualPosition(
          this.inputState.caret.line,
          this.inputState.caret.column,
          wrappedLines,
        )
        const caretYOffset = widgetLayout.yOffsets.get(caretVisualPos.visualLine) || 0
        let caretAboveHeight = 0
        const caretWidgets = widgetLayout.widgetsByVisualLine.get(caretVisualPos.visualLine)
        if (caretWidgets?.above && caretWidgets.above.length > 0) {
          caretAboveHeight = this.getAboveSpacingHeight(wrappedLines, caretVisualPos.visualLine, caretWidgets.above)
        }
        preCalculatedCaretContentY = this.padding + caretVisualPos.visualLine * this.lineHeight + caretYOffset
          + caretAboveHeight

        // Calculate caret X position based on wrapped line segment
        const caretWrappedLine = wrappedLines[caretVisualPos.visualLine]
        if (caretWrappedLine) {
          const textBeforeCaretInSegment = caretWrappedLine.text.substring(
            0,
            caretVisualPos.visualColumn,
          )
          preCalculatedCaretContentX = textPadding + ctx.measureText(textBeforeCaretInSegment).width

          // Account for inline widgets before the caret
          const inlineWidgetsForLine = widgetLayout.inlineWidgets.get(caretVisualPos.visualLine) || []
          for (const { widget, column } of inlineWidgetsForLine) {
            const columnInWrappedLine = column - caretWrappedLine.startColumn
            if (columnInWrappedLine <= caretVisualPos.visualColumn) {
              preCalculatedCaretContentX += ctx.measureText('X'.repeat(widget.length)).width
            }
          }
        }

        const position = calculatePopupPosition(
          callInfo.openParenPosition,
          textPadding,
          this.lineHeight,
          ctx,
          this.inputState.lines,
          rect,
          this.scrollX,
          this.scrollY,
          this.inputState.caret,
          preCalculatedContentY,
          preCalculatedCaretContentY,
          preCalculatedContentX,
          preCalculatedCaretContentX,
        )

        const headerHeight = this.getHeaderHeight()
        const newPopupPosition = {
          x: position.x,
          y: position.y + headerHeight,
        }

        // Only update if position actually changed
        const positionChanged = !this.lastPopupPosition
          || this.lastPopupPosition.x !== newPopupPosition.x
          || this.lastPopupPosition.y !== newPopupPosition.y

        this.lastPopupPosition = newPopupPosition
        if (positionChanged) {
          this.callbacks.onPopupPositionChange?.(newPopupPosition)
        }

        const signature = this.functionDefinitions[callInfo.functionName]
        const selection = this.inputState.selection
        const selectionEmpty = !selection
          || (selection.start.line === selection.end.line && selection.start.column === selection.end.column)
        const visible = selectionEmpty && !!signature
        if (visible) {
          this.signaturePopupState = { signature, callInfo, position: newPopupPosition }
          setPopupCanvasDrawable(this.signaturePopupId, this.signaturePopupDrawable)
        }
        else {
          this.clearSignaturePopupCanvas()
        }
      }
    }
    else {
      if (this.lastPopupPosition !== null) {
        // Clear popup position when there's no call info
        this.lastPopupPosition = null
      }
      this.clearSignaturePopupCanvas()
    }
  }

  private areCallInfosEqual(a: FunctionCallInfo | null, b: FunctionCallInfo | null): boolean {
    if (a === null && b === null) return true
    if (a === null || b === null) return false

    return (
      a.functionName === b.functionName
      && a.currentArgumentIndex === b.currentArgumentIndex
      && a.currentParameterName === b.currentParameterName
      && a.openParenPosition.line === b.openParenPosition.line
      && a.openParenPosition.column === b.openParenPosition.column
    )
  }

  private arePositionsEqual(
    a: { x: number; y: number } | null,
    b: { x: number; y: number } | null,
  ): boolean {
    if (a === null && b === null) return true
    if (a === null || b === null) return false

    return a.x === b.x && a.y === b.y
  }

  public checkScrollbarHover(x: number, y: number): 'vertical' | 'horizontal' | null {
    const dpr = window.devicePixelRatio || 1
    const width = this.canvas.width / dpr
    const height = this.canvas.height / dpr
    const headerHeight = this.getHeaderHeight()

    const { viewportWidth, viewportHeight, contentWidth, contentHeight } = this.scrollMetrics

    const showVBar = contentHeight > viewportHeight + 1
    const showHBar = contentWidth > viewportWidth + 1

    // Check vertical scrollbar (only in content area, below header)
    if (showVBar && x >= width - this.scrollbarWidth && x <= width && y >= headerHeight) {
      return 'vertical'
    }

    // Check horizontal scrollbar
    if (showHBar && y >= height - this.scrollbarWidth && y <= height) {
      return 'horizontal'
    }

    return null
  }

  public setScrollbarHover(scrollbar: 'vertical' | 'horizontal' | null) {
    if (this.hoveredScrollbar !== scrollbar) {
      this.hoveredScrollbar = scrollbar
      this.maybeDraw()
    }
  }

  public handleScrollbarClick(x: number, y: number, scrollbar: 'vertical' | 'horizontal'): boolean {
    const dpr = window.devicePixelRatio || 1
    const width = this.canvas.width / dpr
    const height = this.canvas.height / dpr
    const headerHeight = this.getHeaderHeight()
    const contentHeight = height - headerHeight

    const { viewportWidth, viewportHeight, contentWidth, contentHeight: contentTotalHeight } = this.scrollMetrics

    if (scrollbar === 'vertical') {
      const trackHeight = contentHeight
      const thumbHeight = Math.max(20, (viewportHeight / contentTotalHeight) * trackHeight)
      const maxTravel = trackHeight - thumbHeight
      const thumbTop = headerHeight + (this.scrollY / Math.max(1, contentTotalHeight - viewportHeight)) * maxTravel
      const yRelative = y - headerHeight

      // Check if clicking on thumb
      if (y >= thumbTop && y <= thumbTop + thumbHeight) {
        return true // Indicates thumb clicked (will be handled by drag)
      }

      // Click on track - jump to position
      const targetThumbTop = Math.max(0, Math.min(yRelative - thumbHeight / 2, maxTravel))
      const scrollY = (targetThumbTop / maxTravel) * Math.max(1, contentTotalHeight - viewportHeight)
      this.setScroll(null, Math.round(scrollY))
      return false
    }
    else {
      const trackWidth = width
      const thumbWidth = Math.max(20, (viewportWidth / contentWidth) * trackWidth)
      const maxTravel = trackWidth - thumbWidth
      const thumbLeft = (this.scrollX / Math.max(1, contentWidth - viewportWidth)) * maxTravel

      // Check if clicking on thumb
      if (x >= thumbLeft && x <= thumbLeft + thumbWidth) {
        return true // Indicates thumb clicked (will be handled by drag)
      }

      // Click on track - jump to position
      const targetThumbLeft = Math.max(0, Math.min(x - thumbWidth / 2, maxTravel))
      const scrollX = (targetThumbLeft / maxTravel) * Math.max(1, contentWidth - viewportWidth)
      this.setScroll(Math.round(scrollX), null)
      return false
    }
  }

  public handleScrollbarDrag(dx: number, dy: number, scrollbar: 'vertical' | 'horizontal') {
    const dpr = window.devicePixelRatio || 1
    const width = this.canvas.width / dpr
    const height = this.canvas.height / dpr
    const headerHeight = this.getHeaderHeight()
    const contentHeight = height - headerHeight

    const { viewportWidth, viewportHeight, contentWidth, contentHeight: contentTotalHeight } = this.scrollMetrics

    if (scrollbar === 'vertical') {
      const trackHeight = contentHeight
      const thumbHeight = Math.max(20, (viewportHeight / contentTotalHeight) * trackHeight)
      const maxTravel = Math.max(1, trackHeight - thumbHeight)
      const contentScrollable = Math.max(1, contentTotalHeight - viewportHeight)
      const scrollDelta = (dy / maxTravel) * contentScrollable
      this.setScroll(null, Math.max(0, Math.min(this.scrollY + scrollDelta, contentScrollable)))
    }
    else {
      const trackWidth = width
      const thumbWidth = Math.max(20, (viewportWidth / contentWidth) * trackWidth)
      const maxTravel = Math.max(1, trackWidth - thumbWidth)
      const contentScrollable = Math.max(1, contentWidth - viewportWidth)
      const scrollDelta = (dx / maxTravel) * contentScrollable
      this.setScroll(Math.max(0, Math.min(this.scrollX + scrollDelta, contentScrollable)), null)
    }
  }

  public setSignatureEnabled(enabled: boolean) {
    if (this.signatureEnabled !== enabled) {
      this.signatureEnabled = enabled
      if (!enabled) {
        this.lastFunctionCallInfo = null
        this.callbacks.onFunctionCallChange?.(null)
        this.clearSignaturePopupCanvas()
        this.clearFunctionHoverPopup()
      }
      else {
        this.updateFunctionSignature()
      }
    }
  }

  public setHoverSignatureEnabled(enabled: boolean) {
    if (this.hoverSignatureEnabled !== enabled) {
      this.hoverSignatureEnabled = enabled
      if (!enabled) {
        this.clearFunctionHoverPopup()
      }
    }
  }

  public hideSignaturePopup() {
    if (this.lastFunctionCallInfo !== null) {
      this.lastFunctionCallInfo = null
      this.callbacks.onFunctionCallChange?.(null)
    }
    this.clearSignaturePopupCanvas()
    this.clearFunctionHoverPopup()
    // Suppress immediate reopening of the popup until the caret or text changes.
    // Store current caret position and text snapshot.
    try {
      this.suppressSignatureUntil = {
        line: this.inputState.caret.line,
        column: this.inputState.caret.column,
        text: this.inputState.lines.join('\n'),
      }
    }
    catch {
      // Defensive: if inputState not available for some reason, clear suppression.
      this.suppressSignatureUntil = null
    }
  }

  public setFunctionDefinitions(definitions: Record<string, any>) {
    this.functionDefinitions = definitions as Record<string, FunctionSignature>
  }

  public setKeywords(keywords: string[]) {
    this.keywords = [...keywords]
  }

  public hideAutocomplete() {
    if (this.autocompleteDebounceTimer !== null) {
      clearTimeout(this.autocompleteDebounceTimer)
      this.autocompleteDebounceTimer = null
    }
    if (this.lastAutocompleteInfo !== null) {
      this.lastAutocompleteInfo = null
      this.callbacks.onAutocompleteChange?.(null)
    }
  }

  public setAutocompleteInputSource(source: 'keyboard' | 'mouse') {
    this.autocompleteInputSource = source
    if (source === 'mouse') {
      // Ensure popup is hidden when interacting with mouse
      this.hideAutocomplete()
    }
  }

  private updateAutocomplete(forceImmediate = false) {
    if (!this.isActive) return
    if (this.autocompleteInputSource !== 'keyboard') return

    if (forceImmediate) {
      if (this.autocompleteDebounceTimer !== null) {
        clearTimeout(this.autocompleteDebounceTimer)
        this.autocompleteDebounceTimer = null
      }
      this.executeAutocompleteUpdate()
    }
    else {
      if (this.autocompleteDebounceTimer !== null) {
        clearTimeout(this.autocompleteDebounceTimer)
      }
      this.autocompleteDebounceTimer = window.setTimeout(() => {
        this.autocompleteDebounceTimer = null
        this.executeAutocompleteUpdate()
      }, 150)
    }
  }

  private executeAutocompleteUpdate() {
    if (!this.isActive) return
    if (this.autocompleteInputSource !== 'keyboard') return

    const wordInfo = findCurrentWord(
      this.inputState.lines,
      this.inputState.caret.line,
      this.inputState.caret.column,
    )

    if (!wordInfo) {
      if (this.lastAutocompleteInfo !== null) {
        this.lastAutocompleteInfo = null
        this.callbacks.onAutocompleteChange?.(null)
      }
      if (this.lastAutocompletePosition !== null) {
        this.lastAutocompletePosition = null
      }
      return
    }

    const suggestions = getAutocompleteSuggestions(
      wordInfo.word,
      this.inputState.lines,
      this.functionDefinitions,
      this.keywords,
    )

    const autocompleteInfo: AutocompleteInfo | null = suggestions.length > 0
      ? {
        word: wordInfo.word,
        startColumn: wordInfo.startColumn,
        endColumn: wordInfo.endColumn,
        suggestions,
      }
      : null

    // Only update if changed
    const changed = !this.areAutocompleteInfosEqual(this.lastAutocompleteInfo, autocompleteInfo)
    if (changed) {
      this.lastAutocompleteInfo = autocompleteInfo
      this.callbacks.onAutocompleteChange?.(autocompleteInfo)
    }

    if (autocompleteInfo) {
      const ctx = this.canvas.getContext('2d')
      if (ctx) {
        this.setFont(ctx)
        const textPadding = this.getTextPadding()
        const computeCaretContentFallback = (
          ctx: CanvasRenderingContext2D,
          textPadding: number,
        ): { x?: number; y?: number } => {
          if (this.options.wordWrap) {
            const wrappedLines = this.getWrappedLines(ctx)
            const widgetLayout = this.calculateWidgetLayout(ctx, wrappedLines)

            const caretVisualPos = this.logicalToVisualPosition(
              this.inputState.caret.line,
              this.inputState.caret.column,
              wrappedLines,
            )
            const yOffset = widgetLayout.yOffsets.get(caretVisualPos.visualLine) || 0
            let aboveHeight = 0
            const widgets = widgetLayout.widgetsByVisualLine.get(caretVisualPos.visualLine)
            if (widgets?.above && widgets.above.length > 0) {
              aboveHeight = this.getAboveSpacingHeight(wrappedLines, caretVisualPos.visualLine, widgets.above)
            }
            const y = this.padding + caretVisualPos.visualLine * this.lineHeight + yOffset + aboveHeight

            const caretWrappedLine = wrappedLines[caretVisualPos.visualLine]
            if (!caretWrappedLine) return { y }

            const textBeforeCaretInSegment = caretWrappedLine.text.substring(0, caretVisualPos.visualColumn)
            let x = textPadding + ctx.measureText(textBeforeCaretInSegment).width

            // Account for inline widgets before the caret
            const inlineWidgetsForLine = widgetLayout.inlineWidgets.get(caretVisualPos.visualLine) || []
            for (const { widget, column } of inlineWidgetsForLine) {
              const columnInWrappedLine = column - caretWrappedLine.startColumn
              if (columnInWrappedLine <= caretVisualPos.visualColumn) {
                x += ctx.measureText('X'.repeat(widget.length)).width
              }
            }

            return { x, y }
          }

          // Non-wrapped: compute caret X/Y in content space
          const wrappedLines = this.getWrappedLines(ctx)
          const widgetLayout = this.calculateWidgetLayout(ctx, wrappedLines)

          const yOffset = widgetLayout.yOffsets.get(this.inputState.caret.line) || 0
          let aboveHeight = 0
          const widgets = widgetLayout.widgetsByVisualLine.get(this.inputState.caret.line)
          if (widgets?.above && widgets.above.length > 0) {
            aboveHeight = Math.max(...widgets.above.map(w => this.getWidgetHeight(w)))
          }

          const caretLine = this.inputState.lines[this.inputState.caret.line] || ''
          const textBeforeCaret = caretLine.substring(0, this.inputState.caret.column)
          let x = textPadding + ctx.measureText(textBeforeCaret).width

          // Account for inline widgets before the caret
          const inlineWidgetsForLine = widgetLayout.inlineWidgets.get(this.inputState.caret.line) || []
          for (const { widget, column } of inlineWidgetsForLine) {
            if (column <= this.inputState.caret.column) {
              x += ctx.measureText('X'.repeat(widget.length)).width
            }
          }

          const y = this.padding + this.inputState.caret.line * this.lineHeight + yOffset + aboveHeight
          return { x, y }
        }

        const publishPosition = (
          ctx: CanvasRenderingContext2D,
          textPadding: number,
          fallback?: { x?: number; y?: number },
        ) => {
          const contentX = this.lastCaretContentX ?? fallback?.x
          const contentY = this.lastCaretContentY ?? fallback?.y
          if (contentX === undefined || contentY === undefined) return

          const position = calculateAutocompletePosition(
            this.inputState.caret.line,
            this.inputState.caret.column,
            textPadding,
            this.lineHeight,
            ctx,
            this.inputState.lines,
            this.container.getBoundingClientRect(),
            this.scrollX,
            this.scrollY,
            contentY,
            contentX,
          )
          const headerHeight = this.getHeaderHeight()

          const newPosition = {
            x: Math.round(position.x),
            y: Math.round(position.y + headerHeight),
          }

          // Only update if position actually changed
          const positionChanged = !this.lastAutocompletePosition
            || this.lastAutocompletePosition.x !== newPosition.x
            || this.lastAutocompletePosition.y !== newPosition.y

          this.lastAutocompletePosition = newPosition
          if (positionChanged) {
            this.callbacks.onAutocompletePositionChange?.(newPosition)
          }
        }

        const fallback = (this.lastCaretContentX === null || this.lastCaretContentY === null)
          ? computeCaretContentFallback(ctx, textPadding)
          : undefined

        // If autocomplete info hasn't changed, update position immediately (e.g., during scroll)
        // Only delay when autocomplete info is changing (new suggestions, etc.)
        // Force immediate update if canvas state is already finalized (e.g., after error updates)
        if (changed && this.lastAutocompleteInfo !== null) {
          // Delay slightly to ensure caret/layout state is finalized before measuring
          animationManager.nextFrame(this.animId('autocompleteDelay'), () => {
            const ctx = this.canvas.getContext('2d')
            if (!ctx) return

            this.setFont(ctx)
            const textPadding = this.getTextPadding()
            const fallback = (this.lastCaretContentX === null || this.lastCaretContentY === null)
              ? computeCaretContentFallback(ctx, textPadding)
              : undefined

            publishPosition(ctx, textPadding, fallback)
          })
        }
        else {
          publishPosition(ctx, textPadding, fallback)
        }
      }
    }
    else if (this.lastAutocompletePosition !== null) {
      this.lastAutocompletePosition = null
    }
  }

  private areAutocompleteInfosEqual(
    a: AutocompleteInfo | null,
    b: AutocompleteInfo | null,
  ): boolean {
    if (a === null && b === null) return true
    if (a === null || b === null) return false

    return (
      a.word === b.word
      && a.startColumn === b.startColumn
      && a.endColumn === b.endColumn
      && a.suggestions.length === b.suggestions.length
      && a.suggestions.every((s, i) => s === b.suggestions[i])
    )
  }

  public setPopupDimensions(width: number, height: number) {
    const widthChanged = Math.abs(this.popupDimensions.width - width) > 2
    const heightChanged = Math.abs(this.popupDimensions.height - height) > 2
    const significantChange = widthChanged || heightChanged

    this.popupDimensions = { width, height }

    // Recalculate position if dimensions changed significantly
    // This handles the case where constraining X causes text wrap and increased height
    if (significantChange && this.isActive) {
      this.updateFunctionSignature()
    }
  }

  public setWidgets(widgets: EditorWidget[]) {
    if (this.options.widgets === widgets) return
    this.options.widgets = widgets
    this.maybeDraw()
  }

  public setWidgetsWithoutDraw(widgets: EditorWidget[]) {
    this.options.widgets = widgets
  }

  public setCodeFileRef(codeFileRef: unknown) {
    const codeFileChanged = this.currentCodeFileRef !== codeFileRef
    this.currentCodeFileRef = codeFileRef

    // If codefile changed, clear any pending widget update
    if (codeFileChanged) {
      if (this.pendingWidgets) {
        if (this.widgetUpdateTimeout !== null) {
          clearTimeout(this.widgetUpdateTimeout)
          this.widgetUpdateTimeout = null
        }
        // Clear pending widgets if any
        this.pendingWidgets = null
      }
    }
  }

  public updateHeader(header: EditorHeader) {
    this.options.header = header
    this.maybeDraw()
  }

  public updateWidgets(widgets: EditorWidget[]) {
    // Update widgets immediately
    // Clear any pending update
    if (this.widgetUpdateTimeout !== null) {
      clearTimeout(this.widgetUpdateTimeout)
      this.widgetUpdateTimeout = null
    }
    this.pendingWidgets = null

    // Simply set widgets directly - no matching, debouncing, or delays
    this.options.widgets = widgets
    this.maybeDraw()
  }

  public getWidgets(): Array<
    { line: number; column: number; type: 'above' | 'below' | 'inline' | 'overlay'; length: number; height?: number }
  > {
    if (!this.options.widgets) return []
    return this.options.widgets.map(w => ({
      line: w.line,
      column: w.column,
      type: w.type,
      length: w.length,
      height: w.height,
    }))
  }

  public setTheme(theme: Theme) {
    this.options.theme = theme
    this.highlightCache = null
    this.offscreenLineCache.clear()
    this.offscreenLineRenderVersion++
    this.maybeDraw()
    if (this.signaturePopupState) setPopupCanvasDrawable(this.signaturePopupId, this.signaturePopupDrawable)
    if (this.errorPopupState) setPopupCanvasDrawable(this.errorPopupId, this.errorPopupDrawable)
  }

  public setTokenizer(tokenizer: Tokenizer) {
    this.options.tokenizer = tokenizer
    this.highlightCache = null
    this.offscreenLineCache.clear()
    this.offscreenLineRenderVersion++
    this.maybeDraw()
    if (this.signaturePopupState) setPopupCanvasDrawable(this.signaturePopupId, this.signaturePopupDrawable)
  }

  public setErrors(errors: EditorError[]) {
    // Track if we were at the bottom before updating errors
    // const ctx = this.canvas.getContext('2d')
    // let wasAtBottom = false
    // if (ctx && this.isActive) {
    //   this.setFont(ctx)
    //   const oldContentSize = this.options.wordWrap
    //     ? this.getContentSizeWithWrapping(ctx, this.getWrappedLines(ctx))
    //     : this.getContentSize(ctx)
    //   const dpr = window.devicePixelRatio || 1
    //   const headerHeight = this.getHeaderHeight()
    //   const viewportHeight = (this.canvas.height / dpr) - headerHeight
    //   const maxScrollY = Math.max(0, oldContentSize.height - viewportHeight)
    //   wasAtBottom = this.scrollY >= maxScrollY - 1 // Allow 1px tolerance
    // }

    const normalizedErrors: EditorError[] = []
    for (const e of errors) {
      const line = this.inputState.lines[e.line]
      if (line === undefined) continue

      const max = line.length
      const startColumn = Math.max(0, Math.min(e.startColumn, max))
      let endColumn = Math.max(0, Math.min(e.endColumn, max + 1))
      if (endColumn <= startColumn) {
        endColumn = Math.min(startColumn + 1, max + 1)
      }

      normalizedErrors.push({ ...e, startColumn, endColumn })
    }

    this.errors = normalizedErrors

    // Defer canvas size update to avoid feedback loop with ResizeObserver
    // The draw will use current canvas size, and metrics will be updated correctly
    animationManager.nextFrame(this.animId('errorUpdateDefer'), () => {
      this.updateCanvasSize()

      const drawCtx = this.canvas.getContext('2d')
      if (!drawCtx) return

      this.maybeDraw()
      this.updateFunctionSignature()
      this.updateAutocomplete(true)

      // Preserve bottom scroll position after draw if we were at the bottom
      // if (wasAtBottom && drawCtx && this.isActive) {
      //   this.setFont(drawCtx)
      //   const wrappedLines = this.getWrappedLines(drawCtx)
      //   const newContentSize = this.options.wordWrap
      //     ? this.getContentSizeWithWrapping(drawCtx, wrappedLines)
      //     : this.getContentSize(drawCtx)
      //   const dpr = window.devicePixelRatio || 1
      //   const viewportHeight = this.canvas.height / dpr
      //   const maxScrollY = Math.max(0, newContentSize.height - viewportHeight)
      //   if (this.scrollY < maxScrollY) {
      //     // this.scrollY = maxScrollY
      //     this.callbacks.onScrollChange?.(this.scrollX, this.scrollY)
      //     // Redraw to reflect the corrected scroll position
      //     this.maybeDraw()
      //     this.updateFunctionSignature()
      //     this.updateAutocomplete(true)
      //   }
      // }
    })
  }

  public checkErrorHover(x: number, y: number): EditorError | null {
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return null

    this.setFont(ctx)
    const wrappedLines = this.getWrappedLines(ctx)
    const widgetLayout = this.calculateWidgetLayout(ctx, wrappedLines)
    const textPadding = this.getTextPadding()
    const headerHeight = this.getHeaderHeight()

    // Reset gutter hover flag first
    this.isHoveringGutter = false

    // Check if hovering over gutter area (gutter is drawn before scroll transform, so use raw coordinates)
    if (this.options.gutter && this.errors.length > 0 && wrappedLines.length > 0) {
      const gutterWidth = this.getGutterWidth()
      const gutterEnd = this.padding + gutterWidth

      // Check if mouse is in gutter area (including padding area)
      if (x >= 0 && x < gutterEnd) {
        // Mouse is in gutter area, find which line it corresponds to
        // Line numbers scroll with content, so we need to account for scroll and widgets
        const adjustedY = y - headerHeight + this.scrollY
        const clampedVisualLineIndex = this.getVisualLineFromY(adjustedY, wrappedLines, widgetLayout)

        const wrappedLine = wrappedLines[clampedVisualLineIndex]
        if (wrappedLine !== undefined) {
          // Find the first error on this logical line (matching normal error hover behavior)
          const errorOnLine = this.errors.find(error => error.line === wrappedLine.logicalLine)
          if (errorOnLine) {
            this.isHoveringGutter = true
            return errorOnLine
          }
        }
      }
    }

    // Not in gutter, check normal error hover on text content
    const adjustedY = y - headerHeight + this.scrollY
    const adjustedX = x + this.scrollX
    const clampedVisualLineIndex = this.getVisualLineFromY(adjustedY, wrappedLines, widgetLayout)

    const wrappedLine = wrappedLines[clampedVisualLineIndex]
    if (!wrappedLine) return null

    const visualColumn = this.getColumnFromXInclusive(
      adjustedX - textPadding,
      wrappedLine.text,
      ctx,
    )
    const logicalPosition = this.visualToLogicalPosition(
      clampedVisualLineIndex,
      visualColumn,
      wrappedLines,
    )

    for (const error of this.errors) {
      if (
        error.line === logicalPosition.logicalLine
        && logicalPosition.logicalColumn >= error.startColumn
        && logicalPosition.logicalColumn < error.endColumn
      ) {
        return error
      }
    }

    return null
  }

  public checkFunctionHover(x: number, y: number): {
    functionName: string
    parameterIndex?: number
    parameterName?: string
  } | null {
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return null

    this.setFont(ctx)
    const wrappedLines = this.getWrappedLines(ctx)
    const widgetLayout = this.calculateWidgetLayout(ctx, wrappedLines)
    const textPadding = this.getTextPadding()

    // Adjust for scroll and header
    const adjustedY = y - this.getHeaderHeight() + this.scrollY
    const adjustedX = x + this.scrollX
    const clampedVisualLineIndex = this.getVisualLineFromY(adjustedY, wrappedLines, widgetLayout)

    const wrappedLine = wrappedLines[clampedVisualLineIndex]
    if (!wrappedLine) return null

    // Only allow hover when the pointer is inside the exact band where this line's text is drawn.
    const yOffset = widgetLayout.yOffsets.get(clampedVisualLineIndex) || 0
    const ws = widgetLayout.widgetsByVisualLine.get(clampedVisualLineIndex)
    let aboveHeight = 0
    if (ws?.above && ws.above.length > 0) {
      aboveHeight = Math.max(...ws.above.map(w => this.getWidgetHeight(w)))
    }
    const lineTextTop = this.padding + clampedVisualLineIndex * this.lineHeight + yOffset + aboveHeight
    const lineTextBottom = lineTextTop + this.lineHeight
    if (adjustedY < lineTextTop || adjustedY >= lineTextBottom) return null

    // Also ignore hover in the left padding/gutter area.
    if (adjustedX < textPadding) return null

    // Ignore hover when over inline widgets and when outside the drawn text width.
    const xInLine = adjustedX - textPadding
    const inlineWidgetsForLine = widgetLayout.inlineWidgets.get(clampedVisualLineIndex) || []
    const sortedInlineWidgets = inlineWidgetsForLine.length > 0
      ? [...inlineWidgetsForLine].sort((a, b) => a.column - b.column)
      : []

    let currentX = 0
    let visualColumn = 0
    let foundColumn = false

    for (const { widget, column } of sortedInlineWidgets) {
      const columnInWrappedLine = column - wrappedLine.startColumn
      if (columnInWrappedLine < 0) continue
      if (columnInWrappedLine > wrappedLine.text.length) break

      const textSegment = wrappedLine.text.substring(visualColumn, columnInWrappedLine)
      const textWidth = ctx.measureText(textSegment).width
      const widgetWidth = ctx.measureText('X'.repeat(widget.length)).width

      if (xInLine < currentX + textWidth) {
        const relativeColumn = this.getColumnFromXInclusive(xInLine - currentX, textSegment, ctx)
        visualColumn = visualColumn + relativeColumn
        foundColumn = true
        break
      }

      currentX += textWidth

      if (xInLine < currentX + widgetWidth) {
        // Pointer is over an inline widget area, not text.
        return null
      }

      currentX += widgetWidth
      visualColumn = columnInWrappedLine
    }

    if (!foundColumn) {
      const remainingText = wrappedLine.text.substring(visualColumn)
      const remainingWidth = ctx.measureText(remainingText).width
      if (xInLine > currentX + remainingWidth) return null
      const relativeColumn = this.getColumnFromXInclusive(xInLine - currentX, remainingText, ctx)
      visualColumn = visualColumn + relativeColumn
    }

    // Convert visual position to logical position
    const logicalPos = this.visualToLogicalPosition(
      clampedVisualLineIndex,
      visualColumn,
      wrappedLines,
    )

    // Check if we're hovering over a function call
    const callInfo = findFunctionCallContext(
      this.inputState.lines,
      logicalPos.logicalLine,
      logicalPos.logicalColumn,
      this.functionDefinitions,
    )

    if (!callInfo) return null

    const signature = this.functionDefinitions[callInfo.functionName]
    if (!signature) return null

    // Check if cursor is on the function name itself
    const functionNameStart = callInfo.openParenPosition.column - callInfo.functionName.length
    const functionNameEnd = callInfo.openParenPosition.column

    if (logicalPos.logicalLine === callInfo.openParenPosition.line
      && logicalPos.logicalColumn >= functionNameStart
      && logicalPos.logicalColumn < functionNameEnd)
    {
      // Hovering over function name
      return {
        functionName: callInfo.functionName,
      }
    }

    // Check if cursor is in a parameter position
    if (callInfo.currentArgumentIndex >= 0 && callInfo.currentArgumentIndex < signature.parameters.length) {
      return {
        functionName: callInfo.functionName,
        parameterIndex: callInfo.currentArgumentIndex,
        parameterName: callInfo.currentParameterName,
      }
    }

    return null
  }

  public updateFunctionHover(hoveredFunction: {
    functionName: string
    parameterIndex?: number
    parameterName?: string
  } | null, mouseX?: number, mouseY?: number) {
    const isSameHover = (a: typeof hoveredFunction, b: typeof hoveredFunction): boolean =>
      a?.functionName === b?.functionName
      && a?.parameterIndex === b?.parameterIndex
      && a?.parameterName === b?.parameterName

    if (isSameHover(hoveredFunction, this.hoveredFunction)) {
      // Keep existing timer/popup; update position if already visible.
      if (hoveredFunction && this.hoverSignaturePopupState) {
        this.hoverSignaturePopupState = {
          ...this.hoverSignaturePopupState,
          position: {
            x: (mouseX ?? 0) + this.container.getBoundingClientRect().left,
            y: (mouseY ?? 0) + this.container.getBoundingClientRect().top,
          },
        }
        setPopupCanvasDrawable(this.hoverSignaturePopupId, this.hoverSignaturePopupDrawable)
      }
      return
    }

    // Clear existing timeout
    if (this.hoverTimeoutId !== null) {
      clearTimeout(this.hoverTimeoutId)
      this.hoverTimeoutId = null
    }

    // If hovering over a function/parameter, start the timeout
    if (hoveredFunction && this.hoverSignatureEnabled) {
      this.hoverTimeoutId = window.setTimeout(() => {
        this.showFunctionHoverPopup(hoveredFunction, mouseX ?? 0, mouseY ?? 0)
      }, 300)
    }
    else {
      // Not hovering or signature disabled, clear any existing popup
      this.clearFunctionHoverPopup()
    }

    this.hoveredFunction = hoveredFunction
  }

  private showFunctionHoverPopup(hoveredFunction: {
    functionName: string
    parameterIndex?: number
    parameterName?: string
  }, mouseX: number, mouseY: number) {
    const signature = this.functionDefinitions[hoveredFunction.functionName]
    if (!signature) return

    const ctx = this.canvas.getContext('2d')
    if (!ctx) return

    this.setFont(ctx)
    const rect = this.container.getBoundingClientRect()

    // Create a call info for the popup
    const callInfo: FunctionCallInfo = {
      functionName: hoveredFunction.functionName,
      currentArgumentIndex: hoveredFunction.parameterIndex ?? 0,
      currentParameterName: hoveredFunction.parameterName,
      openParenPosition: { line: 0, column: 0 }, // Not used for hover popup positioning
    }

    // Position the popup near the mouse cursor
    const position = { x: mouseX + rect.left, y: mouseY + rect.top }

    // Hide caret signature popup while a hover popup is shown.
    this.clearSignaturePopupCanvas()

    this.hoverSignaturePopupState = { signature, callInfo, position }
    setPopupCanvasDrawable(this.hoverSignaturePopupId, this.hoverSignaturePopupDrawable)
  }

  private clearFunctionHoverPopup() {
    if (this.hoverTimeoutId !== null) {
      clearTimeout(this.hoverTimeoutId)
      this.hoverTimeoutId = null
    }
    this.hoveredFunction = null
    this.clearHoverSignaturePopupCanvas()
  }

  // For hover hit-testing: treat any x within a character cell as inside that character
  // rather than rounding to nearest. This aligns hover with the drawn squiggles.
  private getColumnFromXInclusive(x: number, line: string, ctx: CanvasRenderingContext2D): number {
    if (x <= 0) return 0

    let currentWidth = 0
    for (let i = 0; i < line.length; i++) {
      const charWidth = ctx.measureText(line[i]).width
      const nextWidth = currentWidth + charWidth
      if (x < nextWidth) return i
      currentWidth = nextWidth
    }

    return line.length
  }

  public updateErrorHover(error: EditorError | null) {
    // Always update position if error exists, even if it's the same error (for gutter hover updates)
    const shouldUpdate = this.hoveredError !== error || (error !== null && this.isHoveringGutter)

    if (this.hoveredError !== error) {
      this.hoveredError = error
      this.callbacks.onErrorHover?.(error)
    }

    if (error && shouldUpdate) {
      const ctx = this.canvas.getContext('2d')
      if (ctx) {
        this.setFont(ctx)
        const rect = this.container.getBoundingClientRect()
        const textPadding = this.getTextPadding()

        let preCalculatedContentY: number | undefined
        let preCalculatedContentX: number | undefined

        // If hovering over gutter, position popup near the gutter
        if (this.isHoveringGutter && this.options.gutter) {
          const wrappedLines = this.getWrappedLines(ctx)
          const widgetLayout = this.calculateWidgetLayout(ctx, wrappedLines)
          const gutterWidth = this.getGutterWidth()

          // Position at the line start, just after the gutter
          if (this.options.wordWrap) {
            const visualPos = this.logicalToVisualPosition(error.line, 0, wrappedLines)
            const yOffset = widgetLayout.yOffsets.get(visualPos.visualLine) || 0
            let aboveHeight = 0
            const widgets = widgetLayout.widgetsByVisualLine.get(visualPos.visualLine)
            if (widgets?.above && widgets.above.length > 0) {
              aboveHeight = this.getAboveSpacingHeight(wrappedLines, visualPos.visualLine, widgets.above)
            }
            preCalculatedContentY = this.padding + visualPos.visualLine * this.lineHeight + yOffset + aboveHeight
            preCalculatedContentX = textPadding
          }
          else {
            const yOffset = widgetLayout.yOffsets.get(error.line) || 0
            let aboveHeight = 0
            const widgets = widgetLayout.widgetsByVisualLine.get(error.line)
            if (widgets?.above && widgets.above.length > 0) {
              aboveHeight = Math.max(...widgets.above.map(w => this.getWidgetHeight(w)))
            }
            preCalculatedContentY = this.padding + error.line * this.lineHeight + yOffset + aboveHeight
            preCalculatedContentX = textPadding
          }
        }
        else {
          // Normal positioning at error location
          if (this.options.wordWrap) {
            const wrappedLines = this.getWrappedLines(ctx)
            const widgetLayout = this.calculateWidgetLayout(ctx, wrappedLines)
            const visualPos = this.logicalToVisualPosition(
              error.line,
              error.startColumn,
              wrappedLines,
            )
            const yOffset = widgetLayout.yOffsets.get(visualPos.visualLine) || 0
            let aboveHeight = 0
            const widgets = widgetLayout.widgetsByVisualLine.get(visualPos.visualLine)
            if (widgets?.above && widgets.above.length > 0) {
              aboveHeight = this.getAboveSpacingHeight(wrappedLines, visualPos.visualLine, widgets.above)
            }
            preCalculatedContentY = this.padding + visualPos.visualLine * this.lineHeight + yOffset + aboveHeight

            const wrappedLine = wrappedLines[visualPos.visualLine]
            if (wrappedLine) {
              const textBeforeError = wrappedLine.text.substring(0, visualPos.visualColumn)
              preCalculatedContentX = textPadding + ctx.measureText(textBeforeError).width
              const inlineWidgetsForLine = widgetLayout.inlineWidgets.get(visualPos.visualLine) || []
              for (const { widget, column } of inlineWidgetsForLine) {
                const columnInWrappedLine = column - wrappedLine.startColumn
                if (columnInWrappedLine <= visualPos.visualColumn) {
                  preCalculatedContentX += ctx.measureText('X'.repeat(widget.length)).width
                }
              }
            }
          }
          else {
            const wrappedLines = this.getWrappedLines(ctx)
            const widgetLayout = this.calculateWidgetLayout(ctx, wrappedLines)
            const yOffset = widgetLayout.yOffsets.get(error.line) || 0
            let aboveHeight = 0
            const widgets = widgetLayout.widgetsByVisualLine.get(error.line)
            if (widgets?.above && widgets.above.length > 0) {
              aboveHeight = Math.max(...widgets.above.map(w => this.getWidgetHeight(w)))
            }
            preCalculatedContentY = this.padding + error.line * this.lineHeight + yOffset + aboveHeight
            const line = this.inputState.lines[error.line] || ''
            const textBeforeError = line.substring(0, error.startColumn)
            preCalculatedContentX = textPadding + ctx.measureText(textBeforeError).width
          }
        }

        const viewportX = preCalculatedContentX! - this.scrollX + rect.left
        const headerHeight = this.getHeaderHeight()
        const viewportY = preCalculatedContentY! - this.scrollY + rect.top + headerHeight

        this.callbacks.onErrorPositionChange?.({
          x: viewportX,
          y: viewportY,
        })

        const selection = this.inputState.selection
        const selectionEmpty = !selection
          || (selection.start.line === selection.end.line && selection.start.column === selection.end.column)
        if (this.isActive && selectionEmpty) {
          this.errorPopupState = { error, position: { x: viewportX, y: viewportY } }
          setPopupCanvasDrawable(this.errorPopupId, this.errorPopupDrawable)
        }
        else {
          this.clearErrorPopupCanvas()
        }
      }
    }

    if (!error) {
      this.isHoveringGutter = false
      this.clearErrorPopupCanvas()
    }
  }

  private clearSignaturePopupCanvas() {
    this.signaturePopupState = null
    setPopupCanvasDrawable(this.signaturePopupId, null)
  }

  private clearHoverSignaturePopupCanvas() {
    this.hoverSignaturePopupState = null
    setPopupCanvasDrawable(this.hoverSignaturePopupId, null)
  }

  private clearErrorPopupCanvas() {
    this.errorPopupState = null
    setPopupCanvasDrawable(this.errorPopupId, null)
  }

  private drawErrorSquiggles(
    ctx: CanvasRenderingContext2D,
    wrappedLines: WrappedLine[],
    theme: Theme,
    scrollY: number,
    viewportHeight: number,
    yOffsets: Map<number, number>,
    widgetsByVisualLine: Map<number, { above: EditorWidget[]; below: EditorWidget[] }>,
    inlineWidgets: Map<number, { widget: EditorWidget; column: number }[]>,
  ) {
    const textPadding = this.getTextPadding()
    const visibleStartY = scrollY
    const visibleEndY = scrollY + viewportHeight

    for (const error of this.errors) {
      const visualStart = this.logicalToVisualPosition(error.line, error.startColumn, wrappedLines)
      const visualEnd = this.logicalToVisualPosition(error.line, error.endColumn, wrappedLines)
      const overflowWidthForLine = (lineEndColumn: number): number => {
        const overflowColumns = Math.max(0, error.endColumn - lineEndColumn)
        if (overflowColumns === 0) return 0
        return overflowColumns * this.getSpaceWidth(ctx)
      }

      // Viewport culling: skip if error is not visible
      const startYOffset = yOffsets.get(visualStart.visualLine) || 0
      const endYOffset = yOffsets.get(visualEnd.visualLine) || 0
      let startAboveHeight = 0
      const startWidgets = widgetsByVisualLine.get(visualStart.visualLine)
      if (startWidgets?.above && startWidgets.above.length > 0) {
        startAboveHeight = Math.max(...startWidgets.above.map(w => this.getWidgetHeight(w)))
      }
      let endAboveHeight = 0
      const endWidgets = widgetsByVisualLine.get(visualEnd.visualLine)
      if (endWidgets?.above && endWidgets.above.length > 0) {
        endAboveHeight = Math.max(...endWidgets.above.map(w => this.getWidgetHeight(w)))
      }
      const errorStartY = this.padding + visualStart.visualLine * this.lineHeight + startYOffset + startAboveHeight
      const errorEndY = this.padding + (visualEnd.visualLine + 1) * this.lineHeight + endYOffset + endAboveHeight

      if (errorEndY < visibleStartY || errorStartY > visibleEndY) {
        continue
      }

      if (visualStart.visualLine === visualEnd.visualLine) {
        const wrappedLine = wrappedLines[visualStart.visualLine]
        if (wrappedLine) {
          const startText = wrappedLine.text.substring(0, visualStart.visualColumn)
          const errorText = wrappedLine.text.substring(
            visualStart.visualColumn,
            visualEnd.visualColumn,
          )

          let startX = textPadding + ctx.measureText(startText).width
          const errorWidth = ctx.measureText(errorText).width
          let totalErrorWidth = errorWidth + overflowWidthForLine(wrappedLine.endColumn)

          const inlineWidgetsForLine = inlineWidgets.get(visualStart.visualLine) || []
          for (const { widget, column } of inlineWidgetsForLine) {
            const columnInWrappedLine = column - wrappedLine.startColumn
            const w = ctx.measureText('X'.repeat(widget.length)).width
            if (columnInWrappedLine <= visualStart.visualColumn) startX += w
            if (columnInWrappedLine > visualStart.visualColumn && columnInWrappedLine < visualEnd.visualColumn) {
              totalErrorWidth += w
            }
          }

          const yOffset = yOffsets.get(visualStart.visualLine) || 0
          // Add max height of 'above' widgets on this line (they are in the same row)
          let aboveHeight = 0
          const widgets = widgetsByVisualLine.get(visualStart.visualLine)
          if (widgets?.above && widgets.above.length > 0) {
            aboveHeight = this.getAboveSpacingHeight(wrappedLines, visualStart.visualLine, widgets.above)
          }
          const y = this.padding + visualStart.visualLine * this.lineHeight + yOffset + aboveHeight + this.lineHeight
            - 3

          ctx.strokeStyle = theme.errorSquigglyColor
          ctx.lineWidth = 1.5
          ctx.beginPath()

          const squiggleHeight = 2
          const squiggleWidth = 4
          let currentX = startX
          ctx.moveTo(currentX, y)

          while (currentX < startX + totalErrorWidth) {
            const nextX = Math.min(currentX + squiggleWidth / 2, startX + totalErrorWidth)
            ctx.lineTo(
              nextX,
              y
                + (Math.floor((currentX - startX) / (squiggleWidth / 2)) % 2 === 0
                  ? squiggleHeight
                  : 0),
            )
            currentX = nextX
          }

          ctx.stroke()
        }
      }
      else {
        // Clamp the visual line range to only visible lines
        const firstVisibleLine = Math.max(
          visualStart.visualLine,
          Math.floor((visibleStartY - this.padding) / this.lineHeight),
        )
        const lastVisibleLine = Math.min(
          visualEnd.visualLine,
          Math.ceil((visibleEndY - this.padding) / this.lineHeight),
        )

        for (let visualLine = firstVisibleLine; visualLine <= lastVisibleLine; visualLine++) {
          const wrappedLine = wrappedLines[visualLine]
          if (!wrappedLine) continue

          const yOffset = yOffsets.get(visualLine) || 0
          // Add max height of 'above' widgets on this line (they are in the same row)
          let aboveHeight = 0
          const widgets = widgetsByVisualLine.get(visualLine)
          if (widgets?.above && widgets.above.length > 0) {
            aboveHeight = this.getAboveSpacingHeight(wrappedLines, visualLine, widgets.above)
          }
          const y = this.padding + visualLine * this.lineHeight + yOffset + aboveHeight + this.lineHeight - 3
          let startX: number
          let errorWidth: number

          if (visualLine === visualStart.visualLine) {
            const startText = wrappedLine.text.substring(0, visualStart.visualColumn)
            const errorText = wrappedLine.text.substring(visualStart.visualColumn)
            startX = textPadding + ctx.measureText(startText).width
            errorWidth = ctx.measureText(errorText).width
          }
          else if (visualLine === visualEnd.visualLine) {
            const errorText = wrappedLine.text.substring(0, visualEnd.visualColumn)
            startX = textPadding
            errorWidth = ctx.measureText(errorText).width
          }
          else {
            startX = textPadding
            errorWidth = ctx.measureText(wrappedLine.text).width
          }

          let totalErrorWidth = errorWidth + (
            visualLine === visualEnd.visualLine ? overflowWidthForLine(wrappedLine.endColumn) : 0
          )

          const inlineWidgetsForLine = inlineWidgets.get(visualLine) || []
          for (const { widget, column } of inlineWidgetsForLine) {
            const columnInWrappedLine = column - wrappedLine.startColumn
            const w = ctx.measureText('X'.repeat(widget.length)).width
            if (visualLine === visualStart.visualLine && columnInWrappedLine <= visualStart.visualColumn) {
              startX += w
            }
            if (
              (visualLine === visualStart.visualLine
                && columnInWrappedLine > visualStart.visualColumn)
              || (visualLine === visualEnd.visualLine
                && columnInWrappedLine < visualEnd.visualColumn)
              || (visualLine !== visualStart.visualLine && visualLine !== visualEnd.visualLine)
            ) {
              totalErrorWidth += w
            }
          }

          ctx.strokeStyle = theme.errorSquigglyColor
          ctx.lineWidth = 1.5
          ctx.beginPath()

          const squiggleHeight = 2
          const squiggleWidth = 4
          let currentX = startX
          ctx.moveTo(currentX, y)

          while (currentX < startX + totalErrorWidth) {
            const nextX = Math.min(currentX + squiggleWidth / 2, startX + totalErrorWidth)
            ctx.lineTo(
              nextX,
              y
                + (Math.floor((currentX - startX) / (squiggleWidth / 2)) % 2 === 0
                  ? squiggleHeight
                  : 0),
            )
            currentX = nextX
          }

          ctx.stroke()
        }
      }
    }
  }

  private ensureWidgetPositions(): void {
    if (this.widgetPositions.size > 0) return
    if (!this.options.widgets || this.options.widgets.length === 0) return

    const ctx = this.canvas.getContext('2d')
    if (!ctx) return

    this.setFont(ctx)
    const wrappedLines = this.getWrappedLines(ctx)
    const widgetLayout = this.calculateWidgetLayout(ctx, wrappedLines)
    const textPadding = this.getTextPadding()

    wrappedLines.forEach((wrappedLine: WrappedLine, visualIndex: number) => {
      const yOffset = widgetLayout.yOffsets.get(visualIndex) || 0
      let y = this.padding + visualIndex * this.lineHeight + yOffset - 1.5

      const widgets = widgetLayout.widgetsByVisualLine.get(visualIndex)
      if (widgets?.above && widgets.above.length > 0) {
        const inlineWidgetsForAbove = widgetLayout.inlineWidgets.get(visualIndex) || []
        const widgetWidths = new Map<EditorWidget, number>()
        const widgetsForWidth = [...widgets.above].sort((a, b) => (a.column - 1) - (b.column - 1))
        for (let i = 0; i < widgetsForWidth.length; i++) {
          const widget = widgetsForWidth[i]
          const widgetColumn = widget.column - 1
          const columnInWrappedLine = widgetColumn - wrappedLine.startColumn
          const textBeforeWidget = wrappedLine.text.substring(0, Math.max(0, columnInWrappedLine))
          let widgetX = textPadding + ctx.measureText(textBeforeWidget).width
          for (const { widget: inlineWidget, column } of inlineWidgetsForAbove) {
            const colInWrapped = column - wrappedLine.startColumn
            if (colInWrapped <= columnInWrappedLine) {
              widgetX += ctx.measureText('X'.repeat(inlineWidget.length)).width
            }
          }

          const naturalWidgetWidth = ctx.measureText('X'.repeat(widget.length)).width
          let widgetWidth = naturalWidgetWidth
          if (i < widgetsForWidth.length - 1) {
            const nextWidget = widgetsForWidth[i + 1]
            const nextWidgetColumn = nextWidget.column - 1
            const nextColumnInWrappedLine = nextWidgetColumn - wrappedLine.startColumn
            const textBeforeNextWidget = wrappedLine.text.substring(0, Math.max(0, nextColumnInWrappedLine))
            let nextWidgetX = textPadding + ctx.measureText(textBeforeNextWidget).width
            for (const { widget: inlineWidget, column } of inlineWidgetsForAbove) {
              const colInWrapped = column - wrappedLine.startColumn
              if (colInWrapped <= nextColumnInWrappedLine) {
                nextWidgetX += ctx.measureText('X'.repeat(inlineWidget.length)).width
              }
            }
            const margin = ctx.measureText('X').width
            if (widgetX + naturalWidgetWidth + margin > nextWidgetX) {
              widgetWidth = Math.max(0, nextWidgetX - widgetX - margin)
            }
          }
          widgetWidths.set(widget, widgetWidth)
        }

        for (const widget of widgets.above) {
          const widgetColumn = widget.column - 1
          const adjustment = this.widgetAdjustments.get(widget)
          // Widget stays on its original line for horizontal positioning
          const columnInWrappedLine = widgetColumn - wrappedLine.startColumn
          const textBeforeWidget = wrappedLine.text.substring(0, Math.max(0, columnInWrappedLine))
          let widgetX = textPadding + ctx.measureText(textBeforeWidget).width
          for (const { widget: inlineWidget, column } of inlineWidgetsForAbove) {
            const colInWrapped = column - wrappedLine.startColumn
            if (colInWrapped <= columnInWrappedLine) {
              widgetX += ctx.measureText('X'.repeat(inlineWidget.length)).width
            }
          }
          const widgetWidth = widgetWidths.get(widget) ?? ctx.measureText('X'.repeat(widget.length)).width
          const baseHeight = this.getWidgetHeight(widget)
          // In wordWrap mode, non-first wrapped segments need extra lineHeight gap for consistent spacing
          let gapAbove = 0
          if (this.options.wordWrap && visualIndex > 0) {
            const prevWrappedLine = wrappedLines[visualIndex - 1]
            // Check if this is a continuation of the same logical line (not the first segment)
            if (prevWrappedLine && prevWrappedLine.logicalLine === wrappedLine.logicalLine) {
              gapAbove = this.lineHeight
            }
          }
          let widgetY = y
          let widgetHeight = baseHeight
          if (adjustment) {
            const startOffset = widgetLayout.yOffsets.get(adjustment.startVisualLine) || 0
            widgetY = this.padding + adjustment.startVisualLine * this.lineHeight + startOffset - 1.5

            const anchorOffset = widgetLayout.yOffsets.get(adjustment.anchorVisualLine) || 0
            const anchorY = this.padding + adjustment.anchorVisualLine * this.lineHeight + anchorOffset - 1.5
            widgetHeight = baseHeight + (anchorY - widgetY)
          }
          else if (gapAbove > 0) {
            widgetY = y - gapAbove
            widgetHeight = baseHeight + gapAbove
          }
          this.widgetPositions.set(widget, {
            x: widgetX,
            y: widgetY,
            width: widgetWidth,
            height: widgetHeight,
          })
        }
        // Use base height for line spacing (not adjusted height)
        y += this.getAboveSpacingHeight(wrappedLines, visualIndex, widgets.above)
      }

      const inlineWidgets = widgetLayout.inlineWidgets.get(visualIndex) || []
      if (inlineWidgets.length > 0) {
        let currentX = textPadding
        for (const { widget, column } of inlineWidgets) {
          const columnInWrappedLine = column - wrappedLine.startColumn
          const textBeforeWidget = wrappedLine.text.substring(0, Math.max(0, columnInWrappedLine))
          currentX = textPadding + ctx.measureText(textBeforeWidget).width
          const widgetWidth = ctx.measureText('X'.repeat(widget.length)).width
          const widgetHeight = this.getWidgetHeight(widget)
          this.widgetPositions.set(widget, {
            x: currentX,
            y: y - 0.5,
            width: widgetWidth,
            height: widgetHeight,
          })
          currentX += widgetWidth
        }
      }

      if (widgets?.below && widgets.below.length > 0) {
        const widgetY = y + this.lineHeight
        for (const widget of widgets.below) {
          const widgetColumn = widget.column - 1
          const columnInWrappedLine = widgetColumn - wrappedLine.startColumn
          const textBeforeWidget = wrappedLine.text.substring(0, Math.max(0, columnInWrappedLine))
          const widgetX = textPadding + ctx.measureText(textBeforeWidget).width
          const widgetWidth = ctx.measureText('X'.repeat(widget.length)).width
          const widgetHeight = this.getWidgetHeight(widget)
          this.widgetPositions.set(widget, {
            x: widgetX,
            y: widgetY,
            width: widgetWidth,
            height: widgetHeight,
          })
        }
      }
    })
  }

  public isHeaderPointerActive(): boolean {
    return this.isHeaderPointerDown && !!this.options.header
  }

  public handleHeaderPointerDown(event: PointerEvent, x: number, y: number): boolean {
    const header = this.options.header
    if (!header) return false
    const headerHeight = this.getHeaderHeight()
    if (headerHeight <= 0 || y < 0 || y > headerHeight) {
      return false
    }

    this.isHeaderPointerDown = true
    const offsetX = x
    const offsetY = y
    header.pointerDown?.(event, x, y, offsetX, offsetY)
    header.pointerMove?.(x, y, offsetX, offsetY)
    return true
  }

  public handleHeaderPointerMove(x: number, y: number): boolean {
    if (!this.isHeaderPointerDown) return false
    const header = this.options.header
    if (!header) return false

    const offsetX = x
    const offsetY = y
    header.pointerMove?.(x, y, offsetX, offsetY)
    return true
  }

  public handleHeaderPointerUp(): void {
    if (!this.isHeaderPointerDown) return
    this.isHeaderPointerDown = false
    this.options.header?.pointerUp?.()
  }

  public handleWidgetPointerDown(x: number, y: number): boolean {
    this.ensureWidgetPositions()
    const headerHeight = this.getHeaderHeight()
    const adjustedX = x + this.scrollX
    // Convert viewport Y to content Y: subtract header area, then add scrollY
    const adjustedY = y - headerHeight + this.scrollY

    // Check if any widget was clicked
    for (const [widget, pos] of this.widgetPositions.entries()) {
      if (
        adjustedX >= pos.x
        && adjustedX <= pos.x + pos.width
        && adjustedY >= pos.y
        && adjustedY <= pos.y + pos.height
      ) {
        this.activeWidget = widget
        this.isWidgetPointerDown = true
        this.activeWidgetPosition = { ...pos }
        const widgetViewportX = pos.x - this.scrollX
        // Widget's Y position on screen includes header offset
        const widgetViewportY = pos.y - this.scrollY + headerHeight
        const offsetX = x - widgetViewportX
        const offsetY = y - widgetViewportY
        widget.pointerDown?.(x, y, offsetX, offsetY)
        widget.pointerMove?.(x, y, offsetX, offsetY)
        return true
      }
    }

    this.isWidgetPointerDown = false
    return false
  }

  public handleWidgetPointerMove(x: number, y: number): void {
    if (!this.activeWidget || !this.isWidgetPointerDown || !this.activeWidgetPosition) return

    const pos = this.activeWidgetPosition
    const headerHeight = this.getHeaderHeight()
    const widgetViewportX = pos.x - this.scrollX
    // Account for header offset when computing widget's screen Y
    const widgetViewportY = pos.y - this.scrollY + headerHeight
    const offsetX = x - widgetViewportX
    const offsetY = y - widgetViewportY
    this.activeWidget.pointerMove?.(x, y, offsetX, offsetY)
  }

  public isWidgetPointerActive(): boolean {
    return this.isWidgetPointerDown && this.activeWidget !== null
  }

  public handleWidgetPointerUp(): void {
    if (this.activeWidget) {
      this.activeWidget.pointerUp?.()
      this.activeWidget = null
    }
    this.isWidgetPointerDown = false
    this.activeWidgetPosition = null
  }
}
