export default {
    productGuide: {
        skipStep: '跳过该步骤',
        next: '下一步',
        previous: '上一步',
        done: '完成',
        close: '关闭引导',
        errors: {
            navigation_failed: '无法进入该页面，你可以跳过此步骤。',
            anchor_missing: '页面目标暂时不可用，你可以跳过此步骤。',
        },
        onboarding: {
            workspaceFoundation: {
                steps: {
                    welcome: {
                        title: '欢迎来到题火工作台',
                        content:
                            '这里围绕一篇完整笔记录入草稿、开展体检并查看报告。引导只介绍操作位置，不会替你填写或提交。',
                    },
                    modeChoice: {
                        title: '先选择适合的工作方式',
                        content:
                            'Agent 模式通过回复逐步形成共享草稿；定制模式让你直接填写完整任务字段。切换只改变编辑方式，不会自动开始分析。',
                    },
                    taskOptions: {
                        title: '确定赛道和内容形态',
                        content:
                            '赛道决定分析语境。图文需要图片和封面；视频需要完整视频，封面可选。',
                    },
                    agentInput: {
                        title: '从已完成的笔记开始',
                        content:
                            '粘贴你已写好的标题、正文和话题，并添加素材。Agent 会整理原文、询问缺项，确认后才开始体检。',
                    },
                },
            },
            agentReply: {
                steps: {
                    replyRegion: {
                        title: '这是 Agent 的真实回复区域',
                        content:
                            'Agent 会在这里说明共享草稿的当前状态、需要确认的问题或下一步建议。历史回复只用于继续当前任务，不会变成普通聊天。',
                    },
                    freeInput: {
                        title: '你始终可以自由回复',
                        content:
                            '用自然语言补充缺少的原文，或纠正录入内容。发送会更新共享草稿，正式体检需要你确认。',
                    },
                },
            },
            taskConfirmation: {
                steps: {
                    card: {
                        title: '任务确认卡还不是分析结果',
                        content:
                            '这是已经持久成立的任务草稿。请亲自点击卡片展开并检查内容；引导不会替你展开或提交。',
                    },
                    keyFields: {
                        title: '先检查关键字段',
                        content:
                            '检查标题、正文、话题是否保留原意，赛道和素材是否正确；来源提示说明字段如何录入。',
                    },
                    startAnalysis: {
                        title: '确认后才正式开始分析',
                        content:
                            '点击这个按钮才会创建分析任务。若内容不对，请先继续回复 Agent 调整。',
                    },
                },
            },
            expertMode: {
                steps: {
                    taskOptions: {
                        title: '专家模式先确定基础选项',
                        content: '选择内容赛道和图文或视频形态，然后直接填写笔记原文。',
                    },
                    coreFields: {
                        title: '填写标题、正文和话题',
                        content:
                            '标题最多 200 字符，正文最多 1000 字符，话题最多 25 个。标题和话题必填，正文可留空。',
                    },
                    startAnalysis: {
                        title: '检查完成后再开始分析',
                        content: '这个按钮才会创建任务。专家模式仍会检查笔记内容、素材和存储状态。',
                    },
                    media: {
                        title: '上传素材并检查封面',
                        content:
                            '图文最多 18 张，第一张默认为封面，也可选择其他图片。视频需要一个完整视频，封面可选。',
                    },
                },
            },
            analysisResult: {
                steps: {
                    metrics: {
                        title: '查看笔记关键指标',
                        content:
                            '先阅读主分和内容结论，再结合同类差异与参考笔记判断。洞察引擎评分参照在数据充足时展示；雷达图及六维分数暂不展示。',
                    },
                    actions: {
                        title: '复制报告或再次体检',
                        content:
                            '复制完整报告，或者再次体检并创建独立报告。原报告仍会保留；过期素材需要重新上传。',
                    },
                    report: {
                        title: '查看差异与参考笔记',
                        content:
                            '报告展示标题长度、标题 Emoji 比例、正文长度、平均段落长度、列表／步骤项数量和话题数量六项笔记关键指标，并提供参考笔记及可用原文链接。',
                    },
                },
            },
        },
    },
    common: {
        appName: '题火',
        home: '题火首页',
        close: '关闭',
        cancel: '取消',
        requestFailed: '请求失败，请稍后重试',
        serverUnavailable: '服务器功能异常，请稍后重试',
        language: '语言',
        theme: '主题',
        languages: {
            chinese: '中文',
            english: 'English',
        },
        themes: {
            system: '跟随系统',
            light: '浅色',
            dark: '深色',
        },
        navigation: '应用导航',
    },
    browser: {
        unsupported: {
            title: '当前浏览器无法安全使用题火',
            description:
                '当前浏览器缺少题火运行所需的功能，工作台、本地历史或文件处理可能无法正常工作。',
            missingFeatures: '缺少的浏览器功能',
            recommendation: '请升级或更换最新版 Chrome、Edge、Firefox 或 Safari，然后重新检测。',
            retry: '重新检测',
        },
        features: {
            localStorage: '本地配置存储',
            indexedDB: '本地大文件存储',
            webCrypto: '本地数据加密',
            randomUUID: '安全随机标识生成',
            abortController: '网络请求取消',
            streamingResponse: '实时工作区更新',
        },
    },
    pages: {
        default: '页面',
        home: '首页',
        login: '登录',
        register: '注册',
        workspace: '工作台',
        notFound: '页面不存在',
    },
    documents: {
        backHome: '返回首页',
        tableOfContents: '目录',
        version: '版本 {version}',
        updatedAt: '最后更新：{date}',
        defaultDescription: '题火公开文档',
        notFoundTitle: '文档不存在',
        notFoundDescription: '该文档暂时无法找到，请返回首页或稍后再试。',
        errorTitle: '文档加载失败',
        retry: '重新加载',
        emptyTitle: '文档内容为空',
        emptyDescription: '内容维护者尚未补充正文。',
    },
    notFound: {
        title: '页面不存在',
        description: '你访问的地址可能已经变更，或从未存在。可以返回首页继续浏览题火。',
        backHome: '返回首页',
    },
    auth: {
        heroEyebrow: '小红书笔记，发布前先检查',
        heroTitleLine1: '检查你的笔记，',
        heroTitleLine2: '带着依据决定是否发布。',
        heroDescription: '专注于完整小红书笔记发布前体检的 AI 工作台。',
        welcomeBack: '欢迎回来',
        loginTitle: '登录你的工作台',
        loginDescription: '请选择一种登录方式。',
        registerEyebrow: '创建账号',
        registerTitle: '开始使用题火',
        registerDescription: '创建您的账号。',
        email: '邮箱',
        emailPlaceholder: '请输入邮箱',
        password: '密码',
        passwordPlaceholder: '至少 8 位密码',
        confirmPassword: '确认密码',
        confirmPasswordPlaceholder: '再次输入密码',
        passwordMismatch: '两次输入的密码不一致',
        showPassword: '显示',
        hidePassword: '隐藏',
        loggingIn: '正在登录…',
        login: '登录',
        registering: '正在注册…',
        register: '注册新账号',
        agreementLabel: '我已阅读并同意《用户条款》和《隐私政策》',
        agreementPrefix: '我已阅读并同意',
        agreementSeparator: '和',
        termsOfUse: '用户条款',
        privacyPolicy: '隐私政策',
        registrationConfirmation:
            '如果该邮箱可以注册，我们已发送确认邮件。若已有账号，请直接登录或重置密码。',
        loginFailed: '登录失败，请稍后重试',
        registrationFailed: '注册失败，请稍后重试',
        loggingOut: '退出中…',
        logout: '退出登录',
        clearingLocalData: '正在清除…',
        clearLocalData: '清理本地数据',
        clearLocalDataOnlyConfirmTitle: '确认清理本地数据',
        clearLocalDataOnlyConfirm:
            '将永久删除当前账号在这台浏览器中的本地任务、素材和分析结果，并异步清理临时云端素材。不会退出登录，也不会删除账号或云端业务记录。此操作无法撤销，是否继续？',
        clearLocalDataOnlyConfirmAction: '清理并保持登录',
        clearLocalDataAndLogout: '退出并清除本机数据',
        clearLocalDataConfirmTitle: '确认清除本机数据',
        clearLocalDataConfirm:
            '将删除当前账号在这台浏览器中的任务、原始素材和结果，并异步清理临时云端素材，然后退出登录。不会删除账号或云端业务记录。此操作无法撤销，是否继续？',
        clearLocalDataConfirmAction: '清除并退出',
        clearLocalDataFailed:
            '未能安全清除当前账号的全部本机数据。为避免遗漏，账号仍保持登录，请重试。',
        logoutFailed: '退出登录暂未完成，账号仍保持登录，请稍后重试。',
        changePassword: '修改密码',
        currentPassword: '当前密码',
        newPassword: '新密码',
        confirmNewPassword: '确认新密码',
        changePasswordAction: '修改并重新登录',
        changingPassword: '正在修改…',
        changePasswordFailed: '密码修改失败，请稍后重试。',
        passwordChanged: '密码已修改，请使用新密码重新登录。',
        passwordChangeResultUnknown: '密码修改结果未确认，请先尝试使用新密码登录。',
        continueWithGoogle: '使用 Google 继续',
        or: '或者',
        noAccount: '还没有账号？',
        createAccount: '创建账号',
        alreadyHaveAccount: '已有账号？',
        goToLogin: '返回登录',
        oauthFailed: 'Google 登录未完成，请重试',
    },
    community: {
        source: '题火社区版 · GitHub 源码',
        description: '使用示例插件和合成数据运行；诊断结果用于演示，不代表官方数据服务。',
    },
}
