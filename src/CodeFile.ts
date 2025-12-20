import { History } from './history.ts'
import { type InputState } from './input.ts'

export interface CodeFileState {
  value: string
  inputState: InputState
  scrollX: number
  scrollY: number
}

export class CodeFile {
  private _value: string
  private _inputState: InputState
  private _scrollX = 0
  private _scrollY = 0
  private _history: History
  private _listeners: Set<() => void> = new Set()

  constructor(initialValue = '') {
    this._value = initialValue
    this._inputState = {
      caret: { line: 0, column: 0, columnIntent: 0 },
      selection: null,
      lines: initialValue.split('\n'),
    }
    this._history = new History()
  }

  get value(): string {
    return this._value
  }

  set value(newValue: string) {
    if (this._value !== newValue) {
      this._value = newValue
      this._inputState = {
        ...this._inputState,
        lines: newValue.split('\n'),
      }
      this.notifyListeners()
    }
  }

  get inputState(): InputState {
    return this._inputState
  }

  set inputState(newState: InputState) {
    this._inputState = newState
    const newValue = newState.lines.join('\n')
    if (this._value !== newValue) {
      this._value = newValue
    }
    this.notifyListeners()
  }

  get scrollX(): number {
    return this._scrollX
  }

  set scrollX(value: number) {
    if (this._scrollX !== value) {
      this._scrollX = value
      this.notifyListeners()
    }
  }

  get scrollY(): number {
    return this._scrollY
  }

  set scrollY(value: number) {
    if (this._scrollY !== value) {
      this._scrollY = value
      this.notifyListeners()
    }
  }

  get history(): History {
    return this._history
  }

  // Subscribe to changes
  subscribe(listener: () => void): () => void {
    this._listeners.add(listener)
    return () => {
      this._listeners.delete(listener)
    }
  }

  private notifyListeners() {
    this._listeners.forEach(listener => listener())
  }

  // Get a snapshot of the current state
  getState(): CodeFileState {
    return {
      value: this._value,
      inputState: this._inputState,
      scrollX: this._scrollX,
      scrollY: this._scrollY,
    }
  }

  // Restore from a snapshot
  setState(state: Partial<CodeFileState>) {
    let changed = false

    if (state.value !== undefined && state.value !== this._value) {
      this._value = state.value
      this._inputState = {
        ...this._inputState,
        lines: state.value.split('\n'),
      }
      changed = true
    }

    if (state.inputState !== undefined) {
      this._inputState = state.inputState
      const newValue = state.inputState.lines.join('\n')
      if (this._value !== newValue) {
        this._value = newValue
      }
      changed = true
    }

    if (state.scrollX !== undefined && state.scrollX !== this._scrollX) {
      this._scrollX = state.scrollX
      changed = true
    }

    if (state.scrollY !== undefined && state.scrollY !== this._scrollY) {
      this._scrollY = state.scrollY
      changed = true
    }

    if (changed) {
      this.notifyListeners()
    }
  }

  // Replace value with history tracking
  replaceValue(newValue: string) {
    if (this._value === newValue) return

    const beforeState = this.inputStateToHistoryState(this._inputState)
    this._history.flushDebouncedState(beforeState)
    this._history.saveBeforeState(beforeState)

    this._value = newValue
    this._inputState = {
      ...this._inputState,
      lines: newValue.split('\n'),
    }

    const afterState = this.inputStateToHistoryState(this._inputState)
    this._history.saveAfterState(afterState)

    this.notifyListeners()
  }

  edit(line: number, column: number, length: number, text: string): void {
    const beforeState = this.inputStateToHistoryState(this._inputState)
    this._history.saveDebouncedBeforeState(beforeState)

    const startIndex = this.getIndexFromPosition(line, column)
    const clampedLength = Math.max(0, Math.min(length, this._value.length - startIndex))
    const newValue = this._value.slice(0, startIndex) + text + this._value.slice(startIndex + clampedLength)
    const newLines = newValue.split('\n')

    this._value = newValue
    this._inputState = {
      ...this._inputState,
      lines: newLines,
    }

    const afterState = this.inputStateToHistoryState(this._inputState)
    this._history.saveDebouncedAfterState(afterState)

    this.notifyListeners()
  }

  private inputStateToHistoryState(inputState: InputState) {
    return {
      lines: [...inputState.lines],
      caret: { ...inputState.caret },
      selection: inputState.selection
        ? {
          start: { ...inputState.selection.start },
          end: { ...inputState.selection.end },
        }
        : null,
    }
  }

  private getIndexFromPosition(line: number, column: number) {
    const lines = this._inputState.lines
    const normalizedLine = Math.max(0, line)
    const normalizedColumn = Math.max(0, column)
    const totalLines = lines.length
    const lineLimit = Math.min(normalizedLine, totalLines)
    let prefixLength = 0

    for (let i = 0; i < lineLimit; i++) {
      prefixLength += lines[i].length
    }

    const newlineCount = totalLines > 0
      ? Math.max(0, Math.min(normalizedLine, totalLines - 1))
      : 0
    const lineExists = normalizedLine < totalLines
    const safeColumn = lineExists
      ? Math.min(normalizedColumn, lines[normalizedLine].length)
      : 0

    return prefixLength + newlineCount + safeColumn
  }
}
