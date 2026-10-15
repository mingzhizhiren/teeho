export default {
    productGuide: {
        skipStep: 'Skip this step',
        next: 'Next',
        previous: 'Previous',
        done: 'Done',
        close: 'Close guide',
        errors: {
            navigation_failed: 'This page could not be opened. You can skip this step.',
            anchor_missing: 'This page target is unavailable. You can skip this step.',
        },
        onboarding: {
            template: {
                copy: {
                    title: 'Copy template',
                    content: 'Copy the template and fill in your title, body and topics.',
                },
                paste: {
                    title: 'Paste content',
                    content: 'Copy your completed template, then click here to fill the form.',
                },
            },
            workspaceFoundation: {
                steps: {
                    welcome: {
                        title: 'Welcome to the Teeho workspace',
                        content:
                            'Enter your note, upload media, then start analysis to view the report.',
                    },
                    modeChoice: {
                        title: 'Choose the note format',
                        content: 'Choose images or video. Switching keeps your draft.',
                    },
                    taskOptions: {
                        title: 'Prepare images or a video',
                        content: 'The first image is the default cover. A video cover is optional.',
                    },
                    agentInput: {
                        title: 'Start with a finished note',
                        content: 'Enter your finished note. Title and topics are required.',
                    },
                },
            },
            expertMode: {
                steps: {
                    taskOptions: {
                        title: 'Choose the note format first',
                        content: 'Choose an image or video note, then enter your original text.',
                    },
                    coreFields: {
                        title: 'Enter the title, body and topics',
                        content: 'Title and topics are required. The body is optional.',
                    },
                    startAnalysis: {
                        title: 'Start only after reviewing the task',
                        content: 'Click to start analysis. Missing content will be highlighted.',
                    },
                    media: {
                        title: 'Upload media and check the cover',
                        content: 'Upload images or a full video and choose a cover as needed.',
                    },
                },
            },
            analysisResult: {
                steps: {
                    metrics: {
                        title: 'Review key note metrics',
                        content: 'Review the score and metrics alongside comparable notes.',
                    },
                    actions: {
                        title: 'Copy the report or run another checkup',
                        content: 'Copy the report, or edit your note and analyze it again.',
                    },
                    report: {
                        title: 'Review differences and reference notes',
                        content: 'Review suggestions, key metrics and reference notes.',
                    },
                },
            },
        },
    },
    common: {
        art: {
            perspective: 'See your post from a new perspective.',
            nextPost: 'Insights for your next post.',
            workspace: 'Post ready? Let’s take a closer look.',
            report: 'See the details. Find what to improve.',
            skill: 'Install the teeho skill in one step.',
            signature: 'teeho',
        },
        appName: 'Teeho',
        home: 'Teeho home',
        close: 'Close',
        cancel: 'Cancel',
        requestFailed: 'Request failed. Please try again later.',
        modelServiceMaintenance: 'The server is under maintenance',
        serverUnavailable: 'The analysis service is temporarily unavailable. Please try again.',
        language: 'Language',
        theme: 'Theme',
        languages: {
            chinese: '中文',
            english: 'English',
        },
        themes: {
            system: 'System',
            light: 'Light',
            dark: 'Dark',
        },
        navigation: 'Application navigation',
    },
    browser: {
        unsupported: {
            title: 'Teeho cannot run safely in this browser',
            description:
                'This browser is missing features required by Teeho. The workspace, local history, or file processing may not work correctly.',
            missingFeatures: 'Missing browser features',
            recommendation:
                'Update or switch to the latest Chrome, Edge, Firefox, or Safari, then check again.',
            retry: 'Check again',
        },
        features: {
            localStorage: 'local settings storage',
            indexedDB: 'local large-file storage',
            webCrypto: 'local data encryption',
            randomUUID: 'secure identifier generation',
            abortController: 'request cancellation',
            streamingResponse: 'live workspace updates',
        },
    },
    pages: {
        default: 'Page',
        home: 'Home',
        login: 'Sign in',
        register: 'Register',
        workspace: 'Workspace',
        notFound: 'Page not found',
    },
    documents: {
        backHome: 'Back to home',
        tableOfContents: 'On this page',
        version: 'Version {version}',
        updatedAt: 'Last updated: {date}',
        defaultDescription: 'Public Teeho document',
        notFoundTitle: 'Document not found',
        notFoundDescription: 'This document is unavailable. Return home or try again later.',
        errorTitle: 'Document failed to load',
        retry: 'Try again',
        emptyTitle: 'This document is empty',
        emptyDescription: 'The content owner has not added the body yet.',
    },
    notFound: {
        title: 'Page not found',
        description: 'This address may have changed or never existed. Return home to continue.',
        backHome: 'Back to home',
    },
    auth: {
        heroEyebrow: 'Check your Xiaohongshu note before publishing',
        xhsLogoAlt: 'Xiaohongshu',
        heroTitleLine1: 'Check your note',
        heroTitleLine2: 'and publish with evidence.',
        heroDescription:
            'An AI workspace for pre-publication checks of finished Xiaohongshu notes.',
        welcomeBack: 'Welcome back',
        loginTitle: 'Sign in to your workspace',
        loginDescription: 'Please select a login method.',
        registerEyebrow: 'Create an account',
        registerTitle: 'Get started with Teeho',
        registerDescription: 'Create your account.',
        email: 'Email',
        emailPlaceholder: 'Enter your email',
        password: 'Password',
        passwordPlaceholder: 'At least 8 characters',
        confirmPassword: 'Confirm password',
        confirmPasswordPlaceholder: 'Enter your password again',
        passwordMismatch: 'The passwords do not match.',
        showPassword: 'Show',
        hidePassword: 'Hide',
        loggingIn: 'Signing in…',
        login: 'Sign in',
        registering: 'Creating account…',
        register: 'Create an account',
        agreementLabel: 'I have read and agree to the Terms of Use and Privacy Policy',
        agreementPrefix: 'I have read and agree to the ',
        agreementSeparator: ' and ',
        termsOfUse: 'Terms of Use',
        privacyPolicy: 'Privacy Policy',
        registrationConfirmation:
            'If this email can be registered, we sent a confirmation message. If you already have an account, sign in or reset your password.',
        loginFailed: 'Sign-in failed. Please try again later.',
        registrationFailed: 'Registration failed. Please try again later.',
        loggingOut: 'Signing out…',
        logout: 'Sign out',
        clearingLocalData: 'Clearing…',
        clearLocalData: 'Clear local data',
        clearLocalDataOnlyConfirmTitle: 'Clear local data?',
        clearLocalDataOnlyConfirm:
            'This permanently deletes local history, media and results from this browser, and clears temporary cloud media that active tasks do not need. Submitted tasks and required media remain. Recovery records stay until tasks finish. You stay signed in and your account is kept. Continue?',
        clearLocalDataOnlyConfirmAction: 'Clear and stay signed in',
        clearLocalDataAndLogout: 'Sign out and clear local data',
        clearLocalDataConfirmTitle: 'Clear local data?',
        clearLocalDataConfirm:
            'This permanently deletes local history, media and results from this browser, clears temporary cloud media that active tasks do not need, then signs out. Submitted tasks and required media remain, and can be viewed after signing in again. Your account is kept. Continue?',
        clearLocalDataConfirmAction: 'Clear and sign out',
        clearLocalDataFailed:
            'Not all local data for this account could be cleared safely. You remain signed in so you can retry.',
        logoutFailed: 'Sign-out did not complete. You remain signed in; please try again shortly.',
        changePassword: 'Change password',
        currentPassword: 'Current password',
        newPassword: 'New password',
        confirmNewPassword: 'Confirm new password',
        changePasswordAction: 'Change and sign in again',
        changingPassword: 'Changing…',
        changePasswordFailed: 'Password change failed. Please try again later.',
        passwordChanged: 'Your password was changed. Sign in again with the new password.',
        passwordChangeResultUnknown:
            'The password change result is unknown. Try signing in with the new password first.',
        continueWithGoogle: 'Continue with Google',
        or: 'or',
        noAccount: "Don't have an account?",
        createAccount: 'Create one',
        alreadyHaveAccount: 'Already have an account?',
        goToLogin: 'Back to sign in',
        oauthFailed: 'Google sign-in was not completed. Please try again.',
    },
    siteFooter: {
        source: 'Teeho · Source on GitHub',
        description: 'Developed by Jerry.',
    },
}
