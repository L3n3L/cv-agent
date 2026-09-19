import assert from 'node:assert/strict'
import test from 'node:test'
import { isSameAgentRun, mergeSessionMessages, runEventStatus } from '../../frontend/react/src/runtime/agent-chat-state.js'

test('agent chat state keeps failure visible and does not downgrade it to done', () => {
  assert.equal(runEventStatus([{ event: 'agent_run_started' }, { event: 'agent_run_finished', outcome: 'success' }]), 'done')
  assert.equal(runEventStatus([{ event: 'agent_run_started' }, { event: 'agent_run_finished', outcome: 'failed' }]), 'failed')
  assert.equal(runEventStatus([{ event: 'agent_run_started' }, { event: 'tool_call_failed' }]), 'blocked')
  assert.equal(runEventStatus([]), 'idle')
})

test('agent chat state preserves a local optimistic turn only as a suffix', () => {
  const persisted = [{ role: 'user', content: '旧消息' }]
  const local = [...persisted, { role: 'assistant', content: '流式中的回答' }]
  assert.deepEqual(mergeSessionMessages(persisted, local), local)
  assert.deepEqual(mergeSessionMessages(local, persisted), local)
})

test('agent chat state ignores stale run events', () => {
  assert.equal(isSameAgentRun({ runId: 'run-current' }, 'run-current'), true)
  assert.equal(isSameAgentRun({ runId: 'run-old' }, 'run-current'), false)
  assert.equal(isSameAgentRun({ event: 'agent_run_started' }, 'run-current'), true)
})
