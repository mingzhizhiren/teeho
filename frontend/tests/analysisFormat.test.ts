import { describe, expect, test } from 'bun:test'

import { formatTaskFieldValue } from '@/features/analysis/analysis.format'
import type { TaskFieldDefinition } from '@/features/analysis/analysis.contract'

const translations: Readonly<Record<string, string>> = {
    'workspace.configOptions.track.beautySkincare': '美妆个护',
    'workspace.configOptions.track.foodAndDrink': '美食饮品',
    'workspace.fields.autoPlaceholder': '交给题火',
    'workspace.fields.listSeparator': '、',
}
const translate = (key: string): string => translations[key] ?? key
const englishTranslations: Readonly<Record<string, string>> = {
    'workspace.configOptions.track.beautySkincare': 'Beauty and skincare',
    'workspace.fields.autoPlaceholder': 'Let Teeho decide',
    'workspace.fields.listSeparator': ', ',
}
const translateEnglish = (key: string): string => englishTranslations[key] ?? key

function selectField(
    name: TaskFieldDefinition['name'],
    value: string,
    labelKey: string,
): TaskFieldDefinition {
    return {
        name,
        kind: 'select',
        order: 1,
        labelKey: `field.${name}`,
        helpKey: `help.${name}`,
        defaultValue: value,
        countsAsInput: false,
        options: [{ value, labelKey, enabled: true }],
    }
}

describe('任务字段展示格式', () => {
    test('服务端枚举值使用当前语言的正式选项文案', () => {
        expect(
            formatTaskFieldValue(
                'beauty_skincare',
                translate,
                selectField(
                    'track',
                    'beauty_skincare',
                    'workspace.configOptions.track.beautySkincare',
                ),
            ),
        ).toBe('美妆个护')
        expect(
            formatTaskFieldValue(
                'beauty_skincare',
                translateEnglish,
                selectField(
                    'track',
                    'beauty_skincare',
                    'workspace.configOptions.track.beautySkincare',
                ),
            ),
        ).toBe('Beauty and skincare')
        expect(
            formatTaskFieldValue(
                'food_and_drink',
                translate,
                selectField(
                    'track',
                    'food_and_drink',
                    'workspace.configOptions.track.foodAndDrink',
                ),
            ),
        ).toBe('美食饮品')
    })

    test('话题数组使用当前语言的分隔符', () => {
        expect(formatTaskFieldValue(['#通勤', '#防晒'], translate)).toBe('#通勤、#防晒')
        expect(formatTaskFieldValue(['#通勤', '#防晒'], translateEnglish)).toBe('#通勤, #防晒')
    })
})
