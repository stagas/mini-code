import { type FunctionSignature } from './function-signature.ts'

export interface AutocompleteInfo {
  word: string
  startColumn: number
  endColumn: number
  suggestions: string[]
}

/**
 * Find the word being typed at the cursor position
 */
export const findCurrentWord = (
  lines: string[],
  cursorLine: number,
  cursorColumn: number,
): { word: string; startColumn: number; endColumn: number } | null => {
  const line = lines[cursorLine]
  if (!line) return null

  // Identifier segment characters (per segment): letters, numbers, $, _
  // Dot is treated as a segment delimiter for the current word
  const isSegmentChar = (char: string) => /[a-zA-Z0-9$_]/.test(char)

  // Find start of word segment (scan backwards until a non-segment char OR a dot)
  let startColumn = cursorColumn
  while (startColumn > 0) {
    const prevChar = line[startColumn - 1]
    if (prevChar === '.') break
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

  // Only return if we have at least some word content
  if (word.length === 0) return null

  return { word, startColumn, endColumn }
}

/**
 * Extract all unique identifiers from the code
 */
export const extractIdentifiers = (lines: string[]): Set<string> => {
  const identifiers = new Set<string>()

  // Regex to match identifiers (including dotted ones like console.log)
  const identifierRegex = /[a-zA-Z_$][a-zA-Z0-9_$]*(?:\.[a-zA-Z_$][a-zA-Z0-9_$]*)*/g

  for (const line of lines) {
    const matches = line.matchAll(identifierRegex)
    for (const match of matches) {
      const identifier = match[0]
      // Filter out common keywords that shouldn't be autocompleted
      if (!isKeyword(identifier)) {
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

  // Add function names from definitions
  for (const funcName of Object.keys(functionDefinitions)) {
    suggestions.add(funcName)
  }

  // Filter by prefix match (case-insensitive)
  const prefix = currentWord.toLowerCase()
  const filtered = Array.from(suggestions).filter(suggestion =>
    suggestion.toLowerCase().startsWith(prefix),
  )

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
