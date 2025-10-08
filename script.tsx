import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CodeEditor } from './src/index.ts'

const defaultCode = `function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

// Calculate first 10 Fibonacci numbers
for (let i = 0; i < 10; i++) {
  console.log(fibonacci(i));
}

// Place cursor between the parentheses to see the popup:
Math.max()
setTimeout()
Array.from()
console.log()`

const App = () => {
  const [value1, setValue1] = useState(defaultCode)
  const [value2, setValue2] = useState(defaultCode)

  return (
    <div className="flex flex-row gap-[1px] w-[100dvw] h-[100dvh]">
      <CodeEditor value={value1} setValue={setValue1} wordWrap gutter />
      <CodeEditor value={value2} setValue={setValue2} />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
