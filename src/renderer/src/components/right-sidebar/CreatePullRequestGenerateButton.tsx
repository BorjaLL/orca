import React from 'react'
import { RefreshCw, Sparkles, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

type CreatePullRequestGenerateButtonProps = {
  generating: boolean
  generateDisabled: boolean
  generateDisabledReason?: string
  onGenerate: () => void
  onCancelGenerate: () => void
}

export function CreatePullRequestGenerateButton({
  generating,
  generateDisabled,
  generateDisabledReason,
  onGenerate,
  onCancelGenerate
}: CreatePullRequestGenerateButtonProps): React.JSX.Element {
  if (generating) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancelGenerate}
            title="Stop generating"
            aria-label="Stop generating pull request details"
          >
            <RefreshCw className="size-4 animate-spin" />
            Stop generating
            <Square className="size-3 fill-current" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left" sideOffset={6}>
          Generating PR details. Click to stop.
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-disabled={generateDisabled || undefined}
          aria-describedby={
            generateDisabled && generateDisabledReason
              ? 'create-pr-generate-disabled-reason'
              : undefined
          }
          data-disabled={generateDisabled ? 'true' : undefined}
          onClick={(event) => {
            if (generateDisabled) {
              event.preventDefault()
              return
            }
            onGenerate()
          }}
          title={generateDisabledReason ?? 'Generate pull request details with AI'}
          aria-label="Generate pull request details with AI"
          className="data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50"
        >
          <Sparkles className="size-4" />
          Generate with AI
          {generateDisabled && generateDisabledReason ? (
            <span id="create-pr-generate-disabled-reason" className="sr-only">
              {generateDisabledReason}
            </span>
          ) : null}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left" sideOffset={6}>
        {generateDisabledReason ?? 'Generate pull request details with AI'}
      </TooltipContent>
    </Tooltip>
  )
}
