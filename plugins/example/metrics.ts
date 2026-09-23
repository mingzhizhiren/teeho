import { z, type DataMetric } from '../sdk'

export const shapeSchema = z.object({
    titleLength: z.number(),
    bodyLength: z.number(),
    paragraphs: z.number(),
    questions: z.number(),
    variety: z.number(),
})
/** 教学示例使用的原文特征，不调用模型或外部数据。 */
export const shapeMetric: DataMetric = {
    kind: 'feature',
    id: 'example/shape',
    version: '1',
    unit: 'text-features',
    description: '教学文字特征',
    requires: [],
    schema: shapeSchema,
    compute: ({ task }) => {
        const body = task.fields.body.value
        return {
            status: 'available',
            value: {
                titleLength: Array.from(task.fields.title.value).length,
                bodyLength: Array.from(body).length,
                paragraphs: body.split(/\n+/u).filter((line) => line.trim()).length,
                questions: (body.match(/[?？]/gu) ?? []).length,
                variety: new Set(Array.from(body)).size / Math.max(1, Array.from(body).length),
            },
        }
    },
}

const DAY_MS = 86_400_000
/** 两次实际观察间的收藏日均净变化；仅一次观察返回不可用。 */
export const growthMetric: DataMetric = {
    kind: 'statistic',
    id: 'example/collection-growth',
    version: '1',
    unit: '次/天',
    description: '合成样本的日均收藏增长，仅用于接口教学',
    requires: [],
    schema: z.number().finite(),
    compute: ({ evidence }) => {
        const growth = evidence.notes.flatMap((note) => {
            const observations = [...note.observations].sort(
                (a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt),
            )
            const latest = observations[0]
            const previous = observations.find(
                (item) =>
                    Date.parse(item.observedAt) < Date.parse(latest!.observedAt) &&
                    item.collects !== null,
            )
            if (!latest || !previous || latest.collects === null || previous.collects === null)
                return []
            return [
                {
                    value:
                        ((latest.collects - previous.collects) * DAY_MS) /
                        (Date.parse(latest.observedAt) - Date.parse(previous.observedAt)),
                    start: previous.observedAt,
                    end: latest.observedAt,
                },
            ]
        })
        const basis = {
            sampleCount: growth.length,
            window: growth.length
                ? {
                      kind: 'observations' as const,
                      start: new Date(
                          Math.min(...growth.map((item) => Date.parse(item.start))),
                      ).toISOString(),
                      end: new Date(
                          Math.max(...growth.map((item) => Date.parse(item.end))),
                      ).toISOString(),
                  }
                : null,
        }
        return growth.length
            ? {
                  status: 'available',
                  basis,
                  value:
                      Math.round(
                          (growth.reduce((sum, item) => sum + item.value, 0) / growth.length) * 100,
                      ) / 100,
              }
            : { status: 'unavailable', reason: 'insufficient_observations', basis }
    },
}
