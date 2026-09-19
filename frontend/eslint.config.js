import pluginVue from 'eslint-plugin-vue'
import vueTsEslintConfig from '@vue/eslint-config-typescript'

const rawTransportPaths = [
    {
        name: 'axios',
        message: 'HTTP 只能通过 src/api/ 与统一 request 层访问。',
    },
    {
        name: '@/utils/request',
        message: '只有 src/api/ 可以直接访问统一 request 层。',
    },
]

const rawTransportPatterns = [
    {
        regex: '^axios(?:/|$)',
        message: 'HTTP 只能通过 src/api/ 与统一 request 层访问。',
    },
    {
        regex: '(?:^|/)utils/request(?:\\.ts)?$',
        message: '只有 src/api/ 可以直接访问统一 request 层。',
    },
]

const browserPersistencePatterns = [
    {
        regex: '(?:^|/)utils/(?:indexedDbFiles|userCrypto|userLocalStorage)(?:\\.ts)?$',
        message: '页面与展示组件不得直接访问浏览器持久化实现。',
    },
]

const backendSourcePattern = {
    regex: '(?:^|/)server/src(?:/|$)',
    message: '前端不得导入后端源码。',
}

const analysisApiPattern = {
    regex: '(?:^|/)api(?:/|$)',
    message: '页面与展示组件通过 Feature 编排业务，不得直接访问 API。',
}

const userStoragePattern = {
    regex: '(?:^|/)composables/useUserStorage$',
    message: '页面只负责编排，不得直接管理账号本地持久化。',
}

function restrictImports({ paths = [], patterns = [] }) {
    return [
        'error',
        {
            paths,
            patterns,
        },
    ]
}

export default [
    {
        ignores: ['dist/**', 'dist-ssr/**', 'coverage/**'],
    },
    ...pluginVue.configs['flat/recommended'],
    ...vueTsEslintConfig(),
    {
        rules: {
            'vue/multi-word-component-names': 'off',
            'vue/max-attributes-per-line': 'off',
            'vue/singleline-html-element-content-newline': 'off',
            'vue/html-self-closing': 'off',
            'vue/html-indent': ['warn', 4],
            'vue/html-closing-bracket-newline': 'off',
            'vue/multiline-html-element-content-newline': 'off',
        },
    },
    {
        files: ['src/**/*.ts', 'src/**/*.vue'],
        ignores: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
        rules: {
            'no-magic-numbers': [
                'error',
                {
                    ignore: [-1, 0, 1],
                    ignoreArrayIndexes: true,
                    enforceConst: true,
                    detectObjects: false,
                },
            ],
        },
    },
    {
        files: ['src/**/*.ts', 'src/**/*.vue'],
        rules: {
            'no-restricted-imports': restrictImports({
                patterns: [backendSourcePattern],
            }),
        },
    },
    {
        files: ['src/**/*.ts', 'src/**/*.vue'],
        ignores: ['src/api/**/*.ts', 'src/utils/request.ts'],
        rules: {
            'no-restricted-imports': restrictImports({
                paths: rawTransportPaths,
                patterns: [...rawTransportPatterns, backendSourcePattern],
            }),
        },
    },
    {
        files: ['src/pages/**/*.vue'],
        rules: {
            'no-restricted-imports': restrictImports({
                paths: [
                    ...rawTransportPaths,
                    {
                        name: '@/composables/useUserStorage',
                        message: '页面只负责编排，不得直接管理账号本地持久化。',
                    },
                ],
                patterns: [
                    ...rawTransportPatterns,
                    analysisApiPattern,
                    userStoragePattern,
                    ...browserPersistencePatterns,
                    backendSourcePattern,
                ],
            }),
        },
    },
    {
        files: ['src/components/**/*.vue'],
        rules: {
            'no-restricted-imports': restrictImports({
                paths: rawTransportPaths,
                patterns: [
                    ...rawTransportPatterns,
                    analysisApiPattern,
                    ...browserPersistencePatterns,
                    backendSourcePattern,
                ],
            }),
        },
    },
    {
        files: ['src/features/**/*.vue'],
        rules: {
            'no-restricted-imports': restrictImports({
                paths: rawTransportPaths,
                patterns: [
                    ...rawTransportPatterns,
                    ...browserPersistencePatterns,
                    backendSourcePattern,
                ],
            }),
        },
    },
]
