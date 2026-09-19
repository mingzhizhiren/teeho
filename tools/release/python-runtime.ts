import { resolve } from 'node:path'

const PROBE_TIMEOUT_MS = 5000
const PYTHON_PROBE = [
    'import sys, ssl, urllib.request, json, hashlib, zipfile, zlib, tempfile, pathlib, shutil',
    'if sys.version_info < (3, 9): raise SystemExit(1)',
    'print(sys.executable)',
].join('\n')

/** 查找可独立运行技能的 Python；自定义值为可执行文件路径，不经过 shell 解析。 */
export function findPythonExecutable(): string {
    const configured = process.env.TEEHO_PYTHON?.trim()
    const candidates = configured
        ? [[configured]]
        : process.platform === 'win32'
          ? [['py', '-3'], ['python'], ['python3']]
          : [['python3'], ['python']]
    for (const command of candidates) {
        try {
            const result = Bun.spawnSync([...command, '-X', 'utf8', '-c', PYTHON_PROBE], {
                stdout: 'pipe',
                stderr: 'pipe',
                timeout: PROBE_TIMEOUT_MS,
            })
            if (result.exitCode === 0) {
                const executable = result.stdout.toString().trim()
                if (executable) return executable
            }
        } catch {
            // 未安装的命令或不可执行的候选继续尝试；指定路径失败则最终报错。
        }
    }
    throw new Error(
        'Python 3.9+ with the standard library is required. Set TEEHO_PYTHON to its executable path.',
    )
}

if (import.meta.main) {
    const child = Bun.spawn(
        [
            findPythonExecutable(),
            '-B',
            '-S',
            '-X',
            'utf8',
            '-m',
            'unittest',
            'discover',
            '-s',
            process.argv[2] ?? 'skills/teeho/tests',
            '-p',
            process.argv[3] ?? 'test_*.py',
            '-v',
        ],
        {
            cwd: resolve(import.meta.dirname, '../..'),
            stdin: 'inherit',
            stdout: 'inherit',
            stderr: 'inherit',
            env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
        },
    )
    process.exitCode = await child.exited
}
