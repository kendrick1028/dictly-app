// "Notion으로 내보내기" for studio items — status check → markdown → main-process Notion API,
// with the toasts the user sees (not connected → jump to 설정; success → "Notion에서 열기").
import { toast } from './toastStore'
import { useStore } from '../store/useStore'
import { stripCiteTokens } from './citations'
import { studioKindLabel } from './studioParse'
import { STUDIO_KIND_EMOJI, studioItemToMarkdown } from './studioMarkdown'
import type { StudioItem } from '../../../shared/types'

export async function exportStudioToNotion(item: StudioItem): Promise<{ url: string } | null> {
  const st = await window.api.notion.status()
  if (!st.tokenSet || !st.parent) {
    toast.warning(!st.tokenSet ? 'Notion이 연결되어 있지 않아요' : '내보낼 Notion 페이지를 먼저 선택하세요', {
      action: '설정 열기',
      onAction: () => useStore.getState().setSettingsOpen(true),
      duration: 6000
    })
    return null
  }
  const title = stripCiteTokens(item.title).trim() || studioKindLabel(item.kind)
  const when = new Date(item.createdAt).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
  const res = await window.api.notion.exportPage({
    title,
    markdown: studioItemToMarkdown(item),
    icon: STUDIO_KIND_EMOJI[item.kind],
    subtitle: `Dictly 스튜디오 · ${studioKindLabel(item.kind)} · 소스 ${item.sources.sourceCount}개 · ${when}`
  })
  toast.success(`Notion "${st.parent.title}"에 내보냈어요`, {
    action: 'Notion에서 열기',
    onAction: () => void window.api.shell.openExternal(res.url),
    duration: 9000
  })
  return res
}
