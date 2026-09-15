#!/usr/bin/env python3
"""Lightning 프로브의 레퍼런스 덤프 생성기.

사용법:
  python3 -m venv venv && venv/bin/pip install mlx mlx-whisper
  say -v Yuna -o raw.aiff "테스트 문장…" && afconvert -f WAVE -d LEI16@16000 -c 1 raw.aiff test.wav
  venv/bin/python make_ref_dumps.py

산출물 (프로브 실행 디렉토리에 필요):
  ref_dumps.safetensors    mel·인코더 상태·프리픽스 층별 hidden·레퍼런스 로짓
  decoder_ref.safetensors  HF 캐시에서 추출한 클린 디코더 가중치 (100텐서)
  config.json              프롬프트/특수 토큰/레퍼런스 그리디 토큰
"""
import json
import mlx.core as mx
from mlx_whisper import load_models, audio
from mlx_whisper.tokenizer import get_tokenizer

model = load_models.load_model("mlx-community/whisper-large-v3-turbo", dtype=mx.float16)
tok = get_tokenizer(model.is_multilingual, num_languages=model.dims.n_vocab - 51765,
                    language="ko", task="transcribe")

raw = audio.pad_or_trim(audio.load_audio("test.wav"), audio.N_SAMPLES)
mel = audio.log_mel_spectrogram(raw, n_mels=model.dims.n_mels).astype(mx.float16)
states = model.encoder(mel[None])
mx.eval(states)

prompt = list(tok.sot_sequence_including_notimestamps)
V = model.dims.n_vocab
eot, nospeech, special_begin = tok.eot, tok.no_speech, tok.eot
ws = tok.encoding.encode(" ")[0]

import numpy as np
suppress = np.zeros(V, dtype=np.float32); suppress[special_begin:] = -1e9; suppress[eot] = 0
first = np.zeros(V, dtype=np.float32); first[ws] = -1e9; first[eot] = -1e9
suppress, first = mx.array(suppress), mx.array(first)

logits, kv, _ = model.decoder(mx.array(prompt)[None], states, kv_cache=None)
prefix_logits = logits[0].astype(mx.float32)
last, tokens, step_logits = prefix_logits[-1], [], []
for i in range(120):
    masked = last + suppress + (first if i == 0 else 0)
    nxt = int(mx.argmax(masked).item())
    if nxt == eot: break
    tokens.append(nxt)
    logits, kv, _ = model.decoder(mx.array([[nxt]]), states, kv_cache=kv)
    last = logits[0, -1].astype(mx.float32)
    if i < 4: step_logits.append(last)
print("ref text:", tok.decode([t for t in tokens if t < special_begin]))

d = model.decoder
x = d.token_embedding(mx.array(prompt)[None]) + d.positional_embedding[:len(prompt)]
dumps = {"xin": x}
for e, block in enumerate(d.blocks):
    x, _, _ = block(x, states, mask=d._mask, kv_cache=None)
    dumps[f"x{e}"] = x
dumps["xfinal"] = d.ln(x)
dumps["prefix_logits"] = prefix_logits
for i, sl in enumerate(step_logits): dumps[f"step_logits_{i}"] = sl
dumps["encoder_states"] = states
dumps["mel"] = mel
mx.eval(*dumps.values())
mx.save_safetensors("ref_dumps.safetensors", dumps)

import glob, os
hub = glob.glob(os.path.expanduser(
    "~/.cache/huggingface/hub/models--mlx-community--whisper-large-v3-turbo/snapshots/*/weights.safetensors"))[0]
dec = {k: v for k, v in mx.load(hub).items() if k.startswith("decoder.")}
mx.save_safetensors("decoder_ref.safetensors", dec)

json.dump(dict(prompt=prompt, eot=eot, nospeech=nospeech, special_begin=special_begin,
               ws=ws, ref_tokens=tokens, vocab=V), open("config.json", "w"))
print("DONE — decoder tensors:", len(dec))
