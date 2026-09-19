import DOMPurify from 'dompurify'
import { marked } from 'marked'

const allowedTags = [
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'p',
    'ul',
    'ol',
    'li',
    'a',
    'blockquote',
    'pre',
    'code',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'img',
    'hr',
    'strong',
    'em',
    'del',
    'br',
] as const
const allowedAttributes = ['href', 'src', 'alt', 'title'] as const
const tableOfContentsSelector = 'h2, h3, h4'
const minimumHeadingLevel = 2

/** 文档目录中的稳定标题条目。 */
export interface DocumentHeading {
    readonly id: string
    readonly text: string
    readonly level: number
}

export interface SafeMarkdownResult {
    readonly html: string
    readonly headings: readonly DocumentHeading[]
}

export interface SafeMarkdownDomAdapter {
    sanitize: (html: string, policy: SafeMarkdownSanitizePolicy) => string
    parse: (html: string) => Document
}

export interface SafeMarkdownSanitizePolicy {
    readonly allowedTags: readonly string[]
    readonly allowedAttributes: readonly string[]
}

const safeMarkdownSanitizePolicy: SafeMarkdownSanitizePolicy = {
    allowedTags,
    allowedAttributes,
}

function createHeadingId(text: string, occurrence: number) {
    const base =
        text
            .normalize('NFKC')
            .trim()
            .toLocaleLowerCase()
            .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
            .replace(/^-+|-+$/gu, '') || 'section'
    return occurrence > 1 ? `${base}-${occurrence}` : base
}

function isAllowedLink(value: string) {
    if (value.startsWith('#')) return true
    if (/^(?:\/(?!\/)|\.\.?\/|\?)[^\s\\]*$/u.test(value)) return true
    if (/^mailto:[^\s@]+@[^\s@]+$/iu.test(value)) return true
    try {
        return new URL(value).protocol === 'https:'
    } catch {
        return false
    }
}

function isAllowedImage(value: string) {
    if (value.startsWith('/images/')) return true
    try {
        return new URL(value).protocol === 'https:'
    } catch {
        return false
    }
}

function createBrowserDomAdapter(): SafeMarkdownDomAdapter {
    if (typeof DOMParser === 'undefined') {
        throw new Error('当前环境缺少 Markdown DOM Adapter')
    }
    return {
        sanitize: (html, policy) =>
            DOMPurify.sanitize(html, {
                ALLOWED_TAGS: [...policy.allowedTags],
                ALLOWED_ATTR: [...policy.allowedAttributes],
            }),
        parse: (html) => new DOMParser().parseFromString(html, 'text/html'),
    }
}

/** 移除已经由文档页面标题展示的首个一级标题。 */
export function getDocumentBodyMarkdown(markdown: string) {
    return markdown.replace(/^#\s+[^\n]+\n*/u, '').trim()
}

/** 将 Markdown 解析、净化并补充稳定标题锚点。 */
export function renderSafeMarkdown(
    markdown: string,
    domAdapter: SafeMarkdownDomAdapter = createBrowserDomAdapter(),
): SafeMarkdownResult {
    const parsed = marked.parse(markdown, { async: false, gfm: true })
    const sanitized = domAdapter.sanitize(parsed, safeMarkdownSanitizePolicy)
    const document = domAdapter.parse(sanitized)

    for (const link of document.querySelectorAll('a')) {
        const href = link.getAttribute('href') ?? ''
        if (!isAllowedLink(href)) {
            link.removeAttribute('href')
            continue
        }
        if (href.startsWith('https:')) {
            link.setAttribute('target', '_blank')
            link.setAttribute('rel', 'noopener noreferrer')
        }
    }

    for (const image of document.querySelectorAll('img')) {
        const src = image.getAttribute('src') ?? ''
        const alt = image.getAttribute('alt')?.trim() ?? ''
        if (!alt || !isAllowedImage(src)) image.remove()
    }

    for (const table of document.querySelectorAll('table')) {
        const scrollContainer = document.createElement('div')
        scrollContainer.className = 'document-table-scroll'
        scrollContainer.tabIndex = 0
        table.replaceWith(scrollContainer)
        scrollContainer.append(table)
    }

    const occurrences = new Map<string, number>()
    const headings: DocumentHeading[] = []
    for (const heading of document.querySelectorAll<HTMLHeadingElement>(
        tableOfContentsSelector,
    )) {
        const text = heading.textContent?.trim() ?? ''
        if (!text) continue
        const base = createHeadingId(text, 1)
        const occurrence = (occurrences.get(base) ?? 0) + 1
        occurrences.set(base, occurrence)
        const id = createHeadingId(text, occurrence)
        heading.id = id
        const parsedLevel = Number.parseInt(heading.tagName.slice(1), 10)
        headings.push({ id, text, level: parsedLevel || minimumHeadingLevel })
    }

    return { html: document.body.innerHTML, headings }
}
