import type { OutboxKind } from '@aic/contracts';
import { runInvestigationJob } from '../ai/workflow.js';
import { executeActionJob, reconcileActionJob } from './executor.js';
import { indexRunbookJob, pluginTestJob, postmortemJob } from './knowledge.js';
import type { JobHandler } from './runtime.js';

/** Handlers by outbox kind. Worker roles register only the subset they are permitted to run. */
export const HANDLERS: Record<OutboxKind, JobHandler> = {
  'investigation.run': runInvestigationJob,
  'action.execute': executeActionJob,
  'action.reconcile': reconcileActionJob,
  'runbook.index': indexRunbookJob,
  'plugin.test': pluginTestJob,
  'postmortem.generate': postmortemJob,
};

export const ROLE_KINDS = {
  investigator: ['investigation.run', 'postmortem.generate', 'runbook.index', 'plugin.test'],
  executor: ['action.execute', 'action.reconcile'],
} as const satisfies Record<string, readonly OutboxKind[]>;
