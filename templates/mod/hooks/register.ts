import type { Register } from 'claude-code'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: '__NAME__', description: '__DESC__' })

    return next(e)
  })

  on('command.run', { command: '__NAME__' }, async () => ({ text: '__NAME__ is alive.' }))
}
