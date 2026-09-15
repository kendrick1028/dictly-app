"""Whisper 무음/노이즈 환각 문구 필터.

Whisper 는 유튜브 자막으로 학습된 탓에 무음·잡음 구간에서 "감사합니다", "시청해주셔서 감사합니다",
"구독과 좋아요 부탁드립니다" 같은 자막 마무리 문구를 지어낸다. 강사가 말을 멈춘 구간에서 이런
세그먼트가 뜨면 전사문을 오염시키므로, 문구 전체가 알려진 환각이면 통째로 버린다.

렌더러(src/shared/hallucination.ts)에도 같은 규칙이 있다 — 두 파일을 함께 수정할 것.
"""
import re

# 공백·문장부호·기호 제거 → 비교용 정규형
_STRIP = re.compile(r"[\s\.\,\!\?\~\…\·\'\"\`\-\_\(\)\[\]\{\}:;♪♬♫★☆]+")

# 정규형이 이 집합과 정확히 일치하면 환각 (짧은 마무리 인사 계열)
_EXACT = {
    "감사합니다", "고맙습니다", "감사합니다고맙습니다",
    "수고하셨습니다", "수고하세요", "안녕히계세요", "안녕히가세요",
    "다음영상에서만나요", "다음에또만나요", "다음시간에만나요",
    "자막제공", "한글자막", "자막", "음악", "박수", "웃음",
    "thankyou", "thanks", "thankyouverymuch", "byebye", "bye",
    "yourewelcome", "youarewelcome", "subscribe", "pleasesubscribe",
}
# 정규형이 이 부분 문자열을 포함하면 환각 (유튜브 자막 마무리 멘트)
_CONTAINS = (
    "시청해주셔서", "시청해주세요", "시청해줘서", "시청해주신", "봐주셔서감사",
    "구독과좋아요", "구독좋아요", "좋아요와구독", "좋아요구독", "구독버튼", "알림설정",
    "자막제공", "한글자막", "자막by", "자막번역", "번역by",
    "다음영상에서", "다음영상도", "영상끝까지",
    "thanksforwatching", "thankyouforwatching", "thankyousomuchforwatching",
    "likeandsubscribe", "subscribetomychannel", "seeyouinthenextvideo",
)
# "MBC 뉴스 ○○○입니다" 류 뉴스 사인오프
_NEWS = re.compile(r"(mbc|kbs|sbs|jtbc|ytn|mbn|tvn|연합뉴스|뉴스)[가-힣a-z0-9]{0,8}(입니다|였습니다)$")
# 마무리 인사만 반복 ("감사합니다 감사합니다 감사합니다")
_REPEAT = re.compile(r"^(감사합니다|고맙습니다|감사|thankyou|thanks)+$")
# 비발화 태그 "[음악]", "(박수)", "[BLANK_AUDIO]"
_TAG = re.compile(r"^\s*[\[\(【<]\s*[a-z가-힣_ ]{1,16}\s*[\]\)】>]\s*$", re.I)


def normalize(text):
    return _STRIP.sub("", (text or "")).lower()


def is_hallucination(text):
    """True 면 세그먼트 전체를 버린다."""
    raw = (text or "").strip()
    if not raw:
        return False
    if _TAG.match(raw):
        return True
    n = normalize(raw)
    if not n:
        return True  # 기호만 남은 세그먼트
    if n in _EXACT or _REPEAT.match(n) or _NEWS.search(n):
        return True
    return any(m in n for m in _CONTAINS)
