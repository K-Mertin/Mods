import type { CommandRunInput } from 'claude-code'
import { expect, test } from 'claude-code/testing'

// The test's $ raises command.run as the engine would, so it takes the full input.
const typed = (command: string, args = ''): CommandRunInput => ({
  command,
  args,
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 80 },
})

test('/__NAME__ answers', async $ => {
  const { text } = await $.command.run(typed('__NAME__', ''))
  expect(text).toBe('__NAME__ is alive.')
})
