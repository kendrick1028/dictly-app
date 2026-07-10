#!/usr/bin/env bash
# Provision the Dictly STT sidecar environment.
#   bash python/setup_env.sh            # install deps + prefetch turbo model
#   DICTLY_SKIP_PREFETCH=1 bash ...     # install deps only
set -euo pipefail

cd "$(dirname "$0")"

# the new HF "xet" transfer protocol can hang on first download; use plain HTTPS
export HF_HUB_DISABLE_XET=1

# pick the newest available CPython (faster-whisper prefers >=3.10)
PY=""
for cand in python3.12 python3.11 python3.10 python3; do
  if command -v "$cand" >/dev/null 2>&1; then PY="$cand"; break; fi
done
if [ -z "$PY" ]; then
  echo "python3 가 필요합니다 (brew install python@3.12)"; exit 1
fi
echo "→ using $($PY --version) ($PY)"

if [ ! -d .venv ]; then
  "$PY" -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate

python -m pip install --upgrade pip >/dev/null
echo "→ installing python dependencies (faster-whisper, websockets, numpy)…"
pip install -r requirements.txt

if [ "${DICTLY_SKIP_PREFETCH:-0}" != "1" ]; then
  echo "→ prefetching the realtime model (large-v3-turbo, ~1.6GB, first time only)…"
  DICTLY_MODELS_DIR="${DICTLY_MODELS_DIR:-./models}" python - <<'PY'
import os
md = os.environ.get("DICTLY_MODELS_DIR", "./models")
os.makedirs(md, exist_ok=True)
# Prefer MLX (Apple GPU); fall back to faster-whisper (CPU).
# turbo = high-quality finals; base = small/fast model for the live preview (draft).
try:
    from mlx_whisper.load_models import load_model
    load_model("mlx-community/whisper-large-v3-turbo")
    print("   ✓ MLX large-v3-turbo ready (Apple GPU)")
    load_model("mlx-community/whisper-base-mlx")
    print("   ✓ MLX base ready (live-preview model)")
except Exception as e:
    print(f"   ! MLX prefetch skipped ({e}); using faster-whisper")
    from faster_whisper import WhisperModel
    WhisperModel("large-v3-turbo", device="cpu", compute_type="int8", download_root=md)
    WhisperModel("base", device="cpu", compute_type="int8", download_root=md)
    print("   ✓ faster-whisper large-v3-turbo + base ready (CPU)")
PY
fi

echo "✓ STT 환경 준비 완료"
