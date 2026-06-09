import { describe, expect, it } from 'vitest'
import type { AgentState, CoordinatorRunStatus, TaskStatus } from '../backend'
import {
  AGENT_STATE_CONFIG,
  BOARD_COLUMN_ORDER,
  COORDINATOR_STATUS_CONFIG,
  TASK_STATUS_CONFIG,
  TONE_CLASS,
  WORK_COLUMN_CONFIG,
  WORK_COLUMN_ORDER,
  type Tone,
  type WorkColumn
} from './status-vocabulary'

// These tests guard the design vocabulary: every status maps to a config, every
// tone resolves to a class, and the "spin/pulse only for genuine activity" rule
// holds. They are render-logic tests (the vocabulary drives every card's glyph,
// color and animation) without mounting React, matching the repo's node test env.

const ALL_TONES: Tone[] = ['blue', 'red', 'amber', 'muted', 'fg']
const ALL_TASK_STATUSES: TaskStatus[] = [
  'pending',
  'ready',
  'dispatched',
  'completed',
  'failed',
  'blocked'
]
const ALL_AGENT_STATES: AgentState[] = ['working', 'blocked', 'waiting', 'done', 'idle']
const ALL_WORK_COLUMNS: WorkColumn[] = [
  'todo',
  'working',
  'needs-you',
  'review-ship',
  'done',
  'parked'
]
const ALL_COORDINATOR_STATUSES: CoordinatorRunStatus[] = ['running', 'idle', 'completed', 'failed']

describe('status vocabulary completeness', () => {
  it('every tone resolves to a text class', () => {
    for (const tone of ALL_TONES) {
      expect(TONE_CLASS[tone]).toMatch(/^text-/)
    }
  })

  it('every task status has a config with a usable label and icon', () => {
    for (const status of ALL_TASK_STATUSES) {
      const config = TASK_STATUS_CONFIG[status]
      expect(config.label.length).toBeGreaterThan(0)
      expect(config.icon).toBeTypeOf('object')
      expect(ALL_TONES).toContain(config.tone)
    }
  })

  it('every agent state has a config', () => {
    for (const state of ALL_AGENT_STATES) {
      expect(AGENT_STATE_CONFIG[state].label.length).toBeGreaterThan(0)
      expect(ALL_TONES).toContain(AGENT_STATE_CONFIG[state].tone)
    }
  })

  it('every work column has a config', () => {
    for (const column of ALL_WORK_COLUMNS) {
      expect(WORK_COLUMN_CONFIG[column].label.length).toBeGreaterThan(0)
    }
  })
})

describe('spin is reserved for live activity', () => {
  it('only the in-flight statuses spin', () => {
    expect(TASK_STATUS_CONFIG.dispatched.spin).toBe(true)
    expect(AGENT_STATE_CONFIG.working.spin).toBe(true)
    expect(WORK_COLUMN_CONFIG.working.spin).toBe(true)
  })
  it('terminal/resolved statuses never spin', () => {
    expect(TASK_STATUS_CONFIG.completed.spin).toBeFalsy()
    expect(TASK_STATUS_CONFIG.failed.spin).toBeFalsy()
    expect(AGENT_STATE_CONFIG.done.spin).toBeFalsy()
    expect(AGENT_STATE_CONFIG.idle.spin).toBeFalsy()
  })
})

describe('column orderings cover their domains exactly once', () => {
  it('BOARD_COLUMN_ORDER is a permutation of the task statuses', () => {
    expect([...BOARD_COLUMN_ORDER].sort()).toEqual([...ALL_TASK_STATUSES].sort())
  })
  it('WORK_COLUMN_ORDER is a permutation of the work columns', () => {
    expect([...WORK_COLUMN_ORDER].sort()).toEqual([...ALL_WORK_COLUMNS].sort())
  })
  it('off-path (blocked/failed) is tucked before completed on the board', () => {
    expect(BOARD_COLUMN_ORDER.indexOf('blocked')).toBeLessThan(
      BOARD_COLUMN_ORDER.indexOf('completed')
    )
    expect(BOARD_COLUMN_ORDER.indexOf('failed')).toBeLessThan(
      BOARD_COLUMN_ORDER.indexOf('completed')
    )
  })
})

describe('coordinator status config (Story 4.3)', () => {
  it('covers all four run statuses', () => {
    for (const status of ALL_COORDINATOR_STATUSES) {
      expect(COORDINATOR_STATUS_CONFIG[status].label).toBe(status)
    }
  })
  it('only running pulses (reads as live)', () => {
    expect(COORDINATOR_STATUS_CONFIG.running.pulse).toBe(true)
    expect(COORDINATOR_STATUS_CONFIG.idle.pulse).toBe(false)
    expect(COORDINATOR_STATUS_CONFIG.completed.pulse).toBe(false)
    expect(COORDINATOR_STATUS_CONFIG.failed.pulse).toBe(false)
  })
  it('running is blue, failed is red, the quiet ones are muted', () => {
    expect(COORDINATOR_STATUS_CONFIG.running.tone).toBe('blue')
    expect(COORDINATOR_STATUS_CONFIG.failed.tone).toBe('red')
    expect(COORDINATOR_STATUS_CONFIG.idle.tone).toBe('muted')
    expect(COORDINATOR_STATUS_CONFIG.completed.tone).toBe('muted')
  })
})
