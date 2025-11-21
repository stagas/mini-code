import {
  type AutocompleteInfo,
  calculateAutocompletePosition,
  findCurrentWord,
  getAutocompleteSuggestions,
} from './autocomplete.ts'
import type { EditorError } from './ErrorPopup.tsx'
import {
  calculatePopupPosition,
  findFunctionCallContext,
  type FunctionCallInfo,
} from './function-signature.ts'
import type { InputState } from './input.ts'
import {
  defaultTheme,
  defaultTokenizer,
  getTokenColor,
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
          isOpening: false,
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
  /** Height in pixels */
  height: number
  /** Called to render the widget */
  render(canvasCtx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number): void
  /** Called when widget is clicked (x, y are canvas coordinates, offsetX, offsetY are relative to widget) */
  pointerDown?(x: number, y: number, offsetX: number, offsetY: number): void
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
}

interface WrappedLine {
  logicalLine: number
  text: string
  startColumn: number
  endColumn: number
}

export class CanvasEditor {
  private canvas: HTMLCanvasElement
  private container: HTMLElement
  private inputState: InputState
  private callbacks: CanvasEditorCallbacks
  private options: CanvasEditorOptions
  private resizeHandler: (() => void) | null = null
  private wheelHandler: ((e: WheelEvent) => void) | null = null
  private lastFunctionCallInfo: FunctionCallInfo | null = null
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
  private functionDefinitions: Record<string, any> = {}
  private highlightCache: { code: string; result: HighlightedLine[] } | null = null
  private resizeObserver: ResizeObserver | null = null
  private scrollX = 0
  private scrollY = 0
  private readonly padding = 16
  private readonly lineHeight = 20
  private isActive = false
  private autocompleteRaf: number | null = null
  private lastCaretContentX: number | null = null
  private lastCaretContentY: number | null = null
  private signatureEnabled = true
  private scrollbarWidth = 10
  private scrollMetrics = {
    viewportWidth: 0,
    viewportHeight: 0,
    contentWidth: 0,
    contentHeight: 0,
  }
  private hoveredScrollbar: 'vertical' | 'horizontal' | null = null
  private lastDpr = window.devicePixelRatio || 1
  private popupDimensions = { width: 400, height: 300 }
  private errors: EditorError[] = []
  private hoveredError: EditorError | null = null
  private isHoveringGutter: boolean = false
  private autoScrollRaf: number | null = null
  private autoScrollDirection: { x: number; y: number } | null = null
  private autoScrollLastTime: number | null = null
  private caretBlinkRaf: number | null = null
  private caretOpacity: number = 1
  private caretBlinkStartTime: number = 0
  private lastCaretActivityTime: number = 0
  private activeWidget: EditorWidget | null = null
  private isWidgetPointerDown = false
  private widgetPositions: Map<EditorWidget, { x: number; y: number; width: number; height: number }> = new Map()

  // Measurement caches for performance
  private measurementCache: {
    charWidth?: number
    ligatureArrowWidth?: number
    ligatureLineArrowWidth?: number
  } = {}
  private gutterWidthCache: number | null = null
  private textPaddingCache: number | null = null
  private lineWidthCache: Map<string, number> = new Map()

  private setFont(ctx: CanvasRenderingContext2D) {
    const theme = this.options.theme || defaultTheme
    ctx.font = theme.font
  }

  private invalidateMeasurementCaches() {
    this.measurementCache = {}
    this.gutterWidthCache = null
    this.textPaddingCache = null
    this.lineWidthCache.clear()
  }

  // Draw a custom right arrow for the ligature sequence "|>" with given color and width reservation
  private drawArrowLigature(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    color: string,
    reservedWidth: number,
  ) {
    // Draw an equilateral triangle (all sides equal) pointing right, centered vertically
    const side = reservedWidth
    const height = (Math.sqrt(3) / 2) * side
    const centerY = y + this.lineHeight / 2 - 3.5
    const centerX = x + reservedWidth

    // Calculate triangle vertices
    // Tip (rightmost point)
    const tipX = centerX + side / 2
    const tipY = centerY
    // Bottom left
    const blX = centerX - side / 2
    const blY = centerY + height / 2
    // Top left
    const tlX = centerX - side / 2
    const tlY = centerY - height / 2

    ctx.strokeStyle = color
    ctx.lineWidth = 1.25
    ctx.lineJoin = 'miter'
    ctx.beginPath()
    ctx.moveTo(tipX, tipY)
    ctx.lineTo(blX, blY)
    ctx.lineTo(tlX, tlY)
    ctx.closePath()
    ctx.stroke()
  }

  // Draw a line arrow for the ligature sequence "->" with given color and width reservation
  private drawLineArrowLigature(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    color: string,
    reservedWidth: number,
  ) {
    const centerY = y + this.lineHeight / 2 - 3.5
    const startX = x + reservedWidth * 0.15
    const endX = x + reservedWidth * 0.85

    ctx.strokeStyle = color
    ctx.lineWidth = 1.25

    // Shaft
    ctx.beginPath()
    ctx.moveTo(startX, centerY)
    ctx.lineTo(endX, centerY)
    ctx.stroke()

    // Arrowhead
    const head = Math.min(6, reservedWidth * 0.5)
    const upY = centerY - head * 0.6
    const downY = centerY + head * 0.6

    ctx.beginPath()
    ctx.moveTo(endX, centerY)
    ctx.lineTo(endX - head, upY)
    ctx.moveTo(endX, centerY)
    ctx.lineTo(endX - head, downY)
    ctx.stroke()
  }

  // Stream through tokens and render text replacing cross-token "|>" with a custom arrow
  private drawTokensWithCustomLigatures(
    ctx: CanvasRenderingContext2D,
    tokens: Token[],
    startX: number,
    y: number,
    theme: Theme,
  ): number {
    let currentX = startX
    let pendingSkipNextLeading = false

    for (let ti = 0; ti < tokens.length; ti++) {
      const token = tokens[ti]
      const color = getTokenColor(token.type, theme)
      const text = token.content

      // Determine start index, consume pending skip now and reset immediately
      let i = pendingSkipNextLeading ? 1 : 0
      pendingSkipNextLeading = false

      // Batch consecutive characters to reduce canvas API calls
      let batchStart = i
      let batchText = ''

      const flushBatch = () => {
        if (batchText) {
          ctx.fillStyle = color
          ctx.fillText(batchText, currentX, y)
          currentX += ctx.measureText(batchText).width
          batchText = ''
        }
      }

      for (; i < text.length; i++) {
        const ch = text[i]
        const nextCharInSame = i + 1 < text.length ? text[i + 1] : null
        const nextCharAcross = i + 1 >= text.length && ti + 1 < tokens.length ? tokens[ti + 1].content[0] : null

        if (ch === '|' && (nextCharInSame === '>' || nextCharAcross === '>')) {
          flushBatch()
          if (!this.measurementCache.ligatureArrowWidth) {
            this.measurementCache.ligatureArrowWidth = ctx.measureText('|>').width
          }
          const reserved = this.measurementCache.ligatureArrowWidth
          this.drawArrowLigature(ctx, currentX, y, color, reserved / 2)
          currentX += reserved

          if (nextCharInSame === '>') {
            i++
            batchStart = i + 1
            continue
          }

          pendingSkipNextLeading = true
          break
        }

        if (ch === '-' && (nextCharInSame === '>' || nextCharAcross === '>')) {
          flushBatch()
          if (!this.measurementCache.ligatureLineArrowWidth) {
            this.measurementCache.ligatureLineArrowWidth = ctx.measureText('->').width
          }
          const reserved = this.measurementCache.ligatureLineArrowWidth
          this.drawLineArrowLigature(ctx, currentX, y, color, reserved)
          currentX += reserved

          if (nextCharInSame === '>') {
            i++
            batchStart = i + 1
            continue
          }

          pendingSkipNextLeading = true
          break
        }

        batchText += ch
      }

      flushBatch()

      // If we finished the token without hitting a cross-token ligature, ensure no skip carries over
      // (pendingSkipNextLeading is already false unless we broke on a ligature)
    }

    return currentX
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
    this.setFont(ctx)

    if (!this.measurementCache.charWidth) {
      this.measurementCache.charWidth = ctx.measureText('0').width
    }

    // Calculate width needed for line numbers + some padding
    this.gutterWidthCache = maxLineNumber * this.measurementCache.charWidth + 2
    return this.gutterWidthCache
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
  } | null = null

  constructor(
    canvas: HTMLCanvasElement,
    container: HTMLElement,
    initialState: InputState,
    callbacks: CanvasEditorCallbacks = {},
    options: CanvasEditorOptions = {},
  ) {
    console.log('new editor')
    this.canvas = canvas
    this.container = container
    this.inputState = initialState
    this.callbacks = callbacks
    this.options = { tokenizer: defaultTokenizer, ...options }

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
      // Don't clear state when deactivating - just hide via rendering
      // This allows popups to reappear when reactivating without recalculation
      this.stopCaretBlink()
    }
    else {
      this.startCaretBlink()
      this.updateAutocomplete()
      this.updateFunctionSignature()
    }
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

    const viewportWidth = this.canvas.width / (window.devicePixelRatio || 1)
    const textPadding = this.getTextPadding()
    const maxWidth = Math.max(100, viewportWidth - textPadding - this.padding)

    // Check cache
    if (this.wrappedLinesCache) {
      const code = this.inputState.lines.join('\n')
      if (
        this.wrappedLinesCache.code === code
        && this.wrappedLinesCache.viewportWidth === viewportWidth
      ) {
        return this.wrappedLinesCache.result
      }
    }

    // Get syntax highlighting for token-aware wrapping
    const code = this.inputState.lines.join('\n')
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

    // Collect widget ranges per line (convert from 1-based to 0-based)
    const widgetRangesByLine = new Map<number, { start: number; end: number }[]>()
    if (this.options.widgets) {
      for (const widget of this.options.widgets) {
        const logicalLine = widget.line - 1
        const widgetColumn = widget.column - 1
        if (widget.length !== undefined && widget.length > 0) {
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

      let startColumn = 0
      while (startColumn < line.length) {
        // Try to fit as much as possible
        let endColumn = line.length
        let testText = line.substring(startColumn, endColumn)

        // If everything fits, use it all
        if (ctx.measureText(testText).width <= maxWidth) {
          wrappedLines.push({
            logicalLine: lineIndex,
            text: testText,
            startColumn,
            endColumn,
          })
          break
        }

        // Binary search to find the longest substring that fits
        let left = startColumn + 1
        let right = line.length
        let bestEnd = startColumn + 1

        while (left <= right) {
          const mid = Math.floor((left + right) / 2)
          testText = line.substring(startColumn, mid)

          if (ctx.measureText(testText).width <= maxWidth) {
            bestEnd = mid
            left = mid + 1
          }
          else {
            right = mid - 1
          }
        }

        // Try to break at better boundaries (in order of preference):
        // 1. Widget boundary (don't break within widget ranges)
        // 2. Token boundary
        // 3. Word boundary (space)
        // 4. Character boundary
        let finalEnd = bestEnd

        // Check if finalEnd would break a widget range
        // If so, move the break point to before the widget starts
        for (const range of widgetRanges) {
          // If the break point is within a widget range (would split it)
          if (finalEnd > range.start && finalEnd < range.end) {
            // Move break point to before the widget
            if (range.start > startColumn) {
              finalEnd = range.start
            }
            else {
              // Widget starts at or before startColumn, we can't break it
              // Force include the entire widget
              finalEnd = range.end
            }
          }
        }

        // Find token boundaries within the segment
        let currentColumn = 0
        let lastTokenBoundary = -1
        let lastSpaceBoundary = -1

        for (const token of tokens) {
          const tokenStart = currentColumn
          const tokenEnd = currentColumn + token.content.length

          // Check if this token boundary is before our bestEnd and after startColumn
          if (tokenEnd <= bestEnd && tokenEnd > startColumn) {
            lastTokenBoundary = tokenEnd
          }

          // Look for spaces within this token if it overlaps our segment
          if (tokenStart < bestEnd && tokenEnd > startColumn) {
            const overlapStart = Math.max(tokenStart, startColumn)
            const overlapEnd = Math.min(tokenEnd, bestEnd)
            const segmentWithinToken = token.content.substring(
              overlapStart - tokenStart,
              overlapEnd - tokenStart,
            )
            const lastSpace = segmentWithinToken.lastIndexOf(' ')
            if (lastSpace >= 0) {
              lastSpaceBoundary = overlapStart + lastSpace + 1
            }
          }

          currentColumn = tokenEnd
        }

        // Prefer token boundary if close enough to bestEnd (within 20% of maxWidth)
        // But only if it doesn't conflict with widget boundaries
        const tokenBoundaryDistance = lastTokenBoundary > 0 ? bestEnd - lastTokenBoundary : Infinity
        const spaceBoundaryDistance = lastSpaceBoundary > 0 ? bestEnd - lastSpaceBoundary : Infinity

        let candidateEnd = finalEnd
        if (
          lastTokenBoundary > startColumn
          && tokenBoundaryDistance < maxWidth * 0.2
          && bestEnd < line.length
        ) {
          candidateEnd = lastTokenBoundary
        }
        else if (lastSpaceBoundary > startColumn && bestEnd < line.length) {
          candidateEnd = lastSpaceBoundary
        }
        else {
          candidateEnd = bestEnd
        }

        // Verify candidate doesn't break widget ranges
        let candidateBreaksWidget = false
        for (const range of widgetRanges) {
          if (candidateEnd > range.start && candidateEnd < range.end) {
            candidateBreaksWidget = true
            break
          }
        }

        if (!candidateBreaksWidget) {
          finalEnd = candidateEnd
        }

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
      code: this.inputState.lines.join('\n'),
      viewportWidth,
      result: wrappedLines,
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
    const width = textPadding + maxLineWidth + this.padding

    // Calculate base height
    let height = this.padding + wrappedLines.length * this.lineHeight + this.padding

    // Add extra height for widgets
    const widgetLayout = this.calculateWidgetLayout(ctx, wrappedLines)
    const lastOffset = widgetLayout.yOffsets.get(wrappedLines.length - 1) || 0
    height += lastOffset

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
        aboveHeight = Math.max(...widgets.above.map(w => w.height))
      }
      return this.padding + visualLine * this.lineHeight + yOffset + aboveHeight + (isFirstLine ? 1 : 0) - 2
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
      startAboveHeight = Math.max(...startWidgets.above.map(w => w.height))
    }
    let endAboveHeight = 0
    let endBelowHeight = 0
    const endWidgets = widgetsByVisualLine.get(endVisual.visualLine)
    if (endWidgets?.above && endWidgets.above.length > 0) {
      endAboveHeight = Math.max(...endWidgets.above.map(w => w.height))
    }
    if (endWidgets?.below && endWidgets.below.length > 0) {
      endBelowHeight = Math.max(...endWidgets.below.map(w => w.height))
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
        selectedWidth += selectionPadding

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
          aboveHeight = Math.max(...widgets.above.map(w => w.height))
        }
        return this.padding + visualLine * this.lineHeight + yOffset + aboveHeight
      }

      const getLineBottomY = (visualLine: number) => {
        const yOffset = yOffsets.get(visualLine) || 0
        let aboveHeight = 0
        let belowHeight = 0
        const widgets = widgetsByVisualLine.get(visualLine)
        if (widgets?.above && widgets.above.length > 0) {
          aboveHeight = Math.max(...widgets.above.map(w => w.height))
        }
        if (widgets?.below && widgets.below.length > 0) {
          belowHeight = Math.max(...widgets.below.map(w => w.height))
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
          selectedWidth += selectionPadding

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
          selectedWidth += selectionPadding

          ctx.fillRect(textPadding, y, selectedWidth, selectionHeight)
        }
        else {
          // Middle visual lines: entire visual line
          let selectedWidth = ctx.measureText(wrappedLine.text).width

          // Account for all inline widgets on this line
          for (const { widget } of inlineWidgetsForLine) {
            selectedWidth += ctx.measureText('X'.repeat(widget.length)).width
          }
          selectedWidth += selectionPadding

          ctx.fillRect(textPadding, y, selectedWidth, selectionHeight)
        }
      }
    }
  }

  private extractTokensForSegment(
    tokens: Token[],
    startColumn: number,
    endColumn: number,
  ): Token[] {
    const result: Token[] = []
    let currentColumn = 0

    for (const token of tokens) {
      const tokenStart = currentColumn
      const tokenEnd = currentColumn + token.content.length

      if (tokenEnd <= startColumn) {
        // Token is completely before our segment
        currentColumn = tokenEnd
        continue
      }

      if (tokenStart >= endColumn) {
        // Token is completely after our segment
        break
      }

      // Token intersects with our segment
      const segmentStart = Math.max(startColumn, tokenStart)
      const segmentEnd = Math.min(endColumn, tokenEnd)
      const segmentContent = token.content.substring(
        segmentStart - tokenStart,
        segmentEnd - tokenStart,
      )

      if (segmentContent.length > 0) {
        result.push({
          type: token.type,
          content: segmentContent,
          length: segmentContent.length,
        })
      }

      currentColumn = tokenEnd
    }

    return result
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

    // Calculate new maximum scroll values
    const maxScrollX = Math.max(0, contentSize.width - newWidth)
    const maxScrollY = Math.max(0, contentSize.height - newHeight)

    // Adjust horizontal scroll to keep content visible
    if (newWidth < oldWidth) {
      // Canvas got narrower - adjust scroll to keep right edge visible
      const rightEdge = this.scrollX + oldWidth
      if (rightEdge > newWidth) {
        this.scrollX = Math.max(0, rightEdge - newWidth)
      }
    }

    // Adjust vertical scroll to keep content visible
    if (newHeight < oldHeight) {
      // Canvas got shorter - adjust scroll to keep bottom edge visible
      const bottomEdge = this.scrollY + oldHeight
      if (bottomEdge > newHeight) {
        this.scrollY = Math.max(0, bottomEdge - newHeight)
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

    // Adjust for scroll offset
    const adjustedY = y + this.scrollY
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

    // Move to start of current wrapped line segment
    const wrapped = wrappedLines[currentVisual.visualLine]
    const logical = this.visualToLogicalPosition(currentVisual.visualLine, 0, wrappedLines)

    return {
      line: logical.logicalLine,
      column: logical.logicalColumn,
      columnIntent: logical.logicalColumn,
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

  private adjustWidgetsOptimistically(oldState: InputState, newState: InputState) {
    if (!this.options.widgets || this.options.widgets.length === 0) return

    const oldLines = oldState.lines
    const newLines = newState.lines
    const oldCaret = oldState.caret
    const newCaret = newState.caret

    // Detect line insertion (newline inserted)
    if (newLines.length > oldLines.length) {
      // When a newline is inserted, the caret moves to the new line
      // oldCaret.line (0-based) is where the line was split
      // newCaret.line (0-based) is the new line
      // Widgets at newCaret.line + 1 (1-based) and below should move down
      const insertLine1Based = newCaret.line + 1
      for (const widget of this.options.widgets) {
        if (widget.line >= insertLine1Based) {
          widget.line++
        }
      }
      return
    }

    // Detect line deletion (line merged with previous)
    if (newLines.length < oldLines.length) {
      // When a line is deleted (merged), the caret typically moves to the previous line
      // oldCaret.line (0-based) is the line that was deleted
      // Widgets at oldCaret.line + 1 (1-based) and below should move up
      const deleteLine1Based = oldCaret.line + 1
      for (const widget of this.options.widgets) {
        if (widget.line > deleteLine1Based) {
          widget.line--
        }
      }
      return
    }

    // Detect character insertion/deletion on a line
    if (oldLines.length === newLines.length) {
      const caretLine = newCaret.line
      if (caretLine >= 0 && caretLine < oldLines.length && caretLine < newLines.length) {
        const oldLine = oldLines[caretLine]
        const newLine = newLines[caretLine]
        const oldCol = oldCaret.column
        const newCol = newCaret.column

        // Character inserted: line got longer and caret moved forward
        if (newLine.length > oldLine.length && newCol > oldCol) {
          // oldCol is 0-based, widgets are 1-based
          // Insert at oldCol means widgets at column > oldCol (0-based) = column >= oldCol + 1 (1-based) should move
          const insertCol1Based = oldCol + 1
          for (const widget of this.options.widgets) {
            if (widget.line === caretLine + 1 && widget.column >= insertCol1Based) {
              widget.column++
            }
          }
        }
        // Character deleted: line got shorter
        else if (newLine.length < oldLine.length) {
          // newCol is 0-based, widgets are 1-based
          // Delete at newCol means widgets at column > newCol (0-based) = column > newCol + 1 (1-based) should move
          const deleteCol1Based = newCol + 1
          for (const widget of this.options.widgets) {
            if (widget.line === caretLine + 1 && widget.column > deleteCol1Based) {
              widget.column--
            }
          }
        }
      }
    }
  }

  public updateState(newState: InputState, ensureCaretVisible = false) {
    // Invalidate wrapped lines cache if lines changed
    const linesChanged = this.inputState.lines !== newState.lines

    // Track caret position change before updating state
    const caretChanged = this.inputState.caret.line !== newState.caret.line
      || this.inputState.caret.column !== newState.caret.column

    // Optimistically adjust widget positions before updating state
    if (linesChanged || caretChanged) {
      this.adjustWidgetsOptimistically(this.inputState, newState)
    }

    // Track if we were at the bottom before update (must check before invalidating cache)
    const ctx = this.canvas.getContext('2d')
    let wasAtBottom = false
    if (ctx && linesChanged && this.isActive) {
      this.setFont(ctx)
      const oldContentSize = this.options.wordWrap
        ? this.getContentSizeWithWrapping(ctx, this.getWrappedLines(ctx))
        : this.getContentSize(ctx)
      const dpr = window.devicePixelRatio || 1
      const viewportHeight = this.canvas.height / dpr
      const maxScrollY = Math.max(0, oldContentSize.height - viewportHeight)
      wasAtBottom = this.scrollY >= maxScrollY - 1 // Allow 1px tolerance
    }

    if (linesChanged) {
      this.wrappedLinesCache = null
      this.invalidateMeasurementCaches()
    }

    this.inputState = newState
    // Reset caret activity time on input/movement (caret becomes visible when active)
    if (this.isActive && caretChanged) {
      this.lastCaretActivityTime = performance.now()
      this.caretOpacity = 1
    }
    if (this.isActive && ensureCaretVisible) this.ensureCaretVisible(wasAtBottom)
    this.draw()
    this.updateAutocomplete()
    this.updateFunctionSignature()
  }

  public resize() {
    // Invalidate wrapped lines cache on resize
    this.wrappedLinesCache = null
    this.invalidateMeasurementCaches()

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
    if (this.resizeObserver) {
      this.resizeObserver.disconnect()
      this.resizeObserver = null
    }
    if (this.autocompleteRaf !== null) {
      cancelAnimationFrame(this.autocompleteRaf)
      this.autocompleteRaf = null
    }
    this.stopAutoScroll()
    this.stopCaretBlink()
  }

  public setScroll(x: number | null, y: number | null) {
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return
    this.setFont(ctx)

    const dpr = window.devicePixelRatio || 1
    const viewportWidth = this.canvas.width / dpr
    const viewportHeight = this.canvas.height / dpr
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
      this.draw()
      this.updateFunctionSignature()
      this.updateAutocomplete()
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
    const viewportHeight = this.canvas.height / dpr
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
        // Normal resize - throttle
        if (resizeTimeout) {
          clearTimeout(resizeTimeout)
        }
        resizeTimeout = setTimeout(() => {
          this.resize()
        }, 16) // ~60fps throttle
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
      const viewportHeight = this.canvas.height / dpr

      const ctx = this.canvas.getContext('2d')
      if (!ctx) return
      this.setFont(ctx)

      const contentSize = this.options.wordWrap
        ? this.getContentSizeWithWrapping(ctx, this.getWrappedLines(ctx))
        : this.getContentSize(ctx)

      // Natural scrolling: use deltaX/deltaY; shift can swap intent
      const effectiveDeltaX = e.deltaX || (e.shiftKey ? e.deltaY : 0)
      const effectiveDeltaY = e.shiftKey ? 0 : e.deltaY

      const maxScrollX = Math.max(0, contentSize.width - viewportWidth)
      const maxScrollY = Math.max(0, contentSize.height - viewportHeight)

      // If nothing is scrollable, allow page to handle it
      if (maxScrollX === 0 && maxScrollY === 0) {
        return
      }

      // Determine dominant intent and only prevent default if that axis can scroll
      const absX = Math.abs(e.deltaX)
      const absY = Math.abs(e.deltaY)
      const horizontalIntent = (e.shiftKey && absY > 0 && absX === 0) || absX > absY
      // Treat very small remaining scroll room as non-scrollable to avoid trapping the page
      const epsilon = 1
      const canScrollHorizontally = effectiveDeltaX !== 0 && maxScrollX > epsilon
      const canScrollVertically = effectiveDeltaY !== 0 && maxScrollY > epsilon

      // Check if we can actually scroll in the direction we're trying to scroll
      const canScrollXInDirection = canScrollHorizontally
        && ((effectiveDeltaX > 0 && this.scrollX < maxScrollX)
          || (effectiveDeltaX < 0 && this.scrollX > 0))
      const canScrollYInDirection = canScrollVertically
        && ((effectiveDeltaY > 0 && this.scrollY < maxScrollY)
          || (effectiveDeltaY < 0 && this.scrollY > 0))

      const shouldPrevent = horizontalIntent ? canScrollXInDirection : canScrollYInDirection
      if (!shouldPrevent) {
        return
      }

      e.preventDefault()

      const nextScrollX = Math.min(Math.max(this.scrollX + effectiveDeltaX, 0), maxScrollX)
      const nextScrollY = Math.min(Math.max(this.scrollY + effectiveDeltaY, 0), maxScrollY)

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
        this.updateAutocomplete()
      }
    }

    this.canvas.addEventListener('wheel', handleWheel, { passive: false })
    this.wheelHandler = handleWheel
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
    const lastOffset = widgetLayout.yOffsets.get(wrappedLines.length - 1) || 0
    height += lastOffset

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

    this.scrollMetrics = { viewportWidth, viewportHeight, contentWidth, contentHeight }

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

  private ensureCaretVisible(wasAtBottom = false) {
    if (this.isWidgetPointerDown) return
    // return
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return

    this.setFont(ctx)

    const dpr = window.devicePixelRatio || 1
    const viewportWidth = this.canvas.width / dpr
    const viewportHeight = this.canvas.height / dpr

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
          aboveHeight = Math.max(...widgets.above.map(w => w.height))
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
        aboveHeight = Math.max(...widgets.above.map(w => w.height))
      }
      caretTop = this.padding + this.inputState.caret.line * this.lineHeight + yOffset + aboveHeight
      caretBottom = caretTop + this.lineHeight

      contentSize = this.getContentSize(ctx)
    }

    // Margins so caret isn't flush to edge
    const margin = 16

    // Check if caret is already fully visible
    const caretVisibleX = caretX >= this.scrollX + margin && caretX <= this.scrollX + viewportWidth - margin
    const caretVisibleY = caretTop >= this.scrollY + margin && caretBottom <= this.scrollY + viewportHeight - margin

    // If we were at the bottom and caret is on the last line, maintain bottom scroll
    const isLastLine = this.inputState.caret.line === this.inputState.lines.length - 1
    if (wasAtBottom && isLastLine) {
      const maxScrollY = Math.max(0, contentSize.height - viewportHeight)
      if (this.scrollY < maxScrollY) {
        this.scrollY = maxScrollY
        queueMicrotask(() => {
          this.callbacks.onScrollChange?.(this.scrollX, this.scrollY)
        })
      }
      return
    }

    // If caret is already fully visible, don't change scroll position
    if (caretVisibleX && caretVisibleY) {
      return
    }

    let nextScrollX = this.scrollX
    let nextScrollY = this.scrollY

    // Horizontal scrolling
    if (!caretVisibleX) {
      if (caretX < this.scrollX + margin) {
        nextScrollX = Math.max(0, caretX - margin)
      }
      else if (caretX > this.scrollX + viewportWidth - margin) {
        nextScrollX = caretX - (viewportWidth - margin)
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
    const maxScrollX = Math.max(0, contentSize.width - viewportWidth)
    const maxScrollY = Math.max(0, contentSize.height - viewportHeight)

    nextScrollX = Math.min(Math.max(nextScrollX, 0), maxScrollX)
    nextScrollY = Math.min(Math.max(nextScrollY, 0), maxScrollY)

    if (nextScrollX !== this.scrollX || nextScrollY !== this.scrollY) {
      this.scrollX = nextScrollX
      this.scrollY = nextScrollY
      queueMicrotask(() => {
        this.callbacks.onScrollChange?.(this.scrollX, this.scrollY)
      })
    }
  }

  public updateAutoScroll(windowX: number, windowY: number) {
    const rect = this.canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const viewportWidth = this.canvas.width / dpr
    const viewportHeight = this.canvas.height / dpr

    // Convert window coordinates to canvas-relative coordinates
    const canvasX = windowX - rect.left
    const canvasY = windowY - rect.top

    const boundaryZone = 20
    let scrollX = 0
    let scrollY = 0

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
    if (this.autoScrollRaf !== null) {
      cancelAnimationFrame(this.autoScrollRaf)
      this.autoScrollRaf = null
    }
    this.autoScrollDirection = null
    this.autoScrollLastTime = null
  }

  private startAutoScroll() {
    if (this.autoScrollRaf !== null) {
      cancelAnimationFrame(this.autoScrollRaf)
    }

    this.autoScrollLastTime = performance.now()

    const scroll = (currentTime: number) => {
      if (!this.autoScrollDirection) {
        this.autoScrollRaf = null
        this.autoScrollLastTime = null
        return
      }

      const dpr = window.devicePixelRatio || 1
      const viewportWidth = this.canvas.width / dpr
      const viewportHeight = this.canvas.height / dpr

      const ctx = this.canvas.getContext('2d')
      if (!ctx) {
        this.autoScrollRaf = null
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
        this.draw()
        this.updateFunctionSignature()
        this.updateAutocomplete()
      }

      if (this.autoScrollDirection) {
        this.autoScrollRaf = requestAnimationFrame(scroll)
      }
      else {
        this.autoScrollRaf = null
        this.autoScrollLastTime = null
      }
    }

    this.autoScrollRaf = requestAnimationFrame(scroll)
  }

  private startCaretBlink() {
    if (this.caretBlinkRaf !== null) return
    this.caretBlinkStartTime = performance.now()
    this.lastCaretActivityTime = performance.now()
    this.caretOpacity = 1

    const blink = () => {
      if (!this.isActive) {
        this.caretBlinkRaf = null
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

      this.draw()
      this.caretBlinkRaf = requestAnimationFrame(blink)
    }

    this.caretBlinkRaf = requestAnimationFrame(blink)
  }

  private stopCaretBlink() {
    if (this.caretBlinkRaf !== null) {
      cancelAnimationFrame(this.caretBlinkRaf)
      this.caretBlinkRaf = null
    }
    this.caretOpacity = 1
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
        aboveHeight = Math.max(...widgets.above.map(w => w.height))
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
        if (
          widgetColumn >= wrappedLine.startColumn
          && widgetColumn < wrappedLine.endColumn
        ) {
          targetVisualLine = visualIndex
          break
        }
      }
      // If widget column is at the exact end of a line, place it on that line
      if (targetVisualLine === visualLines[visualLines.length - 1]) {
        const lastWrappedLine = wrappedLines[targetVisualLine]
        if (widgetColumn === lastWrappedLine.endColumn && lastWrappedLine.endColumn > lastWrappedLine.startColumn) {
          // Widget is at the end of the line, keep it there
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

    // Calculate cumulative y offsets for each visual line
    // yOffset[N] represents the cumulative vertical space added by all widgets before line N
    let cumulativeOffset = 0
    for (let visualIndex = 0; visualIndex < wrappedLines.length; visualIndex++) {
      // Set offset for this line (before adding this line's widgets)
      yOffsets.set(visualIndex, cumulativeOffset)

      const widgets = widgetsByVisualLine.get(visualIndex)
      if (widgets) {
        // Add max height of 'above' widgets for this line (they are in the same row)
        if (widgets.above.length > 0) {
          const maxAboveHeight = Math.max(...widgets.above.map(w => w.height))
          cumulativeOffset += maxAboveHeight
        }
        // Add max height of 'below' widgets for this line (they are in the same row)
        if (widgets.below.length > 0) {
          const maxBelowHeight = Math.max(...widgets.below.map(w => w.height))
          cumulativeOffset += maxBelowHeight
        }
      }

      // Add height for inline widgets (if they exceed line height)
      const inline = inlineWidgets.get(visualIndex)
      if (inline && inline.length > 0) {
        const maxHeight = Math.max(...inline.map(w => w.widget.height))
        if (maxHeight > this.lineHeight) {
          cumulativeOffset += maxHeight - this.lineHeight
        }
      }
    }

    return { widgetsByVisualLine, inlineWidgets, overlayWidgets, yOffsets }
  }

  private draw() {
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return

    // Use canvas dimensions instead of getBoundingClientRect to avoid layout reflow
    const width = this.canvas.width / (window.devicePixelRatio || 1)
    const height = this.canvas.height / (window.devicePixelRatio || 1)

    // Configure text rendering
    this.setFont(ctx)
    ctx.textBaseline = 'top'

    // Get wrapped lines
    const wrappedLines = this.getWrappedLines(ctx)

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

    // Publish metrics for consumers
    const content = this.getContentSizeWithWrapping(ctx, wrappedLines)
    this.publishScrollMetrics(ctx, width, height, content.width, content.height)

    // Clamp scroll position to content bounds before drawing
    const maxScrollX = Math.max(0, content.width - width)
    const maxScrollY = Math.max(0, content.height - height)
    const clampedScrollX = Math.min(Math.max(this.scrollX, 0), maxScrollX)
    const clampedScrollY = Math.min(Math.max(this.scrollY, 0), maxScrollY)

    if (clampedScrollX !== this.scrollX || clampedScrollY !== this.scrollY) {
      this.scrollX = clampedScrollX
      this.scrollY = clampedScrollY
      this.callbacks.onScrollChange?.(this.scrollX, this.scrollY)
    }

    // Draw gutter if enabled (before scroll transform so it stays fixed)
    if (this.options.gutter) {
      const gutterWidth = this.getGutterWidth()
      ctx.fillStyle = theme.gutterBackground
      // Extend gutter to full canvas height, not just content height
      ctx.fillRect(0, 0, this.padding + gutterWidth, height)

      // Draw gutter separator line
      ctx.strokeStyle = theme.gutterBorder
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(this.padding + gutterWidth - 1, 0)
      ctx.lineTo(this.padding + gutterWidth - 1, height)
      ctx.stroke()
    }

    // Apply scroll offset for content rendering
    ctx.save()
    ctx.translate(-this.scrollX, -this.scrollY)

    // Calculate widget layout once for all drawing operations
    const widgetLayout = this.calculateWidgetLayout(ctx, wrappedLines)
    this.widgetPositions.clear()

    // Draw selection background if exists
    if (this.inputState.selection) {
      ctx.fillStyle = theme.selection
      this.drawSelectionWithWrapping(
        ctx,
        this.inputState,
        wrappedLines,
        this.scrollY,
        height,
        widgetLayout.yOffsets,
        widgetLayout.widgetsByVisualLine,
        widgetLayout.inlineWidgets,
      )
    }

    // Draw wrapped lines
    const textPadding = this.getTextPadding()

    // Calculate visible line range for viewport culling
    const visibleStartY = this.scrollY
    const visibleEndY = this.scrollY + height

    // Draw overlay widgets behind text (no pointer events, truly behind)
    for (const widget of widgetLayout.overlayWidgets) {
      // Find the visual line for this widget (convert from 1-based to 0-based)
      const visualPos = this.logicalToVisualPosition(widget.line - 1, widget.column - 1, wrappedLines)
      const wrappedLine = wrappedLines[visualPos.visualLine]
      if (wrappedLine) {
        const yOffset = widgetLayout.yOffsets.get(visualPos.visualLine) || 0
        // Add max height of 'above' widgets on this line (they are in the same row)
        let aboveHeight = 0
        const widgets = widgetLayout.widgetsByVisualLine.get(visualPos.visualLine)
        if (widgets?.above && widgets.above.length > 0) {
          aboveHeight = Math.max(...widgets.above.map(w => w.height))
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

        if (widgetY + widget.height >= visibleStartY && widgetY <= visibleEndY) {
          widget.render(ctx, widgetX, widgetY - 2, widgetWidth, widget.height)
        }
      }
    }

    // Build a Set of error line numbers for faster lookups
    const errorLineSet = new Set(this.errors.map(e => e.line))

    // Cache brace matching result once for all lines
    const matchingBraces = this.isActive
      ? findMatchingBrace(highlightedCode, this.inputState.caret.line, this.inputState.caret.column)
      : null

    wrappedLines.forEach((wrappedLine: WrappedLine, visualIndex: number) => {
      const yOffset = widgetLayout.yOffsets.get(visualIndex) || 0
      let y = this.padding + visualIndex * this.lineHeight + yOffset - 1.5

      // Draw 'above' widgets before the line
      const widgets = widgetLayout.widgetsByVisualLine.get(visualIndex)
      if (widgets?.above && widgets.above.length > 0) {
        // All 'above' widgets on the same line share the same Y position (horizontal row)
        const widgetY = y
        const maxAboveHeight = Math.max(...widgets.above.map(w => w.height))
        for (const widget of widgets.above) {
          // Calculate position based on widget's column (convert from 1-based to 0-based)
          const widgetColumn = widget.column - 1
          const columnInWrappedLine = widgetColumn - wrappedLine.startColumn
          const textBeforeWidget = wrappedLine.text.substring(0, Math.max(0, columnInWrappedLine))
          const widgetX = textPadding + ctx.measureText(textBeforeWidget).width
          // Calculate width based on widget's length
          const widgetWidth = ctx.measureText('X'.repeat(widget.length)).width
          this.widgetPositions.set(widget, {
            x: widgetX,
            y: widgetY,
            width: widgetWidth,
            height: widget.height,
          })
          if (widgetY + widget.height >= visibleStartY && widgetY <= visibleEndY) {
            widget.render(ctx, widgetX, widgetY, widgetWidth, widget.height)
          }
        }
        // Advance y by the maximum height among all above widgets
        y += maxAboveHeight
      }

      // Skip lines outside the visible viewport
      if (y + this.lineHeight < visibleStartY || y > visibleEndY) {
        return
      }

      // Draw line number in gutter if enabled
      if (this.options.gutter) {
        const lineNumber = wrappedLine.logicalLine + 1
        // Only show line number on the first visual line for each logical line
        const isFirstVisualLine = visualIndex === 0
          || (visualIndex > 0 && wrappedLines[visualIndex - 1].logicalLine !== wrappedLine.logicalLine)

        if (isFirstVisualLine) {
          const gutterWidth = this.getGutterWidth()
          const hasErrorOnLine = errorLineSet.has(wrappedLine.logicalLine)

          if (hasErrorOnLine) {
            // Draw red background strip for the line's gutter area
            ctx.fillStyle = theme.errorGutterColor
            ctx.fillRect(0, y - 3, this.padding + gutterWidth - 1, this.lineHeight - 2)
          }

          // Draw the line number on top
          ctx.fillStyle = hasErrorOnLine ? '#ffffff' : theme.gutterText
          ctx.textAlign = 'right'
          ctx.fillText(lineNumber.toString(), this.padding + gutterWidth - 8, y)
          ctx.textAlign = 'left' // Reset text alignment
        }
      }

      // Get inline widgets for this line
      const inlineWidgetsForLine = widgetLayout.inlineWidgets.get(visualIndex) || []

      // Get syntax highlighting for this logical line
      const logicalHighlighted = highlightedCode[wrappedLine.logicalLine]
      if (logicalHighlighted) {
        // Extract tokens for this wrapped segment
        const segmentTokens = this.extractTokensForSegment(
          logicalHighlighted.tokens,
          wrappedLine.startColumn,
          wrappedLine.endColumn,
        )

        // Draw tokens and inline widgets together
        let currentX = textPadding
        const columnInWrappedLine = (col: number) => col - wrappedLine.startColumn

        // Sort inline widgets by column
        const sortedInlineWidgets = [...inlineWidgetsForLine].sort((a, b) => a.column - b.column)

        let tokenIndex = 0
        let tokenOffset = 0 // offset within current token

        for (const { widget, column } of sortedInlineWidgets) {
          const targetColumn = columnInWrappedLine(column)

          // Draw tokens up to widget
          let accumulatedLength = 0
          while (tokenIndex < segmentTokens.length
            && accumulatedLength + segmentTokens[tokenIndex].length - tokenOffset <= targetColumn)
          {
            const token = segmentTokens[tokenIndex]
            const remainingContent = token.content.substring(tokenOffset)
            currentX = this.drawTokensWithCustomLigatures(
              ctx,
              [{ ...token, content: remainingContent, length: remainingContent.length }],
              currentX,
              y,
              theme,
            )
            accumulatedLength += token.length - tokenOffset
            tokenIndex++
            tokenOffset = 0
          }

          // If widget is in the middle of a token, draw partial token
          if (tokenIndex < segmentTokens.length && accumulatedLength < targetColumn) {
            const token = segmentTokens[tokenIndex]
            const charsNeeded = targetColumn - accumulatedLength
            const partialContent = token.content.substring(tokenOffset, tokenOffset + charsNeeded)
            currentX = this.drawTokensWithCustomLigatures(
              ctx,
              [{ ...token, content: partialContent, length: partialContent.length }],
              currentX,
              y,
              theme,
            )
            tokenOffset += charsNeeded
            accumulatedLength += charsNeeded
          }

          // Draw widget
          const widgetX = currentX
          const widgetY = y - 0.5
          const widgetWidth = ctx.measureText('X'.repeat(widget.length)).width
          this.widgetPositions.set(widget, {
            x: widgetX,
            y: widgetY,
            width: widgetWidth,
            height: widget.height,
          })
          if (widgetY + widget.height >= visibleStartY && widgetY <= visibleEndY) {
            widget.render(ctx, widgetX, widgetY, widgetWidth, widget.height)
          }
          currentX += widgetWidth
        }

        // Draw remaining tokens after last widget
        while (tokenIndex < segmentTokens.length) {
          const token = segmentTokens[tokenIndex]
          const remainingContent = token.content.substring(tokenOffset)
          currentX = this.drawTokensWithCustomLigatures(
            ctx,
            [{ ...token, content: remainingContent, length: remainingContent.length }],
            currentX,
            y,
            theme,
          )
          tokenIndex++
          tokenOffset = 0
        }

        // Draw brace matching for any line that might contain braces (only when active)
        if (matchingBraces) {
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
      }
      else {
        // Fallback: draw plain text with inline widgets
        let currentX = textPadding
        const sortedInlineWidgets = [...inlineWidgetsForLine].sort((a, b) => a.column - b.column)

        let lastColumn = 0
        for (const { widget, column } of sortedInlineWidgets) {
          const columnInWrappedLine = column - wrappedLine.startColumn

          // Draw text before widget
          if (columnInWrappedLine > lastColumn) {
            const textSegment = wrappedLine.text.substring(lastColumn, columnInWrappedLine)
            currentX = this.drawTokensWithCustomLigatures(
              ctx,
              [{ type: 'plain', content: textSegment, length: textSegment.length }],
              currentX,
              y,
              theme,
            )
          }

          // Draw widget
          const widgetX = currentX
          const widgetY = y - 0.5
          const widgetWidth = ctx.measureText('X'.repeat(widget.length)).width
          this.widgetPositions.set(widget, {
            x: widgetX,
            y: widgetY,
            width: widgetWidth,
            height: widget.height,
          })
          if (widgetY + widget.height >= visibleStartY && widgetY <= visibleEndY) {
            widget.render(ctx, widgetX, widgetY, widgetWidth, widget.height)
          }
          currentX += widgetWidth
          lastColumn = columnInWrappedLine
        }

        // Draw remaining text after last widget
        if (lastColumn < wrappedLine.text.length) {
          const textSegment = wrappedLine.text.substring(lastColumn)
          this.drawTokensWithCustomLigatures(
            ctx,
            [{ type: 'plain', content: textSegment, length: textSegment.length }],
            currentX,
            y,
            theme,
          )
        }
      }

      // Draw 'below' widgets after the line
      if (widgets?.below && widgets.below.length > 0) {
        // All 'below' widgets on the same line share the same Y position (horizontal row)
        const widgetY = y + this.lineHeight
        for (const widget of widgets.below) {
          // Calculate position based on widget's column (convert from 1-based to 0-based)
          const widgetColumn = widget.column - 1
          const columnInWrappedLine = widgetColumn - wrappedLine.startColumn
          const textBeforeWidget = wrappedLine.text.substring(0, Math.max(0, columnInWrappedLine))
          const widgetX = textPadding + ctx.measureText(textBeforeWidget).width
          // Calculate width based on widget's length
          const widgetWidth = ctx.measureText('X'.repeat(widget.length)).width
          this.widgetPositions.set(widget, {
            x: widgetX,
            y: widgetY,
            width: widgetWidth,
            height: widget.height,
          })
          if (widgetY + widget.height >= visibleStartY && widgetY <= visibleEndY) {
            widget.render(ctx, widgetX, widgetY, widgetWidth, widget.height)
          }
        }
      }
    })

    // Draw error squiggles
    if (this.errors.length > 0) {
      this.drawErrorSquiggles(
        ctx,
        wrappedLines,
        theme,
        this.scrollY,
        height,
        widgetLayout.yOffsets,
        widgetLayout.widgetsByVisualLine,
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
          aboveHeight = Math.max(...widgets.above.map(w => w.height))
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
        ctx.fillRect(caretX, caretY, 2, this.lineHeight - 1)
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

    // Draw scrollbars (after restore so they're not affected by scroll transform)
    this.drawScrollbars(ctx, width, height, theme)
  }

  private drawScrollbars(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    theme: Theme,
  ) {
    const { viewportWidth, viewportHeight, contentWidth, contentHeight } = this.scrollMetrics

    const showVBar = contentHeight > viewportHeight + 1
    const showHBar = contentWidth > viewportWidth + 1

    // Vertical scrollbar
    if (showVBar) {
      const trackHeight = height
      const thumbHeight = Math.max(20, (viewportHeight / contentHeight) * trackHeight)
      const maxTravel = trackHeight - thumbHeight
      const thumbTop = (this.scrollY / Math.max(1, contentHeight - viewportHeight)) * maxTravel

      // Draw track (optional, currently transparent)
      if (theme.scrollbarTrack !== 'transparent') {
        ctx.fillStyle = theme.scrollbarTrack
        ctx.fillRect(width - this.scrollbarWidth, 0, this.scrollbarWidth, height)
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
    if (!this.isActive || !this.signatureEnabled) return
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

        // For word wrap mode, calculate visual line positions
        let preCalculatedContentY: number | undefined
        let preCalculatedCaretContentY: number | undefined
        let preCalculatedContentX: number | undefined
        let preCalculatedCaretContentX: number | undefined
        if (this.options.wordWrap) {
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
            aboveHeight = Math.max(...widgets.above.map(w => w.height))
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
          if (caretWidgets?.above) {
            for (const widget of caretWidgets.above) {
              caretAboveHeight += widget.height
            }
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

        const newPopupPosition = {
          x: position.x,
          y: position.y,
        }

        // Only update if position actually changed
        const positionChanged = !this.lastPopupPosition
          || this.lastPopupPosition.x !== newPopupPosition.x
          || this.lastPopupPosition.y !== newPopupPosition.y

        this.lastPopupPosition = newPopupPosition
        if (positionChanged) {
          this.callbacks.onPopupPositionChange?.(newPopupPosition)
        }
      }
    }
    else if (this.lastPopupPosition !== null) {
      // Clear popup position when there's no call info
      this.lastPopupPosition = null
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

    const { viewportWidth, viewportHeight, contentWidth, contentHeight } = this.scrollMetrics

    const showVBar = contentHeight > viewportHeight + 1
    const showHBar = contentWidth > viewportWidth + 1

    // Check vertical scrollbar
    if (showVBar && x >= width - this.scrollbarWidth && x <= width) {
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
      this.draw()
    }
  }

  public handleScrollbarClick(x: number, y: number, scrollbar: 'vertical' | 'horizontal'): boolean {
    const dpr = window.devicePixelRatio || 1
    const width = this.canvas.width / dpr
    const height = this.canvas.height / dpr

    const { viewportWidth, viewportHeight, contentWidth, contentHeight } = this.scrollMetrics

    if (scrollbar === 'vertical') {
      const trackHeight = height
      const thumbHeight = Math.max(20, (viewportHeight / contentHeight) * trackHeight)
      const maxTravel = trackHeight - thumbHeight
      const thumbTop = (this.scrollY / Math.max(1, contentHeight - viewportHeight)) * maxTravel

      // Check if clicking on thumb
      if (y >= thumbTop && y <= thumbTop + thumbHeight) {
        return true // Indicates thumb clicked (will be handled by drag)
      }

      // Click on track - jump to position
      const targetThumbTop = Math.max(0, Math.min(y - thumbHeight / 2, maxTravel))
      const scrollY = (targetThumbTop / maxTravel) * Math.max(1, contentHeight - viewportHeight)
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

    const { viewportWidth, viewportHeight, contentWidth, contentHeight } = this.scrollMetrics

    if (scrollbar === 'vertical') {
      const trackHeight = height
      const thumbHeight = Math.max(20, (viewportHeight / contentHeight) * trackHeight)
      const maxTravel = Math.max(1, trackHeight - thumbHeight)
      const contentScrollable = Math.max(1, contentHeight - viewportHeight)
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
      }
      else {
        this.updateFunctionSignature()
      }
    }
  }

  public hideSignaturePopup() {
    if (this.lastFunctionCallInfo !== null) {
      this.lastFunctionCallInfo = null
      this.callbacks.onFunctionCallChange?.(null)
    }
  }

  public setFunctionDefinitions(definitions: Record<string, any>) {
    this.functionDefinitions = definitions
  }

  public hideAutocomplete() {
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
      return
    }

    const suggestions = getAutocompleteSuggestions(
      wordInfo.word,
      this.inputState.lines,
      this.functionDefinitions,
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
        let preCalculatedCaretContentY: number | undefined
        let preCalculatedCaretContentX: number | undefined
        const textPadding = this.getTextPadding()
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
            aboveHeight = Math.max(...widgets.above.map(w => w.height))
          }
          preCalculatedCaretContentY = this.padding + caretVisualPos.visualLine * this.lineHeight + yOffset
            + aboveHeight

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
        }
        else {
          // Non-wrapped: compute caret X/Y in content space
          const wrappedLines = this.getWrappedLines(ctx)
          const widgetLayout = this.calculateWidgetLayout(ctx, wrappedLines)

          const yOffset = widgetLayout.yOffsets.get(this.inputState.caret.line) || 0
          let aboveHeight = 0
          const widgets = widgetLayout.widgetsByVisualLine.get(this.inputState.caret.line)
          if (widgets?.above && widgets.above.length > 0) {
            aboveHeight = Math.max(...widgets.above.map(w => w.height))
          }

          const caretLine = this.inputState.lines[this.inputState.caret.line] || ''
          const textBeforeCaret = caretLine.substring(0, this.inputState.caret.column)
          preCalculatedCaretContentX = textPadding + ctx.measureText(textBeforeCaret).width

          // Account for inline widgets before the caret
          const inlineWidgetsForLine = widgetLayout.inlineWidgets.get(this.inputState.caret.line) || []
          for (const { widget, column } of inlineWidgetsForLine) {
            if (column <= this.inputState.caret.column) {
              preCalculatedCaretContentX += ctx.measureText('X'.repeat(widget.length)).width
            }
          }

          preCalculatedCaretContentY = this.padding + this.inputState.caret.line * this.lineHeight + yOffset
            + aboveHeight
        }

        const computeAndPublish = () => {
          const contentX = this.lastCaretContentX ?? preCalculatedCaretContentX
          const contentY = this.lastCaretContentY ?? preCalculatedCaretContentY
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

          const newPosition = { x: Math.round(position.x), y: Math.round(position.y) }

          // Only update if position actually changed
          const positionChanged = !this.lastAutocompletePosition
            || this.lastAutocompletePosition.x !== newPosition.x
            || this.lastAutocompletePosition.y !== newPosition.y

          this.lastAutocompletePosition = newPosition
          if (positionChanged) {
            this.callbacks.onAutocompletePositionChange?.(newPosition)
          }
        }

        // If autocomplete info hasn't changed, update position immediately (e.g., during scroll)
        // Only delay when autocomplete info is changing (new suggestions, etc.)
        // Force immediate update if canvas state is already finalized (e.g., after error updates)
        if (forceImmediate || (!changed && this.lastAutocompleteInfo !== null)) {
          computeAndPublish()
        }
        else {
          // Schedule three frames to ensure caret/layout state is finalized before measuring
          if (this.autocompleteRaf !== null) cancelAnimationFrame(this.autocompleteRaf)
          this.autocompleteRaf = requestAnimationFrame(() => {
            this.autocompleteRaf = requestAnimationFrame(() => {
              this.autocompleteRaf = requestAnimationFrame(() => {
                computeAndPublish()
                this.autocompleteRaf = null
              })
            })
          })
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
    this.draw()
  }

  public updateWidgets(widgets: EditorWidget[]) {
    this.options.widgets = widgets
  }

  public setTheme(theme: Theme) {
    this.options.theme = theme
    this.highlightCache = null
    this.draw()
  }

  public setTokenizer(tokenizer: Tokenizer) {
    this.options.tokenizer = tokenizer
    this.highlightCache = null
    this.draw()
  }

  public setErrors(errors: EditorError[]) {
    // Track if we were at the bottom before updating errors
    const ctx = this.canvas.getContext('2d')
    let wasAtBottom = false
    if (ctx && this.isActive) {
      this.setFont(ctx)
      const oldContentSize = this.options.wordWrap
        ? this.getContentSizeWithWrapping(ctx, this.getWrappedLines(ctx))
        : this.getContentSize(ctx)
      const dpr = window.devicePixelRatio || 1
      const viewportHeight = this.canvas.height / dpr
      const maxScrollY = Math.max(0, oldContentSize.height - viewportHeight)
      wasAtBottom = this.scrollY >= maxScrollY - 1 // Allow 1px tolerance
    }

    this.errors = errors

    // Defer canvas size update to avoid feedback loop with ResizeObserver
    // The draw will use current canvas size, and metrics will be updated correctly
    requestAnimationFrame(() => {
      this.updateCanvasSize()

      const drawCtx = this.canvas.getContext('2d')
      if (!drawCtx) return

      this.draw()
      this.updateFunctionSignature()
      this.updateAutocomplete(true)

      // Preserve bottom scroll position after draw if we were at the bottom
      if (wasAtBottom && drawCtx && this.isActive) {
        this.setFont(drawCtx)
        const wrappedLines = this.getWrappedLines(drawCtx)
        const newContentSize = this.options.wordWrap
          ? this.getContentSizeWithWrapping(drawCtx, wrappedLines)
          : this.getContentSize(drawCtx)
        const dpr = window.devicePixelRatio || 1
        const viewportHeight = this.canvas.height / dpr
        const maxScrollY = Math.max(0, newContentSize.height - viewportHeight)
        if (this.scrollY < maxScrollY) {
          this.scrollY = maxScrollY
          this.callbacks.onScrollChange?.(this.scrollX, this.scrollY)
          // Redraw to reflect the corrected scroll position
          this.draw()
          this.updateFunctionSignature()
          this.updateAutocomplete(true)
        }
      }
    })
  }

  public checkErrorHover(x: number, y: number): EditorError | null {
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return null

    this.setFont(ctx)
    const wrappedLines = this.getWrappedLines(ctx)
    const widgetLayout = this.calculateWidgetLayout(ctx, wrappedLines)
    const textPadding = this.getTextPadding()

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
        const adjustedY = y + this.scrollY
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
    const adjustedY = y + this.scrollY
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
              aboveHeight = Math.max(...widgets.above.map(w => w.height))
            }
            preCalculatedContentY = this.padding + visualPos.visualLine * this.lineHeight + yOffset + aboveHeight
            preCalculatedContentX = textPadding
          }
          else {
            const yOffset = widgetLayout.yOffsets.get(error.line) || 0
            let aboveHeight = 0
            const widgets = widgetLayout.widgetsByVisualLine.get(error.line)
            if (widgets?.above && widgets.above.length > 0) {
              aboveHeight = Math.max(...widgets.above.map(w => w.height))
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
              aboveHeight = Math.max(...widgets.above.map(w => w.height))
            }
            preCalculatedContentY = this.padding + visualPos.visualLine * this.lineHeight + yOffset + aboveHeight

            const wrappedLine = wrappedLines[visualPos.visualLine]
            if (wrappedLine) {
              const textBeforeError = wrappedLine.text.substring(0, visualPos.visualColumn)
              preCalculatedContentX = textPadding + ctx.measureText(textBeforeError).width
            }
          }
          else {
            const wrappedLines = this.getWrappedLines(ctx)
            const widgetLayout = this.calculateWidgetLayout(ctx, wrappedLines)
            const yOffset = widgetLayout.yOffsets.get(error.line) || 0
            let aboveHeight = 0
            const widgets = widgetLayout.widgetsByVisualLine.get(error.line)
            if (widgets?.above && widgets.above.length > 0) {
              aboveHeight = Math.max(...widgets.above.map(w => w.height))
            }
            preCalculatedContentY = this.padding + error.line * this.lineHeight + yOffset + aboveHeight
            const line = this.inputState.lines[error.line] || ''
            const textBeforeError = line.substring(0, error.startColumn)
            preCalculatedContentX = textPadding + ctx.measureText(textBeforeError).width
          }
        }

        const viewportX = preCalculatedContentX! - this.scrollX + rect.left
        const viewportY = preCalculatedContentY! - this.scrollY + rect.top

        this.callbacks.onErrorPositionChange?.({
          x: viewportX,
          y: viewportY,
        })
      }
    }

    if (!error) {
      this.isHoveringGutter = false
    }
  }

  private drawErrorSquiggles(
    ctx: CanvasRenderingContext2D,
    wrappedLines: WrappedLine[],
    theme: Theme,
    scrollY: number,
    viewportHeight: number,
    yOffsets: Map<number, number>,
    widgetsByVisualLine: Map<number, { above: EditorWidget[]; below: EditorWidget[] }>,
  ) {
    const textPadding = this.getTextPadding()
    const visibleStartY = scrollY
    const visibleEndY = scrollY + viewportHeight

    for (const error of this.errors) {
      const visualStart = this.logicalToVisualPosition(error.line, error.startColumn, wrappedLines)
      const visualEnd = this.logicalToVisualPosition(error.line, error.endColumn, wrappedLines)

      // Viewport culling: skip if error is not visible
      const startYOffset = yOffsets.get(visualStart.visualLine) || 0
      const endYOffset = yOffsets.get(visualEnd.visualLine) || 0
      let startAboveHeight = 0
      const startWidgets = widgetsByVisualLine.get(visualStart.visualLine)
      if (startWidgets?.above) {
        for (const widget of startWidgets.above) {
          startAboveHeight += widget.height
        }
      }
      let endAboveHeight = 0
      const endWidgets = widgetsByVisualLine.get(visualEnd.visualLine)
      if (endWidgets?.above) {
        for (const widget of endWidgets.above) {
          endAboveHeight += widget.height
        }
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

          const startX = textPadding + ctx.measureText(startText).width
          const errorWidth = ctx.measureText(errorText).width
          const yOffset = yOffsets.get(visualStart.visualLine) || 0
          // Add max height of 'above' widgets on this line (they are in the same row)
          let aboveHeight = 0
          const widgets = widgetsByVisualLine.get(visualStart.visualLine)
          if (widgets?.above && widgets.above.length > 0) {
            aboveHeight = Math.max(...widgets.above.map(w => w.height))
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

          while (currentX < startX + errorWidth) {
            const nextX = Math.min(currentX + squiggleWidth / 2, startX + errorWidth)
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
            aboveHeight = Math.max(...widgets.above.map(w => w.height))
          }
          const y = this.padding + visualLine * this.lineHeight + yOffset + aboveHeight + this.lineHeight - 3
          let startX: number, errorWidth: number

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

          ctx.strokeStyle = theme.errorSquigglyColor
          ctx.lineWidth = 1.5
          ctx.beginPath()

          const squiggleHeight = 2
          const squiggleWidth = 4
          let currentX = startX
          ctx.moveTo(currentX, y)

          while (currentX < startX + errorWidth) {
            const nextX = Math.min(currentX + squiggleWidth / 2, startX + errorWidth)
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
        const widgetY = y
        for (const widget of widgets.above) {
          const widgetColumn = widget.column - 1
          const columnInWrappedLine = widgetColumn - wrappedLine.startColumn
          const textBeforeWidget = wrappedLine.text.substring(0, Math.max(0, columnInWrappedLine))
          const widgetX = textPadding + ctx.measureText(textBeforeWidget).width
          const widgetWidth = ctx.measureText('X'.repeat(widget.length)).width
          this.widgetPositions.set(widget, {
            x: widgetX,
            y: widgetY,
            width: widgetWidth,
            height: widget.height,
          })
        }
        y += Math.max(...widgets.above.map(w => w.height))
      }

      const inlineWidgets = widgetLayout.inlineWidgets.get(visualIndex) || []
      if (inlineWidgets.length > 0) {
        let currentX = textPadding
        for (const { widget, column } of inlineWidgets) {
          const columnInWrappedLine = column - wrappedLine.startColumn
          const textBeforeWidget = wrappedLine.text.substring(0, Math.max(0, columnInWrappedLine))
          currentX = textPadding + ctx.measureText(textBeforeWidget).width
          const widgetWidth = ctx.measureText('X'.repeat(widget.length)).width
          this.widgetPositions.set(widget, {
            x: currentX,
            y: y - 0.5,
            width: widgetWidth,
            height: widget.height,
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
          this.widgetPositions.set(widget, {
            x: widgetX,
            y: widgetY,
            width: widgetWidth,
            height: widget.height,
          })
        }
      }
    })
  }

  public handleWidgetPointerDown(x: number, y: number): boolean {
    this.ensureWidgetPositions()
    const adjustedX = x + this.scrollX
    const adjustedY = y + this.scrollY

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
        const offsetX = adjustedX - pos.x
        const offsetY = adjustedY - pos.y
        widget.pointerDown?.(adjustedX, adjustedY, offsetX, offsetY)
        return true
      }
    }

    this.isWidgetPointerDown = false
    return false
  }

  public handleWidgetPointerUp(): void {
    if (this.activeWidget) {
      this.activeWidget.pointerUp?.()
      this.activeWidget = null
    }
    this.isWidgetPointerDown = false
  }
}
