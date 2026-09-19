import { test, expect } from 'bun:test'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'
import { packageSkill } from './package-skill'
import { findPythonExecutable } from './python-runtime'
import {
    readSkillZip,
    writeSkillZip,
} from '../../server/src/skill-distribution/skill-distribution.zip'
import { createSkillDistributionRoutes } from '../../server/src/skill-distribution/skill-distribution.routes'
import { createSkillDistributionController } from '../../server/src/skill-distribution/skill-distribution.controller'
import { parseAnalysisRequest } from '../../server/src/analysis/http/analysis.http-input'
const pythonExecutable = findPythonExecutable()

test('ZIP 支持 Unicode 文件名、二进制与空文件，损坏包拒绝读取', async () => {
    const zip = writeSkillZip({
        'teeho/说明.md': new TextEncoder().encode('题火 ZIP'),
        'teeho/empty': new Uint8Array(),
        'teeho/binary': new Uint8Array([0, 255, 128, 10]),
    })
    const files = readSkillZip(zip)
    expect(await files.get('teeho/说明.md')!.text()).toBe('题火 ZIP')
    expect(await files.get('teeho/binary')!.bytes()).toEqual(new Uint8Array([0, 255, 128, 10]))
    expect(files.get('teeho/empty')!.size).toBe(0)
    expect(() => readSkillZip(zip.subarray(0, zip.length - 1))).toThrow()
    const corrupted = Buffer.from(zip)
    corrupted[14] ^= 1
    expect(() => readSkillZip(corrupted)).toThrow()
    expect(() => writeSkillZip({ 'teeho/../outside': new Uint8Array() })).toThrow()
    expect(() =>
        readSkillZip(
            writeSkillZip({
                'teeho/a.py': new Uint8Array(),
                'teeho/A.py': new Uint8Array(),
            }),
        ),
    ).toThrow()
})

function zipArchive(bytes: Uint8Array) {
    return {
        files: async () => readSkillZip(bytes),
        async extract(destination: string): Promise<void> {
            const child = Bun.spawn(
                [
                    pythonExecutable,
                    '-S',
                    '-X',
                    'utf8',
                    '-c',
                    'import io,sys,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; z.extractall(sys.argv[1])',
                    destination,
                ],
                { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
            )
            child.stdin.write(bytes)
            child.stdin.end()
            const [code, error] = await Promise.all([
                child.exited,
                new Response(child.stderr).text(),
            ])
            expect(error).toBe('')
            expect(code).toBe(0)
        },
    }
}

async function listFiles(directory: string, prefix = ''): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true })
    const groups = await Promise.all(
        entries.map(async (entry): Promise<string[]> => {
            const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
            if (entry.isDirectory()) return listFiles(join(directory, entry.name), relativePath)
            return entry.isFile() ? [relativePath] : []
        }),
    )
    return groups.flat().sort()
}

test('公开源码目录与 Release ZIP 使用相同的可安装文件', async () => {
    const root = await mkdtemp(join(tmpdir(), 'teeho-public-skill-'))
    try {
        const publicSkill = join(import.meta.dirname, '../../skills/teeho')
        const output = join(root, 'skill.zip')
        await packageSkill(output)
        const archiveFiles = await zipArchive(await Bun.file(output).bytes()).files()
        const expectedPaths = [...archiveFiles.keys()]
            .map((path) => path.replace(/^teeho\//, ''))
            .sort()
        const sourceFiles = (await listFiles(publicSkill)).filter(
            (path) =>
                !path.startsWith('tests/') &&
                !path.includes('__pycache__/') &&
                !path.endsWith('.pyc'),
        )
        expect(sourceFiles).toEqual(expectedPaths)
        for (const relativePath of expectedPaths) {
            expect(await Bun.file(join(publicSkill, relativePath)).bytes()).toEqual(
                await archiveFiles.get(`teeho/${relativePath}`)!.bytes(),
            )
        }
        expect(expectedPaths).toContain('resources/risk-database.json')
        expect(expectedPaths.some((path) => path.includes('tests/') || path.endsWith('.pyc'))).toBe(
            false,
        )
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('Python 安装包生成的文字、图片和视频受理载荷通过真实服务端契约', async () => {
    const root = await mkdtemp(join(tmpdir(), 'teeho-skill-admission-'))
    const note = { title: '已有笔记标题', body: '已有笔记正文内容', topics: ['#生活'] }
    const examples = [
        {
            kind: 'image',
            input: { ...note, body: '', images: ['first.png', 'cover.png'], cover: 'cover.png' },
            imageCount: 2,
            hasCover: true,
        },
        { kind: 'text', input: note, imageCount: 0, hasCover: false },
        {
            kind: 'image',
            input: { ...note, images: ['first.png', 'second.png'], cover: 'second.png' },
            imageCount: 2,
            hasCover: true,
        },
        {
            kind: 'video',
            input: { ...note, videos: ['video.mp4'], images: ['cover.png'] },
            imageCount: 0,
            hasCover: true,
        },
        {
            kind: 'video',
            input: { ...note, videos: ['video.mp4'] },
            imageCount: 0,
            hasCover: false,
        },
    ]
    const program = [
        'import json, sys, uuid',
        'sys.path.insert(0, sys.argv[1])',
        'from teeho_skill.note import normalize_note, build_task_payload',
        'from teeho_skill.errors import TeehoError',
        'def prepare(note):',
        '    try:',
        '        normalized = normalize_note(note)',
        '    except TeehoError as error:',
        '        return {"error": error.code}',
        '    state = {**normalized, "submissionId": str(uuid.uuid4()),',
        '             "assets": [{"id": str(uuid.uuid4())} for _ in normalized["images"]]}',
        '    if normalized["video"]:',
        '        state = {**state, "videoId": str(uuid.uuid4())}',
        '    return build_task_payload(state)',
        'print(json.dumps([prepare(note) for note in json.load(sys.stdin)], ensure_ascii=False))',
    ].join('\n')
    try {
        const output = join(root, 'skill.zip')
        await packageSkill(output)
        await zipArchive(await Bun.file(output).bytes()).extract(root)
        const child = Bun.spawn(
            [pythonExecutable, '-S', '-B', '-X', 'utf8', '-c', program, join(root, 'teeho/tools')],
            { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
        )
        child.stdin.write(JSON.stringify(examples.map((example) => example.input)))
        child.stdin.end()
        const [stdout, stderr, exitCode] = await Promise.all([
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
            child.exited,
        ])
        expect(stderr).toBe('')
        expect(exitCode).toBe(0)
        const payloads: unknown = JSON.parse(stdout)
        if (!Array.isArray(payloads)) throw new Error('Expected Python payload list')
        expect(payloads).toHaveLength(examples.length)
        for (const [index, payload] of payloads.entries()) {
            if (!examples[index].hasCover && examples[index].kind !== 'video') {
                expect(payload).toEqual({ error: 'missing_cover' })
                continue
            }
            const parsed = parseAnalysisRequest(payload)
            expect(parsed.success).toBe(true)
            if (!parsed.success) throw new Error(parsed.message)
            const { admission, draft, submissionId } = parsed.data
            expect(admission?.idempotencyKey).toBe(submissionId)
            expect(admission?.session).toBeNull()
            expect(admission?.mediaBinding.contentKind).toBe(examples[index].kind)
            expect(draft.imageReferences).toHaveLength(examples[index].imageCount)
            expect(Boolean(draft.coverReference)).toBe(examples[index].hasCover)
            expect(Boolean(draft.videoReference)).toBe(examples[index].kind === 'video')
            expect(draft.fields.title).toBe(note.title)
            expect(draft.fields.body).toBe(examples[index].input.body)
            expect(draft.fields.topics).toEqual(['生活'])
            if (examples[index].kind === 'image') {
                expect(draft.coverReference).toBe(draft.imageReferences[1])
            }
        }
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('技能包解包后能运行帮助命令，且不包含凭据或测试', async () => {
    const root = await mkdtemp(join(tmpdir(), 'teeho-skill-package-'))
    try {
        const output = join(root, 'skill.zip')
        const version = await packageSkill(output)
        const archive = zipArchive(await Bun.file(output).bytes())
        const files = await archive.files()
        const skillMarkdown = await files.get('teeho/SKILL.md')!.text()
        const sourceMarkdown = await Bun.file(
            join(import.meta.dirname, '../../skills/teeho/SKILL.md'),
        ).text()
        expect(skillMarkdown).toBe(sourceMarkdown)
        expect(version).toBe(sourceMarkdown.match(/version:\s*["']([^"']+)["']/)?.[1])
        expect([...files.keys()].filter((path) => path.endsWith('.md')).sort()).toEqual([
            'teeho/README.md',
            'teeho/SKILL.md',
            'teeho/references/uninstall.md',
        ])
        const installation = await Bun.file(
            join(import.meta.dirname, '../../frontend/public/skill-install.md'),
        ).text()
        const configBlock = installation.match(/```json\s*([\s\S]*?)```/)?.[1]
        if (!configBlock) throw new Error('Missing installation configuration')
        const requiredFiles: unknown = JSON.parse(configBlock).required_files
        if (!Array.isArray(requiredFiles)) throw new Error('Missing required installation files')
        for (const path of requiredFiles) {
            expect(typeof path).toBe('string')
            expect(files.has(`teeho/${path}`)).toBe(true)
        }
        // 检查实际归档中的文档链接，防止入口引用了未打包的文件。
        for (const [path, file] of files) {
            if (!path.endsWith('.md')) continue
            for (const match of (await file.text()).matchAll(/\]\(([^)\s]+)\)/g)) {
                const target = match[1].split('#')[0]
                if (!target || target.startsWith('/') || /^[a-z]+:/i.test(target)) continue
                const resolved = posix.normalize(posix.join(posix.dirname(path), target))
                expect(resolved.startsWith('teeho/')).toBe(true)
                expect(files.has(resolved)).toBe(true)
            }
        }
        expect(
            [...files.keys()].some((path) =>
                /\.env|\.test\.|identity\.json|\.mjs$|\.pyc$|__pycache__|\/tests\/|\/test_[^/]+$/.test(
                    path,
                ),
            ),
        ).toBe(false)
        expect(files.has('teeho/tools/teeho.py')).toBe(true)
        expect(files.has('teeho/tools/teeho_skill/__init__.py')).toBe(true)
        expect(files.has('teeho/tools/teeho_skill/api.py')).toBe(true)
        expect(files.has('teeho/tools/teeho_skill/http_transport.py')).toBe(true)
        expect(JSON.parse(await files.get('teeho/resources/risk-database.json')!.text())).toEqual(
            await Bun.file(
                new URL('../../skills/teeho/resources/risk-database.json', import.meta.url),
            ).json(),
        )
        await archive.extract(root)
        const child = Bun.spawn(
            [
                pythonExecutable,
                '-S',
                '-X',
                'utf8',
                join(root, 'teeho', 'tools', 'teeho.py'),
                'help',
            ],
            {
                stdout: 'pipe',
                stderr: 'pipe',
                env: {
                    ...process.env,
                    PYTHONDONTWRITEBYTECODE: '1',
                    TEEHO_API_URL: '',
                    TEEHO_HOME: join(root, 'data'),
                },
            },
        )
        const result = JSON.parse(await new Response(child.stdout).text())
        expect(await child.exited).toBe(0)
        expect(result.toolsData.topics).toEqual([
            'account',
            'diagnose',
            'task',
            'status',
            'history',
            'help',
        ])
        expect(result.displayText).toContain('All Teeho features')
        const renderInput = join(root, 'render-input.json')
        await Bun.write(
            renderInput,
            JSON.stringify({
                presentationId: result.presentationId,
                translations: {},
            }),
        )
        const rendered = Bun.spawn(
            [
                pythonExecutable,
                '-S',
                '-X',
                'utf8',
                join(root, 'teeho', 'tools', 'teeho.py'),
                'render',
                '--input-file',
                renderInput,
            ],
            {
                stdout: 'pipe',
                stderr: 'pipe',
                env: {
                    ...process.env,
                    PYTHONDONTWRITEBYTECODE: '1',
                    TEEHO_API_URL: '',
                    TEEHO_HOME: join(root, 'data'),
                },
            },
        )
        const renderedResult = JSON.parse(await new Response(rendered.stdout).text())
        expect(await rendered.exited).toBe(0)
        expect(renderedResult.toolsData.topics).toEqual(result.toolsData.topics)
        const instructions = await Bun.file(
            new URL('../../frontend/public/skill-install.md', import.meta.url),
        ).text()
        const featureCheck = instructions
            .split('\n')
            .find((line) => line.startsWith('| 功能检查 |'))
        expect(featureCheck).toBeDefined()
        const documentedFields = [...featureCheck!.matchAll(/`toolsData\.(\w+)`/gu)]
        expect(documentedFields.length).toBeGreaterThan(0)
        for (const [, field] of documentedFields) {
            expect(Array.isArray(result.toolsData[field!])).toBe(true)
            expect(result.toolsData[field!].length).toBeGreaterThan(0)
        }
        const check = Bun.spawn(
            [
                pythonExecutable,
                '-S',
                '-X',
                'utf8',
                join(root, 'teeho', 'tools', 'teeho.py'),
                'installation',
            ],
            {
                stdout: 'pipe',
                stderr: 'pipe',
                env: {
                    ...process.env,
                    PYTHONDONTWRITEBYTECODE: '1',
                    TEEHO_API_URL: '',
                    TEEHO_HOME: join(root, 'data'),
                },
            },
        )
        expect(JSON.parse(await new Response(check.stdout).text()).toolsData).toEqual({
            apiUrl: 'https://teeho.chat/api',
            configured: true,
        })
        expect(await check.exited).toBe(0)
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('安装包跨进程恢复本站身份，切换服务不复用另一站凭据，重复安装保留身份', async () => {
    const root = await mkdtemp(join(tmpdir(), 'teeho-skill-environments-'))
    const fakeApi = (label: string, userId: string) =>
        Bun.serve({
            port: 0,
            hostname: '127.0.0.1',
            fetch(request) {
                const path = new URL(request.url).pathname
                const data = path.endsWith('/start')
                    ? {
                          userCode: label,
                          verificationUrl: 'https://example.test/authorize',
                          interval: 5000,
                      }
                    : path.endsWith('/token')
                      ? {
                            user: {
                                id: userId,
                                email: label + '@example.test',
                                isAnonymous: false,
                            },
                            expiresAt: null,
                            accessToken: `test-${label}`,
                            accessExpiresAt: '2099-01-01T00:00:00Z',
                        }
                      : {
                            summary: {
                                enabled: true,
                                balances: { free: 30, package: 0, purchased: 0, total: 30 },
                            },
                        }
                return Response.json({ code: 0, data })
            },
        })
    const first = fakeApi('first', '10000000-0000-4000-8000-000000000001')
    const second = fakeApi('second', '10000000-0000-4000-8000-000000000002')
    try {
        const output = join(root, 'source.zip')
        await packageSkill(output)
        const archive = zipArchive(await Bun.file(output).bytes())
        await archive.extract(root)
        const endpoint = join(root, 'teeho/endpoint.json')
        const run = async (command: string) => {
            const child = Bun.spawn(
                [pythonExecutable, '-S', '-X', 'utf8', join(root, 'teeho/tools/teeho.py'), command],
                {
                    stdout: 'pipe',
                    stderr: 'pipe',
                    env: {
                        ...process.env,
                        PYTHONDONTWRITEBYTECODE: '1',
                        TEEHO_API_URL: '',
                        TEEHO_HOME: join(root, 'home'),
                    },
                },
            )
            const result = JSON.parse(await new Response(child.stdout).text())
            await child.exited
            return result
        }
        await writeFile(endpoint, JSON.stringify({ apiUrl: `${first.url.origin}/api` }))
        await run('login')
        expect((await run('login-status')).state).toBe('authenticated')
        expect((await run('status')).displayText).toContain('first@example.test')
        await writeFile(endpoint, JSON.stringify({ apiUrl: `${second.url.origin}/api` }))
        expect((await run('status')).state).toBe('login_required')
        await run('login')
        expect((await run('login-status')).state).toBe('authenticated')
        expect((await run('status')).displayText).toContain('second@example.test')
        await archive.extract(root)
        await writeFile(endpoint, JSON.stringify({ apiUrl: `${first.url.origin}/api/` }))
        expect((await run('status')).displayText).toContain('first@example.test')
        await writeFile(endpoint, '{broken')
        expect((await run('installation')).state).toBe('invalid_configuration')
    } finally {
        first.stop(true)
        second.stop(true)
        await rm(root, { recursive: true, force: true })
    }
})

test('同一静态包按部署配置下载，本地与正式站安装后自动使用对应API', async () => {
    const root = await mkdtemp(join(tmpdir(), 'teeho-skill-download-'))
    try {
        const output = join(root, 'source.zip')
        await packageSkill(output)
        for (const publicApiUrl of ['http://localhost:9634', 'https://teeho.chat']) {
            const app = createSkillDistributionRoutes(
                createSkillDistributionController({
                    publicApiUrl,
                    archivePaths: [output],
                    onError: () => {
                        throw new Error('unexpected_download_error')
                    },
                }),
            )
            const response = await app.handle(
                new Request('http://spoofed.example/skill/download', {
                    headers: { 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' },
                }),
            )
            expect(response.status).toBe(200)
            expect(response.headers.get('content-type')).toBe('application/zip')
            expect(response.headers.get('content-disposition')).toBe(
                'attachment; filename="teeho-skill.zip"',
            )
            const archive = zipArchive(await response.bytes())
            const configuredFiles = await archive.files()
            expect(JSON.parse(await configuredFiles.get('teeho/endpoint.json')!.text()).debug).toBe(
                publicApiUrl.startsWith('http:'),
            )
            const destination = join(
                root,
                publicApiUrl.startsWith('https') ? 'production' : 'local',
            )
            await archive.extract(destination)
            const child = Bun.spawn(
                [
                    pythonExecutable,
                    '-S',
                    '-X',
                    'utf8',
                    join(destination, 'teeho/tools/teeho.py'),
                    'installation',
                ],
                {
                    stdout: 'pipe',
                    stderr: 'pipe',
                    env: {
                        ...process.env,
                        PYTHONDONTWRITEBYTECODE: '1',
                        TEEHO_API_URL: '',
                        TEEHO_HOME: join(root, 'data'),
                    },
                },
            )
            expect(JSON.parse(await new Response(child.stdout).text()).toolsData).toEqual({
                apiUrl: publicApiUrl + '/api',
                configured: true,
            })
            expect(await child.exited).toBe(0)
        }
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('下载失败只返回安全错误，部署文件补齐后同一接口可恢复', async () => {
    const root = await mkdtemp(join(tmpdir(), 'teeho-skill-retry-'))
    try {
        const output = join(root, 'missing.zip')
        const errors: unknown[] = []
        const app = createSkillDistributionRoutes(
            createSkillDistributionController({
                publicApiUrl: 'https://teeho.chat/api/',
                archivePaths: [output],
                onError: (error) => errors.push(error),
            }),
        )
        const first = await app.handle(new Request('http://localhost/skill/download'))
        expect(first.status).toBe(503)
        expect(await first.json()).toEqual({
            code: 5000,
            message: '技能下载暂不可用，请稍后重试',
            data: null,
        })
        expect(errors).toHaveLength(1)
        await packageSkill(output)
        const recovered = await app.handle(new Request('http://localhost/skill/download'))
        expect(recovered.status).toBe(200)
        const files = await zipArchive(await recovered.bytes()).files()
        expect(JSON.parse(await files.get('teeho/endpoint.json')!.text())).toEqual({
            apiUrl: 'https://teeho.chat/api',
            debug: false,
        })
        for (const publicApiUrl of [
            'https://user:secret@example.com',
            'https://example.com?token=secret',
            'http://example.com',
            'file:///tmp/skill',
            'https://example.com/other',
        ]) {
            const invalid = createSkillDistributionRoutes(
                createSkillDistributionController({
                    publicApiUrl,
                    archivePaths: [output],
                    onError: () => {},
                }),
            )
            const response = await invalid.handle(new Request('http://localhost/skill/download'))
            expect(response.status).toBe(503)
            expect(await response.text()).not.toContain('secret')
        }
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})
