export interface FunctionParameter {
  name: string
  type?: string
  optional?: boolean
  description?: string
}

export interface FunctionSignature {
  name: string
  parameters: FunctionParameter[]
  returnType?: string
  description?: string
}

export interface FunctionCallInfo {
  functionName: string
  currentArgumentIndex: number
  currentParameterName?: string
  openParenPosition: { line: number; column: number }
}

// Sample function definitions for demonstration
export const functionDefinitions: Record<string, FunctionSignature> = {
  'console.log': {
    name: 'console.log',
    parameters: [
      { name: 'message', type: 'any', description: 'The message to log to the console' },
      {
        name: '...optionalParams',
        type: 'any[]',
        optional: true,
        description: 'Additional parameters to log',
      },
    ],
    returnType: 'void',
    description: 'Outputs a message to the web console',
  },
  'Math.max': {
    name: 'Math.max',
    parameters: [
      {
        name: '...values',
        type: 'number[]',
        description:
          'Zero or more numbers among which the largest value will be selected and returned',
      },
    ],
    returnType: 'number',
    description: 'Returns the largest of zero or more numbers',
  },
  setTimeout: {
    name: 'setTimeout',
    parameters: [
      {
        name: 'callback',
        type: 'Function',
        description: 'A function to be executed after the timer expires',
      },
      {
        name: 'delay',
        type: 'number',
        optional: true,
        description: 'The time, in milliseconds, to wait before executing the function',
      },
      {
        name: '...args',
        type: 'any[]',
        optional: true,
        description: 'Additional arguments to pass to the callback function',
      },
    ],
    returnType: 'number',
    description:
      'Sets a timer which executes a function or specified piece of code once the timer expires',
  },
  'Array.from': {
    name: 'Array.from',
    parameters: [
      {
        name: 'arrayLike',
        type: 'ArrayLike<T> | Iterable<T>',
        description: 'An array-like or iterable object to convert to an array',
      },
      {
        name: 'mapFn',
        type: '(value: T, index: number) => U',
        optional: true,
        description: 'Map function to call on every element of the array',
      },
      {
        name: 'thisArg',
        type: 'any',
        optional: true,
        description: 'Value to use as this when executing mapFn',
      },
    ],
    returnType: 'U[]',
    description:
      'Creates a new, shallow-copied Array instance from an array-like or iterable object',
  },
  fibonacci: {
    name: 'fibonacci',
    parameters: [
      { name: 'n', type: 'number', description: 'The position in the Fibonacci sequence' },
    ],
    returnType: 'number',
    description: 'Calculates the nth Fibonacci number',
  },
  sin: {
    name: 'sin',
    parameters: [{ name: 'hz', type: 'number', description: 'Frequency in Hz' }],
    returnType: 'number',
    description: 'Sine wave oscillator',
  },
  slp: {
    name: 'slp',
    parameters: [
      { name: 'in', type: 'number', description: 'Input signal' },
      { name: 'cut', type: 'number', description: 'Cutoff frequency' },
      { name: 'q', type: 'number', description: 'Resonance/Q factor' },
    ],
    returnType: 'number',
    description: 'Low-pass filter',
  },
  tri: {
    name: 'tri',
    parameters: [{ name: 'hz', type: 'number', description: 'Frequency in Hz' }],
    returnType: 'number',
    description: 'Triangle wave oscillator',
  },
  out: {
    name: 'out',
    parameters: [
      { name: 'L', type: 'number', description: 'Left channel output' },
      { name: 'R', type: 'number', description: 'Right channel output' },
    ],
    returnType: 'void',
    description: 'Audio output',
  },
}

/**
 * Finds the current function call context at the given cursor position
 */
export const findFunctionCallContext = (
  lines: string[],
  cursorLine: number,
  cursorColumn: number,
): FunctionCallInfo | null => {
  // Convert cursor position to global position for easier searching
  const clampedCursorLine = Math.max(0, Math.min(cursorLine, lines.length))
  let cursorGlobalPos = 0
  for (let i = 0; i < clampedCursorLine; i++) {
    const line = lines[i] ?? ''
    cursorGlobalPos += line.length + 1 // +1 for newline
  }
  cursorGlobalPos += cursorColumn

  // Join all lines to work with a single string
  const code = lines.join('\n')

  // Check if cursor is on a function name followed by opening parenthesis
  const beforeCursor = code.substring(0, cursorGlobalPos)
  const afterCursor = code.substring(cursorGlobalPos)

  // Find word boundaries around cursor
  const beforeMatch = beforeCursor.match(/([a-zA-Z_$][a-zA-Z0-9_$.]*)$/)
  const afterMatch = afterCursor.match(/^([a-zA-Z0-9_$.]*)/)

  if (beforeMatch || afterMatch) {
    const wordStart = beforeMatch ? cursorGlobalPos - beforeMatch[1].length : cursorGlobalPos
    const wordEnd = afterMatch ? cursorGlobalPos + afterMatch[1].length : cursorGlobalPos
    const currentWord = code.substring(wordStart, wordEnd)

    // Check if there's an opening parenthesis right after this word (with optional whitespace)
    const afterWord = code.substring(wordEnd).match(/^\s*\(/)
    if (afterWord) {
      const openParenPos = wordEnd + afterWord[0].length - 1

      // Convert global position back to line/column
      let remainingPos = openParenPos
      let openLine = 0
      let openColumn = 0

      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const lineLength = lines[lineIndex].length
        if (remainingPos <= lineLength) {
          openLine = lineIndex
          openColumn = remainingPos
          break
        }
        remainingPos -= lineLength + 1
      }

      return {
        functionName: currentWord,
        currentArgumentIndex: 0,
        currentParameterName: undefined,
        openParenPosition: { line: openLine, column: openColumn },
      }
    }
  }

  // Find all parentheses and their positions
  const parens: { char: string; position: number; line: number; column: number }[] = []

  for (let i = 0; i < code.length; i++) {
    const char = code[i]
    if (char === '(' || char === ')') {
      // Convert global position back to line/column
      let remainingPos = i
      let line = 0
      let column = 0

      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const lineLength = lines[lineIndex].length
        if (remainingPos <= lineLength) {
          line = lineIndex
          column = remainingPos
          break
        }
        remainingPos -= lineLength + 1 // +1 for newline
      }

      parens.push({ char, position: i, line, column })
    }
  }

  // Find the innermost function call that contains the cursor
  let bestMatch: {
    openPos: number
    openLine: number
    openColumn: number
    functionName: string
  } | null = null
  let smallestRange = Infinity

  // Find matched parentheses pairs
  const stack: { position: number; line: number; column: number }[] = []

  for (const paren of parens) {
    if (paren.char === '(') {
      stack.push({ position: paren.position, line: paren.line, column: paren.column })
    } else if (paren.char === ')') {
      if (stack.length > 0) {
        const openParen = stack.pop()!

        // Check if cursor is inside this parentheses pair
        if (cursorGlobalPos > openParen.position && cursorGlobalPos <= paren.position) {
          const range = paren.position - openParen.position

          // Find the function name before the opening parenthesis
          const beforeParen = code.substring(0, openParen.position).trim()
          // Look for function name that might be preceded by operators like |> or other characters
          const functionNameMatch = beforeParen.match(/([a-zA-Z_$][a-zA-Z0-9_$.]*)\s*$/)

          if (functionNameMatch && range < smallestRange) {
            const functionName = functionNameMatch[1]
            smallestRange = range
            bestMatch = {
              openPos: openParen.position,
              openLine: openParen.line,
              openColumn: openParen.column,
              functionName,
            }
          }
        }
      }
    }
  }

  // Check for unmatched opening parentheses (cursor might be in an incomplete function call)
  for (const openParen of stack) {
    if (cursorGlobalPos > openParen.position) {
      const range = cursorGlobalPos - openParen.position

      // Find the function name before the opening parenthesis
      const beforeParen = code.substring(0, openParen.position).trim()
      // Look for function name that might be preceded by operators like |> or other characters
      const functionNameMatch = beforeParen.match(/([a-zA-Z_$][a-zA-Z0-9_$.]*)\s*$/)

      if (functionNameMatch && range < smallestRange) {
        const functionName = functionNameMatch[1]
        smallestRange = range
        bestMatch = {
          openPos: openParen.position,
          openLine: openParen.line,
          openColumn: openParen.column,
          functionName,
        }
      }
    }
  }

  if (!bestMatch) return null

  // Calculate current argument index by counting commas between open paren and cursor
  const textBetween = code.substring(bestMatch.openPos + 1, cursorGlobalPos)
  let commaCount = 0
  let parenDepth = 0
  let bracketDepth = 0
  let braceDepth = 0
  let inString = false
  let stringChar = ''
  let currentParameterName: string | undefined

  for (let i = 0; i < textBetween.length; i++) {
    const char = textBetween[i]

    // Handle strings
    if (!inString && (char === '"' || char === "'" || char === '`')) {
      inString = true
      stringChar = char
      continue
    }
    if (inString && char === stringChar && textBetween[i - 1] !== '\\') {
      inString = false
      continue
    }
    if (inString) continue

    // Handle nested structures
    if (char === '(') parenDepth++
    else if (char === ')') parenDepth--
    else if (char === '[') bracketDepth++
    else if (char === ']') bracketDepth--
    else if (char === '{') braceDepth++
    else if (char === '}') braceDepth--
    else if (char === ',' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
      commaCount++
    }
  }

  // Try to extract the current parameter name if we're in a named parameter
  const fullTextBetween = code.substring(bestMatch.openPos + 1, cursorGlobalPos)

  // Find the start of the current argument by looking for the last comma at the top level
  let lastCommaIndex = -1
  let depth = 0
  let inString2 = false
  let stringChar2 = ''

  for (let i = 0; i < fullTextBetween.length; i++) {
    const char = fullTextBetween[i]

    // Handle strings
    if (!inString2 && (char === '"' || char === "'" || char === '`')) {
      inString2 = true
      stringChar2 = char
      continue
    }
    if (inString2 && char === stringChar2 && fullTextBetween[i - 1] !== '\\') {
      inString2 = false
      continue
    }
    if (inString2) continue

    // Handle nested structures
    if (char === '(') depth++
    else if (char === ')') depth--
    else if (char === '[') depth++
    else if (char === ']') depth--
    else if (char === '{') depth++
    else if (char === '}') depth--
    else if (char === ',' && depth === 0) {
      lastCommaIndex = i
    }
  }

  const currentArgText =
    lastCommaIndex >= 0
      ? fullTextBetween.substring(lastCommaIndex + 1).trim()
      : fullTextBetween.trim()

  // Check if current argument is a named parameter (name:value format)
  const namedParamMatch = currentArgText.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/)
  if (namedParamMatch) {
    currentParameterName = namedParamMatch[1]
  }

  return {
    functionName: bestMatch.functionName,
    currentArgumentIndex: commaCount,
    currentParameterName,
    openParenPosition: { line: bestMatch.openLine, column: bestMatch.openColumn },
  }
}

/**
 * Calculates the base screen position for the popup at the caret position
 * The popup will then measure itself and adjust its position dynamically
 */
export const calculatePopupPosition = (
  openParenPosition: { line: number; column: number },
  padding: number,
  lineHeight: number,
  ctx: CanvasRenderingContext2D,
  lines: string[],
  canvasRect: DOMRect,
  scrollX: number = 0,
  scrollY: number = 0,
  caretPosition?: { line: number; column: number },
  preCalculatedContentY?: number,
  preCalculatedCaretContentY?: number,
  preCalculatedContentX?: number,
  preCalculatedCaretContentX?: number,
): { x: number; y: number } => {
  // Always position at caret if available, otherwise at opening paren
  const targetPosition = caretPosition ?? openParenPosition
  const targetLine = lines[targetPosition.line] || ''
  const textBeforeTarget = targetLine.substring(0, targetPosition.column)

  // Content-space coordinates - use caret position if available
  const contentX =
    preCalculatedCaretContentX ??
    preCalculatedContentX ??
    padding + ctx.measureText(textBeforeTarget).width
  const contentLineY =
    preCalculatedCaretContentY ??
    preCalculatedContentY ??
    padding + targetPosition.line * lineHeight

  // Convert to canvas-relative viewport coordinates
  const canvasX = contentX - scrollX
  const canvasY = contentLineY - scrollY

  // Convert to page coordinates
  const x = canvasRect.left + canvasX
  const y = canvasRect.top + canvasY // Position at line top, let popup decide above/below

  return { x, y }
}
