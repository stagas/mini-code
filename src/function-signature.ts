export interface FunctionParameter {
  name: string
  type?: string
  optional?: boolean
  description?: string
  defaultValue?: any
}

export interface FunctionSignature {
  name: string
  parameters: FunctionParameter[]
  returnType?: string
  description?: string
  deprecated?: boolean
  examples?: string[]
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

  const isIdent = (c: string): boolean => /[a-zA-Z0-9_$]/.test(c)
  const isIdentStart = (c: string): boolean => /[a-zA-Z_$]/.test(c)
  const isValidName = (s: string): boolean =>
    /^(\.[a-zA-Z_$][a-zA-Z0-9_$]*|[a-zA-Z_$][a-zA-Z0-9_$]*)(\.[a-zA-Z_$][a-zA-Z0-9_$]*)*$/.test(s)

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
          const paramName = namedMatch[1]
          usedParameterNames.add(paramName)
          // Also check if it matches a parameter with ... prefix
          if (signature) {
            for (const param of signature.parameters) {
              const cleanName = param.name.replace(/^\.\.\./, '')
              if (cleanName === paramName || param.name === paramName) {
                usedParameterNames.add(cleanName)
                usedParameterNames.add(param.name)
                break
              }
            }
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
    // First check currentArgText (up to cursor) for immediate feedback when typing
    let namedParamMatch = currentArgText.match(/([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/)
    if (!namedParamMatch) {
      // Also check full argument text
      namedParamMatch = fullCurrentArgText.match(/([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/)
    }

    if (namedParamMatch) {
      const paramName = namedParamMatch[1]
      const matchIndex = fullCurrentArgText.indexOf(namedParamMatch[0])

      // Only use if parameter hasn't been used yet
      if (!usedParameterNames.has(paramName)) {
        // If the pattern is at the start of the argument (after trimming), use it
        if (matchIndex === 0) {
          currentParameterName = paramName
        }
        else {
          // Pattern is somewhere in the argument - check if cursor is on it
          const argStartInCode = bestMatch.openPos + 1 + argStartInFullText
          const untrimmedArgText = textFromOpenParen.substring(argStartInFullText, argEndInFullText)
          const leadingWhitespace = untrimmedArgText.length - untrimmedArgText.trimStart().length
          const trimmedArgStart = argStartInCode + leadingWhitespace
          const cursorInArg = cursorPos - trimmedArgStart
          const matchEnd = matchIndex + paramName.length

          // If cursor is on or within the parameter name, use it
          if (cursorInArg >= matchIndex && cursorInArg <= matchEnd) {
            currentParameterName = paramName
          }
        }
      }
    }
    else {
      // No colon found - check if the argument text matches a parameter name prefix
      if (signature) {
        // Priority 1: Check currentArgText (text up to cursor) - most accurate when typing
        // This is what the user is actively typing, so check it first
        const trimmedCurrentArg = currentArgText.trim()
        if (trimmedCurrentArg.length > 0) {
          // Extract the first word from the current argument
          const currentArgWordMatch = trimmedCurrentArg.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)/)
          if (currentArgWordMatch && currentArgWordMatch[1].length > 0) {
            const argWord = currentArgWordMatch[1]

            // Check if there's a colon after the cursor
            const argTextFromCursor = code.substring(cursorPos, Math.min(
              code.length,
              bestMatch.openPos + 1 + fullTextBetween.length + 100,
            ))
            const hasColonAfterCursor = argTextFromCursor.match(/^\s*:/)

            if (hasColonAfterCursor) {
              // Has colon - use the word as parameter name (if not already used)
              if (!usedParameterNames.has(argWord)) {
                currentParameterName = argWord
              }
            }
            else {
              // No colon yet - first check for exact matches (even if used, to handle cursor on parameter name)
              let exactMatch = false
              for (let i = 0; i < signature.parameters.length; i++) {
                const param = signature.parameters[i]
                const paramName = param.name.replace(/^\.\.\./, '')
                if (paramName === argWord || param.name === argWord) {
                  currentParameterName = paramName
                  commaCount = i // Update to point to the matched parameter
                  exactMatch = true
                  break
                }
              }
              // If no exact match, check if the word matches the start of any unused parameter name
              if (!exactMatch) {
                for (let i = 0; i < signature.parameters.length; i++) {
                  const param = signature.parameters[i]
                  const paramName = param.name.replace(/^\.\.\./, '')
                  // Check if parameter is not used and matches the word
                  if (!usedParameterNames.has(paramName)
                    && !usedParameterNames.has(param.name)
                    && paramName.startsWith(argWord)
                    && argWord.length > 0)
                  {
                    currentParameterName = paramName
                    commaCount = i // Update to point to the matched parameter
                    break // Use first match
                  }
                }
              }
            }
          }
        }
        else {
          // Current argument is empty - find next unused positional parameter
          for (let i = 0; i < signature.parameters.length; i++) {
            if (!usedPositionalIndices.has(i) && !usedParameterNames.has(signature.parameters[i].name)) {
              const paramName = signature.parameters[i].name.replace(/^\.\.\./, '')
              if (!usedParameterNames.has(paramName)) {
                // Don't set currentParameterName here - let positional index handle it
                // But we need to adjust currentArgumentIndex to point to this parameter
                commaCount = i
                break
              }
            }
          }
        }

        // Priority 2: Check fullCurrentArgText if we haven't found a match
        // Always check, even if currentArg is empty (cursor at start of argument)
        if (!currentParameterName) {
          const trimmedFullArg = fullCurrentArgText.trim()
          if (trimmedFullArg.length > 0) {
            const argWordMatch = trimmedFullArg.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)/)
            if (argWordMatch && argWordMatch[1].length > 0) {
              const argWord = argWordMatch[1]
              // First check for exact matches (even if used)
              const exactMatchIndex = signature.parameters.findIndex(
                param => {
                  const paramName = param.name.replace(/^\.\.\./, '')
                  return paramName === argWord || param.name === argWord
                },
              )
              if (exactMatchIndex >= 0) {
                currentParameterName = signature.parameters[exactMatchIndex].name.replace(/^\.\.\./, '')
                commaCount = exactMatchIndex // Update to point to the matched parameter
              }
              else {
                // Then check for unused prefix matches
                const matchingIndex = signature.parameters.findIndex(
                  param => {
                    const paramName = param.name.replace(/^\.\.\./, '')
                    return !usedParameterNames.has(paramName)
                      && !usedParameterNames.has(param.name)
                      && paramName.startsWith(argWord)
                  },
                )
                if (matchingIndex >= 0) {
                  currentParameterName = signature.parameters[matchingIndex].name.replace(/^\.\.\./, '')
                  commaCount = matchingIndex // Update to point to the matched parameter
                }
              }
            }
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
