import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

import { useSettingsStore } from '@/stores/settings'
import type { PaperTextureLevel, ThemeName } from '@/types/settings'

/**
 * 宣纸颗粒纹理：一个全屏静态 WebGL 叠层（Canvas fixed、pointer-events-none），
 * fragment shader 程序化生成「纸浆细颗粒 + 游走纤维」。
 *
 * 设计约束（对应 doc/计划.md 的「WebGL 纸张纹理」）：
 * - 克制：峰值 alpha 极低（subtle 档约 0.05），文字可读性零影响；
 * - 静态：无常驻 rAF，只在 resize / 主题切换 / 档位变化时标脏重渲一帧；
 * - 降级：WebGL 不可用或 context lost 时静默退回纯色纸底，不报错。
 *
 * 注：叠层在内容之上（z-40）、弹层之下（z-50）--视图根节点涂了不透明
 * bg-paper，放在内容之下会被盖住；低 alpha 的墨色颗粒叠在文字上无感知。
 */

/** 每档的峰值强度（一个颗粒点的最大 alpha）。 */
const LEVEL_STRENGTH: Record<PaperTextureLevel, number> = {
  off: 0,
  subtle: 0.05,
  rich: 0.11,
}

/** 暗色纸底上颗粒更易发灰显脏，自动收敛。 */
const THEME_FACTOR: Record<ThemeName, number> = {
  light: 1,
  sepia: 1,
  dark: 0.6,
}

/** devicePixelRatio 上限：纹理是程序化噪声，2 倍已足够细腻。 */
const MAX_DPR = 2

const VERT_SRC = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`

const FRAG_SRC = `
precision mediump float;

uniform vec2 u_resolution;
uniform vec3 u_ink;
uniform float u_strength;

float hash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(19.7, 11.3);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  // Domain warp so fibers wander instead of running straight.
  float warp = fbm(uv * 8.0);
  // Crisscrossing long fibers - stretched noise, sparse threshold.
  float fibH = smoothstep(0.62, 0.78, fbm(uv * vec2(4.0, 11.0) + warp * 1.6));
  float fibV = smoothstep(0.62, 0.78, fbm(uv * vec2(11.0, 4.0) - warp * 1.6));
  float fiber = max(fibH, fibV);
  // Fine pulp grain at pixel scale.
  float grain = noise(gl_FragCoord.xy / 2.5);
  float v = grain * 0.55 + fiber * 0.7;
  float alpha = clamp(v * u_strength, 0.0, 1.0);
  gl_FragColor = vec4(u_ink, alpha);
}
`

/** Parse a `#rrggbb` CSS variable into 0-1 rgb. Falls back to black. */
function cssVarToRgb(name: string): [number, number, number] {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
  const m = /^#?([0-9a-f]{6})$/i.exec(raw)
  if (!m) return [0, 0, 0]
  const n = Number.parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255) as [
    number,
    number,
    number,
  ]
}

export function usePaperTexture(canvasRef: Ref<HTMLCanvasElement | null>) {
  const settings = useSettingsStore()
  /** False once WebGL proves unavailable - the component then renders nothing. */
  const supported = ref(true)

  let gl: WebGLRenderingContext | null = null
  let program: WebGLProgram | null = null
  let uResolution: WebGLUniformLocation | null = null
  let uInk: WebGLUniformLocation | null = null
  let uStrength: WebGLUniformLocation | null = null
  let rafId = 0
  let resizeTimer = 0

  function compile(type: number, src: string): WebGLShader | null {
    const g = gl!
    const shader = g.createShader(type)
    if (!shader) return null
    g.shaderSource(shader, src)
    g.compileShader(shader)
    if (!g.getShaderParameter(shader, g.COMPILE_STATUS)) {
      console.warn('[zenreader] paper texture shader failed:', g.getShaderInfoLog(shader))
      g.deleteShader(shader)
      return null
    }
    return shader
  }

  /** (Re)create GL resources. Also used after webglcontextrestored. */
  function initGl(): boolean {
    const canvas = canvasRef.value
    if (!canvas) return false
    gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
    })
    const g = gl
    if (!g) {
      supported.value = false
      console.warn('[zenreader] WebGL unavailable - paper stays plain')
      return false
    }
    const vert = compile(g.VERTEX_SHADER, VERT_SRC)
    const frag = compile(g.FRAGMENT_SHADER, FRAG_SRC)
    program = g.createProgram()
    if (!vert || !frag || !program) {
      supported.value = false
      return false
    }
    g.attachShader(program, vert)
    g.attachShader(program, frag)
    g.linkProgram(program)
    if (!g.getProgramParameter(program, g.LINK_STATUS)) {
      console.warn('[zenreader] paper texture program failed:', g.getProgramInfoLog(program))
      supported.value = false
      program = null
      return false
    }
    g.useProgram(program)

    // Fullscreen quad.
    const buffer = g.createBuffer()
    g.bindBuffer(g.ARRAY_BUFFER, buffer)
    g.bufferData(
      g.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      g.STATIC_DRAW,
    )
    const aPos = g.getAttribLocation(program, 'a_pos')
    g.enableVertexAttribArray(aPos)
    g.vertexAttribPointer(aPos, 2, g.FLOAT, false, 0, 0)

    uResolution = g.getUniformLocation(program, 'u_resolution')
    uInk = g.getUniformLocation(program, 'u_ink')
    uStrength = g.getUniformLocation(program, 'u_strength')

    g.enable(g.BLEND)
    // Premultiplied-correct alpha blending for a transparent canvas.
    g.blendFuncSeparate(
      g.SRC_ALPHA,
      g.ONE_MINUS_SRC_ALPHA,
      g.ONE,
      g.ONE_MINUS_SRC_ALPHA,
    )
    return true
  }

  /** Sync the drawing buffer to the element size (capped DPR). */
  function resize() {
    const canvas = canvasRef.value
    const g = gl
    if (!canvas || !g) return
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr))
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    g.viewport(0, 0, w, h)
  }

  function render() {
    const canvas = canvasRef.value
    const g = gl
    if (!canvas || !g || !program) return
    resize()
    g.useProgram(program)
    g.uniform2f(uResolution, canvas.width, canvas.height)
    const [r, gr, b] = cssVarToRgb('--ink')
    g.uniform3f(uInk, r, gr, b)
    g.uniform1f(
      uStrength,
      LEVEL_STRENGTH[settings.paperTexture] * THEME_FACTOR[settings.theme],
    )
    g.clearColor(0, 0, 0, 0)
    g.clear(g.COLOR_BUFFER_BIT)
    g.drawArrays(g.TRIANGLE_STRIP, 0, 4)
  }

  /** Coalesce render requests into a single rAF - never a resident loop. */
  function requestRender() {
    if (rafId || !supported.value || settings.paperTexture === 'off') return
    rafId = requestAnimationFrame(() => {
      rafId = 0
      render()
    })
  }

  /** React to level/theme changes: hide when off, redraw otherwise. */
  function apply() {
    const canvas = canvasRef.value
    if (!canvas || !supported.value) return
    if (settings.paperTexture === 'off') {
      canvas.style.display = 'none'
      return
    }
    canvas.style.display = ''
    requestRender()
  }

  function onContextLost(e: Event) {
    // Allow restore; the canvas clears itself - pure paper until then.
    e.preventDefault()
  }

  function onContextRestored() {
    if (initGl()) apply()
  }

  function onResize() {
    window.clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(requestRender, 150)
  }

  watch([() => settings.paperTexture, () => settings.theme], apply)

  onMounted(() => {
    const canvas = canvasRef.value
    if (!canvas) return
    canvas.addEventListener('webglcontextlost', onContextLost)
    canvas.addEventListener('webglcontextrestored', onContextRestored)
    if (!initGl()) return
    apply()
    window.addEventListener('resize', onResize)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('resize', onResize)
    window.clearTimeout(resizeTimer)
    if (rafId) cancelAnimationFrame(rafId)
    const canvas = canvasRef.value
    if (canvas) {
      canvas.removeEventListener('webglcontextlost', onContextLost)
      canvas.removeEventListener('webglcontextrestored', onContextRestored)
    }
    // Release the GPU context explicitly - the element is going away.
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
    gl = null
    program = null
  })

  return { supported }
}
