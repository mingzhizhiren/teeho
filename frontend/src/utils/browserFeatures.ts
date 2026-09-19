const localStorageTestKey = '__teeho_storage_test__'
const indexedDbProbeDatabaseName = '__teeho_indexeddb_probe__'
const indexedDbProbeStoreName = 'probe'

type BrowserStorage = Pick<Storage, 'setItem' | 'removeItem'>

/** 浏览器能力检测所需的最小运行环境。 */
export interface BrowserFeatureEnvironment {
    readonly localStorage: BrowserStorage | null
    readonly hasIndexedDB: boolean
    readonly hasWebCrypto: boolean
    readonly hasRandomUUID: boolean
    readonly hasAbortController: boolean
    readonly hasStreamingResponse: boolean
}

function resolveBrowserFeatureEnvironment(): BrowserFeatureEnvironment {
    let localStorage: BrowserStorage | null = null
    if (typeof window !== 'undefined') {
        try {
            localStorage = window.localStorage
        } catch {
            localStorage = null
        }
    }

    const browserCrypto = globalThis.crypto
    return {
        localStorage,
        hasIndexedDB: typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined',
        hasWebCrypto:
            typeof browserCrypto !== 'undefined' &&
            typeof browserCrypto.subtle !== 'undefined' &&
            typeof browserCrypto.getRandomValues === 'function',
        hasRandomUUID:
            typeof browserCrypto !== 'undefined' && typeof browserCrypto.randomUUID === 'function',
        hasAbortController: typeof globalThis.AbortController === 'function',
        hasStreamingResponse:
            typeof globalThis.fetch === 'function' &&
            typeof globalThis.ReadableStream === 'function' &&
            typeof globalThis.TextDecoder === 'function',
    }
}

const featureDetectors = {
    localStorage: (environment: BrowserFeatureEnvironment) => {
        if (!environment.localStorage) return false
        try {
            environment.localStorage.setItem(localStorageTestKey, localStorageTestKey)
            environment.localStorage.removeItem(localStorageTestKey)
            return true
        } catch {
            return false
        }
    },
    indexedDB: (environment: BrowserFeatureEnvironment) => environment.hasIndexedDB,
    webCrypto: (environment: BrowserFeatureEnvironment) => environment.hasWebCrypto,
    randomUUID: (environment: BrowserFeatureEnvironment) => environment.hasRandomUUID,
    abortController: (environment: BrowserFeatureEnvironment) => environment.hasAbortController,
    streamingResponse: (environment: BrowserFeatureEnvironment) => environment.hasStreamingResponse,
} as const

/** 当前项目需要检测的浏览器功能 */
export type BrowserFeature = keyof typeof featureDetectors

/** 浏览器功能检测结果 */
export interface BrowserFeatureSupport {
    supported: boolean
    features: Record<BrowserFeature, boolean>
    unsupportedFeatures: BrowserFeature[]
}

/**
 * 检测浏览器是否支持项目所需功能。
 * 新增浏览器能力时，只需在 `featureDetectors` 中补充对应检测器。
 */
export function detectBrowserFeatures(
    environment: BrowserFeatureEnvironment = resolveBrowserFeatureEnvironment(),
): BrowserFeatureSupport {
    const featureNames = Object.keys(featureDetectors) as BrowserFeature[]
    const features = featureNames.reduce<Record<BrowserFeature, boolean>>(
        (result, feature) => ({
            ...result,
            [feature]: featureDetectors[feature](environment),
        }),
        {} as Record<BrowserFeature, boolean>,
    )
    const unsupportedFeatures = featureNames.filter((feature) => !features[feature])

    return {
        supported: unsupportedFeatures.length === 0,
        features,
        unsupportedFeatures,
    }
}

/** 检测 localStorage 是否可实际读写 */
export function supportsLocalStorage() {
    return featureDetectors.localStorage(resolveBrowserFeatureEnvironment())
}

/** 检测浏览器是否暴露 IndexedDB */
export function supportsIndexedDB() {
    return featureDetectors.indexedDB(resolveBrowserFeatureEnvironment())
}

/** 通过一次真实写入和读取识别“暴露接口但不可用”的移动端实现。 */
export function probeIndexedDB(factory: IDBFactory | null = window.indexedDB) {
    if (!factory) return Promise.resolve(false)
    return new Promise<boolean>((resolve) => {
        let settled = false
        const finish = (supported: boolean, database?: IDBDatabase) => {
            if (settled) return
            settled = true
            database?.close()
            try {
                factory.deleteDatabase(indexedDbProbeDatabaseName)
            } catch {
                // 探测库没有业务数据，删除失败不改变能力判断。
            }
            resolve(supported)
        }
        let request: IDBOpenDBRequest
        try {
            request = factory.open(indexedDbProbeDatabaseName, 1)
        } catch {
            finish(false)
            return
        }
        request.addEventListener('upgradeneeded', () => {
            const database = request.result
            if (!database.objectStoreNames.contains(indexedDbProbeStoreName)) {
                database.createObjectStore(indexedDbProbeStoreName)
            }
        })
        request.addEventListener('error', () => finish(false))
        request.addEventListener('blocked', () => finish(false))
        request.addEventListener('success', () => {
            const database = request.result
            try {
                const transaction = database.transaction(
                    indexedDbProbeStoreName,
                    'readwrite',
                )
                const store = transaction.objectStore(indexedDbProbeStoreName)
                store.put('ok', 'capability')
                const read = store.get('capability')
                read.addEventListener('success', () => {
                    finish(read.result === 'ok', database)
                })
                read.addEventListener('error', () => finish(false, database))
                transaction.addEventListener('abort', () => finish(false, database))
                transaction.addEventListener('error', () => finish(false, database))
            } catch {
                finish(false, database)
            }
        })
    })
}
