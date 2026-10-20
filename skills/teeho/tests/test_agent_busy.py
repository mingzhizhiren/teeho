"""Agent 繁忙提示沿用已有任务，最终失败才声明未扣费。"""
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from teeho_skill.presentation import create_presentation
from teeho_skill.rendering import render_presentation
from teeho_skill.diagnosis import DiagnosisTools


class AgentBusyTests(unittest.TestCase):
    def test_waiting_and_failure_use_safe_translatable_messages(self) -> None:
        task = {'id': '00000000-0000-4000-8000-000000000001',
                'status': 'processing', 'agentRetryWaiting': True}
        waiting = create_presentation('task', {'task': task})
        self.assertEqual(waiting['nextAction'], 'wait')
        self.assertIn('Teeho Agent is busy. Waiting to retry.', render_presentation(waiting))
        self.assertIn('题火Agent正在忙碌，正在等待重试', render_presentation(waiting, {
            'agentBusyWaiting': '题火Agent正在忙碌，正在等待重试',
        }))
        self.assertNotIn('No credits were charged', render_presentation(waiting))
        failed = create_presentation('task', {'task': {**task, 'status': 'technical_failed',
            'failure': {'code': 'agent_busy', 'message': 'private provider error'}}})
        self.assertNotIn(failed['nextAction'], ('wait', 'resume', 'retry'))
        self.assertIn('No credits were charged', render_presentation(failed))
        self.assertNotIn('private provider', render_presentation(failed))
        self.assertIn('题火Agent正在忙碌，请稍候重新提交分析，本次未扣费', render_presentation(failed, {
            'agentBusyFailed': '题火Agent正在忙碌，请稍候重新提交分析，本次未扣费',
        }))

    def test_wait_emits_busy_transition_once_without_resubmitting(self) -> None:
        tools = object.__new__(DiagnosisTools)
        task = {'id': '00000000-0000-4000-8000-000000000001',
                'status': 'processing', 'agentRetryWaiting': True}
        tools._scope = Mock(return_value={})
        tools._query_task = Mock(side_effect=[{'task': task}, {'task': task},
            {'task': {**task, 'status': 'technical_failed', 'agentRetryWaiting': False}}])
        tools.now = Mock(return_value=0)
        tools.sleep = Mock()
        tools.log = Mock()
        tools.emit = Mock()
        result = tools.wait(task['id'])
        self.assertEqual(result['task']['status'], 'technical_failed')
        tools.emit.assert_called_once_with({'event': 'agent_retry_waiting', 'task': task})
        self.assertEqual(tools._query_task.call_count, 3)
