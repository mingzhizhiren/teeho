import { expect, test } from 'bun:test'
import { resolve } from 'node:path'

test('宿主和示例配置的构建不解析官方私有插件', async () => {
    const outputs = await Bun.build({
        entrypoints: [
            resolve(import.meta.dir, '../../server/src/app.ts'),
            resolve(import.meta.dir, '../../plugins/example/config.ts'),
        ],
        target: 'bun',
        write: false,
        define: { DEBUG: 'false' },
        external: ['pino'],
        plugins: [
            {
                name: 'exclude-private-plugins',
                setup(build) {
                    build.onResolve({ filter: /plugins[\\/]official|algorithm[-_]train/ }, () => {
                        throw new Error('Public build imports private plugin')
                    })
                },
            },
        ],
    })
    expect(outputs.success).toBe(true)
    expect(outputs.outputs.length).toBeGreaterThan(0)
})
