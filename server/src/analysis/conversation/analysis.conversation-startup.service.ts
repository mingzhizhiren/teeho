import { logger } from '../../utils/logger'
import { interruptPreviousConversationTurns } from './analysis.conversation-startup.repository'

/** 单 API 进程的启动屏障；失败向入口传播，不带遗留聊天状态开放服务。 */
export async function recoverInterruptedConversations(): Promise<void> {
    const recovered = await interruptPreviousConversationTurns()
    logger.info(
        { event: 'analysis_conversation_startup_recovered', ...recovered },
        '已终止旧 API 进程遗留聊天回合并释放会话锁',
    )
}
