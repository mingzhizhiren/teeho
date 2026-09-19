import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

export const SKILL_CHAT_TIMING = {
    character: 24,
    minimum: 700,
    maximum: 3200,
    sendPause: 650,
    hold: 10_000,
    tick: 40,
} as const
export function skillChatDuration(text: string): number {
    return Math.min(
        SKILL_CHAT_TIMING.maximum,
        Math.max(SKILL_CHAT_TIMING.minimum, Array.from(text).length * SKILL_CHAT_TIMING.character),
    )
}

/** 只累计可见页面中的可见时长，完整对话保留十秒后再播放。 */
export function useSkillChatAnimation(
    target: Ref<HTMLElement | null>,
    request: () => string,
    reply: () => string,
) {
    const elapsed = ref(0)
    const started = ref(false)
    const reduced = ref(false)
    let visible = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let lastTick = 0
    let observer: IntersectionObserver | undefined
    let media: MediaQueryList | undefined
    const requestDuration = computed(() => skillChatDuration(request()))
    const replyStart = computed(() => requestDuration.value + SKILL_CHAT_TIMING.sendPause)
    const completion = computed(() => replyStart.value + skillChatDuration(reply()))
    const phase = computed(() => {
        if (reduced.value) return 'complete'
        if (!started.value) return 'idle'
        if (elapsed.value < requestDuration.value) return 'user_typing'
        if (elapsed.value < replyStart.value) return 'user_sent'
        if (elapsed.value < completion.value) return 'agent_typing'
        return 'complete'
    })
    const userText = computed(() =>
        reduced.value
            ? request()
            : Array.from(request())
                  .slice(
                      0,
                      Math.floor(
                          Array.from(request()).length *
                              Math.min(1, elapsed.value / requestDuration.value),
                      ),
                  )
                  .join(''),
    )
    const agentText = computed(() =>
        reduced.value
            ? reply()
            : Array.from(reply())
                  .slice(
                      0,
                      Math.floor(
                          Array.from(reply()).length *
                              Math.max(
                                  0,
                                  Math.min(
                                      1,
                                      (elapsed.value - replyStart.value) /
                                          skillChatDuration(reply()),
                                  ),
                              ),
                      ),
                  )
                  .join(''),
    )
    function advance() {
        const now = performance.now()
        elapsed.value =
            (elapsed.value + now - lastTick) % (completion.value + SKILL_CHAT_TIMING.hold)
        lastTick = now
    }
    function stop() {
        if (timer !== undefined) {
            advance()
            clearTimeout(timer)
            timer = undefined
        }
    }
    function tick() {
        advance()
        timer = setTimeout(tick, SKILL_CHAT_TIMING.tick)
    }
    function reconcile() {
        stop()
        if (reduced.value || !visible || document.hidden) return
        started.value = true
        lastTick = performance.now()
        timer = setTimeout(tick, SKILL_CHAT_TIMING.tick)
    }
    function motionChanged() {
        reduced.value = media?.matches ?? false
        reconcile()
    }
    watch([request, reply], () => {
        elapsed.value = 0
        lastTick = performance.now()
    })
    onMounted(() => {
        media = window.matchMedia('(prefers-reduced-motion: reduce)')
        reduced.value = media.matches
        media.addEventListener('change', motionChanged)
        document.addEventListener('visibilitychange', reconcile)
        if (!('IntersectionObserver' in window)) {
            reduced.value = true
            return
        }
        observer = new IntersectionObserver(
            ([entry]) => {
                visible = Boolean(entry?.isIntersecting)
                reconcile()
            },
            { threshold: 0.2 },
        )
        if (target.value) observer.observe(target.value)
    })
    onBeforeUnmount(() => {
        stop()
        observer?.disconnect()
        media?.removeEventListener('change', motionChanged)
        document.removeEventListener('visibilitychange', reconcile)
    })
    return { phase, userText, agentText }
}
