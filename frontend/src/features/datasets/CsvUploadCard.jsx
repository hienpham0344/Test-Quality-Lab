import { useRef, useState } from 'react'
import { FileUp, FileText, Sparkles, X, AlertCircle } from 'lucide-react'
import { parseCsv, readCsvFile } from './csv-parser'
import { SAMPLE_BENCHMARK_CSV } from './column-mapping'

export function CsvUploadCard({ onParsed, existingData }) {
  const [dragOver, setDragOver] = useState(false)
  const [pasteMode, setPasteMode] = useState(false)
  const [pastedText, setPastedText] = useState('')
  const [fileInfo, setFileInfo] = useState(existingData?.fileInfo || null)
  const [error, setError] = useState(null)
  const [warnings, setWarnings] = useState([])
  const fileInputRef = useRef(null)

  function handleFileProcess(name, text) {
    setError(null)
    setWarnings([])
    const result = parseCsv(text)

    if (result.error) {
      setError(result.error)
      return
    }

    const info = {
      name,
      sizeBytes: new Blob([text]).size,
      rowCount: result.rowCount,
      columnCount: result.headers.length,
    }

    setFileInfo(info)
    setWarnings(result.warnings || [])

    onParsed({
      fileInfo: info,
      headers: result.headers,
      rows: result.rows,
      rawText: text,
      warnings: result.warnings || [],
    })
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await readCsvFile(file)
      handleFileProcess(file.name, text)
    } catch {
      setError('Failed to read file. Please ensure it is a valid text/csv file.')
    }
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    if (!file.name.endsWith('.csv') && file.type && !file.type.includes('csv') && !file.type.includes('text')) {
      setError('Please upload a .csv file.')
      return
    }
    const reader = new FileReader()
    reader.onload = (event) => {
      const text = String(event.target?.result || '')
      handleFileProcess(file.name, text)
    }
    reader.onerror = () => {
      setError('Failed to read dropped file.')
    }
    reader.readAsText(file)
  }

  function handleLoadSample() {
    setPastedText(SAMPLE_BENCHMARK_CSV)
    handleFileProcess('sample_benchmark.csv', SAMPLE_BENCHMARK_CSV)
  }

  function handlePasteSubmit() {
    if (!pastedText.trim()) {
      setError('Please enter or paste CSV text.')
      return
    }
    handleFileProcess('pasted_data.csv', pastedText)
  }

  function handleClear() {
    setFileInfo(null)
    setError(null)
    setWarnings([])
    setPastedText('')
    if (fileInputRef.current) fileInputRef.current.value = ''
    onParsed(null)
  }

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900 p-6 md:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Step 1: Upload CSV Dataset</h2>
          <p className="text-sm text-slate-400 mt-1">
            Upload a benchmark CSV file or paste raw CSV content to begin column mapping.
          </p>
        </div>
        <button
          type="button"
          onClick={handleLoadSample}
          className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded-lg border border-indigo-500/40 bg-indigo-950/40 px-3 py-1.5 text-xs font-medium text-indigo-300 hover:bg-indigo-900/50 hover:text-indigo-200 transition"
        >
          <Sparkles size={14} />
          Load sample benchmark CSV
        </button>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-rose-800/80 bg-rose-950/50 p-4 text-sm text-rose-300">
          <AlertCircle size={18} className="shrink-0 mt-0.5 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="space-y-1.5 rounded-lg border border-amber-800/80 bg-amber-950/40 p-4 text-xs text-amber-300">
          <p className="font-medium text-amber-200">Warnings:</p>
          <ul className="list-disc pl-4 space-y-0.5">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {!fileInfo ? (
        <div className="space-y-4">
          {/* Dropzone */}
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition ${
              dragOver
                ? 'border-indigo-500 bg-indigo-950/30'
                : 'border-slate-700 bg-slate-950/50 hover:border-slate-600'
            }`}
          >
            <div className="p-3 rounded-full bg-slate-800 text-indigo-400 mb-3">
              <FileUp size={28} />
            </div>
            <p className="text-sm font-medium text-slate-200 mb-1">
              Drag and drop your CSV file here, or{' '}
              <label
                htmlFor="csv-file-input"
                className="cursor-pointer text-indigo-400 hover:text-indigo-300 hover:underline"
              >
                browse files
              </label>
            </p>
            <p className="text-xs text-slate-400">
              Supports standard comma, tab, or semicolon separated files (up to 10,000 rows).
            </p>
            <input
              id="csv-file-input"
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={handleFileChange}
              className="sr-only"
            />
          </div>

          {/* Paste Toggle */}
          <div className="text-center">
            <button
              type="button"
              onClick={() => setPasteMode(!pasteMode)}
              className="text-xs text-slate-400 hover:text-indigo-300 hover:underline"
            >
              {pasteMode ? 'Hide raw text input' : 'Or paste CSV text directly'}
            </button>
          </div>

          {pasteMode && (
            <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950 p-4">
              <label htmlFor="csv-paste-textarea" className="block text-xs font-medium text-slate-300">
                Paste CSV Content
              </label>
              <textarea
                id="csv-paste-textarea"
                rows={5}
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder="task_id,function_name,expected_output&#10;P01,square,25"
                className="w-full font-mono text-xs rounded-lg border border-slate-700 bg-slate-900 p-3 text-slate-200 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handlePasteSubmit}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-500"
                >
                  Parse CSV Text
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Loaded File Summary */
        <div className="flex items-center justify-between rounded-xl border border-indigo-900/60 bg-indigo-950/20 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-indigo-900/40 text-indigo-300">
              <FileText size={22} />
            </div>
            <div>
              <p className="text-sm font-medium text-white">{fileInfo.name}</p>
              <p className="text-xs text-slate-400 mt-0.5">
                {fileInfo.rowCount.toLocaleString()} data rows · {fileInfo.columnCount} columns ·{' '}
                {(fileInfo.sizeBytes / 1024).toFixed(1)} KB
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClear}
            className="flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800 hover:text-white"
            title="Upload different file"
          >
            <X size={14} />
            Change file
          </button>
        </div>
      )}
    </div>
  )
}
