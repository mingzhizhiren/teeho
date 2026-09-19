import tseslint from 'typescript-eslint'

const serviceImportPattern = '(?:^|/)[^/]+\\.service$'
const repositoryImportPattern = '(?:^|/)[^/]+\\.repository$'
const controllerImportPattern = '(?:^|/)[^/]+\\.controller$'
const routesImportPattern = '(?:^|/)[^/]+\\.routes$'
const workerImportPattern = '(?:^|/)[^/]+\\.worker$'
const databaseImportPattern = '(?:^|/)db/database(?:\\.ts)?$'
const repositoryLayerPatterns = [
    {
        regex: serviceImportPattern,
        message: 'Repository 只负责持久化，不得依赖 Service。',
    },
    {
        regex: repositoryImportPattern,
        message: 'Repository 不得编排其他 Repository；由 Service 协调持久化操作。',
    },
    {
        regex: controllerImportPattern,
        message: 'Repository 不得反向依赖 Controller。',
    },
    {
        regex: routesImportPattern,
        message: 'Repository 不得反向依赖 Routes。',
    },
    {
        regex: workerImportPattern,
        message: 'Repository 不得依赖 Worker。',
    },
]

function restrictLayerImports(patterns) {
    return [
        'error',
        {
            patterns,
        },
    ]
}

export default [
    {
        ignores: ['coverage/**', 'dist/**'],
    },
    ...tseslint.configs.recommended,
    {
        files: ['src/**/*.ts'],
        languageOptions: {
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
            },
            globals: {
                Bun: 'readonly',
                Buffer: 'readonly',
                crypto: 'readonly',
                process: 'readonly',
            },
        },
        rules: {
            'no-undef': 'off',
        },
    },
    {
        files: ['src/**/*.ts'],
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
        files: ['src/**/*.repository.ts'],
        rules: {
            'no-restricted-imports': restrictLayerImports(repositoryLayerPatterns),
        },
    },
    {
        files: ['src/analysis/**/*.repository.ts'],
        rules: {
            'no-restricted-imports': restrictLayerImports([
                ...repositoryLayerPatterns,
                {
                    regex: databaseImportPattern,
                    importNames: ['withTransaction'],
                    message: 'Analysis Repository 的事务边界由 Service 持有。',
                },
            ]),
        },
    },
    {
        files: ['src/**/*.service.ts'],
        rules: {
            'no-restricted-imports': restrictLayerImports([
                {
                    regex: controllerImportPattern,
                    message: 'Service 不得反向依赖 Controller。',
                },
                {
                    regex: routesImportPattern,
                    message: 'Service 不得反向依赖 Routes。',
                },
                {
                    regex: workerImportPattern,
                    message: 'Service 不得依赖进程内 Worker；通过应用装配注入调度能力。',
                },
            ]),
        },
    },
    {
        files: ['src/**/*.controller.ts'],
        rules: {
            'no-restricted-imports': restrictLayerImports([
                {
                    regex: repositoryImportPattern,
                    message: 'Controller 通过 Service 执行业务，不得绕过 Service 访问 Repository。',
                },
                {
                    regex: routesImportPattern,
                    message: 'Controller 不得反向依赖 Routes。',
                },
                {
                    regex: databaseImportPattern,
                    message: 'Controller 不得直接访问数据库；通过 Service 与 Repository 持久化。',
                },
            ]),
        },
    },
    {
        files: ['src/**/*.routes.ts'],
        rules: {
            'no-restricted-imports': restrictLayerImports([
                {
                    regex: repositoryImportPattern,
                    message: 'Routes 只做协议编排，不得直接访问 Repository。',
                },
                {
                    regex: serviceImportPattern,
                    message: 'Routes 通过 Controller 进入业务，不得绕过 Controller 访问 Service。',
                },
                {
                    regex: databaseImportPattern,
                    message: 'Routes 不得直接访问数据库；通过 Controller 与 Service 进入业务。',
                },
            ]),
        },
    },
]
