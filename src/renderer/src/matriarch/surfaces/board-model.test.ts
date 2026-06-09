import { describe, expect, it } from 'vitest'
import {
  combineFreshness,
  deriveBoardContentState,
  firstErrorMessage,
  groupByColumn,
  summarizeEdges,
  type BoardFeedState
} from './board-model'
import type { WorkItem } from '../state/work-items'
import { WORK_COLUMN_ORDER, type WorkColumn } from '../components/status-vocabulary'

const item = (id: string, column: WorkColumn, task?: WorkItem['task']): WorkItem =>
  ({
    id,
    kind: 'task',
    column,
    config: { icon: (() => null) as never, tone: 'muted', label: column },
    title: id,
    note: '',
    summary: '',
    timestamp: null,
    task
  }) as WorkItem

const feed = (o: Partial<BoardFeedState> = {}): BoardFeedState => ({
  value: null,
  updatedAt: null,
  ...o
})

describe('groupByColumn', () => {
  it('creates every column even when empty, in board order', () => {
    const map = groupByColumn([])
    expect([...map.keys()]).toEqual(WORK_COLUMN_ORDER)
    for (const column of WORK_COLUMN_ORDER) {
      expect(map.get(column)).toEqual([])
    }
  })

  it('buckets items into their column and preserves insertion order', () => {
    const map = groupByColumn([item('a', 'working'), item('b', 'todo'), item('c', 'working')])
    expect(map.get('working')?.map((i) => i.id)).toEqual(['a', 'c'])
    expect(map.get('todo')?.map((i) => i.id)).toEqual(['b'])
    expect(map.get('parked')).toEqual([])
  })
})

describe('summarizeEdges', () => {
  it('emits dependency and decomposition edges for task-backed cards only', () => {
    const items = [
      item('t1', 'todo', {
        id: 't1',
        title: 't1',
        spec: '',
        status: 'pending',
        deps: ['t0'],
        parentId: 'root'
      }),
      item('shell', 'parked') // no task → no edges
    ]
    expect(summarizeEdges(items)).toEqual(['t0 -> t1', 'root ~> t1'])
  })

  it('returns no edges when no task carries deps or a parent', () => {
    const items = [
      item('t1', 'todo', { id: 't1', title: 't1', spec: '', status: 'ready', deps: [] })
    ]
    expect(summarizeEdges(items)).toEqual([])
  })
})

describe('combineFreshness', () => {
  it('reports the oldest update across feeds (board is only as fresh as its stalest feed)', () => {
    const { updatedAt } = combineFreshness([
      feed({ updatedAt: 5000 }),
      feed({ updatedAt: 2000 }),
      feed({ updatedAt: 9000 })
    ])
    expect(updatedAt).toBe(2000)
  })

  it('ignores feeds that have not produced a value yet', () => {
    const { updatedAt } = combineFreshness([feed({ updatedAt: null }), feed({ updatedAt: 7000 })])
    expect(updatedAt).toBe(7000)
  })

  it('returns null when nothing has loaded', () => {
    expect(combineFreshness([feed(), feed()]).updatedAt).toBeNull()
  })

  it('reports the slowest poll cadence and drops 0/undefined', () => {
    expect(
      combineFreshness([feed({ pollIntervalMs: 2000 }), feed({ pollIntervalMs: 5000 }), feed({})])
        .pollIntervalMs
    ).toBe(5000)
    expect(combineFreshness([feed(), feed()]).pollIntervalMs).toBeUndefined()
  })
})

describe('deriveBoardContentState', () => {
  it('is loading until any feed has loaded or produced a value', () => {
    expect(deriveBoardContentState([feed(), feed()], 0)).toBe('loading')
    expect(deriveBoardContentState([feed({ hasLoaded: true }), feed()], 0)).not.toBe('loading')
  })

  it('is error only when every feed errored with no last-known value', () => {
    const broken = feed({ error: { message: 'down' }, hasLoaded: true })
    expect(deriveBoardContentState([broken, broken], 0)).toBe('error')
  })

  it('shows content from a healthy feed even if a sibling errored', () => {
    const broken = feed({ error: { message: 'down' }, hasLoaded: true })
    const ok = feed({ value: [{}], updatedAt: 1, hasLoaded: true })
    expect(deriveBoardContentState([broken, ok], 3)).toBe('content')
  })

  it('is empty when feeds are healthy but produced no items', () => {
    expect(deriveBoardContentState([feed({ value: [], hasLoaded: true })], 0)).toBe('empty')
  })

  it('is content when items exist', () => {
    expect(deriveBoardContentState([feed({ value: [], hasLoaded: true })], 4)).toBe('content')
  })
})

describe('firstErrorMessage', () => {
  it('returns the first feed error message', () => {
    expect(firstErrorMessage([feed(), feed({ error: { message: 'boom' } })], 'fallback')).toBe(
      'boom'
    )
  })
  it('returns the fallback when no feed errored', () => {
    expect(firstErrorMessage([feed(), feed()], 'fallback')).toBe('fallback')
  })
})
