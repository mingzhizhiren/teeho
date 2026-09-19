import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envFile = Bun.file(resolve(serverRoot, '.env'))

if (await envFile.exists()) {
    const content = await envFile.text()
    const debugLine = content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.startsWith('DEBUG='))

    if (debugLine) {
        process.env.DEBUG = debugLine.slice('DEBUG='.length).replace(/^["']|["']$/g, '')
    }
}

process.chdir(serverRoot)

const debugEnabled = process.env.NODE_ENV !== 'production' && process.env.DEBUG === 'true'

Object.defineProperty(globalThis, 'DEBUG', {
    value: debugEnabled,
    writable: false,
    enumerable: false,
    configurable: false,
})
