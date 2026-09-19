import { readFile } from 'node:fs/promises'
import { createJsonSource } from '../sdk'

/** 部署者可替换数据读取；返回同一标准事实格式。 */
export const exampleSource = createJsonSource({
    id: 'example/json',
    read: async (signal) =>
        JSON.parse(
            await readFile(new URL('./data/notes.json', import.meta.url), {
                encoding: 'utf8',
                signal,
            }),
        ),
})
