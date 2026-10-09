import type { CommandRunInput } from 'claude-code'
import { expect, test } from 'claude-code/testing'

// The test's $ raises command.run as the engine would, so it takes the full input.
const typed = (command: string, args = ''): CommandRunInput => ({
  command,
  args,
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 80 },
})

test('/hello greets by name', async $ => {
  const { text } = await $.command.run(typed('hello', 'Ada'))
  expect(text).toBe('Hello, Ada! (from the hello mod)')
})

test('/hello defaults to world', async $ => {
  const { text } = await $.command.run(typed('hello', ''))
  expect(text).toBe('Hello, world! (from the hello mod)')
})
