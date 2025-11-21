import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { getActiveEditor, setActiveEditor, subscribeActiveEditor } from './active-editor.ts'
import { type AutocompleteInfo, findCurrentWord } from './autocomplete.ts'
import AutocompletePopup from './AutocompletePopup.tsx'
import { CanvasEditor, type CanvasEditorCallbacks, type EditorWidget } from './CanvasEditor.ts'
import { CodeFile } from './CodeFile.ts'
import ErrorPopup, { type EditorError } from './ErrorPopup.tsx'
import {
  type FunctionCallInfo,
  functionDefinitions as defaultFunctionDefinitions,
  type FunctionSignature,
} from './function-signature.ts'
import FunctionSignaturePopup from './FunctionSignaturePopup.tsx'
import { History } from './history.ts'
import {
  getSelectedText,
  InputHandler,
  type InputState,
  type KeyOverrideFunction,
} from './input.ts'
import { MouseHandler } from './mouse.ts'
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
  errors?: EditorError[]
  widgets?: EditorWidget[]
  canvasRef?: React.RefObject<HTMLCanvasElement>
  autoHeight?: boolean
  keyOverride?: KeyOverrideFunction
  hideFunctionSignatures?: boolean
  onPointerDown?: (event: PointerEvent) => void
}

export const CodeEditor = ({
  codeFile: externalCodeFile,
  value,
  setValue,
  wordWrap = false,
  gutter = false,
  theme,
  tokenizer,
  functionDefinitions = defaultFunctionDefinitions,
  errors = [],
  widgets = [],
  canvasRef: extCanvasRef,
  autoHeight = false,
  keyOverride,
  hideFunctionSignatures = false,
  onPointerDown,
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

  // Function signature popup state
  const [functionCallInfo, setFunctionCallInfo] = useState<FunctionCallInfo | null>(null)
  const [popupPosition, setPopupPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [popupDimensions, setPopupDimensions] = useState<{ width: number; height: number }>({
    width: 400,
    height: 120,
  })

  // Autocomplete state
  const [autocompleteInfo, setAutocompleteInfo] = useState<AutocompleteInfo | null>(null)
  const [autocompletePosition, setAutocompletePosition] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  })
  const [autocompleteReady, setAutocompleteReady] = useState(false)
  const [autocompleteSelectedIndex, setAutocompleteSelectedIndex] = useState(0)

  // Error popup state
  const [hoveredError, setHoveredError] = useState<EditorError | null>(null)
  const [errorPosition, setErrorPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 })

  const [isActive, setIsActive] = useState(false)
  const editorIdRef = useRef<string>(Math.random().toString(36).slice(2))

  const inputHandlerRef = useRef<InputHandler | null>(null)
  const mouseHandlerRef = useRef<MouseHandler | null>(null)
  const inputStateRef = useRef<InputState>(inputState)
  const setInputStateRef = useRef<(state: InputState) => void>(() => {})
  const lastTextRef = useRef<string>(codeFile.value)
  const lastScrollRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

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

  // Custom setter that updates canvas editor
  const setInputState = useCallback(
    (newState: InputState) => {
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

      // Only update if something actually changed
      if (!caretChanged && !selectionChanged && !linesChanged) {
        return
      }

      isUserInputRef.current = true
      setInputStateInternal(newState)
      inputStateRef.current = newState

      // Always update CodeFile to trigger subscriptions
      codeFileRef.current.inputState = newState

      if (linesChanged) {
        lastTextRef.current = newText
        // Also call external setValue if provided (legacy mode)
        setValue?.(newText)
      }
      else {
        // Keep lastTextRef in sync even if text didn't change
        lastTextRef.current = newText
      }
    },
    [setValue],
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

  // Keep ref in sync with current state
  useEffect(() => {
    inputStateRef.current = inputState
  }, [inputState])

  // Sync with external value changes (legacy mode)
  useEffect(() => {
    if (value !== undefined && !externalCodeFile) {
      const lines = value.split('\n')
      const currentLines = inputStateRef.current.lines.join('\n')
      if (currentLines !== value) {
        lastTextRef.current = value
        const newState = {
          ...inputStateRef.current,
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

    let rafId: number | null = null

    // Initialize state from external codeFile when it changes
    const state = externalCodeFile.getState()
    setInputStateInternal(state.inputState)
    inputStateRef.current = state.inputState
    lastTextRef.current = state.value
    lastScrollRef.current = { x: state.scrollX, y: state.scrollY }

    rafId = requestAnimationFrame(() => {
      canvasEditorRef.current?.setScroll(state.scrollX, state.scrollY)
    })

    // Subscribe to external CodeFile changes
    const unsubscribe = externalCodeFile.subscribe(() => {
      const state = externalCodeFile.getState()
      const newValue = state.value
      const currentValue = lastTextRef.current

      // Only update if the value actually changed
      if (newValue !== currentValue) {
        skipEnsureCaretVisibleRef.current = true
        lastCanvasUpdateValueRef.current = newValue
        setInputStateInternal(state.inputState)
        inputStateRef.current = state.inputState
        lastTextRef.current = newValue
        // Update widgets without drawing, then updateState will draw once
        canvasEditorRef.current?.updateWidgets(widgetsRef.current)
        // Update canvas editor directly without ensuring caret visibility
        canvasEditorRef.current?.updateState(state.inputState, false)
      }

      // Update scroll position if it changed from what we last set
      if (state.scrollX !== lastScrollRef.current.x || state.scrollY !== lastScrollRef.current.y) {
        lastScrollRef.current = { x: state.scrollX, y: state.scrollY }
        requestAnimationFrame(() => {
          canvasEditorRef.current?.setScroll(state.scrollX, state.scrollY)
        })
      }
    })

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      unsubscribe()
    }
  }, [externalCodeFile])

  // Handle clipboard events
  const handleCopy = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    // Let the browser handle the copy operation naturally
    // The textarea already contains the selected text
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault()
    inputHandlerRef.current?.handlePasteEvent(e, inputStateRef.current)
  }

  const handleCut = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault()
    inputHandlerRef.current?.handleCut(inputStateRef.current)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
        setAutocompleteSelectedIndex(0)
        e.preventDefault()
        return
      }
      canvasEditorRef.current?.hideSignaturePopup()
      return
    }

    // Handle autocomplete interactions (before general key handling)
    // Only handle if autocomplete is actually visible (same conditions as JSX)
    const isAutocompleteVisible = isActive
      && autocompleteInfo
      && autocompleteInfo.suggestions.length > 0
      && autocompleteReady
      && !inputState.selection
      && (() => {
        const currentLine = inputState.lines[inputState.caret.line] || ''
        const wordInfo = findCurrentWord(
          inputState.lines,
          inputState.caret.line,
          inputState.caret.column,
        )
        const matchesCurrentWord = wordInfo !== null
          && wordInfo.startColumn === autocompleteInfo.startColumn
          && wordInfo.endColumn === autocompleteInfo.endColumn
          && wordInfo.word === autocompleteInfo.word
        return wordInfo !== null && currentLine.trim().length > 0 && matchesCurrentWord
      })()

    if (isAutocompleteVisible) {
      if (e.key === 'Tab') {
        e.preventDefault()
        const len = autocompleteInfo.suggestions.length
        // Cycle through suggestions (Shift+Tab goes backwards)
        setAutocompleteSelectedIndex(prev => (prev + (e.shiftKey ? len - 1 : 1)) % len)
        return
      }

      if (e.key === 'Enter') {
        e.preventDefault()
        // Accept selected suggestion
        const currentState = inputStateRef.current
        const selectedSuggestion = autocompleteInfo.suggestions[autocompleteSelectedIndex]
        const line = currentState.lines[currentState.caret.line]
        const newLine = line.substring(0, autocompleteInfo.startColumn)
          + selectedSuggestion
          + line.substring(autocompleteInfo.endColumn)

        const newLines = [...currentState.lines]
        newLines[currentState.caret.line] = newLine

        const newState: InputState = {
          ...currentState,
          lines: newLines,
          caret: {
            line: currentState.caret.line,
            column: autocompleteInfo.startColumn + selectedSuggestion.length,
            columnIntent: autocompleteInfo.startColumn + selectedSuggestion.length,
          },
        }

        // Save to history before applying the change
        if (inputHandlerRef.current) {
          // Flush any pending debounced state
          codeFileRef.current.history.flushDebouncedState(currentState)
          // Save before state
          inputHandlerRef.current.saveBeforeStateToHistory(currentState)
          // Save after state
          inputHandlerRef.current.saveAfterStateToHistory(newState)
        }

        setInputState(newState)
        canvasEditorRef.current?.hideAutocomplete()
        setAutocompleteSelectedIndex(0)
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
      setAutocompleteSelectedIndex(0)
    }

    inputHandlerRef.current?.handleKeyDown(e, inputStateRef.current)
  }

  // Reset selected index when autocomplete info changes
  useEffect(() => {
    setAutocompleteSelectedIndex(0)
    // Clear ready state and position when autocomplete is cleared
    if (!autocompleteInfo) {
      setAutocompleteReady(false)
      setAutocompletePosition({ x: 0, y: 0 })
    }
  }, [autocompleteInfo])

  // Update errors in canvas editor
  useEffect(() => {
    canvasEditorRef.current?.setErrors(errors)
  }, [errors])

  // Hide error popup if the hovered error was removed from the list
  useEffect(() => {
    if (!hoveredError) return
    const exists = errors.some(
      e =>
        e.line === hoveredError.line
        && e.startColumn === hoveredError.startColumn
        && e.endColumn === hoveredError.endColumn
        && e.message === hoveredError.message,
    )
    if (!exists) {
      setHoveredError(null)
    }
  }, [errors, hoveredError])

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
      // Call setInputState first - it needs to see oldState in the ref for comparison
      setInputStateRef.current(newState)
      // Now update ref synchronously so it's available immediately for updateState call
      inputStateRef.current = newState
    })
  }, []) // Remove setInputState dependency since it's stable

  // Store callbacks in refs to avoid recreating CanvasEditor
  const callbacksRef = useRef<CanvasEditorCallbacks>({
    onFunctionCallChange: setFunctionCallInfo,
    onPopupPositionChange: setPopupPosition,
    onAutocompleteChange: setAutocompleteInfo,
    onAutocompletePositionChange: pos => {
      setAutocompletePosition(pos)
      if (pos.x !== 0 || pos.y !== 0) setAutocompleteReady(true)
    },
    onScrollChange: (sx, sy) => {
      mouseHandlerRef.current?.setScrollOffset(sx, sy)
      // Update CodeFile scroll position and track it
      lastScrollRef.current = { x: sx, y: sy }
      codeFileRef.current.scrollX = sx
      codeFileRef.current.scrollY = sy
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
    onErrorHover: setHoveredError,
    onErrorPositionChange: setErrorPosition,
  })

  // Keep callbacks ref up to date
  useEffect(() => {
    callbacksRef.current = {
      onFunctionCallChange: setFunctionCallInfo,
      onPopupPositionChange: setPopupPosition,
      onAutocompleteChange: setAutocompleteInfo,
      onAutocompletePositionChange: pos => {
        setAutocompletePosition(pos)
        if (pos.x !== 0 || pos.y !== 0) setAutocompleteReady(true)
      },
      onScrollChange: (sx, sy) => {
        mouseHandlerRef.current?.setScrollOffset(sx, sy)
        // Update CodeFile scroll position and track it
        lastScrollRef.current = { x: sx, y: sy }
        codeFileRef.current.scrollX = sx
        codeFileRef.current.scrollY = sy

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
      onErrorHover: setHoveredError,
      onErrorPositionChange: setErrorPosition,
    }
  })

  // Initialize canvas editor
  useEffect(() => {
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
      },
    )

    // Set function definitions for autocomplete
    canvasEditorRef.current.setFunctionDefinitions(functionDefinitions)

    // Set errors
    canvasEditorRef.current.setErrors(errors)

    // Set initial active state
    const currentActive = getActiveEditor() === editorIdRef.current
    canvasEditorRef.current.setActive(currentActive)

    // Restore scroll position from CodeFile
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
      canvasEditorRef.current?.destroy()
    }
  }, [wordWrap, gutter])

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
        canvasEditorRef.current?.setWidgets(widgets)
      }
      return
    }

    prevInputStateRef.current = inputState
    prevWidgetsRef.current = widgets

    if (inputStateChanged && widgetsChanged) {
      // Both changed: update widgets without drawing, then updateState will draw once
      canvasEditorRef.current?.updateWidgets(widgets)
      const shouldEnsureCaretVisible = isUserInputRef.current && !skipEnsureCaretVisibleRef.current
      isUserInputRef.current = false
      skipEnsureCaretVisibleRef.current = false
      canvasEditorRef.current?.updateState(inputState, shouldEnsureCaretVisible)
    }
    else if (inputStateChanged) {
      // Only inputState changed
      const shouldEnsureCaretVisible = isUserInputRef.current && !skipEnsureCaretVisibleRef.current
      isUserInputRef.current = false
      skipEnsureCaretVisibleRef.current = false
      canvasEditorRef.current?.updateState(inputState, shouldEnsureCaretVisible)
    }
    else if (widgetsChanged) {
      // Only widgets changed
      canvasEditorRef.current?.setWidgets(widgets)
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
    const canvas = canvasRef.current
    if (!canvas) return

    const handlePointerDown = (event: PointerEvent) => {
      onPointerDown?.(event)
      event.preventDefault()
      isHandlingPointerRef.current = true
      canvasEditorRef.current?.setAutocompleteInputSource('mouse')

      const rect = canvas.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top

      // Check if clicking on a widget
      const widgetHandled = canvasEditorRef.current?.handleWidgetPointerDown(x, y)
      if (widgetHandled) {
        setActiveEditor(editorIdRef.current)
        isHandlingPointerRef.current = false
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

      if (wordWrap && canvasEditorRef.current) {
        // Set up word wrap coordinate converter for MouseHandler
        const wordWrapConverter = (x: number, y: number) => {
          // CanvasEditor expects raw coordinates and will add scroll offset internally
          return canvasEditorRef.current!.getCaretPositionFromCoordinates(x, y)
        }
        mouseHandlerRef.current?.setWordWrapCoordinateConverter(wordWrapConverter)

        // Let MouseHandler handle everything (including double/triple clicks)
        // This will call the callback which updates inputStateRef.current synchronously
        mouseHandlerRef.current?.handlePointerDown(event, inputStateRef.current)
      }
      else {
        mouseHandlerRef.current?.handlePointerDown(event, inputStateRef.current)
      }

      // Update canvas editor state synchronously with the updated ref from mouse handler callback
      // The callback already updated inputStateRef.current, so this will have the latest state
      canvasEditorRef.current?.updateState(inputStateRef.current, true)

      // Activate and focus after updating state so ensureCaretVisible sees the correct position
      setActiveEditor(editorIdRef.current)
      textareaRef.current?.focus({ preventScroll: true })

      // Clear the flag after a small delay to ensure focus event has been processed
      setTimeout(() => {
        isHandlingPointerRef.current = false
      }, 0)
    }

    const handlePointerMove = (event: PointerEvent) => {
      event.preventDefault()

      const rect = canvas.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top

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

    const handleWindowPointerMove = (event: PointerEvent) => {
      // Only handle if we're dragging a selection
      if (!mouseHandlerRef.current?.isDraggingSelection()) {
        return
      }

      const canvas = canvasRef.current
      if (!canvas) return

      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const viewportHeight = canvas.height / dpr
      let x = event.clientX - rect.left
      let y = event.clientY - rect.top

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
      event.preventDefault()

      // Handle widget pointer up
      canvasEditorRef.current?.handleWidgetPointerUp()

      // Clear scrollbar dragging state
      isDraggingScrollbarRef.current = null
      dragStartRef.current = null

      mouseHandlerRef.current?.handlePointerUp(event, inputStateRef.current)

      // Stop auto-scroll when pointer is released
      canvasEditorRef.current?.stopAutoScroll()
      lastMousePositionRef.current = { x: 0, y: 0, event: null }
    }

    canvas.addEventListener('pointerdown', handlePointerDown)
    canvas.addEventListener('pointermove', handlePointerMove)
    canvas.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointermove', handleWindowPointerMove)
    window.addEventListener('pointerup', handlePointerUp)

    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown)
      canvas.removeEventListener('pointermove', handlePointerMove)
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
        : 'text-white relative flex-1 min-w-0 min-h-0 h-full'}
      style={autoHeight ? { height: `${Math.max(0, scrollMetrics.contentHeight)}px` } : undefined}
      onMouseDown={() => setActiveEditor(editorIdRef.current)}
    >
      <canvas ref={canvasRef} className="absolute inset-0 outline-none" />
      <textarea
        ref={textareaRef}
        spellCheck={false}
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
          if (!isHandlingPointerRef.current) {
            setActiveEditor(editorIdRef.current)
          }
        }}
      />

      {/* Autocomplete popup */}
      {isActive
        && autocompleteInfo
        && autocompleteInfo.suggestions.length > 0
        && autocompleteReady
        && (() => {
          // Hide popup if current line is empty or there's no word at cursor
          const currentLine = inputState.lines[inputState.caret.line] || ''
          const wordInfo = findCurrentWord(
            inputState.lines,
            inputState.caret.line,
            inputState.caret.column,
          )
          // Verify autocompleteInfo matches current word position
          const matchesCurrentWord = wordInfo !== null
            && wordInfo.startColumn === autocompleteInfo.startColumn
            && wordInfo.endColumn === autocompleteInfo.endColumn
            && wordInfo.word === autocompleteInfo.word
          return !inputState.selection && wordInfo !== null && currentLine.trim().length > 0 && matchesCurrentWord
        })() && (
        <AutocompletePopup
          suggestions={autocompleteInfo.suggestions}
          selectedIndex={autocompleteSelectedIndex}
          position={autocompletePosition}
          visible={true}
          theme={theme ?? defaultTheme}
          onHover={index => setAutocompleteSelectedIndex(index)}
          onSelect={index => {
            const selectedSuggestion = autocompleteInfo.suggestions[index]
            const line = inputStateRef.current.lines[inputStateRef.current.caret.line]
            const newLine = line.substring(0, autocompleteInfo.startColumn)
              + selectedSuggestion
              + line.substring(autocompleteInfo.endColumn)

            const newLines = [...inputStateRef.current.lines]
            newLines[inputStateRef.current.caret.line] = newLine

            const newState: InputState = {
              ...inputStateRef.current,
              lines: newLines,
              caret: {
                line: inputStateRef.current.caret.line,
                column: autocompleteInfo.startColumn + selectedSuggestion.length,
                columnIntent: autocompleteInfo.startColumn + selectedSuggestion.length,
              },
            }

            // Save to history before applying the change
            if (inputHandlerRef.current) {
              // Flush any pending debounced state
              codeFileRef.current.history.flushDebouncedState(inputStateRef.current)
              // Save before state
              inputHandlerRef.current.saveBeforeStateToHistory(inputStateRef.current)
              // Save after state
              inputHandlerRef.current.saveAfterStateToHistory(newState)
            }

            setInputState(newState)
            canvasEditorRef.current?.hideAutocomplete()
            setAutocompleteSelectedIndex(0)
            setAutocompleteReady(false)
          }}
        />
      )}

      {/* Function signature popup */}
      {!hideFunctionSignatures
        && isActive
        && functionCallInfo
        && functionDefinitions[functionCallInfo.functionName] && (
        <FunctionSignaturePopup
          signature={functionDefinitions[functionCallInfo.functionName]}
          currentArgumentIndex={functionCallInfo.currentArgumentIndex}
          currentParameterName={functionCallInfo.currentParameterName}
          position={popupPosition}
          visible={!inputState.selection}
          theme={theme ?? defaultTheme}
          onDimensionsChange={(width, height) => {
            setPopupDimensions({ width, height })
            canvasEditorRef.current?.setPopupDimensions(width, height)
          }}
        />
      )}

      {/* Error popup */}
      {isActive && hoveredError && (
        <ErrorPopup
          error={hoveredError}
          position={errorPosition}
          visible={!inputState.selection}
          theme={theme ?? defaultTheme}
        />
      )}
    </div>
  )
}
