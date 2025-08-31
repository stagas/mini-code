import { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { History } from './history'
import { getSelectedText, InputHandler, type InputState, type Selection } from './input'
import { MouseHandler } from './mouse'
import { getTokenColor, highlightCode, type HighlightedLine } from './syntax'

const drawSelection = (
  ctx: CanvasRenderingContext2D,
  inputState: InputState,
  padding: number,
  lineHeight: number,
) => {
  if (!inputState.selection) return

  const { start, end } = inputState.selection

  // Normalize selection (ensure start comes before end)
  const normalizedStart = start.line < end.line || (start.line === end.line && start.column <= end.column)
    ? start
    : end
  const normalizedEnd = start.line < end.line || (start.line === end.line && start.column <= end.column)
    ? end
    : start

  ctx.fillStyle = 'rgba(255, 255, 255, 0.2)' // Semi-transparent white selection

  const selectionPadding = 4 // Padding on the right for each selected line

  if (normalizedStart.line === normalizedEnd.line) {
    // Single line selection
    const line = inputState.lines[normalizedStart.line] || ''
    const startText = line.substring(0, normalizedStart.column)
    const selectedText = line.substring(normalizedStart.column, normalizedEnd.column)

    const startX = padding + ctx.measureText(startText).width
    const selectedWidth = ctx.measureText(selectedText).width + selectionPadding
    const y = padding + normalizedStart.line * lineHeight - 3

    ctx.fillRect(startX, y, selectedWidth, lineHeight - 2)
  }
  else {
    // Multi-line selection
    for (let lineIndex = normalizedStart.line; lineIndex <= normalizedEnd.line; lineIndex++) {
      const line = inputState.lines[lineIndex] || ''
      const y = padding + lineIndex * lineHeight - 3

      if (lineIndex === normalizedStart.line) {
        // First line: from start column to end of line
        const startText = line.substring(0, normalizedStart.column)
        const selectedText = line.substring(normalizedStart.column)
        const startX = padding + ctx.measureText(startText).width
        const selectedWidth = ctx.measureText(selectedText).width + selectionPadding
        ctx.fillRect(startX, y, selectedWidth, lineHeight - 2)
      }
      else if (lineIndex === normalizedEnd.line) {
        // Last line: from start of line to end column
        const selectedText = line.substring(0, normalizedEnd.column)
        const selectedWidth = ctx.measureText(selectedText).width + selectionPadding
        ctx.fillRect(padding, y, selectedWidth, lineHeight - 2)
      }
      else {
        // Middle lines: entire line
        const selectedWidth = ctx.measureText(line).width + selectionPadding
        ctx.fillRect(padding, y, selectedWidth, lineHeight - 2)
      }
    }
  }
}

const drawHighlightedLine = (
  ctx: CanvasRenderingContext2D,
  highlightedLine: HighlightedLine,
  x: number,
  y: number,
) => {
  let currentX = x

  for (const token of highlightedLine.tokens) {
    ctx.fillStyle = getTokenColor(token.type)
    ctx.fillText(token.content, currentX, y)
    currentX += ctx.measureText(token.content).width
  }
}

const CodeEditor = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [inputState, setInputState] = useState<InputState>({
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
    ],
  })

  // Highlight code on every render to ensure real-time updates
  const highlightedCode = highlightCode(inputState.lines.join('\n'), 'javascript')

  const inputHandlerRef = useRef<InputHandler | null>(null)
  const historyRef = useRef<History | null>(null)
  const mouseHandlerRef = useRef<MouseHandler | null>(null)
  const inputStateRef = useRef<InputState>(inputState)

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

    // Ensure textarea always has focus
    textarea.focus()
  }, [inputState])

  // Keep ref in sync with current state
  useEffect(() => {
    inputStateRef.current = inputState
  }, [inputState])

  // Ensure textarea always has focus
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    textarea.focus()

    // Focus textarea when window gains focus
    const handleWindowFocus = () => {
      textarea.focus()
    }

    window.addEventListener('focus', handleWindowFocus)

    return () => {
      window.removeEventListener('focus', handleWindowFocus)
    }
  }, [])

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
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const drawCode = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()

      // Set display size
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`

      // Set actual size in memory (scaled for DPR)
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr

      // Scale the drawing context so everything draws at the correct size
      ctx.scale(dpr, dpr)

      // Configure text rendering
      ctx.font = '14px "JetBrains Mono", "Fira Code", "Consolas", monospace'
      ctx.fillStyle = '#e5e7eb' // Light gray text
      ctx.textBaseline = 'top'

      // Clear canvas
      ctx.fillStyle = '#1f2937' // Dark background
      ctx.fillRect(0, 0, rect.width, rect.height)

      // Draw each line of code
      const lineHeight = 20
      const padding = 16

      // Draw selection background if exists
      if (inputState.selection) {
        drawSelection(ctx, inputState, padding, lineHeight)
      }

      // Draw highlighted code
      highlightedCode.forEach((highlightedLine: HighlightedLine, index: number) => {
        const y = padding + index * lineHeight
        drawHighlightedLine(ctx, highlightedLine, padding, y)
      })

      // Draw caret
      const caretY = padding + inputState.caret.line * lineHeight - 3
      const caretLine = inputState.lines[inputState.caret.line] || ''
      const caretText = caretLine.substring(0, inputState.caret.column)
      const caretX = padding + ctx.measureText(caretText).width

      ctx.fillStyle = '#ffffff'
      ctx.fillRect(caretX, caretY, 2, lineHeight - 2)
    }

    // Initial draw
    drawCode()

    // Handle window resize
    const handleResize = () => drawCode()
    window.addEventListener('resize', handleResize)

    return () => window.removeEventListener('resize', handleResize)
  }, [inputState, highlightedCode])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const handlePointerDown = (event: PointerEvent) => {
      event.preventDefault()
      mouseHandlerRef.current?.handlePointerDown(event, inputStateRef.current)
      // Textarea always has focus, no need to manually focus
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
  }, [inputState])

  return (
    <div className="bg-neutral-800 text-white w-full h-full relative">
      <canvas
        ref={canvasRef}
        className="w-full h-full outline-none"
        tabIndex={0}
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
        onKeyDown={handleKeyDown}
        onCopy={handleCopy}
        onPaste={handlePaste}
        onCut={handleCut}
        onBlur={() => {
          // Immediately refocus the textarea
          setTimeout(() => {
            textareaRef.current?.focus()
          }, 0)
        }}
        onFocus={() => {}}
      />
    </div>
  )
}

const App = () => {
  return <CodeEditor />
}

createRoot(document.getElementById('root')!).render(<App />)
