import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import { createResumeAgent } from '../src/agent/deep-agent.js'
import { RESUME_PRODUCTION_SKILL_FILE, resumeProductionSkillFiles } from '../src/agent/resume-production-skill.js'

const skillPath = path.resolve('skills/resume-production/SKILL.md')

test('DSH resume contract is represented by a native DeepAgent skill', async () => {
  const skill = await fs.readFile(skillPath, 'utf8')
  assert.match(skill, /^---\s*\nname: resume-production/m)
  assert.match(skill, /sourceVersion: 1\.9\.0/)
  assert.match(skill, /Call `resume_prepare` and `resume_read`/)
  assert.match(skill, /resume_check -> resume_render -> resume_metrics -> resume_finalize/)
  assert.match(skill, /Never invent an employer/)

  const files = await resumeProductionSkillFiles()
  assert.equal(files[RESUME_PRODUCTION_SKILL_FILE].mimeType, 'text/markdown')
  assert.equal(files[RESUME_PRODUCTION_SKILL_FILE].content, skill)
})

test('open and production modes mount the native resume skill middleware', async () => {
  const chat = createResumeAgent({ model: new FakeListChatModel({ responses: ['ok'] }), executionMode: 'chat', tools: [] })
  const readOnly = createResumeAgent({ model: new FakeListChatModel({ responses: ['ok'] }), executionMode: 'read_only', tools: [] })
  const production = createResumeAgent({ model: new FakeListChatModel({ responses: ['ok'] }), executionMode: 'production', tools: [] })
  const chatGraph = await chat.getGraphAsync()
  const readOnlyGraph = await readOnly.getGraphAsync()
  const productionGraph = await production.getGraphAsync()
  assert.equal(Object.keys(chatGraph.nodes).some((name) => name.startsWith('SkillsMiddleware')), true)
  assert.equal(Object.keys(readOnlyGraph.nodes).some((name) => name.startsWith('SkillsMiddleware')), false)
  assert.equal(Object.keys(productionGraph.nodes).some((name) => name.startsWith('SkillsMiddleware')), true)
})

test('production state exposes DSH skill metadata without exposing host files', async () => {
  const agent = createResumeAgent({ model: new FakeListChatModel({ responses: ['ok'] }), executionMode: 'production', tools: [] })
  const result = await agent.invoke({
    messages: [{ role: 'user', content: '开始制作' }],
    files: await resumeProductionSkillFiles(),
  })
  assert.deepEqual(result.skillsMetadata?.map((skill) => skill.name), ['resume-production'])
  assert.equal(result.skillsMetadata[0].path, RESUME_PRODUCTION_SKILL_FILE)
  assert.equal(result.messages.at(-1).content, 'ok')
})
