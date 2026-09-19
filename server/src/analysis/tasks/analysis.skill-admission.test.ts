import { expect, it } from 'vitest'
import { analysisDraftSchema } from '../analysis.schema'
import { previewAnalysisDraft } from '../analysis.service'

it('无封面和未知赛道的完整文字可形成图文任务预览', async () => {
    const draft = analysisDraftSchema.parse({
        inputMode: 'custom',
        rawText: '',
        imageReferences: [],
        fields: { title: '早餐做法', body: '准备食材，按步骤完成早餐。', topics: ['早餐'] },
    })
    const preview = await previewAnalysisDraft('00000000-0000-4000-8000-000000000001', draft, {
        loadImages: async () => [],
    })
    expect(preview.acceptance.status).toBe('clarification_required')
    expect(preview.standardTask).toBeNull()
    expect(preview.standardTask?.coverReference).toBeUndefined()
})
