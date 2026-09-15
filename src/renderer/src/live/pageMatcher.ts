// Lexical page matcher — pure functions, no DOM, no store. Scores "which 교안 page is the lecturer
// on right now" from a transcript window against per-page text (text layer or OCR).
//
// Why character bigrams: Korean has no reliable whitespace tokenization (particles glue onto
// nouns, spacing is inconsistent, STT drops/merges syllables), and lecturers read slide terms
// nearly verbatim. Hangul character bigrams are robust to all of that; Latin/digit runs (variable
// names, formulas, acronyms) are kept as whole tokens. IDF over the PDF's own pages makes
// page-specific terms count and boilerplate (헤더/푸터/과목명) count for nothing.

export interface PageIndex {
  /** sparse per-page vectors (gram → idf-weighted saturated tf), L2-normalized. null = empty page */
  vectors: (Map<string, number> | null)[]
  /** gram → idf over this PDF */
  idf: Map<string, number>
  pageCount: number
}

const PUNCT = /[^\p{L}\p{N}\s]/gu

/** normalize + tokenize into scoring grams (Hangul char bigrams + Latin/digit tokens) */
export function tokenize(text: string): string[] {
  const s = (text || '').normalize('NFKC').toLowerCase().replace(PUNCT, ' ')
  const grams: string[] = []
  for (const tok of s.split(/\s+/)) {
    if (!tok) continue
    // split the token into Hangul runs and non-Hangul runs
    const runs = tok.match(/[가-힣]+|[^가-힣]+/g) ?? []
    for (const run of runs) {
      if (/^[가-힣]/.test(run)) {
        if (run.length === 1) grams.push(run)
        for (let i = 0; i + 1 < run.length; i++) grams.push(run.slice(i, i + 2))
      } else if (run.length >= 2 || /\d/.test(run)) {
        grams.push(run)
      }
    }
  }
  return grams
}

function termFreq(grams: string[]): Map<string, number> {
  const tf = new Map<string, number>()
  for (const g of grams) tf.set(g, (tf.get(g) ?? 0) + 1)
  return tf
}

/** build the per-PDF index once (pages array is 0-based: pages[i] = page i+1) */
export function buildPageIndex(pages: string[]): PageIndex {
  const tfs = pages.map((p) => {
    const tf = termFreq(tokenize(p))
    return tf.size ? tf : null
  })
  const df = new Map<string, number>()
  for (const tf of tfs) if (tf) for (const g of tf.keys()) df.set(g, (df.get(g) ?? 0) + 1)
  const n = tfs.filter(Boolean).length
  const idf = new Map<string, number>()
  for (const [g, d] of df) idf.set(g, Math.log((n + 1) / (d + 0.5)))
  const vectors = tfs.map((tf) => {
    if (!tf) return null
    const v = new Map<string, number>()
    let norm = 0
    for (const [g, c] of tf) {
      const w = (c / (c + 1)) * (idf.get(g) ?? 0)
      if (w > 0) {
        v.set(g, w)
        norm += w * w
      }
    }
    if (!norm) return null
    norm = Math.sqrt(norm)
    for (const [g, w] of v) v.set(g, w / norm)
    return v
  })
  return { vectors, idf, pageCount: pages.length }
}

/** query vector in the index's idf space (L2-normalized); null when the query carries no signal.
 *  Accepts several chunks with recency weights (newest last) so the window leans toward what the
 *  lecturer is saying NOW while older chunks still disambiguate. */
export function queryVector(
  index: PageIndex,
  chunks: string | string[],
  weights?: number[]
): { vec: Map<string, number>; signal: number } | null {
  const list = Array.isArray(chunks) ? chunks : [chunks]
  const tf = new Map<string, number>()
  list.forEach((c, i) => {
    const w = weights?.[i] ?? 1
    for (const g of tokenize(c)) tf.set(g, (tf.get(g) ?? 0) + w)
  })
  if (!tf.size) return null
  const v = new Map<string, number>()
  let norm = 0
  let signal = 0 // total idf mass of grams the PDF knows — how "specific" this query is
  for (const [g, c] of tf) {
    const idf = index.idf.get(g)
    if (!idf) continue
    const w = (c / (c + 1)) * idf
    v.set(g, w)
    norm += w * w
    signal += idf
  }
  if (!norm) return null
  norm = Math.sqrt(norm)
  for (const [g, w] of v) v.set(g, w / norm)
  return { vec: v, signal }
}

/** cosine over sparse maps */
export function sparseCosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0
  const [small, big] = a.size <= b.size ? [a, b] : [b, a]
  for (const [g, w] of small) {
    const x = big.get(g)
    if (x) dot += w * x
  }
  return dot
}

/** raw lexical score per page (1-based page → [0,1]); pages outside `candidates` are skipped */
export function lexicalScores(index: PageIndex, q: Map<string, number>, candidates: Iterable<number>): Map<number, number> {
  const out = new Map<number, number>()
  for (const p of candidates) {
    const v = index.vectors[p - 1]
    out.set(p, v ? sparseCosine(q, v) : 0)
  }
  return out
}

/** dense cosine for embedding vectors (both already L2-normalized by the embedder) */
export function denseCosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length)
  let dot = 0
  for (let i = 0; i < n; i++) dot += a[i] * b[i]
  return dot
}

/** e5-style cosines cluster in a narrow band (~0.75–0.95 for same-domain pages), so an absolute
 *  rescale barely separates candidates. Center on the candidates' mean instead: +0.1 over the mean
 *  → 1.0, at the mean → 0.5, −0.1 → 0.0 (measured on real 교안 decks). */
export const EMBED_DECISIVE_MARGIN = 0.02
export function embedScoresFromCosines(cos: Map<number, number>): Map<number, number> {
  const out = new Map<number, number>()
  if (cos.size < 2) return out
  // decisiveness gate: a paraphrase gives near-identical cosines for several pages (measured:
  // 0.857 vs 0.850) — that is noise, not evidence. Only a clear leader contributes.
  const sorted = [...cos.values()].sort((a, b) => b - a)
  if (sorted[0] - sorted[1] < EMBED_DECISIVE_MARGIN) return out
  let mean = 0
  for (const c of cos.values()) mean += c
  mean /= cos.size
  for (const [p, c] of cos) out.set(p, Math.max(0, Math.min(1, 0.5 + ((c - mean) / 0.1) * 0.5)))
  return out
}

/** blend lexical + embedding scores (each [0,1]); pages missing an embedding score fall back to lexical */
export function blendScores(lex: Map<number, number>, emb: Map<number, number> | null, wEmb = 0.5): Map<number, number> {
  if (!emb) return lex
  const out = new Map<number, number>()
  for (const [p, l] of lex) {
    const e = emb.get(p)
    out.set(p, e == null ? l : (1 - wEmb) * l + wEmb * e)
  }
  return out
}
