import assert from 'node:assert/strict'
import test from 'node:test'
import { isSameAgentRun, mergeSessionMessages, projectWorkflowTimeline, reduceAgentTimeline, runEventStatus, workflowGroupHasAssistantText } from '../../frontend/react/src/runtime/agent-chat-state.js'

test('agent chat state keeps failure visible and does not downgrade it to done', () => {
  assert.equal(runEventStatus([{ event: 'agent_run_started' }, { event: 'agent_run_finished', outcome: 'success' }]), 'done')
  assert.equal(runEventStatus([{ event: 'agent_run_started' }, { event: 'agent_run_finished', outcome: 'failed' }]), 'failed')
  assert.equal(runEventStatus([{ event: 'agent_run_started' }, { event: 'tool_call_failed' }]), 'blocked')
  assert.equal(runEventStatus([{ event: 'agent_run_started' }, { event: 'agent_run_paused' }]), 'waiting')
  assert.equal(runEventStatus([
    { event: 'agent_run_started' },
    { event: 'agent_run_paused' },
    { event: 'agent_run_finished', outcome: 'paused' },
    { event: 'tool_call_succeeded', toolName: 'resume_finalize' },
    { event: 'agent_run_finished', outcome: 'success' },
  ]), 'done')
  assert.equal(runEventStatus([
    { event: 'agent_run_started' },
    { event: 'tool_call_failed' },
    { event: 'agent_run_finished', outcome: 'success' },
  ]), 'done')
  assert.equal(runEventStatus([]), 'idle')
})

test('workflow timeline preserves assistant and tool arrival order while terminal tool events update in place', () => {
  const entries = projectWorkflowTimeline([
    { event: 'agent_run_started', timestamp: '2026-09-19T04:00:00.000Z' },
    { event: 'assistant_message_started', messageId: 'm1', timestamp: '2026-09-19T04:00:01.000Z' },
    { event: 'assistant_delta', messageId: 'm1', delta: '先读取', timestamp: '2026-09-19T04:00:02.000Z' },
    { event: 'tool_call_started', toolCallId: 't1', toolName: 'resume_read', timestamp: '2026-09-19T04:00:03.000Z' },
    { event: 'tool_call_succeeded', toolCallId: 't1', toolName: 'resume_read', durationMs: 28, timestamp: '2026-09-19T04:00:04.000Z' },
    { event: 'assistant_message_started', messageId: 'm2', timestamp: '2026-09-19T04:00:05.000Z' },
    { event: 'assistant_delta', messageId: 'm2', delta: '再检查', timestamp: '2026-09-19T04:00:06.000Z' },
    { event: 'tool_call_started', toolCallId: 't2', toolName: 'resume_check', timestamp: '2026-09-19T04:00:07.000Z' },
    { event: 'tool_call_failed', toolCallId: 't2', toolName: 'resume_check', errorCode: 'CHECK_FAILED', timestamp: '2026-09-19T04:00:08.000Z' },
  ])
  assert.deepEqual(entries.map((entry) => entry.kind), ['assistant', 'tool', 'assistant', 'tool'])
  assert.equal(entries[0].text, '先读取')
  assert.equal(entries[1].state, 'done')
  assert.equal(entries[1].durationMs, 28)
  assert.equal(entries[3].state, 'blocked')
  assert.equal(entries[3].detail, 'CHECK_FAILED')
})

test('agent chat state preserves a local optimistic turn only as a suffix', () => {
  const persisted = [{ role: 'user', content: '旧消息' }]
  const local = [...persisted, { role: 'assistant', content: '流式中的回答' }]
  assert.deepEqual(mergeSessionMessages(persisted, local), local)
  assert.deepEqual(mergeSessionMessages(local, persisted), local)
})

test('agent chat state marks a workflow group as the source of assistant text after streaming', () => {
  const group = { events: [
    { event: 'assistant_message_started', messageId: 'm1' },
    { event: 'assistant_delta', messageId: 'm1', delta: '读取完成。' },
    { event: 'assistant_message_finished', messageId: 'm1' },
  ] }
  assert.equal(workflowGroupHasAssistantText(group), true)
  assert.equal(workflowGroupHasAssistantText({ events: [{ event: 'tool_call_succeeded' }] }), false)
})

test('agent chat state prefers the persisted final answer when streaming changes Markdown formatting', () => {
  const timeline = reduceAgentTimeline({
    messages: [
      { role: 'user', content: '检查简历', turnId: 'turn-1', messageId: 'user-1', sequence: 1 },
      { role: 'assistant', content: '第一段结果。\n\n| 项目 | 结果 |\n|---|---|\n| 姓名 | ✅ 通过 |', turnId: 'turn-1', messageId: 'persisted-assistant-1', sequence: 6 },
    ],
    events: [
      { event: 'agent_run_started', turnId: 'turn-1', runId: 'run-1', sequence: 2 },
      { event: 'assistant_message_started', turnId: 'turn-1', runId: 'run-1', messageId: 'stream-assistant-1', sequence: 3 },
      { event: 'assistant_delta', turnId: 'turn-1', runId: 'run-1', messageId: 'stream-assistant-1', delta: '第一段结果。 | 项目 | 结果 ||---|---|| 姓名 | ✅ 通过 |', sequence: 4 },
      { event: 'assistant_message_finished', turnId: 'turn-1', runId: 'run-1', messageId: 'stream-assistant-1', sequence: 5 },
    ],
  })
  assert.equal(timeline.length, 1)
  assert.equal(timeline[0].messages.filter((message) => message.role === 'assistant').length, 1)
  assert.equal(timeline[0].messages.find((message) => message.role === 'assistant').content.includes('| 项目 | 结果 |'), true)
  assert.equal(projectWorkflowTimeline(timeline[0].workflow.events).filter((entry) => entry.kind === 'assistant').length, 0)
})

test('agent chat state ignores stale run events', () => {
  assert.equal(isSameAgentRun({ runId: 'run-current' }, 'run-current'), true)
  assert.equal(isSameAgentRun({ runId: 'run-old' }, 'run-current'), false)
  assert.equal(isSameAgentRun({ event: 'agent_run_started' }, 'run-current'), true)
})

test('agent chat reducer keeps multi-turn messages and workflow in one chronological source', () => {
  const timeline = reduceAgentTimeline({
    messages: [
      { role: 'user', content: '第一轮', turnId: 'turn-1', messageId: 'user-turn-1', sequence: 1 },
      { role: 'assistant', content: '第一轮完成', turnId: 'turn-1', messageId: 'assistant-turn-1', sequence: 5 },
      { role: 'user', content: '第二轮', turnId: 'turn-2', messageId: 'user-turn-2', sequence: 6 },
      { role: 'assistant', content: '第二轮完成', turnId: 'turn-2', messageId: 'assistant-turn-2', sequence: 10 },
    ],
    events: [
      { event: 'agent_run_started', turnId: 'turn-1', runId: 'run-1', sequence: 2 },
      { event: 'tool_call_started', turnId: 'turn-1', runId: 'run-1', toolCallId: 'tool-1', toolName: 'resume_read', sequence: 3 },
      { event: 'tool_call_succeeded', turnId: 'turn-1', runId: 'run-1', toolCallId: 'tool-1', toolName: 'resume_read', sequence: 4 },
      { event: 'agent_run_finished', turnId: 'turn-1', runId: 'run-1', outcome: 'success', sequence: 5 },
      { event: 'agent_run_started', turnId: 'turn-2', runId: 'run-2', sequence: 7 },
      { event: 'tool_call_started', turnId: 'turn-2', runId: 'run-2', toolCallId: 'tool-2', toolName: 'resume_check', sequence: 8 },
      { event: 'tool_call_succeeded', turnId: 'turn-2', runId: 'run-2', toolCallId: 'tool-2', toolName: 'resume_check', sequence: 9 },
    ],
  })
  assert.deepEqual(timeline.map((turn) => turn.turnId), ['turn-1', 'turn-2'])
  assert.deepEqual(timeline.map((turn) => turn.messages.filter((message) => message.role === 'user')[0].content), ['第一轮', '第二轮'])
  assert.deepEqual(timeline.map((turn) => turn.workflow.events[0].turnId), ['turn-1', 'turn-2'])
})

test('agent chat reducer never appends an orphan workflow below newer messages', () => {
  const timeline = reduceAgentTimeline({
    messages: [{ role: 'user', content: '第二轮', turnId: 'turn-2', sequence: 8 }],
    events: [
      { event: 'agent_run_started', turnId: 'legacy-turn', runId: 'legacy-run', sequence: 1 },
      { event: 'tool_call_started', turnId: 'legacy-turn', runId: 'legacy-run', toolCallId: 'tool-legacy', toolName: 'resume_read', sequence: 2 },
    ],
  })
  assert.deepEqual(timeline.map((turn) => turn.turnId), ['turn-2'])
  assert.equal(timeline[0].workflow, null)
})

test('agent chat reducer does not compare workflow sequence with message timestamps', () => {
  const timeline = reduceAgentTimeline({
    messages: [
      { role: 'user', content: '17:17', turnId: 'turn-old', timestamp: '2026-09-19T09:17:00.000Z' },
      { role: 'user', content: '17:30', turnId: 'turn-new', timestamp: '2026-09-19T09:30:00.000Z' },
    ],
    events: [
      { event: 'agent_run_started', turnId: 'turn-old', runId: 'run-old', sequence: 100 },
      { event: 'tool_call_started', turnId: 'turn-old', runId: 'run-old', toolCallId: 'tool-old', toolName: 'resume_read', sequence: 101 },
      { event: 'agent_run_started', turnId: 'turn-new', runId: 'run-new', sequence: 10 },
      { event: 'tool_call_started', turnId: 'turn-new', runId: 'run-new', toolCallId: 'tool-new', toolName: 'resume_check', sequence: 11 },
    ],
  })
  assert.deepEqual(timeline.map((turn) => turn.messages[0].content), ['17:17', '17:30'])
})
