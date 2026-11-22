/**
 * Lightweight mock backend server for frontend-only development and testing.
 * Runs on http://localhost:8000 with zero external dependencies (Node.js built-in http).
 *
 * Usage:
 *   node mock-backend.js
 */

import http from 'node:http'
import crypto from 'node:crypto'

const PORT = 8000

const store = {
  datasets: [],
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  })
  res.end(JSON.stringify(data))
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch {
        resolve({})
      }
    })
  })
}

const server = http.createServer(async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    })
    res.end()
    return
  }

  const url = new URL(req.url, `http://${req.headers.host}`)
  const path = url.pathname

  // Health check
  if (path === '/health') {
    sendJson(res, 200, { status: 'ok', version: '0.1.0-mock' })
    return
  }

  // Auth: Login
  if (path === '/api/v1/auth/login' && req.method === 'POST') {
    sendJson(res, 200, {
      access_token: 'mock-access-token-123',
      accessToken: 'mock-access-token-123',
      refresh_token: 'mock-refresh-token-123',
      refreshToken: 'mock-refresh-token-123',
      token_type: 'bearer',
    })
    return
  }

  // Auth: Me
  if (path === '/api/v1/auth/me') {
    sendJson(res, 200, {
      id: 'mock-user-uuid',
      email: 'tester@example.com',
      display_name: 'Tester',
    })
    return
  }

  // Projects list
  if (path === '/api/v1/projects' && req.method === 'GET') {
    sendJson(res, 200, [
      {
        id: 'demo-project',
        name: 'LLM Benchmark Evaluator',
        description: 'Workspace for testing Python benchmarks and CSV datasets.',
        current_revision: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ])
    return
  }

  // Single project details
  if (path === '/api/v1/projects/demo-project' && req.method === 'GET') {
    sendJson(res, 200, {
      id: 'demo-project',
      name: 'LLM Benchmark Evaluator',
      description: 'Workspace for testing Python benchmarks and CSV datasets.',
      current_revision: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    return
  }

  // Project history
  if (path === '/api/v1/projects/demo-project/history') {
    sendJson(res, 200, [
      {
        revision: 1,
        name: 'LLM Benchmark Evaluator',
        description: 'Workspace for testing Python benchmarks and CSV datasets.',
        changed_at: new Date().toISOString(),
      },
    ])
    return
  }

  // Datasets: List
  if (path === '/api/v1/projects/demo-project/datasets' && req.method === 'GET') {
    const list = store.datasets.map((d) => ({
      id: d.dataset_id,
      project_id: d.project_id,
      current_revision: d.revision,
      created_at: d.created_at,
      updated_at: d.created_at,
    }))
    sendJson(res, 200, list)
    return
  }

  // Datasets: Create (POST /api/v1/projects/demo-project/datasets)
  if (path === '/api/v1/projects/demo-project/datasets' && req.method === 'POST') {
    const body = await readBody(req)
    const rows = body.rows || []

    const validatedRows = rows.map((r) => {
      const fn = r.function_name
      const isValidFn = fn && /^[A-Za-z_][A-Za-z0-9_]*$/.test(fn)
      const hasCode = Boolean(r.python_source && r.python_source.trim())
      const isInvalid = !isValidFn
      const status = isInvalid ? 'invalid' : hasCode ? 'valid' : 'preview_only'

      let parsedExpected = null
      if (r.expected_output) {
        try {
          parsedExpected = JSON.parse(r.expected_output)
        } catch {
          // invalid JSON
        }
      }

      return {
        row_number: r.row_number,
        task_id: r.task_id || null,
        function_name: fn || null,
        description: r.description || null,
        task_title: r.task_title || null,
        difficulty: r.difficulty || null,
        expected_output: parsedExpected,
        expected_output_provenance: parsedExpected !== null ? 'csv' : null,
        input_data: r.input_data ? JSON.parse(r.input_data) : null,
        status,
        reasons: isInvalid
          ? ['function_name must be a valid Python identifier']
          : !hasCode
            ? ['Reference source is required']
            : [],
        source_sha256: hasCode ? crypto.createHash('sha256').update(r.python_source).digest('hex') : null,
        runtime_status: 'N/A',
        runtime_reason: isInvalid ? 'Row is invalid' : hasCode ? 'Untrusted execution is disabled' : 'Reference source is required',
        execution_enabled: false,
      }
    })

    const datasetId = crypto.randomUUID()
    const versionOutput = {
      dataset_id: datasetId,
      project_id: 'demo-project',
      revision: 1,
      sha256: crypto.createHash('sha256').update(JSON.stringify(validatedRows)).digest('hex'),
      rows: validatedRows,
      selected_rows: [],
      reference_source_id: null,
      reference_revision: null,
      created_at: new Date().toISOString(),
    }

    store.datasets.unshift(versionOutput)
    sendJson(res, 201, versionOutput)
    return
  }

  // Datasets: Get single dataset preview
  const singleMatch = path.match(/^\/api\/v1\/projects\/demo-project\/datasets\/([^/]+)$/)
  if (singleMatch && req.method === 'GET') {
    const dsId = singleMatch[1]
    const ds = store.datasets.find((d) => d.dataset_id === dsId)
    if (!ds) {
      sendJson(res, 404, { detail: { message: 'Dataset not found' } })
      return
    }
    sendJson(res, 200, ds)
    return
  }

  // Datasets: Row selection snapshot
  const selectionMatch = path.match(/^\/api\/v1\/projects\/demo-project\/datasets\/([^/]+)\/selection$/)
  if (selectionMatch && req.method === 'POST') {
    const dsId = selectionMatch[1]
    const ds = store.datasets.find((d) => d.dataset_id === dsId)
    if (!ds) {
      sendJson(res, 404, { detail: { message: 'Dataset not found' } })
      return
    }
    const body = await readBody(req)
    ds.revision += 1
    ds.selected_rows = body.row_numbers || []
    sendJson(res, 200, ds)
    return
  }

  // Datasets: Link reference
  const refMatch = path.match(/^\/api\/v1\/projects\/demo-project\/datasets\/([^/]+)\/reference$/)
  if (refMatch && req.method === 'POST') {
    const dsId = refMatch[1]
    const ds = store.datasets.find((d) => d.dataset_id === dsId)
    if (!ds) {
      sendJson(res, 404, { detail: { message: 'Dataset not found' } })
      return
    }
    const body = await readBody(req)
    ds.revision += 1
    ds.reference_source_id = body.source_id
    ds.reference_revision = body.revision
    // Update preview_only rows to valid
    ds.rows.forEach((r) => {
      if (r.status === 'preview_only') {
        r.status = 'valid'
        r.reasons = []
      }
    })
    sendJson(res, 200, ds)
    return
  }

  // Fallback 404
  sendJson(res, 404, { detail: { message: `Not found: ${req.method} ${path}` } })
})

server.listen(PORT, () => {
  console.log(`\n🚀 Mock Backend running at http://localhost:${PORT}`)
  console.log(`✨ You can now run 'npm run dev' and test the full UI without Docker or Python backend!`)
  console.log(`📌 Demo Project available at: http://localhost:5173/projects/demo-project?tab=datasets\n`)
})
