<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/icons/AppIcon.vue'
import SkillChatDemo from './SkillChatDemo.vue'

const { t } = useI18n()
const examples = ['attachment', 'folder'] as const
</script>

<template>
    <div class="mt-6 grid gap-5 lg:grid-cols-2" data-testid="skill-usage-examples">
        <article
            v-for="example in examples"
            :key="example"
            class="min-w-0"
            :data-testid="`skill-usage-${example}`"
        >
            <SkillChatDemo
                class="h-full"
                :title="t(`skillInstall.usage.${example}.title`)"
                :request="t(`skillInstall.usage.${example}.message`)"
                :reply="t(`skillInstall.usage.${example}.reply`)"
            >
                <template #attachment>
                    <figure
                        v-if="example === 'attachment'"
                        class="mb-3 flex items-center gap-3 rounded-xl border border-line bg-surface p-2 text-ink"
                    >
                        <img
                            src="/images/illustrations/skill-latte.svg"
                            :alt="t('skillInstall.usage.attachment.imageAlt')"
                            width="240"
                            height="180"
                            class="h-16 w-20 shrink-0 rounded-lg object-cover"
                            loading="lazy"
                        />
                        <figcaption class="min-w-0">
                            <span class="block break-words text-xs font-semibold">{{
                                t('skillInstall.usage.attachment.filename')
                            }}</span
                            ><span class="mt-1 block text-xs text-muted">{{
                                t('skillInstall.usage.attachment.attached')
                            }}</span>
                        </figcaption>
                    </figure>
                    <div
                        v-else
                        class="mb-3 flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-xs text-muted"
                    >
                        <AppIcon name="folder" size="sm" class="shrink-0 text-brand" />{{
                            t('skillInstall.usage.folder.contents')
                        }}
                    </div>
                </template>
            </SkillChatDemo>
        </article>
    </div>
    <p class="mt-4 text-xs leading-5 text-muted">{{ t('skillInstall.usage.notice') }}</p>
</template>
