import test from 'node:test';
import assert from 'node:assert/strict';
import { adapt_protocol_event, quota_error } from '../src/codex/codex_protocol_adapter';
import { adapt_session_line } from '../src/codex/codex_session_adapter';
const line = (type: string, payload: unknown): string =>
  JSON.stringify({ timestamp: '2026-09-30T10:00:00Z', type, payload });

test('only actual IDE originator and vscode source are eligible', () => {
  for (const [source, originator, eligible] of [
    ['vscode', 'codex_vscode', true],
    ['vscode', 'Codex Desktop', false],
    ['cli', 'codex_vscode', false],
    [{ subagent: {} }, 'codex_vscode', false],
  ] as const) {
    const record = adapt_session_line(
      line('session_meta', {
        id: 'session',
        cwd: 'C:/A',
        cli_version: '0.155',
        source,
        originator,
      }),
    );
    assert.ok(record && 'metadata' in record);
    assert.equal(record.metadata.eligible, eligible);
  }
});
for (const [type, state] of [
  ['task_started', 'working'],
  ['task_complete', 'idle'],
  ['turn_aborted', 'idle'],
] as const) {
  test(`rollout ${type} becomes ${state}`, () => {
    const record = adapt_session_line(line('event_msg', { type }));
    assert.ok(record && 'event' in record);
    assert.equal(record.event.state, state);
  });
}
test('confirmed Rust quota error and newer turn abort error become red', () => {
  for (const code of ['usage_limit_exceeded', 'rate_limit_exceeded']) {
    const record = adapt_session_line(
      line('event_msg', { type: 'error', message: 'PRIVATE_RESPONSE', codex_error_info: code }),
    );
    assert.ok(record && 'event' in record);
    assert.equal(record.event.state, 'rate_limited');
    assert.ok(!JSON.stringify(record).includes('PRIVATE_RESPONSE'));
    const abort = adapt_session_line(
      line('event_msg', { type: 'turn_aborted', error: { codex_error_info: code } }),
    );
    assert.ok(abort && 'event' in abort);
    assert.equal(abort.event.state, 'rate_limited');
  }
});
test('missing quotas, token percentages and answer text do not imply quota', () => {
  assert.equal(quota_error({ message: 'rate limit exhausted' }), false);
  assert.equal(quota_error({ code: 429 }), false);
  assert.equal(quota_error({ codex_error_info: 'server_overloaded' }), false);
  assert.deepEqual(
    adapt_session_line(
      line('event_msg', { type: 'token_count', rate_limits: { primary: { used_percent: 100 } } }),
    ),
    { activity: '2026-09-30T10:00:00Z' },
  );
  assert.equal(adapt_session_line(line('response_item', { text: 'rate limit' })), undefined);
});
test('technical progress retains only its timestamp and settings cannot refresh activity', () => {
  for (const type of ['token_count', 'item_completed'])
    assert.deepEqual(
      adapt_session_line(line('event_msg', { type, text: 'PRIVATE', item: { text: 'PRIVATE' } })),
      { activity: '2026-09-30T10:00:00Z' },
    );
  assert.equal(
    adapt_session_line(line('event_msg', { type: 'thread_settings_applied' })),
    undefined,
  );
});
test('parsing ignores partial, unknown and conversational records', () => {
  for (const input of [
    '{',
    line('event_msg', { type: 'user_message', message: 'PROMPT' }),
    line('new_event', {}),
    'text',
  ])
    assert.equal(adapt_session_line(input), undefined);
});
test('active app-server flags retain working state without an intervention state', () => {
  for (const flag of ['waitingOnApproval', 'waitingOnUserInput'])
    assert.equal(
      adapt_protocol_event({
        method: 'thread/status/changed',
        params: { threadId: 'a', status: { type: 'active', activeFlags: [flag] } },
      })?.state,
      'working',
    );
  assert.equal(
    adapt_protocol_event({
      method: 'thread/status/changed',
      params: { threadId: 'a', status: { type: 'active', activeFlags: [] } },
    })?.state,
    'working',
  );
});
test('app-server completions distinguish quota, technical failure and completion', () => {
  for (const [status, error, state] of [
    ['failed', { codexErrorInfo: 'usageLimitExceeded' }, 'rate_limited'],
    ['failed', { codexErrorInfo: 'unauthorized' }, 'unknown'],
    ['completed', null, 'idle'],
  ] as const)
    assert.equal(
      adapt_protocol_event({
        method: 'turn/completed',
        params: { threadId: 'a', turn: { status, error } },
      })?.state,
      state,
    );
});
test('intervention requests are ignored', () => {
  for (const method of [
    'item/commandExecution/requestApproval',
    'item/fileChange/requestApproval',
    'item/tool/requestUserInput',
    'item/permissions/requestApproval',
    'tool/requestUserInput',
  ])
    assert.equal(adapt_protocol_event({ method, params: { threadId: 'a' } }), undefined);
});
