import Prism from 'prismjs'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-jsx'
import 'prismjs/components/prism-tsx'

// Color scheme for syntax highlighting
const colors = {
  keyword: '#ff79c6', // pink
  string: '#f1fa8c', // yellow
  number: '#bd93f9', // purple
  function: '#50fa7b', // green
  comment: '#6272a4', // gray
  operator: '#ff79c6', // pink
  punctuation: '#f8f8f2', // light gray
  default: '#f8f8f2', // light gray
}

// Rainbow colors for braces
const rainbowColors = [
  '#f1fa8c', // yellow
  '#bd93f9', // purple
  '#8be9fd', // blue
]

// Error color for unmatched braces
const errorColor = '#ff5555' // red

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

export const highlightCode = (code: string, language: string = 'javascript'): HighlightedLine[] => {
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
      const tokensWithBraces = addRainbowBraces(flatTokens, globalBraceDepth, globalBraceStack)

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
          type: `brace-open-${currentDepth % rainbowColors.length}`,
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
              type: `brace-close-${matchedDepth % rainbowColors.length}`,
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

export const getTokenColor = (type: string): string => {
  // Handle unmatched braces
  if (type === 'brace-unmatched') {
    return errorColor
  }

  // Handle rainbow brace types
  if (type.startsWith('brace-open-') || type.startsWith('brace-close-')) {
    const depth = parseInt(type.split('-').pop() || '0')
    return rainbowColors[depth]
  }

  switch (type) {
    case 'keyword':
    case 'operator':
      return colors.keyword
    case 'string':
    case 'string-property':
      return colors.string
    case 'number':
      return colors.number
    case 'function':
    case 'function-variable':
      return colors.function
    case 'comment':
    case 'comment-line':
    case 'comment-block':
      return colors.comment
    case 'punctuation':
      return colors.punctuation
    default:
      return colors.default
  }
}
