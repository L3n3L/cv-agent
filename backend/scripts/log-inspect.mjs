import fs from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_DIRECTORY = path.resolve(process.env.CVAGENT_LOG_DIR || path.join(process.cwd(), 'logs'))
const FILE_PATTERN = /^agent-\d{4}-\d{2}-\d{2}(?:\.\d+)?\.ndjson$/

function parseArgs(argv) {
  const [command = 'summary', ...rest] = argv
  const args = { command, directory: DEFAULT_DIRECTORY, limit: 50, event: '', level: '', since: '', sessionId: '', runId: '', toolCallId: '' }
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index]
    if (item === '--dir') args.directory = path.resolve(rest[++index] || DEFAULT_DIRECTORY)
    else if (item === '--limit') args.limit = Math.max(1, Math.min(1000, Number(rest[++index]) || 50))
    else if (item === '--event') args.event = String(rest[++index] || '')
    else if (item === '--level') args.level = String(rest[++index] || '')
    else if (item === '--since') args.since = String(rest[++index] || '')
    else if (item === '--session') args.sessionId = String(rest[++index] || '')
    else if (item === '--run') args.runId = String(rest[++index] || '')
    else if (item === '--tool-call') args.toolCallId = String(rest[++index] || '')
  }
  return args
}

async function readEntries(directory) {
  const names = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
  const files = names.filter((entry) => entry.isFile() && FILE_PATTERN.test(entry.name)).map((entry) => entry.name).sort()
  const entries = []
  let invalidLines = 0
  for (const file of files) {
    const text = await fs.readFile(path.join(directory, file), 'utf8').catch(() => '')
    for (const line of text.split(/\r?\n/).filter(Boolean)) {
      try { entries.push(JSON.parse(line)) } catch { invalidLines += 1 }
    }
  }
  return { entries, files, invalidLines }
}

function matches(entry, args) {
  if (args.event && entry.event !== args.event) return false
  if (args.level && entry.level !== args.level) return false
  if (args.since && String(entry.timestamp || '') < args.since) return false
  if (args.sessionId && entry.sessionId !== args.sessionId) return false
  if (args.runId && entry.runId !== args.runId) return false
  if (args.toolCallId && entry.toolCallId !== args.toolCallId) return false
  return true
}

function durationStats(entries) {
  const values = entries.map((entry) => Number(entry.durationMs)).filter(Number.isFinite)
  if (!values.length) return null
  return { count: values.length, minMs: Math.min(...values), maxMs: Math.max(...values), avgMs: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)) }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const { entries, files, invalidLines } = await readEntries(args.directory)
  const filtered = entries.filter((entry) => matches(entry, args)).sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)) || Number(a.sequence || 0) - Number(b.sequence || 0))
  if (args.command === 'tail') {
    for (const entry of filtered.slice(-args.limit)) console.log(JSON.stringify(entry))
    return
  }
  if (args.command !== 'summary') throw new Error(`unknown log command: ${args.command}`)
  const byEvent = Object.create(null)
  const byLevel = Object.create(null)
  for (const entry of filtered) {
    byEvent[entry.event] = (byEvent[entry.event] || 0) + 1
    byLevel[entry.level] = (byLevel[entry.level] || 0) + 1
  }
  console.log(JSON.stringify({ directory: args.directory, files: files.length, entries: filtered.length, invalidLines, byLevel, byEvent, duration: durationStats(filtered), lastError: [...filtered].reverse().find((entry) => entry.level === 'error') || null }, null, 2))
}

main().catch((error) => { console.error(error.message); process.exitCode = 1 })
