// Tokenizer function type - takes a line of code and returns tokens
export type Tokenizer = (line: string, isBeginOfCode: boolean) => Token[]

export interface Theme {
  colors: {
    keyword: string
    string: string
    number: string
    function: string
    parameter: string
    argument: string
    comment: string
    operator: string
    punctuation: string
    default: string
  }
  rainbowColors: string[]
  errorColor: string
  errorGutterColor: string
  errorSquigglyColor: string
  errorPopup: {
    background: string
    border: string
    text: string
  }
  functionSignaturePopup: {
    background: string
    border: string
    text: string
    activeParameterBackground: string
    activeParameterText: string
    functionName: string
    returnType: string
    parameterName: string
    parameterType: string
    description: string
    separator: string
  }
  autocompletePopup: {
    background: string
    border: string
    text: string
    selectedBackground: string
    selectedText: string
    hoverBackground: string
  }
  background: string
  gutterBackground: string
  gutterBorder: string
  gutterText: string
  selection: string
  caret: string
  braceMatch: string
  scrollbarTrack: string
  scrollbarThumb: string
  scrollbarThumbHover: string
  font: string
}

// Default color scheme for syntax highlighting
export const defaultTheme: Theme = {
  colors: {
    keyword: '#ff79c6', // pink
    string: '#f1fa8c', // yellow
    number: '#bd93f9', // purple
    function: '#50fa7b', // green
    parameter: '#50fa7b', // green
    argument: '#50fa7b', // green
    comment: '#6272a4', // gray
    operator: '#ff79c6', // pink
    punctuation: '#f8f8f2', // light gray
    default: '#f8f8f2', // light gray
  },
  rainbowColors: [
    '#f1fa8c', // yellow
    '#bd93f9', // purple
    '#8be9fd', // blue
  ],
  errorColor: '#ff5555', // red
  errorGutterColor: '#ff5555', // red
  errorSquigglyColor: '#ff5555', // red
  errorPopup: {
    background: '#7f1d1d', // red-900
    border: '#991b1b', // red-700
    text: '#fca5a5', // red-300
  },
  functionSignaturePopup: {
    background: '#111827', // gray-900
    border: '#374151', // gray-700
    text: '#d1d5db', // gray-300
    activeParameterBackground: '#2563eb', // blue-600
    activeParameterText: '#ffffff', // white
    functionName: '#4ade80', // green-400
    returnType: '#60a5fa', // blue-400
    parameterName: '#60a5fa', // blue-400
    parameterType: '#fbbf24', // yellow-400
    description: '#9ca3af', // gray-400
    separator: '#6b7280', // gray-500
  },
  autocompletePopup: {
    background: '#111827', // gray-900
    border: '#374151', // gray-700
    text: '#d1d5db', // gray-300
    selectedBackground: '#2563eb', // blue-600
    selectedText: '#ffffff', // white
    hoverBackground: '#1f2937', // gray-800
  },
  background: '#1f2937', // dark gray
  gutterBackground: '#374151', // darker gray
  gutterBorder: '#4b5563', // medium gray
  gutterText: '#9ca3af', // light gray
  selection: '#555555', // gray
  caret: '#ffffff', // white
  braceMatch: '#ffffff', // white
  scrollbarTrack: 'transparent', // transparent track
  scrollbarThumb: '#4b5563', // medium gray thumb
  scrollbarThumbHover: '#6b7280', // lighter gray on hover
  font: '11pt "JetBrains Mono", "Fira Code", "Consolas", monospace',
}

export interface Token {
  type: string
  content: string
  length: number
}

export interface HighlightedLine {
  tokens: Token[]
  text: string
}

// Simple tokenizer that treats each character as a default token
export const defaultTokenizer: Tokenizer = (line: string, isBeginOfCode: boolean): Token[] => {
  return [{ type: 'default', content: line, length: line.length }]
}

export const highlightCode = (
  code: string,
  tokenizer: Tokenizer = defaultTokenizer,
  theme: Theme = defaultTheme,
): HighlightedLine[] => {
  try {
    const lines = code.split('\n')
    const highlightedLines: HighlightedLine[] = []
    let globalBraceDepth = 0
    const globalBraceStack: { char: string; depth: number }[] = []

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex]
      if (line.trim() === '') {
        // Empty line
        highlightedLines.push({
          tokens: [{ type: 'default', content: line, length: line.length }],
          text: line,
        })
        continue
      }

      // Use the provided tokenizer to tokenize the line
      const isBeginOfCode = lineIndex === 0
      const tokens = tokenizer(line, isBeginOfCode)
      const tokensWithBraces = addRainbowBraces(tokens, globalBraceDepth, globalBraceStack, theme)

      // Update global brace depth for next line
      for (const token of tokensWithBraces) {
        if (token.type.startsWith('brace-open-')) {
          globalBraceDepth++
        } else if (token.type.startsWith('brace-close-')) {
          globalBraceDepth = Math.max(0, globalBraceDepth - 1)
        }
      }

      highlightedLines.push({
        tokens: tokensWithBraces,
        text: line,
      })
    }

    return highlightedLines
  } catch (error) {
    // Fallback to plain text if highlighting fails
    return code.split('\n').map(line => ({
      tokens: [{ type: 'default', content: line, length: line.length }],
      text: line,
    }))
  }
}

const addRainbowBraces = (
  tokens: Token[],
  startDepth: number,
  globalBraceStack: { char: string; depth: number }[],
  theme: Theme,
): Token[] => {
  const result: Token[] = []
  let currentDepth = startDepth
  const braceStack = [...globalBraceStack]
  const rainbowLength = theme.rainbowColors.length
  const matchingBrace: Record<string, string> = { ')': '(', '}': '{', ']': '[' }
  const openingBraces = new Set(['{', '(', '['])
  const closingBraces = new Set(['}', ')', ']'])

  for (const token of tokens) {
    if (token.type !== 'punctuation') {
      result.push(token)
      continue
    }

    const char = token.content
    if (openingBraces.has(char)) {
      braceStack.push({ char, depth: currentDepth })
      result.push({
        type: `brace-open-${currentDepth % rainbowLength}`,
        content: char,
        length: char.length,
      })
      currentDepth++
    } else if (closingBraces.has(char)) {
      const expectedOpening = matchingBrace[char]
      const lastBrace = braceStack[braceStack.length - 1]

      if (lastBrace?.char === expectedOpening) {
        const matchedDepth = lastBrace.depth
        braceStack.pop()
        currentDepth = Math.max(0, currentDepth - 1)
        result.push({
          type: `brace-close-${matchedDepth % rainbowLength}`,
          content: char,
          length: char.length,
        })
      } else {
        result.push({
          type: 'brace-unmatched',
          content: char,
          length: char.length,
        })
      }
    } else {
      result.push(token)
    }
  }

  globalBraceStack.length = 0
  globalBraceStack.push(...braceStack)

  return result
}

export const getTokenColor = (type: string, theme: Theme = defaultTheme): string => {
  // Handle unmatched braces
  if (type === 'brace-unmatched') {
    return theme.errorColor
  }

  // Handle rainbow brace types
  if (type.startsWith('brace-open-') || type.startsWith('brace-close-')) {
    const depth = parseInt(type.split('-').pop() || '0')
    return theme.rainbowColors[depth]
  }

  switch (type) {
    case 'keyword':
      return theme.colors.keyword
    case 'operator':
      return theme.colors.operator
    case 'string':
    case 'string-property':
      return theme.colors.string
    case 'number':
      return theme.colors.number
    case 'function':
    case 'function-variable':
      return theme.colors.function
    case 'parameter':
      return theme.colors.parameter
    case 'argument':
      return theme.colors.argument
    case 'comment':
    case 'comment-line':
    case 'comment-block':
      return theme.colors.comment
    case 'punctuation':
      return theme.colors.punctuation
    default:
      return theme.colors.default
  }
}
