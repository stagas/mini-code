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
}

export class CanvasEditor {
  private canvas: HTMLCanvasElement
  private container: HTMLElement
  private inputState: InputState
  private callbacks: CanvasEditorCallbacks
  private resizeHandler: (() => void) | null = null
  private lastFunctionCallInfo: FunctionCallInfo | null = null
  private lastPopupPosition: { x: number; y: number; showBelow: boolean } | null = null
  private highlightCache: { code: string; result: HighlightedLine[] } | null = null
  private resizeObserver: ResizeObserver | null = null

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
  }

  public updateState(newState: InputState) {
    this.inputState = newState
    this.draw()
    this.updateFunctionSignature()
  }

  public resize() {
    this.updateCanvasSize()
    this.draw()
    this.updateFunctionSignature() // Need to update popup positions when canvas resizes
  }

  public destroy() {
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler)
      this.resizeHandler = null
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect()
      this.resizeObserver = null
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

    // Scale the drawing context
    const ctx = this.canvas.getContext('2d')
    if (ctx) {
      ctx.scale(dpr, dpr)
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
    ctx.fillStyle = '#e5e7eb' // Light gray text
    ctx.textBaseline = 'top'

    // Clear canvas
    ctx.fillStyle = '#1f2937' // Dark background
    ctx.fillRect(0, 0, width, height)

    // Draw each line of code
    const lineHeight = 20
    const padding = 16

    // Draw selection background if exists
    if (this.inputState.selection) {
      drawSelection(ctx, this.inputState, padding, lineHeight)
    }

    // Draw highlighted code
    highlightedCode.forEach((highlightedLine: HighlightedLine, index: number) => {
      const y = padding + index * lineHeight
      drawHighlightedLine(
        ctx,
        highlightedLine,
        padding,
        y,
        index,
        this.inputState,
        highlightedCode,
        padding,
        lineHeight,
      )
    })

    // Draw caret
    const caretY = padding + this.inputState.caret.line * lineHeight - 3
    const caretLine = this.inputState.lines[this.inputState.caret.line] || ''
    const caretText = caretLine.substring(0, this.inputState.caret.column)
    const caretX = padding + ctx.measureText(caretText).width

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(caretX, caretY, 2, lineHeight - 2)
  }

  private updateFunctionSignature() {
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
        const padding = 16
        const lineHeight = 20
        const rect = this.canvas.getBoundingClientRect()
        const position = calculatePopupPosition(
          callInfo.openParenPosition,
          padding,
          lineHeight,
          ctx,
          this.inputState.lines,
          rect,
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
