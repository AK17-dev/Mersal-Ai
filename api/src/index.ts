import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getDocumentProxy, extractText, definePDFJSModule } from 'unpdf'
import { generateId } from './utils/id'
import { chunkDocument } from './utils/chunker'
import { CONFIG } from './config'

// Import pdfjs-dist v3 legacy files statically (using minified builds to fit within CF Workers 1MB gzip limit)
// @ts-ignore
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.min.js'
// @ts-ignore
import * as pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.js'

// 1. Force fake-worker mode by exposing the worker globally in globalThis
;(globalThis as any).pdfjsWorker = pdfjsWorker

// 2. Set workerSrc to a dummy string to bypass validation
pdfjs.GlobalWorkerOptions.workerSrc = 'dummy'

// 3. Define the custom PDF.js module for unpdf using the statically loaded instance
await definePDFJSModule(() => Promise.resolve(pdfjs))

// Define the environment bindings type for Cloudflare resources
type Bindings = {
  DB: D1Database
  BUCKET: R2Bucket
  VECTORIZE: VectorizeIndex
  AI: Ai
  GEMINI_API_KEY: string
}

const app = new Hono<{ Bindings: Bindings }>()

// Enable CORS with custom header support
app.use('*', cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'x-session-id'],
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
}))

// Global UTF-8 charset middleware for all JSON responses
app.use('*', async (c, next) => {
  await next()
  const contentType = c.res.headers.get('content-type')
  if (contentType && contentType.includes('application/json') && !contentType.includes('charset=')) {
    const newResponse = new Response(c.res.body, c.res)
    newResponse.headers.set('content-type', `${contentType}; charset=utf-8`)
    c.res = newResponse
  }
})

// Health Check
app.get('/api/health', (c) => {
  return c.json({ ok: true })
})

// Get Document List for a Session
app.get('/api/documents', async (c) => {
  const session_id = c.req.header('x-session-id')
  if (!session_id) {
    return c.json({ error: 'Missing session ID header x-session-id' }, 400)
  }

  try {
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM documents WHERE session_id = ? ORDER BY created_at DESC`
    ).bind(session_id).all()

    return c.json(results)
  } catch (error: any) {
    return c.json({ error: error.message || 'Failed to list documents' }, 500)
  }
})

// Upload Document Endpoint
app.post('/api/documents', async (c) => {
  const session_id = c.req.header('x-session-id')
  if (!session_id) {
    return c.json({ error: 'Missing session ID header x-session-id' }, 400)
  }

  try {
    const formData = await c.req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return c.json({ error: 'No file uploaded' }, 400)
    }

    // Validate type and size (max 10MB)
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      return c.json({ error: 'Only PDF documents are allowed' }, 400)
    }

    const maxSize = 10 * 1024 * 1024 // 10MB
    if (file.size > maxSize) {
      return c.json({ error: 'File size exceeds the 10MB limit' }, 400)
    }

    const documentId = generateId()
    const buffer = await file.arrayBuffer()

    // 1. Save to R2 bucket
    const r2Key = `${session_id}/${documentId}.pdf`
    await c.env.BUCKET.put(r2Key, buffer, {
      httpMetadata: { contentType: 'application/pdf' },
    })

    // 2. Insert into D1 database with "processing" status
    const now = Math.floor(Date.now() / 1000)
    await c.env.DB.prepare(
      `INSERT INTO documents (id, session_id, filename, status, character_count, page_count, created_at)
       VALUES (?, ?, ?, 'processing', 0, 0, ?)`
    ).bind(documentId, session_id, file.name, now).run()

    // 3. Process extraction asynchronously using c.executionCtx.waitUntil
    c.executionCtx.waitUntil(
      processExtraction(documentId, session_id, buffer, c.env)
    )

    // Return the inserted row metadata immediately
    return c.json({
      id: documentId,
      session_id,
      filename: file.name,
      status: 'processing',
      character_count: 0,
      page_count: 0,
      created_at: now
    })

  } catch (error: any) {
    return c.json({ error: error.message || 'Failed to initiate upload' }, 500)
  }
})

// Delete a Specific Document
app.delete('/api/documents/:id', async (c) => {
  const session_id = c.req.header('x-session-id')
  if (!session_id) {
    return c.json({ error: 'Missing session ID header x-session-id' }, 400)
  }
  const documentId = c.req.param('id')

  try {
    // 1. Fetch document metadata first to verify ownership
    const doc = await c.env.DB.prepare(
      `SELECT * FROM documents WHERE id = ? AND session_id = ?`
    ).bind(documentId, session_id).first()

    if (!doc) {
      return c.json({ error: 'Document not found' }, 404)
    }

    // 2. Try to delete the R2 object
    try {
      const r2Key = `${session_id}/${documentId}.pdf`
      await c.env.BUCKET.delete(r2Key)
    } catch (r2Err) {
      console.warn(`Failed to delete R2 object for document ${documentId}:`, r2Err)
    }

    // 3. Retrieve all vectorize IDs for this document from D1
    const { results: chunks } = await c.env.DB.prepare(
      `SELECT vectorize_id FROM chunks WHERE document_id = ?`
    ).bind(documentId).all()
    const vectorizeIds = chunks.map(chunk => chunk.vectorize_id as string).filter(Boolean)

    // 4. Delete associated vector records from the Cloudflare Vectorize index
    if (vectorizeIds.length > 0) {
      await c.env.VECTORIZE.deleteByIds(vectorizeIds)
    }

    // 5. Explicitly delete associated chunks from the chunks table (D1) to avoid SQLite cascade issues
    await c.env.DB.prepare(
      `DELETE FROM chunks WHERE document_id = ?`
    ).bind(documentId).run()

    // 6. Delete document record from D1
    await c.env.DB.prepare(
      `DELETE FROM documents WHERE id = ? AND session_id = ?`
    ).bind(documentId, session_id).run()

    return c.json({ success: true })
  } catch (error: any) {
    return c.json({ error: error.message || 'Failed to delete document' }, 500)
  }
})

// Delete All Documents in a Session
app.delete('/api/documents', async (c) => {
  const session_id = c.req.header('x-session-id')
  if (!session_id) {
    return c.json({ error: 'Missing session ID header x-session-id' }, 400)
  }

  try {
    // 1. Fetch all document IDs for this session to clean up R2 objects & Vectorize
    const { results: docs } = await c.env.DB.prepare(
      `SELECT id FROM documents WHERE session_id = ?`
    ).bind(session_id).all()
    const docIds = docs.map(d => d.id as string)

    if (docIds.length > 0) {
      // Delete R2 objects
      for (const docId of docIds) {
        try {
          const r2Key = `${session_id}/${docId}.pdf`
          await c.env.BUCKET.delete(r2Key)
        } catch (r2Err) {
          console.warn(`Failed to delete R2 object for document ${docId}:`, r2Err)
        }
      }

      // Fetch all vectorize IDs for these documents from D1
      const placeholders = docIds.map(() => '?').join(',')
      const { results: chunks } = await c.env.DB.prepare(
        `SELECT vectorize_id FROM chunks WHERE document_id IN (${placeholders})`
      ).bind(...docIds).all()
      const vectorizeIds = chunks.map(chunk => chunk.vectorize_id as string).filter(Boolean)

      // Delete associated vectors from Vectorize index
      if (vectorizeIds.length > 0) {
        await c.env.VECTORIZE.deleteByIds(vectorizeIds)
      }

      // Explicitly delete associated chunks from chunks table
      await c.env.DB.prepare(
        `DELETE FROM chunks WHERE document_id IN (${placeholders})`
      ).bind(...docIds).run()
    }

    // 2. Delete all documents for this session in D1
    await c.env.DB.prepare(
      `DELETE FROM documents WHERE session_id = ?`
    ).bind(session_id).run()

    return c.json({ success: true })
  } catch (error: any) {
    return c.json({ error: error.message || 'Failed to clear documents' }, 500)
  }
})

// Debug Search Endpoint (Retrieve chunks)
app.get('/api/debug/search', async (c) => {
  const session_id = c.req.header('x-session-id')
  if (!session_id) {
    return c.json({ error: 'Missing session ID header x-session-id' }, 400)
  }
  const query = c.req.query('q')
  if (!query) {
    return c.json({ error: 'Missing query parameter q' }, 400)
  }

  try {
    // 1. Generate query embedding using Workers AI bge-m3
    const response = (await c.env.AI.run('@cf/baai/bge-m3', { text: [query] })) as any
    
    if (!response || !Array.isArray(response.data) || response.data.length === 0) {
      throw new Error('Failed to generate query embedding: invalid response data shape')
    }
    
    const queryVector = response.data[0]

    // 2. Query Vectorize index with cosine metric settings
    const searchResult = await c.env.VECTORIZE.query(queryVector, {
      topK: 8,
      returnMetadata: true,
      filter: { session_id: session_id }
    })

    if (!searchResult.matches || searchResult.matches.length === 0) {
      return c.json([])
    }

    // 3. Fetch matching chunk texts and document metadata from D1
    const chunkIds = searchResult.matches.map(m => m.id)
    const placeholders = chunkIds.map(() => '?').join(',')
    
    const { results: chunks } = await c.env.DB.prepare(
      `SELECT c.*, d.filename 
       FROM chunks c
       JOIN documents d ON c.document_id = d.id
       WHERE c.id IN (${placeholders})`
     ).bind(...chunkIds).all()

    // 4. Map similarity scores and return chunks sorted by score descending
    const results = searchResult.matches.map(match => {
      const chunk = chunks.find(c => c.id === match.id)
      return {
        id: match.id,
        score: match.score,
        text: chunk ? chunk.text : '',
        page_number: chunk ? chunk.page_number : 0,
        filename: chunk ? chunk.filename : 'Unknown',
        document_id: chunk ? chunk.document_id : ''
      }
    }).filter(r => r.text !== '')

    return c.json(results)
  } catch (error: any) {
    return c.json({ error: error.message || 'Failed to search' }, 500)
  }
})

// GET Chat History for a Session
app.get('/api/chat', async (c) => {
  const session_id = c.req.header('x-session-id')
  if (!session_id) {
    return c.json({ error: 'Missing session ID header x-session-id' }, 400)
  }

  try {
    const { results: messages } = await c.env.DB.prepare(
      `SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC`
    ).bind(session_id).all()

    // Collect all cited chunk IDs across messages to load details in a single query
    const allCitedIds = new Set<string>()
    messages.forEach((msg: any) => {
      if (msg.cited_chunk_ids) {
        try {
          const ids = JSON.parse(msg.cited_chunk_ids)
          if (Array.isArray(ids)) {
            ids.forEach(id => allCitedIds.add(id))
          }
        } catch {}
      }
    })

    const chunksMap = new Map<string, any>()
    if (allCitedIds.size > 0) {
      const idsArray = Array.from(allCitedIds)
      const placeholders = idsArray.map(() => '?').join(',')
      const { results: chunks } = await c.env.DB.prepare(
        `SELECT c.id, c.text, c.page_number, d.filename 
         FROM chunks c
         JOIN documents d ON c.document_id = d.id
         WHERE c.id IN (${placeholders})`
      ).bind(...idsArray).all()
      chunks.forEach((chunk: any) => chunksMap.set(chunk.id, chunk))
    }

    const history = messages.map((msg: any) => {
      let citedChunks: any[] = []
      if (msg.cited_chunk_ids) {
        try {
          const ids = JSON.parse(msg.cited_chunk_ids)
          if (Array.isArray(ids)) {
            citedChunks = ids.map(id => chunksMap.get(id)).filter(Boolean)
          }
        } catch {}
      }
      return {
        id: msg.id,
        role: msg.role,
        content: msg.content,
        created_at: msg.created_at,
        chunks: citedChunks
      }
    })

    return c.json(history)
  } catch (error: any) {
    return c.json({ error: error.message || 'Failed to load chat history' }, 500)
  }
})

// POST Chat Endpoint (Grounded Q&A using gemini-3.1-flash-lite)
app.post('/api/chat', async (c) => {
  const session_id = c.req.header('x-session-id')
  if (!session_id) {
    return c.json({ error: 'Missing session ID header x-session-id' }, 400)
  }

  let body: any
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON request body' }, 400)
  }

  const { question } = body
  if (!question || typeof question !== 'string' || question.trim().length === 0) {
    return c.json({ error: 'Missing question field' }, 400)
  }

  try {
    // 1. Generate query embedding using Workers AI bge-m3
    const embedResponse = (await c.env.AI.run('@cf/baai/bge-m3', { text: [question] })) as any
    if (!embedResponse || !Array.isArray(embedResponse.data) || embedResponse.data.length === 0) {
      throw new Error('Failed to generate query embedding: invalid response data shape')
    }
    const queryVector = embedResponse.data[0]

    // 2. Query Vectorize index for top 8 matches
    const searchResult = await c.env.VECTORIZE.query(queryVector, {
      topK: 8,
      returnMetadata: true,
      filter: { session_id: session_id }
    })

    let retrievedChunks: any[] = []
    if (searchResult.matches && searchResult.matches.length > 0) {
      const chunkIds = searchResult.matches.map(m => m.id)
      const placeholders = chunkIds.map(() => '?').join(',')
      
      const { results: chunks } = await c.env.DB.prepare(
        `SELECT c.*, d.filename 
         FROM chunks c
         JOIN documents d ON c.document_id = d.id
         WHERE c.id IN (${placeholders})`
      ).bind(...chunkIds).all()

      retrievedChunks = searchResult.matches.map(match => {
        const chunk = chunks.find(c => c.id === match.id)
        return chunk ? {
          id: chunk.id,
          text: chunk.text,
          page_number: chunk.page_number,
          filename: chunk.filename,
          document_id: chunk.document_id
        } : null
      }).filter(Boolean)
    }

    // Determine question language (Arabic vs English) for immediate fallbacks
    const arabicRegex = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/
    const isArabicQuery = arabicRegex.test(question)

    let answerText = ''
    if (retrievedChunks.length === 0) {
      answerText = isArabicQuery ? 'لم أجد إجابة في المستندات' : "I couldn't find an answer in the documents"
    } else {
      // 3. Build system grounded prompt
      const contextBlock = retrievedChunks.map((chunk, idx) => {
        return `[Source ID: ${idx}]
Filename: ${chunk.filename}
Page: ${chunk.page_number}
Content: ${chunk.text}`
      }).join('\n\n---\n\n')

      const fullPrompt = `You are Mersal, a bilingual document QA assistant.
Your task is to answer the user's question using ONLY the provided document context passages below.

Strict rules:
1. Base your answer strictly on the provided context passages. Do not use any outside knowledge, assumptions, or extrapolations.
2. If the context does not contain the answer to the question, respond with exactly:
   - For English questions: "I couldn't find an answer in the documents"
   - For Arabic questions: "لم أجد إجابة في المستندات"
3. Cite the sources for your facts using the format [filename, p.X] (e.g. [mersal-spec.pdf, p.3]). Place these citations inline at the end of the sentences or clauses they support.
4. Respond in the same language as the user's question (either Arabic or English).
5. Do not include any other text, warnings, or meta-commentary.

Context passages:
${contextBlock}

User Question: ${question}`

      const model = CONFIG.models.chat
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${c.env.GEMINI_API_KEY}`

      // Call Gemini API with exponential backoff on 429
      const geminiResponse = await fetchWithRetry(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: fullPrompt }] }],
          generationConfig: { temperature: 0.1 }
        })
      }, `Chat RAG Answer (${model})`)

      if (!geminiResponse.ok) {
        const errorBody = await geminiResponse.text()
        throw new Error(`Gemini API returned HTTP ${geminiResponse.status}: ${errorBody}`)
      }

      const responseData = (await geminiResponse.json()) as any
      answerText = responseData.candidates?.[0]?.content?.parts?.[0]?.text
      if (!answerText) {
        throw new Error('Empty or invalid response from Gemini API')
      }
    }

    // 4. Extract cited chunk IDs using lenient parser
    const citedChunkIds = extractCitedChunkIds(answerText, retrievedChunks)

    // 5. Store both user question and assistant answer in D1 messages
    const userMsgId = generateId()
    const assistantMsgId = generateId()
    const now = Math.floor(Date.now() / 1000)

    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO messages (id, session_id, role, content, cited_chunk_ids, created_at)
         VALUES (?, ?, 'user', ?, '[]', ?)`
      ).bind(userMsgId, session_id, question, now),
      c.env.DB.prepare(
        `INSERT INTO messages (id, session_id, role, content, cited_chunk_ids, created_at)
         VALUES (?, ?, 'assistant', ?, ?, ?)`
      ).bind(assistantMsgId, session_id, answerText, JSON.stringify(citedChunkIds ?? []), now + 1)
    ])

    // 6. Return response
    const citedChunks = retrievedChunks.filter(c => citedChunkIds.includes(c.id))
    return c.json({
      answer: answerText,
      chunks: citedChunks
    })

  } catch (error: any) {
    console.error('Chat endpoint error:', error)
    return c.json({ error: error.message || 'An error occurred during chat processing' }, 500)
  }
})

// GET all evaluation cases
app.get('/api/evals/cases', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM eval_cases`
    ).all()
    return c.json(results)
  } catch (error: any) {
    return c.json({ error: error.message || 'Failed to fetch cases' }, 500)
  }
})

// PUT to edit an evaluation case
app.put('/api/evals/cases/:id', async (c) => {
  const id = c.req.param('id')
  let body: any
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON request body' }, 400)
  }

  const { question, expected_answer } = body
  if (!question || !expected_answer) {
    return c.json({ error: 'Missing question or expected_answer fields' }, 400)
  }

  try {
    await c.env.DB.prepare(
      `UPDATE eval_cases
       SET question = ?, expected_answer = ?
       WHERE id = ?`
    ).bind(question, expected_answer, id).run()

    return c.json({ ok: true })
  } catch (error: any) {
    return c.json({ error: error.message || 'Failed to update case' }, 500)
  }
})

// GET past runs history
app.get('/api/evals/runs', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM eval_runs ORDER BY created_at DESC`
    ).all()
    return c.json(results)
  } catch (error: any) {
    return c.json({ error: error.message || 'Failed to fetch runs' }, 500)
  }
})

// POST to start evaluation run (creates run record and resets case results)
app.post('/api/evals/run', async (c) => {
  try {
    const runId = generateId()
    const now = Math.floor(Date.now() / 1000)

    // Insert empty run record first
    await c.env.DB.prepare(
      `INSERT INTO eval_runs (id, created_at, total, correct, faithfulness_score)
       VALUES (?, ?, 0, 0, 0.0)`
    ).bind(runId, now).run()

    // Reset case results in DB to clear out any previous run's scores
    await c.env.DB.prepare(
      `UPDATE eval_cases
       SET last_result = NULL, last_score = NULL`
    ).run()

    return c.json({ runId })
  } catch (error: any) {
    return c.json({ error: error.message || 'Failed to start evaluation run' }, 500)
  }
})

// POST to evaluate a single case (RAG query + Judge assessment)
app.post('/api/evals/run-case/:id', async (c) => {
  const session_id = c.req.header('x-session-id')
  if (!session_id) {
    return c.json({ error: 'Missing session ID header x-session-id' }, 400)
  }

  const id = c.req.param('id')
  
  try {
    // 1. Fetch the case details
    const evalCase = await c.env.DB.prepare(
      `SELECT * FROM eval_cases WHERE id = ?`
    ).bind(id).first() as any

    if (!evalCase) {
      return c.json({ error: 'Evaluation case not found' }, 404)
    }

    const { question, expected_answer: expectedAnswer, language: caseLang } = evalCase

    // 2. Perform RAG Retrieval
    // Generate query embedding
    const embedResponse = (await c.env.AI.run('@cf/baai/bge-m3', { text: [question] })) as any
    if (!embedResponse || !Array.isArray(embedResponse.data) || embedResponse.data.length === 0) {
      throw new Error('Failed to generate query embedding')
    }
    const queryVector = embedResponse.data[0]

    // Query Vectorize
    const searchResult = await c.env.VECTORIZE.query(queryVector, {
      topK: 8,
      returnMetadata: true,
      filter: { session_id: session_id }
    })

    let retrievedChunks: any[] = []
    if (searchResult.matches && searchResult.matches.length > 0) {
      const chunkIds = searchResult.matches.map(m => m.id)
      const placeholders = chunkIds.map(() => '?').join(',')
      
      const { results: chunks } = await c.env.DB.prepare(
        `SELECT c.*, d.filename 
         FROM chunks c
         JOIN documents d ON c.document_id = d.id
         WHERE c.id IN (${placeholders})`
      ).bind(...chunkIds).all()

      retrievedChunks = searchResult.matches.map(match => {
        const chunk = chunks.find(c => c.id === match.id)
        return chunk ? {
          id: chunk.id,
          text: chunk.text,
          page_number: chunk.page_number,
          filename: chunk.filename
        } : null
      }).filter(Boolean)
    }

    // 3. Generate RAG Answer
    let generatedAnswer = ''
    const isArabicQuery = caseLang === 'ar'

    if (retrievedChunks.length === 0) {
      generatedAnswer = isArabicQuery ? 'لم أجد إجابة في المستندات' : "I couldn't find an answer in the documents"
    } else {
      const contextBlock = retrievedChunks.map((chunk, idx) => {
        return `[Source ID: ${idx}]
Filename: ${chunk.filename}
Page: ${chunk.page_number}
Content: ${chunk.text}`
      }).join('\n\n---\n\n')

      const fullPrompt = `You are Mersal, a bilingual document QA assistant.
Your task is to answer the user's question using ONLY the provided document context passages below.

Strict rules:
1. Base your answer strictly on the provided context passages. Do not use any outside knowledge, assumptions, or extrapolations.
2. If the context does not contain the answer to the question, respond with exactly:
   - For English questions: "I couldn't find an answer in the documents"
   - For Arabic questions: "لم أجد إجابة في المستندات"
3. Cite the sources for your facts using the format [filename, p.X] (e.g. [mersal-spec.pdf, p.3]). Place these citations inline at the end of the sentences or clauses they support.
4. Respond in the same language as the user's question (either Arabic or English).
5. Do not include any other text, warnings, or meta-commentary.

Context passages:
${contextBlock}

User Question: ${question}`

      const model = CONFIG.models.chat
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${c.env.GEMINI_API_KEY}`

      const geminiResponse = await fetchWithRetry(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: fullPrompt }] }],
          generationConfig: { temperature: 0.1 }
        })
      }, `Eval RAG Answer (${model})`)

      if (!geminiResponse.ok) {
        const errorBody = await geminiResponse.text()
        throw new Error(`Gemini API returned HTTP ${geminiResponse.status}: ${errorBody}`)
      }

      const responseData = (await geminiResponse.json()) as any
      generatedAnswer = responseData.candidates?.[0]?.content?.parts?.[0]?.text || ''
    }

    // 4. Run Judge Evaluation using gemini-2.5-flash with JSON mode
    const contextText = retrievedChunks.map(c => `[${c.filename}, Page ${c.page_number}]: ${c.text}`).join('\n\n')
    
    const judgePrompt = `You are an objective AI evaluation judge.
Your task is to evaluate the quality of a generated answer compared to an expected reference answer, based on the provided context passages.

Context Passages:
${contextText || 'No context passages retrieved.'}

User Question: ${question}
Expected Answer (Reference): ${expectedAnswer}
Generated Answer: ${generatedAnswer}

Strict Evaluation Rule:
1. correct: true requires that the generated answer correctly and completely answers THE QUESTION, with its facts matching the expected answer.
2. Key facts are defined as the facts that directly answer the question.
3. Details in the expected reference answer that go beyond what the question asks are supplementary — their absence in the generated answer must NOT cause failure.
4. Any factual contradiction with the expected answer, any fabricated or hallucinated fact, or a missing direct answer = correct: false.
5. If you cannot verify that the generated answer states the same key facts as the expected answer — for any reason, including unclear inputs or insufficient context information — you MUST return correct: false. Uncertainty is never a pass. correct: true requires positive confirmation that the key facts match.

Please evaluate and output a strict JSON object with the following fields:
{
  "correct": boolean, // true if the generated answer satisfies the Strict Evaluation Rule, false otherwise.
  "faithfulness": number, // a score from 0 to 100 representing how well the generated answer is grounded in the provided context (100 means fully grounded without any hallucinations or outside knowledge, 0 means completely ungrounded)
  "reason": "string" // a detailed explanation stating exactly which key facts matched or mismatched, which supplementary details were omitted (if any), and detailing correctness and faithfulness judgments
}

Do not include any other text, markdown formatting, or wrappers. Output raw JSON only.`

    const judgeModel = CONFIG.models.judge
    const judgeUrl = `https://generativelanguage.googleapis.com/v1beta/models/${judgeModel}:generateContent?key=${c.env.GEMINI_API_KEY}`

    let judgeResult: { correct: boolean; faithfulness: number; reason: string; error?: string } = {
      correct: false,
      faithfulness: 0,
      reason: ''
    }

    try {
      const judgeResponse = await fetchWithRetry(judgeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: judgePrompt }] }],
          generationConfig: { 
            temperature: 0.1,
            responseMimeType: "application/json"
          }
        })
      }, `Judge Evaluation (${judgeModel})`, 3, 10000)

      if (!judgeResponse.ok) {
        throw new Error(`Judge Gemini API returned HTTP ${judgeResponse.status}`)
      }

      const judgeData = (await judgeResponse.json()) as any
      const judgeText = judgeData.candidates?.[0]?.content?.parts?.[0]?.text || ''

      try {
        const parsed = JSON.parse(judgeText)
        if (typeof parsed.correct !== 'boolean' || typeof parsed.faithfulness !== 'number' || !parsed.reason) {
          throw new Error('Parsed JSON does not match required schema')
        }
        judgeResult = {
          correct: parsed.correct,
          faithfulness: parsed.faithfulness,
          reason: parsed.reason
        }
      } catch (parseErr: any) {
        console.error('Judge JSON parse failure:', parseErr, 'Raw Text:', judgeText)
        judgeResult = {
          correct: false,
          faithfulness: 0,
          reason: `Failed to parse judge JSON. Raw response: ${judgeText}`,
          error: `JSON_PARSE_ERROR`
        }
      }
    } catch (judgeErr: any) {
      console.error('Judge execution failure:', judgeErr)
      const errMsg = judgeErr.message || ''
      const isDailyQuota = errMsg.includes('Daily Quota Exhausted') || 
                           errMsg.toLowerCase().includes('per day') || 
                           errMsg.toLowerCase().includes('daily') || 
                           errMsg.toLowerCase().includes('quota exceeded')
      
      const isRateLimit = !isDailyQuota && (
                          errMsg.includes('429') || 
                          errMsg.toLowerCase().includes('rate limit') || 
                          errMsg.includes('Max retries exceeded')
      )
      const isOverload = !isDailyQuota && !isRateLimit && (
                         errMsg.includes('503') ||
                         errMsg.includes('500')
      )
      
      judgeResult = {
        correct: false,
        faithfulness: 0,
        reason: isDailyQuota
          ? `Judge quota exhausted — retry after daily reset.`
          : isRateLimit 
          ? `Judge execution failed: Rate limited by Gemini API (429).` 
          : isOverload
          ? `Judge execution failed: Gemini API overloaded or internal server error (500/503).`
          : `Judge execution failed: ${judgeErr.message || judgeErr}`,
        error: isDailyQuota ? `QUOTA_EXHAUSTED` : isRateLimit ? `RATE_LIMITED` : isOverload ? `MODEL_OVERLOADED` : `JUDGE_EXECUTION_ERROR`
      }
    }

    // 5. Update D1 database with case results
    const lastResultObj = {
      correct: judgeResult.correct,
      faithfulness: judgeResult.faithfulness,
      reason: judgeResult.reason,
      answer: generatedAnswer,
      error: judgeResult.error
    }

    await c.env.DB.prepare(
      `UPDATE eval_cases
       SET last_result = ?, last_score = ?
       WHERE id = ?`
    ).bind(JSON.stringify(lastResultObj), judgeResult.faithfulness, id).run()

    // 6. Return response
    return c.json({
      id,
      question,
      expected_answer: expectedAnswer,
      generated_answer: generatedAnswer,
      correct: judgeResult.correct,
      faithfulness: judgeResult.faithfulness,
      reason: judgeResult.reason,
      error: judgeResult.error
    })

  } catch (error: any) {
    console.error('Eval run-case endpoint error:', error)
    const errMsg = error.message || ''
    const isDailyQuota = errMsg.includes('Daily Quota Exhausted') || 
                         errMsg.toLowerCase().includes('per day') || 
                         errMsg.toLowerCase().includes('daily') || 
                         errMsg.toLowerCase().includes('quota exceeded')
    
    if (isDailyQuota) {
      const lastResultObj = {
        correct: false,
        faithfulness: 0,
        reason: 'RAG model quota exhausted — retry after daily reset.',
        answer: '',
        error: 'QUOTA_EXHAUSTED'
      }
      try {
        await c.env.DB.prepare(
          `UPDATE eval_cases
           SET last_result = ?, last_score = 0
           WHERE id = ?`
        ).bind(JSON.stringify(lastResultObj), id).run()
      } catch (dbErr) {
        console.error('Failed to update DB on quota failure:', dbErr)
      }
      return c.json({
        id,
        question: '',
        expected_answer: '',
        generated_answer: '',
        correct: false,
        faithfulness: 0,
        reason: 'RAG model quota exhausted — retry after daily reset.',
        error: 'QUOTA_EXHAUSTED'
      })
    }
    return c.json({ error: error.message || 'An error occurred during case evaluation' }, 500)
  }
})

// POST to complete evaluation run (finalizes totals)
app.post('/api/evals/complete-run', async (c) => {
  let body: any
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON request body' }, 400)
  }

  const { runId } = body
  if (!runId) {
    return c.json({ error: 'Missing runId parameter' }, 400)
  }

  try {
    // 1. Query all cases to aggregate totals
    const { results: cases } = await c.env.DB.prepare(
      `SELECT * FROM eval_cases`
    ).all()

    let total = 0
    let correct = 0
    let totalFaithfulness = 0
    let evaluatedCount = 0

    cases.forEach((kase: any) => {
      if (kase.last_result) {
        try {
          const parsed = JSON.parse(kase.last_result)
          total++
          if (parsed.correct) {
            correct++
          }
          if (typeof parsed.faithfulness === 'number') {
            totalFaithfulness += parsed.faithfulness
            evaluatedCount++
          }
        } catch {}
      }
    })

    const avgFaithfulness = evaluatedCount > 0 ? (totalFaithfulness / evaluatedCount) : 0.0

    // 2. Update the eval_runs row
    await c.env.DB.prepare(
      `UPDATE eval_runs
       SET total = ?, correct = ?, faithfulness_score = ?
       WHERE id = ?`
    ).bind(total, correct, avgFaithfulness, runId).run()

    // 3. Fetch and return the updated run
    const updatedRun = await c.env.DB.prepare(
      `SELECT * FROM eval_runs WHERE id = ?`
    ).bind(runId).first()

    return c.json(updatedRun)
  } catch (error: any) {
    return c.json({ error: error.message || 'Failed to complete evaluation run' }, 500)
  }
})

// Background task: PDF Text Extraction, Chunking, Embedding, Vectorizing, and DB Update
async function processExtraction(documentId: string, session_id: string, buffer: ArrayBuffer, env: Bindings) {
  try {
    // unpdf load PDF document proxy
    const pdf = await getDocumentProxy(new Uint8Array(buffer), {
      useSystemFonts: true,
      isEvalSupported: false,
      disableFontFace: true
    })
    
    // Extract pages text separately (mergePages: false)
    const { text, totalPages } = await extractText(pdf, { mergePages: false })
    
    // Normalize text pages using NFKC to resolve presentation forms (shaped glyphs) back to standard Arabic chars
    const textPages = (Array.isArray(text) ? text : [text])
      .map(pageText => (pageText || '').normalize('NFKC'))
    
    const totalChars = textPages.reduce((acc, p) => acc + (p?.length || 0), 0)

    // Handle scanned/image-only PDFs
    if (totalChars < 50) {
      await env.DB.prepare(
        `UPDATE documents 
         SET status = 'failed', error_message = ?
         WHERE id = ?`
      ).bind('Scanned or empty PDF (no text found)', documentId).run()
      return
    }

    // 1. Generate semantic chunks
    const chunks = chunkDocument(textPages)
    if (chunks.length === 0) {
      throw new Error('No semantic chunks generated from extracted text')
    }

    // 2. Generate embeddings in batches of 20 using Workers AI bge-m3
    const batchSize = 20
    const chunkTexts = chunks.map(c => c.text)
    const embeddings: number[][] = []

    for (let i = 0; i < chunkTexts.length; i += batchSize) {
      const batch = chunkTexts.slice(i, i + batchSize)
      const response = (await env.AI.run('@cf/baai/bge-m3', { text: batch })) as any

      // Verify Workers AI response shape strictly
      if (!response || !Array.isArray(response.data) || response.data.length !== batch.length) {
        throw new Error(
          `Embedding model response shape mismatch. Expected array of length ${batch.length}, got ${
            response?.data ? (Array.isArray(response.data) ? `array of length ${response.data.length}` : typeof response.data) : 'undefined'
          }`
        )
      }
      embeddings.push(...response.data)
    }

    // Double check that we have an embedding for every single chunk
    if (embeddings.length !== chunks.length) {
      throw new Error(`Embedding count (${embeddings.length}) does not match chunk count (${chunks.length})`)
    }

    // 3. Prepare Vectorize payloads & D1 insert statements
    const vectors: any[] = []
    const d1Statements: D1PreparedStatement[] = []

    chunks.forEach((chunk, idx) => {
      const chunkId = generateId()
      const values = embeddings[idx]

      // Verify embedding values are valid numbers of length 1024
      if (!Array.isArray(values) || values.length !== 1024) {
        throw new Error(`Invalid vector shape for chunk ${idx}. Expected array of size 1024, got size ${values?.length || '0'}`)
      }

      // Add to Vectorize payload
      vectors.push({
        id: chunkId,
        values: values,
        metadata: {
          session_id: session_id,
          document_id: documentId,
          chunk_index: chunk.chunk_index,
          page_number: chunk.page_number
        }
      })

      // Add to D1 statement
      d1Statements.push(
        env.DB.prepare(
          `INSERT INTO chunks (id, document_id, chunk_index, text, page_number, vectorize_id)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(chunkId, documentId, chunk.chunk_index, chunk.text, chunk.page_number, chunkId)
      )
    })

    // 4. Upsert vectors to Vectorize index
    await env.VECTORIZE.upsert(vectors)

    // 5. Batch insert chunks into D1
    if (d1Statements.length > 0) {
      await env.DB.batch(d1Statements)
    }

    // 6. Language Detection: compute ratio of Arabic characters to overall alphabetic chars
    let arabicCount = 0
    let alphaCount = 0
    
    // Arabic unicode ranges: standard block (\u0600-\u06FF) + Presentation Forms-A (\uFB50-\uFDFF) + Presentation Forms-B (\uFE70-\uFEFF)
    const arabicRegex = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/
    // Join text pages and extract all alphabetic letters
    const allText = textPages.join(' ')
    const letters = allText.match(/\p{L}/gu) || []
    
    for (const char of letters) {
      alphaCount++
      if (arabicRegex.test(char)) {
        arabicCount++
      }
    }

    const arRatio = alphaCount > 0 ? (arabicCount / alphaCount) : 0
    const language = arRatio > 0.3 ? 'ar' : 'en'

    // 7. Update D1 database to "ready" once everything succeeds
    await env.DB.prepare(
      `UPDATE documents 
       SET status = 'ready', language = ?, page_count = ?, character_count = ?
       WHERE id = ?`
    ).bind(language, totalPages, totalChars, documentId).run()

  } catch (error: any) {
    console.error(`PDF Processing failed for document ${documentId}:`, error)
    const errMsg = error?.message || 'Error occurred during text processing'
    
    // Guarantee that on any error, status goes to failed and error is stored
    await env.DB.prepare(
      `UPDATE documents 
       SET status = 'failed', error_message = ?
       WHERE id = ?`
    ).bind(errMsg, documentId).run()
  }
}

// Helper: HTTP Fetch with retry & exponential backoff on 429, 500, 503
async function fetchWithRetry(
  url: string, 
  options: RequestInit, 
  modelLabel: string, 
  retries = 3, 
  initialDelay = 2000
): Promise<Response> {
  let delay = initialDelay
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`[${new Date().toISOString()}] [Gemini API] Requesting ${modelLabel} (attempt ${i + 1}/${retries})`)
      const res = await fetch(url, options)
      
      if (res.status === 429) {
        const errBody = await res.clone().text()
        const isDailyLimit = errBody.toLowerCase().includes('per day') || 
                             errBody.toLowerCase().includes('daily') || 
                             errBody.toLowerCase().includes('quota exceeded')
        if (isDailyLimit) {
          console.error(`[${new Date().toISOString()}] [Gemini API] Daily Quota Exhausted for ${modelLabel}. Skipping retries.`)
          throw new Error(`Gemini API Daily Quota Exhausted: Please retry after daily reset. Details: ${errBody}`)
        }
      }
      
      const shouldRetry = res.status === 429 || res.status === 500 || res.status === 503
      
      if (shouldRetry) {
        console.warn(`[${new Date().toISOString()}] [Gemini API] HTTP ${res.status} returned for ${modelLabel}. Retrying in ${delay}ms...`)
        if (i === retries - 1) {
          throw new Error(`Gemini API HTTP ${res.status}: Max retries exceeded for ${modelLabel}`)
        }
        await new Promise(resolve => setTimeout(resolve, delay))
        delay *= 2
        continue
      }
      return res
    } catch (err: any) {
      if (i === retries - 1) throw err
      console.warn(`[${new Date().toISOString()}] [Gemini API] Fetch attempt ${i + 1} failed for ${modelLabel}. Retrying in ${delay}ms...`, err)
      await new Promise(resolve => setTimeout(resolve, delay))
      delay *= 2
    }
  }
  throw new Error('Max retries exceeded')
}

// Helper: Lenient parser to extract cited chunk IDs
function extractCitedChunkIds(answer: string, chunks: any[]): string[] {
  // If it's a fallback answer, return no citations
  const isFallbackEn = answer.toLowerCase().includes("couldn't find an answer") || 
                       answer.toLowerCase().includes("could not find")
  const isFallbackAr = answer.includes("لم أجد إجابة") || 
                       answer.includes("لم أجد")
  if (isFallbackEn || isFallbackAr) {
    return []
  }

  const citedIds = new Set<string>()
  
  // Find all content inside square brackets, e.g. [mersal-spec.pdf, p.3] or [mersal-spec.pdf, ص.3]
  const bracketMatches = answer.match(/\[([^\]]+)\]/g) || []
  
  const cleanStr = (s: string) => s.replace(/[\s\-\_\.]/g, '').toLowerCase()

  for (const match of bracketMatches) {
    // Extract the text inside brackets
    const content = match.slice(1, -1).trim()
    
    // Extract page number: look for digits after "p", "page", or "ص"
    const pageMatch = content.match(/(?:p|page|ص)[\s\.]*(\d+)/i)
    if (!pageMatch) continue
    
    const citedPage = parseInt(pageMatch[1], 10)
    
    // Extract filename portion (everything before the page marker or comma)
    const filePart = content.split(/,|(?:p|page|ص)/i)[0].trim()
    const normFilePart = cleanStr(filePart)

    // Find if any chunk matches the filename and page number
    for (const chunk of chunks) {
      const chunkFilename = chunk.filename || ''
      const chunkFilenameNoExt = chunkFilename.replace(/\.[^/.]+$/, "")
      
      const matchFilename = cleanStr(chunkFilename) === normFilePart || 
                            cleanStr(chunkFilenameNoExt) === normFilePart ||
                            normFilePart.includes(cleanStr(chunkFilenameNoExt)) ||
                            cleanStr(chunkFilenameNoExt).includes(normFilePart)

      if (matchFilename && chunk.page_number === citedPage) {
        citedIds.add(chunk.id)
      }
    }
  }

  // Fallback: If no citations matched, but it is a non-fallback answer, return all retrieved chunk IDs
  if (citedIds.size === 0 && chunks.length > 0) {
    return chunks.map(c => c.id)
  }

  return Array.from(citedIds)
}

export default app
