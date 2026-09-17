import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { sanitizeLogValue } from '../src/core/logger.js'

const directory = path.resolve(process.env.CVAGENT_LOG_DIR || path.join(process.cwd(), 'logs'))
const writeMode = process.argv.includes('--write')
const filePattern = /^agent-\d{4}-\d{2}-\d{2}(?:\.\d+)?\.ndjson$/

async function main() {
  const names = (await fs.readdir(directory, { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isFile() && filePattern.test(entry.name)).map((entry) => entry.name).sort()
  let summary = { files: names.length, validLines: 0, invalidLines: 0, changedLines: 0 }
  for (const name of names) {
    const filePath = path.join(directory, name)
    const lines = (await fs.readFile(filePath, 'utf8')).split(/\r?\n/).filter(Boolean)
    const output = []
    for (let index = 0; index < lines.length; index += 1) {
      const raw = lines[index]
      try {
        const parsed = JSON.parse(raw)
        const safe = sanitizeLogValue(parsed)
        const serialized = JSON.stringify(safe)
        output.push(serialized)
        summary.validLines += 1
        if (serialized !== raw) summary.changedLines += 1
      } catch {
        summary.invalidLines += 1
        output.push(JSON.stringify({ schemaVersion: 1, timestamp: new Date().toISOString(), level: 'warn', event: 'legacy_log_line_quarantined', component: 'log-migration', originalFile: name, originalLine: index + 1, originalBytes: Buffer.byteLength(raw, 'utf8'), originalSha256: crypto.createHash('sha256').update(raw).digest('hex'), reason: 'invalid_json' }))
      }
    }
    if (writeMode) {
      const temporaryPath = `${filePath}.sanitized.tmp`
      await fs.writeFile(temporaryPath, `${output.join('\n')}\n`, 'utf8')
      await fs.rename(temporaryPath, filePath)
    }
  }
  console.log(JSON.stringify({ directory, mode: writeMode ? 'write' : 'dry-run', ...summary }, null, 2))
}

main().catch((error) => { console.error(error.message); process.exitCode = 1 })
