import { useCallback, useEffect, useRef, useState } from 'react'
import { getActiveEditor, setActiveEditor, subscribeActiveEditor } from './active-editor.ts'
import { CanvasEditor, type CanvasEditorCallbacks } from './CanvasEditor.ts'
import {
  type FunctionCallInfo,
  functionDefinitions as defaultFunctionDefinitions,
  type FunctionSignature,
} from './function-signature.ts'
import { type AutocompleteInfo } from './autocomplete.ts'
import FunctionSignaturePopup from './FunctionSignaturePopup.tsx'
import AutocompletePopup from './AutocompletePopup.tsx'
import { History } from './history.ts'
import { getSelectedText, InputHandler, type InputState } from './input.ts'
import { MouseHandler } from './mouse.ts'
import { type Theme } from './syntax.ts'

interface CodeEditorProps {
  value: string
  setValue: (value: string) => void
  wordWrap?: boolean
  gutter?: boolean
  theme?: Theme
  functionDefinitions?: Record<string, FunctionSignature>
}

export const CodeEditor = ({
  value,
  setValue,
  wordWrap = false,
  gutter = false,
  theme,
  functionDefinitions = defaultFunctionDefinitions,
}: CodeEditorProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasEditorRef = useRef<CanvasEditor | null>(null)

  const [inputState, setInputStateInternal] = useState<InputState>({
    caret: { line: 0, column: 0, columnIntent: 0 },
    selection: null,
    lines: value.split('\n'),
  })

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
  const [autocompleteSelectedIndex, setAutocompleteSelectedIndex] = useState(0)

  const [isActive, setIsActive] = useState(false)
  const editorIdRef = useRef<string>(Math.random().toString(36).slice(2))

  const inputHandlerRef = useRef<InputHandler | null>(null)
  const historyRef = useRef<History | null>(null)
  const mouseHandlerRef = useRef<MouseHandler | null>(null)
  const inputStateRef = useRef<InputState>(inputState)

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

  // Custom setter that updates canvas editor
  const setInputState = useCallback(
    (newState: InputState) => {
      setInputStateInternal(newState)
      inputStateRef.current = newState
      setValue(newState.lines.join('\n'))
    },
    [setValue],
  )

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

  // Sync with external value changes
  useEffect(() => {
    const lines = value.split('\n')
    const currentLines = inputStateRef.current.lines.join('\n')
    if (currentLines !== value) {
      setInputStateInternal(prev => ({
        ...prev,
        lines,
      }))
      inputStateRef.current = {
        ...inputStateRef.current,
        lines,
      }
    }
  }, [value])

  // Handle clipboard events
  const handleCopy = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    // Let the browser handle the copy operation naturally
    // The textarea already contains the selected text
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    inputHandlerRef.current?.handlePasteEvent(e, inputState)
  }

  const handleCut = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    inputHandlerRef.current?.handleCut(inputState)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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

    // Handle autocomplete interactions
    if (autocompleteInfo && autocompleteInfo.suggestions.length > 0) {
      if (e.key === 'Tab') {
        e.preventDefault()
        // Cycle through suggestions
        setAutocompleteSelectedIndex(prev => (prev + 1) % autocompleteInfo.suggestions.length)
        return
      }

      if (e.key === 'Enter') {
        e.preventDefault()
        // Accept selected suggestion
        const selectedSuggestion = autocompleteInfo.suggestions[autocompleteSelectedIndex]
        const line = inputState.lines[inputState.caret.line]
        const newLine =
          line.substring(0, autocompleteInfo.startColumn) +
          selectedSuggestion +
          line.substring(autocompleteInfo.endColumn)

        const newLines = [...inputState.lines]
        newLines[inputState.caret.line] = newLine

        const newState: InputState = {
          ...inputState,
          lines: newLines,
          caret: {
            line: inputState.caret.line,
            column: autocompleteInfo.startColumn + selectedSuggestion.length,
            columnIntent: autocompleteInfo.startColumn + selectedSuggestion.length,
          },
        }

        setInputState(newState)
        canvasEditorRef.current?.hideAutocomplete()
        setAutocompleteSelectedIndex(0)
        return
      }
    }

    inputHandlerRef.current?.handleKeyDown(e, inputState)
  }

  // Reset selected index when autocomplete info changes
  useEffect(() => {
    setAutocompleteSelectedIndex(0)
  }, [autocompleteInfo])

  useEffect(() => {
    // Initialize history only once
    if (!historyRef.current) {
      historyRef.current = new History()
    }
    // Initialize input handler only once
    if (!inputHandlerRef.current) {
      inputHandlerRef.current = new InputHandler(setInputState, historyRef.current)
    }
  }, []) // Remove setInputState dependency since it's stable and we check if handler exists

  useEffect(() => {
    const unsub = subscribeActiveEditor(activeId => {
      const active = activeId === editorIdRef.current
      setIsActive(active)
      canvasEditorRef.current?.setActive(active)
    })

    // Initialize active state - if no editor is active, make this one active
    const currentActive = getActiveEditor()
    if (currentActive === null) {
      setActiveEditor(editorIdRef.current)
    }

    return () => {
      unsub()
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
      setInputState(newState)
    })
  }, []) // Remove setInputState dependency since it's stable

  // Initialize canvas editor
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const callbacks: CanvasEditorCallbacks = {
      onFunctionCallChange: setFunctionCallInfo,
      onPopupPositionChange: setPopupPosition,
      onAutocompleteChange: setAutocompleteInfo,
      onAutocompletePositionChange: setAutocompletePosition,
      onScrollChange: (sx, sy) => {
        mouseHandlerRef.current?.setScrollOffset(sx, sy)
      },
      onScrollMetricsChange: m => setScrollMetrics(m),
    }

    canvasEditorRef.current = new CanvasEditor(canvas, container, inputState, callbacks, {
      wordWrap,
      gutter,
      theme,
    })

    // Set function definitions for autocomplete
    canvasEditorRef.current.setFunctionDefinitions(functionDefinitions)

    // Set initial active state
    const currentActive = getActiveEditor() === editorIdRef.current
    canvasEditorRef.current.setActive(currentActive)

    // Wire up word-wrap-aware movement to the input handler
    if (inputHandlerRef.current) {
      inputHandlerRef.current.setMovementCallbacks({
        getCaretForHorizontalMove: (direction, line, column) =>
          canvasEditorRef.current?.getCaretForHorizontalMove(direction, line, column) ?? null,
        getCaretForVerticalMove: (direction, line, columnIntent) =>
          canvasEditorRef.current?.getCaretForVerticalMove(direction, line, columnIntent) ?? null,
      })
    }

    return () => {
      canvasEditorRef.current?.destroy()
    }
  }, [wordWrap, gutter, theme])

  // Update canvas editor state when inputState changes
  useEffect(() => {
    canvasEditorRef.current?.updateState(inputState)
  }, [inputState])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const handlePointerDown = (event: PointerEvent) => {
      event.preventDefault()
      setActiveEditor(editorIdRef.current)

      const rect = canvas.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top

      // Check if clicking on scrollbar
      const scrollbar = canvasEditorRef.current?.checkScrollbarHover(x, y)
      if (scrollbar) {
        const isThumb = canvasEditorRef.current?.handleScrollbarClick(x, y, scrollbar)
        if (isThumb) {
          isDraggingScrollbarRef.current = scrollbar
          dragStartRef.current = { x: event.clientX, y: event.clientY }
        }
        return
      }

      // Focus first to avoid flicker then process pointer so caret updates after focus
      textareaRef.current?.focus()

      if (wordWrap && canvasEditorRef.current) {
        // Set up word wrap coordinate converter for MouseHandler
        const wordWrapConverter = (x: number, y: number) => {
          // CanvasEditor expects raw coordinates and will add scroll offset internally
          return canvasEditorRef.current!.getCaretPositionFromCoordinates(x, y)
        }
        mouseHandlerRef.current?.setWordWrapCoordinateConverter(wordWrapConverter)

        // Let MouseHandler handle everything (including double/triple clicks)
        mouseHandlerRef.current?.handlePointerDown(event, inputStateRef.current)
      } else {
        mouseHandlerRef.current?.handlePointerDown(event, inputStateRef.current)
      }
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

      mouseHandlerRef.current?.handlePointerMove(event, inputStateRef.current)
    }

    const handlePointerUp = (event: PointerEvent) => {
      event.preventDefault()

      // Clear scrollbar dragging state
      isDraggingScrollbarRef.current = null
      dragStartRef.current = null

      mouseHandlerRef.current?.handlePointerUp(event, inputStateRef.current)
    }

    canvas.addEventListener('pointerdown', handlePointerDown)
    canvas.addEventListener('pointermove', handlePointerMove)
    canvas.addEventListener('pointerup', handlePointerUp)

    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown)
      canvas.removeEventListener('pointermove', handlePointerMove)
      canvas.removeEventListener('pointerup', handlePointerUp)
    }
  }, [])

  // Scrollbar dragging
  const isDraggingScrollbarRef = useRef<'vertical' | 'horizontal' | null>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)

  return (
    <div
      ref={containerRef}
      className="bg-neutral-800 text-white relative flex-1 min-w-0 min-h-0 h-full"
      onMouseDown={() => setActiveEditor(editorIdRef.current)}
    >
      <canvas ref={canvasRef} className="absolute inset-0 outline-none" />
      <textarea
        ref={textareaRef}
        className="absolute inset-0 opacity-0 z-50"
        spellCheck={false}
        autoCorrect="off"
        tabIndex={0}
        style={{ pointerEvents: 'none' }}
        onContextMenu={e => {
          e.preventDefault()
          e.stopPropagation()
        }}
        onKeyDown={e => {
          setActiveEditor(editorIdRef.current)

          // Handle Alt+Arrow combinations for line moving (bypass word wrap logic)
          if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            handleKeyDown(e)
            return
          }

          if (wordWrap && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault()
            const dir = e.key === 'ArrowUp' ? 'up' : 'down'
            const caret = inputStateRef.current.caret
            const next = canvasEditorRef.current?.getCaretForVerticalMove(
              dir,
              caret.line,
              caret.columnIntent,
            )
            if (next && (next.line !== caret.line || next.column !== caret.column)) {
              const newState: InputState = {
                ...inputStateRef.current,
                caret: { line: next.line, column: next.column, columnIntent: caret.columnIntent },
                selection: e.shiftKey
                  ? inputStateRef.current.selection
                    ? {
                        start: inputStateRef.current.selection.start,
                        end: { line: next.line, column: next.column },
                      }
                    : {
                        start: { line: caret.line, column: caret.column },
                        end: { line: next.line, column: next.column },
                      }
                  : null,
              }
              setInputState(newState)
            } else {
              // If wrapped movement didn' work, fall back to normal arrow key handling
              handleKeyDown(e)
            }
          } else if (
            wordWrap &&
            !e.ctrlKey &&
            !e.metaKey &&
            (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
          ) {
            e.preventDefault()
            const dir = e.key === 'ArrowLeft' ? 'left' : 'right'
            const caret = inputStateRef.current.caret
            const next = canvasEditorRef.current?.getCaretForHorizontalMove(
              dir,
              caret.line,
              caret.column,
            )
            if (next) {
              const newState: InputState = {
                ...inputStateRef.current,
                caret: { line: next.line, column: next.column, columnIntent: next.columnIntent },
                selection: e.shiftKey
                  ? inputStateRef.current.selection
                    ? {
                        start: inputStateRef.current.selection.start,
                        end: { line: next.line, column: next.column },
                      }
                    : {
                        start: { line: caret.line, column: caret.column },
                        end: { line: next.line, column: next.column },
                      }
                  : null,
              }
              setInputState(newState)
            } else {
              // If wrapped movement didn't work, fall back to normal arrow key handling
              handleKeyDown(e)
            }
          } else {
            handleKeyDown(e)
          }
        }}
        onCopy={handleCopy}
        onPaste={handlePaste}
        onCut={handleCut}
        onBlur={() => {
          // Allow natural focus changes between editors
        }}
        onFocus={() => {
          setActiveEditor(editorIdRef.current)
        }}
      />

      {/* Autocomplete popup */}
      {isActive && autocompleteInfo && (
        <AutocompletePopup
          suggestions={autocompleteInfo.suggestions}
          selectedIndex={autocompleteSelectedIndex}
          position={autocompletePosition}
          visible={true}
        />
      )}

      {/* Function signature popup */}
      {isActive && functionCallInfo && functionDefinitions[functionCallInfo.functionName] && (
        <FunctionSignaturePopup
          signature={functionDefinitions[functionCallInfo.functionName]}
          currentArgumentIndex={functionCallInfo.currentArgumentIndex}
          position={popupPosition}
          visible={true}
          onDimensionsChange={(width, height) => {
            setPopupDimensions({ width, height })
            canvasEditorRef.current?.setPopupDimensions(width, height)
          }}
        />
      )}
    </div>
  )
}
