// Notion export — official REST API with an internal-integration token (설정 → Notion 연결).
// The token + chosen destination live in the settings table; values never reach the renderer
// except "is a token saved" and the destination's title/id. Notion's hosted MCP server is an
// agent-facing OAuth surface, so for a deterministic app-level "내보내기" the REST API is the fit.
import * as db from './db'
import { markdownToBlocks, type NotionBlock } from './notionMarkdown'
import type { NotionExportPayload, NotionStatus, NotionTarget } from '../shared/types'

const API = 'https://api.notion.com/v1'
const VERSION = '2022-06-28'
const K_TOKEN = 'notionToken'
const K_WS = 'notionWorkspace'
const K_BOT = 'notionBot'
const K_PARENT = 'notionParent'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function friendly(status: number, json: { code?: string; message?: string }): string {
  const code = json?.code
  const msg = json?.message ?? ''
  if (status === 401) return 'Notion 토큰이 올바르지 않아요. 설정 → Notion 연결에서 토큰을 다시 저장하세요.'
  if (status === 404 || code === 'object_not_found') return '페이지를 찾을 수 없어요. Notion에서 그 페이지의 ··· → 연결 → 통합을 추가했는지 확인하세요.'
  if (status === 403 || code === 'restricted_resource') return '이 페이지에 쓸 권한이 없어요. 통합 설정에서 "콘텐츠 삽입" 권한을 켜세요.'
  return `Notion ${status}${code ? ` ${code}` : ''}: ${msg}`.slice(0, 300)
}

async function call<T = Record<string, unknown>>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown, tokenOverride?: string): Promise<T> {
  const token = tokenOverride ?? db.getSetting(K_TOKEN)
  if (!token) throw new Error('Notion이 연결되어 있지 않아요. 설정 → Notion 연결에서 토큰을 저장하세요.')
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(API + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Notion-Version': VERSION, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    if (r.status === 429 && attempt < 3) {
      // 3 req/s average — back off per Retry-After
      await sleep((Number(r.headers.get('retry-after')) || attempt + 1) * 1000)
      continue
    }
    const json = (await r.json().catch(() => ({}))) as T & { code?: string; message?: string }
    if (!r.ok) throw new Error(friendly(r.status, json))
    return json
  }
}

function savedParent(): NotionTarget | null {
  try {
    const raw = db.getSetting(K_PARENT)
    return raw ? (JSON.parse(raw) as NotionTarget) : null
  } catch {
    return null
  }
}

export function notionStatus(): NotionStatus {
  return { tokenSet: !!db.getSetting(K_TOKEN), workspace: db.getSetting(K_WS) || null, botName: db.getSetting(K_BOT) || null, parent: savedParent() }
}

/** validate the token against /users/me, then persist it with the workspace/bot name */
export async function notionSetToken(token: string): Promise<NotionStatus> {
  const t = (token || '').trim()
  if (!t) throw new Error('토큰을 입력하세요')
  const me = await call<{ name?: string; bot?: { workspace_name?: string } }>('GET', '/users/me', undefined, t)
  db.setSetting(K_TOKEN, t)
  db.setSetting(K_WS, me.bot?.workspace_name || '')
  db.setSetting(K_BOT, me.name || '')
  return notionStatus()
}

export function notionClear(): void {
  for (const k of [K_TOKEN, K_WS, K_BOT, K_PARENT]) db.setSetting(k, '')
}

export function notionSetParent(t: NotionTarget | null): NotionStatus {
  db.setSetting(K_PARENT, t ? JSON.stringify(t) : '')
  return notionStatus()
}

type SearchResult = {
  object: 'page' | 'database'
  id: string
  url?: string
  archived?: boolean
  in_trash?: boolean
  icon?: { type: string; emoji?: string } | null
  title?: { plain_text: string }[]
  properties?: Record<string, { type: string; title?: { plain_text: string }[] }>
}

function titleOf(o: SearchResult): string {
  if (o.object === 'database') return (o.title ?? []).map((t) => t.plain_text).join('') || '(제목 없음)'
  const tp = Object.values(o.properties ?? {}).find((p) => p?.type === 'title')
  return (tp?.title ?? []).map((t) => t.plain_text).join('') || '(제목 없음)'
}

/** pages + databases the integration can see (= those the user shared with it) */
export async function notionSearch(query: string): Promise<NotionTarget[]> {
  const res = await call<{ results: SearchResult[] }>('POST', '/search', {
    query: (query || '').trim(),
    page_size: 25,
    sort: { direction: 'descending', timestamp: 'last_edited_time' }
  })
  return (res.results ?? [])
    .filter((o) => (o.object === 'page' || o.object === 'database') && !o.archived && !o.in_trash)
    .map((o) => ({ id: o.id, title: titleOf(o), type: o.object, icon: o.icon?.type === 'emoji' ? (o.icon.emoji ?? null) : null, url: o.url ?? null }))
}

/** create a page under the chosen destination from markdown; returns the new page url */
export async function notionExport(p: NotionExportPayload): Promise<{ url: string; id: string }> {
  const parent = savedParent()
  if (!parent) throw new Error('내보낼 Notion 페이지를 먼저 선택하세요 (설정 → Notion 연결)')
  const title = (p.title || '스튜디오 메모').trim().slice(0, 2000)
  const blocks: NotionBlock[] = markdownToBlocks(p.markdown || '', { dropTitle: title })
  if (p.subtitle) {
    blocks.unshift({
      object: 'block',
      type: 'callout',
      callout: { rich_text: [{ type: 'text', text: { content: p.subtitle.slice(0, 2000) } }], icon: { type: 'emoji', emoji: '🎙️' }, color: 'gray_background' }
    })
  }
  const page = await call<{ id: string; url: string }>('POST', '/pages', {
    parent: parent.type === 'database' ? { database_id: parent.id } : { page_id: parent.id },
    ...(p.icon ? { icon: { type: 'emoji', emoji: p.icon } } : {}),
    // "title" is the id of every title property → works for page AND database parents
    properties: { title: { title: [{ type: 'text', text: { content: title } }] } },
    children: blocks.slice(0, 100)
  })
  // Notion caps children at 100 per request → append the rest in batches
  for (let i = 100; i < blocks.length; i += 100) {
    await call('PATCH', `/blocks/${page.id}/children`, { children: blocks.slice(i, i + 100) })
  }
  return { url: page.url, id: page.id }
}
