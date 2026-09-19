export default {
    notifications: {
        centerLabel: 'Notification center',
        title: 'Notification center',
        inAppAlwaysOn:
            'In-app notifications are always on. Browser notifications require your action.',
        empty: 'No business notifications yet.',
        completedTitle: 'Analysis complete',
        completedBody: 'Your result is ready. Open the matching task to view it.',
        markAllRead: 'Mark all read',
        markingAllRead: 'Updating…',
        markAllReadFailed: 'Notifications could not be marked as read. Please try again.',
        markReadFailed: 'This notification could not be marked as read. Please try again.',
        loadMore: 'Load more',
        loadingMore: 'Loading…',
        loadMoreFailed: 'Earlier notifications could not be loaded. Please try again.',
        preferenceLoadFailed:
            'Browser notification preferences could not be loaded. In-app notifications still work.',
        preferenceSaveFailed: 'Browser notification preferences could not be saved. Try again.',
        enableBrowser: 'Enable browser',
        browserEnabled: 'Browser enabled',
        browserUnavailable: 'Browser unavailable',
        permissionDenied:
            'Browser notification permission was denied or revoked. In-app notifications and analysis still work.',
        unsupported:
            'This browser does not support notifications. In-app notifications and analysis still work.',
        browserTitle: 'Team.Teeho analysis complete',
        browserBody: 'Your result is ready. Click to return safely to the workspace.',
        resultUnavailable:
            'The latest result for this notification is temporarily unavailable. Refresh and try again.',
        loadFailed: 'Notifications could not sync. Team.Teeho will keep retrying.',
    },
    account: {
        open: 'Open account and settings',
        eyebrow: 'Current account',
        title: 'Account and settings',
        settingsTitle: 'Quick settings',
        navigationLabel: 'Account features',
        back: 'Back',
        backToOverview: 'Back to account overview',
        sessionTitle: 'Current session',
        sessionDescription:
            "Sign out while keeping this account's local history and media in this browser.",
        localDataTitle: 'Local browser data',
        localDataDescription:
            'Clearing only affects local history and temporary media for this account in this browser.',
        sections: {
            overview: {
                title: 'Account overview',
                description: 'Adjust common preferences or choose an account feature to manage.',
            },
            onboarding: {
                title: 'Getting started',
                description:
                    'Replay guidance against the real content currently available in the workspace.',
            },
            security: {
                title: 'Security',
                description:
                    "Change this account's password. You will sign in again after it succeeds.",
            },
            data: {
                title: 'Data and sign-in',
                description: 'Manage the current session and local data saved in this browser.',
            },
        },
        onboarding: {
            title: 'Getting started guides',
            description:
                'Replay a chapter against real content on the current page. Unavailable chapters never create mock replies, confirmation cards, or results.',
            replay: 'Replay',
            unavailable: 'Unavailable',
            replayUnavailable:
                'The real target changed. Return to the matching feature and try again.',
            chapters: {
                workspace_foundation: 'Workspace basics',
                agent_reply: 'Agent replies',
                task_confirmation: 'Task confirmation',
                expert_mode: 'Custom mode',
                analysis_result: 'Analysis results',
            },
        },
    },
}
