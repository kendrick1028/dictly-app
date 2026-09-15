// Whisper silence/noise hallucination filter — renderer-side twin of python/hallucination.py.
// Whisper was trained on YouTube captions, so on silence it invents caption sign-offs
// ("감사합니다", "시청해주셔서 감사합니다", "구독과 좋아요…"). A chunk that is ENTIRELY such a phrase
// is dropped before it reaches the transcript. Keep the rule sets in sync with the Python file.

const STRIP = /[\s.,!?~…·'"`\-_()[\]{}:;♪♬♫★☆]+/g

const EXACT = new Set([
  '감사합니다', '고맙습니다', '감사합니다고맙습니다',
  '수고하셨습니다', '수고하세요', '안녕히계세요', '안녕히가세요',
  '다음영상에서만나요', '다음에또만나요', '다음시간에만나요',
  '자막제공', '한글자막', '자막', '음악', '박수', '웃음',
  'thankyou', 'thanks', 'thankyouverymuch', 'byebye', 'bye',
  'yourewelcome', 'youarewelcome', 'subscribe', 'pleasesubscribe'
])
const CONTAINS = [
  '시청해주셔서', '시청해주세요', '시청해줘서', '시청해주신', '봐주셔서감사',
  '구독과좋아요', '구독좋아요', '좋아요와구독', '좋아요구독', '구독버튼', '알림설정',
  '자막제공', '한글자막', '자막by', '자막번역', '번역by',
  '다음영상에서', '다음영상도', '영상끝까지',
  'thanksforwatching', 'thankyouforwatching', 'thankyousomuchforwatching',
  'likeandsubscribe', 'subscribetomychannel', 'seeyouinthenextvideo'
]
const NEWS = /(mbc|kbs|sbs|jtbc|ytn|mbn|tvn|연합뉴스|뉴스)[가-힣a-z0-9]{0,8}(입니다|였습니다)$/
const REPEAT = /^(감사합니다|고맙습니다|감사|thankyou|thanks)+$/
const TAG = /^\s*[[(【<]\s*[a-z가-힣_ ]{1,16}\s*[\])】>]\s*$/i

export function normalizeForHallucination(text: string): string {
  return (text || '').replace(STRIP, '').toLowerCase()
}

/** true → the whole chunk is a known silence hallucination and must be dropped */
export function isWhisperHallucination(text: string): boolean {
  const raw = (text || '').trim()
  if (!raw) return false
  if (TAG.test(raw)) return true
  const n = normalizeForHallucination(raw)
  if (!n) return true // symbols only
  if (EXACT.has(n) || REPEAT.test(n) || NEWS.test(n)) return true
  return CONTAINS.some((m) => n.includes(m))
}
