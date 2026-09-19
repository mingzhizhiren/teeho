import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

/** 明确 Markdown 字符集，避免浏览器按本地编码显示中文。 */
function serveSkillDocument(filePath: string) {
    return (request: IncomingMessage, response: ServerResponse, next: () => void): void => {
        const path = new URL(request.url ?? '/', 'http://localhost').pathname
        if (path !== '/skill-install.md' || !['GET', 'HEAD'].includes(request.method ?? '')) {
            next()
            return
        }
        void readFile(filePath).then(
            (bytes) => {
                response.setHeader('Content-Type', 'text/markdown; charset=utf-8')
                response.setHeader('Content-Length', bytes.byteLength)
                response.setHeader('Cache-Control', 'no-cache')
                response.setHeader('X-Content-Type-Options', 'nosniff')
                response.end(request.method === 'HEAD' ? undefined : bytes)
            },
            () => {
                response.statusCode = 503
                response.setHeader('Content-Type', 'text/plain; charset=utf-8')
                response.end(
                    request.method === 'HEAD'
                        ? undefined
                        : 'Skill installation instructions are temporarily unavailable.',
                )
            },
        )
    }
}

/** 开发读取 public，预览读取实际构建产物，均不改写文件编码。 */
export function createSkillDocumentPlugin(): Plugin {
    return {
        name: 'teeho-skill-document-charset',
        configureServer(server) {
            server.middlewares.use(
                serveSkillDocument(resolve(server.config.publicDir, 'skill-install.md')),
            )
        },
        configurePreviewServer(server) {
            server.middlewares.use(
                serveSkillDocument(
                    resolve(server.config.root, server.config.build.outDir, 'skill-install.md'),
                ),
            )
        },
    }
}
