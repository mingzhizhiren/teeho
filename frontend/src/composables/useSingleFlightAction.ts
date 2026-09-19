import { readonly, ref } from 'vue'

/** 同一时刻只执行一个写动作；重复调用复用当前 Promise。 */
export function useSingleFlightAction<Arguments extends unknown[], Result>(
    action: (...arguments_: Arguments) => Promise<Result>,
) {
    const pending = ref(false)
    let inFlight: Promise<Result> | null = null

    function run(...arguments_: Arguments): Promise<Result> {
        if (inFlight) return inFlight
        pending.value = true
        const execution = Promise.resolve().then(() => action(...arguments_))
        const tracked = execution.finally(() => {
            if (inFlight === tracked) {
                inFlight = null
                pending.value = false
            }
        })
        inFlight = tracked
        return tracked
    }

    return {
        pending: readonly(pending),
        run,
    }
}
