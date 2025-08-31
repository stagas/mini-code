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
  let cursorGlobalPos = 0
  for (let i = 0; i < cursorLine; i++) {
    cursorGlobalPos += lines[i].length + 1 // +1 for newline
  }
  cursorGlobalPos += cursorColumn

  // Join all lines to work with a single string
  const code = lines.join('\n')

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

  return {
    functionName: bestMatch.functionName,
    currentArgumentIndex: commaCount,
    openParenPosition: { line: bestMatch.openLine, column: bestMatch.openColumn },
  }
}

/**
 * Calculates the screen position for the popup relative to the canvas
 */
export const calculatePopupPosition = (
  openParenPosition: { line: number; column: number },
  padding: number,
  lineHeight: number,
  ctx: CanvasRenderingContext2D,
  lines: string[],
): { x: number; y: number } => {
  const line = lines[openParenPosition.line] || ''
  const textBeforeParen = line.substring(0, openParenPosition.column)

  const x = padding + ctx.measureText(textBeforeParen).width
  const y = padding + openParenPosition.line * lineHeight - 5

  return { x, y }
}
