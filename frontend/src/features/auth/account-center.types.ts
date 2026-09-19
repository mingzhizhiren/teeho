import type { AppIconName } from '@/components/icons/appIcon'

export type AccountSectionId =
    | 'overview'
    | 'onboarding'
    | 'security'
    | 'data'
    | 'feedback'

export interface AccountNavigationItem {
    readonly id: AccountSectionId
    readonly icon: AppIconName
    readonly title: string
    readonly description: string
}
