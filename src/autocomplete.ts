import { type FunctionSignature } from './function-signature.ts'

export interface AutocompleteInfo {
  word: string
  startColumn: number
  endColumn: number
  suggestions: string[]
}

/**
 * Check if a position in a line is inside a string literal
 */
const isInsideString = (line: string, column: number): boolean => {
  let inString = false
  let stringChar = ''

  for (let i = 0; i < column; i++) {
    const char = line[i]

    if (!inString && (char === '"' || char === '\'' || char === '`')) {
      inString = true
      stringChar = char
      continue
    }

    if (inString && char === stringChar && (i === 0 || line[i - 1] !== '\\')) {
      inString = false
      stringChar = ''
      continue
    }
  }

  return inString
}

/**
 * Find the word being typed at the cursor position
 * Only returns a word if the cursor is at the end of a word (indicating active typing)
 */
export const findCurrentWord = (
  lines: string[],
  cursorLine: number,
  cursorColumn: number,
): { word: string; startColumn: number; endColumn: number } | null => {
  const line = lines[cursorLine]
  if (!line) return null

  // Don't autocomplete if cursor is inside a string
  if (isInsideString(line, cursorColumn)) return null

  // Identifier segment characters (per segment): letters, numbers, $, _
  // Dot is treated as a segment delimiter for the current word
  const isSegmentChar = (char: string) => /[a-zA-Z0-9$_]/.test(char)

  // Find start of word segment (scan backwards until a non-segment char OR a dot)
  let startColumn = cursorColumn
  while (startColumn > 0) {
    const prevChar = line[startColumn - 1]
    if (prevChar === '.') {
      // Include the dot in the word if it's immediately before the current segment
      startColumn--
      break
    }
    if (!isSegmentChar(prevChar)) break
    startColumn--
  }

  // Find end of word segment (scan forwards until a non-segment char OR a dot)
  let endColumn = cursorColumn
  while (endColumn < line.length) {
    const ch = line[endColumn]
    if (ch === '.') break
    if (!isSegmentChar(ch)) break
    endColumn++
  }

  const word = line.substring(startColumn, endColumn)

  // Reject empty words
  if (word.length === 0) return null

  // Only show autocomplete if cursor is at the end of the word (indicating active typing)
  // This prevents autocomplete from showing when navigating within or past words
  if (cursorColumn !== endColumn) return null

  return { word, startColumn, endColumn }
}

/**
 * Extract all unique identifiers from the code
 * Filters out identifiers that are inside strings
 */
export const extractIdentifiers = (lines: string[]): Set<string> => {
  const identifiers = new Set<string>()

  for (const line of lines) {
    // Regex to match identifiers (including dotted ones like console.log)
    const identifierRegex = /[a-zA-Z_$][a-zA-Z0-9_$]*(?:\.[a-zA-Z_$][a-zA-Z0-9_$]*)*/g
    const matches = line.matchAll(identifierRegex)

    for (const match of matches) {
      const identifier = match[0]
      const startIndex = match.index!

      // Check if this identifier is inside a string by tracking string state up to its start
      let inStringAtStart = false
      let currentStringChar = ''

      for (let i = 0; i < startIndex; i++) {
        const char = line[i]

        if (!inStringAtStart && (char === '"' || char === '\'' || char === '`')) {
          inStringAtStart = true
          currentStringChar = char
          continue
        }

        if (inStringAtStart && char === currentStringChar && (i === 0 || line[i - 1] !== '\\')) {
          inStringAtStart = false
          currentStringChar = ''
          continue
        }
      }

      // Only add if not inside a string and not a keyword
      if (!inStringAtStart && !isKeyword(identifier)) {
        identifiers.add(identifier)
      }
    }
  }

  return identifiers
}

/**
 * Check if a word is a JavaScript keyword
 */
const isKeyword = (word: string): boolean => {
  const keywords = new Set([
    'break',
    'case',
    'catch',
    'class',
    'const',
    'continue',
    'debugger',
    'default',
    'delete',
    'do',
    'else',
    'export',
    'extends',
    'finally',
    'for',
    'function',
    'if',
    'import',
    'in',
    'instanceof',
    'let',
    'new',
    'return',
    'super',
    'switch',
    'this',
    'throw',
    'try',
    'typeof',
    'var',
    'void',
    'while',
    'with',
    'yield',
    'await',
    'async',
    'static',
    'null',
    'true',
    'false',
    'undefined',
  ])
  return keywords.has(word)
}

/**
 * Get autocomplete suggestions based on current word
 */
export const getAutocompleteSuggestions = (
  currentWord: string,
  lines: string[],
  functionDefinitions: Record<string, FunctionSignature>,
): string[] => {
  if (!currentWord) return []

  const suggestions = new Set<string>()

  // Add identifiers from code
  const identifiers = extractIdentifiers(lines)
  for (const identifier of identifiers) {
    suggestions.add(identifier)
  }

  // Add function names from definitions (excluding deprecated ones)
  for (const [funcName, funcDef] of Object.entries(functionDefinitions)) {
    if (!funcDef.deprecated) {
      suggestions.add(funcName)
    }
  }

  // Handle dot-prefixed matching: if current word starts with '.', match suggestions that start with '.'
  const startsWithDot = currentWord.startsWith('.')
  const prefix = currentWord.toLowerCase()

  let filtered: string[]
  if (startsWithDot) {
    // Match suggestions that start with '.' and match the rest
    filtered = Array.from(suggestions).filter(suggestion => {
      if (!suggestion.startsWith('.')) return false
      const suggestionWithoutDot = suggestion.substring(1)
      const wordWithoutDot = currentWord.substring(1)
      return suggestionWithoutDot.toLowerCase().startsWith(wordWithoutDot.toLowerCase())
    })
  }
  else {
    // Regular prefix matching
    filtered = Array.from(suggestions).filter(suggestion => suggestion.toLowerCase().startsWith(prefix))
  }

  // Remove the current word itself from suggestions
  const withoutSelf = filtered.filter(s => s !== currentWord)

  // Sort by relevance:
  // 1. Exact case match comes first
  // 2. Case-insensitive match but different case
  // 3. Then alphabetically
  return withoutSelf.sort((a, b) => {
    const aExact = a.startsWith(currentWord)
    const bExact = b.startsWith(currentWord)

    if (aExact && !bExact) return -1
    if (!aExact && bExact) return 1

    return a.localeCompare(b)
  })
}

/**
 * Calculate the position for the autocomplete popup at the cursor position
 */
export const calculateAutocompletePosition = (
  line: number,
  column: number,
  padding: number,
  lineHeight: number,
  ctx: CanvasRenderingContext2D,
  lines: string[],
  canvasRect: DOMRect,
  scrollX: number = 0,
  scrollY: number = 0,
  preCalculatedCaretContentY?: number,
  preCalculatedCaretContentX?: number,
): { x: number; y: number } => {
  const targetLine = lines[line] || ''
  const textBeforeCursor = targetLine.substring(0, column)

  // Content-space coordinates (prefer word-wrap-aware precalculated values)
  const contentX = preCalculatedCaretContentX ?? padding + ctx.measureText(textBeforeCursor).width
  const contentLineY = preCalculatedCaretContentY ?? padding + line * lineHeight

  // Convert to canvas-relative viewport coordinates
  const canvasX = contentX - scrollX
  const canvasY = contentLineY - scrollY

  // Convert to page coordinates
  const x = canvasRect.left + canvasX
  const y = canvasRect.top + canvasY

  return { x, y }
}
