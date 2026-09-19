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
      // Normal chat stays on the native DeepAgent tool surface. The model decides
      // whether a tool is relevant; the tools and server-side gates enforce side
      // effects. Only an explicit read-only request narrows the tool surface.
      if (mode === AGENT_EXECUTION_MODES.CHAT || mode === AGENT_EXECUTION_MODES.PRODUCTION) return handler(request)
      const tools = request.tools.filter((candidate) => READ_ONLY_TOOLS.has(candidate.name))
      return handler({
        ...request,
        tools,
      })
    },
  })
}
