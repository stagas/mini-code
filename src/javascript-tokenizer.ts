import { type Tokenizer, type Token } from './syntax.ts'

// Simple JavaScript tokenizer
export const javascriptTokenizer: Tokenizer = (line: string, isBeginOfCode: boolean): Token[] => {
  const tokens: Token[] = []
  let i = 0

  while (i < line.length) {
    const char = line[i]

    // Skip whitespace
    if (/\s/.test(char)) {
      let whitespace = ''
      while (i < line.length && /\s/.test(line[i])) {
        whitespace += line[i]
        i++
      }
      tokens.push({ type: 'default', content: whitespace, length: whitespace.length })
      continue
    }

    // String literals
    if (char === '"' || char === "'" || char === '`') {
      let string = char
      i++
      while (i < line.length && line[i] !== char) {
        if (line[i] === '\\' && i + 1 < line.length) {
          string += line[i] + line[i + 1]
          i += 2
        } else {
          string += line[i]
          i++
        }
      }
      if (i < line.length) {
        string += line[i]
        i++
      }
      tokens.push({ type: 'string', content: string, length: string.length })
      continue
    }

    // Numbers
    if (/\d/.test(char)) {
      let number = ''
      while (i < line.length && (/\d/.test(line[i]) || line[i] === '.')) {
        number += line[i]
        i++
      }
      tokens.push({ type: 'number', content: number, length: number.length })
      continue
    }

    // Keywords and identifiers
    if (/[a-zA-Z_$]/.test(char)) {
      let word = ''
      while (i < line.length && /[a-zA-Z0-9_$]/.test(line[i])) {
        word += line[i]
        i++
      }

      const keywords = [
        'function',
        'const',
        'let',
        'var',
        'if',
        'else',
        'for',
        'while',
        'return',
        'class',
        'import',
        'export',
        'from',
        'async',
        'await',
      ]
      const type = keywords.includes(word) ? 'keyword' : 'default'
      tokens.push({ type, content: word, length: word.length })
      continue
    }

    // Comments
    if (char === '/' && i + 1 < line.length && line[i + 1] === '/') {
      const comment = line.substring(i)
      tokens.push({ type: 'comment', content: comment, length: comment.length })
      break
    }

    // Operators and punctuation
    const operators = [
      '+',
      '-',
      '*',
      '/',
      '=',
      '!',
      '<',
      '>',
      '&',
      '|',
      '?',
      ':',
      ';',
      ',',
      '.',
      '(',
      ')',
      '[',
      ']',
      '{',
      '}',
    ]
    if (operators.includes(char)) {
      tokens.push({ type: 'punctuation', content: char, length: 1 })
      i++
      continue
    }

    // Default case
    tokens.push({ type: 'default', content: char, length: 1 })
    i++
  }

  return tokens
}
