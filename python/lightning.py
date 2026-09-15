"""Whisper Live — 실시간 로컬 스트리밍 전사 엔진 (macOS / MLX).

iOS Dictly 의 Lightning 엔진(CoreML 인코더 + MLX 디코더 + AlignAtt 게이팅)을 mlx_whisper(MIT) 위에
그대로 이식한 것. 튜닝값(M5 까지 실기기에서 검증된 값)은 iOS `LightningEngine.swift` 와 1:1 로 맞춘다.

동작 원리
  * 오디오 스레드(웹소켓 수신 루프)는 적응형 RMS VAD 로 발화 버퍼만 갱신한다 (락, 추론 없음).
  * 스테퍼 스레드 하나만 추론한다 — 주기마다 진행 중 발화 전체를 인코딩하고, AlignAtt 게이트로
    "오디오 증거가 충분한" 토큰만 확정(volatile)해 흘려보낸다. 발화가 닫히면 게이트 없는 최종 디코드가
    final 세그먼트로 나간다 (직전 텍스트 <|startofprev|> 조건화 + 반복/압축비 불량 시 온도 폴백 체인).
  * 스텝이 느리면 큐잉 없이 코얼레스한다 (다음 스텝이 누적 오디오 전체를 본다).

콜백 `emit(dict)` 는 스테퍼/오디오 스레드에서 호출되므로 호출자가 스레드 안전하게 만들어야 한다.
"""
import threading
import time
import zlib
from collections import deque

import numpy as np
import mlx.core as mx
from mlx_whisper import audio as wa
from mlx_whisper.tokenizer import get_tokenizer

from hallucination import is_hallucination

SR = 16000
MIN_SEG_SEC = 0.4
PREROLL_SEC = 0.5
SOFT_CLOSE_SEC = 22.0      # 이 길이부터 호흡(RMS 최저점)에서 분할
HARD_CLOSE_SEC = 28.0      # 안전 상한 (30s 창 내 게이트 여유)
HOLD_FRAMES = 4            # AlignAtt f
STEP_TOKEN_CAP = 64
FINAL_TOKEN_CAP = 320      # 22s 한국어 강의 밀도 대응
FIRST_COMMIT_SEC = 1.6     # 첫 확정 전 최소 오디오 — 초입 환각 억제
PREV_CONTEXT_CAP = 80      # <|startofprev|> 조건화 토큰 수 상한
BASE_PERIOD_SEC = 1.2      # 스텝 주기 바닥값 (M 시리즈 GPU 인코더 ≈ 0.9s)
SLOW_PERIOD_SEC = 1.8      # 만성 지연 시 완화값
NO_SPEECH_GATE = 0.6
# openai/whisper(MIT) 공개 상수 — large-v3-turbo 정렬 헤드 (layer, head)
ALIGN_HEADS = [(2, 4), (2, 11), (3, 3), (3, 6), (3, 11), (3, 14)]

_FFFD = "�"


def repetition_period(tokens, min_repeats=3):
    """꼬리가 주기 1~8 의 반복인지 — 반복 단위 길이를 돌려준다 ("연결납세로"=3토큰 같은 임의 주기 대응)."""
    n = len(tokens)
    for period in range(1, 9):
        if n < period * min_repeats:
            continue
        tail = tokens[n - period * min_repeats:]
        unit = tail[:period]
        if all(tail[r * period:(r + 1) * period] == unit for r in range(1, min_repeats)):
            return period
    return None


def compression_ratio(text):
    """zlib 압축비 — 2.4 초과면 반복/환각 텍스트로 본다 (whisper 표준 판정)."""
    data = text.encode("utf-8")
    if len(data) <= 40:
        return 1.0
    comp = zlib.compress(data)
    return len(data) / max(1, len(comp))


def _trim_fffd(text):
    text = text.strip()
    while text.endswith(_FFFD):
        text = text[:-1].strip()
    return text


class LightningSession:
    def __init__(self, model, language, silence_sec, emit, log=None):
        """
        model:       mlx_whisper Whisper 인스턴스 (fp16, large-v3-turbo 계열)
        language:    'ko' | 'en' | … | 'auto' (발화마다 감지)
        silence_sec: 발화를 닫는 무음 길이
        emit:        {"type": "partial"|"segment", ...} 를 받는 스레드 안전 콜백
        """
        self.model = model
        self.emit = emit
        self.log = log or (lambda *_: None)
        self.silence_close = max(0.5, float(silence_sec))
        self.auto_lang = language in ("", None, "auto")
        self.language = "ko" if self.auto_lang else language

        tok = get_tokenizer(model.is_multilingual, num_languages=model.num_languages,
                            language=self.language, task="transcribe")
        self.tok = tok
        self.sot, self.eot, self.sop = tok.sot, tok.eot, tok.sot_prev
        self.nospeech, self.no_ts, self.transcribe_tok = tok.no_speech, tok.no_timestamps, tok.transcribe
        self.special_begin = tok.eot           # eot 이상은 전부 특수 토큰 (eot 자신만 허용)
        self.lang_tokens = list(tok.all_language_tokens)
        self.lang_token = None if self.auto_lang else tok.to_language_token(self.language)
        self.n_ctx = model.dims.n_text_ctx
        self.n_mels = model.dims.n_mels
        V = model.dims.n_vocab
        sup = np.zeros(V, dtype=np.float32)
        sup[self.special_begin:] = -1e9
        sup[self.eot] = 0.0
        sup[list(tok.non_speech_tokens)] = -1e9   # ♪, (, [ 등 비발화 표기 억제 (whisper 표준)
        first = np.zeros(V, dtype=np.float32)
        first[tok.encoding.encode(" ")[0]] = -1e9
        first[self.eot] = -1e9
        self.suppress = mx.array(sup)
        self.first_suppress = mx.array(first)
        mx.eval(self.suppress, self.first_suppress)

        # ---- 오디오 상태 (락) ----
        self.lock = threading.Lock()
        self.preroll = np.zeros(0, dtype=np.float32)
        self.active = []
        self.active_n = 0
        self.active_start = 0        # active[0] 의 전역 샘플 오프셋
        self.in_utt = False
        self.silent_sec = 0.0
        self.noise_floor = 0.002
        self.closed = deque()        # (audio, start_sample)
        self.rms_track = []          # (active 기준 누적 샘플 수, rms)
        self.utt_gen = 0
        self.finished = False
        self.sample_offset = 0

        # ---- 스테퍼 상태 (스테퍼 스레드만) ----
        self.confirmed = []
        self.confirmed_gen = 0
        self.last_stepped = 0
        self.prev_context = []
        self.utt_lang = None
        self.step_period = BASE_PERIOD_SEC
        self.step_times = deque(maxlen=3)
        self.stats = {"steps": 0, "holds": 0, "enc_ms": 0.0, "dec_ms": 0.0, "finals": 0}
        self._thread = threading.Thread(target=self._run, name="whisper-live", daemon=True)
        self._thread.start()

    # ------------------------------------------------------------------ audio / VAD

    def feed(self, arr):
        if self.finished or len(arr) == 0:
            return
        n = len(arr)
        dur = n / SR
        rms = float(np.sqrt(np.mean(arr * arr)))
        with self.lock:
            self.sample_offset += n
            speech_thresh = max(0.0035, self.noise_floor * 2.5)
            silence_thresh = speech_thresh * 0.8
            if not self.in_utt:
                self.noise_floor = min(0.01, max(0.0015, self.noise_floor * 0.97 + rms * 0.03))
                self.preroll = np.concatenate([self.preroll, arr])[-int(PREROLL_SEC * SR):]
                if rms >= speech_thresh:
                    self.in_utt = True
                    self.silent_sec = 0.0
                    self.active = [self.preroll]
                    self.active_n = len(self.preroll)
                    self.active_start = self.sample_offset - self.active_n
                    self.preroll = np.zeros(0, dtype=np.float32)
                    self.rms_track = []
                return
            self.active.append(arr)
            self.active_n += n
            self.rms_track.append((self.active_n, rms))
            self.silent_sec = self.silent_sec + dur if rms < silence_thresh else 0.0
            utter = self.active_n / SR
            if self.silent_sec >= self.silence_close or utter >= HARD_CLOSE_SEC:
                self._close_locked()
            elif utter >= SOFT_CLOSE_SEC:
                self._soft_split_locked()

    def _soft_split_locked(self):
        """긴 발화를 최근 4초 중 가장 조용한 지점(호흡)에서 자르고 나머지는 다음 발화로 이월."""
        floor = self.active_n - int(4 * SR)
        cands = [c for c in self.rms_track if c[0] > floor]
        if not cands:
            self._close_locked()
            return
        split_at = min(cands, key=lambda c: c[1])[0]
        buf = np.concatenate(self.active)
        head, tail = buf[:split_at], buf[split_at:]
        head_start = self.active_start
        self.active = [tail]
        self.active_n = len(tail)
        self.active_start += split_at
        self.rms_track = [(c - split_at, r) for c, r in self.rms_track if c > split_at]
        self.silent_sec = 0.0
        self.utt_gen += 1
        if len(head) / SR >= MIN_SEG_SEC:
            self.closed.append((head, head_start))

    def _close_locked(self):
        seg = np.concatenate(self.active) if self.active else np.zeros(0, dtype=np.float32)
        start = self.active_start
        self.active = []
        self.active_n = 0
        self.rms_track = []
        self.in_utt = False
        self.silent_sec = 0.0
        self.utt_gen += 1
        if len(seg) / SR >= MIN_SEG_SEC:
            self.closed.append((seg, start))

    def flush(self):
        with self.lock:
            if self.in_utt:
                self._close_locked()

    def backlog(self):
        with self.lock:
            return len(self.closed) + (1 if self._finalizing else 0)

    def finish(self, timeout=90.0):
        """활성 발화를 닫고 finalize 큐가 빌 때까지 기다린다 (blocking)."""
        with self.lock:
            if self.in_utt:
                self._close_locked()
            self.finished = True
        self._thread.join(timeout)

    # ------------------------------------------------------------------ stepper

    _finalizing = False

    def _current_period(self):
        return max(BASE_PERIOD_SEC, self.step_period)

    def _run(self):
        try:
            while True:
                with self.lock:
                    seg = self.closed.popleft() if self.closed else None
                    if seg is not None:
                        self._finalizing = True
                if seg is not None:
                    try:
                        self._finalize(*seg)
                    finally:
                        self._finalizing = False
                    continue
                with self.lock:
                    if self.finished:
                        break
                    gen = self.utt_gen
                    active_n = self.active_n if self.in_utt else 0
                    snapshot = None
                if self.confirmed_gen != gen:
                    self.confirmed = []
                    self.last_stepped = 0
                    self.confirmed_gen = gen
                    self.utt_lang = None
                period = self._current_period()
                need = max(FIRST_COMMIT_SEC, period) if not self.confirmed else period
                if active_n and active_n - self.last_stepped >= int(need * SR):
                    with self.lock:
                        if self.in_utt and self.utt_gen == gen:
                            snapshot = np.concatenate(self.active)
                    if snapshot is not None:
                        self._volatile_step(snapshot, gen)
                        continue
                time.sleep(0.05)
        except Exception as e:  # noqa: BLE001
            self.log(f"live stepper crashed: {e!r}")
            self.emit({"type": "error", "message": f"실시간 엔진 오류: {e}"})

    # ------------------------------------------------------------------ model helpers

    def _encode(self, samples):
        capped = samples[-wa.N_SAMPLES:]
        padded = np.zeros(wa.N_SAMPLES, dtype=np.float32)
        padded[:len(capped)] = capped
        mel = wa.log_mel_spectrogram(padded, n_mels=self.n_mels)
        mel = wa.pad_or_trim(mel, wa.N_FRAMES, axis=-2).astype(mx.float16)
        states = self.model.encoder(mel[None])
        mx.eval(states)
        return states, len(capped)

    def _detect_language(self, states):
        logits, _, _ = self.model.decoder(mx.array([[self.sot]]), states, kv_cache=None)
        row = logits[0, 0].astype(mx.float32)
        mask = np.full(row.shape[-1], -1e9, dtype=np.float32)
        mask[self.lang_tokens] = 0.0
        return int(mx.argmax(row + mx.array(mask)).item())

    def _prompt_base(self):
        lang = self.lang_token if self.lang_token is not None else (self.utt_lang or self.tok.to_language_token("ko"))
        return [self.sot, lang, self.transcribe_tok, self.no_ts]

    def _context_prompt(self, extra):
        prefix = []
        if self.prev_context:
            prefix = [self.sop] + self.prev_context[-PREV_CONTEXT_CAP:]
        return prefix + self._prompt_base() + extra, len(prefix)

    def _alignment(self, cross_qk):
        rows = []
        for layer, head in ALIGN_HEADS:
            qk = cross_qk[layer]
            if qk is None:
                continue
            rows.append(mx.softmax(qk[0, head, -1].astype(mx.float32), axis=-1))
        return mx.mean(mx.stack(rows), axis=0) if rows else None

    def _gated_decode(self, states, prompt, first_extra, valid_frames, max_new, sot_index):
        logits, kv, _ = self.model.decoder(mx.array(prompt)[None], states, kv_cache=None)
        pre = logits[0].astype(mx.float32)
        nsp = float(mx.softmax(pre[sot_index], axis=-1)[self.nospeech].item())
        last = pre[-1]
        tokens, held, hit_eot = [], False, False
        bound = max(1, valid_frames - HOLD_FRAMES)
        for i in range(max_new):
            masked = last + self.suppress
            if i == 0 and first_extra:
                masked = masked + self.first_suppress
            nxt = int(mx.argmax(masked).item())
            if nxt == self.eot:
                hit_eot = True
                break
            logits, kv, cqk = self.model.decoder(mx.array([[nxt]]), states, kv_cache=kv)
            al = self._alignment(cqk)
            if al is not None:
                frame = int(mx.argmax(al[:valid_frames]).item())
                if frame >= bound:
                    held = True
                    break
            tokens.append(nxt)
            last = logits[0, -1].astype(mx.float32)
        return tokens, held, hit_eot, nsp

    def _greedy_decode(self, states, prompt, max_new, sot_index, temperature=0.0):
        logits, kv, _ = self.model.decoder(mx.array(prompt)[None], states, kv_cache=None)
        pre = logits[0].astype(mx.float32)
        nsp = float(mx.softmax(pre[sot_index], axis=-1)[self.nospeech].item())
        last = pre[-1]
        tokens = []
        for i in range(max_new):
            masked = last + self.suppress
            if i == 0:
                masked = masked + self.first_suppress
            if temperature > 0:
                probs = np.asarray(mx.softmax(masked / temperature, axis=-1), dtype=np.float64)
                probs = probs / probs.sum()
                nxt = int(np.random.choice(len(probs), p=probs))
            else:
                nxt = int(mx.argmax(masked).item())
            if nxt == self.eot:
                break
            tokens.append(nxt)
            logits, kv, _ = self.model.decoder(mx.array([[nxt]]), states, kv_cache=kv)
            last = logits[0, -1].astype(mx.float32)
            mx.eval(last)
        return tokens, nsp

    def _text_tokens(self, tokens):
        return [t for t in tokens if t < self.special_begin]

    # ------------------------------------------------------------------ steps

    def _volatile_step(self, samples, gen):
        t0 = time.time()
        states, n_capped = self._encode(samples)
        enc_ms = (time.time() - t0) * 1000
        t1 = time.time()
        if self.auto_lang and self.utt_lang is None:
            self.utt_lang = self._detect_language(states)
        valid = max(1, min(1500, int(n_capped / SR * 50)))
        prompt, sot_index = self._context_prompt(self.confirmed)
        tokens, held, _hit_eot, nsp = self._gated_decode(
            states, prompt, first_extra=not self.confirmed, valid_frames=valid,
            max_new=min(STEP_TOKEN_CAP, self.n_ctx - 8 - len(prompt)), sot_index=sot_index)
        dec_ms = (time.time() - t1) * 1000

        with self.lock:
            stale = self.utt_gen != gen
        if stale:
            return
        self.last_stepped = len(samples)
        self.stats["steps"] += 1
        self.stats["enc_ms"] += enc_ms
        self.stats["dec_ms"] += dec_ms
        if held:
            self.stats["holds"] += 1
        # 무음 게이트: 발화 초입에 nospeech 확률이 높으면 아무것도 확정하지 않는다
        if not self.confirmed and nsp > NO_SPEECH_GATE:
            return
        if tokens:
            self.confirmed.extend(tokens)
            runaway = repetition_period(self.confirmed) is not None
            if runaway or len(self.confirmed) > 200:
                with self.lock:
                    if self.in_utt and self.utt_gen == gen:
                        self._close_locked()
            text = _trim_fffd(self.tok.decode(self._text_tokens(self.confirmed)))
            if text and not is_hallucination(text):
                self.emit({"type": "partial", "text": text})
        # 만성 지연 시 바닥 주기 완화
        self.step_times.append(enc_ms + dec_ms)
        if len(self.step_times) == 3 and sum(self.step_times) / 3 > self.step_period * 800:
            self.step_period = SLOW_PERIOD_SEC

    def _finalize(self, segment, start):
        t0 = time.time()
        states, _ = self._encode(segment)
        if self.auto_lang:
            self.utt_lang = self._detect_language(states)

        def decode(with_ctx, temperature=0.0):
            prompt, sot_index = self._context_prompt([]) if with_ctx else (self._prompt_base(), 0)
            return self._greedy_decode(states, prompt, min(FINAL_TOKEN_CAP, self.n_ctx - 8 - len(prompt)),
                                       sot_index, temperature)

        def is_bad(res):
            toks = self._text_tokens(res[0])
            if repetition_period(toks) is not None:
                return True
            return compression_ratio(self.tok.decode(toks)) > 2.4

        # 온도 폴백 체인 (whisper 표준): 반복/압축비 불량이면 조건화 해제 → 온도 상승 재시도
        result = decode(True)
        if is_bad(result):
            result = decode(False)
        if is_bad(result):
            result = decode(False, 0.3)
        if is_bad(result):
            result = decode(False, 0.5)

        self.confirmed = []
        self.last_stepped = 0
        self.stats["finals"] += 1
        tokens, nsp = result
        if nsp > NO_SPEECH_GATE:
            self.emit({"type": "partial", "text": ""})
            return
        text_tokens = self._text_tokens(tokens)
        while True:
            period = repetition_period(text_tokens)
            if period is None:
                break
            text_tokens = text_tokens[:-period]
        text = _trim_fffd(self.tok.decode(text_tokens))
        # 무음 환각("감사합니다" 류)은 세그먼트로 내보내지 않고, 다음 발화 조건화에도 쓰지 않는다
        if text and is_hallucination(text):
            text = ""
            text_tokens = []
        if text:
            # 불량 판정이 끝내 풀리지 않은 결과는 다음 발화 조건화에 쓰지 않는다 (오염 전파 차단)
            self.prev_context = [] if is_bad(result) else text_tokens[-PREV_CONTEXT_CAP:]
            self.emit({
                "type": "segment",
                "tStart": start / SR,
                "tEnd": (start + len(segment)) / SR,
                "text": text,
                "final": True,
            })
        else:
            self.emit({"type": "partial", "text": ""})
        self.log(f"live final {len(segment) / SR:.1f}s → {len(text_tokens)} tok in {(time.time() - t0) * 1000:.0f}ms")
