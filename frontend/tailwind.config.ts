import type { Config } from 'tailwindcss'

/** SaaS 前端 Tailwind 扫描与主题配置 */
export default {
    darkMode: 'class',
    content: ['./index.html', './src/**/*.{vue,ts}'],
    theme: {
        extend: {
            colors: {
                brand: {
                    DEFAULT: 'rgb(var(--color-brand) / <alpha-value>)',
                    hover: 'rgb(var(--color-brand-hover) / <alpha-value>)',
                    vivid: 'rgb(var(--color-brand-vivid) / <alpha-value>)',
                    glow: 'rgb(var(--color-brand-glow) / <alpha-value>)',
                    hot: 'rgb(var(--color-brand-hot) / <alpha-value>)',
                },
                'on-brand': 'rgb(var(--color-on-brand) / <alpha-value>)',
                accent: 'rgb(var(--color-accent) / <alpha-value>)',
                canvas: 'rgb(var(--color-canvas) / <alpha-value>)',
                surface: 'rgb(var(--color-surface) / <alpha-value>)',
                'surface-muted': 'rgb(var(--color-surface-muted) / <alpha-value>)',
                ink: 'rgb(var(--color-text) / <alpha-value>)',
                muted: 'rgb(var(--color-text-muted) / <alpha-value>)',
                line: 'rgb(var(--color-border) / <alpha-value>)',
            },
        },
    },
    plugins: [],
} satisfies Config
