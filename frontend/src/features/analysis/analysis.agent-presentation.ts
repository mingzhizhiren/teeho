import type {
    AgentConversationAction,
    AgentConversationQuestion,
    AnalysisConversationDraft,
} from './analysis.conversation'

type AgentPresentationLocale = 'zh-CN' | 'en-US'
export type AgentPresentationAction =
    | 'greeting'
    | 'adjustment'
    | AgentConversationAction
    | 'budget_exhausted'
    | 'technical_failure'

function combine(prefixes: readonly string[], suffixes: readonly string[]) {
    return prefixes.flatMap((prefix) => suffixes.map((suffix) => `${prefix}${suffix}`))
}

const zhCnCatalog = {
    greeting: combine(
        [
            '嗨，我是题火 Agent',
            '你好，我已经准备好了',
            '欢迎来到题火笔记体检',
            '我们开始整理这篇笔记吧',
            '新任务已经准备好',
        ],
        [
            '。请发来你已完成的笔记。',
            '。我会整理你提供的标题、正文和话题。',
            '。请提供笔记原文和素材。',
            '。缺少的信息会请你补充，不会替你创作。',
        ],
    ),
    adjustment: combine(
        ['没问题', '可以，我们继续整理', '我在听', '好的，请补充你的笔记', '明白，我们继续核对'],
        [
            '。请提供要更新的原文。',
            '。请说明哪个字段需要重新录入。',
            '。把你已写好的内容发来即可。',
            '。继续回复，我会更新共享草稿。',
        ],
    ),
    ask_questions: combine(
        [
            '我已保留你提供的内容',
            '已有笔记信息已经整理好',
            '共享草稿已更新',
            '这篇笔记还需要补充信息',
            '我已经记录了已有内容',
        ],
        [
            '，请补充下面的信息：',
            '，还有下面这些缺项：',
            '，请提供笔记中对应的原文：',
            '，完整后再确认体检：',
        ],
    ),
    draft_ready: combine(
        ['我明白了', '收到', '我已悉知', '好的，我已经记下了', '了解，这轮信息已经收好'],
        [
            '，共享草稿已经同步更新。',
            '，我已经把这次补充写入共享草稿。',
            '，请查看下面的草稿是否符合你的想法。',
            '，你可以直接确认分析，也可以继续补充。',
        ],
    ),
    confirm_topic_switch: combine(
        [
            '我注意到你提到了新的方向「{topic}」',
            '这句话可能是在开启新选题「{topic}」',
            '当前内容看起来偏向另一个主题「{topic}」',
            '你似乎想把重点转到「{topic}」',
            '这可能不再是原来的选题，而是「{topic}」',
        ],
        [
            '。要切换到这个新选题吗？',
            '。请确认是否切换主题。',
            '。如果要换题，请直接告诉我。',
            '。是否放下当前草稿并按新选题整理？',
        ],
    ),
    defer_media_analysis: combine(
        [
            '素材内容会在正式分析开始后统一处理',
            '图片或视频的含义需要等正式分析阶段处理',
            '现在先完成选题和草稿参数',
            '任务形成阶段不会提前解读素材',
            '我会把素材保留到正式分析环节',
        ],
        [
            '，你可以继续说明想做的选题。',
            '，开始分析后会结合当前素材处理。',
            '，确认草稿后再整体理解素材。',
            '，这样可以避免重复消耗分析资源。',
        ],
    ),
    out_of_scope: combine(
        [
            '题火只分析已经完成的笔记',
            '这里的 Agent 负责整理已有笔记',
            '我可以整理你提供的原文',
            '这里不创建或优化笔记',
            '本次任务是发布前体检',
        ],
        [
            '，不代写标题、正文或话题。请提供你的原文。',
            '。请发来你已完成的笔记内容。',
            '，缺少的内容需要由你补充。',
            '。请继续补充已有笔记和素材。',
        ],
    ),
    task_submitted: combine(
        [
            '这次任务已经提交',
            '当前选题已经进入分析',
            '刚才的共享草稿已经开始分析',
            '这个会话对应的任务已经创建',
            '本轮任务已经交给后台',
        ],
        [
            '，不能再用旧会话继续普通问答。',
            '，如需新选题请清空后重新开始。',
            '，后续内容请作为一个新任务发起。',
            '，请等待分析结果或开启新任务。',
        ],
    ),
    budget_exhausted: combine(
        [
            '聊天信息太长啦',
            '聊天进度被你撑破啦',
            '这组对话已经装得满满当当',
            '当前会话已经到达容量上限',
            '这次选题讨论已经完整收拢',
        ],
        [
            '，共享草稿已保留，可以切换专家模式补齐后体检。',
            '，请在专家模式检查并补齐笔记，不会继续消耗对话额度。',
            '，已有内容不会丢失，可以切换专家模式继续填写。',
            '，本次停止新的 Agent 回合，专家表单仍可继续编辑。',
        ],
    ),
    technical_failure: combine(
        [
            '这轮暂时没有处理完成',
            'Agent 刚刚没有成功返回',
            '当前请求遇到了一点波动',
            '这次整理暂时中断了',
            '我还没能完成这轮草稿更新',
        ],
        [
            '，你的输入还在，可以直接重试。',
            '，原消息已保留，请再次发送。',
            '，不会写入正式历史，稍后重试即可。',
            '，草稿没有被部分修改，请重试。',
        ],
    ),
} satisfies Record<AgentPresentationAction, string[]>

const enUsCatalog = {
    greeting: combine(
        [
            'Hi, I am the Teeho Agent',
            'Hello, I am ready',
            'Welcome to the Teeho note checkup',
            'Let us organize your note',
            'A new task is ready',
        ],
        [
            '. Send your finished note.',
            '. I will organize the title, body and topics you provide.',
            '. Add the original note and media.',
            '. I will ask for missing information without writing your note.',
        ],
    ),
    adjustment: combine(
        [
            'No problem',
            'Sure, let us organize it',
            'I am listening',
            'All right, add your note details',
            'Understood, let us check it',
        ],
        [
            '. Send your updated original text.',
            '. Tell me which field to replace.',
            '. Send the content you have already written.',
            '. Reply and I will update the shared draft.',
        ],
    ),
    ask_questions: combine(
        [
            'I saved the content you provided',
            'Your existing note details are organized',
            'The shared draft is updated',
            'The note needs more information',
            'I recorded the existing content',
        ],
        [
            '. Please add the following details:',
            '. These details are still missing:',
            '. Please provide the corresponding original text:',
            '. Complete these details before starting the checkup:',
        ],
    ),
    draft_ready: combine(
        [
            'Understood',
            'Got it',
            'Noted',
            'All right, I have recorded that',
            'I understand and have updated the draft',
        ],
        [
            '. The shared draft is now updated.',
            '. I added this detail to the shared draft.',
            '. Review the draft below to confirm it matches your intent.',
            '. You can confirm the analysis or continue adding details.',
        ],
    ),
    confirm_topic_switch: combine(
        [
            'You mentioned a new direction, “{topic}”',
            'This may be a new topic, “{topic}”',
            'The message appears to move toward “{topic}”',
            'You may want to shift the focus to “{topic}”',
            'This may no longer be the same topic, but “{topic}”',
        ],
        [
            '. Switch to it?',
            '. Confirm whether to change topics.',
            '. Tell me if you want to switch.',
            '. Replace the current topic with this one?',
        ],
    ),
    defer_media_analysis: combine(
        [
            'The media will be interpreted after the task starts',
            'Image or video meaning belongs to the formal analysis',
            'Let us finish the topic and draft first',
            'The forming stage does not interpret media early',
            'I will keep the media for the formal analysis',
        ],
        [
            '. Keep describing the topic you want.',
            '. The analysis will use the current media.',
            '. Confirm the draft before interpreting everything together.',
            '. This avoids repeating analysis work.',
        ],
    ),
    out_of_scope: combine(
        [
            'Teeho analyzes finished notes',
            'This Agent organizes existing notes',
            'I can organize your original text',
            'This workspace does not create or optimize notes',
            'This task is a pre-publication checkup',
        ],
        [
            '. I do not write titles, bodies or topics. Please provide your text.',
            '. Send your finished note.',
            '. You need to supply missing content.',
            '. Continue adding your existing note and media.',
        ],
    ),
    task_submitted: combine(
        [
            'This task has already been submitted',
            'The current topic is already being analyzed',
            'The shared draft has entered analysis',
            'The task for this conversation already exists',
            'This round is already in the background queue',
        ],
        [
            ', so the old conversation cannot continue general chat.',
            '. Clear it before starting a new topic.',
            '. Start a new task for anything else.',
            '. Wait for the result or begin a new task.',
        ],
    ),
    budget_exhausted: combine(
        [
            'This conversation is full',
            'The chat progress has reached its limit',
            'This topic discussion is packed',
            'The current session is at capacity',
            'This task-forming conversation is complete',
        ],
        [
            '; your shared draft is saved. Switch to Expert mode to complete it.',
            '. Check and complete your note in Expert mode without using more conversation tokens.',
            '. Your existing content is safe. Continue filling it in Expert mode.',
            '. New Agent turns are paused, and the Expert form remains editable.',
        ],
    ),
    technical_failure: combine(
        [
            'This round did not finish',
            'The Agent did not return successfully',
            'The request hit a temporary problem',
            'Draft forming was interrupted',
            'I could not complete this draft update',
        ],
        [
            ', but your input is still here for retry.',
            '. The original message is preserved; send it again.',
            '. It did not enter formal history, so retry when ready.',
            '. No partial draft changes were applied; retry it.',
        ],
    ),
} satisfies Record<AgentPresentationAction, string[]>

export const agentPresentationCatalogs = {
    'zh-CN': zhCnCatalog,
    'en-US': enUsCatalog,
} as const

function applyVariables(template: string, variables: Record<string, string> = {}) {
    return Object.entries(variables).reduce(
        (text, [name, value]) => text.split(`{${name}}`).join(value),
        template,
    )
}

/** 为每个动作独立避免连续重复，随机选择只影响展示，不进入语义历史。 */
export function createAgentPresentationSelector(
    locale: AgentPresentationLocale,
    random: () => number = Math.random,
) {
    let remainingIndices: Partial<Record<AgentPresentationAction, readonly number[]>> = {}
    let lastIndices: Partial<Record<AgentPresentationAction, number>> = {}
    return {
        select(action: AgentPresentationAction, variables?: Record<string, string>) {
            const candidates = agentPresentationCatalogs[locale][action]
            const available = remainingIndices[action]?.length
                ? remainingIndices[action]!
                : candidates.map((_candidate, index) => index)
            let position = Math.min(
                available.length - 1,
                Math.max(0, Math.floor(random() * available.length)),
            )
            if (available.length > 1 && lastIndices[action] === available[position]) {
                position = (position + 1) % available.length
            }
            const index = available[position]!
            remainingIndices = {
                ...remainingIndices,
                [action]: [...available.slice(0, position), ...available.slice(position + 1)],
            }
            lastIndices = { ...lastIndices, [action]: index }
            return applyVariables(candidates[index]!, variables)
        },
    }
}

export type AgentPresentationSelector = ReturnType<typeof createAgentPresentationSelector>

interface PresentableAgentTurn {
    completeDraft?: AnalysisConversationDraft
    action: AgentConversationAction
    assistantMessage: string | null
    questions: AgentConversationQuestion[]
    tokenBudget?: { exhausted: boolean } | null
}

/** 把受控动作映射为固定话术；只有具体必要问题保留 Provider 原文。 */
export function presentAgentConversationTurn(
    turn: PresentableAgentTurn,
    selector: AgentPresentationSelector,
) {
    switch (turn.action) {
        case 'ask_questions':
            return {
                text: [
                    selector.select('ask_questions'),
                    ...turn.questions.map((question) => question.text),
                ].join('\n'),
                showConfirmation: false,
            }
        case 'confirm_topic_switch': {
            return {
                text: turn.questions.map((question) => question.text).join('\n'),
                showConfirmation: false,
            }
        }
        case 'draft_ready':
            return {
                text: selector.select('draft_ready'),
                showConfirmation: true,
            }
        case 'defer_media_analysis':
            return {
                text: selector.select('defer_media_analysis'),
                showConfirmation: Boolean(
                    turn.completeDraft?.fields.title.value?.trim() &&
                    turn.completeDraft.fields.topics.value.length,
                ),
            }
        case 'out_of_scope':
            return {
                text: selector.select('out_of_scope'),
                showConfirmation: false,
            }
        case 'task_submitted':
            return {
                text: selector.select('task_submitted'),
                showConfirmation: false,
            }
    }
}
