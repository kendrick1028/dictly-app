'use client'

import { useEffect, useRef } from 'react'

declare global {
  interface Window {
    THREE: any
  }
}

const THREE_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/89/three.min.js'

/**
 * Animated fragment-shader "lines" background (Three.js r89, loaded from CDN).
 * Source: 21st.dev "Shader Lines". Adapted for Dictly with DPR cap + reduced-motion guard.
 */
export function ShaderAnimation() {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<{
    renderer: any
    animationId: number | null
    cleanup?: () => void
  }>({ renderer: null, animationId: null })

  useEffect(() => {
    let removed = false

    const start = () => {
      if (containerRef.current && window.THREE) initThreeJS()
    }

    let script = document.querySelector<HTMLScriptElement>(`script[src="${THREE_SRC}"]`)
    if (window.THREE) {
      start()
    } else if (script) {
      script.addEventListener('load', start)
    } else {
      script = document.createElement('script')
      script.src = THREE_SRC
      script.addEventListener('load', start)
      document.head.appendChild(script)
    }

    return () => {
      removed = true
      const s = sceneRef.current
      if (s.animationId) cancelAnimationFrame(s.animationId)
      s.cleanup?.()
      try {
        s.renderer?.dispose?.()
      } catch {
        /* noop */
      }
    }

    function initThreeJS() {
      if (!containerRef.current || !window.THREE || removed) return
      try {
      const THREE = window.THREE
      const container = containerRef.current
      container.innerHTML = ''

      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches

      const camera = new THREE.Camera()
      camera.position.z = 1
      const scene = new THREE.Scene()
      const geometry = new THREE.PlaneBufferGeometry(2, 2)

      const uniforms = {
        time: { type: 'f', value: 1.0 },
        resolution: { type: 'v2', value: new THREE.Vector2() },
      }

      const vertexShader = `
        void main() { gl_Position = vec4( position, 1.0 ); }
      `
      const fragmentShader = `
        #define TWO_PI 6.2831853072
        #define PI 3.14159265359
        precision highp float;
        uniform vec2 resolution;
        uniform float time;
        float random (in float x) { return fract(sin(x)*1e4); }
        float random (vec2 st) {
          return fract(sin(dot(st.xy, vec2(12.9898,78.233)))*43758.5453123);
        }
        varying vec2 vUv;
        void main(void) {
          vec2 uv = (gl_FragCoord.xy * 2.0 - resolution.xy) / min(resolution.x, resolution.y);
          vec2 fMosaicScal = vec2(4.0, 2.0);
          vec2 vScreenSize = vec2(256,256);
          uv.x = floor(uv.x * vScreenSize.x / fMosaicScal.x) / (vScreenSize.x / fMosaicScal.x);
          uv.y = floor(uv.y * vScreenSize.y / fMosaicScal.y) / (vScreenSize.y / fMosaicScal.y);
          float t = time*0.06+random(uv.x)*0.4;
          float lineWidth = 0.0008;
          vec3 color = vec3(0.0);
          for(int j = 0; j < 3; j++){
            for(int i=0; i < 5; i++){
              color[j] += lineWidth*float(i*i) / abs(fract(t - 0.01*float(j)+float(i)*0.01)*1.0 - length(uv));
            }
          }
          gl_FragColor = vec4(color[2],color[1],color[0],1.0);
        }
      `

      const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader })
      const mesh = new THREE.Mesh(geometry, material)
      scene.add(mesh)

      const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
      container.appendChild(renderer.domElement)

      const onResize = () => {
        const rect = container.getBoundingClientRect()
        renderer.setSize(rect.width, rect.height)
        uniforms.resolution.value.x = renderer.domElement.width
        uniforms.resolution.value.y = renderer.domElement.height
      }
      onResize()
      window.addEventListener('resize', onResize, false)

      const animate = () => {
        sceneRef.current.animationId = requestAnimationFrame(animate)
        uniforms.time.value += 0.05
        renderer.render(scene, camera)
      }
      if (reduce) {
        renderer.render(scene, camera)
      } else {
        animate()
      }

      sceneRef.current.renderer = renderer
      sceneRef.current.cleanup = () => window.removeEventListener('resize', onResize)
      } catch (e) {
        if (import.meta.env.DEV) console.warn('[shader-lines] init failed', e)
      }
    }
  }, [])

  return <div ref={containerRef} className="absolute h-full w-full" />
}
