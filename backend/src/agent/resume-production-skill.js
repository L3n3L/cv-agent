import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const RESUME_PRODUCTION_SKILL_SOURCE = '/skills/'
export const RESUME_PRODUCTION_SKILL_FILE = '/skills/resume-production/SKILL.md'

const skillFileOnDisk = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../skills/resume-production/SKILL.md')
let cachedSkillFiles = null

/**
 * DeepAgents' native skill loader uses the StateBackend when no external
 * backend is configured. Supplying the skill as input state keeps the skill
 * portable and prevents the agent from receiving access to the host repo.
 */
export async function resumeProductionSkillFiles() {
  if (cachedSkillFiles) return cachedSkillFiles
  const [content, stat] = await Promise.all([
    fs.readFile(skillFileOnDisk, 'utf8'),
    fs.stat(skillFileOnDisk),
  ])
  const timestamp = stat.mtime.toISOString()
  cachedSkillFiles = {
    [RESUME_PRODUCTION_SKILL_FILE]: {
      content,
      mimeType: 'text/markdown',
      created_at: timestamp,
      modified_at: timestamp,
    },
  }
  return cachedSkillFiles
}
