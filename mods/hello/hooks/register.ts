import type { Register } from 'claude-code'

export const register: Register = on => {
  let toolCalls = 0

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'hello',
      description: 'Say hello from the hello mod',
      argumentHint: '[name]',
    })

    return next(e)
  })

  on('command.run', { command: 'hello' }, async (_$, e) => {
    const name = e.args.trim() || 'world'

    return { text: `Hello, ${name}! (from the hello mod)` }
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    toolCalls += 1
    $.ui.status(`${toolCalls} tool call${toolCalls === 1 ? '' : 's'}`)

    return result
  }).catch(($, e, next) => next(e)) // a counter never blocks: on failure, let the call through
}
