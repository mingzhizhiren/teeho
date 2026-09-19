<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/icons/AppIcon.vue'
import type { AppIconName } from '@/components/icons/appIcon'
import { getFrontendRuntime } from '@/edition/runtime'
import { useOnboardingBlocker } from '@/features/onboarding/useOnboardingBlocker'
import { useAuthStore } from '@/stores/auth'
import AccountDataPanel from './AccountDataPanel.vue'
import AccountOnboardingPanel from './AccountOnboardingPanel.vue'
import AccountOverviewPanel from './AccountOverviewPanel.vue'
import AccountPasswordPanel from './AccountPasswordPanel.vue'
import AccountSignOutAction from './AccountSignOutAction.vue'
import type { AccountNavigationItem, AccountSectionId } from './account-center.types'

const runtime = getFrontendRuntime()
const auth = useAuthStore()
const { t } = useI18n()
const accountOpen = ref(false)
const activeSection = ref<AccountSectionId>('overview')
const accountTrigger = ref<HTMLButtonElement | null>(null)
const accountDialog = ref<HTMLElement | null>(null)
const accountCloseButton = ref<HTMLButtonElement | null>(null)
const accountPanelHeading = ref<HTMLElement | null>(null)
const accountDialogTitleId = 'workspace-account-dialog-title'
const accountPanelTitleId = 'workspace-account-panel-title'
const accountInitial = computed(() => auth.user?.email?.trim().charAt(0) || 'T')
let previousBodyOverflow = ''

useOnboardingBlocker(accountOpen, 'business_dialog')

const sectionMetadata: Readonly<
    Record<Exclude<AccountSectionId, 'overview'>, { icon: AppIconName }>
> = {
    security: { icon: 'shield' },
    data: { icon: 'history' },
    onboarding: { icon: 'book-open' },
    feedback: { icon: 'star' },
}

const navigationItems = computed<readonly AccountNavigationItem[]>(() =>
    (Object.keys(sectionMetadata) as Array<Exclude<AccountSectionId, 'overview'>>)
        .filter(
            (sectionId) =>
                (sectionId !== 'security' || auth.user?.canChangePassword) &&
                (sectionId !== 'feedback' || runtime.accountExtra),
        )
        .map((sectionId) => ({
            id: sectionId,
            icon: sectionMetadata[sectionId].icon,
            title: t(`account.sections.${sectionId}.title`),
            description: t(`account.sections.${sectionId}.description`),
        })),
)

const activeSectionTitle = computed(() => t(`account.sections.${activeSection.value}.title`))

function lockBodyScroll(): void {
    previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
}

function restoreBodyScroll(): void {
    document.body.style.overflow = previousBodyOverflow
}

/** 打开账户中心并回到概览。 */
function openAccountDialog(): void {
    activeSection.value = 'overview'
    accountOpen.value = true
    lockBodyScroll()
    void nextTick(() => accountCloseButton.value?.focus())
}

/** 暂时隐藏账户中心，让业务引导或导航接管焦点。 */
function suspendAccountDialog(): void {
    if (!accountOpen.value) return
    accountOpen.value = false
    restoreBodyScroll()
}

/** 在原功能页恢复账户中心。 */
function reopenAccountDialog(): void {
    if (accountOpen.value) return
    accountOpen.value = true
    lockBodyScroll()
    void nextTick(() => accountPanelHeading.value?.focus())
}

/** 关闭账户中心并清除当前详情导航。 */
function closeAccountDialog(): void {
    if (!accountOpen.value) return
    accountOpen.value = false
    activeSection.value = 'overview'
    restoreBodyScroll()
    void nextTick(() => accountTrigger.value?.focus())
}

function selectSection(sectionId: AccountSectionId): void {
    activeSection.value = sectionId
    void nextTick(() => accountPanelHeading.value?.focus())
}

function handleAccountDialogKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
        event.preventDefault()
        closeAccountDialog()
        return
    }
    if (event.key !== 'Tab' || !accountDialog.value) return
    const focusableElements = Array.from(
        accountDialog.value.querySelectorAll<HTMLElement>(
            'button:not([disabled]), select:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
    )
    const firstElement = focusableElements[0]
    const lastElement = focusableElements[focusableElements.length - 1]
    if (!firstElement || !lastElement) return
    if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault()
        lastElement.focus()
    } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault()
        firstElement.focus()
    }
}

onBeforeUnmount(restoreBodyScroll)
</script>

<template>
    <button
        ref="accountTrigger"
        class="flex h-10 max-w-[12rem] items-center gap-2 rounded-xl border border-line bg-surface px-2 text-left text-sm transition hover:border-brand/40 hover:bg-brand/5 sm:max-w-[18rem] sm:px-3"
        type="button"
        :aria-label="t('account.open')"
        aria-haspopup="dialog"
        :aria-expanded="accountOpen"
        data-testid="account-trigger"
        @click="openAccountDialog"
    >
        <span
            class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-xs font-bold uppercase text-brand"
            aria-hidden="true"
        >
            {{ accountInitial }}
        </span>
        <span class="hidden min-w-0 sm:block">
            <span class="block truncate font-semibold text-ink">{{ t('account.title') }}</span>
            <span class="block truncate text-[11px] text-muted">{{ auth.user?.email }}</span>
        </span>
        <AppIcon class="hidden shrink-0 text-muted sm:block" name="chevron-down" size="sm" />
    </button>

    <Teleport to="body">
        <div
            v-show="accountOpen"
            class="fixed inset-0 z-50 flex items-stretch justify-center bg-slate-950/55 md:items-center md:p-4"
            :aria-hidden="!accountOpen"
            role="presentation"
            @click.self="closeAccountDialog"
        >
            <section
                ref="accountDialog"
                class="flex h-[100dvh] max-h-[100dvh] w-full min-w-0 max-w-full flex-col overflow-hidden border border-line bg-surface shadow-2xl md:h-[44rem] md:max-h-[calc(100dvh-2rem)] md:max-w-3xl md:rounded-3xl"
                role="dialog"
                aria-modal="true"
                :aria-labelledby="accountDialogTitleId"
                data-testid="account-dialog"
                @keydown="handleAccountDialogKeydown"
            >
                <header
                    class="flex shrink-0 items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6"
                >
                    <div class="min-w-0">
                        <p class="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
                            {{ t('account.eyebrow') }}
                        </p>
                        <h2
                            :id="accountDialogTitleId"
                            class="mt-1 text-xl font-semibold tracking-tight text-ink"
                        >
                            {{ t('account.title') }}
                        </h2>
                        <p class="mt-1 truncate text-sm text-muted">{{ auth.user?.email }}</p>
                    </div>
                    <button
                        ref="accountCloseButton"
                        class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line text-muted transition hover:border-brand/40 hover:bg-brand/5 hover:text-ink"
                        type="button"
                        :aria-label="t('common.close')"
                        @click="closeAccountDialog"
                    >
                        <AppIcon name="close" />
                    </button>
                </header>

                <div
                    class="min-h-0 flex-1 overflow-y-auto overscroll-contain"
                    data-testid="account-scroll-view"
                >
                    <div class="min-h-full md:grid md:grid-cols-[13rem_minmax(0,1fr)]">
                        <nav
                            class="hidden border-r border-line bg-surface-muted/55 p-3 md:block"
                            :aria-label="t('account.navigationLabel')"
                        >
                            <div class="sticky top-3 grid gap-1.5">
                                <button
                                    class="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition"
                                    :class="
                                        activeSection === 'overview'
                                            ? 'bg-surface font-semibold text-ink shadow-sm'
                                            : 'text-muted hover:bg-surface hover:text-ink'
                                    "
                                    type="button"
                                    :aria-current="
                                        activeSection === 'overview' ? 'page' : undefined
                                    "
                                    @click="selectSection('overview')"
                                >
                                    <AppIcon name="workspace" size="sm" />
                                    {{ t('account.sections.overview.title') }}
                                </button>
                                <button
                                    v-for="item in navigationItems"
                                    :key="item.id"
                                    class="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition"
                                    :class="
                                        activeSection === item.id
                                            ? 'bg-surface font-semibold text-ink shadow-sm'
                                            : 'text-muted hover:bg-surface hover:text-ink'
                                    "
                                    type="button"
                                    :aria-current="activeSection === item.id ? 'page' : undefined"
                                    @click="selectSection(item.id)"
                                >
                                    <AppIcon :name="item.icon" size="sm" />
                                    {{ item.title }}
                                </button>
                            </div>
                        </nav>

                        <main class="min-w-0 p-5 sm:p-6" :aria-labelledby="accountPanelTitleId">
                            <div class="mb-5">
                                <button
                                    v-if="activeSection !== 'overview'"
                                    class="mb-3 inline-flex min-h-10 items-center gap-2 rounded-xl border border-line px-3 text-sm font-medium text-muted transition hover:border-brand/40 hover:bg-brand/5 hover:text-ink md:hidden"
                                    type="button"
                                    :aria-label="t('account.backToOverview')"
                                    @click="selectSection('overview')"
                                >
                                    <AppIcon name="arrow-left" size="sm" />
                                    {{ t('account.back') }}
                                </button>
                                <h3
                                    :id="accountPanelTitleId"
                                    ref="accountPanelHeading"
                                    class="text-lg font-semibold text-ink outline-none"
                                    tabindex="-1"
                                >
                                    {{ activeSectionTitle }}
                                </h3>
                            </div>

                            <AccountOverviewPanel
                                v-if="activeSection === 'overview'"
                                :navigation-items="navigationItems"
                                @select="selectSection"
                            />
                            <AccountOnboardingPanel
                                v-else-if="activeSection === 'onboarding'"
                                @suspend="suspendAccountDialog"
                                @reopen="reopenAccountDialog"
                            />
                            <AccountPasswordPanel
                                v-else-if="
                                    activeSection === 'security' && auth.user?.canChangePassword
                                "
                                @suspend="suspendAccountDialog"
                            />
                            <AccountDataPanel
                                v-else-if="activeSection === 'data'"
                                @suspend="suspendAccountDialog"
                            />
                            <component
                                :is="runtime.accountExtra"
                                v-else-if="activeSection === 'feedback' && runtime.accountExtra"
                            />
                        </main>
                    </div>
                </div>
                <footer class="shrink-0 border-t border-line bg-surface px-5 py-4 sm:px-6">
                    <AccountSignOutAction @suspend="suspendAccountDialog" />
                </footer>
            </section>
        </div>
    </Teleport>
</template>
