import { useMemo, useRef } from 'react'
import './python-editor.css'

const tokens = /(?<comment>#[^\n]*)|(?<string>"""(?:\\[\s\S]|(?!""")[\s\S])*(?:"""|$)|'''(?:\\[\s\S]|(?!''')[\s\S])*(?:'''|$)|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)|(?<keyword>\b(?:False|None|True|and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield)\b)|(?<number>\b(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?[\d_]+)?)[jJ]?)|(?<call>\b[A-Za-z_]\w*(?=[ \t]*\())/g
const colors = {
  comment: 'text-slate-400',
  string: 'text-emerald-300',
  keyword: 'text-violet-300',
  number: 'text-amber-300',
  call: 'text-sky-300',
}

function highlight(code) {
  const parts = []
  let offset = 0
  for (const token of code.matchAll(tokens)) {
    const kind = Object.keys(colors).find((key) => token.groups[key] !== undefined)
    parts.push(code.slice(offset, token.index))
    parts.push(<span key={token.index} className={colors[kind]}>{token[0]}</span>)
    offset = token.index + token[0].length
  }
  parts.push(code.slice(offset) + '\n')
  return parts
}

export function PythonEditor({ value, ...props }) {
  const preview = useRef(null)
  // Keep large pasted files responsive by avoiding thousands of token elements.
  const highlighted = useMemo(() => value && value.length <= 60_000 ? highlight(value) : null, [value])

  function syncScroll(event) {
    if (!preview.current) return
    preview.current.scrollTop = event.currentTarget.scrollTop
    preview.current.scrollLeft = event.currentTarget.scrollLeft
  }

  return (
    <div className="relative rounded-lg bg-slate-950">
      {highlighted && (
        <pre ref={preview} aria-hidden="true" className="python-editor-preview pointer-events-none absolute inset-0 m-0 overflow-hidden rounded-lg border border-transparent p-4 font-mono text-sm leading-6 whitespace-pre text-slate-100">
          {highlighted}
        </pre>
      )}
      <textarea {...props} value={value} onScroll={syncScroll} wrap="off"
        className={'relative block h-72 w-full resize-y rounded-lg border border-slate-700 bg-transparent p-4 font-mono text-sm leading-6 text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:h-auto' + (highlighted ? ' python-editor-highlighted' : '')} />
    </div>
  )
}