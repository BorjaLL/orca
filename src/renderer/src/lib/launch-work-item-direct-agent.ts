import { toast } from 'sonner'
import { pasteDraftWhenAgentReady } from '@/lib/agent-paste-draft'
import { track, tuiAgentToAgentKind } from '@/lib/telemetry'
import {
  defaultBuiltinTuiAgent,
  resolveDefaultTuiAgentPreference
} from '@/lib/custom-agent-resolve'
import type { AgentStartupPlan } from '@/lib/tui-agent-startup'
import type { AgentStartedTelemetry } from '@/lib/worktree-activation'
import type { LaunchSource } from '../../../shared/telemetry-events'
import { isTuiAgentEnabled, pickTuiAgent } from '../../../shared/tui-agent-selection'
import { TUI_AGENT_CONFIG } from '../../../shared/tui-agent-config'
import type { CustomAgentProfile, GlobalSettings, TuiAgent } from '../../../shared/types'
import { translate } from '@/i18n/i18n'

/** Pre-write the trust artifact that trust-gated CLIs (cursor-agent, copilot)
 *  write after the user accepts "Do you trust this folder?", so that menu never
 *  fires and consumes the bracketed-paste draft. Best-effort: main swallows
 *  errors, and the IPC presence is guarded against a stale preload bundle. */
export async function markDirectLaunchAgentTrusted(
  agent: TuiAgent,
  worktreePath: string,
  connectionId?: string | null
): Promise<void> {
  if (!worktreePath || !window.api.agentTrust?.markTrusted) {
    return
  }
  const preflight = TUI_AGENT_CONFIG[agent].preflightTrust
  if (!preflight) {
    return
  }
  try {
    await window.api.agentTrust.markTrusted({
      preset: preflight,
      workspacePath: worktreePath,
      ...(connectionId ? { connectionId } : {})
    })
  } catch {
    // Best-effort: continue with launch even if the trust write throws.
  }
}

/** Resolve which agent (and optional custom profile) a direct work-item launch
 *  should use from the saved default preference, honoring detection + disabled
 *  state. A custom-profile default resolves to its baseAgent and carries its
 *  command/env; a stale or non-custom default falls back to the built-in
 *  auto-pick. */
export function pickDirectLaunchAgent(
  settings: GlobalSettings | null | undefined,
  detectedIds: Set<TuiAgent>
): { agent: TuiAgent | null; customProfile: CustomAgentProfile | null } {
  const pref = settings?.defaultTuiAgent
  if (pref && typeof pref === 'object' && pref.kind === 'custom') {
    const resolved = resolveDefaultTuiAgentPreference(settings)
    if (
      resolved.kind === 'custom' &&
      detectedIds.has(resolved.agent) &&
      isTuiAgentEnabled(resolved.agent, settings?.disabledTuiAgents)
    ) {
      return { agent: resolved.agent, customProfile: resolved.profile }
    }
    return {
      agent: pickTuiAgent(null, detectedIds, settings?.disabledTuiAgents),
      customProfile: null
    }
  }
  return {
    agent: pickTuiAgent(defaultBuiltinTuiAgent(settings), detectedIds, settings?.disabledTuiAgents),
    customProfile: null
  }
}

export function buildDirectWorkItemStartupOpts(
  agent: TuiAgent | null,
  plan: AgentStartupPlan | null,
  launchSource: LaunchSource
): {
  startup?: { command: string; env?: Record<string, string>; telemetry?: AgentStartedTelemetry }
} {
  if (!plan) {
    return {}
  }
  const telemetry: AgentStartedTelemetry | null =
    agent === null
      ? null
      : { agent_kind: tuiAgentToAgentKind(agent), launch_source: launchSource, request_kind: 'new' }
  return {
    startup: {
      command: plan.launchCommand,
      ...(plan.env ? { env: plan.env } : {}),
      ...(telemetry ? { telemetry } : {})
    }
  }
}

export async function pasteDirectWorkItemDraftWhenAgentReady(args: {
  primaryTabId: string
  startupPlan: AgentStartupPlan
  content: string
  submit?: boolean
  forcePaste?: boolean
}): Promise<void> {
  const { primaryTabId, startupPlan, content, submit = false, forcePaste = false } = args
  await pasteDraftWhenAgentReady({
    tabId: primaryTabId,
    content,
    agent: startupPlan.agent,
    submit,
    forcePaste,
    onTimeout: () => {
      const label = submit ? 'prompt' : 'work item context'
      toast.message(
        translate(
          'auto.lib.launch.work.item.direct.agent.ceeeb509b5',
          'Agent took too long to start. The workspace is ready — paste the {{value0}} when the agent is idle.',
          { value0: label }
        )
      )
      // Why: process-startup timeout has no v1 enum slot; the `unknown` slice
      // on the dashboard is the trigger to add one.
      track('agent_error', {
        error_class: 'unknown',
        agent_kind: tuiAgentToAgentKind(startupPlan.agent)
      })
    }
  })
}
