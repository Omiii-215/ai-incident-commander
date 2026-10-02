// Sends one signed synthetic alert to the local API, e.g.:
//   pnpm send-alert checkout http_error_rate sev2 "5xx rate exceeded"
import { randomUUID, createHmac } from 'node:crypto';

const [serviceKey = 'checkout', alertType = 'http_error_rate', severity = 'sev2', summary = 'Synthetic alert'] = process.argv.slice(2);
const connectorId = process.env.CONNECTOR_ID ?? '2f10a7b5-e8b3-4145-bcaf-787792815a89';
const secret = process.env.SECRET_SYNTHETIC_ALERTS_DEV;
if (!secret) throw new Error('Set SECRET_SYNTHETIC_ALERTS_DEV (see .env.example).');
const body = JSON.stringify({
  externalEventId: `cli-${randomUUID()}`,
  serviceKey,
  environment: 'demo',
  alertType,
  severity,
  occurredAt: new Date().toISOString(),
  summary,
  labels: {},
  measurements: {},
});
const ts = String(Math.floor(Date.now() / 1000));
const sig = createHmac('sha256', secret).update(`${ts}.`).update(body).digest('hex');
const res = await fetch(`http://localhost:${process.env.API_PORT ?? 4000}/api/v1/connectors/${connectorId}/alerts`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Connector-Timestamp': ts, 'X-Connector-Signature': sig },
  body,
});
console.log(res.status, await res.text());
