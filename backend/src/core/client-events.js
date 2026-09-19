import { z } from 'zod'

const clientEventSchema = z.object({
  event: z.enum(['client_error', 'unhandled_rejection', 'resource_error', 'agent_sse_error']),
  message: z.string().trim().min(1).max(500),
  source: z.string().trim().max(300).optional(),
  stack: z.string().trim().max(4000).optional(),
  route: z.string().trim().max(200).optional(),
  clientEventId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).optional(),
  line: z.number().int().min(0).max(1_000_000).optional(),
  column: z.number().int().min(0).max(1_000_000).optional(),
  userAgent: z.string().trim().max(300).optional(),
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{1,120}$/).optional(),
  runId: z.string().regex(/^[A-Za-z0-9_-]{1,120}$/).optional(),
  workflowEvent: z.string().trim().max(120).optional(),
}).strict()

function redactClientText(value) {
  return String(value)
    .replace(/\b[A-Za-z]:\\[^\s)]+/g, '[PATH]')
    .replace(/\/(?:Users|home|private|tmp)\/[^\s)]+/g, '[PATH]')
    .replace(/\b(?:sk|rk)-[A-Za-z0-9_-]{12,}\b/gi, '[REDACTED]')
    .replace(/\bbearer\s+[^\s,;)]+/gi, 'Bearer [REDACTED]')
}

export function parseClientEvent(input) {
  const event = clientEventSchema.parse(input)
  return Object.fromEntries(Object.entries(event).map(([key, value]) => [key, typeof value === 'string' ? redactClientText(value) : value]))
}

export function clientEventErrorCode(error) {
  return error?.name === 'ZodError' ? 'CLIENT_EVENT_INVALID' : String(error?.code || 'CLIENT_EVENT_FAILED')
}
