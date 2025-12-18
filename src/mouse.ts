import type { CaretPosition, InputState } from './input.ts'

export class MouseHandler {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private onStateChange: (state: InputState) => void
  private isDragging = false
  private dragStartPosition: CaretPosition | null = null
  private clickCount = 0
  private lastClickTime = 0
  private lastClickPosition: CaretPosition | null = null
  private isWordSelection = false
  private isLineSelection = false
  private scrollX = 0
  private scrollY = 0
  private textPadding = 16
  private wordWrapCoordinateConverter: ((x: number, y: number) => CaretPosition) | null = null
  private pendingTouchPosition: { x: number; y: number } | null = null
  private shouldClearPendingTouch: boolean = false

  constructor(canvas: HTMLCanvasElement, onStateChange: (state: InputState) => void) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.onStateChange = onStateChange
  }

  setScrollOffset(x: number, y: number) {
    this.scrollX = x
    this.scrollY = y
  }

  setTextPadding(padding: number) {
    this.textPadding = padding
  }

  setWordWrapCoordinateConverter(converter: ((x: number, y: number) => CaretPosition) | null) {
    this.wordWrapCoordinateConverter = converter
  }

  setNormalModeCoordinateConverter(converter: ((x: number, y: number) => CaretPosition) | null) {
    this.normalModeCoordinateConverter = converter
  }

  isDraggingSelection(): boolean {
    return this.isDragging
  }

  clearPendingTouchPosition(): void {
    this.pendingTouchPosition = null
    this.shouldClearPendingTouch = false
  }

  handlePointerDown(event: PointerEvent, currentState: InputState) {
    const rect = this.canvas.getBoundingClientRect()
    // Always use canvas-relative coordinates (no scroll offset)
    // getCaretPositionFromCoordinates will add scroll offset internally
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top

    let caretPosition: CaretPosition
    if (this.wordWrapCoordinateConverter) {
      // For word wrap mode, CanvasEditor handles scroll offset internally
      caretPosition = this.wordWrapCoordinateConverter(x, y)
    }
    else {
      // For normal mode, use the coordinate converter if available, otherwise use fallback
      if (this.normalModeCoordinateConverter) {
        caretPosition = this.normalModeCoordinateConverter(x, y)
      }
      else {
        // Fallback to internal method (may not be accurate due to font/DPR issues)
        caretPosition = this.getCaretPositionFromCoordinates(x, y, currentState.lines)
      }
    }

    // Handle click counting for double/triple click
    const now = Date.now()
    const isSamePosition = this.lastClickPosition
      && this.lastClickPosition.line === caretPosition.line
      && this.lastClickPosition.column === caretPosition.column

    if (now - this.lastClickTime < 500 && isSamePosition) {
      this.clickCount++
      // Reset to 1 on 4th click
      if (this.clickCount > 3) {
        this.clickCount = 1
      }
    }
    else {
      this.clickCount = 1
    }

    this.lastClickTime = now
    this.lastClickPosition = { ...caretPosition }

    const newState = { ...currentState }

    // Handle different click types
    if (this.clickCount === 1) {
      // Single click - start drag selection
      // On touch devices, defer caret positioning until pointerup (tap and release only)
      if (event.pointerType === 'touch') {
        // Store position for later, don't update caret yet
        this.pendingTouchPosition = { x, y }
        this.isDragging = false
        this.isWordSelection = false
        this.isLineSelection = false
        this.dragStartPosition = null
        newState.selection = null
        // Don't update state yet - wait for pointerup
        return
      }
      else {
        newState.caret = caretPosition
        this.isDragging = true
        this.isWordSelection = false
        this.isLineSelection = false
        this.dragStartPosition = { ...caretPosition }
        newState.selection = {
          start: { line: caretPosition.line, column: caretPosition.column },
          end: { line: caretPosition.line, column: caretPosition.column },
        }
      }
    }
    else if (this.clickCount === 2) {
      // Double click - select word and start word selection drag
      this.isDragging = true
      this.isWordSelection = true
      this.isLineSelection = false
      this.dragStartPosition = { ...caretPosition }
      const wordSelection = this.selectWordAtPosition(caretPosition, currentState.lines)
      newState.selection = wordSelection
      // Position caret at the end of the selected word
      newState.caret = {
        line: wordSelection.end.line,
        column: wordSelection.end.column,
        columnIntent: wordSelection.end.column,
      }
    }
    else if (this.clickCount === 3) {
      // Triple click - select line and start line selection drag
      this.isDragging = true
      this.isWordSelection = false
      this.isLineSelection = true
      this.dragStartPosition = { ...caretPosition }
      const lineSelection = this.selectLineAtPosition(caretPosition, currentState.lines)
      newState.selection = lineSelection
      // Position caret at the end of the selected line
      newState.caret = {
        line: lineSelection.end.line,
        column: lineSelection.end.column,
        columnIntent: lineSelection.end.column,
      }
    }

    this.onStateChange(newState)
  }

  handlePointerMove(event: PointerEvent, currentState: InputState) {
    // Clear pending touch position only if significant movement occurs (it's a scroll, not a tap)
    if (event.pointerType === 'touch' && this.pendingTouchPosition) {
      const rect = this.canvas.getBoundingClientRect()
      const currentX = event.clientX - rect.left
      const currentY = event.clientY - rect.top
      const moveDistance = Math.sqrt(
        Math.pow(currentX - this.pendingTouchPosition.x, 2)
          + Math.pow(currentY - this.pendingTouchPosition.y, 2),
      )
      // Only clear if movement exceeds threshold (10px)
      if (moveDistance > 10) {
        this.shouldClearPendingTouch = true
        this.pendingTouchPosition = null
        return
      }
    }

    if (!this.isDragging || !this.dragStartPosition) return

    // Prevent selection updates during touch scrolling
    if (event.pointerType === 'touch') {
      return
    }

    const rect = this.canvas.getBoundingClientRect()
    // Always use canvas-relative coordinates (no scroll offset)
    // getCaretPositionFromCoordinates will add scroll offset internally
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top

    let caretPosition: CaretPosition
    if (this.wordWrapCoordinateConverter) {
      // For word wrap mode, CanvasEditor handles scroll offset internally
      caretPosition = this.wordWrapCoordinateConverter(x, y)
    }
    else {
      // For normal mode, use the coordinate converter if available, otherwise use fallback
      if (this.normalModeCoordinateConverter) {
        caretPosition = this.normalModeCoordinateConverter(x, y)
      }
      else {
        // Fallback to internal method (may not be accurate due to font/DPR issues)
        caretPosition = this.getCaretPositionFromCoordinates(x, y, currentState.lines)
      }
    }

    const newState = { ...currentState }

    if (this.isWordSelection) {
      // Word selection - expand selection word by word
      const selection = this.expandWordSelection(
        this.dragStartPosition,
        caretPosition,
        currentState.lines,
      )
      newState.selection = selection

      // Position caret at the end of selection (opposite of drag start)
      const isDraggingForward = this.dragStartPosition.line < caretPosition.line
        || (this.dragStartPosition.line === caretPosition.line
          && this.dragStartPosition.column <= caretPosition.column)

      if (isDraggingForward) {
        newState.caret = {
          line: selection.end.line,
          column: selection.end.column,
          columnIntent: selection.end.column,
        }
      }
      else {
        newState.caret = {
          line: selection.start.line,
          column: selection.start.column,
          columnIntent: selection.start.column,
        }
      }
    }
    else if (this.isLineSelection) {
      // Line selection - expand selection line by line
      const selection = this.expandLineSelection(
        this.dragStartPosition,
        caretPosition,
        currentState.lines,
      )
      newState.selection = selection

      // Position caret at the end of selection (opposite of drag start)
      const isDraggingForward = this.dragStartPosition.line < caretPosition.line
        || (this.dragStartPosition.line === caretPosition.line
          && this.dragStartPosition.column <= caretPosition.column)

      if (isDraggingForward) {
        newState.caret = {
          line: selection.end.line,
          column: selection.end.column,
          columnIntent: selection.end.column,
        }
      }
      else {
        newState.caret = {
          line: selection.start.line,
          column: selection.start.column,
          columnIntent: selection.start.column,
        }
      }
    }
    else {
      // Normal character selection
      newState.selection = {
        start: { line: this.dragStartPosition.line, column: this.dragStartPosition.column },
        end: { line: caretPosition.line, column: caretPosition.column },
      }
      newState.caret = caretPosition
    }

    this.onStateChange(newState)
  }

  handlePointerUp(event: PointerEvent, currentState: InputState) {
    // Handle pending touch position (tap and release)
    if (event.pointerType === 'touch' && this.pendingTouchPosition) {
      this.pendingTouchPosition = null

      // Don't set caret if scrolling occurred
      if (this.shouldClearPendingTouch) {
        this.shouldClearPendingTouch = false
        this.isDragging = false
        this.dragStartPosition = null
        this.isWordSelection = false
        this.isLineSelection = false
        return
      }

      // Use current pointer position instead of stored position for accuracy
      const rect = this.canvas.getBoundingClientRect()
      // Always use canvas-relative coordinates (no scroll offset)
      // getCaretPositionFromCoordinates will add scroll offset internally
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top

      let caretPosition: CaretPosition
      if (this.wordWrapCoordinateConverter) {
        // For word wrap mode, CanvasEditor handles scroll offset internally
        caretPosition = this.wordWrapCoordinateConverter(x, y)
      }
      else {
        // For normal mode, use the coordinate converter if available, otherwise use fallback
        if (this.normalModeCoordinateConverter) {
          caretPosition = this.normalModeCoordinateConverter(x, y)
        }
        else {
          // Fallback to internal method (may not be accurate due to font/DPR issues)
          caretPosition = this.getCaretPositionFromCoordinates(x, y, currentState.lines)
        }
      }

      const newState = { ...currentState }
      newState.caret = caretPosition
      newState.selection = null
      this.onStateChange(newState)

      this.isDragging = false
      this.dragStartPosition = null
      this.isWordSelection = false
      this.isLineSelection = false
      this.shouldClearPendingTouch = false
      return
    }

    this.shouldClearPendingTouch = false

    // If we have a zero-length selection (no actual dragging occurred), clear it
    if (
      currentState.selection
      && this.isSelectionEmpty(currentState.selection)
      && this.clickCount === 1
    ) {
      const newState = { ...currentState }
      newState.selection = null
      this.onStateChange(newState)
    }

    this.isDragging = false
    this.dragStartPosition = null
    this.isWordSelection = false
    this.isLineSelection = false
  }

  private isSelectionEmpty(selection: {
    start: { line: number; column: number }
    end: { line: number; column: number }
  }): boolean {
    const { start, end } = selection
    return start.line === end.line && start.column === end.column
  }

  private getCaretPositionFromCoordinates(x: number, y: number, lines: string[]): CaretPosition {
    const lineHeight = 20

    // Add scroll offset to get content coordinates
    const adjustedY = y + this.scrollY
    const adjustedX = x + this.scrollX

    // Calculate line number (accounting for scroll)
    const lineIndex = Math.max(0, Math.floor((adjustedY - this.textPadding) / lineHeight))
    const clampedLineIndex = Math.min(lineIndex, lines.length - 1)

    // Get the line text
    const line = lines[clampedLineIndex] || ''

    // Calculate column position (accounting for text padding which includes gutter)
    const xAdjusted = adjustedX - this.textPadding
    const column = this.getColumnFromX(xAdjusted, line)

    return {
      line: clampedLineIndex,
      column,
      columnIntent: column,
    }
  }

  private getColumnFromX(x: number, line: string): number {
    if (x <= 0) return 0

    // Measure text width to find the closest character position
    let currentWidth = 0
    for (let i = 0; i < line.length; i++) {
      const charWidth = this.ctx.measureText(line[i]).width
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

  private selectWordAtPosition(
    position: CaretPosition,
    lines: string[],
  ): { start: { line: number; column: number }; end: { line: number; column: number } } {
    const line = lines[position.line] || ''

    // Find word boundaries
    let start = position.column
    let end = position.column

    // Move start to beginning of word
    while (start > 0 && this.isWordCharacter(line[start - 1])) {
      start--
    }

    // Move end to end of word
    while (end < line.length && this.isWordCharacter(line[end])) {
      end++
    }

    return {
      start: { line: position.line, column: start },
      end: { line: position.line, column: end },
    }
  }

  private selectLineAtPosition(
    position: CaretPosition,
    lines: string[],
  ): { start: { line: number; column: number }; end: { line: number; column: number } } {
    const line = lines[position.line] || ''

    return {
      start: { line: position.line, column: 0 },
      end: { line: position.line, column: line.length },
    }
  }

  private isWordCharacter(char: string): boolean {
    return /[a-zA-Z0-9_]/.test(char)
  }

  private expandWordSelection(
    startPos: CaretPosition,
    endPos: CaretPosition,
    lines: string[],
  ): { start: { line: number; column: number }; end: { line: number; column: number } } {
    // Get the initial word selection from the start position
    const startWord = this.selectWordAtPosition(startPos, lines)

    // Determine which position comes first (start of drag vs current position)
    const isStartBeforeEnd = startPos.line < endPos.line
      || (startPos.line === endPos.line && startPos.column <= endPos.column)

    const firstPos = isStartBeforeEnd ? startPos : endPos
    const lastPos = isStartBeforeEnd ? endPos : startPos

    // Get word boundaries for both positions
    const firstWord = this.selectWordAtPosition(firstPos, lines)
    const lastWord = this.selectWordAtPosition(lastPos, lines)

    // If both positions are in the same word, just return that word
    if (
      firstWord.start.line === lastWord.start.line
      && firstWord.start.column === lastWord.start.column
      && firstWord.end.column === lastWord.end.column
    ) {
      return firstWord
    }

    // Return selection from start of first word to end of last word
    return {
      start: { line: firstWord.start.line, column: firstWord.start.column },
      end: { line: lastWord.end.line, column: lastWord.end.column },
    }
  }

  private expandLineSelection(
    startPos: CaretPosition,
    endPos: CaretPosition,
    lines: string[],
  ): { start: { line: number; column: number }; end: { line: number; column: number } } {
    // Determine which position comes first (start of drag vs current position)
    const isStartBeforeEnd = startPos.line < endPos.line
      || (startPos.line === endPos.line && startPos.column <= endPos.column)

    const firstLine = isStartBeforeEnd ? startPos.line : endPos.line
    const lastLine = isStartBeforeEnd ? endPos.line : startPos.line

    // Return selection from start of first line to end of last line
    return {
      start: { line: firstLine, column: 0 },
      end: { line: lastLine, column: lines[lastLine]?.length || 0 },
    }
  }
}
