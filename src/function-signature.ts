export interface FunctionParameter {
  name: string
  type?: string
  optional?: boolean
  description?: string
  defaultValue?: any
  min?: number
  max?: number
  step?: number
  slope?: 'linear' | 'exp2' | 'exp10' | 'log2' | 'log10'
}

export interface FunctionSignature {
  name: string
  parameters: FunctionParameter[]
  returnType?: string
  description?: string
  deprecated?: boolean
  examples?: string[]
  type?: 'function' | 'variable'
  category?: string
}

export interface FunctionCallInfo {
  functionName: string
  currentArgumentIndex: number
  currentParameterName?: string
  openParenPosition: { line: number; column: number }
}

export interface VariableHoverInfo {
  variableName: string
  position: { line: number; column: number }
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
        description: 'Zero or more numbers among which the largest value will be selected and returned',
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
    description: 'Sets a timer which executes a function or specified piece of code once the timer expires',
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
    description: 'Creates a new, shallow-copied Array instance from an array-like or iterable object',
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
  adsr: {
    name: 'adsr',
    parameters: [
      { name: 'attack', type: 'number', description: 'Attack time' },
      { name: 'decay', type: 'number', description: 'Decay time' },
      { name: 'sustain', type: 'number', description: 'Sustain level' },
      { name: 'release', type: 'number', description: 'Release time' },
      { name: 'exponent', type: 'number', description: 'Curve exponent' },
      { name: 'trig', type: 'number', description: 'Trigger signal' },
    ],
    returnType: 'number',
    description: 'ADSR envelope generator',
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
  '.walk': {
    name: '.walk',
    parameters: [
      { name: 'rate', type: 'number', description: 'Rate at which to walk through the sequence' },
    ],
    returnType: 'any',
    description: 'Walks through a sequence at the specified rate',
  },
  freesoundslicer: {
    name: 'freesoundslicer',
    parameters: [
      { name: 'id', type: 'number', description: 'Sound ID' },
      { name: 'trig', type: 'number', description: 'Trigger' },
      { name: 'speed', type: 'number', description: 'Speed' },
      { name: 'offset', type: 'number', description: 'Offset' },
      { name: 'threshold', type: 'number', description: 'Threshold' },
    ],
    returnType: 'number',
    description: 'Free sound slicer',
  },
  seq: {
    name: 'seq',
    parameters: [
      { name: 'seq', type: 'string', description: 'Sequence pattern' },
      { name: 'swing', type: 'number', description: 'Swing amount' },
      { name: 'offset', type: 'number', description: 'Offset' },
      { name: 'cb', type: 'function', description: 'Callback function' },
    ],
    returnType: 'any',
    description: 'Sequence function',
  },
  // Variables
  PI: {
    name: 'PI',
    parameters: [],
    returnType: 'number',
    description: 'The mathematical constant π (pi), approximately 3.14159',
    type: 'variable',
  },
  TWO_PI: {
    name: 'TWO_PI',
    parameters: [],
    returnType: 'number',
    description: 'Two times π (pi), approximately 6.28318',
    type: 'variable',
  },
  HALF_PI: {
    name: 'HALF_PI',
    parameters: [],
    returnType: 'number',
    description: 'Half of π (pi), approximately 1.57079',
    type: 'variable',
  },
  E: {
    name: 'E',
    parameters: [],
    returnType: 'number',
    description: 'Euler\'s number, the base of natural logarithms, approximately 2.71828',
    type: 'variable',
  },
  LN2: {
    name: 'LN2',
    parameters: [],
    returnType: 'number',
    description: 'Natural logarithm of 2, approximately 0.693147',
    type: 'variable',
  },
  LN10: {
    name: 'LN10',
    parameters: [],
    returnType: 'number',
    description: 'Natural logarithm of 10, approximately 2.302585',
    type: 'variable',
  },
  LOG2E: {
    name: 'LOG2E',
    parameters: [],
    returnType: 'number',
    description: 'Base-2 logarithm of E, approximately 1.442695',
    type: 'variable',
  },
  LOG10E: {
    name: 'LOG10E',
    parameters: [],
    returnType: 'number',
    description: 'Base-10 logarithm of E, approximately 0.434294',
    type: 'variable',
  },
  SQRT1_2: {
    name: 'SQRT1_2',
    parameters: [],
    returnType: 'number',
    description: 'Square root of 1/2, approximately 0.707106',
    type: 'variable',
  },
  SQRT2: {
    name: 'SQRT2',
    parameters: [],
    returnType: 'number',
    description: 'Square root of 2, approximately 1.414213',
    type: 'variable',
  },
  // Special variables with # prefix
  '#scale': {
    name: '#scale',
    parameters: [],
    returnType: 'number',
    description: 'Current scale factor',
    type: 'variable',
  },
  '#tempo': {
    name: '#tempo',
    parameters: [],
    returnType: 'number',
    description: 'Current tempo in BPM',
    type: 'variable',
  },
  '#time': {
    name: '#time',
    parameters: [],
    returnType: 'number',
    description: 'Current time in seconds',
    type: 'variable',
  },
  '.rate': {
    name: '.rate',
    parameters: [],
    returnType: 'number',
    description: 'Playback rate multiplier',
    type: 'variable',
  },
  '.offset': {
    name: '.offset',
    parameters: [],
    returnType: 'number',
    description: 'Time offset in seconds',
    type: 'variable',
  },
  '.volume': {
    name: '.volume',
    parameters: [],
    returnType: 'number',
    description: 'Volume level (0.0 to 1.0)',
    type: 'variable',
  },
  '.step': {
    name: '.step',
    parameters: [
      { name: 'rate', type: 'number', description: 'Step rate' },
    ],
    returnType: 'any',
    description: 'Steps through values at the specified rate',
  },
}

/**
 * Finds the current function call context at the given cursor position
 */
export const findFunctionCallContext = (
  lines: string[],
  cursorLine: number,
  cursorColumn: number,
  functionDefinitions: Record<string, FunctionSignature> = {},
): FunctionCallInfo | null => {
  const code = lines.join('\n')

  const lineStarts: number[] = new Array(lines.length)
  {
    let pos = 0
    for (let i = 0; i < lines.length; i++) {
      lineStarts[i] = pos
      pos += (lines[i]?.length ?? 0) + 1
    }
  }

  const findLine = (pos: number): number => {
    let low = 0
    let high = lineStarts.length - 1
    while (low <= high) {
      const mid = (low + high) >> 1
      const start = lineStarts[mid] ?? 0
      const nextStart = (mid + 1 < lineStarts.length) ? (lineStarts[mid + 1] ?? code.length) : code.length + 1
      if (pos < start) high = mid - 1
      else if (pos >= nextStart) low = mid + 1
      else return mid
    }
    return Math.max(0, Math.min(lineStarts.length - 1, low))
  }

  const toLineColumn = (pos: number): { line: number; column: number } => {
    const line = findLine(pos)
    return { line, column: pos - (lineStarts[line] ?? 0) }
  }

  const clampedCursorLine = Math.max(0, Math.min(cursorLine, Math.max(0, lines.length - 1)))
  const clampedCursorColumn = Math.max(0, Math.min(cursorColumn, lines[clampedCursorLine]?.length ?? 0))
  const cursorGlobalPos = Math.max(0, Math.min(
    (lineStarts[clampedCursorLine] ?? 0) + clampedCursorColumn,
    code.length,
  ))
  // If the caret is immediately after a closing paren, treat it as "on" the paren
  // so we can still resolve the surrounding call context.
  const cursorPos = (cursorGlobalPos > 0 && code[cursorGlobalPos - 1] === ')')
    ? cursorGlobalPos - 1
    : cursorGlobalPos

  // Check if cursor is on a function name followed by opening parenthesis
  const beforeCursor = code.substring(0, cursorPos)
  const afterCursor = code.substring(cursorPos)

  const isIdent = (c: string): boolean => /[a-zA-Z0-9_$#]/.test(c)
  const isIdentStart = (c: string): boolean => /[a-zA-Z_$#]/.test(c)
  const isValidName = (s: string): boolean =>
    /^(\.[a-zA-Z_$#][a-zA-Z0-9_$#]*|[a-zA-Z_$#][a-zA-Z0-9_$#]*)(\.[a-zA-Z_$#][a-zA-Z0-9_$#]*)*$/.test(s)

  // Robust word boundary scan around the cursor (handles cases where regex misses)
  {
    let start = cursorPos
    while (start > 0) {
      const c = code[start - 1]!
      if (isIdent(c) || c === '.') start--
      else break
    }
    let end = cursorPos
    while (end < code.length) {
      const c = code[end]!
      if (isIdent(c) || c === '.') end++
      else break
    }
    if (start < end) {
      const word = code.substring(start, end)
      // Don't treat '.' by itself or malformed dotted chains as a function name.
      if (word.length > 0 && isValidName(word)) {
        const afterWord = code.substring(end).match(/^\s*\(/)
        if (afterWord) {
          const openParenPos = end + afterWord[0].length - 1
          const lc = toLineColumn(openParenPos)
          return {
            functionName: word,
            currentArgumentIndex: 0,
            currentParameterName: undefined,
            openParenPosition: lc,
          }
        }
      }
    }
  }

  // Find the innermost function call that contains the cursor
  let bestMatch: {
    openPos: number
    openLine: number
    openColumn: number
    functionName: string
  } | null = null
  {
    // Scan only up to the cursor. This is much more stable for "in-progress" code,
    // especially inside callbacks where parentheses may be temporarily unbalanced later.
    const prefix = code.substring(0, cursorPos)
    const openStack: number[] = []
    let inString = false
    let stringChar = ''

    for (let i = 0; i < prefix.length; i++) {
      const char = prefix[i]

      if (!inString && (char === '"' || char === '\'' || char === '`')) {
        inString = true
        stringChar = char
        continue
      }
      if (inString) {
        if (char === stringChar && prefix[i - 1] !== '\\') {
          inString = false
          stringChar = ''
        }
        continue
      }

      if (char === '(') openStack.push(i)
      else if (char === ')') openStack.pop()
    }

    const functionNameRe = /(\.[a-zA-Z_$][a-zA-Z0-9_$]*|[a-zA-Z_$][a-zA-Z0-9_$.]*)\s*$/

    for (let i = openStack.length - 1; i >= 0; i--) {
      const openPos = openStack[i]!
      const beforeParen = code.substring(0, openPos).trimEnd()
      const functionNameMatch = beforeParen.match(functionNameRe)
      if (!functionNameMatch) continue

      const lc = toLineColumn(openPos)
      bestMatch = {
        openPos,
        openLine: lc.line,
        openColumn: lc.column,
        functionName: functionNameMatch[1],
      }
      break
    }
  }

  if (!bestMatch) return null

  // Get function signature to track used parameters
  const signature = functionDefinitions[bestMatch.functionName]

  const findIdentAt = (
    text: string,
    cursorOffset: number,
  ): { ident: string; start: number; end: number } | null => {
    const isIdentChar = (c: string): boolean => /[a-zA-Z0-9_$#]/.test(c)
    const isIdentStart = (c: string): boolean => /[a-zA-Z_$#]/.test(c)

    let i = Math.max(0, Math.min(cursorOffset, text.length))
    if (i === text.length) i = Math.max(0, i - 1)
    if (!isIdentChar(text[i] ?? '') && i > 0 && isIdentChar(text[i - 1] ?? '')) i--

    if (!isIdentChar(text[i] ?? '')) return null

    let start = i
    while (start > 0 && isIdentChar(text[start - 1] ?? '')) start--
    let end = i + 1
    while (end < text.length && isIdentChar(text[end] ?? '')) end++

    if (!isIdentStart(text[start] ?? '')) return null
    const ident = text.substring(start, end)
    return { ident, start, end }
  }

  const resolveParameter = (typedName: string): { index: number; name: string } | null => {
    if (!signature) return null
    const q = typedName.toLowerCase()
    if (!q) return null

    for (let i = 0; i < signature.parameters.length; i++) {
      const param = signature.parameters[i]
      const cleanName = param.name.replace(/^\.\.\./, '')
      const n = cleanName.toLowerCase()
      if (n === q || n.startsWith(q)) return { index: i, name: cleanName }

      const raw = param.name.toLowerCase()
      if (raw === q || raw.startsWith(q)) return { index: i, name: cleanName }
    }

    return null
  }

  // Parse all arguments before cursor to determine which parameters have been used
  const allArgsText = code.substring(bestMatch.openPos + 1, cursorPos)
  const usedParameterNames = new Set<string>()
  const usedPositionalIndices = new Set<number>()
  let positionalIndex = 0

  // Parse arguments before cursor
  let argStart = 0
  let depth = 0
  let inString = false
  let stringChar = ''

  for (let i = 0; i < allArgsText.length; i++) {
    const char = allArgsText[i]

    // Handle strings
    if (!inString && (char === '"' || char === '\'' || char === '`')) {
      inString = true
      stringChar = char
      continue
    }
    if (inString && char === stringChar && allArgsText[i - 1] !== '\\') {
      inString = false
      continue
    }
    if (inString) continue

    // Handle nested structures
    if (char === '(') depth++
    else if (char === ')') depth--
    else if (char === '[') depth++
    else if (char === ']') depth--
    else if (char === '{') depth++
    else if (char === '}') depth--
    else if (char === ',' && depth === 0) {
      // Found end of an argument
      const argText = allArgsText.substring(argStart, i).trim()
      if (argText.length > 0) {
        // Check if it's a named parameter (with colon)
        const namedMatch = argText.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/)
        if (namedMatch) {
          const typedName = namedMatch[1]
          usedParameterNames.add(typedName)

          const resolved = resolveParameter(typedName)
          if (resolved && signature) {
            usedParameterNames.add(resolved.name)
            usedParameterNames.add(signature.parameters[resolved.index]?.name ?? resolved.name)
          }
        }
        else if (signature) {
          // Check if this argument looks like a function (contains -> or =>)
          // Only skip positional tracking if we're certain it's a function (has arrow)
          // This is conservative - if it's ambiguous, track it positionally and let
          // type-based matching override later if needed
          const isFunctionArg = argText.includes('->') || argText.includes('=>')

          if (!isFunctionArg) {
            // Check if it's a short parameter syntax (parameter name without colon)
            // Extract the first word to see if it matches a parameter name
            let isShorthandParam = false
            const wordMatch = argText.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)/)
            if (wordMatch) {
              const word = wordMatch[1]
              // Check if this word exactly matches a parameter name
              for (const param of signature.parameters) {
                const cleanName = param.name.replace(/^\.\.\./, '')
                if (cleanName === word || param.name === word) {
                  // This is a short parameter syntax - mark it as used
                  usedParameterNames.add(cleanName)
                  usedParameterNames.add(param.name)
                  isShorthandParam = true
                  break
                }
              }
            }
            // Track as positional only if it's not a named/shorthand parameter
            if (!isShorthandParam) {
              usedPositionalIndices.add(positionalIndex)
              positionalIndex++
            }
          }
          else {
            // It's a function argument - don't mark as used positionally,
            // but still increment positionalIndex to keep the count correct
            // Type-based matching will handle matching it to the correct parameter
            positionalIndex++
          }
        }
        else {
          // Positional parameter (no signature available)
          usedPositionalIndices.add(positionalIndex)
          positionalIndex++
        }
      }
      argStart = i + 1
    }
  }

  // Calculate current argument index by counting commas between open paren and cursor
  const textBetween = code.substring(bestMatch.openPos + 1, cursorPos)
  let commaCount = 0
  let parenDepth2 = 0
  let bracketDepth2 = 0
  let braceDepth2 = 0
  let inString3 = false
  let stringChar3 = ''
  let currentParameterName: string | undefined

  for (let i = 0; i < textBetween.length; i++) {
    const char = textBetween[i]

    // Handle strings
    if (!inString3 && (char === '"' || char === '\'' || char === '`')) {
      inString3 = true
      stringChar3 = char
      continue
    }
    if (inString3 && char === stringChar3 && textBetween[i - 1] !== '\\') {
      inString3 = false
      continue
    }
    if (inString3) continue

    // Handle nested structures
    if (char === '(') parenDepth2++
    else if (char === ')') parenDepth2--
    else if (char === '[') bracketDepth2++
    else if (char === ']') bracketDepth2--
    else if (char === '{') braceDepth2++
    else if (char === '}') braceDepth2--
    else if (char === ',' && parenDepth2 === 0 && bracketDepth2 === 0 && braceDepth2 === 0) {
      commaCount++
    }
  }

  // Try to extract the current parameter name if we're in a named parameter
  const fullTextBetween = code.substring(bestMatch.openPos + 1, cursorPos)

  // Find the start of the current argument by looking for the last comma at the top level
  let lastCommaIndex = -1
  let depth2 = 0
  let inString2 = false
  let stringChar2 = ''

  for (let i = 0; i < fullTextBetween.length; i++) {
    const char = fullTextBetween[i]

    // Handle strings
    if (!inString2 && (char === '"' || char === '\'' || char === '`')) {
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
    if (char === '(') depth2++
    else if (char === ')') depth2--
    else if (char === '[') depth2++
    else if (char === ']') depth2--
    else if (char === '{') depth2++
    else if (char === '}') depth2--
    else if (char === ',' && depth2 === 0) {
      lastCommaIndex = i
    }
  }

  // Get the full current argument text by looking ahead from cursor to find where argument ends
  const textFromOpenParen = code.substring(bestMatch.openPos + 1)
  const argStartInFullText = lastCommaIndex >= 0 ? lastCommaIndex + 1 : 0
  let argEndInFullText = textFromOpenParen.length
  depth = 0
  inString2 = false
  stringChar2 = ''

  // Find the end of the current argument (next comma or closing paren at top level)
  for (let i = argStartInFullText; i < textFromOpenParen.length; i++) {
    const char = textFromOpenParen[i]

    // Handle strings
    if (!inString2 && (char === '"' || char === '\'' || char === '`')) {
      inString2 = true
      stringChar2 = char
      continue
    }
    if (inString2 && char === stringChar2 && textFromOpenParen[i - 1] !== '\\') {
      inString2 = false
      continue
    }
    if (inString2) continue

    // Handle nested structures
    if (char === '(') depth++
    else if (char === ')') {
      if (depth === 0) {
        argEndInFullText = i
        break
      }
      depth--
    }
    else if (char === '[') depth++
    else if (char === ']') depth--
    else if (char === '{') depth++
    else if (char === '}') depth--
    else if (char === ',' && depth === 0) {
      argEndInFullText = i
      break
    }
  }

  const fullCurrentArgText = textFromOpenParen.substring(argStartInFullText, argEndInFullText).trim()

  const currentArgText = lastCommaIndex >= 0
    ? fullTextBetween.substring(lastCommaIndex + 1).trim()
    : fullTextBetween.trim()

  // Type-based matching: if current argument is a function, match to first function-type parameter
  // Run this FIRST to prioritize type-based matching over parameter name matching
  let matchedFunctionType = false
  if (signature) {
    const trimmedCurrentArg = currentArgText.trim()
    const trimmedFullArg = fullCurrentArgText.trim()

    // Check if argument looks like a function using multiple heuristics
    // Be aggressive - if any indicator suggests it's a function, treat it as one

    // 1. Contains arrow syntax (-> or =>) - strongest indicator
    const hasArrow = trimmedFullArg.includes('->')
      || trimmedCurrentArg.includes('->')
      || trimmedFullArg.includes('=>')
      || trimmedCurrentArg.includes('=>')

    // 2. Starts with '(' (function parameter list) - strong indicator
    const startsWithParen = trimmedFullArg.startsWith('(')

    // 3. Check if we're inside nested structures (parentheses, braces, brackets)
    // This indicates we're inside a function body
    const isInsideNested = parenDepth2 > 0 || bracketDepth2 > 0 || braceDepth2 > 0

    // If it has arrow syntax OR starts with paren (regardless of nesting depth)
    // then treat it as a function
    // This is aggressive but necessary to catch functions even when cursor is at the start
    const isFunctionArg = hasArrow || startsWithParen

    if (isFunctionArg) {
      // Find first parameter with type matching "function" (case-insensitive)
      for (let i = 0; i < signature.parameters.length; i++) {
        const param = signature.parameters[i]
        if (param.type && /function/i.test(param.type)) {
          // Check if this parameter hasn't been used yet
          const paramName = param.name.replace(/^\.\.\./, '')
          if (!usedParameterNames.has(paramName) && !usedParameterNames.has(param.name)) {
            // Override any previous matching - function type takes priority
            commaCount = i
            currentParameterName = undefined
            matchedFunctionType = true
            break
          }
        }
      }
    }
  }

  // Check if current argument is a named parameter (name:value format)
  // Skip this if we already matched by function type
  if (!matchedFunctionType) {
    const argRaw = textFromOpenParen.substring(argStartInFullText, argEndInFullText)
    const leadingWhitespace = argRaw.length - argRaw.trimStart().length
    const argText = argRaw.trimStart()

    const argStartAbs = bestMatch.openPos + 1 + argStartInFullText
    const cursorOffsetInRawArg = cursorPos - argStartAbs
    const cursorOffsetInArg = Math.max(0, Math.min(
      argText.length,
      cursorOffsetInRawArg - leadingWhitespace,
    ))

    const startNamed = argText.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/)
    if (startNamed) {
      const typedName = startNamed[1]
      const resolved = resolveParameter(typedName)
      if (resolved && signature) {
        currentParameterName = resolved.name
        commaCount = resolved.index
      }
      else {
        currentParameterName = typedName
      }
    }
    else {
      const tok = findIdentAt(argText, cursorOffsetInArg)
      const hasColonAfterToken = tok ? /^\s*:/.test(argText.substring(tok.end)) : false
      const isKeyPosition = tok ? tok.start === 0 : false

      if (tok && hasColonAfterToken) {
        const resolved = resolveParameter(tok.ident)
        if (resolved && signature) {
          currentParameterName = resolved.name
          commaCount = resolved.index
        }
        else {
          currentParameterName = tok.ident
        }
      }
      else if (tok && isKeyPosition) {
        const resolved = resolveParameter(tok.ident)
        if (resolved && signature) {
          const param = signature.parameters[resolved.index]
          const exact = resolved.name.toLowerCase() === tok.ident.toLowerCase()
          const isUsed = usedParameterNames.has(resolved.name) || usedParameterNames.has(param?.name ?? '')
          if (exact || !isUsed) {
            currentParameterName = resolved.name
            commaCount = resolved.index
          }
        }
      }
    }
  }

  // Final check: if current argument is empty and comma count points to a parameter that's already used,
  // or if comma count is higher than the first unused parameter, use the first unused one instead
  // This handles the case where a function was matched to a later parameter and we're now on the next argument
  if (signature && !currentParameterName && currentArgText.trim().length === 0) {
    // Find first unused positional parameter
    let firstUnusedIndex = -1
    for (let i = 0; i < signature.parameters.length; i++) {
      if (!usedPositionalIndices.has(i) && !usedParameterNames.has(signature.parameters[i].name)) {
        const paramName = signature.parameters[i].name.replace(/^\.\.\./, '')
        if (!usedParameterNames.has(paramName)) {
          firstUnusedIndex = i
          break
        }
      }
    }
    // If we found an unused parameter and either:
    // 1. The comma count is higher than it (we skipped parameters), OR
    // 2. The comma count points to a used parameter
    // Then use the first unused one instead
    if (firstUnusedIndex >= 0) {
      if (commaCount > firstUnusedIndex
        || (commaCount < signature.parameters.length && usedPositionalIndices.has(commaCount)))
      {
        commaCount = firstUnusedIndex
      }
    }
  }

  return {
    functionName: bestMatch.functionName,
    currentArgumentIndex: commaCount,
    currentParameterName,
    openParenPosition: { line: bestMatch.openLine, column: bestMatch.openColumn },
  }
}

/**
 * Finds the variable hover context at the given cursor position
 * Returns information about a variable (identifier not followed by parentheses) at the cursor
 */
export const findVariableHoverContext = (
  lines: string[],
  cursorLine: number,
  cursorColumn: number,
  functionDefinitions: Record<string, FunctionSignature> = {},
): VariableHoverInfo | null => {
  const code = lines.join('\n')

  const lineStarts: number[] = new Array(lines.length)
  {
    let pos = 0
    for (let i = 0; i < lines.length; i++) {
      lineStarts[i] = pos
      pos += (lines[i]?.length ?? 0) + 1
    }
  }

  const findLine = (pos: number): number => {
    let low = 0
    let high = lineStarts.length - 1
    while (low <= high) {
      const mid = (low + high) >> 1
      const start = lineStarts[mid] ?? 0
      const nextStart = (mid + 1 < lineStarts.length) ? (lineStarts[mid + 1] ?? code.length) : code.length + 1
      if (pos < start) high = mid - 1
      else if (pos >= nextStart) low = mid + 1
      else return mid
    }
    return Math.max(0, Math.min(lineStarts.length - 1, low))
  }

  const toLineColumn = (pos: number): { line: number; column: number } => {
    const line = findLine(pos)
    return { line, column: pos - (lineStarts[line] ?? 0) }
  }

  const clampedCursorLine = Math.max(0, Math.min(cursorLine, Math.max(0, lines.length - 1)))
  const clampedCursorColumn = Math.max(0, Math.min(cursorColumn, lines[clampedCursorLine]?.length ?? 0))
  const cursorGlobalPos = Math.max(0, Math.min(
    (lineStarts[clampedCursorLine] ?? 0) + clampedCursorColumn,
    code.length,
  ))

  const isIdent = (c: string): boolean => /[a-zA-Z0-9_$#]/.test(c)
  const isIdentStart = (c: string): boolean => /[a-zA-Z_$#]/.test(c)
  const isValidName = (s: string): boolean =>
    /^(\.[a-zA-Z_$#][a-zA-Z0-9_$#]*|[a-zA-Z_$#][a-zA-Z0-9_$#]*)(\.[a-zA-Z_$#][a-zA-Z0-9_$#]*)*$/.test(s)

  // Find the identifier at the cursor position
  {
    let start = cursorGlobalPos
    while (start > 0) {
      const c = code[start - 1]!
      if (isIdent(c) || c === '.') start--
      else break
    }
    let end = cursorGlobalPos
    while (end < code.length) {
      const c = code[end]!
      if (isIdent(c) || c === '.') end++
      else break
    }
    if (start < end) {
      const fullChain = code.substring(start, end)

      // For dotted chains like "#scale.step", we need to check each segment
      // to see which one we're actually hovering over
      if (fullChain.includes('.')) {
        // Find which segment the cursor is in by looking for dots
        let segmentStart = start
        let segmentEnd = start

        // Scan through the chain to find segment boundaries
        for (let i = start; i < end; i++) {
          if (code[i] === '.') {
            // Found a dot - check if cursor is in the segment before it
            if (cursorGlobalPos >= segmentStart && cursorGlobalPos < i) {
              const segment = code.substring(segmentStart, i)
              if (segment.length > 0 && isValidName(segment)) {
                const signature = functionDefinitions[segment]
                if (signature) {
                  const lc = toLineColumn(segmentStart)
                  return {
                    variableName: segment,
                    position: lc,
                  }
                }
              }
              break
            }
            // Move to next segment (skip the dot)
            segmentStart = i
            segmentEnd = i
          }
        }

        // Check the last segment (after the last dot, or if we didn't find the cursor yet)
        const segment = code.substring(segmentStart, end)
        if (segment.length > 0 && isValidName(segment)) {
          const signature = functionDefinitions[segment]
          if (signature) {
            const lc = toLineColumn(segmentStart)
            return {
              variableName: segment,
              position: lc,
            }
          }
        }
      }
      else {
        // Single identifier (no dots)
        const word = fullChain
        if (word.length > 0 && isValidName(word)) {
          const afterWord = code.substring(end).trimStart()
          // Only consider it a variable if it's NOT followed by opening parenthesis
          if (!afterWord.startsWith('(')) {
            // Check if this identifier exists in our definitions
            // (either as a variable, or as a function that's being referenced without calling)
            const signature = functionDefinitions[word]
            if (signature) {
              const lc = toLineColumn(start)
              return {
                variableName: word,
                position: lc,
              }
            }
          }
        }
      }
    }
  }

  return null
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
  const contentX = preCalculatedCaretContentX
    ?? preCalculatedContentX
    ?? padding + ctx.measureText(textBeforeTarget).width
  const contentLineY = preCalculatedCaretContentY
    ?? preCalculatedContentY
    ?? padding + targetPosition.line * lineHeight

  // Convert to canvas-relative viewport coordinates
  const canvasX = contentX - scrollX
  const canvasY = contentLineY - scrollY

  // Convert to page coordinates
  const x = canvasRect.left + canvasX
  const y = canvasRect.top + canvasY // Position at line top, let popup decide above/below

  return { x, y }
}
