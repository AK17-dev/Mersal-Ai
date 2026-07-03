export interface ChunkResult {
  text: string
  page_number: number
  chunk_index: number
}

/**
 * Splits document pages into semantic chunks.
 * Grouping is done page-by-page so that page number tracking for citations remains 100% precise.
 * 
 * Approximate sizing assumes:
 * - 1 token ≈ 0.75 words.
 * - Chunk size: ~500 tokens ≈ 375 words.
 * - Overlap size: ~50 tokens ≈ 38 words.
 */
export function chunkDocument(pages: string[]): ChunkResult[] {
  const chunks: ChunkResult[] = []
  let chunkIndex = 0

  const CHUNK_SIZE_WORDS = 375
  const OVERLAP_SIZE_WORDS = 38

  pages.forEach((pageText, idx) => {
    const pageNum = idx + 1
    if (!pageText) return
    
    const trimmedText = pageText.trim()
    if (trimmedText.length === 0) return

    // Split page text by whitespace into words
    const words = trimmedText.split(/\s+/)

    if (words.length <= CHUNK_SIZE_WORDS) {
      chunks.push({
        text: trimmedText,
        page_number: pageNum,
        chunk_index: chunkIndex++
      })
    } else {
      let start = 0
      while (start < words.length) {
        const end = Math.min(start + CHUNK_SIZE_WORDS, words.length)
        const chunkWords = words.slice(start, end)
        
        chunks.push({
          text: chunkWords.join(' '),
          page_number: pageNum,
          chunk_index: chunkIndex++
        })

        if (end === words.length) {
          break
        }

        // Advance start index by chunk size minus overlap size
        start += (CHUNK_SIZE_WORDS - OVERLAP_SIZE_WORDS)
      }
    }
  })

  return chunks
}
