-- Migration: 0001_schema.sql
-- Create initial schema for Mersal D1 Metadata Database

-- 1. Documents Table
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    language TEXT, -- Nullable during processing
    page_count INTEGER, -- Nullable during processing
    status TEXT NOT NULL CHECK(status IN ('processing', 'ready', 'failed')),
    character_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT, -- Nullable, set on failure
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_documents_session_id ON documents(session_id);

-- 2. Chunks Table
CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    text TEXT NOT NULL,
    page_number INTEGER NOT NULL,
    vectorize_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON chunks(document_id);

-- 3. Messages Table (Chat History)
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    cited_chunk_ids TEXT NOT NULL, -- JSON array of chunk IDs (e.g. '["id1", "id2"]')
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);

-- 4. Eval Runs Table
CREATE TABLE IF NOT EXISTS eval_runs (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    total INTEGER NOT NULL,
    correct INTEGER NOT NULL,
    faithfulness_score REAL NOT NULL
);

-- 5. Eval Cases Table
CREATE TABLE IF NOT EXISTS eval_cases (
    id TEXT PRIMARY KEY,
    question TEXT NOT NULL,
    expected_answer TEXT NOT NULL,
    language TEXT NOT NULL,
    last_result TEXT, -- e.g. JSON string representing the judge output
    last_score REAL -- faithfulness score or binary correctness
);
