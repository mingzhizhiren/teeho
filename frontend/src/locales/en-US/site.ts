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
            workspaceFoundation: {
                steps: {
                    welcome: {
                        title: 'Welcome to the Teeho workspace',
                        content:
                            'Enter a finished note, run its checkup and review the report. This guide explains the interface without filling or submitting for you.',
                    },
                    modeChoice: {
                        title: 'Choose how you want to work',
                        content:
                            'Agent mode builds a shared draft through replies. Custom mode lets you edit the complete task fields directly. Switching changes the editing workflow and never starts analysis by itself.',
                    },
                    taskOptions: {
                        title: 'Set the track and content type',
                        content:
                            'The track sets the analysis context. Image notes need images and a cover; video notes need a full video, with an optional cover.',
                    },
                    agentInput: {
                        title: 'Start with a finished note',
                        content:
                            'Paste your title, body and topics and add media. The Agent organizes them and asks for missing details. Only confirmation starts the checkup.',
                    },
                },
            },
            agentReply: {
                steps: {
                    replyRegion: {
                        title: 'This is the real Agent reply area',
                        content:
                            'The Agent uses this area to explain the shared draft, ask for a decision, or suggest the next step. The history remains scoped to forming this task and is not general chat.',
                    },
                    freeInput: {
                        title: 'You can always reply in your own words',
                        content:
                            'Add missing original text or correct the entered content in natural language. Sending updates the shared draft; the checkup requires confirmation.',
                    },
                },
            },
            taskConfirmation: {
                steps: {
                    card: {
                        title: 'The confirmation card is not an analysis result',
                        content:
                            'This is the durably saved task draft. Open the card yourself and inspect it; the guide never opens or submits it for you.',
                    },
                    keyFields: {
                        title: 'Review the key fields first',
                        content:
                            'Check the original title, body and topics, the track and the media. Source labels explain how each field was entered.',
                    },
                    startAnalysis: {
                        title: 'Analysis starts only after confirmation',
                        content:
                            'This button creates the analysis task. If anything is wrong, reply to the Agent and adjust it first.',
                    },
                },
            },
            expertMode: {
                steps: {
                    taskOptions: {
                        title: 'Set the basic options in Custom mode',
                        content:
                            'Choose the track and image or video format, then enter your original note.',
                    },
                    coreFields: {
                        title: 'Enter the title, body and topics',
                        content:
                            'Use up to 200 characters for the title, 1000 for the body and 25 topics. Title and topics are required; the body is optional.',
                    },
                    startAnalysis: {
                        title: 'Start only after reviewing the task',
                        content:
                            'This button creates the task. Custom mode still checks your note, media and storage.',
                    },
                    media: {
                        title: 'Upload media and check the cover',
                        content:
                            'Add up to 18 images and select a cover; the first image is the default. A video note needs one full video; a separate cover is optional.',
                    },
                },
            },
            analysisResult: {
                steps: {
                    metrics: {
                        title: 'Review key note metrics',
                        content:
                            'Read the primary score and assessment first, followed by content differences and reference notes. Insight Engine score references appear when sufficient data is available; radar charts and dimension scores are temporarily hidden.',
                    },
                    actions: {
                        title: 'Copy the report or run another checkup',
                        content:
                            'Copy the report or run another checkup to create a separate report. The original remains available; upload expired media again.',
                    },
                    report: {
                        title: 'Review differences and reference notes',
                        content:
                            'The report shows six key note metrics: title length, title emoji ratio, body length, average paragraph length, list or step count, and topic count. Reference notes include original links when available.',
                    },
                },
            },
        },
    },
    common: {
        appName: 'Teeho',
        home: 'Teeho home',
        close: 'Close',
        cancel: 'Cancel',
        requestFailed: 'Request failed. Please try again later.',
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
            'This permanently deletes this account’s local tasks, media, and analysis results from this browser and asynchronously cleans up temporary cloud media. It keeps you signed in and does not delete the account or cloud business records. This cannot be undone. Continue?',
        clearLocalDataOnlyConfirmAction: 'Clear and stay signed in',
        clearLocalDataAndLogout: 'Sign out and clear local data',
        clearLocalDataConfirmTitle: 'Clear local data?',
        clearLocalDataConfirm:
            'This deletes this account’s tasks, original media, and results from this browser, asynchronously cleans up temporary cloud media, then signs out. It does not delete the account or cloud business records. This cannot be undone. Continue?',
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
