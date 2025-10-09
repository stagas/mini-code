import {
  highlightCode,
  type HighlightedLine,
  type Token,
  getTokenColor,
  type Theme,
  defaultTheme,
} from './syntax.ts'
import {
  findFunctionCallContext,
  calculatePopupPosition,
  type FunctionCallInfo,
} from './function-signature.ts'
import {
  findCurrentWord,
  getAutocompleteSuggestions,
  calculateAutocompletePosition,
  type AutocompleteInfo,
} from './autocomplete.ts'
import type { InputState } from './input.ts'
import type { EditorError } from './ErrorPopup.tsx'

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

  // Find all matched brace pairs using the depth information
  const matchedPairs: { openIndex: number; closeIndex: number }[] = []

  // Use a stack-based approach to match braces correctly
  const stack: { char: string; index: number; depth: number }[] = []

  for (let i = 0; i < braces.length; i++) {
    const brace = braces[i]

    if (brace.isOpening) {
      // Opening brace - push to stack
      stack.push({ char: brace.char, index: i, depth: brace.depth })
    } else if (!brace.isOpening && brace.depth !== -1) {
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

  private setFont(ctx: CanvasRenderingContext2D) {
    const theme = this.options.theme || defaultTheme
    ctx.font = theme.font
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

      for (; i < text.length; i++) {
        const ch = text[i]
        const nextCharInSame = i + 1 < text.length ? text[i + 1] : null
        const nextCharAcross =
          i + 1 >= text.length && ti + 1 < tokens.length ? tokens[ti + 1].content[0] : null

        if (ch === '|' && (nextCharInSame === '>' || nextCharAcross === '>')) {
          const reserved = ctx.measureText('|>').width
          this.drawArrowLigature(ctx, currentX, y, color, reserved / 2)
          currentX += reserved

          if (nextCharInSame === '>') {
            // Consume the '>' in the same token
            i++
            continue
          }

          // We will skip exactly the first character of the next token (the '>')
          pendingSkipNextLeading = true
          break
        }

        ctx.fillStyle = color
        ctx.fillText(ch, currentX, y)
        currentX += ctx.measureText(ch).width
      }

      // If we finished the token without hitting a cross-token ligature, ensure no skip carries over
      // (pendingSkipNextLeading is already false unless we broke on a ligature)
    }

    return currentX
  }

  private getGutterWidth(): number {
    if (!this.options.gutter) return 0

    const lineCount = this.inputState.lines.length
    const maxLineNumber = lineCount.toString().length

    // Get canvas context to measure actual character width
    const ctx = this.canvas.getContext('2d')!
    this.setFont(ctx)
    const charWidth = ctx.measureText('0').width
    // Calculate width needed for line numbers + some padding
    return maxLineNumber * charWidth + 2
  }

  private getTextPadding(): number {
    return this.options.gutter ? this.padding + this.getGutterWidth() + 8 : this.padding
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
    this.canvas = canvas
    this.container = container
    this.inputState = initialState
    this.callbacks = callbacks
    this.options = options

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
    } else {
      this.ensureCaretVisible()
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
        this.wrappedLinesCache.code === code &&
        this.wrappedLinesCache.viewportWidth === viewportWidth
      ) {
        return this.wrappedLinesCache.result
      }
    }

    // Get syntax highlighting for token-aware wrapping
    const code = this.inputState.lines.join('\n')
    const theme = this.options.theme || defaultTheme
    let highlightedCode: HighlightedLine[]
    if (this.highlightCache && this.highlightCache.code === code) {
      highlightedCode = this.highlightCache.result
    } else {
      highlightedCode = highlightCode(code, 'javascript', theme)
    }

    const wrappedLines: WrappedLine[] = []

    for (let lineIndex = 0; lineIndex < this.inputState.lines.length; lineIndex++) {
      const line = this.inputState.lines[lineIndex] || ''
      const tokens = highlightedCode[lineIndex]?.tokens || []

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
          } else {
            right = mid - 1
          }
        }

        // Try to break at better boundaries (in order of preference):
        // 1. Token boundary
        // 2. Word boundary (space)
        // 3. Character boundary
        let finalEnd = bestEnd

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
        const tokenBoundaryDistance = lastTokenBoundary > 0 ? bestEnd - lastTokenBoundary : Infinity
        const spaceBoundaryDistance = lastSpaceBoundary > 0 ? bestEnd - lastSpaceBoundary : Infinity

        if (
          lastTokenBoundary > startColumn &&
          tokenBoundaryDistance < maxWidth * 0.2 &&
          bestEnd < line.length
        ) {
          finalEnd = lastTokenBoundary
        } else if (lastSpaceBoundary > startColumn && bestEnd < line.length) {
          finalEnd = lastSpaceBoundary
        } else {
          finalEnd = bestEnd
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

      // Exactly at the boundary: prefer the next segment if it starts here
      if (logicalColumn === wrapped.endColumn) {
        const next = wrappedLines[i + 1]
        if (next && next.logicalLine === logicalLine && next.startColumn === wrapped.endColumn) {
          return { visualLine: i + 1, visualColumn: 0 }
        }
        // Otherwise treat as end of this segment
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
      const w = ctx.measureText(wrappedLine.text).width
      if (w > maxLineWidth) maxLineWidth = w
    }
    const textPadding = this.getTextPadding()
    const width = textPadding + maxLineWidth + this.padding
    const height = this.padding + wrappedLines.length * this.lineHeight + this.padding
    return { width, height }
  }

  private drawSelectionWithWrapping(
    ctx: CanvasRenderingContext2D,
    inputState: InputState,
    wrappedLines: WrappedLine[],
  ) {
    if (!inputState.selection) return

    const { start, end } = inputState.selection

    // Normalize selection (ensure start comes before end)
    const normalizedStart =
      start.line < end.line || (start.line === end.line && start.column <= end.column) ? start : end
    const normalizedEnd =
      start.line < end.line || (start.line === end.line && start.column <= end.column) ? end : start

    // Don't draw selection if start === end (zero-length selection)
    if (
      normalizedStart.line === normalizedEnd.line &&
      normalizedStart.column === normalizedEnd.column
    ) {
      return
    }

    const selectionPadding = 4

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
        const startX = textPadding + ctx.measureText(startText).width
        const selectedWidth = ctx.measureText(selectedText).width + selectionPadding
        const y = this.padding + startVisual.visualLine * this.lineHeight - 3

        ctx.fillRect(startX, y, selectedWidth, this.lineHeight - 2)
      }
    } else {
      // Multi-visual-line selection
      const textPadding = this.getTextPadding()
      for (
        let visualLine = startVisual.visualLine;
        visualLine <= endVisual.visualLine;
        visualLine++
      ) {
        const wrappedLine = wrappedLines[visualLine]
        if (!wrappedLine) continue

        const y = this.padding + visualLine * this.lineHeight - 3

        if (visualLine === startVisual.visualLine) {
          // First visual line: from start column to end of visual line
          const startText = wrappedLine.text.substring(0, startVisual.visualColumn)
          const selectedText = wrappedLine.text.substring(startVisual.visualColumn)
          const startX = textPadding + ctx.measureText(startText).width
          const selectedWidth = ctx.measureText(selectedText).width + selectionPadding
          ctx.fillRect(startX, y, selectedWidth, this.lineHeight - 2)
        } else if (visualLine === endVisual.visualLine) {
          // Last visual line: from start of visual line to end column
          const selectedText = wrappedLine.text.substring(0, endVisual.visualColumn)
          const selectedWidth = ctx.measureText(selectedText).width + selectionPadding
          ctx.fillRect(textPadding, y, selectedWidth, this.lineHeight - 2)
        } else {
          // Middle visual lines: entire visual line
          const selectedWidth = ctx.measureText(wrappedLine.text).width + selectionPadding
          ctx.fillRect(textPadding, y, selectedWidth, this.lineHeight - 2)
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
  ) {
    // Find matching braces at cursor position
    const matchingBraces = findMatchingBrace(
      highlightedCode,
      this.inputState.caret.line,
      this.inputState.caret.column,
    )

    if (!matchingBraces) return

    // Check if opening brace is in this wrapped line segment
    if (matchingBraces.line === wrappedLine.logicalLine) {
      const braceColumn = this.getBraceColumnInLogicalLine(
        highlightedCode[matchingBraces.line],
        matchingBraces.tokenIndex,
      )
      if (braceColumn >= wrappedLine.startColumn && braceColumn < wrappedLine.endColumn) {
        const textPadding = this.getTextPadding()
        const braceX =
          textPadding +
          ctx.measureText(wrappedLine.text.substring(0, braceColumn - wrappedLine.startColumn))
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
        const braceX =
          textPadding +
          ctx.measureText(wrappedLine.text.substring(0, braceColumn - wrappedLine.startColumn))
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

    // Adjust for scroll offset
    const adjustedY = y + this.scrollY
    const adjustedX = x + this.scrollX

    // Calculate visual line number
    const visualLineIndex = Math.max(0, Math.floor((adjustedY - this.padding) / this.lineHeight))
    const clampedVisualLineIndex = Math.min(visualLineIndex, wrappedLines.length - 1)

    // Get the wrapped line
    const wrappedLine = wrappedLines[clampedVisualLineIndex]
    if (!wrappedLine) {
      return { line: 0, column: 0, columnIntent: 0 }
    }

    // Calculate column position within the visual line
    const textPadding = this.getTextPadding()
    const visualColumn = this.getColumnFromX(adjustedX - textPadding, wrappedLine.text, ctx)

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
      } else if (currentVisual.visualLine > 0) {
        const prevWrapped = wrappedLines[currentVisual.visualLine - 1]
        // Check if we're at the start of a wrapped segment (not first segment of logical line)
        if (prevWrapped.logicalLine === currentWrapped.logicalLine) {
          // Move to end of previous segment of same logical line
          // Use length - 1 to land ON the last character, not after it
          // (otherwise conversion back to logical would snap to next segment start)
          nextVisualLine = currentVisual.visualLine - 1
          nextVisualColumn = Math.max(0, prevWrapped.text.length - 1)
        } else {
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
      } else {
        // At start of first visual line
        return null
      }
    } else {
      // right
      if (currentVisual.visualColumn < currentWrapped.text.length) {
        // Move right within current segment
        nextVisualLine = currentVisual.visualLine
        nextVisualColumn = currentVisual.visualColumn + 1
      } else if (currentVisual.visualLine < wrappedLines.length - 1) {
        // Move to start of next segment
        nextVisualLine = currentVisual.visualLine + 1
        nextVisualColumn = 0
      } else {
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
  ): { line: number; column: number } | null {
    if (!this.options.wordWrap) {
      return null // Fall back to normal handling
    }

    const ctx = this.canvas.getContext('2d')
    if (!ctx)
      return { line, column: Math.min(columnIntent, (this.inputState.lines[line] || '').length) }

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
    } else {
      nextVisualLine = currentVisual.visualLine - 1
      if (nextVisualLine < 0) {
        return { line, column: currentColumn } // Already at first line
      }
    }

    const currentWrapped = wrappedLines[currentVisual.visualLine]
    const nextWrapped = wrappedLines[nextVisualLine]

    // columnIntent now represents the visual position within a wrapped segment (0, 1, 2, etc.)
    // We need to map this to the target wrapped segment
    const clampedVisualIntent = Math.min(Math.max(columnIntent, 0), nextWrapped.text.length)

    // Convert visual position to logical position within the target wrapped segment
    const logical = this.visualToLogicalPosition(nextVisualLine, clampedVisualIntent, wrappedLines)

    return { line: logical.logicalLine, column: logical.logicalColumn }
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

  public updateState(newState: InputState) {
    // Invalidate wrapped lines cache if lines changed
    if (this.inputState.lines !== newState.lines) {
      this.wrappedLinesCache = null
    }
    this.inputState = newState
    if (this.isActive) this.ensureCaretVisible()
    this.draw()
    this.updateAutocomplete()
    this.updateFunctionSignature()
  }

  public resize() {
    // Invalidate wrapped lines cache on resize
    this.wrappedLinesCache = null

    // Store old dimensions before updating
    const oldWidth = this.canvas.width / (window.devicePixelRatio || 1)
    const oldHeight = this.canvas.height / (window.devicePixelRatio || 1)

    this.updateCanvasSize()

    // Get new dimensions
    const newWidth = this.canvas.width / (window.devicePixelRatio || 1)
    const newHeight = this.canvas.height / (window.devicePixelRatio || 1)

    // Adjust scroll position to keep content properly visible after resize
    this.adjustScrollAfterResize(oldWidth, oldHeight, newWidth, newHeight)

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
      } else {
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

      // Only prevent default if we can actually scroll in the intended direction
      const canScrollHorizontally = effectiveDeltaX !== 0 && maxScrollX > 0
      const canScrollVertically = effectiveDeltaY !== 0 && maxScrollY > 0
      if (!(canScrollHorizontally || canScrollVertically)) {
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
    const textPadding = this.getTextPadding()
    const width = textPadding + maxLineWidth + this.padding
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
    this.scrollMetrics = { viewportWidth, viewportHeight, contentWidth, contentHeight }
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

    this.setFont(ctx)

    const dpr = window.devicePixelRatio || 1
    const viewportWidth = this.canvas.width / dpr
    const viewportHeight = this.canvas.height / dpr

    let caretX: number, caretTop: number, caretBottom: number
    let contentSize: { width: number; height: number }

    if (this.options.wordWrap) {
      // Get wrapped lines and convert logical position to visual position
      const wrappedLines = this.getWrappedLines(ctx)
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
        caretTop = this.padding + visualPos.visualLine * this.lineHeight
        caretBottom = caretTop + this.lineHeight
      } else {
        // Fallback
        caretX = textPadding
        caretTop = this.padding
        caretBottom = caretTop + this.lineHeight
      }

      contentSize = this.getContentSizeWithWrapping(ctx, wrappedLines)
    } else {
      // Compute caret content-space coordinates (original logic)
      const textPadding = this.getTextPadding()
      const caretLine = this.inputState.lines[this.inputState.caret.line] || ''
      const caretText = caretLine.substring(0, this.inputState.caret.column)
      caretX = textPadding + ctx.measureText(caretText).width
      caretTop = this.padding + this.inputState.caret.line * this.lineHeight
      caretBottom = caretTop + this.lineHeight

      contentSize = this.getContentSize(ctx)
    }

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

    if (this.highlightCache && this.highlightCache.code === code) {
      highlightedCode = this.highlightCache.result
    } else {
      highlightedCode = highlightCode(code, 'javascript', theme)
      this.highlightCache = { code, result: highlightedCode }
    }

    // Clear canvas
    ctx.fillStyle = theme.background
    ctx.fillRect(0, 0, width, height)

    // Publish metrics for consumers
    const content = this.getContentSizeWithWrapping(ctx, wrappedLines)
    this.publishScrollMetrics(ctx, width, height, content.width, content.height)

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

    // Draw selection background if exists
    if (this.inputState.selection) {
      ctx.fillStyle = theme.selection
      this.drawSelectionWithWrapping(ctx, this.inputState, wrappedLines)
    }

    // Draw wrapped lines
    const textPadding = this.getTextPadding()
    wrappedLines.forEach((wrappedLine: WrappedLine, visualIndex: number) => {
      const y = this.padding + visualIndex * this.lineHeight

      // Draw line number in gutter if enabled
      if (this.options.gutter) {
        const lineNumber = wrappedLine.logicalLine + 1
        // Only show line number on the first visual line for each logical line
        const isFirstVisualLine =
          visualIndex === 0 ||
          (visualIndex > 0 && wrappedLines[visualIndex - 1].logicalLine !== wrappedLine.logicalLine)

        if (isFirstVisualLine) {
          const gutterWidth = this.getGutterWidth()
          ctx.fillStyle = theme.gutterText
          ctx.textAlign = 'right'
          ctx.fillText(lineNumber.toString(), this.padding + gutterWidth - 8, y)
          ctx.textAlign = 'left' // Reset text alignment
        }
      }

      // Get syntax highlighting for this logical line
      const logicalHighlighted = highlightedCode[wrappedLine.logicalLine]
      if (logicalHighlighted) {
        // Extract tokens for this wrapped segment
        const segmentTokens = this.extractTokensForSegment(
          logicalHighlighted.tokens,
          wrappedLine.startColumn,
          wrappedLine.endColumn,
        )

        let currentX = textPadding
        currentX = this.drawTokensWithCustomLigatures(ctx, segmentTokens, currentX, y, theme)

        // Draw brace matching for any line that might contain braces (only when active)
        if (this.isActive) {
          this.drawBraceMatchingForWrappedLine(
            ctx,
            highlightedCode,
            wrappedLine,
            visualIndex,
            y,
            theme,
          )
        }
      } else {
        // Fallback: draw plain text with custom ligatures across a single token
        this.drawTokensWithCustomLigatures(
          ctx,
          [{ type: 'plain', content: wrappedLine.text, length: wrappedLine.text.length }],
          textPadding,
          y,
          theme,
        )
      }
    })

    // Draw error squiggles
    if (this.errors.length > 0) {
      this.drawErrorSquiggles(ctx, wrappedLines, theme)
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
        const caretY = this.padding + visualPos.visualLine * this.lineHeight - 3
        const caretText = wrappedLine.text.substring(0, visualPos.visualColumn)
        const caretX = textPadding + ctx.measureText(caretText).width

        ctx.fillStyle = theme.caret
        ctx.fillRect(caretX, caretY, 2, this.lineHeight - 2)
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
      ctx.fillStyle =
        this.hoveredScrollbar === 'vertical' ? theme.scrollbarThumbHover : theme.scrollbarThumb
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
      ctx.fillStyle =
        this.hoveredScrollbar === 'horizontal' ? theme.scrollbarThumbHover : theme.scrollbarThumb
      ctx.fillRect(thumbLeft, height - this.scrollbarWidth, thumbWidth, this.scrollbarWidth)
    }
  }

  private updateFunctionSignature() {
    if (!this.isActive || !this.signatureEnabled) return
    const callInfo = findFunctionCallContext(
      this.inputState.lines,
      this.inputState.caret.line,
      this.inputState.caret.column,
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
        const rect = this.canvas.getBoundingClientRect()
        const textPadding = this.getTextPadding()

        // For word wrap mode, calculate visual line positions
        let preCalculatedContentY: number | undefined
        let preCalculatedCaretContentY: number | undefined
        let preCalculatedContentX: number | undefined
        let preCalculatedCaretContentX: number | undefined
        if (this.options.wordWrap) {
          const wrappedLines = this.getWrappedLines(ctx)
          const visualPos = this.logicalToVisualPosition(
            callInfo.openParenPosition.line,
            callInfo.openParenPosition.column,
            wrappedLines,
          )
          preCalculatedContentY = this.padding + visualPos.visualLine * this.lineHeight

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
          preCalculatedCaretContentY = this.padding + caretVisualPos.visualLine * this.lineHeight

          // Calculate caret X position based on wrapped line segment
          const caretWrappedLine = wrappedLines[caretVisualPos.visualLine]
          if (caretWrappedLine) {
            const textBeforeCaretInSegment = caretWrappedLine.text.substring(
              0,
              caretVisualPos.visualColumn,
            )
            preCalculatedCaretContentX =
              textPadding + ctx.measureText(textBeforeCaretInSegment).width
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

        // Always update popup position so it can recalculate dynamically
        this.lastPopupPosition = newPopupPosition
        this.callbacks.onPopupPositionChange?.(newPopupPosition)
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
    } else {
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
    } else {
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
      } else {
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

  private updateAutocomplete() {
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

    const autocompleteInfo: AutocompleteInfo | null =
      suggestions.length > 0
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
        const rect = this.canvas.getBoundingClientRect()

        let preCalculatedCaretContentY: number | undefined
        let preCalculatedCaretContentX: number | undefined
        if (this.options.wordWrap) {
          const wrappedLines = this.getWrappedLines(ctx)
          const caretVisualPos = this.logicalToVisualPosition(
            this.inputState.caret.line,
            this.inputState.caret.column,
            wrappedLines,
          )
          preCalculatedCaretContentY = this.padding + caretVisualPos.visualLine * this.lineHeight
          const textPadding = this.getTextPadding()
          const caretWrappedLine = wrappedLines[caretVisualPos.visualLine]
          if (caretWrappedLine) {
            const textBeforeCaretInSegment = caretWrappedLine.text.substring(
              0,
              caretVisualPos.visualColumn,
            )
            preCalculatedCaretContentX =
              textPadding + ctx.measureText(textBeforeCaretInSegment).width
          }
        }

        const position = calculateAutocompletePosition(
          this.inputState.caret.line,
          this.inputState.caret.column,
          this.padding,
          this.lineHeight,
          ctx,
          this.inputState.lines,
          rect,
          this.scrollX,
          this.scrollY,
          preCalculatedCaretContentY,
          preCalculatedCaretContentX,
        )

        const newPosition = {
          x: position.x,
          y: position.y,
        }

        this.lastAutocompletePosition = newPosition
        this.callbacks.onAutocompletePositionChange?.(newPosition)
      }
    } else if (this.lastAutocompletePosition !== null) {
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
      a.word === b.word &&
      a.startColumn === b.startColumn &&
      a.endColumn === b.endColumn &&
      a.suggestions.length === b.suggestions.length &&
      a.suggestions.every((s, i) => s === b.suggestions[i])
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

  public setErrors(errors: EditorError[]) {
    this.errors = errors
    this.draw()
  }

  public checkErrorHover(x: number, y: number): EditorError | null {
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return null

    this.setFont(ctx)
    const wrappedLines = this.getWrappedLines(ctx)
    const textPadding = this.getTextPadding()

    const adjustedY = y + this.scrollY
    const adjustedX = x + this.scrollX

    const visualLineIndex = Math.max(0, Math.floor((adjustedY - this.padding) / this.lineHeight))
    const clampedVisualLineIndex = Math.min(visualLineIndex, wrappedLines.length - 1)

    const wrappedLine = wrappedLines[clampedVisualLineIndex]
    if (!wrappedLine) return null

    const visualColumn = this.getColumnFromX(adjustedX - textPadding, wrappedLine.text, ctx)
    const logicalPosition = this.visualToLogicalPosition(
      clampedVisualLineIndex,
      visualColumn,
      wrappedLines,
    )

    for (const error of this.errors) {
      if (
        error.line === logicalPosition.logicalLine &&
        logicalPosition.logicalColumn >= error.startColumn &&
        logicalPosition.logicalColumn < error.endColumn
      ) {
        return error
      }
    }

    return null
  }

  public updateErrorHover(error: EditorError | null) {
    if (this.hoveredError !== error) {
      this.hoveredError = error
      this.callbacks.onErrorHover?.(error)

      if (error) {
        const ctx = this.canvas.getContext('2d')
        if (ctx) {
          this.setFont(ctx)
          const rect = this.canvas.getBoundingClientRect()
          const textPadding = this.getTextPadding()

          let preCalculatedContentY: number | undefined
          let preCalculatedContentX: number | undefined

          if (this.options.wordWrap) {
            const wrappedLines = this.getWrappedLines(ctx)
            const visualPos = this.logicalToVisualPosition(
              error.line,
              error.startColumn,
              wrappedLines,
            )
            preCalculatedContentY = this.padding + visualPos.visualLine * this.lineHeight

            const wrappedLine = wrappedLines[visualPos.visualLine]
            if (wrappedLine) {
              const textBeforeError = wrappedLine.text.substring(0, visualPos.visualColumn)
              preCalculatedContentX = textPadding + ctx.measureText(textBeforeError).width
            }
          } else {
            preCalculatedContentY = this.padding + error.line * this.lineHeight
            const line = this.inputState.lines[error.line] || ''
            const textBeforeError = line.substring(0, error.startColumn)
            preCalculatedContentX = textPadding + ctx.measureText(textBeforeError).width
          }

          const viewportX = preCalculatedContentX! - this.scrollX + rect.left
          const viewportY = preCalculatedContentY! - this.scrollY + rect.top

          this.callbacks.onErrorPositionChange?.({
            x: viewportX,
            y: viewportY,
          })
        }
      }
    }
  }

  private drawErrorSquiggles(
    ctx: CanvasRenderingContext2D,
    wrappedLines: WrappedLine[],
    theme: Theme,
  ) {
    const textPadding = this.getTextPadding()

    for (const error of this.errors) {
      const visualStart = this.logicalToVisualPosition(error.line, error.startColumn, wrappedLines)
      const visualEnd = this.logicalToVisualPosition(error.line, error.endColumn, wrappedLines)

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
          const y = this.padding + visualStart.visualLine * this.lineHeight + this.lineHeight - 3

          ctx.strokeStyle = theme.errorColor
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
              y +
                (Math.floor((currentX - startX) / (squiggleWidth / 2)) % 2 === 0
                  ? squiggleHeight
                  : 0),
            )
            currentX = nextX
          }

          ctx.stroke()
        }
      } else {
        for (
          let visualLine = visualStart.visualLine;
          visualLine <= visualEnd.visualLine;
          visualLine++
        ) {
          const wrappedLine = wrappedLines[visualLine]
          if (!wrappedLine) continue

          const y = this.padding + visualLine * this.lineHeight + this.lineHeight - 3
          let startX: number, errorWidth: number

          if (visualLine === visualStart.visualLine) {
            const startText = wrappedLine.text.substring(0, visualStart.visualColumn)
            const errorText = wrappedLine.text.substring(visualStart.visualColumn)
            startX = textPadding + ctx.measureText(startText).width
            errorWidth = ctx.measureText(errorText).width
          } else if (visualLine === visualEnd.visualLine) {
            const errorText = wrappedLine.text.substring(0, visualEnd.visualColumn)
            startX = textPadding
            errorWidth = ctx.measureText(errorText).width
          } else {
            startX = textPadding
            errorWidth = ctx.measureText(wrappedLine.text).width
          }

          ctx.strokeStyle = theme.errorColor
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
              y +
                (Math.floor((currentX - startX) / (squiggleWidth / 2)) % 2 === 0
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
}
