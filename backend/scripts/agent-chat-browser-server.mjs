import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createLogger } from '../src/core/logger.js'
import { createServer } from '../src/server.js'
import { createScriptedResumeAgent } from './support/scripted-resume-agent.js'

const port = Number(process.env.CVAGENT_TEST_PORT || 3281)
const root = process.env.CVAGENT_TEST_ROOT
  ? path.resolve(process.env.CVAGENT_TEST_ROOT)
  : await fs.mkdtemp(path.join(os.tmpdir(), 'cvagent-agent-browser-'))

const server = createServer({
  workspaceDirectory: path.join(root, 'workspaces'),
  sessionDirectory: path.join(root, 'sessions'),
  logger: createLogger({ directory: path.join(root, 'logs'), component: 'agent-chat-browser-test' }),
  agentFactory: async (options) => createScriptedResumeAgent(options),
})

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`${JSON.stringify({ event: 'agent_chat_browser_server_started', port, root })}\n`)
})

async function shutdown() {
  await new Promise((resolve) => server.close(resolve))
  await server.flushLogs?.()
  process.exit(0)
}

process.once('SIGINT', () => { void shutdown() })
process.once('SIGTERM', () => { void shutdown() })
