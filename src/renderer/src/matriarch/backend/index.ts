export type {
  ConnectionState,
  FeedEvent,
  LiveFeed,
  MatriarchBackend,
  Unsubscribe
} from './matriarch-backend'
export type {
  AgentSnapshot,
  AgentState,
  CoordinatorState,
  Gate,
  GateStatus,
  InboxFilter,
  Message,
  MessagePriority,
  MessageType,
  Task,
  TaskDetail,
  TaskFilter,
  TaskStatus,
  TerminalHandle,
  TerminalSummary
} from './matriarch-types'
export { OrcaMatriarchBackend } from './orca/orca-backend'
export { MockMatriarchBackend } from './mock/mock-backend'
export { deriveTaskTitle } from './orca/derive-title'
