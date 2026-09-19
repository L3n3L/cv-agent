import { createMiddleware } from 'langchain'
import { AGENT_EXECUTION_MODES } from './execution-policy.js'

const READ_ONLY_TOOLS = new Set([
  'workspace_info', 'workspace_materials_list', 'workspace_material_read',
  'resume_production_guide', 'resume_prepare', 'resume_read', 'resume_check',
  'template_list', 'template_family_list', 'template_versions', 'icon_list',
  'layout_validate', 'ls', 'read_file', 'glob', 'grep',
])

export function createExecutionModeMiddleware(mode) {
  return createMiddleware({
    name: 'CVAgentExecutionMode',
    wrapModelCall: (request, handler) => {
      if (mode === AGENT_EXECUTION_MODES.PRODUCTION) return handler(request)
      const tools = request.tools.filter((candidate) => mode === AGENT_EXECUTION_MODES.READ_ONLY && READ_ONLY_TOOLS.has(candidate.name))
      return handler({
        ...request,
        tools,
        ...(mode === AGENT_EXECUTION_MODES.CHAT ? { toolChoice: 'none' } : {}),
      })
    },
  })
}
