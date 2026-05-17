import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { MouseEvent, ReactElement } from 'react'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { CreatePullRequestGenerateButton } from './CreatePullRequestGenerateButton'

type ReactElementLike = {
  type: unknown
  props: Record<string, unknown>
}

function visit(node: unknown, cb: (node: ReactElementLike) => void): void {
  if (node == null || typeof node === 'string' || typeof node === 'number') {
    return
  }
  if (Array.isArray(node)) {
    node.forEach((entry) => visit(entry, cb))
    return
  }
  const element = node as ReactElementLike
  cb(element)
  if (element.props?.children) {
    visit(element.props.children, cb)
  }
}

function findButton(node: unknown): ReactElementLike {
  let found: ReactElementLike | null = null
  visit(node, (entry) => {
    if (entry.type === Button) {
      found = entry
    }
  })
  if (!found) {
    throw new Error('button not found')
  }
  return found
}

type MinimalMouseEvent = Pick<MouseEvent, 'preventDefault'>

function renderMarkup(element: ReactElement): string {
  return renderToStaticMarkup(<TooltipProvider>{element}</TooltipProvider>)
}

describe('CreatePullRequestGenerateButton', () => {
  it('calls generate when the enabled control is clicked', () => {
    const onGenerate = vi.fn()
    const element = CreatePullRequestGenerateButton({
      generating: false,
      generateDisabled: false,
      onGenerate,
      onCancelGenerate: vi.fn()
    })
    const button = findButton(element)

    ;(button.props.onClick as (event: MinimalMouseEvent) => void)({
      preventDefault: vi.fn()
    })

    expect(onGenerate).toHaveBeenCalledTimes(1)
    expect(button.props.disabled).toBeUndefined()
  })

  it('keeps the disabled reason reachable without disabling focus', () => {
    const onGenerate = vi.fn()
    const preventDefault = vi.fn()
    const reason = 'Pick an agent in Settings → Git → AI Commit Messages.'
    const element = CreatePullRequestGenerateButton({
      generating: false,
      generateDisabled: true,
      generateDisabledReason: reason,
      onGenerate,
      onCancelGenerate: vi.fn()
    })
    const button = findButton(element)

    ;(button.props.onClick as (event: MinimalMouseEvent) => void)({ preventDefault })

    expect(onGenerate).not.toHaveBeenCalled()
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(button.props.disabled).toBeUndefined()
    expect(button.props['aria-disabled']).toBe(true)
    expect(button.props['aria-describedby']).toBe('create-pr-generate-disabled-reason')
    expect(renderMarkup(element)).toContain(reason)
  })

  it('shows and triggers the stop affordance while generating', () => {
    const onCancelGenerate = vi.fn()
    const element = CreatePullRequestGenerateButton({
      generating: true,
      generateDisabled: false,
      onGenerate: vi.fn(),
      onCancelGenerate
    })
    const button = findButton(element)

    ;(button.props.onClick as () => void)()

    expect(onCancelGenerate).toHaveBeenCalledTimes(1)
    expect(button.props['aria-label']).toBe('Stop generating pull request details')
    expect(renderMarkup(element)).toContain('Stop generating')
  })
})
