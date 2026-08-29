/**
 * 香尽钟音 -- WebAudio 现场合成的一声柔和颂钵，无任何音频文件。
 *
 * 基频叠加两组非整数倍泛音（颂钵的「失谐」质感），指数衰减约 3 秒，
 * 主增益压到极轻。AudioContext 惰性创建：首次在用户手势（点香）中调用
 * prepareChime() 以规避自动播放限制，之后 fire() 处直接发声。
 */

const MASTER_GAIN = 0.06

/** 颂钵的基频与两组失谐泛音：[频率倍数, 相对增益]。 */
const PARTIALS: [number, number][] = [
  [1, 1],
  [2.71, 0.42],
  [5.4, 0.14],
]

const BASE_FREQ = 523 // C5，偏高一点更显「远」

let ctx: AudioContext | null = null

/** 在用户手势中调用一次，提前解锁 AudioContext。 */
export function prepareChime() {
  try {
    if (!ctx) ctx = new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
  } catch {
    // AudioContext 不可用（极旧环境）-- 静默降级为纯视觉提醒。
    ctx = null
  }
}

/** 香尽时轻唤一声。 */
export function playIncenseChime() {
  if (!ctx || ctx.state !== 'running') return
  const now = ctx.currentTime

  const master = ctx.createGain()
  master.gain.value = MASTER_GAIN
  master.connect(ctx.destination)

  for (const [ratio, gain] of PARTIALS) {
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = BASE_FREQ * ratio

    const env = ctx.createGain()
    // 10ms 起音；随后指数衰减，约 3 秒内保持可闻，尾音至 3.8s 散尽。
    env.gain.setValueAtTime(0, now)
    env.gain.linearRampToValueAtTime(gain, now + 0.01)
    env.gain.exponentialRampToValueAtTime(0.001, now + 3)
    env.gain.exponentialRampToValueAtTime(0.0001, now + 3.8)

    osc.connect(env).connect(master)
    osc.start(now)
    osc.stop(now + 4)
  }
}

/** 入定钵：比香尽钵低纯五度、起音更缓、增益更轻——像一声很远的应答。 */
export function playZenEnterChime() {
  // 首次调用多半已在点击/按键的手势里，现场解锁一次。
  prepareChime()
  if (!ctx) return
  if (ctx.state === 'suspended') void ctx.resume()
  const now = ctx.currentTime

  const master = ctx.createGain()
  master.gain.value = 0.032
  master.connect(ctx.destination)

  for (const [ratio, gain] of PARTIALS) {
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = 349 * ratio // F4

    const env = ctx.createGain()
    // 80ms 缓起如轻抚，4 秒主音，尾音至 5.2s 散尽。
    env.gain.setValueAtTime(0, now)
    env.gain.linearRampToValueAtTime(gain, now + 0.08)
    env.gain.exponentialRampToValueAtTime(0.001, now + 4)
    env.gain.exponentialRampToValueAtTime(0.0001, now + 5.2)

    osc.connect(env).connect(master)
    osc.start(now)
    osc.stop(now + 5.4)
  }
}
