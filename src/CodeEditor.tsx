import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { getActiveEditor, setActiveEditor, subscribeActiveEditor } from './active-editor.ts'
import { type AutocompleteInfo, findCurrentWord } from './autocomplete.ts'
import { CanvasEditor, type CanvasEditorCallbacks, type EditorHeader, type EditorWidget } from './CanvasEditor.ts'
import { CodeFile, type CodeFileEvent, type CodeFileState } from './CodeFile.ts'
import { type EditorError } from './editor-error.ts'
import { functionDefinitions as defaultFunctionDefinitions, type FunctionSignature } from './function-signature.ts'
import {
  getSelectedText,
  InputHandler,
  isSelectionEmpty,
  type InputState,
  type KeyOverrideFunction,
} from './input.ts'
import { MouseHandler } from './mouse.ts'
import { type PopupCanvasDrawable, isPopupCanvasVisible, setPopupCanvasDrawable } from './popup-canvas.ts'
import { drawAutocompletePopup } from './popup-drawables.ts'
import { defaultTheme, type Theme, type Tokenizer } from './syntax.ts'

interface CodeEditorProps {
  codeFile?: CodeFile
  value?: string
  setValue?: (value: string) => void
  wordWrap?: boolean
  gutter?: boolean
  theme?: Theme
  tokenizer?: Tokenizer
  functionDefinitions?: Record<string, FunctionSignature>
  keywords?: string[]
  errors?: EditorError[]
  widgets?: EditorWidget[]
  header?: EditorHeader
  canvasRef?: preact.RefObject<HTMLCanvasElement>
  autoHeight?: boolean
  keyOverride?: KeyOverrideFunction
  hideFunctionSignatures?: boolean
  hideHoverFunctionSignatures?: boolean
  onPointerDown?: (event: PointerEvent) => void
  isAnimating?: boolean
  onBeforeDraw?: () => void
}

type WidgetPositions = Array<{ line: number; column: number; type: string; length: number; height?: number }>

export const CodeEditor = ({
  codeFile: externalCodeFile,
  value,
  setValue,
  wordWrap = false,
  gutter = false,
  theme,
  tokenizer,
  functionDefinitions = defaultFunctionDefinitions,
  keywords,
  errors = [],
  widgets = [],
  header,
  canvasRef: extCanvasRef,
  autoHeight = false,
  keyOverride,
  hideFunctionSignatures = false,
  hideHoverFunctionSignatures = false,
  onPointerDown,
  isAnimating = false,
  onBeforeDraw,
}: CodeEditorProps) => {
  const ownCanvasRef = useRef<HTMLCanvasElement>(null)
  const canvasRef = extCanvasRef ?? ownCanvasRef
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasEditorRef = useRef<CanvasEditor | null>(null)

  // Create internal CodeFile if not provided
  const internalCodeFileRef = useRef<CodeFile | null>(null)
  if (!internalCodeFileRef.current && !externalCodeFile) {
    internalCodeFileRef.current = new CodeFile(value || '')
  }
  const codeFile = externalCodeFile || internalCodeFileRef.current!
  const codeFileRef = useRef<CodeFile>(codeFile)
  codeFileRef.current = codeFile

  const [inputState, setInputStateInternal] = useState<InputState>(codeFile.inputState)

  // Autocomplete state
  const [autocompleteInfo, setAutocompleteInfo] = useState<AutocompleteInfo | null>(null)
  const [autocompletePosition, setAutocompletePosition] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  })
  const [autocompleteReady, setAutocompleteReady] = useState(false)
  const [autocompleteSelectedIndex, setAutocompleteSelectedIndex] = useState(0)
  const autocompleteInfoRef = useRef<AutocompleteInfo | null>(null)
  const autocompletePositionRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const autocompleteReadyRef = useRef(false)
  const autocompleteSelectedIndexRef = useRef(0)
  const autocompletePopupIdRef = useRef(`ac_${Math.random().toString(36).slice(2)}`)
  const autocompletePopupVisibleRef = useRef(false)
  const autocompleteHideTimerRef = useRef<number | null>(null)
  const themeRef = useRef(theme ?? defaultTheme)
  themeRef.current = theme ?? defaultTheme
  const autocompleteOnHoverRef = useRef<(index: number) => void>(() => {})
  const autocompleteOnSelectRef = useRef<(index: number) => void>(() => {})
  const autocompletePopupDrawableRef = useRef<PopupCanvasDrawable | null>(null)
  const updateAutocompletePopupCanvasRef = useRef<() => void>(() => {})

  const [isActive, setIsActive] = useState(false)
  const editorIdRef = useRef<string>(Math.random().toString(36).slice(2))

  const inputHandlerRef = useRef<InputHandler | null>(null)
  const mouseHandlerRef = useRef<MouseHandler | null>(null)
  const inputStateRef = useRef<InputState>(inputState)
  const setInputStateRef = useRef<(state: InputState) => void>(() => {})
  const lastTextRef = useRef<string>(codeFile.value)
  const lastScrollRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const pendingWidgetPositionsRef = useRef<
    Array<{ line: number; column: number; type: string; length: number; height?: number }> | null
  >(null)
  const [pendingWidgetData, setPendingWidgetData] = useState<
    Array<{ line: number; column: number; type: string; length: number; height?: number }> | null
  >(null)

  const [scrollMetrics, setScrollMetrics] = useState<{
    scrollX: number
    scrollY: number
    viewportWidth: number
    viewportHeight: number
    contentWidth: number
    contentHeight: number
  }>({
    scrollX: 0,
    scrollY: 0,
    viewportWidth: 0,
    viewportHeight: 0,
    contentWidth: 0,
    contentHeight: 0,
  })

  const isHandlingPointerRef = useRef(false)
  const lastMousePositionRef = useRef<{ x: number; y: number; event: PointerEvent | null }>({
    x: 0,
    y: 0,
    event: null,
  })
  const skipEnsureCaretVisibleRef = useRef(false)
  const lastCanvasUpdateValueRef = useRef<string | null>(null)
  const isUserInputRef = useRef(false)
  const pendingExternalStateRef = useRef<CodeFileState | null>(null)
  const lastAppliedExternalRevRef = useRef(-1)
  const sentValueQueueRef = useRef<string[]>([])
  const isLegacyValueModeRef = useRef(false)
  isLegacyValueModeRef.current = value !== undefined && !externalCodeFile
  const codeFileWriteSourceRef = useRef({})

  // Debounced updateState to batch multiple calls in the same tick
  const debouncedUpdateStateScheduledRef = useRef(false)
  const debouncedUpdateStateArgsRef = useRef<{
    newState: InputState
    ensureCaretVisible: boolean
    widgetData?: Array<{ line: number; column: number; type: string; length: number; height?: number }>
  } | null>(null)

  const debouncedUpdateState = useCallback((
    newState: InputState,
    ensureCaretVisible = false,
    widgetData?: Array<{ line: number; column: number; type: string; length: number; height?: number }>,
  ) => {
    // Store the latest arguments
    debouncedUpdateStateArgsRef.current = { newState, ensureCaretVisible, widgetData }

    // Schedule update for next microtask if not already scheduled
    if (!debouncedUpdateStateScheduledRef.current) {
      debouncedUpdateStateScheduledRef.current = true
      queueMicrotask(() => {
        const args = debouncedUpdateStateArgsRef.current
        if (args) {
          canvasEditorRef.current?.updateState(args.newState, args.ensureCaretVisible, args.widgetData)
          debouncedUpdateStateArgsRef.current = null
        }
        debouncedUpdateStateScheduledRef.current = false
      })
    }
  }, [])

  const applyState = useCallback((
    newState: InputState,
    opts?: { widgetPositions?: WidgetPositions | null; ensureCaretVisible?: boolean; writeToCodeFile?: boolean },
  ) => {
    const oldState = inputStateRef.current

    // Check if state actually changed to prevent unnecessary updates
    const caretChanged = oldState.caret.line !== newState.caret.line
      || oldState.caret.column !== newState.caret.column
      || oldState.caret.columnIntent !== newState.caret.columnIntent

    const selectionChanged = (oldState.selection === null) !== (newState.selection === null)
      || (oldState.selection
        && newState.selection
        && (oldState.selection.start.line !== newState.selection.start.line
          || oldState.selection.start.column !== newState.selection.start.column
          || oldState.selection.end.line !== newState.selection.end.line
          || oldState.selection.end.column !== newState.selection.end.column))

    const newText = newState.lines.join('\n')
    const oldText = lastTextRef.current
    const linesChanged = oldText !== newText

    // Keep `lines` referentially stable when text didn't change.
    // This avoids expensive downstream work (wrap/layout/autocomplete) that keys off `lines` identity.
    const nextState: InputState = !linesChanged && newState.lines !== oldState.lines
      ? { ...newState, lines: oldState.lines }
      : newState

    // Only update if something actually changed
    if (!caretChanged && !selectionChanged && !linesChanged) {
      return
    }

    isUserInputRef.current = true
    setInputStateInternal(nextState)
    inputStateRef.current = nextState

    if (opts?.writeToCodeFile !== false) {
      codeFileRef.current.setState({ inputState: nextState }, codeFileWriteSourceRef.current)
    }

    if (linesChanged) {
      lastTextRef.current = newText
      // Also call external setValue if provided (legacy mode)
      if (isLegacyValueModeRef.current) {
        const q = sentValueQueueRef.current
        if (q[q.length - 1] !== newText) {
          q.push(newText)
          if (q.length > 200) q.splice(0, q.length - 200)
        }
      }
      setValue?.(newText)
    }
    else {
      // Keep lastTextRef in sync even if text didn't change
      lastTextRef.current = newText
    }

    const canvasEditor = canvasEditorRef.current
    if (canvasEditor) {
      const widgetPositions = opts?.widgetPositions
      if (widgetPositions) {
        canvasEditor.setWidgetsWithoutDraw(widgetsRef.current)
      }

      const shouldEnsure = (opts?.ensureCaretVisible ?? true) && !skipEnsureCaretVisibleRef.current
      debouncedUpdateState(nextState, shouldEnsure, widgetPositions || undefined)
      lastCanvasUpdateValueRef.current = newText
      isUserInputRef.current = false
      skipEnsureCaretVisibleRef.current = false
    }

    // Keep the popup-canvas autocomplete overlay in sync on caret/selection changes
    updateAutocompletePopupCanvasRef.current()
  }, [setValue])

  // Custom setter that updates canvas editor
  const setInputState = useCallback(
    (newState: InputState) => {
      applyState(newState)
    },
    [applyState],
  )

  // Keep ref in sync with latest callback
  useEffect(() => {
    setInputStateRef.current = setInputState
  }, [setInputState])

  // Update textarea content when input state changes
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    const selectedText = getSelectedText(inputState)
    textarea.value = selectedText

    // Select all text in the textarea so copy operations work
    if (selectedText) {
      textarea.select()
    }

    // Don't automatically focus - let user control which editor has focus
  }, [inputState])

  // `inputStateRef` is updated synchronously in the edit pipeline (keyboard, mouse, CodeFile subscription).

  // Sync with external value changes (legacy mode)
  useEffect(() => {
    if (value !== undefined && !externalCodeFile) {
      if (value === lastTextRef.current) {
        sentValueQueueRef.current = []
        return
      }

      const q = sentValueQueueRef.current
      const idx = q.indexOf(value)
      if (idx !== -1) {
        // Parent is catching up to a value we already emitted; don't rewind local state.
        sentValueQueueRef.current = q.slice(idx + 1)
        return
      }

      const lines = value.split('\n')
      const currentLines = inputStateRef.current.lines.join('\n')
      if (currentLines !== value) {
        sentValueQueueRef.current = []
        lastTextRef.current = value
        const current = inputStateRef.current
        const line = Math.min(current.caret.line, Math.max(0, lines.length - 1))
        const lineText = lines[line] || ''
        const column = Math.min(current.caret.column, lineText.length)
        const columnIntent = Math.min(current.caret.columnIntent, lineText.length)
        const newState: InputState = {
          ...current,
          caret: { line, column, columnIntent },
          selection: null,
          lines,
        }
        setInputStateInternal(newState)
        inputStateRef.current = newState
        codeFileRef.current.inputState = newState
      }
    }
  }, [value, externalCodeFile])

  // Keep widgets in a ref so subscription callback always has latest value
  const widgetsRef = useRef(widgets)
  widgetsRef.current = widgets

  // Subscribe to CodeFile changes and initialize state when external codeFile changes
  useLayoutEffect(() => {
    if (!externalCodeFile) return

    lastAppliedExternalRevRef.current = -1

    const applyExternalState = (state: CodeFileState) => {
      if (state.rev <= lastAppliedExternalRevRef.current) return
      lastAppliedExternalRevRef.current = state.rev

      const currentState = inputStateRef.current
      const nextState = state.inputState

      const caretChanged = currentState.caret.line !== nextState.caret.line
        || currentState.caret.column !== nextState.caret.column
        || currentState.caret.columnIntent !== nextState.caret.columnIntent

      const selectionChanged = (currentState.selection === null) !== (nextState.selection === null)
        || (currentState.selection
          && nextState.selection
          && (currentState.selection.start.line !== nextState.selection.start.line
            || currentState.selection.start.column !== nextState.selection.start.column
            || currentState.selection.end.line !== nextState.selection.end.line
            || currentState.selection.end.column !== nextState.selection.end.column))

      const linesChanged = lastTextRef.current !== state.value

      if (linesChanged || caretChanged || selectionChanged) {
        skipEnsureCaretVisibleRef.current = true
        setInputStateInternal(nextState)
        inputStateRef.current = nextState
        lastTextRef.current = state.value
        const canvasEditor = canvasEditorRef.current
        if (canvasEditor) {
          canvasEditor.updateWidgets(widgetsRef.current)
          canvasEditor.updateState(nextState, false)
          lastCanvasUpdateValueRef.current = state.value
        }
      }

      if (state.scrollX !== lastScrollRef.current.x || state.scrollY !== lastScrollRef.current.y) {
        lastScrollRef.current = { x: state.scrollX, y: state.scrollY }
      }
    }

    let cancelled = false
    let flushQueued = false
    const queueFlush = () => {
      if (flushQueued) return
      flushQueued = true
      queueMicrotask(() => {
        flushQueued = false
        if (cancelled) return

        const pending = pendingExternalStateRef.current
        if (!pending) return

        // If the canvas editor isn't initialized yet (or was recreated), retry after layout effects.
        if (!canvasEditorRef.current) {
          queueFlush()
          return
        }

        pendingExternalStateRef.current = null
        applyExternalState(pending)
      })
    }

    // Initialize state from external codeFile when it changes
    const state = externalCodeFile.getState()
    pendingExternalStateRef.current = state

    // Update canvas editor synchronously if possible; otherwise flush after layout effects.
    if (canvasEditorRef.current) {
      applyExternalState(state)
      pendingExternalStateRef.current = null
    }
    else {
      queueFlush()
    }

    // Subscribe to external CodeFile changes
    const unsubscribe = externalCodeFile.subscribe((e: CodeFileEvent) => {
      if (e.source === codeFileWriteSourceRef.current) return
      const next = externalCodeFile.getState()
      if (canvasEditorRef.current) {
        pendingExternalStateRef.current = null
        applyExternalState(next)
      }
      else {
        pendingExternalStateRef.current = next
        queueFlush()
      }
    })

    return () => {
      cancelled = true
      pendingExternalStateRef.current = null
      unsubscribe()
    }
  }, [externalCodeFile])

  // Handle clipboard events
  const handleCopy = (e: preact.TargetedClipboardEvent<HTMLTextAreaElement>) => {
    // Let the browser handle the copy operation naturally
    // The textarea already contains the selected text
  }

  const handlePaste = (e: preact.TargetedClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault()
    inputHandlerRef.current?.handlePasteEvent(e, inputStateRef.current)
  }

  const handleCut = (e: preact.TargetedClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault()
    inputHandlerRef.current?.handleCut(inputStateRef.current)
  }

  const handleKeyDown = (e: preact.TargetedKeyboardEvent<HTMLTextAreaElement>) => {
    // Allow browser default for zoom shortcuts
    if (
      (e.ctrlKey || e.metaKey)
      && (e.key === '-' || e.key === '=' || e.key === 'Minus' || e.key === 'Equal')
    ) {
      return
    }

    if (e.key === 'Escape') {
      // Hide autocomplete first, then signature popup
      if (autocompleteInfo) {
        canvasEditorRef.current?.hideAutocomplete()
        setAutocompleteIndex(0)
        autocompleteReadyRef.current = false
        setAutocompleteReady(false)
        updateAutocompletePopupCanvas()
        e.preventDefault()
        return
      }
      canvasEditorRef.current?.hideSignaturePopup()
      return
    }

    // Handle autocomplete interactions (before general key handling).
    // Hardened: only allow keyboard acceptance if the popup-canvas overlay is actually visible.
    const isAutocompleteVisible = autocompletePopupVisibleRef.current && isPopupCanvasVisible()

    if (isAutocompleteVisible) {
      if (e.key === 'Tab') {
        e.preventDefault()
        const info = autocompleteInfoRef.current
        if (!info || info.suggestions.length === 0) return
        const len = info.suggestions.length
        // Cycle through suggestions (Shift+Tab goes backwards)
        const prev = autocompleteSelectedIndexRef.current
        const next = (prev + (e.shiftKey ? len - 1 : 1)) % len
        setAutocompleteIndex(next)
        return
      }

      if (e.key === 'Enter') {
        e.preventDefault()
        applyAutocompleteSuggestion(autocompleteSelectedIndexRef.current)
        return
      }
    }

    // Now handle autocomplete visibility based on key type
    // Navigation keys should hide autocomplete
    const isNavigationKey = [
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'PageUp',
      'PageDown',
      'Home',
      'End',
    ].includes(e.key)

    const isModifierOnly = ['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)
    const hasModifier = e.ctrlKey || e.metaKey || e.altKey

    // Enable autocomplete for:
    // - Printable characters (typing)
    // - Backspace/Delete (might still be typing after deletion)
    const isPrintableChar = e.key.length === 1 && !hasModifier
    const isEditingKey = ['Backspace', 'Delete'].includes(e.key)

    if (isPrintableChar || isEditingKey) {
      canvasEditorRef.current?.setAutocompleteInputSource('keyboard')
    }
    else if (isNavigationKey || (isModifierOnly && e.key !== 'Shift') || (hasModifier && !e.shiftKey)) {
      // Hide autocomplete on navigation or modifier keys
      // Don't hide when Shift is pressed alone (needed for Shift+Tab navigation)
      canvasEditorRef.current?.hideAutocomplete()
      setAutocompleteIndex(0)
      autocompleteReadyRef.current = false
      setAutocompleteReady(false)
      updateAutocompletePopupCanvas()
    }

    // Intercept undo/redo to get widget data before InputHandler processes them
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      // Get widget data from history BEFORE calling handleUndo (which triggers state change)
      const history = inputHandlerRef.current?.['history']
      if (history && inputStateRef.current) {
        history.flushDebouncedState(inputStateRef.current)
        const previousState = history.undo()
        if (previousState) {
          const widgetData = previousState.widgets ? previousState.widgets.map(w => ({ ...w })) : null

          // Update state manually without calling history.undo() again
          inputStateRef.current.lines = [...previousState.lines]
          if (previousState.caret) {
            inputStateRef.current.caret = { ...previousState.caret }
          }
          inputStateRef.current.selection = previousState.selection
            ? {
              start: { ...previousState.selection.start },
              end: { ...previousState.selection.end },
            }
            : null

          const nextInputState: InputState = {
            lines: [...previousState.lines],
            caret: previousState.caret ? { ...previousState.caret } : { ...inputStateRef.current.caret },
            selection: previousState.selection
              ? {
                start: { ...previousState.selection.start },
                end: { ...previousState.selection.end },
              }
              : null,
          }
          applyState(nextInputState, { widgetPositions: widgetData || null, ensureCaretVisible: true })
          return
        }
      }
      // Fallback: call handleUndo normally
      const widgetData = inputHandlerRef.current?.handleUndo(inputStateRef.current) || null
      pendingWidgetPositionsRef.current = widgetData
      return
    }
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
      e.preventDefault()
      // Get widget data from history BEFORE calling handleRedo (which triggers state change)
      const history = inputHandlerRef.current?.['history']
      if (history && inputStateRef.current) {
        history.flushDebouncedState(inputStateRef.current)
        const nextState = history.redo()
        if (nextState) {
          const widgetData = nextState.widgets ? nextState.widgets.map(w => ({ ...w })) : null

          // Update state manually without calling history.redo() again
          inputStateRef.current.lines = [...nextState.lines]
          if (nextState.caret) {
            inputStateRef.current.caret = { ...nextState.caret }
          }
          inputStateRef.current.selection = nextState.selection
            ? {
              start: { ...nextState.selection.start },
              end: { ...nextState.selection.end },
            }
            : null

          const nextInputState: InputState = {
            lines: [...nextState.lines],
            caret: nextState.caret ? { ...nextState.caret } : { ...inputStateRef.current.caret },
            selection: nextState.selection
              ? {
                start: { ...nextState.selection.start },
                end: { ...nextState.selection.end },
              }
              : null,
          }
          applyState(nextInputState, { widgetPositions: widgetData || null, ensureCaretVisible: true })
          return
        }
      }
      // Fallback: call handleRedo normally
      const widgetData = inputHandlerRef.current?.handleRedo(inputStateRef.current) || null
      pendingWidgetPositionsRef.current = widgetData
      return
    }

    inputHandlerRef.current?.handleKeyDown(e, inputStateRef.current)
  }

  // Update errors in canvas editor
  useEffect(() => {
    canvasEditorRef.current?.setErrors(errors)
  }, [errors])

  useEffect(() => {
    // Initialize input handler only once
    if (!inputHandlerRef.current) {
      inputHandlerRef.current = new InputHandler(
        state => setInputStateRef.current(state),
        codeFile.history,
      )
    }
    else {
      // Update history when codeFile changes
      inputHandlerRef.current.setHistory(codeFile.history)
    }

    // Set up widget positions callback
    if (inputHandlerRef.current && canvasEditorRef.current) {
      inputHandlerRef.current.setGetWidgets(() => canvasEditorRef.current?.getWidgets() || [])
    }

    // Update codefile reference in canvas editor when it changes
    if (canvasEditorRef.current) {
      canvasEditorRef.current.setCodeFileRef(codeFile)
    }

    // Set up key override function for word wrap handling and external overrides
    if (inputHandlerRef.current) {
      inputHandlerRef.current.setKeyOverride((event, currentState) => {
        // First, call external key override if provided
        if (keyOverride) {
          const result = keyOverride(event, currentState)
          if (!result) {
            return false // External override handled the key
          }
        }

        // Handle Alt+Arrow combinations for line moving (bypass word wrap logic)
        if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
          return true // Let input handler process it
        }

        // Handle word wrap arrow keys
        if (wordWrap && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
          event.preventDefault()
          const dir = event.key === 'ArrowUp' ? 'up' : 'down'
          const caret = currentState.caret
          const next = canvasEditorRef.current?.getCaretForVerticalMove(
            dir,
            caret.line,
            caret.columnIntent,
          )
          if (next && (next.line !== caret.line || next.column !== caret.column)) {
            const newState: InputState = {
              ...currentState,
              caret: {
                line: next.line,
                column: next.column,
                columnIntent: next.columnIntent ?? caret.columnIntent,
              },
              selection: event.shiftKey
                ? currentState.selection
                  ? {
                    start: currentState.selection.start,
                    end: { line: next.line, column: next.column },
                  }
                  : {
                    start: { line: caret.line, column: caret.column },
                    end: { line: next.line, column: next.column },
                  }
                : null,
            }
            setInputStateRef.current(newState)
            return false // We handled it
          }
          return true // Fall back to default handling
        }

        if (
          wordWrap
          && !event.ctrlKey
          && !event.metaKey
          && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
        ) {
          event.preventDefault()
          const dir = event.key === 'ArrowLeft' ? 'left' : 'right'
          const caret = currentState.caret
          const next = canvasEditorRef.current?.getCaretForHorizontalMove(
            dir,
            caret.line,
            caret.column,
          )
          if (next) {
            const newState: InputState = {
              ...currentState,
              caret: { line: next.line, column: next.column, columnIntent: next.columnIntent },
              selection: event.shiftKey
                ? currentState.selection
                  ? {
                    start: currentState.selection.start,
                    end: { line: next.line, column: next.column },
                  }
                  : {
                    start: { line: caret.line, column: caret.column },
                    end: { line: next.line, column: next.column },
                  }
                : null,
            }
            setInputStateRef.current(newState)
            return false // We handled it
          }
          return true // Fall back to default handling
        }

        return true // Let input handler process all other keys
      })
    }
  }, [wordWrap, keyOverride, externalCodeFile]) // Re-run when wordWrap, keyOverride, or codeFile changes

  useEffect(() => {
    const unsub = subscribeActiveEditor(activeId => {
      const active = activeId === editorIdRef.current
      setIsActive(active)
      canvasEditorRef.current?.setActive(active)
    })

    // Handle clicks outside the canvas to blur it
    const handleDocumentClick = (e: MouseEvent) => {
      const target = e.target as Node
      const canvas = canvasRef.current
      const container = containerRef.current

      // Check if click is outside this editor's canvas/container
      if (canvas && container && !container.contains(target)) {
        // Only deactivate if this editor is currently active
        if (getActiveEditor() === editorIdRef.current) {
          setActiveEditor(null)
        }
      }
    }

    document.addEventListener('mousedown', handleDocumentClick)

    return () => {
      unsub()
      document.removeEventListener('mousedown', handleDocumentClick)
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Initialize mouse handler with a wrapper that saves selection changes to history
    mouseHandlerRef.current = new MouseHandler(canvas, newState => {
      // Save selection changes to history
      if (inputHandlerRef.current) {
        // Save the current state before the change
        inputHandlerRef.current.saveBeforeStateToHistory(inputStateRef.current)
        // Save the new state after the change
        inputHandlerRef.current.saveAfterStateToHistory(newState)
      }
      // Mark as user input so useEffect knows to ensure caret visible
      isUserInputRef.current = true

      // Check if caret was set (new caret position or caret changed)
      const caretWasSet = newState.caret !== null && (
        !inputStateRef.current.caret
        || newState.caret.line !== inputStateRef.current.caret.line
        || newState.caret.column !== inputStateRef.current.caret.column
      )

      // Call setInputState first - it needs to see oldState in the ref for comparison
      setInputStateRef.current(newState)

      // If caret was set, ensure editor is focused
      if (caretWasSet) {
        setActiveEditor(editorIdRef.current)
        // Use setTimeout to ensure focus happens after state update
        // Blur and focus consecutively to reactivate the textarea
        setTimeout(() => {
          textareaRef.current?.blur()
          setTimeout(() => {
            textareaRef.current?.focus({ preventScroll: true })
          }, 0)
        }, 0)
      }
    })

    // Set initial text padding (includes gutter if enabled)
    if (canvasEditorRef.current) {
      mouseHandlerRef.current.setTextPadding(canvasEditorRef.current.getTextPaddingValue())
    }
  }, []) // Remove setInputState dependency since it's stable

  const updateAutocompletePopupCanvas = useCallback(() => {
    const id = autocompletePopupIdRef.current
    const info = autocompleteInfoRef.current
    const pos = autocompletePositionRef.current
    const selectedIndex = autocompleteSelectedIndexRef.current
    const state = inputStateRef.current

    const selectionEmpty = !state.selection || isSelectionEmpty(state.selection)
    // Show autocomplete if we have suggestions and no selection, regardless of isActive
    // (isActive can be false during rapid state updates but we still want to show completions)
    const visible = !!info
      && info.suggestions.length > 0
      && selectionEmpty
    console.log('[AC] updatePopupCanvas - visible:', visible, 'isActive:', isActive, 'info:', !!info, 'suggestions:', info?.suggestions.length, 'selectionEmpty:', selectionEmpty)
    autocompletePopupVisibleRef.current = visible

    if (!autocompletePopupDrawableRef.current) {
      autocompletePopupDrawableRef.current = {
        priority: 20,
        wantsPointer: true,
        draw: ({ context, width, height }) => {
          const info = autocompleteInfoRef.current
          const pos = autocompletePositionRef.current
          const selectedIndex = autocompleteSelectedIndexRef.current
          if (!info || info.suggestions.length === 0) return null

          return drawAutocompletePopup({
            context,
            width,
            height,
            position: pos,
            suggestions: info.suggestions,
            selectedIndex,
            theme: themeRef.current,
            onHover: index => autocompleteOnHoverRef.current(index),
            onSelect: index => autocompleteOnSelectRef.current(index),
          })
        },
      }
    }

    setPopupCanvasDrawable(id, visible ? autocompletePopupDrawableRef.current : null)
  }, [isActive])

  updateAutocompletePopupCanvasRef.current = updateAutocompletePopupCanvas

  const setAutocompleteIndex = useCallback((next: number) => {
    autocompleteSelectedIndexRef.current = next
    setAutocompleteSelectedIndex(prev => (prev === next ? prev : next))
    updateAutocompletePopupCanvas()
  }, [updateAutocompletePopupCanvas])

  const applyAutocompleteSuggestion = useCallback((index: number) => {
    const info = autocompleteInfoRef.current
    if (!info) return

    const selectedSuggestion = info.suggestions[index]
    const line = inputStateRef.current.lines[inputStateRef.current.caret.line]
    const newLine = line.substring(0, info.startColumn)
      + selectedSuggestion
      + line.substring(info.endColumn)

    const newLines = [...inputStateRef.current.lines]
    newLines[inputStateRef.current.caret.line] = newLine

    const newState: InputState = {
      ...inputStateRef.current,
      lines: newLines,
      selection: null,
      caret: {
        line: inputStateRef.current.caret.line,
        column: info.startColumn + selectedSuggestion.length,
        columnIntent: info.startColumn + selectedSuggestion.length,
      },
    }

    if (inputHandlerRef.current) {
      codeFileRef.current.history.flushDebouncedState(inputStateRef.current)
      inputHandlerRef.current.saveBeforeStateToHistory(inputStateRef.current)
      inputHandlerRef.current.saveAfterStateToHistory(newState)
    }

    setInputStateRef.current(newState)
    canvasEditorRef.current?.hideAutocomplete()
    setAutocompleteIndex(0)
    autocompleteReadyRef.current = false
    setAutocompleteReady(false)
    updateAutocompletePopupCanvas()
  }, [setAutocompleteIndex, updateAutocompletePopupCanvas])

  autocompleteOnHoverRef.current = setAutocompleteIndex
  autocompleteOnSelectRef.current = applyAutocompleteSuggestion

  useEffect(() => {
    return () => {
      if (autocompleteHideTimerRef.current !== null) {
        clearTimeout(autocompleteHideTimerRef.current)
        autocompleteHideTimerRef.current = null
      }
    }
  }, [])

  // Store callbacks in refs to avoid recreating CanvasEditor
  const callbacksRef = useRef<CanvasEditorCallbacks>({
    onAutocompleteChange: info => {
      console.log('[AC] onAutocompleteChange:', info ? `${info.suggestions.length} suggestions for "${info.word}"` : 'null')
      if (info) {
        if (autocompleteHideTimerRef.current !== null) {
          console.log('[AC] Canceling hide timer - got new suggestions')
          clearTimeout(autocompleteHideTimerRef.current)
          autocompleteHideTimerRef.current = null
        }
        autocompleteInfoRef.current = info
        setAutocompleteInfo(info)
        setAutocompleteIndex(0)
        updateAutocompletePopupCanvas()
        return
      }

      // Avoid flicker: CanvasEditor may transiently emit null during rapid state/layout updates.
      // Keep the last non-null suggestions briefly unless an explicit hide happened.
      if (autocompleteHideTimerRef.current !== null) {
        clearTimeout(autocompleteHideTimerRef.current)
      }
      console.log('[AC] Scheduling hide in 120ms')
      autocompleteHideTimerRef.current = window.setTimeout(() => {
        console.log('[AC] Hide timer fired - clearing')
        autocompleteHideTimerRef.current = null
        autocompleteInfoRef.current = null
        setAutocompleteInfo(null)
        setAutocompleteIndex(0)
        updateAutocompletePopupCanvasRef.current()
      }, 120)
    },
    onAutocompletePositionChange: pos => {
      autocompletePositionRef.current = pos
      setAutocompletePosition(pos)
      if (pos.x !== 0 || pos.y !== 0) {
        autocompleteReadyRef.current = true
        setAutocompleteReady(true)
      }
      updateAutocompletePopupCanvas()
    },
    onScrollChange: (sx, sy) => {
      mouseHandlerRef.current?.setScrollOffset(sx, sy)
      // Update CodeFile scroll position and track it
      lastScrollRef.current = { x: sx, y: sy }
      codeFileRef.current.setState({ scrollX: sx, scrollY: sy }, codeFileWriteSourceRef.current)
    },
    onScrollMetricsChange: m =>
      setScrollMetrics(prev =>
        prev.scrollX !== m.scrollX
          || prev.scrollY !== m.scrollY
          || prev.viewportWidth !== m.viewportWidth
          || prev.viewportHeight !== m.viewportHeight
          || prev.contentWidth !== m.contentWidth
          || prev.contentHeight !== m.contentHeight
          ? m
          : prev
      ),
  })

  // Keep callbacks ref up to date
  useEffect(() => {
    callbacksRef.current = {
      onAutocompleteChange: info => {
        if (info) {
          if (autocompleteHideTimerRef.current !== null) {
            clearTimeout(autocompleteHideTimerRef.current)
            autocompleteHideTimerRef.current = null
          }
          autocompleteInfoRef.current = info
          setAutocompleteInfo(info)
          setAutocompleteIndex(0)
          updateAutocompletePopupCanvas()
          return
        }

        if (autocompleteHideTimerRef.current !== null) {
          clearTimeout(autocompleteHideTimerRef.current)
        }
        autocompleteHideTimerRef.current = window.setTimeout(() => {
          autocompleteHideTimerRef.current = null
          autocompleteInfoRef.current = null
          setAutocompleteInfo(null)
          setAutocompleteIndex(0)
          updateAutocompletePopupCanvasRef.current()
        }, 120)
      },
      onAutocompletePositionChange: pos => {
        autocompletePositionRef.current = pos
        setAutocompletePosition(pos)
        if (pos.x !== 0 || pos.y !== 0) {
          autocompleteReadyRef.current = true
          setAutocompleteReady(true)
        }
        updateAutocompletePopupCanvas()
      },
      onScrollChange: (sx, sy) => {
        mouseHandlerRef.current?.setScrollOffset(sx, sy)
        // Update text padding when it might change (e.g., when gutter width changes)
        if (canvasEditorRef.current) {
          mouseHandlerRef.current?.setTextPadding(canvasEditorRef.current.getTextPaddingValue())
        }
        // Update CodeFile scroll position and track it
        lastScrollRef.current = { x: sx, y: sy }
        codeFileRef.current.setState({ scrollX: sx, scrollY: sy }, codeFileWriteSourceRef.current)

        // Update selection during auto-scroll when dragging
        if (mouseHandlerRef.current?.isDraggingSelection() && lastMousePositionRef.current.event) {
          mouseHandlerRef.current.handlePointerMove(
            lastMousePositionRef.current.event,
            inputStateRef.current,
          )
        }
      },
      onScrollMetricsChange: m =>
        setScrollMetrics(prev =>
          prev.scrollX !== m.scrollX
            || prev.scrollY !== m.scrollY
            || prev.viewportWidth !== m.viewportWidth
            || prev.viewportHeight !== m.viewportHeight
            || prev.contentWidth !== m.contentWidth
            || prev.contentHeight !== m.contentHeight
            ? m
            : prev
        ),
    }
  })

  // Initialize canvas editor
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    canvasEditorRef.current = new CanvasEditor(
      canvas,
      container,
      inputState,
      callbacksRef.current,
      {
        wordWrap,
        gutter,
        theme,
        tokenizer,
        widgets,
        header,
        keywords,
        isAnimating,
        onBeforeDraw,
      },
    )

    // Set codefile reference for widget update debouncing
    canvasEditorRef.current.setCodeFileRef(codeFile)

    // Set function definitions for autocomplete
    canvasEditorRef.current.setFunctionDefinitions(functionDefinitions)

    // Set keywords for autocomplete
    if (keywords) {
      canvasEditorRef.current.setKeywords(keywords)
    }

    // Signature popup is now rendered imperatively by CanvasEditor
    canvasEditorRef.current.setSignatureEnabled(!hideFunctionSignatures)
    canvasEditorRef.current.setHoverSignatureEnabled(!hideHoverFunctionSignatures)

    // Set errors
    canvasEditorRef.current.setErrors(errors)

    // Set initial active state
    const currentActive = getActiveEditor() === editorIdRef.current
    canvasEditorRef.current.setActive(currentActive)

    // Restore scroll position from CodeFile (synchronously, no delay)
    canvasEditorRef.current.setScroll(codeFile.scrollX, codeFile.scrollY)

    // Wire up word-wrap-aware movement to the input handler
    if (inputHandlerRef.current) {
      inputHandlerRef.current.setMovementCallbacks({
        getCaretForHorizontalMove: (direction, line, column) =>
          canvasEditorRef.current?.getCaretForHorizontalMove(direction, line, column) ?? null,
        getCaretForVerticalMove: (direction, line, columnIntent) =>
          canvasEditorRef.current?.getCaretForVerticalMove(direction, line, columnIntent) ?? null,
        getCaretForLineStart: (line, column) => canvasEditorRef.current?.getCaretForLineStart(line, column) ?? null,
        getCaretForLineEnd: (line, column) => canvasEditorRef.current?.getCaretForLineEnd(line, column) ?? null,
      })
    }

    return () => {
      setPopupCanvasDrawable(autocompletePopupIdRef.current, null)
      canvasEditorRef.current?.destroy()
    }
  }, [wordWrap, gutter])

  useEffect(() => {
    if (canvasEditorRef.current && keywords) {
      canvasEditorRef.current.setKeywords(keywords)
    }
  }, [keywords])

  useEffect(() => {
    canvasEditorRef.current?.updateHeader(header!)
  }, [header])

  // Handle isAnimating prop
  useEffect(() => {
    canvasEditorRef.current?.setAnimating(isAnimating)
  }, [isAnimating])

  // Handle onBeforeDraw prop
  useEffect(() => {
    canvasEditorRef.current?.setOnBeforeDraw(onBeforeDraw)
  }, [onBeforeDraw])

  // Update canvas editor state when inputState changes
  const prevInputStateRef = useRef(inputState)
  const prevWidgetsRef = useRef(widgets)

  useEffect(() => {
    const currentValue = inputState.lines.join('\n')
    const inputStateChanged = prevInputStateRef.current !== inputState
    const widgetsChanged = prevWidgetsRef.current !== widgets

    // Skip if we already updated the canvas editor for this value (from CodeFile subscription)
    if (lastCanvasUpdateValueRef.current === currentValue) {
      lastCanvasUpdateValueRef.current = null
      prevInputStateRef.current = inputState
      prevWidgetsRef.current = widgets
      if (widgetsChanged) {
        canvasEditorRef.current?.updateWidgets(widgets)
      }
      return
    }

    prevInputStateRef.current = inputState
    prevWidgetsRef.current = widgets

    if (inputStateChanged && widgetsChanged) {
      // Both changed: update widgets without drawing, then updateState will draw once
      const widgetData = pendingWidgetData || pendingWidgetPositionsRef.current
      pendingWidgetPositionsRef.current = null
      setPendingWidgetData(null)

      // Set widgets without drawing if we have widget data (will restore positions in updateState)
      // Otherwise use updateWidgets which updates immediately
      if (widgetData) {
        // For undo/redo: set widgets directly without drawing, restore will happen in updateState
        canvasEditorRef.current?.setWidgetsWithoutDraw(widgets)
      }
      else {
        canvasEditorRef.current?.updateWidgets(widgets)
      }

      const shouldEnsureCaretVisible = isUserInputRef.current && !skipEnsureCaretVisibleRef.current
      isUserInputRef.current = false
      skipEnsureCaretVisibleRef.current = false
      debouncedUpdateState(inputState, shouldEnsureCaretVisible, widgetData || undefined)
    }
    else if (inputStateChanged) {
      // Only inputState changed
      const shouldEnsureCaretVisible = isUserInputRef.current && !skipEnsureCaretVisibleRef.current
      isUserInputRef.current = false
      skipEnsureCaretVisibleRef.current = false
      const widgetPositions = pendingWidgetData || pendingWidgetPositionsRef.current
      pendingWidgetPositionsRef.current = null
      setPendingWidgetData(null)
      debouncedUpdateState(inputState, shouldEnsureCaretVisible, widgetPositions || undefined)
    }
    else if (widgetsChanged) {
      // Only widgets changed - update immediately and ensure caret visibility if this was user input
      const shouldEnsureCaretVisible = isUserInputRef.current && !skipEnsureCaretVisibleRef.current
      isUserInputRef.current = false
      skipEnsureCaretVisibleRef.current = false
      canvasEditorRef.current?.updateWidgets(widgets)
      // Call updateState with current inputState to trigger ensureCaretVisible when appropriate
      debouncedUpdateState(inputState, shouldEnsureCaretVisible)
    }
  }, [inputState, widgets])

  // Update theme and tokenizer when they change
  useEffect(() => {
    if (theme) {
      canvasEditorRef.current?.setTheme(theme)
    }
    if (tokenizer) {
      canvasEditorRef.current?.setTokenizer(tokenizer)
    }
  }, [theme, tokenizer])

  useEffect(() => {
    canvasEditorRef.current?.setSignatureEnabled(!hideFunctionSignatures)
  }, [hideFunctionSignatures])

  useEffect(() => {
    canvasEditorRef.current?.setHoverSignatureEnabled(!hideHoverFunctionSignatures)
  }, [hideHoverFunctionSignatures])

  useEffect(() => {
    updateAutocompletePopupCanvas()
  }, [isActive, updateAutocompletePopupCanvas])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const handlePointerDown = (event: PointerEvent) => {
      onPointerDown?.(event)

      // For touch events, don't proceed if touch scrolling is already active
      // But allow it to proceed if touch gesture just started (so mouse handler can store position)
      // We'll prevent focus/activation until we know if it's a scroll
      if (event.pointerType === 'touch' && canvasEditorRef.current?.isTouchScrollingActive()) {
        return
      }

      event.preventDefault()
      isHandlingPointerRef.current = true
      canvasEditorRef.current?.setAutocompleteInputSource('mouse')

      const rect = canvas.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top

      // Check if clicking on the header before widgets
      const headerHandled = canvasEditorRef.current?.handleHeaderPointerDown(event, x, y)
      if (headerHandled) {
        setActiveEditor(editorIdRef.current)
        isHandlingPointerRef.current = false
        return
      }

      // Check if clicking on a widget - this must be checked first
      const widgetHandled = canvasEditorRef.current?.handleWidgetPointerDown(x, y)
      if (widgetHandled) {
        setActiveEditor(editorIdRef.current)
        isHandlingPointerRef.current = false
        return
      }

      // Don't proceed with caret/selection if a widget is being handled
      if (canvasEditorRef.current?.isWidgetPointerActive()) {
        return
      }

      // Check if clicking on scrollbar
      const scrollbar = canvasEditorRef.current?.checkScrollbarHover(x, y)
      if (scrollbar) {
        setActiveEditor(editorIdRef.current)
        const isThumb = canvasEditorRef.current?.handleScrollbarClick(x, y, scrollbar)
        if (isThumb) {
          isDraggingScrollbarRef.current = scrollbar
          dragStartRef.current = { x: event.clientX, y: event.clientY }
        }
        isHandlingPointerRef.current = false
        return
      }

      if (canvasEditorRef.current) {
        if (wordWrap) {
          // Set up word wrap coordinate converter for MouseHandler
          const wordWrapConverter = (x: number, y: number) => {
            // CanvasEditor expects raw coordinates and will add scroll offset internally
            return canvasEditorRef.current!.getCaretPositionFromCoordinates(x, y)
          }
          mouseHandlerRef.current?.setWordWrapCoordinateConverter(wordWrapConverter)
        }
        else {
          // Set up normal mode coordinate converter for MouseHandler
          const normalModeConverter = (x: number, y: number) => {
            // CanvasEditor expects raw coordinates and will add scroll offset internally
            return canvasEditorRef.current!.getCaretPositionFromCoordinates(x, y)
          }
          mouseHandlerRef.current?.setNormalModeCoordinateConverter(normalModeConverter)
        }

        // Let MouseHandler handle everything (including double/triple clicks)
        // This will call the callback which updates inputStateRef.current synchronously
        mouseHandlerRef.current?.handlePointerDown(event, inputStateRef.current)
      }
      else {
        mouseHandlerRef.current?.handlePointerDown(event, inputStateRef.current)
      }

      // For touch events, MouseHandler may defer caret update until pointerup
      // Only update state if it's not a touch event (focus is handled by mouse handler callback)
      if (event.pointerType !== 'touch') {
        // Update canvas editor state synchronously with the updated ref from mouse handler callback
        // The callback already updated inputStateRef.current, so this will have the latest state
        debouncedUpdateState(inputStateRef.current, true)
        // Reactivate textarea by blurring and focusing consecutively
        setActiveEditor(editorIdRef.current)
        textareaRef.current?.blur()
        setTimeout(() => {
          textareaRef.current?.focus({ preventScroll: true })
        }, 0)
      }

      // Clear the flag after a small delay to ensure focus event has been processed
      setTimeout(() => {
        isHandlingPointerRef.current = false
      }, 0)
    }

    const handlePointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top

      if (canvasEditorRef.current?.handleHeaderPointerMove(x, y)) {
        if (event.pointerType === 'touch') {
          event.preventDefault()
        }
        return
      }

      // Handle widget pointer move first (before any other checks)
      canvasEditorRef.current?.handleWidgetPointerMove(x, y)

      // If a widget is being handled, don't proceed with scrolling/selection
      if (canvasEditorRef.current?.isWidgetPointerActive()) {
        // Still prevent default for touch events to prevent scrolling
        if (event.pointerType === 'touch') {
          event.preventDefault()
        }
        return
      }

      // Don't handle touch scrolling if touch scrolling is already active
      if (event.pointerType === 'touch' && canvasEditorRef.current?.isTouchScrollingActive()) {
        return
      }

      event.preventDefault()

      // Handle scrollbar dragging
      if (isDraggingScrollbarRef.current && dragStartRef.current) {
        const dx = event.clientX - dragStartRef.current.x
        const dy = event.clientY - dragStartRef.current.y
        canvasEditorRef.current?.handleScrollbarDrag(dx, dy, isDraggingScrollbarRef.current)
        dragStartRef.current = { x: event.clientX, y: event.clientY }
        return
      }

      // Update scrollbar hover state
      const scrollbar = canvasEditorRef.current?.checkScrollbarHover(x, y)
      canvasEditorRef.current?.setScrollbarHover(scrollbar || null)

      // Check for error hover
      const error = canvasEditorRef.current?.checkErrorHover(x, y)
      canvasEditorRef.current?.updateErrorHover(error || null)

      // Check for function hover
      const hoveredFunction = canvasEditorRef.current?.checkFunctionHover(x, y) ?? null
      canvasEditorRef.current?.updateFunctionHover(hoveredFunction, x, y)

      // Selection updates are handled by handleWindowPointerMove to support auto-scroll outside canvas
      // Only update here if not dragging (to handle non-selection mouse moves)
      if (!mouseHandlerRef.current?.isDraggingSelection()) {
        mouseHandlerRef.current?.handlePointerMove(event, inputStateRef.current)
      }
      else {
        // When dragging, also handle selection updates via window handler for consistent boundary zone logic
        handleWindowPointerMove(event)
      }
    }

    const handlePointerLeave = (event: PointerEvent) => {
      // Clear scrollbar hover when pointer leaves the canvas, but only if not holding a button
      if (event.buttons === 0) {
        canvasEditorRef.current?.setScrollbarHover(null)
        // Clear function hover when pointer leaves the canvas
        canvasEditorRef.current?.updateFunctionHover(null)
      }
    }

    const handleWindowPointerMove = (event: PointerEvent) => {
      const canvas = canvasRef.current
      if (!canvas) return

      const rect = canvas.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top

      // Clear scrollbar hover if pointer is outside canvas bounds, but only if not holding a button
      if (event.buttons === 0 && (x < 0 || x > rect.width || y < 0 || y > rect.height)) {
        canvasEditorRef.current?.setScrollbarHover(null)
      }

      if (canvasEditorRef.current?.handleHeaderPointerMove(x, y)) {
        if (event.pointerType === 'touch') {
          event.preventDefault()
        }
        return
      }

      // Handle widget pointer move if widget is active (before any other checks)
      if (canvasEditorRef.current?.isWidgetPointerActive()) {
        canvasEditorRef.current.handleWidgetPointerMove(x, y)
        // Prevent default for touch events to prevent scrolling
        if (event.pointerType === 'touch') {
          event.preventDefault()
        }
        return
      }

      if (event.pointerType === 'touch' && canvasEditorRef.current?.isTouchScrollingActive()) {
        return
      }

      // Handle scrollbar dragging (allows dragging outside canvas)
      if (isDraggingScrollbarRef.current && dragStartRef.current) {
        const dx = event.clientX - dragStartRef.current.x
        const dy = event.clientY - dragStartRef.current.y
        canvasEditorRef.current?.handleScrollbarDrag(dx, dy, isDraggingScrollbarRef.current)
        dragStartRef.current = { x: event.clientX, y: event.clientY }
        return
      }

      // Only handle selection dragging if we're dragging a selection
      if (!mouseHandlerRef.current?.isDraggingSelection()) {
        return
      }

      const dpr = window.devicePixelRatio || 1
      const viewportHeight = canvas.height / dpr

      const boundaryZone = 20
      // Check if mouse is in top boundary zone (above or within 20px of top)
      // or bottom boundary zone (below or within 20px of bottom)
      const isInTopBoundary = y < boundaryZone
      const isInBottomBoundary = y > viewportHeight - boundaryZone

      // If mouse is in top or bottom boundary zone, use animation logic only
      // Don't update selection immediately to prevent jumping when mouse moves fast
      if (isInTopBoundary || isInBottomBoundary) {
        // Store projected position but don't update selection
        const projectedX = Math.max(0, Math.min(rect.width, x))
        // Project to the edge of the boundary zone
        const projectedY = isInTopBoundary ? boundaryZone : viewportHeight - boundaryZone
        const syntheticEvent = new PointerEvent('pointermove', {
          clientX: rect.left + projectedX,
          clientY: rect.top + projectedY,
          pointerId: event.pointerId,
          buttons: event.buttons,
        })
        // Only update lastMousePositionRef, don't update selection yet
        // Selection will update gradually during auto-scroll
        lastMousePositionRef.current = { x: projectedX, y: projectedY, event: syntheticEvent }
      }
      else if (
        x >= 0
        && x <= rect.width
        && y >= boundaryZone
        && y <= viewportHeight - boundaryZone
      ) {
        // Mouse is inside canvas (outside boundary zones) - update selection immediately
        mouseHandlerRef.current.handlePointerMove(event, inputStateRef.current)
        lastMousePositionRef.current = { x, y, event }
      }
      else {
        // Mouse is outside horizontally but vertically in middle area - handle normally
        const projectedX = Math.max(0, Math.min(rect.width, x))
        const syntheticEvent = new PointerEvent('pointermove', {
          clientX: rect.left + projectedX,
          clientY: event.clientY,
          pointerId: event.pointerId,
          buttons: event.buttons,
        })
        mouseHandlerRef.current.handlePointerMove(syntheticEvent, inputStateRef.current)
        lastMousePositionRef.current = { x: projectedX, y, event: syntheticEvent }
      }

      // Always update auto-scroll based on window position
      canvasEditorRef.current?.updateAutoScroll(event.clientX, event.clientY)
    }

    const handlePointerUp = (event: PointerEvent) => {
      // For window events, only handle if it's for this editor's canvas
      const canvas = canvasRef.current
      if (!canvas) return

      const wasHeaderActive = canvasEditorRef.current?.isHeaderPointerActive()
      if (wasHeaderActive) {
        canvasEditorRef.current?.handleHeaderPointerUp()
        event.preventDefault()
        lastMousePositionRef.current = { x: 0, y: 0, event: null }
        return
      }

      // If we're dragging a scrollbar, clear the state even if pointer is released outside canvas
      if (isDraggingScrollbarRef.current) {
        isDraggingScrollbarRef.current = null
        dragStartRef.current = null
        canvasEditorRef.current?.stopAutoScroll()
        canvasEditorRef.current?.setScrollbarHover(null)
        lastMousePositionRef.current = { x: 0, y: 0, event: null }
        return
      }

      const wasWidgetActive = canvasEditorRef.current?.isWidgetPointerActive()

      // Check if event target is this editor's canvas or a child of it
      // But always allow pointer up if we're dragging a selection (can happen outside canvas)
      const target = event.target as Node | null
      const isDraggingSelection = mouseHandlerRef.current?.isDraggingSelection()
      if (!wasWidgetActive && target && !canvas.contains(target) && target !== canvas && !isDraggingSelection) {
        return
      }

      event.preventDefault()

      // Handle widget pointer up first
      canvasEditorRef.current?.handleWidgetPointerUp()

      // If a widget was active, don't proceed with caret/selection/focus
      if (wasWidgetActive) {
        // Clear scrollbar dragging state
        isDraggingScrollbarRef.current = null
        dragStartRef.current = null
        lastMousePositionRef.current = { x: 0, y: 0, event: null }
        return
      }

      // Clear scrollbar dragging state
      if (isDraggingScrollbarRef.current) {
        canvasEditorRef.current?.setScrollbarHover(null)
      }
      isDraggingScrollbarRef.current = null
      dragStartRef.current = null

      // For touch events, check if scrolling occurred BEFORE calling handlePointerUp
      // This prevents the mouse handler from setting the caret and focus if scrolling occurred
      if (event.pointerType === 'touch') {
        const didScroll = canvasEditorRef.current?.didTouchScroll()

        if (didScroll) {
          // Clear pending touch position in mouse handler to prevent caret from being set
          mouseHandlerRef.current?.clearPendingTouchPosition()
          // Don't set focus if scrolling occurred
          canvasEditorRef.current?.clearTouchScrollFlag()
          // Stop auto-scroll and return early - don't do anything else
          canvasEditorRef.current?.stopAutoScroll()
          lastMousePositionRef.current = { x: 0, y: 0, event: null }
          return
        }

        // Only call handlePointerUp if no scrolling occurred (simple tap)
        // This will update the state via the mouse handler's callback
        // Store the old state to check if it changed
        const oldCaret = inputStateRef.current.caret
        const oldSelection = inputStateRef.current.selection
        mouseHandlerRef.current?.handlePointerUp(event, inputStateRef.current)
        // Update canvas editor state and ensure caret is visible for taps
        // Only update if state actually changed (caret was set)
        // Focus is handled by the mouse handler callback when caret is set
        const stateChanged = inputStateRef.current.caret !== oldCaret
          || inputStateRef.current.selection !== oldSelection
        if (stateChanged) {
          // For taps, ensure caret is visible
          debouncedUpdateState(inputStateRef.current, true)
        }
        canvasEditorRef.current?.clearTouchScrollFlag()
      }
      else {
        // For non-touch events, always call handlePointerUp
        mouseHandlerRef.current?.handlePointerUp(event, inputStateRef.current)
      }

      // Stop auto-scroll when pointer is released
      canvasEditorRef.current?.stopAutoScroll()
      lastMousePositionRef.current = { x: 0, y: 0, event: null }
    }

    canvas.addEventListener('pointerdown', handlePointerDown)
    canvas.addEventListener('pointermove', handlePointerMove)
    canvas.addEventListener('pointerleave', handlePointerLeave)
    canvas.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointermove', handleWindowPointerMove)
    window.addEventListener('pointerup', handlePointerUp)

    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown)
      canvas.removeEventListener('pointermove', handlePointerMove)
      canvas.removeEventListener('pointerleave', handlePointerLeave)
      canvas.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointermove', handleWindowPointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [onPointerDown])

  // Scrollbar dragging
  const isDraggingScrollbarRef = useRef<'vertical' | 'horizontal' | null>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)

  return (
    <div
      ref={containerRef}
      className={autoHeight
        ? 'text-white relative min-w-0'
        : 'text-white relative flex-1 min-w-0 min-h-0 h-full touch-none'}
      style={autoHeight ? { height: `${Math.max(0, scrollMetrics.contentHeight)}px` } : undefined}
      onMouseDown={() => setActiveEditor(editorIdRef.current)}
    >
      <canvas ref={canvasRef} onContextMenu={e => e.preventDefault()} className="absolute inset-0 outline-none" />
      <textarea
        ref={textareaRef}
        spellcheck={false}
        autoCorrect="off"
        tabIndex={0}
        style={{
          position: 'absolute',
          left: '-9999px',
          width: '1px',
          height: '1px',
          pointerEvents: 'none',
        }}
        onContextMenu={e => {
          e.preventDefault()
          e.stopPropagation()
        }}
        onKeyDown={e => {
          setActiveEditor(editorIdRef.current)
          handleKeyDown(e)
        }}
        onCopy={handleCopy}
        onPaste={handlePaste}
        onCut={handleCut}
        onBlur={() => {
          // Allow natural focus changes between editors
        }}
        onFocus={() => {
          // Don't activate if we're in the middle of a pointer down handler
          // as it will already handle activation with the correct state
          // Also don't activate if touch scrolling occurred or touch gesture is active
          if (!isHandlingPointerRef.current) {
            const didScroll = canvasEditorRef.current?.didTouchScroll()
            const isTouchGesture = canvasEditorRef.current?.isTouchGestureActive()
            if (!didScroll && !isTouchGesture) {
              setActiveEditor(editorIdRef.current)
            }
            else if (didScroll || isTouchGesture) {
              // Blur the textarea if it got focused during a scroll gesture
              textareaRef.current?.blur()
            }
          }
        }}
      />
    </div>
  )
}
