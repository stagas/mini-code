export interface HistoryState {
  lines: string[]
  caret: { line: number; column: number; columnIntent: number } | null
  selection: {
    start: { line: number; column: number }
    end: { line: number; column: number }
  } | null
}

export interface HistoryEntry {
  before: HistoryState
  after: HistoryState
}

export class History {
  private undoStack: HistoryEntry[] = []
  private redoStack: HistoryEntry[] = []
  private maxHistorySize = 100
  private initialState: HistoryState | null = null
  private pendingBeforeState: HistoryState | null = null

  // Debouncing for character input
  private debouncedBeforeState: HistoryState | null = null
  private debounceTimeout: number | null = null
  private readonly debounceDelay = 500 // 500ms delay for character input

  saveBeforeState(state: HistoryState) {
    // Store initial state if this is the first save
    if (this.initialState === null) {
      this.initialState = {
        lines: [...state.lines],
        caret: state.caret ? { ...state.caret } : null,
        selection: state.selection
          ? {
              start: { ...state.selection.start },
              end: { ...state.selection.end },
            }
          : null,
      }
    }

    // Save the before state
    this.pendingBeforeState = {
      lines: [...state.lines],
      caret: state.caret ? { ...state.caret } : null,
      selection: state.selection
        ? {
            start: { ...state.selection.start },
            end: { ...state.selection.end },
          }
        : null,
    }
  }

  saveAfterState(state: HistoryState) {
    if (!this.pendingBeforeState) return

    // Check if there are actual changes
    const hasChanges = this.hasChanges(this.pendingBeforeState, state)

    if (hasChanges) {
      // Clear redo stack when a new action is performed
      this.redoStack = []

      // Create history entry with before and after states
      const entry: HistoryEntry = {
        before: this.pendingBeforeState,
        after: {
          lines: [...state.lines],
          caret: state.caret ? { ...state.caret } : null,
          selection: state.selection
            ? {
                start: { ...state.selection.start },
                end: { ...state.selection.end },
              }
            : null,
        },
      }

      // Add to undo stack
      this.undoStack.push(entry)

      // Limit history size
      if (this.undoStack.length > this.maxHistorySize) {
        this.undoStack.shift()
      }
    }

    // Clear pending state
    this.pendingBeforeState = null
  }

  // Debounced methods for character input
  saveDebouncedBeforeState(state: HistoryState) {
    // Store initial state if this is the first save
    if (this.initialState === null) {
      this.initialState = {
        lines: [...state.lines],
        caret: state.caret ? { ...state.caret } : null,
        selection: state.selection
          ? {
              start: { ...state.selection.start },
              end: { ...state.selection.end },
            }
          : null,
      }
    }

    // Only save if we don't have a debounced before state yet
    if (!this.debouncedBeforeState) {
      this.debouncedBeforeState = {
        lines: [...state.lines],
        caret: state.caret ? { ...state.caret } : null,
        selection: state.selection
          ? {
              start: { ...state.selection.start },
              end: { ...state.selection.end },
            }
          : null,
      }
    }
  }

  saveDebouncedAfterState(state: HistoryState) {
    // Clear existing timeout
    if (this.debounceTimeout !== null) {
      clearTimeout(this.debounceTimeout)
    }

    // Store the current state for the timeout callback
    const currentAfterState: HistoryState = {
      lines: [...state.lines],
      caret: state.caret ? { ...state.caret } : null,
      selection: state.selection
        ? {
            start: { ...state.selection.start },
            end: { ...state.selection.end },
          }
        : null,
    }

    // Set new timeout to save after delay
    this.debounceTimeout = window.setTimeout(() => {
      if (this.debouncedBeforeState) {
        // Check if there are actual changes
        const hasChanges = this.hasChanges(this.debouncedBeforeState, currentAfterState)

        if (hasChanges) {
          // Clear redo stack when a new action is performed
          this.redoStack = []

          // Create history entry with before and after states
          const entry: HistoryEntry = {
            before: this.debouncedBeforeState,
            after: currentAfterState,
          }

          // Add to undo stack
          this.undoStack.push(entry)

          // Limit history size
          if (this.undoStack.length > this.maxHistorySize) {
            this.undoStack.shift()
          }
        }

        // Clear debounced state
        this.debouncedBeforeState = null
      }
      this.debounceTimeout = null
    }, this.debounceDelay)
  }

  // Force save any pending debounced state immediately
  flushDebouncedState(currentState: HistoryState) {
    if (this.debounceTimeout !== null) {
      clearTimeout(this.debounceTimeout)
      this.debounceTimeout = null
    }

    if (this.debouncedBeforeState) {
      // Check if there are actual changes
      const hasChanges = this.hasChanges(this.debouncedBeforeState, currentState)

      if (hasChanges) {
        // Clear redo stack when a new action is performed
        this.redoStack = []

        // Create history entry with before and after states
        const entry: HistoryEntry = {
          before: this.debouncedBeforeState,
          after: {
            lines: [...currentState.lines],
            caret: currentState.caret ? { ...currentState.caret } : null,
            selection: currentState.selection
              ? {
                  start: { ...currentState.selection.start },
                  end: { ...currentState.selection.end },
                }
              : null,
          },
        }

        // Add to undo stack
        this.undoStack.push(entry)

        // Limit history size
        if (this.undoStack.length > this.maxHistorySize) {
          this.undoStack.shift()
        }
      }

      // Clear debounced state
      this.debouncedBeforeState = null
    }
  }

  private hasChanges(before: HistoryState, after: HistoryState): boolean {
    // Check if lines have changed
    if (before.lines.length !== after.lines.length) return true

    for (let i = 0; i < before.lines.length; i++) {
      if (before.lines[i] !== after.lines[i]) return true
    }

    // Only check caret position changes if both states have caret (caret is only saved when relevant)
    if (before.caret && after.caret) {
      if (
        before.caret.line !== after.caret.line ||
        before.caret.column !== after.caret.column ||
        before.caret.columnIntent !== after.caret.columnIntent
      ) {
        return true
      }
    }

    // Only check selection changes if both states have selection (selection is only saved when relevant)
    if (before.selection && after.selection) {
      if (
        before.selection.start.line !== after.selection.start.line ||
        before.selection.start.column !== after.selection.start.column ||
        before.selection.end.line !== after.selection.end.line ||
        before.selection.end.column !== after.selection.end.column
      ) {
        return true
      }
    }

    return false
  }

  canUndo(): boolean {
    return this.undoStack.length > 0 || this.initialState !== null
  }

  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  undo(): HistoryState | null {
    if (!this.canUndo()) return null

    // If we have states in the undo stack, pop the current entry and return the before state
    if (this.undoStack.length > 0) {
      const currentEntry = this.undoStack.pop()!
      this.redoStack.push(currentEntry)

      // Return the before state from the current entry
      return currentEntry.before
    }

    // If no undo stack but we have initial state, return it
    return this.initialState
  }

  redo(): HistoryState | null {
    if (!this.canRedo()) return null

    const entryToRedo = this.redoStack.pop()!
    this.undoStack.push(entryToRedo)

    // Return the after state from the entry
    return entryToRedo.after
  }

  clear() {
    this.undoStack = []
    this.redoStack = []
    this.initialState = null
    this.debouncedBeforeState = null
    if (this.debounceTimeout !== null) {
      clearTimeout(this.debounceTimeout)
      this.debounceTimeout = null
    }
  }
}
