import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileSpreadsheet, PlusCircle, Database, ChevronRight, RefreshCw, Loader2 } from 'lucide-react'
import { CsvUploadCard } from './CsvUploadCard'
import { HeaderPreviewCard } from './HeaderPreviewCard'
import { ColumnMappingCard } from './ColumnMappingCard'
import { MappingValidationCard } from './MappingValidationCard'
import { DatasetResultsView } from './DatasetResultsView'
import { suggestInitialMapping } from './column-mapping'
import { listDatasets, getDataset, AuthApiError } from '../../services/api'
import { Badge } from '../../components/common'
import { formatDate } from '../../lib/format-date'

export function DatasetsManager({ session, projectId, onExpire }) {
  const queryClient = useQueryClient()

  // Navigation mode: 'wizard' (new upload) | 'details' (inspecting a dataset) | 'list'
  const [viewMode, setViewMode] = useState('wizard')
  const [activeDatasetVersion, setActiveDatasetVersion] = useState(null)

  // Wizard state
  const [parsedData, setParsedData] = useState(null)
  const [mapping, setMapping] = useState({})

  // Fetch list of datasets for this project
  const datasetsQuery = useQuery({
    queryKey: ['private', 'datasets', projectId],
    queryFn: ({ signal }) => listDatasets(session.accessToken, projectId, signal),
    enabled: Boolean(projectId && session?.accessToken),
    retry: false,
    gcTime: 0,
  })

  // Expiration check
  useEffect(() => {
    if (datasetsQuery.error instanceof AuthApiError && datasetsQuery.error.status === 401) {
      onExpire?.(session)
    }
  }, [datasetsQuery.error, onExpire, session])

  // When CSV is parsed, initialize mapping with suggested defaults
  function handleCsvParsed(result) {
    setParsedData(result)
    if (result?.headers) {
      const initial = suggestInitialMapping(result.headers)
      setMapping(initial)
    } else {
      setMapping({})
    }
  }

  // When dataset is created via backend
  function handleDatasetCreated(versionOutput) {
    setActiveDatasetVersion(versionOutput)
    setViewMode('details')
    void queryClient.invalidateQueries({ queryKey: ['private', 'datasets', projectId] })
  }

  // When inspecting an existing dataset from list
  async function handleSelectExistingDataset(datasetId) {
    try {
      const details = await getDataset(session.accessToken, projectId, datasetId)
      setActiveDatasetVersion(details)
      setViewMode('details')
    } catch (err) {
      if (err instanceof AuthApiError && err.status === 401) {
        onExpire?.(session)
      }
    }
  }

  function handleStartNewUpload() {
    setParsedData(null)
    setMapping({})
    setActiveDatasetVersion(null)
    setViewMode('wizard')
  }

  const existingDatasets = datasetsQuery.data || []

  return (
    <div className="space-y-6">
      {/* Top action / view switcher bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleStartNewUpload}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition ${
              viewMode === 'wizard'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <PlusCircle size={15} />
            Import CSV Dataset
          </button>
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition ${
              viewMode === 'list'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Database size={15} />
            Project Datasets ({existingDatasets.length})
          </button>
        </div>

        {viewMode === 'details' && activeDatasetVersion && (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>Viewing Dataset:</span>
            <span className="font-mono text-indigo-300">{activeDatasetVersion.dataset_id.slice(0, 8)}…</span>
            <Badge variant="info">Rev {activeDatasetVersion.revision}</Badge>
          </div>
        )}
      </div>

      {/* VIEW 1: Datasets List */}
      {viewMode === 'list' && (
        <div className="rounded-2xl border border-slate-700 bg-slate-900 p-6 md:p-8 space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <h2 className="text-xl font-semibold text-white">Project Datasets</h2>
              <p className="text-sm text-slate-400 mt-0.5">
                Saved test case datasets and immutable selection snapshots for this project.
              </p>
            </div>
            <button
              type="button"
              onClick={() => { void datasetsQuery.refetch() }}
              disabled={datasetsQuery.isFetching}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
            >
              <RefreshCw size={13} className={datasetsQuery.isFetching ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>

          {datasetsQuery.isPending && (
            <div className="flex items-center justify-center p-8 text-slate-400 gap-2">
              <Loader2 size={18} className="animate-spin" />
              <span>Loading project datasets…</span>
            </div>
          )}

          {datasetsQuery.isError && (
            <p role="alert" className="text-sm text-rose-300 bg-rose-950/40 p-4 rounded-xl border border-rose-800">
              Failed to load datasets.
            </p>
          )}

          {!datasetsQuery.isPending && existingDatasets.length === 0 && (
            <div className="text-center py-12 space-y-3">
              <div className="p-3 rounded-full bg-slate-800 text-slate-400 w-12 h-12 mx-auto flex items-center justify-center">
                <FileSpreadsheet size={24} />
              </div>
              <h3 className="text-base font-medium text-white">No datasets uploaded yet</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                Upload a CSV benchmark or problem suite to preview headers, configure column mapping, and validate test cases.
              </p>
              <button
                type="button"
                onClick={handleStartNewUpload}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-500"
              >
                <PlusCircle size={15} />
                Upload first dataset
              </button>
            </div>
          )}

          {existingDatasets.length > 0 && (
            <div className="divide-y divide-slate-800 border border-slate-800 rounded-xl overflow-hidden">
              {existingDatasets.map((ds) => (
                <div
                  key={ds.id}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 bg-slate-950 hover:bg-slate-900/80 transition gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2.5">
                      <FileSpreadsheet size={18} className="text-indigo-400 shrink-0" />
                      <span className="font-mono text-sm font-semibold text-slate-200">
                        {ds.id}
                      </span>
                      <Badge variant="info">Revision {ds.current_revision}</Badge>
                    </div>
                    <p className="text-xs text-slate-400">
                      Created {formatDate(ds.created_at)} · Updated {formatDate(ds.updated_at)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleSelectExistingDataset(ds.id)}
                    className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 hover:text-white"
                  >
                    View & Select Rows
                    <ChevronRight size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* VIEW 2: Dataset Results & Row Selection Details */}
      {viewMode === 'details' && activeDatasetVersion && (
        <DatasetResultsView
          dataset={activeDatasetVersion}
          projectId={projectId}
          session={session}
          onExpire={onExpire}
          onNewUpload={handleStartNewUpload}
          onDatasetUpdated={(updated) => setActiveDatasetVersion(updated)}
        />
      )}

      {/* VIEW 3: CSV Upload, Header Preview & Column Mapping Wizard */}
      {viewMode === 'wizard' && (
        <div className="space-y-8">
          {/* Step 1: Upload Card */}
          <CsvUploadCard
            onParsed={handleCsvParsed}
            existingData={parsedData}
          />

          {/* Steps 2, 3, 4: Revealed after CSV parsing */}
          {parsedData && parsedData.headers.length > 0 && (
            <>
              {/* Step 2: Preview Headers */}
              <HeaderPreviewCard
                headers={parsedData.headers}
                rows={parsedData.rows}
                rowCount={parsedData.rowCount}
              />

              {/* Step 3: Configure Mapping */}
              <ColumnMappingCard
                headers={parsedData.headers}
                rows={parsedData.rows}
                mapping={mapping}
                onMappingChange={setMapping}
              />

              {/* Step 4: Validate Mapping & Submit */}
              <MappingValidationCard
                headers={parsedData.headers}
                rows={parsedData.rows}
                mapping={mapping}
                session={session}
                projectId={projectId}
                onExpire={onExpire}
                onDatasetCreated={handleDatasetCreated}
              />
            </>
          )}
        </div>
      )}
    </div>
  )
}
