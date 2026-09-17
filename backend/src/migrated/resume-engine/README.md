# Migrated resume engine

This directory contains the pure resume-domain capabilities migrated from the
original resume plugin. The code is now owned by CVAgent and has no runtime
dependency on the plugin host.

Included:

- Markdown semantic assembly and safe icon rendering
- composition renderer and layout schema
- template schema, built-in template descriptors and template CSS
- presentation normalization and template revision primitives
- atomic workspace file adapter for migrated capabilities

Excluded from this product runtime:

- plugin-host runtime integration
- MCP server and tool transport
- plugin lifecycle, sidebar injection and host UI state

The workspace file adapter keeps template history and presentation persistence
inside the CVAgent workspace model. `.cvagent/legacy` is implementation-owned
history and is never a second source of truth for task state.
