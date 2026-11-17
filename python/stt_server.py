#!/usr/bin/env python3
"""Dictly local STT sidecar.

A localhost WebSocket server backed by faster-whisper.

Protocol (text JSON in/out, binary Float32 PCM @16kHz mono in):
  client -> {type:'config', model, language, initialPrompt}
  client -> <binary Float32LE frames>
  client -> {type:'flush'}            force-transcribe the buffered utterance
  client -> {type:'stop'}             -> server {type:'stopped'}
  client -> {type:'refine'|'transcribe_file', wavPath, model, language, initialPrompt}
                                       whole-file transcription (imported recordings)
  model: 'turbo' | 'large-v3' | 'live' | 'meta'
         ('live' = Whisper Live streaming engine, python/lightning.py;
          'meta' = Meta Muse Voice Transcribe cloud — needs metaKey; keywords = vocabulary biasing)
  language: 'ko' | 'en' | … | 'auto'

  server -> {type:'status', state}
  server -> {type:'segment', tStart, tEnd, text, final}
  server -> {type:'refine_progress', percent}
  server -> {type:'refine_done', segments:[{tStart,tEnd,text}]}
  server -> {type:'error', message}
"""
import asyncio
import base64
import io
import json
import os
import re
import sys
import time
import traceback
import wave

import numpy as np
import websockets

from hallucination import is_hallucination

MODELS_DIR = os.environ.get("DICTLY_MODELS_DIR", os.path.join(os.path.dirname(__file__), "models"))
os.makedirs(MODELS_DIR, exist_ok=True)

# ---- Engine selection ----
# Prefer MLX (Apple-Silicon GPU) for ~realtime speed; fall back to
# faster-whisper / CTranslate2 (CPU). Override with DICTLY_STT_ENGINE.
ENGINE = os.environ.get("DICTLY_STT_ENGINE", "").lower()
if ENGINE not in ("mlx", "faster"):
    try:
        import mlx_whisper  # noqa: F401
        ENGINE = "mlx"
    except Exception:  # noqa: BLE001
        ENGINE = "faster"
print(f"[stt] engine={ENGINE}", flush=True)

if ENGINE == "mlx":
    import mlx.core as mx
    import importlib
    # (mlx_whisper re-exports transcribe() over the module name — import the module explicitly)
    _mlx_transcribe_mod = importlib.import_module("mlx_whisper.transcribe")

    # mlx_whisper's ModelHolder keeps ONE model — alternating turbo (finals) / base (preview)
    # calls would reload a model on every switch (~2s for turbo). Replace it with a multi-slot
    # cache keyed by (repo, dtype) so every model stays resident (and Whisper Live shares the
    # same turbo instance as chunked finals — no second copy in memory).
    _mlx_models = {}

    def _get_model_cached(model_path, dtype):
        key = (str(model_path), str(dtype))
        m = _mlx_models.get(key)
        if m is None:
            from mlx_whisper.load_models import load_model
            m = load_model(model_path, dtype=dtype)
            # MLX streams are thread-local: arrays still LAZY after load (the encoder's sinusoid
            # table, the decoder's causal mask) stay bound to this thread's stream, and evaluating
            # them from another thread fails ("There is no Stream(gpu, N) in current thread").
            # Materialize them here so the model is usable from any executor/stepper thread.
            mx.eval(m.encoder._positional_embedding, m.decoder._mask)
            _mlx_models[key] = m
        return m

    _mlx_transcribe_mod.ModelHolder.get_model = classmethod(lambda cls, p, d: _get_model_cached(p, d))

# MLX model repos (HuggingFace, MLX format)
MLX_REPO = {
    "turbo": "mlx-community/whisper-large-v3-turbo",
    "large-v3": "mlx-community/whisper-large-v3-mlx",
    # small, fast model used ONLY for the live preview (draft) — keeps previews snappy
    # without stealing GPU from the high-quality finals model
    "base": "mlx-community/whisper-base-mlx",
}
# faster-whisper (CTranslate2) fallback candidates, tried in order
CT2_CANDIDATES = {
    "turbo": [
        "large-v3-turbo",
        "deepdml/faster-whisper-large-v3-turbo-ct2",
        "mobiuslabsgmbh/faster-whisper-large-v3-turbo",
    ],
    "large-v3": ["large-v3"],
    "base": ["base"],
}

SAMPLE_RATE = 16000
SILENCE_SEC = 1.3      # trailing silence that closes an utterance (longer = fuller sentences)
MIN_SEG_SEC = 0.4      # ignore utterances shorter than this
# Whisper encodes a fixed 30s window PER CALL regardless of chunk length, so short chunks
# waste most of that window. Cutting closer to the window (≈22s + silence tail < 30s) means
# ~2x fewer encoder passes for the same audio → roughly 2x throughput on continuous speech,
# which is what keeps a long local recording from falling progressively behind realtime.
MAX_SEG_SEC = 22.0     # default hard cap; the user's "최대 청크 길이" slider overrides this
PRE_ROLL_SEC = 0.3     # audio kept before speech onset so word starts aren't clipped
RMS_THRESH = 0.008     # energy gate for the simple VAD (lower = catch quiet speech)
PARTIAL_INTERVAL = 0.5 # while speaking, refresh the live preview this often (best-effort)
# Preview shows the in-progress chunk (last N s). The preview runs on PREVIEW_MODEL (small),
# so this can comfortably cover the whole current chunk.
PARTIAL_TAIL_SEC = 22.0
# DUAL-MODEL: finals use the high-quality model (cfg["model"], turbo) and have ABSOLUTE
# priority so they keep up with realtime. The live preview uses this small, fast model and
# runs only in the gaps when no final is waiting — cheap enough to stay snappy without
# starving finals. (The old preview-priority / PREVIEW_BURST scheme starved finals → 1min+ lag.)
PREVIEW_MODEL = "base"

_ct2_models = {}
_mlx_loaded = set()


def _ct2_model(name):
    if name in _ct2_models:
        return _ct2_models[name]
    from faster_whisper import WhisperModel
    last_err = None
    for repo in CT2_CANDIDATES.get(name, [name]):
        try:
            m = WhisperModel(repo, device="cpu", compute_type="int8", download_root=MODELS_DIR)
            _ct2_models[name] = m
            return m
        except Exception as e:  # noqa: BLE001
            last_err = e
            print(f"[stt] ct2 model '{repo}' load failed: {e}", flush=True)
    raise RuntimeError(f"모델 로드 실패 ({name}): {last_err}")


def get_model(name: str):
    """Preload / warm the active engine's model (used for the 'ready' status)."""
    if ENGINE == "mlx":
        repo = MLX_REPO.get(name, name)
        # fp16 = the dtype mlx_whisper.transcribe uses → this IS the instance transcribe reuses
        # (the old fp32 preload was a separate 1.6GB copy that transcribe never touched)
        return _get_model_cached(repo, mx.float16)
    return _ct2_model(name)


def _lang(language):
    """'auto' / '' → None (Whisper auto-detects per call)."""
    return None if language in (None, "", "auto") else language


def _decode_file(path):
    """Decode any audio file to 16k mono float32 via PyAV (no system ffmpeg needed)."""
    from faster_whisper.audio import decode_audio
    return np.asarray(decode_audio(path, sampling_rate=SAMPLE_RATE), dtype=np.float32)


def _clean(text):
    """Drop Whisper hallucinations on silence/noise (repeated tokens/phrases)."""
    text = (text or "").strip()
    if not text:
        return ""
    # whole-segment hallucinations on silence ("감사합니다", "시청해주셔서 감사합니다", …) → drop
    if is_hallucination(text):
        return ""
    # U+FFFD = byte-fallback garbage: when a chunk is cut mid-syllable (common with very
    # short chunks), Whisper emits incomplete UTF-8 token bytes that decode to '�'. A few
    # are stripped; a chunk that's mostly '�' is noise/garbage → drop it entirely.
    bad = text.count("�")
    if bad:
        if bad / len(text) > 0.4:
            return ""
        text = text.replace("�", "").strip()
        if not text:
            return ""
    words = text.split()
    n = len(words)
    # highly repetitive output (e.g. "space space space…") -> hallucination
    if n >= 6 and len(set(w.lower() for w in words)) / n < 0.4:
        return ""
    # collapse 3+ consecutive duplicate words down to one
    out = []
    for w in words:
        if len(out) >= 2 and out[-1] == w and out[-2] == w:
            continue
        out.append(w)
    text = " ".join(out)
    return "" if is_hallucination(text) else text


def _transcribe_array(model_name, audio, language, initial_prompt):
    if ENGINE == "mlx":
        import mlx_whisper
        r = mlx_whisper.transcribe(
            audio,
            path_or_hf_repo=MLX_REPO.get(model_name, model_name),
            language=_lang(language),
            initial_prompt=(initial_prompt or None),
            condition_on_previous_text=False,
            verbose=None,
        )
        return _clean(r.get("text"))
    model = _ct2_model(model_name)
    segments, _info = model.transcribe(
        audio,
        language=_lang(language),
        initial_prompt=initial_prompt or None,
        beam_size=1,
        vad_filter=False,
        condition_on_previous_text=False,
    )
    return _clean(" ".join(s.text.strip() for s in segments))


# ---- OpenAI cloud transcription (optional engines) ----
def _wav_bytes(audio, sr=SAMPLE_RATE):
    pcm = (np.clip(audio, -1.0, 1.0) * 32767.0).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


def _openai_transcribe(audio, language, api_key, model):
    """Batch transcription via OpenAI's /audio/transcriptions (gpt-4o-transcribe)."""
    import requests

    r = requests.post(
        "https://api.openai.com/v1/audio/transcriptions",
        headers={"Authorization": f"Bearer {api_key}"},
        files={"file": ("audio.wav", _wav_bytes(audio), "audio/wav")},
        data={"model": model or "gpt-4o-transcribe", "response_format": "text",
              **({"language": language} if _lang(language) else {})},
        timeout=60,
    )
    if r.status_code != 200:
        raise RuntimeError(f"OpenAI {r.status_code}: {r.text[:200]}")
    return _clean(r.text.strip())


def _resample(audio, src=SAMPLE_RATE, dst=24000):
    if src == dst or len(audio) == 0:
        return audio
    m = int(round(len(audio) * dst / src))
    return np.interp(np.linspace(0, len(audio) - 1, m), np.arange(len(audio)), audio).astype(np.float32)


def _pcm16_b64(audio):
    return base64.b64encode((np.clip(audio, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()).decode("ascii")


def _split_sentences(text):
    parts = re.split(r"(?<=[.!?…])\s+", (text or "").strip())
    out = [p.strip() for p in parts if p.strip()]
    return out or ([text.strip()] if text.strip() else [])


def _tail_sentences(text, n=2):
    return " ".join(_split_sentences(text)[-n:])


# ---- Meta Muse Voice Transcribe (cloud, optional engine) ----
# https://dev.meta.ai/docs/speech-to-text/ — realtime WebSocket (handshake auth, raw s16le PCM) and
# multipart file transcription. ENDPOINTING mode gives one turn per utterance with turn-level
# timestamps; `keywords` is the model's own vocabulary-biasing list (the app's 용어 사전).
META_MODEL = "muse-voice-transcribe-1.0"
META_RT_URL = "wss://api.meta.ai/v1/asr/realtime"
META_HTTP_URL = "https://api.meta.ai/v1/asr/transcribe"
META_ROTATE_SEC = 55 * 60      # realtime sessions are capped at 60 min → rotate early
META_MAX_KEYWORDS = 100
META_USD_PER_HOUR = 0.18       # billed per whole second of audio processed
# OpenAI list prices per minute of audio: gpt-live-transcribe (realtime engine) $0.017/min = $1.02/h,
# gpt-4o-transcribe (legacy batch engine) $0.006/min = $0.36/h, still flagged as an estimate.
OPENAI_RT_USD_PER_HOUR = 1.02
OPENAI_BATCH_USD_PER_HOUR = 0.36
# OpenAI realtime transcription (cloud engine "OpenAI"): gpt-live-transcribe streams deltas while speaking.
# Sessions expire after 60 min → rotate at a turn boundary from 55 min, force a cut at 58 min.
OPENAI_RT_URL = "wss://api.openai.com/v1/realtime?intent=transcription"
OPENAI_RT_MODEL = "gpt-live-transcribe"
OPENAI_BATCH_MODEL = "gpt-4o-transcribe"  # REST /audio/transcriptions (legacy openai-transcribe engine only)
OPENAI_ROTATE_SEC = 55 * 60
OPENAI_ROTATE_HARD_SEC = 58 * 60


def _oai_error_text(ev):
    err = ev.get("error") if isinstance(ev, dict) else None
    if isinstance(err, dict):
        return err.get("message") or err.get("code") or str(err)[:200]
    return str(ev)[:200]


class _OaiAuthError(RuntimeError):
    """OpenAI rejected the API key: retrying can't help"""


def _oai_check_auth(ev):
    err = ev.get("error") if isinstance(ev, dict) else None
    if isinstance(err, dict) and (err.get("code") == "invalid_api_key" or "api key" in str(err.get("message", "")).lower()):
        raise _OaiAuthError(_oai_error_text(ev))


def _oai_auth_failed(e):
    """bad / revoked key: an error event right after connecting, or HTTP 401/403 on the upgrade"""
    status = getattr(getattr(e, "response", None), "status_code", None)
    return isinstance(e, _OaiAuthError) or status in (401, 403)


META_LANG_NAMES = {
    "ko": "Korean", "en": "English", "ja": "Japanese", "zh": "Mandarin Chinese", "fr": "French",
    "de": "German", "es": "Spanish", "it": "Italian", "pt": "Portuguese", "nl": "Dutch", "ru": None,
    "ar": "Arabic", "hi": "Hindi", "id": "Indonesian", "ms": "Malay", "th": "Thai", "vi": "Vietnamese",
    "tr": "Turkish", "pl": "Polish", "he": "Hebrew", "bn": "Bengali", "ta": "Tamil", "te": "Telugu",
    "kn": "Kannada", "mr": "Marathi", "tl": "Tagalog",
}


_KW_BAD = re.compile(r"[$\\^_{}<>|`~\[\]]")   # LaTeX / markup — not speakable, and rejected as vocabulary


def _meta_keywords(raw):
    """Dedupe/cap the glossary terms sent as Meta `keywords`. Math-notation entries from the
    agent's correction rules (e.g. `$K_e$`) are dropped — they are spellings, not spoken words."""
    out, seen = [], set()
    for k in raw or []:
        k = str(k).strip()[:60]
        if not k or _KW_BAD.search(k) or len(k) < 2:
            continue
        if k.lower() not in seen:
            seen.add(k.lower())
            out.append(k)
        if len(out) >= META_MAX_KEYWORDS:
            break
    return out


def _meta_request(language, keywords, encoding):
    req = {"model": META_MODEL, "mode": "ENDPOINTING", "partialMode": "CUMULATIVE",
           "emitAudioProgress": False, "audioEncoding": encoding}
    kw = _meta_keywords(keywords)
    if kw:
        req["keywords"] = kw
    name = META_LANG_NAMES.get(_lang(language) or "")
    if name:
        req["languageBias"] = [name]
    return req


def _meta_transcribe_file(audio, language, keywords, api_key, progress=None):
    """Whole-file transcription via POST /v1/asr/transcribe. The endpoint caps a request at
    10 min / 32 MB, so long audio is cut at quiet points into ≤5-min WAV chunks."""
    import requests

    n = len(audio)
    pts = _chunk_points(audio)
    out = []
    for i in range(len(pts) - 1):
        seg = audio[pts[i]:pts[i + 1]]
        off = pts[i] / SAMPLE_RATE
        r = requests.post(
            META_HTTP_URL,
            headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"},
            files={
                "request": (None, json.dumps(_meta_request(language, keywords, "WAV")), "application/json"),
                "audio": ("audio.wav", _wav_bytes(seg), "audio/wav"),
            },
            timeout=600,
        )
        if r.status_code != 200:
            raise RuntimeError(f"Meta {r.status_code}: {r.text[:200]}")
        body = r.json()
        turns = body.get("turns") or []
        if turns:
            for t in turns:
                txt = _clean(t.get("transcript") or "")
                if txt:
                    out.append({"tStart": off + float(t.get("startMs", 0)) / 1000,
                                "tEnd": off + float(t.get("endMs", 0)) / 1000, "text": txt})
        else:
            txt = _clean(body.get("transcript") or "")
            if txt:
                out.append({"tStart": off, "tEnd": off + len(seg) / SAMPLE_RATE, "text": txt})
        if progress:
            progress(min(99.0, pts[i + 1] / n * 100.0))
    return out


async def handle(ws, *_):
    cfg = {
        "model": "turbo",
        "language": "ko",
        "initialPrompt": "",
        "silenceSec": SILENCE_SEC,
        "maxSec": MAX_SEG_SEC,
        "engine": "local",  # local | openai-transcribe | openai-realtime
        "apiKey": "",
        "oaiModel": OPENAI_RT_MODEL,  # realtime engine model (the session always opens gpt-live-transcribe)
        "realtimePreview": False,  # legacy key from the removed preview toggle (ignored)
        "localPreview": True,  # local (base-model) live preview; off → finals get 100% of the GPU
        "metaKey": "",         # Meta Model API key (cfg["model"] == "meta" → Muse Voice Transcribe)
        "keywords": [],        # glossary terms → Meta `keywords` vocabulary biasing
    }
    loop = asyncio.get_event_loop()
    # OPENAI REALTIME (cfg["engine"] == "openai-realtime", model gpt-live-transcribe): owns the whole stream
    # while "mode" is on. The model has no server VAD, so the client cuts turns (adaptive RMS VAD below,
    # same tuning as the iOS engine) with input_audio_buffer.commit. Each commit's (t0, t1) goes into the
    # session's FIFO and is bound to the item_id that input_audio_buffer.committed announces; deltas
    # (keyed by that item_id, they arrive before the commit) are the live preview, and each item's
    # `completed` transcript becomes one final segment. "buf" keeps the audio since the last commit so a
    # dropped session can be reopened without losing the open turn; turns cut while disconnected wait in
    # "deferred". clock = samples received (= the recording timeline), sent = samples billed by OpenAI.
    oai = {"mode": False, "cur": None, "conns": [], "connecting": None, "closing": False, "gen": 0,
           "fails": 0, "next_try": 0.0, "no_prompt": False,
           "clock": 0, "buf": [], "buf_samples": 0, "buf_start": 0, "deferred": [],
           "floor": 0.002, "speaking": False, "sil": 0.0, "turn_start": 0, "last_voice": 0,
           "sent": 0, "reported": 0, "batch_sec": 0.0, "batch_reported": 0.0}

    async def oai_report_usage(force=False):
        """Usage of the OpenAI cloud paths (realtime stream + batch chunks) for the live cost display."""
        try:
            if oai["sent"] and (force or oai["sent"] - oai["reported"] >= SAMPLE_RATE):
                oai["reported"] = oai["sent"]
                await ws.send(json.dumps({"type": "usage", "engine": "openai-realtime", "audioSec": oai["sent"] / SAMPLE_RATE,
                                          "usdPerHour": OPENAI_RT_USD_PER_HOUR, "estimate": False}))
            if oai["batch_sec"] and (force or oai["batch_sec"] - oai["batch_reported"] >= 1.0):
                oai["batch_reported"] = oai["batch_sec"]
                await ws.send(json.dumps({"type": "usage", "engine": "openai-transcribe", "audioSec": oai["batch_sec"],
                                          "usdPerHour": OPENAI_BATCH_USD_PER_HOUR, "estimate": True}))
        except Exception:  # noqa: BLE001
            pass

    def _oai_append(audio):
        return json.dumps({"type": "input_audio_buffer.append", "audio": _pcm16_b64(_resample(audio, SAMPLE_RATE, 24000))})

    async def oai_connect():
        """GA transcription session. No OpenAI-Beta header: with it the server answers in the old beta protocol."""
        conn = await websockets.connect(
            OPENAI_RT_URL,
            additional_headers={"Authorization": f"Bearer {cfg['apiKey']}"},
            max_size=None, ping_interval=20, open_timeout=15, close_timeout=1,
        )
        try:
            first = json.loads(await asyncio.wait_for(conn.recv(), 15))
            if first.get("type") != "session.created":
                _oai_check_auth(first)
                raise RuntimeError(_oai_error_text(first))
            tr = {"model": OPENAI_RT_MODEL, "delay": "low"}
            if _lang(cfg["language"]):
                tr["languages"] = [cfg["language"]]  # array field: the singular `language` is rejected
            prompt = (cfg.get("initialPrompt") or "").strip()
            if prompt and not oai["no_prompt"]:
                tr["prompt"] = prompt[:1000]  # the glossary, same text local Whisper gets as initial_prompt
            await conn.send(json.dumps({"type": "session.update", "session": {"type": "transcription", "audio": {"input": {
                "format": {"type": "audio/pcm", "rate": 24000},
                "transcription": tr,
                "turn_detection": None,  # unsupported by this model: the client commits turns
            }}}}))
            while True:
                ev = json.loads(await asyncio.wait_for(conn.recv(), 15))
                if ev.get("type") == "session.updated":
                    got = (((ev.get("session") or {}).get("audio") or {}).get("input") or {}).get("transcription") or {}
                    print(f"[stt] openai session ready: model={got.get('model')} languages={got.get('languages')} "
                          f"prompt={'yes' if got.get('prompt') else 'no'}", flush=True)
                    if got.get("model") != OPENAI_RT_MODEL:
                        # never transcribe silently on a different model than the one asked for
                        raise RuntimeError(f"OpenAI가 {got.get('model')} 모델로 세션을 열었습니다({OPENAI_RT_MODEL} 요청)")
                    break
                if ev.get("type") == "error":
                    msg = _oai_error_text(ev)
                    if "prompt" in msg.lower() and "prompt" in tr:
                        oai["no_prompt"] = True  # retried without the glossary on the next attempt
                    raise RuntimeError(msg)
            return conn, float(first.get("session", {}).get("expires_at") or 0)
        except BaseException:
            try:
                await conn.close()
            except Exception:  # noqa: BLE001
                pass
            raise

    def oai_pending(cs):
        """turns committed to this session whose transcript hasn't arrived yet"""
        return bool(cs["fifo"]) or any(not it["done"] and "t0" in it for it in cs["items"].values())

    def oai_open_text(cs):
        """the uncommitted buffer already produced preview text (speech the RMS VAD missed)"""
        if cs is None:
            return False
        undone = [i for i in cs["order"] if not cs["items"][i]["done"] and "t0" not in cs["items"][i]]
        return any(cs["items"][i]["text"].strip() for i in undone[len(cs["fifo"]):])

    async def oai_emit(it, text):
        if not text:
            return
        now = oai["clock"] / SAMPLE_RATE
        t0 = float(it.get("t0", max(0.0, now - 1.0)))
        t1 = float(it.get("t1", now))
        await ws.send(json.dumps({"type": "segment", "tStart": t0, "tEnd": max(t0, t1), "text": text, "final": True}))

    async def oai_partial(cs):
        txt = " ".join(cs["items"][i]["text"].strip() for i in cs["order"]
                       if not cs["items"][i]["done"] and cs["items"][i]["text"].strip())
        await ws.send(json.dumps({"type": "partial", "text": _tail_sentences(txt, 3) if txt else ""}))

    async def oai_relay(cs):
        conn = cs["ws"]
        try:
            async for raw in conn:
                ev = json.loads(raw)
                t = ev.get("type", "")
                if t == "conversation.item.input_audio_transcription.delta":
                    iid = ev.get("item_id") or "?"
                    it = cs["items"].get(iid)
                    if it is None:
                        it = cs["items"][iid] = {"text": "", "done": False}
                        cs["order"].append(iid)
                    it["text"] += ev.get("delta") or ""
                    await oai_partial(cs)
                elif t == "input_audio_buffer.committed":
                    iid = ev.get("item_id") or "?"
                    it = cs["items"].get(iid)
                    if it is None:
                        it = cs["items"][iid] = {"text": "", "done": False}
                        cs["order"].append(iid)
                    now = oai["clock"] / SAMPLE_RATE
                    it["t0"], it["t1"] = cs["fifo"].pop(0) if cs["fifo"] else (max(0.0, now - 1.0), now)
                elif t in ("conversation.item.input_audio_transcription.completed",
                           "conversation.item.input_audio_transcription.failed"):
                    iid = ev.get("item_id") or "?"
                    it = cs["items"].pop(iid, None) or {"text": "", "done": False}
                    if iid in cs["order"]:
                        cs["order"].remove(iid)
                    it["done"] = True
                    if t.endswith("completed"):
                        oai["fails"] = 0  # the session is doing real work → reset the reconnect budget
                        await oai_emit(it, _clean(ev.get("transcript") or ""))
                    else:
                        print(f"[stt] openai item failed: {str(ev.get('error'))[:200]}", flush=True)
                        await oai_emit(it, _clean(it["text"]))  # keep what streamed in
                    await oai_partial(cs)
                elif t == "error":
                    err = ev.get("error") or {}
                    if err.get("code") == "input_audio_buffer_commit_empty":
                        if cs["fifo"]:
                            cs["fifo"].pop(0)  # that commit produced no item
                    else:
                        print(f"[stt] openai error: {str(err)[:300]}", flush=True)
                        await ws.send(json.dumps({"type": "error", "message": f"OpenAI 전사 오류: {_oai_error_text(ev)}"}))
        except Exception as e:  # noqa: BLE001
            print(f"[stt] openai relay ended: {e!r}", flush=True)
        if cs in oai["conns"]:
            oai["conns"].remove(cs)
        # committed turns that never got their transcript: keep the text that streamed in. The still-open
        # turn (no commit yet) is skipped: its audio is in buf and is resent to the next session.
        fifo = list(cs["fifo"])
        for iid in list(cs["order"]):
            it = cs["items"][iid]
            if it["done"]:
                continue
            if "t0" not in it:
                if not fifo:
                    continue
                it["t0"], it["t1"] = fifo.pop(0)
            it["done"] = True
            try:
                await oai_emit(it, _clean(it["text"]))
            except Exception:  # noqa: BLE001
                pass
        if cs["retired"] or oai["closing"] or oai["cur"] is not cs:
            return
        # dropped by OpenAI while it was the live session → reopen (lazily, from the audio loop)
        oai["cur"] = None
        oai["fails"] += 1
        oai["next_try"] = time.time() + min(8.0, 2.0 ** (oai["fails"] - 1))
        print(f"[stt] openai session dropped (code={getattr(conn, 'close_code', None)} "
              f"reason={getattr(conn, 'close_reason', '')!r}) fails={oai['fails']}", flush=True)
        if oai["fails"] >= 4:
            await oai_fallback("OpenAI 실시간 연결이 반복해서 끊겨 로컬 Whisper(turbo)로 전환했습니다. 전사는 계속됩니다.")

    async def oai_open():
        conn, expires = await oai_connect()
        if oai["closing"] or not oai["mode"]:
            try:
                await conn.close()
            except Exception:  # noqa: BLE001
                pass
            return
        oai["gen"] += 1
        cs = {"ws": conn, "gen": oai["gen"], "fifo": [], "items": {}, "order": [], "lock": asyncio.Lock(),
              "opened": time.time(), "expires": expires, "retired": False}
        oai["conns"].append(cs)
        cs["task"] = asyncio.create_task(oai_relay(cs))
        deferred, oai["deferred"] = oai["deferred"], []
        head = np.concatenate(oai["buf"]).astype(np.float32) if oai["buf"] else None
        # from here new frames go straight to this session; the backlog below is sent first because the
        # lock is taken before anything can yield (asyncio.Lock is FIFO)
        oai["cur"] = cs
        async with cs["lock"]:
            try:
                for audio, t0, t1 in deferred:  # turns cut while we were disconnected
                    await conn.send(_oai_append(audio))
                    cs["fifo"].append((t0, t1))  # before the commit: its ack may come back on the next tick
                    await conn.send(json.dumps({"type": "input_audio_buffer.commit"}))
                    oai["sent"] += len(audio)
                if head is not None and len(head):
                    await conn.send(_oai_append(head))  # the open turn (and its pre-roll)
                    oai["sent"] += len(head)
            except Exception:  # noqa: BLE001
                pass  # the relay notices the dead socket and reopens

    async def oai_open_bg():
        try:
            await oai_open()
        except Exception as e:  # noqa: BLE001
            oai["fails"] += 1
            oai["next_try"] = time.time() + min(8.0, 2.0 ** (oai["fails"] - 1))
            print(f"[stt] openai connect failed: {e!r}", flush=True)
            if _oai_auth_failed(e):
                await oai_fallback("OpenAI가 API 키를 거부했습니다. 로컬 Whisper(turbo)로 전사합니다. 연결에서 키를 확인하세요.")
            elif oai["fails"] >= 4:
                await oai_fallback(f"OpenAI 연결 실패({str(e)[:80]}). 로컬 Whisper(turbo)로 전환했습니다.")
        finally:
            oai["connecting"] = None

    async def oai_send_frame(arr):
        cs = oai["cur"]
        if cs is None:
            return
        try:
            async with cs["lock"]:
                await cs["ws"].send(_oai_append(arr))
            oai["sent"] += len(arr)
        except Exception:  # noqa: BLE001
            pass  # dropped: the relay reopens and resends buf

    async def oai_retire(cs, wait=5.0):
        """deliver this session's outstanding transcripts, then close it"""
        deadline = time.time() + wait
        while time.time() < deadline and oai_pending(cs) and cs in oai["conns"]:
            await asyncio.sleep(0.1)
        cs["retired"] = True
        try:
            await cs["ws"].close()
        except Exception:  # noqa: BLE001
            pass

    async def oai_commit(t0, t1):
        """cut the current turn: its transcript arrives as one final segment"""
        cs = oai["cur"]
        chunks = oai["buf"]
        oai["buf"], oai["buf_samples"], oai["buf_start"] = [], 0, oai["clock"]
        oai["speaking"], oai["sil"] = False, 0.0
        if cs is None:
            # disconnected: keep the turn for the next session (bounded; the fallback hands it to local Whisper)
            if chunks:
                oai["deferred"].append((np.concatenate(chunks).astype(np.float32), t0, t1))
            while sum(len(a) for a, _, _ in oai["deferred"]) > 120 * SAMPLE_RATE and len(oai["deferred"]) > 1:
                oai["deferred"].pop(0)
            return
        cs["fifo"].append((t0, t1))
        try:
            async with cs["lock"]:
                await cs["ws"].send(json.dumps({"type": "input_audio_buffer.commit"}))
        except Exception:  # noqa: BLE001
            pass
        # sessions expire after 60 min → rotate at this turn boundary once it's old enough
        if time.time() - cs["opened"] >= OPENAI_ROTATE_SEC and oai["connecting"] is None and not oai["closing"]:
            print("[stt] openai session rotation", flush=True)
            oai["cur"] = None  # frames buffer in buf until the new session takes over
            asyncio.create_task(oai_retire(cs, wait=15.0))
            oai["connecting"] = asyncio.create_task(oai_open_bg())

    async def oai_feed(arr):
        """binary frame while OpenAI owns the stream: forward it + client-side turn detection"""
        n = len(arr)
        at = oai["clock"]
        oai["clock"] += n
        oai["buf"].append(arr)
        oai["buf_samples"] += n
        if oai["cur"] is not None:
            await oai_send_frame(arr)
        elif oai["connecting"] is None and not oai["closing"] and time.time() >= oai["next_try"]:
            oai["connecting"] = asyncio.create_task(oai_open_bg())
        rms = float(np.sqrt(np.mean(arr * arr)))
        thresh = max(0.0035, oai["floor"] * 2.5)
        if not oai["speaking"]:
            oai["floor"] = min(0.01, max(0.0015, oai["floor"] * 0.97 + rms * 0.03))
            if rms >= thresh:
                oai["speaking"], oai["sil"] = True, 0.0
                oai["turn_start"] = max(oai["buf_start"], at - int(PRE_ROLL_SEC * SAMPLE_RATE))
                oai["last_voice"] = oai["clock"]
            elif oai["clock"] - oai["buf_start"] >= max(15.0, cfg["maxSec"]) * SAMPLE_RATE:
                # long silence: don't let it pile up in the session buffer. If the model heard speech the
                # VAD missed (preview text exists), commit it as a turn; otherwise just drop the buffer.
                if oai_open_text(oai["cur"]):
                    await oai_commit(oai["buf_start"] / SAMPLE_RATE, oai["clock"] / SAMPLE_RATE)
                else:
                    oai["buf"], oai["buf_samples"], oai["buf_start"] = [], 0, oai["clock"]
                    cs = oai["cur"]
                    if cs is not None:
                        try:
                            async with cs["lock"]:
                                await cs["ws"].send(json.dumps({"type": "input_audio_buffer.clear"}))
                        except Exception:  # noqa: BLE001
                            pass
        else:
            if rms < thresh * 0.8:
                oai["sil"] += n / SAMPLE_RATE
            else:
                oai["sil"] = 0.0
                oai["last_voice"] = oai["clock"]
            long_turn = oai["clock"] - oai["turn_start"] >= cfg["maxSec"] * SAMPLE_RATE
            cs = oai["cur"]
            expiring = cs is not None and time.time() - cs["opened"] >= OPENAI_ROTATE_HARD_SEC
            if oai["sil"] >= cfg["silenceSec"] or long_turn or expiring:
                t1 = min(oai["clock"], oai["last_voice"] + int(0.25 * SAMPLE_RATE))
                await oai_commit(oai["turn_start"] / SAMPLE_RATE, t1 / SAMPLE_RATE)
        await oai_report_usage()

    async def oai_start():
        oai.update(mode=True, closing=False, fails=0, next_try=0.0, no_prompt=False, clock=sample_offset,
                   buf=[], buf_samples=0, buf_start=sample_offset, deferred=[], speaking=False, sil=0.0)
        try:
            await oai_open()
        except Exception as e:  # noqa: BLE001
            print(f"[stt] openai connect failed: {e!r}", flush=True)
            if _oai_auth_failed(e):
                await oai_fallback("OpenAI가 API 키를 거부했습니다. 로컬 Whisper(turbo)로 전사합니다. 연결에서 키를 확인하세요.")
            else:
                oai["fails"] = 1  # retried lazily from the audio loop; 4 failures → local fallback
                oai["next_try"] = time.time() + 1.0

    async def oai_stop():
        """recording stopped: close the open turn, wait for every outstanding transcript, then close"""
        if oai["speaking"]:
            await oai_commit(oai["turn_start"] / SAMPLE_RATE, oai["clock"] / SAMPLE_RATE)
        elif oai["buf_samples"] >= MIN_SEG_SEC * SAMPLE_RATE and oai_open_text(oai["cur"]):
            await oai_commit(oai["buf_start"] / SAMPLE_RATE, oai["clock"] / SAMPLE_RATE)
        if oai["cur"] is None and oai["deferred"]:
            if oai["connecting"] is None:
                oai["connecting"] = asyncio.create_task(oai_open_bg())
            try:
                await asyncio.wait_for(asyncio.shield(oai["connecting"]), 10)
            except Exception:  # noqa: BLE001
                pass
        conns = list(oai["conns"])
        await asyncio.gather(*(oai_retire(cs, wait=6.0) for cs in conns), return_exceptions=True)
        await asyncio.gather(*(cs["task"] for cs in conns), return_exceptions=True)  # relay flushes leftovers
        oai["mode"], oai["closing"], oai["cur"] = False, True, None
        leftover, oai["deferred"] = oai["deferred"], []
        for audio, t0, t1 in leftover:  # never reached OpenAI (offline at stop) → local Whisper
            utt_queue.put_nowait(("final", audio, t0, t1))
        if leftover:
            await utt_queue.join()

    async def oai_shutdown():
        """engine switched away mid-recording: hand the stream back to the local path"""
        nonlocal sample_offset, last_partial_off
        if oai["speaking"]:
            await oai_commit(oai["turn_start"] / SAMPLE_RATE, oai["clock"] / SAMPLE_RATE)
        oai["mode"], oai["closing"], oai["cur"] = False, True, None
        if oai["connecting"] is not None:
            oai["connecting"].cancel()
        for cs in list(oai["conns"]):
            asyncio.create_task(oai_retire(cs))
        for audio, t0, t1 in oai["deferred"]:
            utt_queue.put_nowait(("final", audio, t0, t1))
        oai["deferred"], oai["buf"], oai["buf_samples"] = [], [], 0
        sample_offset = oai["clock"]
        last_partial_off = oai["clock"]

    async def oai_fallback(message):
        """give up on OpenAI for this session: local Whisper (turbo) takes over the same timeline"""
        nonlocal sample_offset, last_partial_off
        if not oai["mode"]:
            return
        oai["mode"], oai["closing"], oai["cur"] = False, True, None
        for cs in list(oai["conns"]):
            cs["retired"] = True
            try:
                await cs["ws"].close()
            except Exception:  # noqa: BLE001
                pass
        # turns OpenAI never transcribed (cut while disconnected + the one being spoken) → local Whisper
        for audio, t0, t1 in oai["deferred"]:
            utt_queue.put_nowait(("final", audio, t0, t1))
        if oai["speaking"] and oai["buf"]:
            utt_queue.put_nowait(("final", np.concatenate(oai["buf"]).astype(np.float32),
                                  oai["buf_start"] / SAMPLE_RATE, oai["clock"] / SAMPLE_RATE))
        oai["deferred"], oai["buf"], oai["buf_samples"], oai["speaking"] = [], [], 0, False
        cfg["engine"] = "local"
        sample_offset = oai["clock"]
        last_partial_off = oai["clock"]
        try:
            await loop.run_in_executor(None, get_model, cfg["model"] if cfg["model"] not in ("live", "meta") else "turbo")
            await ws.send(json.dumps({"type": "error", "message": message}))
        except Exception:  # noqa: BLE001
            pass

    seg_chunks = []
    seg_samples = 0
    seg_start = 0
    silence_samples = 0
    in_speech = False
    sample_offset = 0
    preroll = []          # recent silent frames kept to prepend at speech onset
    preroll_samples = 0
    last_partial_off = 0  # sample_offset of the last live-preview transcription

    # Utterances are transcribed by a background consumer so the audio-receiving
    # loop NEVER blocks on (slow, CPU-bound) transcription. This keeps the VAD
    # running in real time and prevents the stream from backing up / stalling.
    utt_queue: asyncio.Queue = asyncio.Queue()
    # while True, the consumer reports how many utterances remain after each one finishes,
    # so the client can show real finalize progress (and tell "draining" from "stuck").
    fin = {"stopping": False}
    # Live preview is kept OUT of the finals queue: only the LATEST in-progress audio matters,
    # so it lives in this one-slot holder (stale previews are simply overwritten).
    preview = {"audio": None}
    # The small preview model is warmed in the background (its FIRST-time ~145MB download must
    # NOT run inside the consumer, or it would block finals+preview for the whole download —
    # the "처음 1분 아무것도 안 뜸" bug). Previews are skipped until it's ready; finals (turbo,
    # loaded at config) run immediately regardless.
    pmodel = {"ready": False}
    # WHISPER LIVE (cfg["model"] == "live"): the streaming engine (python/lightning.py) owns VAD +
    # volatile previews + finals for the whole session — the local-VAD/consumer path above is
    # bypassed while it's active (same precedence as the OpenAI Realtime takeover).
    live = {"session": None}
    live_out: asyncio.Queue = asyncio.Queue()

    def live_emit(m):
        loop.call_soon_threadsafe(live_out.put_nowait, m)

    async def live_pump():
        while True:
            m = await live_out.get()
            if m is None:
                return
            try:
                await ws.send(json.dumps(m))
            except Exception:  # noqa: BLE001
                return

    live_pump_task = asyncio.create_task(live_pump())

    # META realtime state. One relay task per Meta session; `gen` tells a finishing relay whether it
    # is still the active session (a rotated-away session must not trigger the fallback logic).
    # base = stream clock (seconds of audio fed) when the session opened; Meta's audioProcessedMs is
    # relative to the session, so absolute timestamps = base + ms/1000.
    meta = {"ws": None, "task": None, "connecting": None, "gen": 0, "base": 0.0, "opened_at": 0.0,
            "fails": 0, "next_try": 0.0, "closing": False, "pending": bytearray(),
            "sent": 0, "reported": 0}   # samples handed to Meta (billing basis) / last usage report

    async def meta_report_usage(force=False):
        """Tell the client how much audio Meta has been sent (every ≥1s of audio) for the live cost display."""
        if force or meta["sent"] - meta["reported"] >= SAMPLE_RATE:
            meta["reported"] = meta["sent"]
            try:
                await ws.send(json.dumps({"type": "usage", "engine": "meta", "audioSec": meta["sent"] / SAMPLE_RATE,
                                          "usdPerHour": META_USD_PER_HOUR}))
            except Exception:  # noqa: BLE001
                pass

    async def meta_connect():
        conn = await websockets.connect(META_RT_URL, max_size=None, ping_interval=20, open_timeout=30)
        req = _meta_request(cfg["language"], [] if meta.get("no_keywords") else cfg.get("keywords"), "PCM_16KHZ")
        if meta.get("no_langbias"):
            req.pop("languageBias", None)
        hs = {"authorization": {"accessToken": f"Bearer {cfg['metaKey']}"}, **req}
        print(f"[stt] meta handshake: keywords={len(req.get('keywords', []))} languageBias={req.get('languageBias')} "
              f"mode={req['mode']}", flush=True)
        await conn.send(json.dumps(hs))
        ack = json.loads(await asyncio.wait_for(conn.recv(), 20))
        if "sessionId" not in ack:
            try:
                await conn.close()
            except Exception:  # noqa: BLE001
                pass
            raise RuntimeError(ack.get("message") or str(ack)[:200])
        return conn

    async def meta_relay(conn, gen, base):
        turns = {}
        try:
            async for raw in conn:
                if isinstance(raw, bytes):
                    continue
                ev = json.loads(raw)
                t = ev.get("type")
                if t in ("speechStart", "transcript", "speechComplete"):
                    meta["fails"] = 0  # the session is doing real work → reset the reconnect budget
                if t not in ("transcript", "audioProgress"):
                    print(f"[stt] meta event: {raw[:300]}", flush=True)
                if t == "speechStart":
                    turns[ev.get("turnId")] = float(ev.get("audioProcessedMs", 0))
                elif t == "transcript":
                    if not ev.get("final"):
                        await ws.send(json.dumps({"type": "partial", "text": ev.get("transcript") or ""}))
                elif t == "speechComplete":
                    text = _clean(ev.get("transcript") or "")
                    end_ms = float(ev.get("audioProcessedMs", 0))
                    start_ms = turns.pop(ev.get("turnId"), max(0.0, end_ms - 1000))
                    if text:
                        await ws.send(json.dumps({"type": "segment", "tStart": base + start_ms / 1000,
                                                  "tEnd": base + max(end_ms, start_ms) / 1000, "text": text, "final": True}))
                elif t == "error":
                    await ws.send(json.dumps({"type": "error", "message": f"Meta 전사 오류: {ev.get('message')}"}))
        except Exception as e:  # noqa: BLE001
            print(f"[stt] meta relay ended: {e!r}", flush=True)
        if meta["gen"] != gen:
            return  # rotated away — a newer session owns the stream
        meta["ws"], meta["task"] = None, None
        if meta["closing"]:
            return
        # dropped by the server → decide by close code (https://dev.meta.ai/docs/api-reference/voice/realtime):
        #   1008 invalid request / bad key / pacing policy → retrying the same request fails again → fall back now
        #   1013 rate limited → back off longer; 1011 max-session / backend → reconnect; idle close after a
        #   pause → lazy reconnect on the next audio frame. After repeated failures fall back to local Whisper.
        code = getattr(conn, "close_code", None)
        reason = str(getattr(conn, "close_reason", "") or "")
        alive = time.time() - meta.get("opened_wall", time.time())
        print(f"[stt] meta session closed code={code} reason={reason!r} after {alive:.1f}s", flush=True)
        if code == 1008 and "unauthorized" in reason.lower():
            await meta_fallback("Meta가 API 키를 거부했습니다(Unauthorized) — 로컬 Whisper(turbo)로 전환했습니다. 키를 확인하세요.")
            return
        if code == 1008 and alive < 10:
            # rejected right after the handshake → the REQUEST is the problem, not pacing. Narrow it
            # down by retrying without the optional parts (keywords → languageBias) before giving up.
            if not meta.get("no_keywords") and cfg.get("keywords"):
                meta["no_keywords"] = True
                meta["next_try"] = time.time()
                await ws.send(json.dumps({"type": "error", "message": "Meta가 용어 사전(keywords)을 거부해 용어 사전 없이 다시 연결합니다."}))
                return
            if not meta.get("no_langbias") and _lang(cfg["language"]):
                meta["no_langbias"] = True
                meta["next_try"] = time.time()
                await ws.send(json.dumps({"type": "error", "message": "Meta가 언어 힌트(languageBias)를 거부해 언어 자동 감지로 다시 연결합니다."}))
                return
            await meta_fallback(f"Meta가 요청을 거부했습니다({reason or '1008'}) — 로컬 Whisper(turbo)로 전환했습니다.")
            return
        # 1008 later in a session = streaming-policy (paused input / backlog) → just reconnect
        meta["fails"] += 1
        meta["next_try"] = time.time() + (min(60.0, 5.0 * meta["fails"]) if code == 1013 else min(20.0, 2.0 ** meta["fails"]))
        if meta["fails"] >= 4:
            await meta_fallback("Meta 실시간 연결이 반복 실패해 로컬 Whisper(turbo)로 전환했습니다 — 전사는 계속됩니다.")

    async def meta_fallback(message):
        nonlocal last_partial_off
        cfg["model"] = "turbo"
        last_partial_off = sample_offset
        try:
            await loop.run_in_executor(None, get_model, "turbo")
            await ws.send(json.dumps({"type": "error", "message": message}))
        except Exception:  # noqa: BLE001
            pass

    async def meta_open():
        """Open a new Meta session at the current stream clock (initial connect or 55-min rotation)."""
        conn = await meta_connect()
        gen = meta["gen"] + 1
        now = sample_offset / SAMPLE_RATE
        meta.update(ws=conn, gen=gen, base=now, opened_at=now, opened_wall=time.time())
        meta["task"] = asyncio.create_task(meta_relay(conn, gen, now))
        if meta["pending"]:
            try:
                await conn.send(bytes(meta["pending"]))
                meta["sent"] += len(meta["pending"]) // 2
            except Exception:  # noqa: BLE001
                pass
            meta["pending"] = bytearray()

    async def meta_open_bg():
        try:
            await meta_open()
        except Exception as e:  # noqa: BLE001
            meta["fails"] += 1
            meta["next_try"] = time.time() + min(20.0, 2.0 ** meta["fails"])
            print(f"[stt] meta connect failed: {e!r}", flush=True)
            if meta["fails"] >= 4:
                await meta_fallback(f"Meta 연결 실패({str(e)[:80]}) — 로컬 Whisper(turbo)로 전환했습니다.")
        finally:
            meta["connecting"] = None

    async def meta_close(graceful=True):
        meta["closing"] = True
        if meta["connecting"]:
            meta["connecting"].cancel()
        conn, task = meta["ws"], meta["task"]
        if conn is not None:
            try:
                if graceful:
                    await conn.send(json.dumps({"type": "endStream"}))
                    if task:
                        await asyncio.wait_for(task, 25)
            except Exception:  # noqa: BLE001
                pass
            try:
                await conn.close()
            except Exception:  # noqa: BLE001
                pass
        meta["ws"], meta["task"] = None, None

    def start_live():
        from lightning import LightningSession
        model = get_model("turbo")
        return LightningSession(
            model, cfg["language"], cfg["silenceSec"], live_emit,
            log=lambda m: print(f"[stt] {m}", flush=True),
        )

    async def _do_final(item):
        _, audio, t0, t1 = item
        cloud = cfg.get("engine") == "openai-transcribe" and bool(cfg.get("apiKey"))
        try:
            if cloud:
                text = await loop.run_in_executor(
                    None, _openai_transcribe, audio, cfg["language"], cfg["apiKey"], OPENAI_BATCH_MODEL
                )
                oai["batch_sec"] += len(audio) / SAMPLE_RATE
                await oai_report_usage()
            else:
                text = await loop.run_in_executor(
                    None, _transcribe_array, cfg["model"], audio, cfg["language"], cfg["initialPrompt"]
                )
            if text:
                await ws.send(json.dumps({"type": "segment", "tStart": t0, "tEnd": t1, "text": text, "final": True}))
        except Exception as e:  # noqa: BLE001
            try:
                await ws.send(json.dumps({"type": "error", "message": str(e)}))
            except Exception:  # noqa: BLE001
                pass
        finally:
            utt_queue.task_done()
            if fin["stopping"]:
                try:
                    await ws.send(json.dumps({"type": "finalizing", "remaining": utt_queue.qsize()}))
                except Exception:  # noqa: BLE001
                    pass

    async def consumer():
        while True:
            did = False
            # 1) FINALS first (high-quality, must keep up): process one per loop iteration.
            if not utt_queue.empty():
                item = utt_queue.get_nowait()
                if item is None:
                    return
                await _do_final(item)
                did = True
            # 2) INTERLEAVE one live PREVIEW (small, fast PREVIEW_MODEL) right after the final, so
            #    the preview keeps showing even during CONTINUOUS finals (the old "finals only when
            #    queue empty" starved it). base is cheap → finals are barely delayed. Skip only when
            #    finals are badly backed up (>3), to let them catch up.
            if (
                not fin["stopping"]
                and pmodel["ready"]
                and preview["audio"] is not None
                and utt_queue.qsize() <= 3
            ):
                audio = preview["audio"]
                preview["audio"] = None
                try:
                    text = await loop.run_in_executor(
                        None, _transcribe_array, PREVIEW_MODEL, audio, cfg["language"], cfg["initialPrompt"]
                    )
                    if text:
                        await ws.send(json.dumps({"type": "partial", "text": text}))
                except Exception:  # noqa: BLE001
                    pass
                did = True
            # 3) nothing pending → brief idle so we don't busy-spin
            if not did:
                await asyncio.sleep(0.03)

    consumer_task = asyncio.create_task(consumer())

    def enqueue():
        """Cut the current utterance and hand it to the consumer (non-blocking)."""
        nonlocal seg_chunks, seg_samples, seg_start, silence_samples, in_speech, last_partial_off
        chunks, samples, start = seg_chunks, seg_samples, seg_start
        seg_chunks, seg_samples, silence_samples, in_speech = [], 0, 0, False
        last_partial_off = sample_offset  # restart live-preview cadence for the next utterance
        if samples < MIN_SEG_SEC * SAMPLE_RATE:
            return
        audio = np.concatenate(chunks).astype(np.float32)
        utt_queue.put_nowait(("final", audio, start / SAMPLE_RATE, (start + len(audio)) / SAMPLE_RATE))

    try:
        async for message in ws:
            if isinstance(message, str):
                msg = json.loads(message)
                mt = msg.get("type")
                if mt == "config":
                    cfg.update(
                        {
                            k: msg.get(k, cfg.get(k))
                            for k in ("model", "language", "initialPrompt", "engine", "apiKey", "oaiModel", "realtimePreview", "localPreview", "metaKey", "keywords")
                        }
                    )
                    # clamp user-adjustable VAD params to safe bounds
                    cfg["silenceSec"] = max(0.4, min(3.0, float(msg.get("silenceSec", SILENCE_SEC))))
                    # honor the user's slider; only clamp to a sane safety range [5, 40].
                    cfg["maxSec"] = max(5.0, min(40.0, float(msg.get("maxSec", MAX_SEG_SEC))))
                    await ws.send(json.dumps({"type": "status", "state": "loading"}))
                    try:
                        # OpenAI realtime owns the stream (preview + finals) while selected. Toggle-aware
                        # so a re-sent config (mid-recording) starts it or hands the stream back.
                        want_rt = cfg["engine"] == "openai-realtime"
                        if want_rt and not cfg.get("apiKey"):
                            await ws.send(json.dumps({"type": "error",
                                                      "message": "OpenAI API 키가 없어 로컬 Whisper(turbo)로 전사합니다. 상단 연결에서 키를 넣으세요."}))
                            cfg["engine"] = "local"
                            want_rt = False
                        if want_rt and not oai["mode"]:
                            await oai_start()  # may fall back (cfg["engine"] → local) on a rejected key
                            want_rt = oai["mode"]
                        elif not want_rt and oai["mode"]:
                            await oai_shutdown()
                        if cfg["model"] == "meta" and not cfg.get("metaKey"):
                            await ws.send(json.dumps({"type": "error",
                                                      "message": "Meta API 키가 없어 로컬 Whisper(turbo)로 전사합니다 — 녹음 옵션(⚙)에서 키를 저장하세요."}))
                            cfg["model"] = "turbo"
                        want_meta = cfg["model"] == "meta" and cfg["engine"] != "openai-realtime" and not want_rt
                        if want_meta and meta["ws"] is None and meta["connecting"] is None:
                            meta["closing"] = False
                            meta["fails"] = 0
                            try:
                                await meta_open()  # connect up front so the first utterance streams immediately
                            except Exception as e:  # noqa: BLE001
                                await meta_fallback(f"Meta 연결 실패({str(e)[:80]}) — 로컬 Whisper(turbo)로 전사합니다.")
                        elif not want_meta and (meta["ws"] is not None or meta["connecting"] is not None):
                            await meta_close(graceful=False)
                        want_live = cfg["model"] == "live" and ENGINE == "mlx" and cfg["engine"] != "openai-realtime"
                        if cfg["model"] == "live" and ENGINE != "mlx":
                            await ws.send(json.dumps({"type": "error",
                                                      "message": "Whisper Live는 Apple Silicon(MLX)에서만 동작합니다 — turbo 모델로 전사합니다."}))
                            cfg["model"] = "turbo"
                        if want_live:
                            if live["session"] is None:
                                live["session"] = await loop.run_in_executor(None, start_live)
                        elif cfg["engine"] != "openai-realtime" and cfg["model"] != "meta":
                            # local/cloud-batch finals use the local-VAD path → load the model (cached)
                            await loop.run_in_executor(None, get_model, cfg["model"])
                            # warm the small preview model in the BACKGROUND (do NOT await): its
                            # first-time download must never block the consumer/finals.
                            if not pmodel["ready"] and cfg.get("localPreview", True):
                                async def _warm_preview():
                                    try:
                                        await loop.run_in_executor(None, get_model, PREVIEW_MODEL)
                                        pmodel["ready"] = True
                                    except Exception:  # noqa: BLE001
                                        pass
                                asyncio.create_task(_warm_preview())
                    except Exception as e:  # noqa: BLE001
                        await ws.send(json.dumps({"type": "error", "message": f"엔진 초기화 실패: {e}"}))
                    await ws.send(json.dumps({"type": "status", "state": "ready"}))
                elif mt == "flush":
                    if oai["mode"]:
                        if oai["speaking"]:
                            await oai_commit(oai["turn_start"] / SAMPLE_RATE, oai["clock"] / SAMPLE_RATE)
                    elif live["session"] is not None:
                        live["session"].flush()
                    else:
                        enqueue()
                elif mt == "stop":
                    if oai["mode"]:
                        await ws.send(json.dumps({"type": "finalizing", "remaining": 1}))
                        await oai_stop()
                        await oai_report_usage(force=True)
                        await ws.send(json.dumps({"type": "stopped"}))
                    elif cfg["model"] == "meta" and (meta["ws"] is not None or meta["connecting"] is not None):
                        await ws.send(json.dumps({"type": "finalizing", "remaining": 1}))
                        await meta_close(graceful=True)  # endStream → server flushes pending turns → 1000
                        await meta_report_usage(force=True)
                        await ws.send(json.dumps({"type": "stopped"}))
                    elif live["session"] is not None:
                        sess = live["session"]
                        fut = loop.run_in_executor(None, sess.finish)
                        while not fut.done():
                            await ws.send(json.dumps({"type": "finalizing", "remaining": sess.backlog()}))
                            await asyncio.wait([fut], timeout=0.5)
                        await fut
                        st = sess.stats
                        n = max(1, st["steps"])
                        print(f"[stt] live session: steps={st['steps']} holds={st['holds']} finals={st['finals']} "
                              f"enc={st['enc_ms'] / n:.0f}ms dec={st['dec_ms'] / n:.0f}ms", flush=True)
                        live["session"] = None
                        await ws.send(json.dumps({"type": "stopped"}))
                    else:
                        enqueue()
                        fin["stopping"] = True
                        await ws.send(json.dumps({"type": "finalizing", "remaining": utt_queue.qsize()}))
                        await utt_queue.join()  # wait for all queued utterances to finish
                        await oai_report_usage(force=True)
                        await ws.send(json.dumps({"type": "stopped"}))
                elif mt in ("refine", "transcribe_file"):
                    await do_refine(ws, msg, loop)
                elif mt == "embed":
                    # sentence embeddings for 교안 page tracking (separate socket from the audio
                    # stream; runs in the executor so it never blocks transcription)
                    asyncio.ensure_future(do_embed(ws, msg, loop))
                continue

            # binary PCM frame
            arr = np.frombuffer(message, dtype="<f4")
            n = len(arr)
            if n == 0:
                continue
            # OpenAI realtime selected → it does the full transcription (preview + finals);
            # stream PCM to OpenAI and skip the local VAD/whisper entirely.
            if oai["mode"]:
                await oai_feed(arr)
                continue
            if cfg["model"] == "meta" and cfg.get("metaKey"):
                sample_offset += n
                pcm = (np.clip(arr, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()
                if meta["ws"] is None:
                    # (re)connect lazily — never block the audio loop; buffer ≤4s meanwhile
                    if meta["connecting"] is None and not meta["closing"] and time.time() >= meta["next_try"]:
                        meta["connecting"] = asyncio.create_task(meta_open_bg())
                    meta["pending"] += pcm
                    del meta["pending"][:-4 * SAMPLE_RATE * 2]
                    continue
                if sample_offset / SAMPLE_RATE - meta["opened_at"] >= META_ROTATE_SEC and meta["connecting"] is None:
                    # rotate before the 60-min cap: half-close the old session (its relay keeps
                    # flushing pending turns) and open a fresh one on the same stream clock
                    old = meta["ws"]
                    meta["ws"] = None
                    try:
                        await old.send(json.dumps({"type": "endStream"}))
                    except Exception:  # noqa: BLE001
                        pass
                    meta["pending"] += pcm
                    meta["connecting"] = asyncio.create_task(meta_open_bg())
                    continue
                try:
                    await meta["ws"].send(pcm)
                    meta["sent"] += n
                except Exception:  # noqa: BLE001
                    pass
                await meta_report_usage()
                continue
            if live["session"] is not None:
                live["session"].feed(arr)
                continue
            rms = float(np.sqrt(np.mean(arr * arr)))
            if rms > RMS_THRESH:
                if not in_speech:
                    in_speech = True
                    # prepend the pre-roll so the start of the word isn't clipped
                    seg_chunks = list(preroll)
                    seg_samples = preroll_samples
                    seg_start = sample_offset - preroll_samples
                    preroll = []
                    preroll_samples = 0
                seg_chunks.append(arr)
                seg_samples += n
                silence_samples = 0
            elif in_speech:
                seg_chunks.append(arr)
                seg_samples += n
                silence_samples += n
                # cut exactly at the user's "문장 끊기" (silenceSec) setting — the slider is
                # authoritative (no hidden minimum-chunk override).
                if silence_samples >= cfg["silenceSec"] * SAMPLE_RATE:
                    enqueue()
            else:
                # keep a rolling pre-roll buffer of recent silence
                preroll.append(arr)
                preroll_samples += n
                while preroll_samples > PRE_ROLL_SEC * SAMPLE_RATE and len(preroll) > 1:
                    preroll_samples -= len(preroll.pop(0))
            sample_offset += n
            # live preview: while speaking, hand the in-progress buffer tail to the preview
            # slot every PARTIAL_INTERVAL. This is DECOUPLED from the finals queue (the
            # consumer prioritizes it), so the preview keeps streaming even when finals lag.
            if (
                in_speech
                and cfg.get("localPreview", True)  # off → no previews → finals get 100% of the GPU
                and seg_samples >= MIN_SEG_SEC * SAMPLE_RATE
                and (sample_offset - last_partial_off) >= PARTIAL_INTERVAL * SAMPLE_RATE
            ):
                last_partial_off = sample_offset
                buf = np.concatenate(seg_chunks).astype(np.float32)
                preview["audio"] = buf[-int(PARTIAL_TAIL_SEC * SAMPLE_RATE):]
            if in_speech and seg_samples >= cfg["maxSec"] * SAMPLE_RATE:
                enqueue()
    except websockets.ConnectionClosed:
        pass
    except Exception:  # noqa: BLE001
        traceback.print_exc()
    finally:
        oai["closing"], oai["mode"], oai["cur"] = True, False, None
        if oai["connecting"] is not None:
            oai["connecting"].cancel()
        for cs in list(oai["conns"]):
            cs["retired"] = True
            try:
                await cs["ws"].close()
            except Exception:  # noqa: BLE001
                pass
        if meta["ws"] is not None or meta["connecting"] is not None:
            await meta_close(graceful=False)
        if live["session"] is not None:
            live["session"].finished = True  # stepper exits after its current step
            live["session"] = None
        live_out.put_nowait(None)
        live_pump_task.cancel()
        utt_queue.put_nowait(None)
        try:
            await asyncio.wait_for(consumer_task, timeout=5)
        except Exception:  # noqa: BLE001
            consumer_task.cancel()


def _read_wav(path):
    """16-bit PCM WAV → float32 (any rate/channels; resampled to 16k mono if needed)."""
    with wave.open(path, "rb") as w:
        sr, ch, sw = w.getframerate(), w.getnchannels(), w.getsampwidth()
        raw = w.readframes(w.getnframes())
    if sw != 2:
        raise ValueError(f"unsupported wav sample width {sw}")
    pcm = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    if ch > 1:
        pcm = pcm.reshape(-1, ch).mean(axis=1)
    if sr != SAMPLE_RATE:
        pcm = _resample(pcm, sr, SAMPLE_RATE)
    return pcm.astype(np.float32)


def _load_audio_file(path):
    if path.lower().endswith(".wav"):
        try:
            return _read_wav(path)
        except Exception:  # noqa: BLE001
            pass
    return _decode_file(path)


def _chunk_points(audio, chunk_sec=300.0, search_sec=3.0):
    """Cut a long file into ≈chunk_sec pieces at the quietest 50ms frame near each boundary, so a
    word is never split. The tail (<30s) merges into the last chunk."""
    n = len(audio)
    step = int(chunk_sec * SAMPLE_RATE)
    frame = int(0.05 * SAMPLE_RATE)
    pts = [0]
    pos = step
    while pos < n - int(30 * SAMPLE_RATE):
        lo = max(pts[-1] + int(60 * SAMPLE_RATE), pos - int(search_sec * SAMPLE_RATE))
        hi = min(n, pos + int(search_sec * SAMPLE_RATE))
        win = audio[lo:hi]
        k = len(win) // frame
        if k > 0:
            energy = (win[: k * frame].reshape(k, frame) ** 2).mean(axis=1)
            cut = lo + int(np.argmin(energy)) * frame + frame // 2
        else:
            cut = pos
        pts.append(cut)
        pos = cut + step
    pts.append(n)
    return pts


async def do_embed(ws, msg, loop):
    """{"type":"embed","id","kind":"query"|"passage","texts":[…]} → embed_done | embed_error.
    Any failure (download, load, inference) is reported and the renderer falls back to lexical."""
    rid = msg.get("id")
    texts = [str(t) for t in (msg.get("texts") or [])]
    kind = "passage" if msg.get("kind") == "passage" else "query"
    try:
        import embedder
        vectors = await loop.run_in_executor(None, embedder.embed, texts, kind)
        await ws.send(json.dumps({"type": "embed_done", "id": rid, "model": embedder.MODEL_ID, "dims": embedder.DIMS, "vectors": vectors}))
    except Exception as e:  # noqa: BLE001
        try:
            await ws.send(json.dumps({"type": "embed_error", "id": rid, "message": str(e)}))
        except Exception:  # noqa: BLE001
            pass


async def do_refine(ws, msg, loop):
    """Whole-file transcription (imported recordings / refine). Streams refine_progress, then
    refine_done with sentence-level segments carrying absolute timestamps."""
    q: asyncio.Queue = asyncio.Queue()

    def run():
        try:
            model_name = msg.get("model", "turbo")
            if model_name in ("live", "openai"):
                # no batch mode for the streaming engines: Live shares turbo's weights, and the OpenAI
                # engine's file import runs locally on turbo (no cloud cost, real timestamps)
                model_name = "turbo"
            language = _lang(msg.get("language"))
            ip = msg.get("initialPrompt") or None
            out = []
            path = msg.get("wavPath") or msg.get("path")
            if model_name == "meta":
                if not msg.get("metaKey"):
                    raise RuntimeError("Meta API 키가 없습니다 — 녹음 옵션(⚙)에서 키를 저장하세요")
                audio = _load_audio_file(path)
                if len(audio) == 0:
                    raise RuntimeError("오디오가 비어 있습니다")
                loop.call_soon_threadsafe(q.put_nowait, {"type": "refine_progress", "percent": 1.0})
                out = _meta_transcribe_file(
                    audio, msg.get("language"), msg.get("keywords"), msg["metaKey"],
                    progress=lambda pct: loop.call_soon_threadsafe(q.put_nowait, {"type": "refine_progress", "percent": pct}),
                )
            elif ENGINE == "mlx":
                import mlx_whisper
                audio = _load_audio_file(path)
                n = len(audio)
                if n == 0:
                    raise RuntimeError("오디오가 비어 있습니다")
                loop.call_soon_threadsafe(q.put_nowait, {"type": "refine_progress", "percent": 1.0})
                pts = _chunk_points(audio)
                repo = MLX_REPO.get(model_name, model_name)
                for i in range(len(pts) - 1):
                    seg = audio[pts[i]:pts[i + 1]]
                    off = pts[i] / SAMPLE_RATE
                    r = mlx_whisper.transcribe(
                        seg,
                        path_or_hf_repo=repo,
                        language=language,
                        initial_prompt=ip,
                        condition_on_previous_text=True,
                        verbose=None,
                    )
                    for sg in r.get("segments", []):
                        txt = _clean(sg["text"])
                        if txt:
                            out.append({"tStart": off + float(sg["start"]), "tEnd": off + float(sg["end"]), "text": txt})
                    pct = min(99.0, pts[i + 1] / n * 100.0)
                    loop.call_soon_threadsafe(q.put_nowait, {"type": "refine_progress", "percent": pct})
            else:
                model = _ct2_model(model_name)
                segments, info = model.transcribe(
                    path, language=language, initial_prompt=ip,
                    beam_size=5, vad_filter=True, condition_on_previous_text=True,
                )
                dur = info.duration or 0
                for sg in segments:
                    txt = _clean(sg.text)
                    if txt:
                        out.append({"tStart": sg.start, "tEnd": sg.end, "text": txt})
                    pct = min(99.0, (sg.end / dur * 100.0) if dur else 0.0)
                    loop.call_soon_threadsafe(q.put_nowait, {"type": "refine_progress", "percent": pct})
            done = {"type": "refine_done", "segments": out}
            if model_name == "meta":
                done["usage"] = {"engine": "meta", "audioSec": len(audio) / SAMPLE_RATE, "usdPerHour": META_USD_PER_HOUR}
            loop.call_soon_threadsafe(q.put_nowait, done)
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            loop.call_soon_threadsafe(q.put_nowait, {"type": "error", "message": str(e)})

    fut = loop.run_in_executor(None, run)
    try:
        while True:
            m = await q.get()
            await ws.send(json.dumps(m))
            if m["type"] in ("refine_done", "error"):
                break
        await fut
    finally:
        # remote mode: files staged into the upload dir by the app are single-use
        up = os.environ.get("DICTLY_UPLOAD_DIR")
        path = msg.get("wavPath") or msg.get("path") or ""
        if up and path and os.path.realpath(path).startswith(os.path.realpath(up) + os.sep):
            try:
                os.remove(path)
            except OSError:
                pass


def _remote_housekeeping():
    """Remote mode (the app launches this server over SSH on another Mac):
    - DICTLY_PIDFILE: stop the previous instance of THIS server (pid it wrote itself) left behind
      by a connection that died uncleanly, so two copies never hold the GPU/memory at once.
    - DICTLY_EXIT_ON_STDIN_EOF: the SSH session is our lifeline. When the app quits or the
      network drops, sshd closes our stdin and we exit instead of lingering on that Mac."""
    pidfile = os.environ.get("DICTLY_PIDFILE")
    if pidfile:
        try:
            old = int(open(pidfile).read().strip() or 0)
            if old and old != os.getpid():
                os.kill(old, 15)
                for _ in range(30):  # up to 3 s for it to release the socket/GPU
                    time.sleep(0.1)
                    os.kill(old, 0)
        except (OSError, ValueError):
            pass
        with open(pidfile, "w") as f:
            f.write(str(os.getpid()))
    if os.environ.get("DICTLY_EXIT_ON_STDIN_EOF") == "1":
        import threading

        def _watch():
            try:
                while sys.stdin.buffer.read(4096):
                    pass
            except Exception:  # noqa: BLE001
                pass
            if pidfile:
                try:
                    if open(pidfile).read().strip() == str(os.getpid()):
                        os.remove(pidfile)
                except OSError:
                    pass
            os._exit(0)

        threading.Thread(target=_watch, name="stdin-eof", daemon=True).start()


async def main():
    _remote_housekeeping()
    sock_path = os.environ.get("DICTLY_UNIX_SOCKET")
    if sock_path:
        # remote mode: unix socket only (no TCP port on the remote Mac, so no firewall prompt
        # there); the app reaches it through an SSH -L forward
        try:
            os.unlink(sock_path)
        except OSError:
            pass
        server_cm = websockets.unix_serve(handle, sock_path, max_size=None)
    else:
        server_cm = websockets.serve(handle, "127.0.0.1", 0, max_size=None)
    async with server_cm as server:
        if sock_path:
            os.chmod(sock_path, 0o600)
            print("DICTLY_PORT unix", flush=True)
        else:
            port = server.sockets[0].getsockname()[1]
            print(f"DICTLY_PORT {port}", flush=True)
        # Preload models at STARTUP (in the background) so the FIRST recording starts instantly
        # with no download/load wait: finals model (turbo) + small live-preview model (base).
        # The sidecar is spawned when the app launches, so this warming happens before the user
        # records. First-ever run downloads here (once); afterwards it's an instant cache hit.
        loop = asyncio.get_event_loop()

        async def _preload():
            for name in ("turbo", "base"):
                try:
                    await loop.run_in_executor(None, get_model, name)
                    print(f"[stt] preloaded {name}", flush=True)
                except Exception as e:  # noqa: BLE001
                    print(f"[stt] preload {name} failed: {e}", flush=True)

        asyncio.create_task(_preload())
        await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
