"""Smoke test for the streaming STT path (queue-based). Streams a Korean audio
file as PCM frames and prints the segments returned by the sidecar."""
import asyncio
import json
import subprocess
import sys
import time

import numpy as np
import websockets
from faster_whisper.audio import decode_audio

AUDIO = sys.argv[1] if len(sys.argv) > 1 else "/tmp/ko_test.aiff"


async def main():
    audio = np.asarray(decode_audio(AUDIO, sampling_rate=16000), dtype=np.float32)
    audio = np.concatenate([audio, np.zeros(16000, dtype=np.float32)])  # trailing silence

    proc = subprocess.Popen(
        [sys.executable, "-u", "stt_server.py"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL
    )
    port = None
    for raw in proc.stdout:
        line = raw.decode().strip()
        if line.startswith("DICTLY_PORT"):
            port = int(line.split()[1])
            break
    print("port", port)

    segments = []
    async with websockets.connect(f"ws://127.0.0.1:{port}", max_size=None) as ws:
        await ws.send(json.dumps({"type": "config", "model": "turbo", "language": "ko",
                                  "initialPrompt": "WACC, CAPM, 베타, 무위험이자율, 자기자본비용"}))
        while True:
            m = json.loads(await ws.recv())
            if m.get("type") == "status" and m.get("state") == "ready":
                break

        async def sender():
            step = 2048
            for i in range(0, len(audio), step):
                await ws.send(audio[i:i + step].tobytes())
                await asyncio.sleep(0.01)  # ~realtime-ish pacing
            await ws.send(json.dumps({"type": "stop"}))

        async def receiver():
            while True:
                m = json.loads(await ws.recv())
                t = m.get("type")
                if t == "segment":
                    segments.append(m)
                    print(f"SEG [{m['tStart']:.1f}-{m['tEnd']:.1f}] {m['text']}")
                elif t == "stopped":
                    break
                elif t == "error":
                    print("ERR", m["message"])

        t0 = time.time()
        await asyncio.gather(sender(), receiver())
        print(f"done in {time.time() - t0:.1f}s, {len(segments)} segment(s)")

    proc.terminate()


asyncio.run(main())
