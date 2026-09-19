<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/icons/AppIcon.vue'
import { useSkillChatAnimation } from './useSkillChatAnimation'

const props = defineProps<{
    title: string
    request: string
    reply: string
    completeLabel?: string
    installation?: boolean
}>()
const { t } = useI18n()
const windowElement = ref<HTMLElement | null>(null)
const { phase, userText, agentText } = useSkillChatAnimation(
    windowElement,
    () => props.request,
    () => props.reply,
)
</script>

<template>
    <div
        ref="windowElement"
        class="overflow-hidden rounded-3xl border border-line bg-canvas shadow-sm"
        data-testid="skill-chat-demo"
        :data-phase="phase"
    >
        <div
            class="flex items-center justify-between gap-3 border-b border-line bg-surface-muted px-4 py-3"
        >
            <span class="flex shrink-0 gap-1.5" aria-hidden="true"
            ><i v-for="dot in 3" :key="dot" class="size-2 rounded-full bg-muted/50"></i
            ></span>
            <h3 class="text-right text-[10px] font-semibold tracking-wider text-muted">
                <span aria-hidden="true">TEEHO · </span><span>{{ title }}</span>
            </h3>
        </div>
        <div class="space-y-4 p-4 sm:p-5">
            <div class="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3">
                <span
                    class="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand"
                ><AppIcon name="robot" size="lg"
                /></span>
                <div>
                    <p class="text-sm font-semibold text-ink">
                        {{ t('skillInstall.demoAgentTitle') }}
                    </p>
                    <p class="mt-1 text-xs text-muted">{{ t('skillInstall.demoAgentSubtitle') }}</p>
                </div>
            </div>
            <div class="ml-5 flex items-start gap-2" :class="phase === 'idle' ? 'invisible' : ''">
                <div
                    class="min-w-0 flex-1 rounded-2xl rounded-tr-md bg-brand px-4 py-3 text-sm leading-6 text-on-brand"
                >
                    <slot name="attachment" />
                    <div class="grid" aria-hidden="true">
                        <p
                            class="invisible col-start-1 row-start-1 whitespace-pre-wrap break-words"
                        >
                            {{ request }}
                        </p>
                        <p
                            class="col-start-1 row-start-1 whitespace-pre-wrap break-words"
                            :data-testid="
                                installation ? 'skill-preview-request' : 'skill-chat-request'
                            "
                        >
                            {{ userText
                            }}<span
                                v-if="phase === 'user_typing'"
                                class="ml-0.5 inline-block h-4 w-0.5 bg-current align-middle"
                            ></span>
                        </p>
                    </div>
                </div>
                <span
                    class="grid size-7 shrink-0 place-items-center rounded-lg bg-ink text-surface"
                    :data-testid="installation ? 'skill-preview-user-avatar' : undefined"
                ><AppIcon name="user" size="sm"
                /></span>
            </div>
            <div
                :class="phase === 'agent_typing' || phase === 'complete' ? '' : 'invisible'"
                :data-testid="installation ? 'skill-preview-reply' : 'skill-chat-reply'"
                aria-hidden="true"
            >
                <p class="mb-2 flex items-center gap-2 text-xs text-muted">
                    <AppIcon
                        :name="phase === 'complete' ? 'check' : 'sparkles'"
                        size="sm"
                        class="text-brand"
                    />{{
                        phase === 'complete'
                            ? t('skillInstall.demoResponded')
                            : t('skillInstall.demoTyping')
                    }}
                </p>
                <div class="rounded-2xl border border-line bg-surface p-4">
                    <p
                        v-if="completeLabel"
                        class="mb-2 flex items-center gap-2 border-b border-line pb-2 text-sm font-semibold text-brand"
                    >
                        <AppIcon name="check" size="sm" />{{ completeLabel }}
                    </p>
                    <div class="grid text-sm leading-6 text-ink">
                        <p
                            class="invisible col-start-1 row-start-1 whitespace-pre-wrap break-words"
                        >
                            {{ reply }}
                        </p>
                        <p class="col-start-1 row-start-1 whitespace-pre-wrap break-words">
                            {{ agentText
                            }}<span
                                v-if="phase === 'agent_typing'"
                                class="ml-0.5 inline-block h-4 w-0.5 bg-brand align-middle"
                            ></span>
                        </p>
                    </div>
                </div>
            </div>
            <div class="sr-only">
                <p>{{ t('skillInstall.previewUser') }}：{{ request }}</p>
                <p>Agent：{{ completeLabel }} {{ reply }}</p>
            </div>
        </div>
    </div>
</template>
