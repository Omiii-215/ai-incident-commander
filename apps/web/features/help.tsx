'use client';

import { Card } from '@/components/ui';
import { PageHeader } from './shared';

export function Help() {
  return (
    <>
      <PageHeader title="Help" description="How the incident workflow, AI suggestions and approvals work in this release." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Incident lifecycle">
          <p className="prose-width">
            Declared → investigating → mitigating → monitoring → resolved. Acknowledging a declared incident assigns it to you and starts the investigation. Investigation can move straight to
            monitoring when no change is needed. A resolved incident can be reopened as a new generation.
          </p>
        </Card>
        <Card title="AI suggestions">
          <p className="prose-width">
            Diagnoses cite evidence records; open a citation to see the exact source, version and collection time. Hypotheses are not confirmed causes. Text in logs or runbooks that looks like
            an instruction is flagged and never used to justify an action.
          </p>
        </Card>
        <Card title="Approvals">
          <p className="prose-width">
            An approval applies to one immutable request and expires ten minutes after it was issued. The requester (and anyone who renewed it) cannot approve it. Execution re-checks
            permissions, revisions, expiry and stop controls just before running. If the outcome is unknown, it is reconciled — never retried automatically.
          </p>
        </Card>
        <Card title="Live updates">
          <p className="prose-width">
            The header shows Live, Reconnecting, Updates delayed or Offline. Lists show “N new updates” instead of moving rows under your cursor; choose Apply updates when ready. Commands are
            disabled while offline.
          </p>
        </Card>
        <Card title="Keyboard">
          <ul className="list-disc pl-5">
            <li>Use “Skip to main content” at the top of every page.</li>
            <li>Approvals require a checkbox and a button press; Enter in a text field never approves.</li>
            <li>Evidence citations are links that move focus to the cited record.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
