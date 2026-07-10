#!/usr/bin/env python3
"""Dictly local STT sidecar.

A localhost WebSocket server backed by faster-whisper.

Protocol (text JSON in/out, binary Float32 PCM @16kHz mono in):
  client -> {type:'config', model, language, initialPrompt}
  client -> <binary Float32LE frames>
  client -> {type:'flush'}            force-transcribe the buffered utterance
  client -> {type:'stop'}             -> server {type:'stopped'}
  client -> {type:'refine', wavPath, model, language, initialPrompt}

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
import traceback
import wave

import numpy as np
import websockets

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
        if repo not in _mlx_loaded:
            from mlx_whisper.load_models import load_model
            load_model(repo)  # downloads + caches (shared with transcribe)
            _mlx_loaded.add(repo)
        return repo
    return _ct2_model(name)


def _decode_file(path):
    """Decode any audio file to 16k mono float32 via PyAV (no system ffmpeg needed)."""
    from faster_whisper.audio import decode_audio
    return np.asarray(decode_audio(path, sampling_rate=SAMPLE_RATE), dtype=np.float32)


def _clean(text):
    """Drop Whisper hallucinations on silence/noise (repeated tokens/phrases)."""
    text = (text or "").strip()
    if not text:
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
    return " ".join(out)


def _transcribe_array(model_name, audio, language, initial_prompt):
    if ENGINE == "mlx":
        import mlx_whisper
        r = mlx_whisper.transcribe(
            audio,
            path_or_hf_repo=MLX_REPO.get(model_name, model_name),
            language=(language or None),
            initial_prompt=(initial_prompt or None),
            condition_on_previous_text=False,
            verbose=None,
        )
        return _clean(r.get("text"))
    model = _ct2_model(model_name)
    segments, _info = model.transcribe(
        audio,
        language=language or None,
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
        data={"model": model or "gpt-4o-transcribe", "language": language or "ko", "response_format": "text"},
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


async def handle(ws, *_):
    cfg = {
        "model": "turbo",
        "language": "ko",
        "initialPrompt": "",
        "silenceSec": SILENCE_SEC,
        "maxSec": MAX_SEG_SEC,
        "engine": "local",  # local | openai-transcribe | openai-realtime
        "apiKey": "",
        "oaiModel": "gpt-4o-transcribe",
        "realtimePreview": False,  # overlay: live preview via Realtime, finals stay on the chosen engine
        "localPreview": True,  # local (base-model) live preview; off → finals get 100% of the GPU
    }
    loop = asyncio.get_event_loop()
    # OpenAI Realtime session state. When connected, Realtime produces BOTH the live
    # preview and the final sentence segments (local whisper is skipped → no double work).
    # clock = input samples streamed (= elapsed audio time, matches the recording timeline).
    # "closing" distinguishes a session WE tore down (toggle-off / stop) from one OpenAI
    # dropped on its own (Realtime transcription is capped ~30 min) — only the latter
    # triggers the local-Whisper fallback below.
    oai = {"ws": None, "task": None, "clock": 0, "start": 0.0, "acc": "", "closing": False}

    async def connect_realtime():
        # GA Realtime API (no beta header; nested session.audio.input shape)
        conn = await websockets.connect(
            "wss://api.openai.com/v1/realtime?intent=transcription",
            additional_headers={"Authorization": f"Bearer {cfg['apiKey']}"},
            max_size=None,
            ping_interval=20,
        )
        await conn.send(json.dumps({
            "type": "session.update",
            "session": {
                "type": "transcription",
                "audio": {
                    "input": {
                        "format": {"type": "audio/pcm", "rate": 24000},
                        # gpt-realtime-whisper streams continuously and rejects turn_detection
                        "transcription": {"model": cfg.get("oaiModel") or "gpt-realtime-whisper", "language": cfg["language"] or "ko"},
                    }
                },
            },
        }))
        return conn

    async def emit_finals(sentences):
        """Emit each sentence as a final segment, timestamps spread over [start, now]."""
        sentences = [s.strip() for s in sentences if s.strip()]
        if not sentences:
            return
        now = oai["clock"] / SAMPLE_RATE
        per = max(0.0, now - oai["start"]) / len(sentences)
        for i, s in enumerate(sentences):
            await ws.send(json.dumps({
                "type": "segment",
                "tStart": oai["start"] + per * i,
                "tEnd": oai["start"] + per * (i + 1),
                "text": _clean(s),
                "final": True,
            }))
        oai["start"] = now

    async def relay_realtime():
        nonlocal sample_offset, last_partial_off
        try:
            async for raw in oai["ws"]:
                ev = json.loads(raw)
                t = ev.get("type", "")
                if t.endswith("transcription.delta"):
                    oai["acc"] += ev.get("delta", "")
                    sents = _split_sentences(oai["acc"])
                    if len(sents) >= 2:
                        # gpt-realtime-whisper sends no completed event → finalize sentences
                        # ourselves: all but the last (in-progress) sentence are confirmed.
                        await emit_finals(sents[:-1])
                        oai["acc"] = sents[-1]
                    elif len(oai["acc"]) > 220:
                        await emit_finals([oai["acc"]])  # no punctuation yet but getting long
                        oai["acc"] = ""
                    await ws.send(json.dumps({"type": "partial", "text": _tail_sentences(oai["acc"], 2)}))
                elif t.endswith("transcription.completed"):
                    # if the model DOES send completed, finalize whatever's still pending
                    if oai["acc"].strip():
                        await emit_finals(_split_sentences(oai["acc"]))
                        oai["acc"] = ""
                elif t == "error":
                    await ws.send(json.dumps({"type": "error", "message": str(ev.get("error", "realtime error"))}))
        except Exception:  # noqa: BLE001
            pass
        # The async-for ended. If WE didn't close it (toggle-off / stop), OpenAI dropped
        # the session — Realtime transcription is capped (~30 min). Flush pending text and
        # fall back to LOCAL whisper so recording keeps working: the binary loop skips the
        # local VAD entirely while oai["ws"] is set, so leaving it set would silently kill
        # ALL transcription (the "30분쯤 멈춤" bug).
        if oai.get("closing"):
            return
        try:
            if oai["acc"].strip():
                await emit_finals(_split_sentences(oai["acc"]))
        except Exception:  # noqa: BLE001
            pass
        oai["acc"] = ""
        # resume the local timeline where realtime left off — the local-VAD path never
        # advanced sample_offset while realtime owned the stream (it only bumped oai["clock"]).
        sample_offset = oai["clock"]
        last_partial_off = oai["clock"]
        oai["ws"], oai["task"] = None, None
        try:
            await ws.send(json.dumps({
                "type": "error",
                "message": "OpenAI 실시간 세션이 만료되어(약 30분 제한) 로컬 Whisper로 자동 전환했습니다 — 전사는 계속됩니다.",
            }))
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

    async def _do_final(item):
        _, audio, t0, t1 = item
        cloud = cfg.get("engine") == "openai-transcribe" and bool(cfg.get("apiKey"))
        try:
            if cloud:
                text = await loop.run_in_executor(
                    None, _openai_transcribe, audio, cfg["language"], cfg["apiKey"], cfg.get("oaiModel")
                )
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
                            for k in ("model", "language", "initialPrompt", "engine", "apiKey", "oaiModel", "realtimePreview", "localPreview")
                        }
                    )
                    # clamp user-adjustable VAD params to safe bounds
                    cfg["silenceSec"] = max(0.4, min(3.0, float(msg.get("silenceSec", SILENCE_SEC))))
                    # honor the user's slider; only clamp to a sane safety range [5, 40].
                    cfg["maxSec"] = max(5.0, min(40.0, float(msg.get("maxSec", MAX_SEG_SEC))))
                    await ws.send(json.dumps({"type": "status", "state": "loading"}))
                    try:
                        # Realtime is used as the finals engine OR a live-preview overlay.
                        # Toggle-aware so a re-sent config (mid-recording) connects/disconnects it.
                        want_rt = bool(cfg["apiKey"]) and (cfg["engine"] == "openai-realtime" or cfg.get("realtimePreview"))
                        have_rt = oai["ws"] is not None
                        if want_rt and not have_rt:
                            oai["start"] = oai["clock"] / SAMPLE_RATE
                            oai["acc"] = ""
                            oai["closing"] = False
                            oai["ws"] = await connect_realtime()
                            oai["task"] = asyncio.create_task(relay_realtime())
                        elif not want_rt and have_rt:
                            oai["closing"] = True
                            try:
                                await oai["ws"].close()
                            except Exception:  # noqa: BLE001
                                pass
                            if oai["task"]:
                                oai["task"].cancel()
                            oai["ws"], oai["task"] = None, None
                        if cfg["engine"] != "openai-realtime":
                            # local/cloud-batch finals use the local-VAD path → load the model (cached)
                            await loop.run_in_executor(None, get_model, cfg["model"])
                            # warm the small preview model in the BACKGROUND (do NOT await): its
                            # first-time download must never block the consumer/finals.
                            if not pmodel["ready"]:
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
                    enqueue()
                elif mt == "stop":
                    if oai["ws"] is not None:
                        # flush the last in-progress utterance as a final segment
                        full = _clean(oai["acc"].strip())
                        if full:
                            t1 = oai["clock"] / SAMPLE_RATE
                            sents = _split_sentences(full)
                            per = max(0.0, t1 - oai["start"]) / len(sents) if sents else 0.0
                            for i, s in enumerate(sents):
                                await ws.send(json.dumps({
                                    "type": "segment", "tStart": oai["start"] + per * i,
                                    "tEnd": oai["start"] + per * (i + 1), "text": s, "final": True,
                                }))
                            oai["acc"] = ""
                        oai["closing"] = True
                        try:
                            await oai["ws"].close()
                        except Exception:  # noqa: BLE001
                            pass
                        await ws.send(json.dumps({"type": "stopped"}))
                    else:
                        enqueue()
                        fin["stopping"] = True
                        await ws.send(json.dumps({"type": "finalizing", "remaining": utt_queue.qsize()}))
                        await utt_queue.join()  # wait for all queued utterances to finish
                        await ws.send(json.dumps({"type": "stopped"}))
                elif mt == "refine":
                    await do_refine(ws, msg, loop)
                continue

            # binary PCM frame
            arr = np.frombuffer(message, dtype="<f4")
            n = len(arr)
            if n == 0:
                continue
            # realtime is connected → it does the full transcription (preview + finals);
            # stream PCM to OpenAI and skip the local VAD/whisper entirely.
            if oai["ws"] is not None:
                oai["clock"] += n
                try:
                    await oai["ws"].send(
                        json.dumps({"type": "input_audio_buffer.append", "audio": _pcm16_b64(_resample(arr, SAMPLE_RATE, 24000))})
                    )
                except Exception:  # noqa: BLE001
                    pass
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
                and oai["ws"] is None  # realtime overlay already provides live previews
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
        if oai["ws"] is not None:
            oai["closing"] = True
            try:
                await oai["ws"].close()
            except Exception:  # noqa: BLE001
                pass
            if oai["task"]:
                oai["task"].cancel()
        utt_queue.put_nowait(None)
        try:
            await asyncio.wait_for(consumer_task, timeout=5)
        except Exception:  # noqa: BLE001
            consumer_task.cancel()


async def do_refine(ws, msg, loop):
    q: asyncio.Queue = asyncio.Queue()

    def run():
        try:
            model_name = msg.get("model", "large-v3")
            language = msg.get("language") or None
            ip = msg.get("initialPrompt") or None
            out = []
            if ENGINE == "mlx":
                import mlx_whisper
                audio = _decode_file(msg["wavPath"])  # PyAV decode (no system ffmpeg)
                loop.call_soon_threadsafe(q.put_nowait, {"type": "refine_progress", "percent": 20.0})
                r = mlx_whisper.transcribe(
                    audio,
                    path_or_hf_repo=MLX_REPO.get(model_name, model_name),
                    language=language,
                    initial_prompt=ip,
                    condition_on_previous_text=True,
                    verbose=None,
                )
                for s in r.get("segments", []):
                    txt = _clean(s["text"])
                    if txt:
                        out.append({"tStart": s["start"], "tEnd": s["end"], "text": txt})
            else:
                model = _ct2_model(model_name)
                segments, info = model.transcribe(
                    msg["wavPath"], language=language, initial_prompt=ip,
                    beam_size=5, vad_filter=True, condition_on_previous_text=True,
                )
                dur = info.duration or 0
                for s in segments:
                    txt = _clean(s.text)
                    if txt:
                        out.append({"tStart": s.start, "tEnd": s.end, "text": txt})
                    pct = min(99.0, (s.end / dur * 100.0) if dur else 0.0)
                    loop.call_soon_threadsafe(q.put_nowait, {"type": "refine_progress", "percent": pct})
            loop.call_soon_threadsafe(q.put_nowait, {"type": "refine_done", "segments": out})
        except Exception as e:  # noqa: BLE001
            loop.call_soon_threadsafe(q.put_nowait, {"type": "error", "message": str(e)})

    fut = loop.run_in_executor(None, run)
    while True:
        m = await q.get()
        await ws.send(json.dumps(m))
        if m["type"] in ("refine_done", "error"):
            break
    await fut


async def main():
    async with websockets.serve(handle, "127.0.0.1", 0, max_size=None) as server:
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
