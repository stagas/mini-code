import { useCallback, useEffect, useRef, useState } from 'react'
import { getActiveEditor, setActiveEditor, subscribeActiveEditor } from './active-editor.ts'
import { CanvasEditor, type CanvasEditorCallbacks } from './CanvasEditor.ts'
import {
  type FunctionCallInfo,
  functionDefinitions,
} from './function-signature.ts'
import FunctionSignaturePopup from './FunctionSignaturePopup.tsx'
import { History } from './history.ts'
import { getSelectedText, InputHandler, type InputState } from './input.ts'
import { MouseHandler } from './mouse.ts'

interface CodeEditorProps {
  wordWrap?: boolean
}

export const CodeEditor = ({ wordWrap = false }: CodeEditorProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasEditorRef = useRef<CanvasEditor | null>(null)

  const [inputState, setInputStateInternal] = useState<InputState>({
    caret: { line: 0, column: 0, columnIntent: 0 },
    selection: null,
    lines: [
      'function fibonacci(n) {',
      '  if (n <= 1) return n;',
      '  return fibonacci(n - 1) + fibonacci(n - 2);',
      '}',
      '',
      '// Calculate first 10 Fibonacci numbers',
      'for (let i = 0; i < 10; i++) {',
      '  console.log(fibonacci(i));',
      '}',
      '',
      '// Try typing these function calls to see the popup:',
      '// Math.max(',
      '// setTimeout(',
      '// Array.from(',
      '// console.log(',
    ],
  })

  // Function signature popup state
  const [functionCallInfo, setFunctionCallInfo] = useState<FunctionCallInfo | null>(null)
  const [popupPosition, setPopupPosition] = useState<{ x: number; y: number; showBelow: boolean }>({ x: 0, y: 0,
    showBelow: false })
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
  }>({ scrollX: 0, scrollY: 0, viewportWidth: 0, viewportHeight: 0, contentWidth: 0, contentHeight: 0 })

  // Custom setter that updates canvas editor
  const setInputState = useCallback((newState: InputState) => {
    setInputStateInternal(newState)
    inputStateRef.current = newState
    // Remove redundant updateState call - now handled by useEffect
  }, [])

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

  // Handle clipboard events
  const handleCopy = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    // Let the browser handle the copy operation naturally
    // The textarea already contains the selected text
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    inputHandlerRef.current?.handlePasteEvent(e.nativeEvent, inputState)
  }

  const handleCut = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    inputHandlerRef.current?.handleCut(inputState)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    inputHandlerRef.current?.handleKeyDown(e.nativeEvent, inputState)
  }

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
    const unsub = subscribeActiveEditor((activeId) => {
      const active = activeId === editorIdRef.current
      setIsActive(active)
      canvasEditorRef.current?.setActive(active)
    })
    // Initialize active state on mount
    const active = getActiveEditor() === editorIdRef.current
    setIsActive(active)
    canvasEditorRef.current?.setActive(active)
    return () => {
      unsub()
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Initialize mouse handler with a wrapper that saves selection changes to history
    mouseHandlerRef.current = new MouseHandler(canvas, (newState) => {
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
      onScrollChange: (sx, sy) => {
        mouseHandlerRef.current?.setScrollOffset(sx, sy)
      },
      onScrollMetricsChange: (m) => setScrollMetrics(m),
    }

    canvasEditorRef.current = new CanvasEditor(canvas, container, inputState, callbacks, { wordWrap })

    return () => {
      canvasEditorRef.current?.destroy()
    }
  }, []) // Remove inputState from dependencies to prevent recreation

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
      }
      else {
        mouseHandlerRef.current?.handlePointerDown(event, inputStateRef.current)
      }
    }

    const handlePointerMove = (event: PointerEvent) => {
      event.preventDefault()
      mouseHandlerRef.current?.handlePointerMove(event, inputStateRef.current)
    }

    const handlePointerUp = (event: PointerEvent) => {
      event.preventDefault()
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
  const isDraggingVRef = useRef(false)
  const isDraggingHRef = useRef(false)
  const dragStartRef = useRef<{ x: number; y: number; scrollX: number; scrollY: number } | null>(null)
  const moveListenerRef = useRef<((e: PointerEvent) => void) | null>(null)
  const upListenerRef = useRef<(() => void) | null>(null)

  const startVerticalDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    isDraggingVRef.current = true
    dragStartRef.current = { x: e.clientX, y: e.clientY, scrollX: scrollMetrics.scrollX,
      scrollY: scrollMetrics.scrollY }

    const handleMove = (ev: PointerEvent) => {
      if (!dragStartRef.current || !canvasEditorRef.current) return
      const { y, scrollY } = dragStartRef.current
      const trackHeight = Math.max(1, scrollMetrics.viewportHeight)
      const contentScrollable = Math.max(1, scrollMetrics.contentHeight - scrollMetrics.viewportHeight)
      const thumbHeight = Math.max(20,
        (scrollMetrics.viewportHeight / Math.max(1, scrollMetrics.contentHeight)) * trackHeight)
      const maxThumbTravel = Math.max(1, trackHeight - thumbHeight)
      const dy = ev.clientY - y
      const scrollDelta = (dy / maxThumbTravel) * contentScrollable
      canvasEditorRef.current.setScroll(null, Math.round(scrollY + scrollDelta))
    }
    const handleUp = () => {
      isDraggingVRef.current = false
      dragStartRef.current = null
      if (moveListenerRef.current) window.removeEventListener('pointermove', moveListenerRef.current)
      if (upListenerRef.current) window.removeEventListener('pointerup', upListenerRef.current)
      moveListenerRef.current = null
      upListenerRef.current = null
    }

    moveListenerRef.current = handleMove
    upListenerRef.current = handleUp
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }

  const startHorizontalDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    isDraggingHRef.current = true
    dragStartRef.current = { x: e.clientX, y: e.clientY, scrollX: scrollMetrics.scrollX,
      scrollY: scrollMetrics.scrollY }

    const handleMove = (ev: PointerEvent) => {
      if (!dragStartRef.current || !canvasEditorRef.current) return
      const { x, scrollX } = dragStartRef.current
      const trackWidth = Math.max(1, scrollMetrics.viewportWidth)
      const contentScrollable = Math.max(1, scrollMetrics.contentWidth - scrollMetrics.viewportWidth)
      const thumbWidth = Math.max(20,
        (scrollMetrics.viewportWidth / Math.max(1, scrollMetrics.contentWidth)) * trackWidth)
      const maxThumbTravel = Math.max(1, trackWidth - thumbWidth)
      const dx = ev.clientX - x
      const scrollDelta = (dx / maxThumbTravel) * contentScrollable
      canvasEditorRef.current.setScroll(Math.round(scrollX + scrollDelta), null)
    }
    const handleUp = () => {
      isDraggingHRef.current = false
      dragStartRef.current = null
      if (moveListenerRef.current) window.removeEventListener('pointermove', moveListenerRef.current)
      if (upListenerRef.current) window.removeEventListener('pointerup', upListenerRef.current)
      moveListenerRef.current = null
      upListenerRef.current = null
    }

    moveListenerRef.current = handleMove
    upListenerRef.current = handleUp
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }

  useEffect(() => {
    return () => {
      if (moveListenerRef.current) window.removeEventListener('pointermove', moveListenerRef.current)
      if (upListenerRef.current) window.removeEventListener('pointerup', upListenerRef.current)
    }
  }, [])

  const showVBar = scrollMetrics.contentHeight > scrollMetrics.viewportHeight + 1
  const showHBar = scrollMetrics.contentWidth > scrollMetrics.viewportWidth + 1

  // Thumb sizes and positions
  const vTrack = scrollMetrics.viewportHeight
  const vThumbHeight = showVBar
    ? Math.max(20, (scrollMetrics.viewportHeight / scrollMetrics.contentHeight) * vTrack)
    : 0
  const vMaxTravel = Math.max(1, vTrack - vThumbHeight)
  const vThumbTop = showVBar
    ? (scrollMetrics.scrollY / Math.max(1, scrollMetrics.contentHeight - scrollMetrics.viewportHeight)) * vMaxTravel
    : 0

  const hTrack = scrollMetrics.viewportWidth
  const hThumbWidth = showHBar
    ? Math.max(20, (scrollMetrics.viewportWidth / scrollMetrics.contentWidth) * hTrack)
    : 0
  const hMaxTravel = Math.max(1, hTrack - hThumbWidth)
  const hThumbLeft = showHBar
    ? (scrollMetrics.scrollX / Math.max(1, scrollMetrics.contentWidth - scrollMetrics.viewportWidth)) * hMaxTravel
    : 0

  return (
    <div ref={containerRef} className="bg-neutral-800 text-white relative flex-1 min-w-0 min-h-0 h-full"
      onMouseDown={() => setActiveEditor(editorIdRef.current)}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 outline-none"
      />
      <textarea
        ref={textareaRef}
        className="absolute inset-0 opacity-0 z-50 pointer-events-none"
        spellCheck={false}
        autoCorrect="off"
        tabIndex={0}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
        onKeyDown={(e) => {
          setActiveEditor(editorIdRef.current)
          if (wordWrap && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault()
            const dir = e.key === 'ArrowUp' ? 'up' : 'down'
            const caret = inputStateRef.current.caret
            console.log('Vertical movement - before:', { direction: dir, caret })
            const next = canvasEditorRef.current?.getCaretForVerticalMove(dir, caret.line, caret.columnIntent)
            console.log('Vertical movement - result:', next)
            if (next && (next.line !== caret.line || next.column !== caret.column)) {
              const newState: InputState = {
                ...inputStateRef.current,
                caret: { line: next.line, column: next.column, columnIntent: caret.columnIntent },
                selection: e.shiftKey
                  ? (inputStateRef.current.selection
                    ? { start: inputStateRef.current.selection.start, end: { line: next.line, column: next.column } }
                    : { start: { line: caret.line, column: caret.column },
                      end: { line: next.line, column: next.column } })
                  : null,
              }
              console.log('Vertical movement - new state:', newState.caret)
              setInputState(newState)
            }
            else {
              // If wrapped movement didn' work, fall back to normal arrow key handling
              handleKeyDown(e)
            }
          }
          else if (wordWrap && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            e.preventDefault()
            const dir = e.key === 'ArrowLeft' ? 'left' : 'right'
            const caret = inputStateRef.current.caret
            console.log('Horizontal movement - before:', { direction: dir, caret })
            const next = canvasEditorRef.current?.getCaretForHorizontalMove(dir, caret.line, caret.column)
            console.log('Horizontal movement - result:', next)
            if (next) {
              const newState: InputState = {
                ...inputStateRef.current,
                caret: { line: next.line, column: next.column, columnIntent: next.columnIntent },
                selection: e.shiftKey
                  ? (inputStateRef.current.selection
                    ? { start: inputStateRef.current.selection.start, end: { line: next.line, column: next.column } }
                    : { start: { line: caret.line, column: caret.column },
                      end: { line: next.line, column: next.column } })
                  : null,
              }
              console.log('Horizontal movement - new state:', newState.caret)
              setInputState(newState)
            }
            else {
              // If wrapped movement didn't work, fall back to normal arrow key handling
              handleKeyDown(e)
            }
          }
          else {
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

      {/* Scrollbars */}
      {showVBar && (
        <div className="absolute right-0 top-0 h-full w-2.5 bg-transparent z-40" onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('[data-thumb]')) return
          // Jump to position when clicking track
          const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
          const clickY = e.clientY - rect.top
          const targetThumbTop = Math.max(0, Math.min(clickY - vThumbHeight / 2, vMaxTravel))
          const scrollY = (targetThumbTop / vMaxTravel)
            * Math.max(1, scrollMetrics.contentHeight - scrollMetrics.viewportHeight)
          canvasEditorRef.current?.setScroll(null, Math.round(scrollY))
        }}>
          <div
            className="absolute right-0 w-2.5 rounded bg-neutral-600 hover:bg-neutral-500 active:bg-neutral-400 cursor-pointer opacity-50"
            style={{ height: vThumbHeight, top: vThumbTop }}
            data-thumb
            onPointerDown={startVerticalDrag}
          />
        </div>
      )}

      {showHBar && (
        <div className="absolute left-0 bottom-0 w-full h-2.5 bg-transparent z-40" onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('[data-thumb]')) return
          const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
          const clickX = e.clientX - rect.left
          const targetThumbLeft = Math.max(0, Math.min(clickX - hThumbWidth / 2, hMaxTravel))
          const scrollX = (targetThumbLeft / hMaxTravel)
            * Math.max(1, scrollMetrics.contentWidth - scrollMetrics.viewportWidth)
          canvasEditorRef.current?.setScroll(Math.round(scrollX), null)
        }}>
          <div
            className="absolute bottom-0 h-2.5 rounded bg-neutral-600 hover:bg-neutral-500 active:bg-neutral-400 cursor-pointer opacity-50"
            style={{ width: hThumbWidth, left: hThumbLeft }}
            data-thumb
            onPointerDown={startHorizontalDrag}
          />
        </div>
      )}

      {/* Function signature popup */}
      {isActive && functionCallInfo && functionDefinitions[functionCallInfo.functionName] && (
        <FunctionSignaturePopup
          signature={functionDefinitions[functionCallInfo.functionName]}
          currentArgumentIndex={functionCallInfo.currentArgumentIndex}
          position={popupPosition}
          visible={true}
        />
      )}
    </div>
  )
}
