import { History } from './history.ts'

/**
 * Input Handler with Debounced History
 *
 * History saving behavior:
 * - Character input (a-z, 0-9, symbols): Uses debounced history with 500ms delay to group rapid typing
 * - Other operations (Backspace, Delete, Enter, Tab, Cut, Paste): Immediate history saves
 * - Caret position: Only saved in history after content changes (not for navigation)
 * - Selection: Only saved in history when actually used (deleted, modified, or replaced)
 * - Undo/Redo: Flushes any pending debounced state before operation
 * - Navigation keys (arrows, page up/down, home/end): No history saves (cursor movement only)
 */

export interface CaretPosition {
  line: number
  column: number
  columnIntent: number
}

export interface Selection {
  start: { line: number; column: number }
  end: { line: number; column: number }
}

export const isSelectionEmpty = (selection: Selection): boolean => {
  const { start, end } = selection
  return start.line === end.line && start.column === end.column
}

export interface InputState {
  caret: CaretPosition
  selection: Selection | null
  lines: string[]
}

export interface MovementCallbacks {
  getCaretForHorizontalMove?: (
    direction: 'left' | 'right',
    line: number,
    column: number,
  ) => { line: number; column: number; columnIntent: number } | null
  getCaretForVerticalMove?: (
    direction: 'up' | 'down',
    line: number,
    columnIntent: number,
  ) => { line: number; column: number } | null
  getCaretForLineStart?: (
    line: number,
    column: number,
  ) => { line: number; column: number; columnIntent: number } | null
  getCaretForLineEnd?: (
    line: number,
    column: number,
  ) => { line: number; column: number; columnIntent: number } | null
}

export type KeyOverrideFunction = (
  event: preact.TargetedKeyboardEvent<HTMLTextAreaElement>,
  currentState: InputState,
) => boolean

export function getSelectedText(inputState: InputState): string {
  if (!inputState.selection) return ''

  const { start, end } = inputState.selection

  // Normalize selection (ensure start comes before end)
  const normalizedStart =
    start.line < end.line || (start.line === end.line && start.column <= end.column) ? start : end
  const normalizedEnd =
    start.line < end.line || (start.line === end.line && start.column <= end.column) ? end : start

  if (normalizedStart.line === normalizedEnd.line) {
    // Single line selection
    const line = inputState.lines[normalizedStart.line] || ''
    return line.substring(normalizedStart.column, normalizedEnd.column)
  } else {
    // Multi-line selection
    const selectedLines: string[] = []

    for (let lineIndex = normalizedStart.line; lineIndex <= normalizedEnd.line; lineIndex++) {
      const line = inputState.lines[lineIndex] || ''

      if (lineIndex === normalizedStart.line) {
        // First line: from start column to end of line
        selectedLines.push(line.substring(normalizedStart.column))
      } else if (lineIndex === normalizedEnd.line) {
        // Last line: from start of line to end column
        selectedLines.push(line.substring(0, normalizedEnd.column))
      } else {
        // Middle lines: entire line
        selectedLines.push(line)
      }
    }

    return selectedLines.join('\n')
  }
}

export class InputHandler {
  private onStateChange: (state: InputState) => void
  private history: History
  private movementCallbacks: MovementCallbacks
  private keyOverride: KeyOverrideFunction | null = null
  private getWidgets: (() => Array<{ line: number; column: number; type: 'above' | 'below' | 'inline' | 'overlay'; length: number; height?: number }>) | null = null

  constructor(
    onStateChange: (state: InputState) => void,
    history: History,
    movementCallbacks: MovementCallbacks = {},
  ) {
    this.onStateChange = onStateChange
    this.history = history
    this.movementCallbacks = movementCallbacks
  }

  setMovementCallbacks(callbacks: MovementCallbacks) {
    this.movementCallbacks = callbacks
  }

  setKeyOverride(fn: KeyOverrideFunction | null) {
    this.keyOverride = fn
  }

  setHistory(history: History) {
    this.history = history
  }

  setGetWidgets(fn: (() => Array<{ line: number; column: number; type: 'above' | 'below' | 'inline' | 'overlay'; length: number; height?: number }>) | null) {
    this.getWidgets = fn
  }

  handleKeyDown(event: preact.TargetedKeyboardEvent<HTMLTextAreaElement>, currentState: InputState) {
    // Call key override function if provided - if it returns false, skip default handling
    if (this.keyOverride && !this.keyOverride(event, currentState)) {
      return
    }

    // Do nothing for modifier keys pressed alone
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) {
      return
    }

    // Allow Ctrl+Shift+J to pass through (browser default)
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'j') {
      return
    }

    const newState = {
      ...currentState,
      lines: [...currentState.lines],
      caret: { ...currentState.caret },
      selection: currentState.selection
        ? {
            start: { ...currentState.selection.start },
            end: { ...currentState.selection.end },
          }
        : null,
    }
    const isShiftPressed = event.shiftKey
    const shouldSaveToHistory = this.shouldSaveToHistory(event.key)
    const isCharacterInput = this.isCharacterInput(event.key)

    // Start selection if shift is pressed and no selection exists
    if (isShiftPressed && !newState.selection) {
      newState.selection = {
        start: { line: newState.caret.line, column: newState.caret.column },
        end: { line: newState.caret.line, column: newState.caret.column },
      }
    }

    // Save before state for operations that modify content
    if (shouldSaveToHistory) {
      if (isCharacterInput) {
        this.saveDebouncedBeforeStateToHistory(newState)
      } else {
        // Flush any pending debounced state before non-character operations
        this.history.flushDebouncedState(newState)

        // Special handling for Enter - it needs caret position in before state
        if (event.key === 'Enter') {
          this.saveBeforeStateWithCaretToHistory(newState)
        } else {
          this.saveBeforeStateToHistory(newState)
        }
      }
    }

    if (event.ctrlKey || event.metaKey) {
      switch (event.key.toLowerCase()) {
        case 'c':
          // Allow browser default for copy
          return
        case 'a':
          event.preventDefault()
          this.handleSelectAll(currentState)
          return
        case 'x':
          event.preventDefault()
          this.handleCut(currentState)
          return
        case 'v':
          // Let the paste event handle it
          return
        case 'z':
          event.preventDefault()
          this.handleUndo(currentState)
          return
        case 'y':
          event.preventDefault()
          this.handleRedo(currentState)
          return
        case '/':
          event.preventDefault()
          this.handleToggleLineComment(currentState)
          return
        case 'd':
          if (event.shiftKey) {
            event.preventDefault()
            this.handleDuplicateLines(currentState)
            return
          }
          break
        case '-':
        case '=':
        case 'minus':
        case 'equal':
          // Allow browser default for zoom (ctrl+- and ctrl+=)
          return
      }
    }

    if (event.altKey) {
      switch (event.key) {
        case 'ArrowUp':
          event.preventDefault()
          this.moveLineUp(newState)
          this.onStateChange(newState)
          return
        case 'ArrowDown':
          event.preventDefault()
          this.moveLineDown(newState)
          this.onStateChange(newState)
          return
      }
    }

    // For any event that reaches here, we handle it and prevent default browser behavior.
    event.preventDefault()

    switch (event.key) {
      case 'ArrowLeft':
        if (event.ctrlKey || event.metaKey) {
          this.moveCaretWordLeft(newState)
        } else {
          this.moveCaretLeft(newState)
        }
        break
      case 'ArrowRight':
        if (event.ctrlKey || event.metaKey) {
          this.moveCaretWordRight(newState)
        } else {
          this.moveCaretRight(newState)
        }
        break
      case 'ArrowUp':
        this.moveCaretUp(newState)
        break
      case 'ArrowDown':
        this.moveCaretDown(newState)
        break
      case 'PageUp':
        this.moveCaretPageUp(newState)
        break
      case 'PageDown':
        this.moveCaretPageDown(newState)
        break
      case 'Home':
        this.moveCaretToLineStart(newState)
        break
      case 'End':
        this.moveCaretToLineEnd(newState)
        break
      case 'Backspace':
        if (event.ctrlKey || event.metaKey) {
          this.deleteWordLeft(newState)
        } else {
          this.handleBackspace(newState)
        }
        break
      case 'Delete':
        if (event.shiftKey) {
          this.deleteCurrentLine(newState)
        } else if (event.ctrlKey || event.metaKey) {
          this.deleteWordRight(newState)
        } else {
          this.handleDelete(newState)
        }
        break
      case 'Tab':
        if (event.shiftKey) {
          this.handleShiftTab(newState)
        } else {
          this.handleTab(newState)
        }
        break
      case 'Enter':
        this.handleEnter(newState)
        break
      default:
        // Handle character insertion
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
          this.insertCharacter(newState, event.key)
        }
        break
    }

    // Update selection end position if shift is pressed and selection exists
    // But don't create selection for Tab key (Shift+Tab should not select)
    if (isShiftPressed && newState.selection && event.key !== 'Tab') {
      newState.selection.end = { line: newState.caret.line, column: newState.caret.column }
    }

    // Clear selection if shift is not pressed (except for special keys)
    // Don't clear selection for Tab key when there's already a selection
    if (
      (!isShiftPressed || event.key === 'Tab') &&
      ['Backspace', 'Delete'].indexOf(event.key) === -1 &&
      !(event.key === 'Tab' && newState.selection)
    ) {
      newState.selection = null
    }

    // Save after state for operations that modify content
    if (shouldSaveToHistory) {
      if (isCharacterInput) {
        this.saveDebouncedAfterStateToHistory(newState)
      } else {
        this.saveAfterStateToHistory(newState)
      }
    }

    this.onStateChange(newState)
  }

  private shouldSaveToHistory(key: string): boolean {
    // Save history for operations that modify content
    // This includes: Backspace, Delete, Tab, Enter, and printable characters
    // This excludes: Navigation keys, function keys, and modifier keys
    return (
      key === 'Backspace' ||
      key === 'Delete' ||
      key === 'Tab' ||
      key === 'Enter' ||
      (key.length === 1 &&
        ![
          'z',
          'y',
          'ArrowLeft',
          'ArrowRight',
          'ArrowUp',
          'ArrowDown',
          'PageUp',
          'PageDown',
          'Home',
          'End',
        ].includes(key))
    )
  }

  private isCharacterInput(key: string): boolean {
    // Character input is printable characters (not control keys)
    // These use debounced history to group rapid typing into chunks
    return key.length === 1 && !['Backspace', 'Delete', 'Tab', 'Enter'].includes(key)
  }

  saveBeforeStateToHistory(state: InputState) {
    this.history.saveBeforeState({
      lines: [...state.lines],
      caret: null, // Don't save caret position - it's not relevant for most operations
      selection: null, // Don't save selection in history - it's not relevant for most operations
      widgets: this.getWidgets ? this.getWidgets() : undefined,
    })
  }

  saveAfterStateToHistory(state: InputState) {
    this.history.saveAfterState({
      lines: [...state.lines],
      caret: { ...state.caret }, // Save final caret position after content changes
      selection: null, // Don't save selection in history - it's not relevant for most operations
      widgets: this.getWidgets ? this.getWidgets() : undefined,
    })
  }

  saveDebouncedBeforeStateToHistory(state: InputState) {
    this.history.saveDebouncedBeforeState({
      lines: [...state.lines],
      caret: { ...state.caret }, // Save caret position for character input to restore properly on undo
      selection: null, // Don't save selection in history - it's not relevant for most operations
      widgets: this.getWidgets ? this.getWidgets() : undefined,
    })
  }

  saveDebouncedAfterStateToHistory(state: InputState) {
    this.history.saveDebouncedAfterState({
      lines: [...state.lines],
      caret: { ...state.caret }, // Save final caret position after content changes
      selection: null, // Don't save selection in history - it's not relevant for most operations
      widgets: this.getWidgets ? this.getWidgets() : undefined,
    })
  }

  // Special method for operations that actually use selection
  saveBeforeStateWithSelectionToHistory(state: InputState) {
    this.history.saveBeforeState({
      lines: [...state.lines],
      caret: null, // Don't save caret position - it's not relevant for most operations
      selection: state.selection
        ? {
            start: { ...state.selection.start },
            end: { ...state.selection.end },
          }
        : null,
      widgets: this.getWidgets ? this.getWidgets() : undefined,
    })
  }

  saveAfterStateWithSelectionToHistory(state: InputState) {
    this.history.saveAfterState({
      lines: [...state.lines],
      caret: { ...state.caret }, // Save final caret position after content changes
      selection: state.selection
        ? {
            start: { ...state.selection.start },
            end: { ...state.selection.end },
          }
        : null,
      widgets: this.getWidgets ? this.getWidgets() : undefined,
    })
  }

  // Special method for operations that need caret position in before state (like Cut, Paste)
  saveBeforeStateWithCaretAndSelectionToHistory(state: InputState) {
    this.history.saveBeforeState({
      lines: [...state.lines],
      caret: { ...state.caret }, // Save caret position before operation
      selection: state.selection
        ? {
            start: { ...state.selection.start },
            end: { ...state.selection.end },
          }
        : null,
      widgets: this.getWidgets ? this.getWidgets() : undefined,
    })
  }

  saveBeforeStateWithCaretToHistory(state: InputState) {
    this.history.saveBeforeState({
      lines: [...state.lines],
      caret: { ...state.caret }, // Save caret position before operation
      selection: null, // Don't save selection in history - it's not relevant for most operations
      widgets: this.getWidgets ? this.getWidgets() : undefined,
    })
  }

  saveSelectionToHistory(newState: InputState) {
    // Save selection changes to history
    this.saveBeforeStateToHistory(newState)
    this.saveAfterStateToHistory(newState)
  }

  private moveCaretLeft(state: InputState) {
    // Try word-wrap-aware movement first
    if (this.movementCallbacks.getCaretForHorizontalMove) {
      const result = this.movementCallbacks.getCaretForHorizontalMove(
        'left',
        state.caret.line,
        state.caret.column,
      )
      if (result) {
        state.caret.line = result.line
        state.caret.column = result.column
        state.caret.columnIntent = result.columnIntent
        return
      }
    }

    // Default logical movement
    if (state.caret.column > 0) {
      state.caret.column--
      state.caret.columnIntent = state.caret.column
    } else if (state.caret.line > 0) {
      state.caret.line--
      state.caret.column = state.lines[state.caret.line]?.length || 0
      state.caret.columnIntent = state.caret.column
    }
  }

  private moveCaretRight(state: InputState) {
    // Try word-wrap-aware movement first
    if (this.movementCallbacks.getCaretForHorizontalMove) {
      const result = this.movementCallbacks.getCaretForHorizontalMove(
        'right',
        state.caret.line,
        state.caret.column,
      )
      if (result) {
        state.caret.line = result.line
        state.caret.column = result.column
        state.caret.columnIntent = result.columnIntent
        return
      }
    }

    // Default logical movement
    const currentLine = state.lines[state.caret.line] || ''
    if (state.caret.column < currentLine.length) {
      state.caret.column++
      state.caret.columnIntent = state.caret.column
    } else if (state.caret.line < state.lines.length - 1) {
      state.caret.line++
      state.caret.column = 0
      state.caret.columnIntent = 0
    }
  }

  private moveCaretUp(state: InputState) {
    // Try word-wrap-aware movement first
    if (this.movementCallbacks.getCaretForVerticalMove) {
      const result = this.movementCallbacks.getCaretForVerticalMove(
        'up',
        state.caret.line,
        state.caret.columnIntent,
      )
      if (result) {
        state.caret.line = result.line
        state.caret.column = result.column
        return
      }
    }

    // Default logical movement
    if (state.caret.line > 0) {
      state.caret.line--
      const targetLine = state.lines[state.caret.line] || ''
      state.caret.column = Math.min(state.caret.columnIntent, targetLine.length)
    }
  }

  private moveCaretDown(state: InputState) {
    // Try word-wrap-aware movement first
    if (this.movementCallbacks.getCaretForVerticalMove) {
      const result = this.movementCallbacks.getCaretForVerticalMove(
        'down',
        state.caret.line,
        state.caret.columnIntent,
      )
      if (result) {
        state.caret.line = result.line
        state.caret.column = result.column
        return
      }
    }

    // Default logical movement
    if (state.caret.line < state.lines.length - 1) {
      state.caret.line++
      const targetLine = state.lines[state.caret.line] || ''
      state.caret.column = Math.min(state.caret.columnIntent, targetLine.length)
    }
  }

  private moveCaretPageUp(state: InputState) {
    const pageSize = 10 // Number of lines to move up
    const newLine = Math.max(0, state.caret.line - pageSize)
    if (newLine !== state.caret.line) {
      state.caret.line = newLine
      const targetLine = state.lines[state.caret.line] || ''
      state.caret.column = Math.min(state.caret.columnIntent, targetLine.length)
    } else {
      // Already at the first line – jump to column 0
      state.caret.column = 0
      state.caret.columnIntent = 0
    }
  }

  private moveCaretPageDown(state: InputState) {
    const pageSize = 10 // Number of lines to move down
    const newLine = Math.min(state.lines.length - 1, state.caret.line + pageSize)
    if (newLine !== state.caret.line) {
      state.caret.line = newLine
      const targetLine = state.lines[state.caret.line] || ''
      state.caret.column = Math.min(state.caret.columnIntent, targetLine.length)
    } else {
      // Already at the last line – jump to last column
      const currentLine = state.lines[state.caret.line] || ''
      state.caret.column = currentLine.length
      state.caret.columnIntent = currentLine.length
    }
  }

  private moveCaretToLineStart(state: InputState) {
    // Try word-wrap-aware movement first
    if (this.movementCallbacks.getCaretForLineStart) {
      const result = this.movementCallbacks.getCaretForLineStart(
        state.caret.line,
        state.caret.column,
      )
      if (result) {
        state.caret.line = result.line
        state.caret.column = result.column
        state.caret.columnIntent = result.columnIntent
        return
      }
    }

    // Smart Home behavior:
    // 1. If at beginning (column 0) → move to first non-whitespace
    // 2. If at first non-whitespace → move to beginning (column 0)
    // 3. If in middle (after first non-whitespace) → move to first non-whitespace
    const currentLine = state.lines[state.caret.line] || ''
    const firstNonWhitespace = currentLine.search(/\S/)
    const firstNonWhitespaceColumn = firstNonWhitespace === -1 ? currentLine.length : firstNonWhitespace

    if (state.caret.column === 0) {
      // At beginning → move to first non-whitespace
      state.caret.column = firstNonWhitespaceColumn
      state.caret.columnIntent = firstNonWhitespaceColumn
    } else if (state.caret.column === firstNonWhitespaceColumn) {
      // At first non-whitespace → move to beginning
      state.caret.column = 0
      state.caret.columnIntent = 0
    } else {
      // In middle → move to first non-whitespace
      state.caret.column = firstNonWhitespaceColumn
      state.caret.columnIntent = firstNonWhitespaceColumn
    }
  }

  private moveCaretToLineEnd(state: InputState) {
    // Try word-wrap-aware movement first
    if (this.movementCallbacks.getCaretForLineEnd) {
      const result = this.movementCallbacks.getCaretForLineEnd(state.caret.line, state.caret.column)
      if (result) {
        state.caret.line = result.line
        state.caret.column = result.column
        state.caret.columnIntent = result.columnIntent
        return
      }
    }

    // Default logical movement
    const currentLine = state.lines[state.caret.line] || ''
    state.caret.column = currentLine.length
    state.caret.columnIntent = currentLine.length
  }

  private isWordChar(char: string): boolean {
    return /[a-zA-Z0-9_]/.test(char)
  }

  private findWordStart(line: string, startColumn: number): number {
    if (startColumn <= 0) return 0

    let column = startColumn - 1
    const startChar = line[column]

    if (!startChar) return column

    // If we're starting on whitespace, move left through whitespace
    if (/\s/.test(startChar)) {
      while (column > 0 && /\s/.test(line[column - 1])) {
        column--
      }
    } else if (this.isWordChar(startChar)) {
      // If we're on a word character, move to start of word
      while (column > 0 && this.isWordChar(line[column - 1])) {
        column--
      }
    } else {
      // If we're on punctuation, move to start of punctuation group
      while (column > 0 && !this.isWordChar(line[column - 1]) && !/\s/.test(line[column - 1])) {
        column--
      }
    }

    return column
  }

  private findWordEnd(line: string, startColumn: number): number {
    if (startColumn >= line.length) return line.length

    let column = startColumn
    const startChar = line[column]

    if (!startChar) return column

    // If we're starting on whitespace, move right through whitespace
    if (/\s/.test(startChar)) {
      while (column < line.length && /\s/.test(line[column])) {
        column++
      }
    } else if (this.isWordChar(startChar)) {
      // If we're on a word character, move to end of word
      while (column < line.length && this.isWordChar(line[column])) {
        column++
      }
    } else {
      // If we're on punctuation, move to end of punctuation group
      while (column < line.length && !this.isWordChar(line[column]) && !/\s/.test(line[column])) {
        column++
      }
    }

    return column
  }

  private moveCaretWordLeft(state: InputState) {
    const currentLine = state.lines[state.caret.line] || ''

    if (state.caret.column > 0) {
      // Find the start of the current or previous word
      const newColumn = this.findWordStart(currentLine, state.caret.column)
      state.caret.column = newColumn
      state.caret.columnIntent = newColumn
    } else if (state.caret.line > 0) {
      // Move to end of previous line
      state.caret.line--
      const prevLine = state.lines[state.caret.line] || ''
      state.caret.column = prevLine.length
      state.caret.columnIntent = state.caret.column
    }
  }

  private moveCaretWordRight(state: InputState) {
    const currentLine = state.lines[state.caret.line] || ''

    if (state.caret.column < currentLine.length) {
      // Find the end of the current or next word
      const newColumn = this.findWordEnd(currentLine, state.caret.column)
      state.caret.column = newColumn
      state.caret.columnIntent = newColumn
    } else if (state.caret.line < state.lines.length - 1) {
      // Move to start of next line
      state.caret.line++
      state.caret.column = 0
      state.caret.columnIntent = 0
    }
  }

  private deleteWordLeft(state: InputState) {
    // Flush any pending debounced state before non-character operations
    this.history.flushDebouncedState(state)

    // If there's a non-empty selection, delete it as-is
    if (state.selection && !this.isSelectionEmpty(state.selection)) {
      this.saveBeforeStateWithCaretAndSelectionToHistory(state)
      this.deleteSelection(state)
      this.saveAfterStateWithSelectionToHistory(state)
      return
    }

    // Clear any empty selection
    if (state.selection && this.isSelectionEmpty(state.selection)) {
      state.selection = null
    }

    // Save before state with caret position
    this.saveBeforeStateWithCaretToHistory(state)

    const line = state.lines[state.caret.line] || ''

    if (state.caret.column > 0) {
      const startCol = this.findWordStart(line, state.caret.column)
      const newLine = line.slice(0, startCol) + line.slice(state.caret.column)
      state.lines[state.caret.line] = newLine
      state.caret.column = startCol
      state.caret.columnIntent = startCol
    } else if (state.caret.line > 0) {
      // Merge with previous line when at column 0
      const prev = state.lines[state.caret.line - 1] || ''
      const newLine = prev + line
      state.lines[state.caret.line - 1] = newLine
      state.lines.splice(state.caret.line, 1)
      state.caret.line--
      state.caret.column = prev.length
      state.caret.columnIntent = state.caret.column
    }

    // Save after state
    this.saveAfterStateToHistory(state)
  }

  private deleteWordRight(state: InputState) {
    // Flush any pending debounced state before non-character operations
    this.history.flushDebouncedState(state)

    // If there's a non-empty selection, delete it as-is
    if (state.selection && !this.isSelectionEmpty(state.selection)) {
      this.saveBeforeStateWithCaretAndSelectionToHistory(state)
      this.deleteSelection(state)
      this.saveAfterStateWithSelectionToHistory(state)
      return
    }

    // Clear any empty selection
    if (state.selection && this.isSelectionEmpty(state.selection)) {
      state.selection = null
    }

    // Save before state with caret position
    this.saveBeforeStateWithCaretToHistory(state)

    const line = state.lines[state.caret.line] || ''

    if (state.caret.column < line.length) {
      const endCol = this.findWordEnd(line, state.caret.column)
      const newLine = line.slice(0, state.caret.column) + line.slice(endCol)
      state.lines[state.caret.line] = newLine
      // Caret stays at same column
    } else if (state.caret.line < state.lines.length - 1) {
      // Merge with next line when at end of line
      const next = state.lines[state.caret.line + 1] || ''
      const newLine = line + next
      state.lines[state.caret.line] = newLine
      state.lines.splice(state.caret.line + 1, 1)
      // Caret column unchanged
    }

    // Save after state
    this.saveAfterStateToHistory(state)
  }

  private handleBackspace(state: InputState) {
    // Flush any pending debounced state before non-character operations
    this.history.flushDebouncedState(state)

    // If there's a non-empty selection, save it in history since we're deleting it
    if (state.selection && !this.isSelectionEmpty(state.selection)) {
      this.saveBeforeStateWithCaretAndSelectionToHistory(state)
      this.deleteSelection(state)
      this.saveAfterStateWithSelectionToHistory(state)
      return
    }

    // Clear any empty selection before proceeding with normal backspace
    if (state.selection && this.isSelectionEmpty(state.selection)) {
      state.selection = null
    }

    // No selection - save before state with caret position since we're changing it
    this.saveBeforeStateWithCaretToHistory(state)

    const currentLine = state.lines[state.caret.line] || ''

    if (state.caret.column > 0) {
      // Delete character before cursor
      const newLine =
        currentLine.slice(0, state.caret.column - 1) + currentLine.slice(state.caret.column)
      state.lines[state.caret.line] = newLine
      state.caret.column--
      state.caret.columnIntent = state.caret.column
    } else if (state.caret.line > 0) {
      // Merge with previous line
      const prevLine = state.lines[state.caret.line - 1] || ''
      const newLine = prevLine + currentLine
      state.lines[state.caret.line - 1] = newLine
      state.lines.splice(state.caret.line, 1)
      state.caret.line--
      state.caret.column = prevLine.length
      state.caret.columnIntent = state.caret.column
    }

    // Save after state
    this.saveAfterStateToHistory(state)
  }

  private handleDelete(state: InputState) {
    // Flush any pending debounced state before non-character operations
    this.history.flushDebouncedState(state)

    // If there's a non-empty selection, save it in history since we're deleting it
    if (state.selection && !this.isSelectionEmpty(state.selection)) {
      this.saveBeforeStateWithCaretAndSelectionToHistory(state)
      this.deleteSelection(state)
      this.saveAfterStateWithSelectionToHistory(state)
      return
    }

    // Clear any empty selection before proceeding with normal delete
    if (state.selection && this.isSelectionEmpty(state.selection)) {
      state.selection = null
    }

    // No selection - save before state with caret position since we're changing it
    this.saveBeforeStateWithCaretToHistory(state)

    const currentLine = state.lines[state.caret.line] || ''

    if (state.caret.column < currentLine.length) {
      // Delete character after cursor
      const newLine =
        currentLine.slice(0, state.caret.column) + currentLine.slice(state.caret.column + 1)
      state.lines[state.caret.line] = newLine
    } else if (state.caret.line < state.lines.length - 1) {
      // Merge with next line
      const nextLine = state.lines[state.caret.line + 1] || ''
      const newLine = currentLine + nextLine
      state.lines[state.caret.line] = newLine
      state.lines.splice(state.caret.line + 1, 1)
    }

    // Save after state
    this.saveAfterStateToHistory(state)
  }

  private deleteCurrentLine(state: InputState) {
    // Flush any pending debounced state before non-character operations
    this.history.flushDebouncedState(state)

    // Clear any selection since we're deleting the entire line
    if (state.selection) {
      state.selection = null
    }

    // Save before state with caret position
    this.saveBeforeStateWithCaretToHistory(state)

    // Store the current column position to preserve it
    const preservedColumn = state.caret.column
    const preservedColumnIntent = state.caret.columnIntent
    const isOnlyLine = state.lines.length === 1

    if (isOnlyLine) {
      // If it's the only line, just empty it instead of deleting
      state.lines[0] = ''
      state.caret.column = 0
      state.caret.columnIntent = 0
    } else {
      // Remove the current line
      state.lines.splice(state.caret.line, 1)

      // Adjust caret position
      if (state.caret.line >= state.lines.length) {
        // If we deleted the last line, move to the new last line
        state.caret.line = Math.max(0, state.lines.length - 1)
      }

      // Preserve the column position, but clamp it to the line length
      const currentLine = state.lines[state.caret.line] || ''
      state.caret.column = Math.min(preservedColumn, currentLine.length)
      state.caret.columnIntent = Math.min(preservedColumnIntent, currentLine.length)
    }

    // Save after state
    this.saveAfterStateToHistory(state)
  }

  private insertCharacter(state: InputState, char: string) {
    // If there's a non-empty selection, delete it first, then insert the character
    if (state.selection && !this.isSelectionEmpty(state.selection)) {
      this.saveDebouncedBeforeStateToHistory(state)
      this.deleteSelection(state)
      // Don't return here - continue to insert the character
    } else {
      // Clear any empty selection
      if (state.selection && this.isSelectionEmpty(state.selection)) {
        state.selection = null
      }
      // No selection - save before state for character input
      this.saveDebouncedBeforeStateToHistory(state)
    }

    const currentLine = state.lines[state.caret.line] || ''
    const newLine =
      currentLine.slice(0, state.caret.column) + char + currentLine.slice(state.caret.column)
    state.lines[state.caret.line] = newLine
    state.caret.column++
    state.caret.columnIntent = state.caret.column

    // Save after state with debouncing
    this.saveDebouncedAfterStateToHistory(state)
  }

  private handleTab(state: InputState) {
    // Flush any pending debounced state before non-character operations
    this.history.flushDebouncedState(state)

    // Check if we have a real selection (not just cursor position)
    const hasRealSelection =
      state.selection &&
      (state.selection.start.line !== state.selection.end.line ||
        state.selection.start.column !== state.selection.end.column)

    if (hasRealSelection) {
      // Save selection in history since we're modifying it
      this.saveBeforeStateWithSelectionToHistory(state)
      this.indentSelection(state)
      this.saveAfterStateWithSelectionToHistory(state)
    } else {
      // No selection - save before state without selection
      this.saveBeforeStateToHistory(state)

      // No selection or cursor position - insert spaces/tab characters
      const currentLine = state.lines[state.caret.line] || ''
      const spaces = '  ' // 2 spaces for indentation
      const newLine =
        currentLine.slice(0, state.caret.column) + spaces + currentLine.slice(state.caret.column)
      state.lines[state.caret.line] = newLine
      state.caret.column += spaces.length
      state.caret.columnIntent = state.caret.column

      // Save after state
      this.saveAfterStateToHistory(state)
    }
  }

  private handleShiftTab(state: InputState) {
    // Flush any pending debounced state before non-character operations
    this.history.flushDebouncedState(state)

    // Check if we have a real selection (not just cursor position)
    const hasRealSelection =
      state.selection &&
      (state.selection.start.line !== state.selection.end.line ||
        state.selection.start.column !== state.selection.end.column)

    if (hasRealSelection) {
      // Save selection in history since we're modifying it
      this.saveBeforeStateWithSelectionToHistory(state)
      this.unindentSelection(state)
      this.saveAfterStateWithSelectionToHistory(state)
    } else {
      // No selection - save before state without selection
      this.saveBeforeStateToHistory(state)

      // No selection or cursor position - unindent current line
      const currentLine = state.lines[state.caret.line] || ''
      const spaces = '  ' // 2 spaces for indentation

      // Find the start of the current line (after any existing indentation)
      const lineStart = currentLine.search(/\S/)
      const currentIndent = lineStart === -1 ? currentLine.length : lineStart

      if (currentIndent > 0) {
        // Calculate how many spaces to remove (up to 2, but not more than current indent)
        const spacesToRemove = Math.min(spaces.length, currentIndent)
        const newIndent = currentIndent - spacesToRemove

        // Create new line with reduced indentation
        const newLine = Array(newIndent + 1).join(' ') + currentLine.slice(currentIndent)
        state.lines[state.caret.line] = newLine

        // Adjust caret position if it was within the removed indentation
        if (state.caret.column <= currentIndent) {
          state.caret.column = Math.max(0, state.caret.column - spacesToRemove)
          state.caret.columnIntent = state.caret.column
        }
      }

      // Save after state
      this.saveAfterStateToHistory(state)
    }
  }

  private handleEnter(state: InputState) {
    // If there's a selection, delete it first
    if (state.selection) {
      this.deleteSelection(state)
    }

    const currentLine = state.lines[state.caret.line] || ''
    const beforeCaret = currentLine.slice(0, state.caret.column)
    const afterCaret = currentLine.slice(state.caret.column)

    // Get the indentation of the current line
    const lineStart = beforeCaret.search(/\S/)
    const currentIndent = lineStart === -1 ? beforeCaret.length : lineStart

    // Check if the line ends with an opening brace
    const trimmedBeforeCaret = beforeCaret.trim()
    const endsWithOpeningBrace = /[{([]$/.test(trimmedBeforeCaret)

    // Calculate indentation for the new line
    const spaces = '  ' // 2 spaces for indentation
    const newIndent = endsWithOpeningBrace ? currentIndent + spaces.length : currentIndent

    // Create new line with the calculated indentation
    const newLine = Array(newIndent + 1).join(' ')

    // Update current line to end at caret position
    state.lines[state.caret.line] = beforeCaret

    // Insert new line after current line
    state.lines.splice(state.caret.line + 1, 0, newLine + afterCaret)

    // Move caret to the new line at the calculated indentation level
    state.caret.line++
    state.caret.column = newIndent
    state.caret.columnIntent = newIndent
  }

  private indentSelection(state: InputState) {
    if (!state.selection) return

    const { start, end } = state.selection
    const spaces = '  ' // 2 spaces for indentation

    // Normalize selection (ensure start comes before end)
    const normalizedStart =
      start.line < end.line || (start.line === end.line && start.column <= end.column) ? start : end
    const normalizedEnd =
      start.line < end.line || (start.line === end.line && start.column <= end.column) ? end : start

    const firstLineToIndent = normalizedStart.line

    // If the end is at column 0, don't include that line in indentation
    const lastLineToIndent =
      normalizedEnd.column === 0 && normalizedEnd.line > normalizedStart.line
        ? normalizedEnd.line - 1
        : normalizedEnd.line

    // Indent all lines in the selection (excluding boundary lines if at column 0)
    for (let lineIndex = firstLineToIndent; lineIndex <= lastLineToIndent; lineIndex++) {
      const line = state.lines[lineIndex] || ''
      state.lines[lineIndex] = spaces + line
    }

    // Adjust selection boundaries - only adjust if the line was actually indented
    if (
      state.selection.start.line >= firstLineToIndent &&
      state.selection.start.line <= lastLineToIndent
    ) {
      state.selection.start.column += spaces.length
    }
    if (
      state.selection.end.line >= firstLineToIndent &&
      state.selection.end.line <= lastLineToIndent
    ) {
      state.selection.end.column += spaces.length
    }

    // Adjust caret position - only if the caret line was indented
    if (state.caret.line >= firstLineToIndent && state.caret.line <= lastLineToIndent) {
      state.caret.column += spaces.length
      state.caret.columnIntent = state.caret.column
    }
  }

  private unindentSelection(state: InputState) {
    if (!state.selection) return

    const { start, end } = state.selection
    const spaces = '  ' // 2 spaces for indentation

    // Normalize selection (ensure start comes before end)
    const normalizedStart =
      start.line < end.line || (start.line === end.line && start.column <= end.column) ? start : end
    const normalizedEnd =
      start.line < end.line || (start.line === end.line && start.column <= end.column) ? end : start

    const firstLineToUnindent = normalizedStart.line

    // If the end is at column 0, don't include that line in unindentation
    const lastLineToUnindent =
      normalizedEnd.column === 0 && normalizedEnd.line > normalizedStart.line
        ? normalizedEnd.line - 1
        : normalizedEnd.line

    // Track how much we actually removed from each line
    const removedPerLine: number[] = []

    // Unindent all lines in the selection (excluding boundary lines if at column 0)
    for (let lineIndex = firstLineToUnindent; lineIndex <= lastLineToUnindent; lineIndex++) {
      const line = state.lines[lineIndex] || ''

      // Find the start of the line (after any existing indentation)
      const lineStart = line.search(/\S/)
      const currentIndent = lineStart === -1 ? line.length : lineStart

      if (currentIndent > 0) {
        // Calculate how many spaces to remove (up to 2, but not more than current indent)
        const spacesToRemove = Math.min(spaces.length, currentIndent)
        const newIndent = currentIndent - spacesToRemove

        // Create new line with reduced indentation
        const newLine = Array(newIndent + 1).join(' ') + line.slice(currentIndent)
        state.lines[lineIndex] = newLine

        removedPerLine[lineIndex] = spacesToRemove
      } else {
        removedPerLine[lineIndex] = 0
      }
    }

    // Adjust selection boundaries based on what was actually removed
    const startLineRemoved = removedPerLine[state.selection.start.line] || 0
    const endLineRemoved = removedPerLine[state.selection.end.line] || 0

    // Adjust selection boundaries - only adjust if the line was actually unindented
    if (
      state.selection.start.line >= firstLineToUnindent &&
      state.selection.start.line <= lastLineToUnindent
    ) {
      state.selection.start.column = Math.max(0, state.selection.start.column - startLineRemoved)
    }
    if (
      state.selection.end.line >= firstLineToUnindent &&
      state.selection.end.line <= lastLineToUnindent
    ) {
      state.selection.end.column = Math.max(0, state.selection.end.column - endLineRemoved)
    }

    // Adjust caret position - only if the caret line was unindented
    if (state.caret.line >= firstLineToUnindent && state.caret.line <= lastLineToUnindent) {
      const caretLineRemoved = removedPerLine[state.caret.line] || 0
      state.caret.column = Math.max(0, state.caret.column - caretLineRemoved)
      state.caret.columnIntent = state.caret.column
    }
  }

  private isSelectionEmpty(selection: Selection): boolean {
    return isSelectionEmpty(selection)
  }

  private deleteSelection(state: InputState) {
    if (!state.selection) return

    const { start, end } = state.selection

    // Normalize selection (ensure start comes before end)
    const normalizedStart =
      start.line < end.line || (start.line === end.line && start.column <= end.column) ? start : end
    const normalizedEnd =
      start.line < end.line || (start.line === end.line && start.column <= end.column) ? end : start

    if (normalizedStart.line === normalizedEnd.line) {
      // Single line selection
      const line = state.lines[normalizedStart.line] || ''
      const newLine = line.slice(0, normalizedStart.column) + line.slice(normalizedEnd.column)
      state.lines[normalizedStart.line] = newLine

      // Move caret to start of selection
      state.caret.line = normalizedStart.line
      state.caret.column = normalizedStart.column
      state.caret.columnIntent = state.caret.column
    } else {
      // Multi-line selection
      const startLine = state.lines[normalizedStart.line] || ''
      const endLine = state.lines[normalizedEnd.line] || ''

      // Merge start and end lines
      const newStartLine =
        startLine.slice(0, normalizedStart.column) + endLine.slice(normalizedEnd.column)
      state.lines[normalizedStart.line] = newStartLine

      // Remove middle lines
      state.lines.splice(normalizedStart.line + 1, normalizedEnd.line - normalizedStart.line)

      // Move caret to start of selection
      state.caret.line = normalizedStart.line
      state.caret.column = normalizedStart.column
      state.caret.columnIntent = state.caret.column
    }

    // Clear selection
    state.selection = null
  }

  handleUndo(state: InputState, skipHistoryUndo: boolean = false): Array<{ line: number; column: number; type: string; length: number; height?: number }> | null {
    // Flush any pending debounced state before undo
    this.history.flushDebouncedState(state)

    // If skipHistoryUndo is true, the caller already called history.undo() and has the previousState
    // We just need to update the state without calling undo again
    const previousState = skipHistoryUndo ? null : this.history.undo()
    if (previousState) {
      state.lines = [...previousState.lines]
      // Only restore caret if it was saved in history
      if (previousState.caret) {
        state.caret = { ...previousState.caret }
      }
      // Only restore selection if it was saved in history
      state.selection = previousState.selection
        ? {
            start: { ...previousState.selection.start },
            end: { ...previousState.selection.end },
          }
        : null

      // Update the React component state
      this.onStateChange({
        lines: [...state.lines],
        caret: { ...state.caret },
        selection: state.selection
          ? {
              start: { ...state.selection.start },
              end: { ...state.selection.end },
            }
          : null,
      })

      const widgetData = previousState.widgets ? previousState.widgets.map(w => ({ ...w })) : null
      return widgetData
    }
    return null
  }

  handleRedo(state: InputState): Array<{ line: number; column: number; type: string; length: number; height?: number }> | null {
    // Flush any pending debounced state before redo
    this.history.flushDebouncedState(state)

    const nextState = this.history.redo()
    if (nextState) {
      state.lines = [...nextState.lines]
      // Only restore caret if it was saved in history
      if (nextState.caret) {
        state.caret = { ...nextState.caret }
      }
      // Only restore selection if it was saved in history
      state.selection = nextState.selection
        ? {
            start: { ...nextState.selection.start },
            end: { ...nextState.selection.end },
          }
        : null

      // Update the React component state
      this.onStateChange({
        lines: [...state.lines],
        caret: { ...state.caret },
        selection: state.selection
          ? {
              start: { ...state.selection.start },
              end: { ...state.selection.end },
            }
          : null,
      })

      return nextState.widgets ? nextState.widgets.map(w => ({ ...w })) : null
    }
    return null
  }

  handleSelectAll(currentState: InputState) {
    const newState = { ...currentState }

    // Create selection from start of first line to end of last line
    const firstLine = 0
    const lastLine = newState.lines.length - 1
    const lastLineLength = newState.lines[lastLine]?.length || 0

    newState.selection = {
      start: { line: firstLine, column: 0 },
      end: { line: lastLine, column: lastLineLength },
    }

    // Move caret to the end of selection
    newState.caret.line = lastLine
    newState.caret.column = lastLineLength
    newState.caret.columnIntent = lastLineLength

    // Update the state
    this.onStateChange({
      lines: [...newState.lines],
      caret: { ...newState.caret },
      selection: {
        start: { ...newState.selection.start },
        end: { ...newState.selection.end },
      },
    })
  }

  handleCut(currentState: InputState) {
    // Handle cut operation: copy selected text to clipboard and delete selection
    const newState = { ...currentState }

    // Flush any pending debounced state before non-character operations
    this.history.flushDebouncedState(newState)

    // If there's a selection, save it in history since we're deleting it
    if (newState.selection) {
      this.saveBeforeStateWithCaretAndSelectionToHistory(newState)

      // Copy selected text to clipboard
      const selectedText = getSelectedText({ ...currentState })
      if (selectedText) {
        navigator.clipboard.writeText(selectedText).catch(err => {
          console.error('Failed to copy to clipboard:', err)
        })
      }

      // Delete the selection
      this.deleteSelection(newState)

      this.saveAfterStateWithSelectionToHistory(newState)
    } else {
      // No selection - save before state with caret position
      this.saveBeforeStateWithCaretToHistory(newState)
      this.saveAfterStateToHistory(newState)
    }

    // Update the state - ensure we create a new object for React
    this.onStateChange({
      lines: [...newState.lines],
      caret: { ...newState.caret },
      selection: newState.selection
        ? {
            start: { ...newState.selection.start },
            end: { ...newState.selection.end },
          }
        : null,
    })
  }

  handlePaste(text: string, currentState: InputState) {
    const newState = { ...currentState }

    // Flush any pending debounced state before non-character operations
    this.history.flushDebouncedState(newState)

    // If there's a selection, save it in history since we're deleting it
    if (newState.selection) {
      this.saveBeforeStateWithCaretAndSelectionToHistory(newState)
      this.deleteSelection(newState)
      this.insertText(newState, text)
      this.saveAfterStateWithSelectionToHistory(newState)
    } else {
      // No selection - save before state with caret position
      this.saveBeforeStateWithCaretToHistory(newState)
      this.insertText(newState, text)
      this.saveAfterStateToHistory(newState)
    }

    // Update the state - ensure we create a new object for React
    this.onStateChange({
      lines: [...newState.lines],
      caret: { ...newState.caret },
      selection: newState.selection
        ? {
            start: { ...newState.selection.start },
            end: { ...newState.selection.end },
          }
        : null,
    })
  }

  handlePasteEvent(event: preact.TargetedClipboardEvent<HTMLTextAreaElement>, currentState: InputState) {
    event.preventDefault()

    const text = event.clipboardData?.getData('text/plain')
    if (text) {
      this.handlePaste(text, currentState)
    }
  }

  // Method to flush any pending debounced history state
  // Should be called on blur, unmount, or before any operation that needs clean history
  flushHistory(currentState: InputState) {
    this.history.flushDebouncedState(currentState)
  }

  private insertText(state: InputState, text: string) {
    const lines = text.split('\n')

    if (lines.length === 1) {
      // Single line paste
      const currentLine = state.lines[state.caret.line] || ''
      const newLine =
        currentLine.slice(0, state.caret.column) + text + currentLine.slice(state.caret.column)
      state.lines[state.caret.line] = newLine
      state.caret.column += text.length
      state.caret.columnIntent = state.caret.column
    } else {
      // Multi-line paste
      const currentLine = state.lines[state.caret.line] || ''
      const beforeCaret = currentLine.slice(0, state.caret.column)
      const afterCaret = currentLine.slice(state.caret.column)

      // Replace current line with first line of pasted text
      state.lines[state.caret.line] = beforeCaret + lines[0]

      // Insert middle lines
      for (let i = 1; i < lines.length - 1; i++) {
        state.lines.splice(state.caret.line + i, 0, lines[i])
      }

      // Insert last line
      if (lines.length > 1) {
        const lastLine = lines[lines.length - 1] + afterCaret
        state.lines.splice(state.caret.line + lines.length - 1, 0, lastLine)
      }

      // Update caret position
      state.caret.line += lines.length - 1
      state.caret.column = lines[lines.length - 1].length
      state.caret.columnIntent = state.caret.column
    }
  }

  private moveLineUp(state: InputState) {
    // Flush any pending debounced state before line move operation
    this.history.flushDebouncedState(state)

    if (state.selection && !this.isSelectionEmpty(state.selection)) {
      // Move selection lines
      this.moveSelectionLinesUp(state)
    } else {
      // Clear any empty selection and move current line
      if (state.selection && this.isSelectionEmpty(state.selection)) {
        state.selection = null
      }
      this.moveCurrentLineUp(state)
    }
  }

  private moveLineDown(state: InputState) {
    // Flush any pending debounced state before line move operation
    this.history.flushDebouncedState(state)

    if (state.selection && !this.isSelectionEmpty(state.selection)) {
      // Move selection lines
      this.moveSelectionLinesDown(state)
    } else {
      // Clear any empty selection and move current line
      if (state.selection && this.isSelectionEmpty(state.selection)) {
        state.selection = null
      }
      this.moveCurrentLineDown(state)
    }
  }

  private moveCurrentLineUp(state: InputState) {
    if (state.caret.line > 0) {
      // Save before state for undo
      this.saveBeforeStateWithCaretToHistory(state)

      // Swap current line with the line above
      const currentLine = state.lines[state.caret.line]
      const previousLine = state.lines[state.caret.line - 1]

      state.lines[state.caret.line - 1] = currentLine
      state.lines[state.caret.line] = previousLine

      // Move caret up
      state.caret.line--
      state.caret.columnIntent = state.caret.column

      // Save after state for undo
      this.saveAfterStateToHistory(state)
    }
  }

  private moveCurrentLineDown(state: InputState) {
    if (state.caret.line < state.lines.length - 1) {
      // Save before state for undo
      this.saveBeforeStateWithCaretToHistory(state)

      // Swap current line with the line below
      const currentLine = state.lines[state.caret.line]
      const nextLine = state.lines[state.caret.line + 1]

      state.lines[state.caret.line + 1] = currentLine
      state.lines[state.caret.line] = nextLine

      // Move caret down
      state.caret.line++
      state.caret.columnIntent = state.caret.column

      // Save after state for undo
      this.saveAfterStateToHistory(state)
    }
  }

  private moveSelectionLinesUp(state: InputState) {
    if (!state.selection) return

    const { start, end } = state.selection

    // Normalize selection (ensure start comes before end)
    const normalizedStart =
      start.line < end.line || (start.line === end.line && start.column <= end.column) ? start : end
    const normalizedEnd =
      start.line < end.line || (start.line === end.line && start.column <= end.column) ? end : start

    // Can't move if first line is already at top
    if (normalizedStart.line === 0) return

    // Save before state for undo
    this.saveBeforeStateWithCaretAndSelectionToHistory(state)

    // Get the line above the selection
    const lineAbove = state.lines[normalizedStart.line - 1]

    // Remove the line above and insert it after the selection
    state.lines.splice(normalizedStart.line - 1, 1)
    state.lines.splice(normalizedEnd.line, 0, lineAbove)

    // Adjust selection positions
    state.selection.start.line--
    state.selection.end.line--

    // Adjust caret position
    state.caret.line--

    // Save after state for undo
    this.saveAfterStateWithSelectionToHistory(state)
  }

  private moveSelectionLinesDown(state: InputState) {
    if (!state.selection) return

    const { start, end } = state.selection

    // Normalize selection (ensure start comes before end)
    const normalizedStart =
      start.line < end.line || (start.line === end.line && start.column <= end.column) ? start : end
    const normalizedEnd =
      start.line < end.line || (start.line === end.line && start.column <= end.column) ? end : start

    // Can't move if last line is already at bottom
    if (normalizedEnd.line === state.lines.length - 1) return

    // Save before state for undo
    this.saveBeforeStateWithCaretAndSelectionToHistory(state)

    // Get the line below the selection
    const lineBelow = state.lines[normalizedEnd.line + 1]

    // Remove the line below and insert it before the selection
    state.lines.splice(normalizedEnd.line + 1, 1)
    state.lines.splice(normalizedStart.line, 0, lineBelow)

    // Adjust selection positions
    state.selection.start.line++
    state.selection.end.line++

    // Adjust caret position
    state.caret.line++

    // Save after state for undo
    this.saveAfterStateWithSelectionToHistory(state)
  }

  private handleToggleLineComment(state: InputState) {
    // Flush any pending debounced state before non-character operations
    this.history.flushDebouncedState(state)

    // Determine target lines
    let firstLine: number
    let lastLine: number
    let hasRealSelection = false

    if (state.selection && !this.isSelectionEmpty(state.selection)) {
      hasRealSelection = true
      const { start, end } = state.selection

      const normalizedStart =
        start.line < end.line || (start.line === end.line && start.column <= end.column)
          ? start
          : end
      const normalizedEnd =
        start.line < end.line || (start.line === end.line && start.column <= end.column)
          ? end
          : start

      firstLine = normalizedStart.line
      // Exclude last line if selection ends at column 0 (like typical editors)
      lastLine =
        normalizedEnd.column === 0 && normalizedEnd.line > normalizedStart.line
          ? normalizedEnd.line - 1
          : normalizedEnd.line
    } else {
      firstLine = state.caret.line
      lastLine = state.caret.line
    }

    // Compute leftmost indentation among target lines (ignore blank lines)
    let baseIndent = Infinity
    let hasNonBlank = false
    for (let i = firstLine; i <= lastLine; i++) {
      const line = state.lines[i] || ''
      const lineStart = line.search(/\S/)
      if (lineStart !== -1) {
        hasNonBlank = true
        if (lineStart < baseIndent) baseIndent = lineStart
      }
    }
    if (!hasNonBlank || baseIndent === Infinity) baseIndent = 0

    // Decide whether to comment or uncomment: all non-blank lines already have // at baseIndent
    let shouldUncomment = true
    for (let i = firstLine; i <= lastLine; i++) {
      const original = state.lines[i] || ''
      if (original.trim() === '') continue
      const line =
        original.length < baseIndent
          ? original + ' '.repeat(baseIndent - original.length)
          : original
      const restAtBase = line.slice(baseIndent)
      if (!(restAtBase.startsWith('//') || restAtBase.startsWith('// '))) {
        shouldUncomment = false
        break
      }
    }

    // Save before state (with selection if present)
    if (hasRealSelection) {
      this.saveBeforeStateWithSelectionToHistory(state)
    } else {
      this.saveBeforeStateWithCaretToHistory(state)
    }

    // Track per-line delta to adjust selection and caret
    const deltaPerLine: number[] = []

    for (let i = firstLine; i <= lastLine; i++) {
      let line = state.lines[i] || ''
      const targetIndex = baseIndent

      if (line.length < targetIndex) {
        line = line + ' '.repeat(targetIndex - line.length)
      }

      if (shouldUncomment) {
        const rest = line.slice(targetIndex)
        if (rest.startsWith('//')) {
          const removeSpace = rest.length > 2 && rest[2] === ' '
          const removeCount = 2 + (removeSpace ? 1 : 0)
          const newLine = line.slice(0, targetIndex) + rest.slice(removeCount)
          state.lines[i] = newLine
          deltaPerLine[i] = -removeCount
        } else {
          state.lines[i] = line
          deltaPerLine[i] = 0
        }
      } else {
        const commentToken = '// '
        const newLine = line.slice(0, targetIndex) + commentToken + line.slice(targetIndex)
        state.lines[i] = newLine
        deltaPerLine[i] = commentToken.length
      }
    }

    // Adjust selection boundaries and caret
    const adjust = (column: number, delta: number): number =>
      column >= baseIndent ? Math.max(0, column + delta) : column

    if (hasRealSelection && state.selection) {
      const startLine = state.selection.start.line
      const endLine = state.selection.end.line
      const startDelta = deltaPerLine[startLine] || 0
      const endDelta = deltaPerLine[endLine] || 0

      state.selection.start.column = adjust(state.selection.start.column, startDelta)
      state.selection.end.column = adjust(state.selection.end.column, endDelta)

      // Adjust caret from its original position using the delta for its line
      // This ensures the caret is correctly positioned even if it wasn't exactly at selection end
      if (state.caret.line >= firstLine && state.caret.line <= lastLine) {
        // Caret is on a commented line, adjust it
        const caretLine = state.caret.line
        const caretDelta = deltaPerLine[caretLine] || 0
        state.caret.column = adjust(state.caret.column, caretDelta)
        state.caret.columnIntent = state.caret.column
      } else if (endLine > lastLine && state.selection.end.column === 0) {
        // Selection ended at start of line after last commented line
        // Position caret at end of last commented line
        const lastLineContent = state.lines[lastLine] || ''
        state.caret.line = lastLine
        state.caret.column = lastLineContent.length
        state.caret.columnIntent = lastLineContent.length
      } else {
        // Caret is not on a commented line, set it to match selection end
        state.caret.line = endLine
        state.caret.column = state.selection.end.column
        state.caret.columnIntent = state.selection.end.column
      }
    } else {
      // Adjust caret if it's on an affected line and after insert position
      if (state.caret.line >= firstLine && state.caret.line <= lastLine) {
        const caretLine = state.caret.line
        const delta = deltaPerLine[caretLine] || 0
        const insertCol = baseIndent
        if (state.caret.column >= insertCol) {
          state.caret.column = Math.max(0, state.caret.column + delta)
          state.caret.columnIntent = state.caret.column
        }
      }
    }

    // Save after state
    if (hasRealSelection) {
      this.saveAfterStateWithSelectionToHistory(state)
    } else {
      this.saveAfterStateToHistory(state)
    }

    // Update the state - ensure we create a new object for React
    this.onStateChange({
      lines: [...state.lines],
      caret: { ...state.caret },
      selection: state.selection
        ? {
            start: { ...state.selection.start },
            end: { ...state.selection.end },
          }
        : null,
    })
  }

  handleDuplicateLines(currentState: InputState) {
    const newState = { ...currentState }

    // Flush any pending debounced state before non-character operations
    this.history.flushDebouncedState(newState)

    // Store original caret position to keep it
    const originalCaret = { ...newState.caret }

    // Determine target lines
    let firstLine: number
    let lastLine: number
    let hasRealSelection = false
    let originalSelection: Selection | null = null

    if (newState.selection && !this.isSelectionEmpty(newState.selection)) {
      hasRealSelection = true
      const { start, end } = newState.selection

      const normalizedStart =
        start.line < end.line || (start.line === end.line && start.column <= end.column)
          ? start
          : end
      const normalizedEnd =
        start.line < end.line || (start.line === end.line && start.column <= end.column)
          ? end
          : start

      firstLine = normalizedStart.line
      lastLine = normalizedEnd.line

      // Store original selection boundaries
      originalSelection = {
        start: { ...normalizedStart },
        end: { ...normalizedEnd },
      }
    } else {
      firstLine = newState.caret.line
      lastLine = newState.caret.line
    }

    // Save before state
    if (hasRealSelection) {
      this.saveBeforeStateWithSelectionToHistory(newState)
    } else {
      this.saveBeforeStateWithCaretToHistory(newState)
    }

    // Get lines to duplicate
    const linesToDuplicate: string[] = []
    for (let i = firstLine; i <= lastLine; i++) {
      linesToDuplicate.push(newState.lines[i] || '')
    }

    // Insert duplicated lines after the last line
    const insertIndex = lastLine + 1
    newState.lines.splice(insertIndex, 0, ...linesToDuplicate)

    // Move caret to the duplicated lines at the same relative position
    if (originalCaret.line >= firstLine && originalCaret.line <= lastLine) {
      // Caret is within the duplicated range, move it to the corresponding position
      const relativeLine = originalCaret.line - firstLine
      const newCaretLine = insertIndex + relativeLine
      const newCaretLineContent = newState.lines[newCaretLine] || ''
      // Clamp column to line length
      newState.caret.line = newCaretLine
      newState.caret.column = Math.min(originalCaret.column, newCaretLineContent.length)
      newState.caret.columnIntent = newState.caret.column
    } else {
      // Caret is outside the duplicated range, keep it at original position
      newState.caret = { ...originalCaret }
    }

    // If there was a selection, move it to the duplicated lines
    if (hasRealSelection && originalSelection) {
      newState.selection = {
        start: {
          line: insertIndex + (originalSelection.start.line - firstLine),
          column: originalSelection.start.column,
        },
        end: {
          line: insertIndex + (originalSelection.end.line - firstLine),
          column: originalSelection.end.column,
        },
      }
    } else {
      newState.selection = null
    }

    // Save after state
    if (hasRealSelection) {
      this.saveAfterStateWithSelectionToHistory(newState)
    } else {
      this.saveAfterStateToHistory(newState)
    }

    // Update the state - ensure we create a new object for React
    this.onStateChange({
      lines: [...newState.lines],
      caret: { ...newState.caret },
      selection: newState.selection
        ? {
            start: { ...newState.selection.start },
            end: { ...newState.selection.end },
          }
        : null,
    })
  }
}
