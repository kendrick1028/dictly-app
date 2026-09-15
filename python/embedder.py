"""Sentence embeddings for 교안 page tracking (multilingual-e5-small, ONNX int8).

Runs inside the STT sidecar (onnxruntime + tokenizers are already in the runtime — no new
packages). Loaded lazily on the first `embed` request; the model (~120 MB) is fetched from the
Hugging Face hub once into DICTLY_MODELS_DIR. Every failure is reported back as `embed_error`
and the renderer falls back to lexical matching — this module must never take the server down.

e5 convention: prefix queries with "query: " and documents with "passage: "; mean-pool over the
attention mask; L2-normalize (so cosine == dot).
"""
import os
import threading

import numpy as np

REPO = "Xenova/multilingual-e5-small"
MODEL_FILE = "onnx/model_quantized.onnx"
MODEL_ID = "multilingual-e5-small-q8"   # reported to the renderer; cache key for page vectors
DIMS = 384
MAX_TOKENS = 512
BATCH = 16

_lock = threading.Lock()
_session = None
_tokenizer = None
_input_names = None
_load_error = None


def _models_dir():
    return os.environ.get("DICTLY_MODELS_DIR", os.path.join(os.path.dirname(__file__), "models"))


def _load():
    """Download (once) + create the ONNX session. Raises on failure (caller reports embed_error)."""
    global _session, _tokenizer, _input_names, _load_error
    if _session is not None:
        return
    if _load_error is not None:
        raise _load_error
    try:
        from huggingface_hub import hf_hub_download
        import onnxruntime as ort
        from tokenizers import Tokenizer

        cache = os.path.join(_models_dir(), "embed")
        os.makedirs(cache, exist_ok=True)
        model_path = hf_hub_download(REPO, MODEL_FILE, cache_dir=cache)
        tok_path = hf_hub_download(REPO, "tokenizer.json", cache_dir=cache)
        tok = Tokenizer.from_file(tok_path)
        tok.enable_truncation(max_length=MAX_TOKENS)
        tok.enable_padding(pad_id=1, pad_token="<pad>")  # xlm-roberta pad id = 1
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 2  # leave the GPU/CPU to Whisper; this is a side job
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        sess = ort.InferenceSession(model_path, sess_options=opts, providers=["CPUExecutionProvider"])
        _input_names = {i.name for i in sess.get_inputs()}
        _tokenizer = tok
        _session = sess
        print(f"[stt] embedder ready ({MODEL_ID})", flush=True)
    except Exception as e:  # noqa: BLE001
        _load_error = RuntimeError(f"임베딩 모델 로드 실패: {e}")
        raise _load_error


def embed(texts, kind="query"):
    """texts: list[str] → list[list[float]] (L2-normalized, DIMS each). Thread-safe."""
    with _lock:
        _load()
        prefix = "query: " if kind == "query" else "passage: "
        out = []
        for i in range(0, len(texts), BATCH):
            batch = [prefix + (t or "").strip() for t in texts[i:i + BATCH]]
            enc = _tokenizer.encode_batch(batch)
            ids = np.array([e.ids for e in enc], dtype=np.int64)
            mask = np.array([e.attention_mask for e in enc], dtype=np.int64)
            feeds = {"input_ids": ids, "attention_mask": mask}
            if "token_type_ids" in _input_names:
                feeds["token_type_ids"] = np.zeros_like(ids)
            hidden = _session.run(None, feeds)[0]  # (B, T, H)
            m = mask[:, :, None].astype(np.float32)
            pooled = (hidden * m).sum(axis=1) / np.maximum(m.sum(axis=1), 1e-6)
            norms = np.linalg.norm(pooled, axis=1, keepdims=True)
            pooled = pooled / np.maximum(norms, 1e-9)
            out.extend(pooled.astype(np.float32).round(5).tolist())
        return out


def status():
    return {"loaded": _session is not None, "error": str(_load_error) if _load_error else None, "model": MODEL_ID, "dims": DIMS}
