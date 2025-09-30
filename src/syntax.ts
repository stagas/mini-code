import Prism from 'prismjs'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-jsx'
import 'prismjs/components/prism-tsx'

export interface Theme {
  colors: {
    keyword: string
    string: string
    number: string
    function: string
    comment: string
    operator: string
    punctuation: string
    default: string
  }
  rainbowColors: string[]
  errorColor: string
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

const flattenTokens = (tokens: (string | Prism.Token)[]): Token[] => {
  const result: Token[] = []

  for (const token of tokens) {
    if (typeof token === 'string') {
      result.push({ type: 'default', content: token, length: token.length })
    } else {
      if (typeof token.content === 'string') {
        result.push({ type: token.type, content: token.content, length: token.content.length })
      } else if (Array.isArray(token.content)) {
        result.push(...flattenTokens(token.content))
      }
    }
  }

  return result
}

export const highlightCode = (
  code: string,
  language: string = 'javascript',
  theme: Theme = defaultTheme,
): HighlightedLine[] => {
  try {
    const lines = code.split('\n')
    const highlightedLines: HighlightedLine[] = []
    let globalBraceDepth = 0
    const globalBraceStack: { char: string; depth: number }[] = []

    for (const line of lines) {
      if (line.trim() === '') {
        // Empty line
        highlightedLines.push({
          tokens: [{ type: 'default', content: line, length: line.length }],
          text: line,
        })
        continue
      }

      // Highlight each line independently
      const tokens = Prism.tokenize(line, Prism.languages[language] || Prism.languages.javascript)
      const flatTokens = flattenTokens(tokens)
      const tokensWithBraces = addRainbowBraces(
        flatTokens,
        globalBraceDepth,
        globalBraceStack,
        theme,
      )

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
  // Use the global brace stack to maintain state across lines
  const braceStack = [...globalBraceStack]

  // Helper function to get matching brace
  const getMatchingBrace = (brace: string): string => {
    switch (brace) {
      case ')':
        return '('
      case '}':
        return '{'
      case ']':
        return '['
      default:
        return ''
    }
  }

  for (const token of tokens) {
    if (token.type === 'punctuation') {
      const char = token.content
      if (char === '{' || char === '(' || char === '[') {
        // Opening brace
        braceStack.push({ char, depth: currentDepth })
        result.push({
          type: `brace-open-${currentDepth % theme.rainbowColors.length}`,
          content: char,
          length: char.length,
        })
        currentDepth++
      } else if (char === '}' || char === ')' || char === ']') {
        // Closing brace
        const expectedOpening = getMatchingBrace(char)
        let isMatched = false

        // Check if there's a matching opening brace
        if (braceStack.length > 0) {
          const lastBrace = braceStack[braceStack.length - 1]
          if (lastBrace.char === expectedOpening) {
            // Matched - use the depth from the opening brace
            const matchedDepth = lastBrace.depth
            braceStack.pop()
            currentDepth = Math.max(0, currentDepth - 1)
            result.push({
              type: `brace-close-${matchedDepth % theme.rainbowColors.length}`,
              content: char,
              length: char.length,
            })
            isMatched = true
          }
        }

        if (!isMatched) {
          // Unmatched closing brace - mark as error
          result.push({
            type: 'brace-unmatched',
            content: char,
            length: char.length,
          })
          // Don't change currentDepth for unmatched braces
        }
      } else {
        result.push(token)
      }
    } else {
      result.push(token)
    }
  }

  // Update the global brace stack with the current state
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
    case 'operator':
      return theme.colors.keyword
    case 'string':
    case 'string-property':
      return theme.colors.string
    case 'number':
      return theme.colors.number
    case 'function':
    case 'function-variable':
      return theme.colors.function
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
