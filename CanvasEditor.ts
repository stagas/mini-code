import { highlightCode, type HighlightedLine, type Token, getTokenColor } from './syntax.ts'
import {
  findFunctionCallContext,
  calculatePopupPosition,
  type FunctionCallInfo,
} from './function-signature.ts'
import type { InputState } from './input.ts'

const drawSelection = (
  ctx: CanvasRenderingContext2D,
  inputState: InputState,
  padding: number,
  lineHeight: number,
) => {
  if (!inputState.selection) return

  const { start, end } = inputState.selection

  // Normalize selection (ensure start comes before end)
  const normalizedStart =
    start.line < end.line || (start.line === end.line && start.column <= end.column) ? start : end
  const normalizedEnd =
    start.line < end.line || (start.line === end.line && start.column <= end.column) ? end : start

  ctx.fillStyle = 'rgba(255, 255, 255, 0.2)' // Semi-transparent white selection

  const selectionPadding = 4 // Padding on the right for each selected line

  if (normalizedStart.line === normalizedEnd.line) {
    // Single line selection
    const line = inputState.lines[normalizedStart.line] || ''
    const startText = line.substring(0, normalizedStart.column)
    const selectedText = line.substring(normalizedStart.column, normalizedEnd.column)

    const startX = padding + ctx.measureText(startText).width
    const selectedWidth = ctx.measureText(selectedText).width + selectionPadding
    const y = padding + normalizedStart.line * lineHeight - 3

    ctx.fillRect(startX, y, selectedWidth, lineHeight - 2)
  } else {
    // Multi-line selection
    for (let lineIndex = normalizedStart.line; lineIndex <= normalizedEnd.line; lineIndex++) {
      const line = inputState.lines[lineIndex] || ''
      const y = padding + lineIndex * lineHeight - 3

      if (lineIndex === normalizedStart.line) {
        // First line: from start column to end of line
        const startText = line.substring(0, normalizedStart.column)
        const selectedText = line.substring(normalizedStart.column)
        const startX = padding + ctx.measureText(startText).width
        const selectedWidth = ctx.measureText(selectedText).width + selectionPadding
        ctx.fillRect(startX, y, selectedWidth, lineHeight - 2)
      } else if (lineIndex === normalizedEnd.line) {
        // Last line: from start of line to end column
        const selectedText = line.substring(0, normalizedEnd.column)
        const selectedWidth = ctx.measureText(selectedText).width + selectionPadding
        ctx.fillRect(padding, y, selectedWidth, lineHeight - 2)
      } else {
        // Middle lines: entire line
        const selectedWidth = ctx.measureText(line).width + selectionPadding
        ctx.fillRect(padding, y, selectedWidth, lineHeight - 2)
      }
    }
  }
}

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
  }[] = []

  for (let lineIndex = 0; lineIndex < highlightedCode.length; lineIndex++) {
    const line = highlightedCode[lineIndex]
    let currentColumn = 0
    for (let tokenIndex = 0; tokenIndex < line.tokens.length; tokenIndex++) {
      const token = line.tokens[tokenIndex]
      if (token.type.startsWith('brace-') || token.type === 'brace-unmatched') {
        braces.push({
          char: token.content,
          line: lineIndex,
          tokenIndex,
          token,
          position: currentColumn,
        })
      }
      currentColumn += token.length
    }
  }

  // Convert cursor position to global position
  let cursorGlobalPos = 0
  for (let i = 0; i < cursorLine; i++) {
    const line = highlightedCode[i]
    cursorGlobalPos += line.text.length + 1 // +1 for newline
  }
  cursorGlobalPos += cursorColumn

  // Helper function to calculate global position for a brace
  const getBraceGlobalPos = (brace: { line: number; position: number }): number => {
    let globalPos = 0
    for (let i = 0; i < brace.line; i++) {
      globalPos += highlightedCode[i].text.length + 1 // +1 for newline
    }
    globalPos += brace.position
    return globalPos
  }

  // Find all matched brace pairs
  const matchedPairs: { openIndex: number; closeIndex: number }[] = []
  const stack: { char: string; index: number }[] = []

  const getMatchingOpen = (char: string): string => {
    switch (char) {
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

  for (let i = 0; i < braces.length; i++) {
    const brace = braces[i]

    if (brace.char === '{' || brace.char === '(' || brace.char === '[') {
      // Opening brace
      stack.push({ char: brace.char, index: i })
    } else if (brace.char === '}' || brace.char === ')' || brace.char === ']') {
      // Closing brace - find matching opening
      const expectedOpen = getMatchingOpen(brace.char)

      // Find the most recent matching opening brace
      for (let j = stack.length - 1; j >= 0; j--) {
        if (stack[j].char === expectedOpen) {
          const openIndex = stack[j].index
          const closeIndex = i

          matchedPairs.push({ openIndex, closeIndex })

          // Remove from stack
          stack.splice(j, 1)
          break
        }
      }
    }
  }

  // Find the innermost pair containing the cursor
  let innermostPair: { openIndex: number; closeIndex: number } | null = null
  let smallestRange = Infinity

  for (const pair of matchedPairs) {
    // Calculate global positions for this pair
    const openGlobalPos = getBraceGlobalPos(braces[pair.openIndex])
    const closeGlobalPos = getBraceGlobalPos(braces[pair.closeIndex])

    // Check if cursor is inside this brace pair (strictly inside, not on the braces themselves)
    if (cursorGlobalPos > openGlobalPos && cursorGlobalPos <= closeGlobalPos) {
      const range = closeGlobalPos - openGlobalPos
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

const drawHighlightedLine = (
  ctx: CanvasRenderingContext2D,
  highlightedLine: HighlightedLine,
  x: number,
  y: number,
  lineIndex: number,
  inputState: InputState,
  highlightedCode: HighlightedLine[],
  padding: number,
  lineHeight: number,
) => {
  let currentX = x

  for (const token of highlightedLine.tokens) {
    ctx.fillStyle = getTokenColor(token.type)
    ctx.fillText(token.content, currentX, y)
    currentX += ctx.measureText(token.content).width
  }

  // Check for matching braces at cursor position
  const matchingBraces = findMatchingBrace(
    highlightedCode,
    inputState.caret.line,
    inputState.caret.column,
  )
  if (matchingBraces) {
    // Underline opening brace
    if (matchingBraces.line === lineIndex) {
      let braceX = padding
      for (let i = 0; i < matchingBraces.tokenIndex; i++) {
        braceX += ctx.measureText(highlightedCode[matchingBraces.line].tokens[i].content).width
      }

      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(braceX, y + 18)
      ctx.lineTo(braceX + ctx.measureText(matchingBraces.token.content).width, y + 18)
      ctx.stroke()
    }

    // Underline closing brace
    if (matchingBraces.matchingLine === lineIndex) {
      let braceX = padding
      for (let i = 0; i < matchingBraces.matchingTokenIndex; i++) {
        braceX += ctx.measureText(
          highlightedCode[matchingBraces.matchingLine].tokens[i].content,
        ).width
      }

      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(braceX, y + 18)
      ctx.lineTo(braceX + ctx.measureText(matchingBraces.matchingToken.content).width, y + 18)
      ctx.stroke()
    }
  }
}

export interface CanvasEditorCallbacks {
  onFunctionCallChange?: (callInfo: FunctionCallInfo | null) => void
  onPopupPositionChange?: (position: { x: number; y: number; showBelow: boolean }) => void
  onScrollChange?: (scrollX: number, scrollY: number) => void
  onScrollMetricsChange?: (metrics: {
    scrollX: number
    scrollY: number
    viewportWidth: number
    viewportHeight: number
    contentWidth: number
    contentHeight: number
  }) => void
}

export class CanvasEditor {
  private canvas: HTMLCanvasElement
  private container: HTMLElement
  private inputState: InputState
  private callbacks: CanvasEditorCallbacks
  private resizeHandler: (() => void) | null = null
  private wheelHandler: ((e: WheelEvent) => void) | null = null
  private lastFunctionCallInfo: FunctionCallInfo | null = null
  private lastPopupPosition: { x: number; y: number; showBelow: boolean } | null = null
  private highlightCache: { code: string; result: HighlightedLine[] } | null = null
  private resizeObserver: ResizeObserver | null = null
  private scrollX = 0
  private scrollY = 0
  private readonly padding = 16
  private readonly lineHeight = 20
  private isActive = false

  constructor(
    canvas: HTMLCanvasElement,
    container: HTMLElement,
    initialState: InputState,
    callbacks: CanvasEditorCallbacks = {},
  ) {
    this.canvas = canvas
    this.container = container
    this.inputState = initialState
    this.callbacks = callbacks

    this.updateCanvasSize()
    this.draw()
    this.setupResize()
    this.setupWheel()
  }

  public setActive(active: boolean) {
    if (this.isActive === active) return
    this.isActive = active
    this.draw()
    if (!this.isActive) {
      // Clear popup position when deactivating
      this.lastPopupPosition = null
      this.callbacks.onFunctionCallChange?.(null)
    } else {
      this.ensureCaretVisible()
      this.updateFunctionSignature()
    }
  }

  public updateState(newState: InputState) {
    this.inputState = newState
    if (this.isActive) this.ensureCaretVisible()
    this.draw()
    this.updateFunctionSignature()
  }

  public resize() {
    this.updateCanvasSize()
    if (this.isActive) this.ensureCaretVisible()
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
    if (this.resizeObserver) {
      this.resizeObserver.disconnect()
      this.resizeObserver = null
    }
  }

  public setScroll(x: number | null, y: number | null) {
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return
    ctx.font = '14px "JetBrains Mono", "Fira Code", "Consolas", monospace'

    const dpr = window.devicePixelRatio || 1
    const viewportWidth = this.canvas.width / dpr
    const viewportHeight = this.canvas.height / dpr
    const contentSize = this.getContentSize(ctx)
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
      this.draw()
      this.updateFunctionSignature()
    } else {
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
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return null
    ctx.font = '14px "JetBrains Mono", "Fira Code", "Consolas", monospace'

    const dpr = window.devicePixelRatio || 1
    const viewportWidth = this.canvas.width / dpr
    const viewportHeight = this.canvas.height / dpr
    const content = this.getContentSize(ctx)
    return {
      scrollX: this.scrollX,
      scrollY: this.scrollY,
      viewportWidth,
      viewportHeight,
      contentWidth: content.width,
      contentHeight: content.height,
    }
  }

  private setupResize() {
    let resizeTimeout: number | null = null

    const handleResize = () => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout)
      }

      resizeTimeout = setTimeout(() => {
        this.resize()
      }, 16) // ~60fps throttle
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
      e.preventDefault()

      const dpr = window.devicePixelRatio || 1
      const viewportWidth = this.canvas.width / dpr
      const viewportHeight = this.canvas.height / dpr

      const ctx = this.canvas.getContext('2d')
      if (!ctx) return
      ctx.font = '14px "JetBrains Mono", "Fira Code", "Consolas", monospace'

      const contentSize = this.getContentSize(ctx)

      // Natural scrolling: use deltaX/deltaY; shift can swap intent
      const deltaX = e.deltaX || (e.shiftKey ? e.deltaY : 0)
      const deltaY = e.deltaY

      const maxScrollX = Math.max(0, contentSize.width - viewportWidth)
      const maxScrollY = Math.max(0, contentSize.height - viewportHeight)

      const nextScrollX = Math.min(Math.max(this.scrollX + deltaX, 0), maxScrollX)
      const nextScrollY = Math.min(Math.max(this.scrollY + deltaY, 0), maxScrollY)

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
        this.draw()
        this.updateFunctionSignature()
      }
    }

    this.canvas.addEventListener('wheel', handleWheel, { passive: false })
    this.wheelHandler = handleWheel
  }

  private getContentSize(ctx: CanvasRenderingContext2D): { width: number; height: number } {
    let maxLineWidth = 0
    for (let i = 0; i < this.inputState.lines.length; i++) {
      const line = this.inputState.lines[i] || ''
      const w = ctx.measureText(line).width
      if (w > maxLineWidth) maxLineWidth = w
    }
    const width = this.padding + maxLineWidth + this.padding
    const height = this.padding + this.inputState.lines.length * this.lineHeight + this.padding
    return { width, height }
  }

  private publishScrollMetrics(
    ctx: CanvasRenderingContext2D,
    viewportWidth: number,
    viewportHeight: number,
    contentWidth: number,
    contentHeight: number,
  ) {
    this.callbacks.onScrollMetricsChange?.({
      scrollX: this.scrollX,
      scrollY: this.scrollY,
      viewportWidth,
      viewportHeight,
      contentWidth,
      contentHeight,
    })
  }

  private ensureCaretVisible() {
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return

    ctx.font = '14px "JetBrains Mono", "Fira Code", "Consolas", monospace'

    const dpr = window.devicePixelRatio || 1
    const viewportWidth = this.canvas.width / dpr
    const viewportHeight = this.canvas.height / dpr

    // Compute caret content-space coordinates
    const caretLine = this.inputState.lines[this.inputState.caret.line] || ''
    const caretText = caretLine.substring(0, this.inputState.caret.column)
    const caretX = this.padding + ctx.measureText(caretText).width
    const caretTop = this.padding + this.inputState.caret.line * this.lineHeight
    const caretBottom = caretTop + this.lineHeight

    // Margins so caret isn't flush to edge
    const margin = 16

    let nextScrollX = this.scrollX
    let nextScrollY = this.scrollY

    // Horizontal scrolling
    if (caretX < this.scrollX + margin) {
      nextScrollX = Math.max(0, caretX - margin)
    } else if (caretX > this.scrollX + viewportWidth - margin) {
      nextScrollX = caretX - (viewportWidth - margin)
    }

    // Vertical scrolling
    if (caretTop < this.scrollY + margin) {
      nextScrollY = Math.max(0, caretTop - margin)
    } else if (caretBottom > this.scrollY + viewportHeight - margin) {
      nextScrollY = caretBottom - (viewportHeight - margin)
    }

    // Clamp to content size
    const contentSize = this.getContentSize(ctx)
    const maxScrollX = Math.max(0, contentSize.width - viewportWidth)
    const maxScrollY = Math.max(0, contentSize.height - viewportHeight)

    nextScrollX = Math.min(Math.max(nextScrollX, 0), maxScrollX)
    nextScrollY = Math.min(Math.max(nextScrollY, 0), maxScrollY)

    if (nextScrollX !== this.scrollX || nextScrollY !== this.scrollY) {
      this.scrollX = nextScrollX
      this.scrollY = nextScrollY
      this.callbacks.onScrollChange?.(this.scrollX, this.scrollY)
    }
  }

  private updateCanvasSize() {
    const rect = this.container.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1

    const displayWidth = rect.width
    const displayHeight = rect.height
    const canvasWidth = Math.round(displayWidth * dpr)
    const canvasHeight = Math.round(displayHeight * dpr)

    // Check if size actually changed to avoid unnecessary operations
    if (this.canvas.width === canvasWidth && this.canvas.height === canvasHeight) {
      return // No size change, skip update
    }

    // Set display size to match container precisely
    this.canvas.style.width = `${displayWidth}px`
    this.canvas.style.height = `${displayHeight}px`

    // Set actual size in memory (scaled for DPR)
    this.canvas.width = canvasWidth
    this.canvas.height = canvasHeight

    // Scale the drawing context (reset first to avoid accumulation)
    const ctx = this.canvas.getContext('2d')
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
  }

  private draw() {
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return

    // Use canvas dimensions instead of getBoundingClientRect to avoid layout reflow
    const width = this.canvas.width / (window.devicePixelRatio || 1)
    const height = this.canvas.height / (window.devicePixelRatio || 1)

    // Cache syntax highlighting to avoid re-processing the same code
    const code = this.inputState.lines.join('\n')
    let highlightedCode: HighlightedLine[]

    if (this.highlightCache && this.highlightCache.code === code) {
      highlightedCode = this.highlightCache.result
    } else {
      highlightedCode = highlightCode(code, 'javascript')
      this.highlightCache = { code, result: highlightedCode }
    }

    // Configure text rendering
    ctx.font = '14px "JetBrains Mono", "Fira Code", "Consolas", monospace'
    ctx.textBaseline = 'top'

    // Clear canvas
    ctx.fillStyle = '#1f2937' // Dark background
    ctx.fillRect(0, 0, width, height)

    // Publish metrics for consumers
    const content = this.getContentSize(ctx)
    this.publishScrollMetrics(ctx, width, height, content.width, content.height)

    // Apply scroll offset for content rendering
    ctx.save()
    ctx.translate(-this.scrollX, -this.scrollY)

    // Draw selection background if exists
    if (this.inputState.selection) {
      ctx.fillStyle = '#e5e7eb'
      drawSelection(ctx, this.inputState, this.padding, this.lineHeight)
    }

    // Draw highlighted code
    highlightedCode.forEach((highlightedLine: HighlightedLine, index: number) => {
      const y = this.padding + index * this.lineHeight
      drawHighlightedLine(
        ctx,
        highlightedLine,
        this.padding,
        y,
        index,
        this.inputState,
        highlightedCode,
        this.padding,
        this.lineHeight,
      )
    })

    // Draw caret only if active
    if (this.isActive) {
      const caretY = this.padding + this.inputState.caret.line * this.lineHeight - 3
      const caretLine = this.inputState.lines[this.inputState.caret.line] || ''
      const caretText = caretLine.substring(0, this.inputState.caret.column)
      const caretX = this.padding + ctx.measureText(caretText).width

      ctx.fillStyle = '#ffffff'
      ctx.fillRect(caretX, caretY, 2, this.lineHeight - 2)
    }

    ctx.restore()
  }

  private updateFunctionSignature() {
    if (!this.isActive) return
    const callInfo = findFunctionCallContext(
      this.inputState.lines,
      this.inputState.caret.line,
      this.inputState.caret.column,
    )

    // Only update function call info if it actually changed
    const callInfoChanged = !this.areCallInfosEqual(this.lastFunctionCallInfo, callInfo)
    if (callInfoChanged) {
      this.lastFunctionCallInfo = callInfo
      this.callbacks.onFunctionCallChange?.(callInfo)
    }

    if (callInfo) {
      const ctx = this.canvas.getContext('2d')
      if (ctx) {
        ctx.font = '14px "JetBrains Mono", "Fira Code", "Consolas", monospace'
        const rect = this.canvas.getBoundingClientRect()
        const position = calculatePopupPosition(
          callInfo.openParenPosition,
          this.padding,
          this.lineHeight,
          ctx,
          this.inputState.lines,
          rect,
          120,
          this.scrollX,
          this.scrollY,
        )

        const newPopupPosition = {
          x: rect.left + position.x,
          y: rect.top + position.y,
          showBelow: position.showBelow,
        }

        // Only update popup position if it actually changed
        const positionChanged = !this.arePositionsEqual(this.lastPopupPosition, newPopupPosition)
        if (positionChanged) {
          this.lastPopupPosition = newPopupPosition
          this.callbacks.onPopupPositionChange?.(newPopupPosition)
        }
      }
    } else if (this.lastPopupPosition !== null) {
      // Clear popup position when there's no call info
      this.lastPopupPosition = null
    }
  }

  private areCallInfosEqual(a: FunctionCallInfo | null, b: FunctionCallInfo | null): boolean {
    if (a === null && b === null) return true
    if (a === null || b === null) return false

    return (
      a.functionName === b.functionName &&
      a.currentArgumentIndex === b.currentArgumentIndex &&
      a.openParenPosition.line === b.openParenPosition.line &&
      a.openParenPosition.column === b.openParenPosition.column
    )
  }

  private arePositionsEqual(
    a: { x: number; y: number; showBelow: boolean } | null,
    b: { x: number; y: number; showBelow: boolean } | null,
  ): boolean {
    if (a === null && b === null) return true
    if (a === null || b === null) return false

    return a.x === b.x && a.y === b.y && a.showBelow === b.showBelow
  }
}
