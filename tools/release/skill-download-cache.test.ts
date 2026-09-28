import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'bun:test'
import { createSkillDistributionService } from '../../server/src/skill-distribution/skill-distribution.service'
import {
    readSkillZip,
    writeSkillZip,
} from '../../server/src/skill-distribution/skill-distribution.zip'

it('serves a rebuilt archive without retaining the first successful download forever', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'teeho-download-cache-'))
    try {
        const archive = join(directory, 'skill.zip')
        const contents = (text: string) =>
            writeSkillZip({
                'teeho/tools/check.txt': new TextEncoder().encode(text),
            })
        await writeFile(archive, contents('old'))
        const download = createSkillDistributionService({
            archivePaths: [archive],
            publicApiUrl: 'http://localhost:9634',
            onError() {},
        })
        await download()
        await writeFile(archive, contents('fixed'))
        const updated = readSkillZip(Buffer.from(await download()))
        expect(new TextDecoder().decode(await updated.get('teeho/tools/check.txt')!.bytes())).toBe(
            'fixed',
        )
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})
