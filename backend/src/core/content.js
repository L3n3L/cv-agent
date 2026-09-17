import crypto from 'node:crypto'

export function contentHash(content) {
  return crypto.createHash('sha256').update(String(content ?? ''), 'utf8').digest('hex').slice(0, 16)
}
