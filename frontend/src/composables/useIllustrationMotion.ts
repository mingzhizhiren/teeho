import { animate, createTimeline, utils, type JSAnimation, type Timeline } from 'animejs'
import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

const MOTION = {
    entryDuration: 850,
    calmDuration: 400,
    entryStep: 95,
    defaultOffset: 36,
    pointerTravel: 18,
    pointerDuration: 650,
    normalRange: 2,
    floatDistance: 7,
    idleDuration: 4200,
    idleStep: 650,
    steamOpacityMin: 0.2,
    steamOpacityMax: 0.6,
} as const
type IllustrationPhase = 'waiting' | 'assembling' | 'idle'

interface IllustrationMotion {
    readonly phase: Readonly<Ref<IllustrationPhase>>
    readonly isReady: Readonly<Ref<boolean>>
    readonly isInitialized: Readonly<Ref<boolean>>
    readonly isMoving: Readonly<Ref<boolean>>
    readonly isReduced: Readonly<Ref<boolean>>
    readonly hasFinePointer: Readonly<Ref<boolean>>
}

/** 按时间线组装插画；入场、待机和鼠标视差使用相互独立的变换层。 */
export function useIllustrationMotion(
    element: Ref<HTMLElement | null>,
    isLively: () => boolean,
): IllustrationMotion {
    const phase = ref<IllustrationPhase>('waiting')
    const isReady = ref(false)
    const isInitialized = ref(false)
    const isVisible = ref(false)
    const isPageVisible = ref(true)
    const isReduced = ref(true)
    const hasFinePointer = ref(false)
    const canPlay = computed(() => isVisible.value && isPageVisible.value)
    const isMoving = computed(
        () =>
            canPlay.value &&
            phase.value === 'idle' &&
            isLively() &&
            hasFinePointer.value &&
            !isReduced.value,
    )
    let entrance: Timeline | undefined
    let idle: JSAnimation[] = []
    let pointer: JSAnimation | undefined
    let observer: IntersectionObserver | undefined
    let frame: number | undefined
    let disposed = false
    let disposeListeners = () => {}

    function movePointer(x: number, y: number, immediate = false): void {
        const target = element.value
        if (!target) return
        pointer?.cancel()
        const values = { '--art-pointer-x': x + 'px', '--art-pointer-y': y + 'px' }
        if (immediate) utils.set(target, values)
        else
            pointer = animate(target, {
                ...values,
                duration: MOTION.pointerDuration,
                ease: 'out(3)',
            })
    }

    function resetPointer(immediate = false): void {
        if (frame !== undefined) cancelAnimationFrame(frame)
        frame = undefined
        movePointer(0, 0, immediate)
    }

    function onPointerMove(event: PointerEvent): void {
        if (!isMoving.value || event.pointerType === 'touch') return
        if (frame !== undefined) cancelAnimationFrame(frame)
        frame = requestAnimationFrame(() => {
            frame = undefined
            const target = element.value
            if (!target || !isMoving.value) return
            const area = target.closest('[data-art-pointer-area]') ?? target
            const bounds = area.getBoundingClientRect()
            if (!bounds.width || !bounds.height) return
            const x = ((event.clientX - bounds.left) / bounds.width) * MOTION.normalRange - 1
            const y = ((event.clientY - bounds.top) / bounds.height) * MOTION.normalRange - 1
            movePointer(
                Math.max(-1, Math.min(1, x)) * MOTION.pointerTravel,
                Math.max(-1, Math.min(1, y)) * MOTION.pointerTravel,
            )
        })
    }

    function syncPlayback(): void {
        if (!isReady.value || !entrance) return
        if (isReduced.value) {
            entrance.complete(true)
            phase.value = 'idle'
            idle.forEach((animation) => {
                animation.pause()
                animation.seek(0)
            })
            resetPointer(true)
            return
        }
        if (phase.value !== 'idle') {
            if (canPlay.value) {
                phase.value = 'assembling'
                entrance.resume()
            } else entrance.pause()
        }
        idle.forEach((animation) => (isMoving.value ? animation.resume() : animation.pause()))
        if (!isMoving.value) resetPointer()
    }

    function prepareEntrance(target: HTMLElement): void {
        entrance = createTimeline({
            autoplay: false,
            onComplete: () => {
                phase.value = 'idle'
            },
        })
        target.querySelectorAll<HTMLElement>('.art-enter').forEach((layer, index) => {
            const delay = Number(layer.dataset.entryDelay ?? index * MOTION.entryStep)
            entrance?.add(
                layer,
                {
                    opacity: [0, 1],
                    '--assembly-x': [(layer.dataset.entryX ?? 0) + 'px', '0px'],
                    '--assembly-y': [(layer.dataset.entryY ?? MOTION.defaultOffset) + 'px', '0px'],
                    '--assembly-rotate': [(layer.dataset.entryRotate ?? 0) + 'deg', '0deg'],
                    duration: isLively() ? MOTION.entryDuration : MOTION.calmDuration,
                    ease: 'out(4)',
                },
                isLively() ? delay : 0,
            )
        })
    }

    function prepareIdle(target: HTMLElement): void {
        idle = Array.from(target.querySelectorAll<HTMLElement>('[data-art-idle]')).map(
            (layer, index) => {
                const sway = layer.dataset.artIdle === 'sway'
                const steam = layer.dataset.artIdle === 'steam'
                return animate(layer, {
                    y: [0, sway ? 0 : -MOTION.floatDistance],
                    rotate: [0, sway ? 1 : 0],
                    ...(steam ? { opacity: [MOTION.steamOpacityMin, MOTION.steamOpacityMax] } : {}),
                    duration: MOTION.idleDuration + index * MOTION.idleStep,
                    ease: 'inOutSine',
                    loop: true,
                    alternate: true,
                    autoplay: false,
                })
            },
        )
    }

    async function revealWhenReady(target: HTMLElement): Promise<void> {
        await Promise.allSettled(
            Array.from(target.querySelectorAll('img')).map((image) => image.decode()),
        )
        if (disposed) return
        isReady.value = true
        syncPlayback()
    }

    function observeScene(target: HTMLElement): void {
        if ('IntersectionObserver' in window) {
            observer = new IntersectionObserver(([entry]) => {
                isVisible.value = Boolean(entry?.isIntersecting)
                if (isVisible.value && !isReady.value) void revealWhenReady(target)
            })
            observer.observe(target)
        } else {
            isVisible.value = true
            void revealWhenReady(target)
        }
    }

    onMounted(() => {
        const target = element.value
        if (!target) return
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
        const fine = window.matchMedia('(hover: hover) and (pointer: fine)')
        const area = target.closest<HTMLElement>('[data-art-pointer-area]') ?? target
        const updatePreferences = () => {
            isReduced.value = reduced.matches
            hasFinePointer.value = fine.matches
        }
        const updateVisibility = () => {
            isPageVisible.value = document.visibilityState !== 'hidden'
        }
        const leave = () => resetPointer()
        updatePreferences()
        updateVisibility()
        prepareEntrance(target)
        prepareIdle(target)
        isInitialized.value = true
        observeScene(target)
        reduced.addEventListener('change', updatePreferences)
        fine.addEventListener('change', updatePreferences)
        document.addEventListener('visibilitychange', updateVisibility)
        area.addEventListener('pointermove', onPointerMove, { passive: true })
        area.addEventListener('pointerleave', leave)
        disposeListeners = () => {
            reduced.removeEventListener('change', updatePreferences)
            fine.removeEventListener('change', updatePreferences)
            document.removeEventListener('visibilitychange', updateVisibility)
            area.removeEventListener('pointermove', onPointerMove)
            area.removeEventListener('pointerleave', leave)
        }
    })
    watch([isReady, canPlay, isReduced, hasFinePointer, phase], syncPlayback)
    onBeforeUnmount(() => {
        disposed = true
        observer?.disconnect()
        disposeListeners()
        if (frame !== undefined) cancelAnimationFrame(frame)
        pointer?.revert()
        entrance?.revert()
        idle.forEach((animation) => animation.revert())
    })
    return { phase, isReady, isInitialized, isMoving, isReduced, hasFinePointer }
}
