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

export const CodeEditor = () => {
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
    }

    canvasEditorRef.current = new CanvasEditor(canvas, container, inputState, callbacks)

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
      mouseHandlerRef.current?.handlePointerDown(event, inputStateRef.current)
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
          handleKeyDown(e)
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
