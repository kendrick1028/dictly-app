// @ts-nocheck
'use client'

import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useAspect, useTexture } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

const TEXTUREMAP = '/media/futuristic-img.png'
const DEPTHMAP = '/media/futuristic-depth.webp'
const WIDTH = 626
const HEIGHT = 626

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

// depth-map parallax + animated scan reveal + dotted accent grid (screen-blended)
const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uMap;
  uniform sampler2D uDepth;
  uniform vec2 uPointer;
  uniform float uProgress;
  uniform float uOpacity;
  uniform float uAspect;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }

  void main(){
    vec2 uv = vUv;
    float d = texture2D(uDepth, uv).r;

    // parallax driven by pointer + auto-drift, scaled by depth
    vec2 parallax = uPointer * 0.022 * d;
    vec3 base = texture2D(uMap, uv + parallax).rgb;

    // tiled dot grid
    vec2 tUv = vec2(uv.x * uAspect, uv.y);
    float tiling = 120.0;
    vec2 tiled = fract(tUv * tiling) * 2.0 - 1.0;
    float dots = smoothstep(0.5, 0.46, length(tiled));
    dots *= hash(floor(tUv * tiling));

    // scan reveal: bright where depth ~ scan progress
    float flow = 1.0 - smoothstep(0.0, 0.025, abs(d - uProgress));

    vec3 accent = mix(vec3(0.486, 0.424, 1.0), vec3(0.220, 0.741, 0.972), 0.5);
    vec3 mask = dots * flow * accent * 3.2;

    // screen blend mask over the image
    vec3 col = 1.0 - (1.0 - base) * (1.0 - mask);

    // thin moving scan line glow across whole frame
    float line = 1.0 - smoothstep(0.0, 0.012, abs(uv.y - uProgress));
    col += accent * line * 0.18;

    gl_FragColor = vec4(col, uOpacity);
  }
`

function Scene() {
  const [rawMap, depthMap] = useTexture([TEXTUREMAP, DEPTHMAP])
  const matRef = useRef<THREE.ShaderMaterial>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (rawMap && depthMap) {
      ;[rawMap, depthMap].forEach((t) => {
        t.minFilter = THREE.LinearFilter
        t.magFilter = THREE.LinearFilter
        t.needsUpdate = true
      })
      setVisible(true)
    }
  }, [rawMap, depthMap])

  const uniforms = useMemo(
    () => ({
      uMap: { value: rawMap },
      uDepth: { value: depthMap },
      uPointer: { value: new THREE.Vector2(0, 0) },
      uProgress: { value: 0 },
      uOpacity: { value: 0 },
      uAspect: { value: WIDTH / HEIGHT },
    }),
    [rawMap, depthMap],
  )

  const [w, h] = useAspect(WIDTH, HEIGHT)
  const scaleFactor = 0.5

  useFrame(({ clock, pointer }) => {
    const u = uniforms
    const t = clock.getElapsedTime()
    u.uProgress.value = Math.sin(t * 0.5) * 0.5 + 0.5
    // continuous auto-drift so it moves without a mouse, plus pointer response
    const driftX = Math.sin(t * 0.3) * 0.85 + pointer.x * 0.5
    const driftY = Math.cos(t * 0.23) * 0.6 + pointer.y * 0.5
    u.uPointer.value.x += (driftX - u.uPointer.value.x) * 0.04
    u.uPointer.value.y += (driftY - u.uPointer.value.y) * 0.04
    u.uOpacity.value = THREE.MathUtils.lerp(u.uOpacity.value, visible ? 1 : 0, 0.06)
  })

  return (
    <mesh scale={[w * scaleFactor, h * scaleFactor, 1]}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
      />
    </mesh>
  )
}

function Resizer() {
  // keep DPR modest for perf
  const setDpr = useThree((s) => s.setDpr)
  useEffect(() => setDpr(Math.min(window.devicePixelRatio || 1, 1.75)), [setDpr])
  return null
}

const TITLE_WORDS = ['강의를', '통째로', '흡수하다']
const SUBTITLE = '듣는 순간 정리되고, 다시 설명하며 완성되는 — 다음 세대의 학습 방식.'

export function HeroFuturistic() {
  const [visibleWords, setVisibleWords] = useState(0)
  const [subtitleVisible, setSubtitleVisible] = useState(false)
  const [delays, setDelays] = useState<number[]>([])

  useEffect(() => {
    setDelays(TITLE_WORDS.map(() => Math.random() * 0.07))
  }, [])

  useEffect(() => {
    if (visibleWords < TITLE_WORDS.length) {
      const t = setTimeout(() => setVisibleWords((v) => v + 1), 480)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setSubtitleVisible(true), 600)
    return () => clearTimeout(t)
  }, [visibleWords])

  return (
    <div className="relative h-svh w-full">
      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center px-10 text-center">
        <div className="font-display text-3xl font-extrabold uppercase tracking-tight md:text-5xl xl:text-6xl">
          <div className="flex space-x-3 overflow-hidden text-white lg:space-x-6">
            {TITLE_WORDS.map((word, i) => (
              <div
                key={i}
                className={i < visibleWords ? 'ff-fade-in' : ''}
                style={{ animationDelay: `${i * 0.12 + (delays[i] || 0)}s`, opacity: i < visibleWords ? undefined : 0 }}
              >
                {word}
              </div>
            ))}
          </div>
        </div>
        <div className="mt-3 overflow-hidden text-sm font-semibold text-white/75 md:text-lg xl:text-xl">
          <div
            className={subtitleVisible ? 'ff-fade-in-subtitle' : ''}
            style={{ opacity: subtitleVisible ? undefined : 0 }}
          >
            {SUBTITLE}
          </div>
        </div>
      </div>

      <Canvas flat camera={{ position: [0, 0, 5], fov: 50 }} gl={{ antialias: true, alpha: true }}>
        <Resizer />
        <Scene />
      </Canvas>
    </div>
  )
}

export default HeroFuturistic
