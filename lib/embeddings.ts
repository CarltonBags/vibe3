import { OpenAI } from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY })

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []
  // text-embedding-3-small => 1536 dims
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: texts
  })
  return res.data.map(d => d.embedding as unknown as number[])
}

// Heuristic code-aware chunking with small overlaps
export function chunkContent(content: string, maxChars = 1500, overlap = 150): string[] {
  const chunks: string[] = []
  let start = 0
  while (start < content.length) {
    const end = Math.min(start + maxChars, content.length)
    chunks.push(content.slice(start, end))
    if (end >= content.length) break
    start = Math.max(0, end - overlap)
  }
  return chunks
}

export function codeAwareChunks(filePath: string, content: string, maxChars = 1600, overlap = 160): string[] {
  const isTSX = /\.(tsx|jsx)$/i.test(filePath)
  const isTS = /\.(ts|js)$/i.test(filePath)
  const isCSS = /\.(css|scss|sass)$/i.test(filePath)
  const isJSON = /\.json$/i.test(filePath)
  const isMD = /\.(md|mdx)$/i.test(filePath)
  const isImage = /\.(png|jpg|jpeg|gif|svg|webp|ico)$/i.test(filePath)

  // Image files: create semantic metadata chunk
  if (isImage) {
    const fileName = filePath.split('/').pop() || filePath
    const fileType = fileName.split('.').pop()?.toUpperCase() || 'IMAGE'
    // Create a rich metadata chunk that will be searchable
    const metadata = `[IMAGE FILE] ${fileType} image file: ${fileName}\nLocated at: ${filePath}\nThis is an image asset used in the project, possibly as a logo, background, icon, or featured image.`
    return [metadata]
  }

  // Non-code files: paragraph/object based splits + fallback
  if (isMD) {
    const paras = content.split(/\n{2,}/)
    return stitchChunks(paras, maxChars, overlap)
  }
  if (isJSON) {
    // Try to split by top-level braces/commas roughly
    const parts = content.split(/\n(?=\s*[,\}\]])/)
    return stitchChunks(parts, maxChars, overlap)
  }
  if (isCSS) {
    const rules = content.split(/\n(?=\s*[^@]*\{)|\}/)
    return stitchChunks(rules, maxChars, overlap)
  }

  if (isTSX || isTS) {
    // Split by import block, then by top-level declarations
    const segments: string[] = []
    const lines = content.split(/\n/)
    let buffer: string[] = []
    const pushBuffer = () => { if (buffer.length) { segments.push(buffer.join('\n')); buffer = [] } }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      // boundaries: export function/class, component decls, default export block
      const boundary = /^(export\s+(default\s+)?(function|class)|export\s+\{|const\s+\w+\s*=\s*\(|function\s+\w+\s*\(|class\s+\w+\s*)/.test(line)
      const importLine = /^import\s+/.test(line)
      if (importLine && buffer.length) {
        // end previous and start new to keep import groups intact
        pushBuffer();
        buffer.push(line)
      } else if (boundary && buffer.length > 0) {
        pushBuffer();
        buffer.push(line)
      } else {
        buffer.push(line)
      }
    }
    pushBuffer()
    // Stitch segments to size with overlap
    return stitchChunks(segments, maxChars, overlap)
  }

  // Fallback
  return chunkContent(content, maxChars, overlap)
}

function stitchChunks(units: string[], maxChars: number, overlap: number): string[] {
  const out: string[] = []
  let current = ''
  for (const u of units) {
    const add = (u.endsWith('\n') ? u : u + '\n')
    if ((current + add).length > maxChars && current.length > 0) {
      out.push(current)
      const tail = current.slice(Math.max(0, current.length - overlap))
      current = tail + add
    } else {
      current += add
    }
  }
  if (current.trim().length) out.push(current)
  return out
}


