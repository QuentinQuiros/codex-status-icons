import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile as read_file, writeFile as write_file, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  decode_account_quota,
  read_account_quota,
  type QuotaObservation,
} from '../src/codex/account_quota';
import { AccountQuotaStateProvider } from '../src/codex/account_quota_provider';
import type { CodexStateProvider } from '../src/codex/codex_state_provider';
import type { StateSnapshot } from '../src/state';

const now = Date.now();
const window = (used_percent: unknown, resets_at = now / 1000 + 3600): unknown => ({
  usedPercent: used_percent,
  windowDurationMins: 300,
  resetsAt: resets_at,
});
const credits = { hasCredits: false, unlimited: false, balance: '0' };
const reply = (changes: Record<string, unknown> = {}): unknown => ({
  rateLimits: {
    limitId: 'codex',
    primary: window(50),
    secondary: null,
    credits,
    rateLimitReachedType: null,
    ...changes,
  },
});

test('remaining quota windows retain only verified numbers and omit missing or expired data', () => {
  const secondary = {
    usedPercent: 16,
    windowDurationMins: 10080,
    resetsAt: now / 1000 + 7200,
    secret: 'PRIVATE',
  };
  const result = decode_account_quota(reply({ primary: window(27.1), secondary }), now);
  assert.deepEqual(result.windows, [
    { remaining_percent: 72.9, window_minutes: 300, resets_at: now / 1000 + 3600 },
    { remaining_percent: 84, window_minutes: 10080, resets_at: now / 1000 + 7200 },
  ]);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  assert.equal(
    decode_account_quota(
      reply({ rateLimitReachedType: 'rate_limit_reached', primary: window(100) }),
      now,
    ).windows?.[0]?.remaining_percent,
    0,
  );
  for (const primary of [
    null,
    window('10'),
    window(101),
    window(50, now / 1000 - 1),
    { usedPercent: 20, windowDurationMins: 0, resetsAt: now / 1000 + 1 },
  ])
    assert.equal(decode_account_quota(reply({ primary }), now).windows, undefined);
});

test('server-classified rate limits and depleted workspace credits block automatically', () => {
  for (const type of [
    'rate_limit_reached',
    'workspace_owner_credits_depleted',
    'workspace_member_credits_depleted',
    'workspace_owner_usage_limit_reached',
    'workspace_member_usage_limit_reached',
  ]) {
    const result = decode_account_quota(reply({ rateLimitReachedType: type }), now);
    assert.equal(result.status, 'blocked');
    assert.equal(result.reason, 'account_' + type);
  }
  assert.equal(decode_account_quota(reply({ spendControlReached: true }), now).status, 'blocked');
});
test('100 percent needs confirmed absent credits and an unexpired limit window', () => {
  for (const key of ['primary', 'secondary'])
    assert.equal(decode_account_quota(reply({ [key]: window(100) }), now).status, 'blocked');
  for (const value of [null, {}, { hasCredits: false }, { unlimited: false }])
    assert.equal(
      decode_account_quota(reply({ primary: window(100), credits: value }), now).status,
      'unknown',
    );
  assert.equal(
    decode_account_quota(reply({ primary: window(100, now / 1000 - 1) }), now).status,
    'unknown',
  );
});
test('usable purchased or unlimited credits prevent a false red', () => {
  for (const value of [
    { hasCredits: true, unlimited: false, balance: '2.5' },
    { hasCredits: false, unlimited: true, balance: null },
  ])
    assert.equal(
      decode_account_quota(reply({ primary: window(100), credits: value }), now).status,
      'available',
    );
  assert.equal(decode_account_quota(reply(), now).status, 'available');
});
test('unrecognized buckets and malformed or missing values never establish an exhausted quota', () => {
  for (const value of [
    null,
    {},
    { rateLimits: {} },
    reply({ limitId: 'image_gen' }),
    reply({ rateLimitReachedType: 'future_value' }),
    reply({ primary: window('100') }),
    reply({ primary: window(NaN) }),
    reply({ primary: window(101) }),
    reply({ primary: null }),
    reply({
      primary: window(100),
      credits: { hasCredits: true, unlimited: false, balance: 'not-a-number' },
    }),
  ])
    assert.equal(decode_account_quota(value, now).status, 'unknown');
});
test('the codex bucket wins over unrelated model buckets and the legacy view', () => {
  const blocked = (reply({ primary: window(100) }) as { rateLimits: unknown }).rateLimits;
  const available = (reply() as { rateLimits: unknown }).rateLimits;
  assert.equal(
    decode_account_quota(
      { rateLimits: blocked, rateLimitsByLimitId: { codex: available, other: blocked } },
      now,
    ).status,
    'available',
  );
  assert.equal(
    decode_account_quota(
      { rateLimits: available, rateLimitsByLimitId: { codex: blocked, other: available } },
      now,
    ).status,
    'blocked',
  );
});

async function fake_server(
  mode: string,
  run: (executable: string, args: string[], log: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), 'codex-quota-'));
  const script = path.join(directory, 'server.cjs');
  const log = path.join(directory, 'methods.jsonl');
  await write_file(
    script,
    `const fs=require('node:fs'),readline=require('node:readline');
const mode=process.argv[2],log=process.argv[3];
readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);fs.appendFileSync(log,JSON.stringify({method:m.method,params:m.params})+'\\n');if(mode==='stall')return;if(m.id===undefined)return;
const send=result=>process.stdout.write(JSON.stringify({id:m.id,result})+'\\n');
if(m.method==='initialize')send({userAgent:'fixture'});
else if(m.method==='account/read')send({account:{type:mode==='apikey'?'apiKey':'chatgpt',email:'PRIVATE_ACCOUNT'}});
else if(m.method==='account/rateLimits/read'){
if(mode==='oversize'){process.stdout.write('x'.repeat(1100000));return;}
if(mode==='reject'){process.stdout.write(JSON.stringify({id:m.id,error:{code:429,message:'PRIVATE_ERROR'}})+'\\n');return;}
send({rateLimits:{limitId:'codex',rateLimitReachedType:'workspace_member_credits_depleted',private:'PRIVATE_SECRET'}});
}else process.exit(2);
});`,
  );
  try {
    await run(process.execPath, [script, mode, log], log);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
test('the stdio reader only initializes and reads account metadata without starting a turn', async () => {
  await fake_server('blocked', async (executable, args, log) => {
    const observation = await read_account_quota(
      executable,
      new AbortController().signal,
      2000,
      args,
    );
    assert.equal(observation.status, 'blocked');
    assert.ok(!JSON.stringify(observation).includes('PRIVATE'));
    const requests = (await read_file(log, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { method: string; params: unknown });
    assert.deepEqual(
      requests.map((r) => r.method),
      ['initialize', 'initialized', 'account/read', 'account/rateLimits/read'],
    );
    assert.deepEqual(requests[2]?.params, { refreshToken: false });
  });
});
test('API-key accounts do not use ChatGPT quota information', async () => {
  await fake_server('apikey', async (executable, args, log) => {
    assert.equal(
      (await read_account_quota(executable, new AbortController().signal, 2000, args)).status,
      'unknown',
    );
    assert.ok(!(await read_file(log, 'utf8')).includes('account/rateLimits/read'));
  });
});
test('rejected and oversized quota replies are bounded and contain no private error text', async () => {
  for (const mode of ['reject', 'oversize'])
    await fake_server(mode, async (executable, args) => {
      await assert.rejects(
        read_account_quota(executable, new AbortController().signal, 2000, args),
        { message: mode === 'reject' ? 'quota_rpc_rejected' : 'quota_reply_oversized' },
      );
    });
});
test('hung quota readers time out and an extension shutdown aborts its own process', async () => {
  await fake_server('stall', async (executable, args) => {
    await assert.rejects(read_account_quota(executable, new AbortController().signal, 100, args), {
      message: 'quota_request_timeout',
    });
    const controller = new AbortController();
    const pending = read_account_quota(executable, controller.signal, 2000, args);
    controller.abort();
    await assert.rejects(pending, { message: 'quota_reader_stopped' });
  });
});

class SessionFixture implements CodexStateProvider {
  callback: ((snapshot: StateSnapshot) => void) | undefined;
  snapshot: StateSnapshot = {
    state: 'idle',
    reason: 'task_complete',
    provider: 'session',
    session_id: 'fixture',
  };
  async start(callback: (snapshot: StateSnapshot) => void): Promise<void> {
    this.callback = callback;
    callback(this.snapshot);
  }
  update(state: StateSnapshot['state']): void {
    this.snapshot = { ...this.snapshot, state };
    this.callback?.(this.snapshot);
  }
  stop(): void {
    this.callback = undefined;
  }
  set_ambiguous(): void {}
  pin_session(): void {}
  sessions(): [] {
    return [];
  }
}
const observation = (status: QuotaObservation['status']): QuotaObservation => ({
  status,
  reason: 'account_' + status,
  checked_at: new Date().toISOString(),
});
const wait_until = async (condition: () => boolean): Promise<void> => {
  const end = Date.now() + 2000;
  while (!condition()) {
    if (Date.now() > end) throw new Error('test_timeout');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

test('quota percentages publish changes even while the session color remains green', async () => {
  let quota: QuotaObservation = {
    ...observation('available'),
    windows: [{ remaining_percent: 80, window_minutes: 300, resets_at: now / 1000 + 3600 }],
  };
  let changes = 0;
  const provider = new AccountQuotaStateProvider(new SessionFixture(), async () => quota);
  try {
    await provider.start(() => {
      changes++;
    });
    await wait_until(() => provider.quota_diagnostics().windows?.[0]?.remaining_percent === 80);
    const before = changes;
    quota = {
      ...quota,
      windows: [{ remaining_percent: 70, window_minutes: 300, resets_at: now / 1000 + 3600 }],
    };
    await provider.poll();
    assert.equal(provider.quota_diagnostics().windows?.[0]?.remaining_percent, 70);
    assert.equal(changes, before + 1);
  } finally {
    provider.stop();
  }
});
test('account quotas turn an idle session red automatically and confirmed recovery restores session state', async () => {
  const session = new SessionFixture();
  let quota = observation('blocked');
  let snapshot: StateSnapshot | undefined;
  const provider = new AccountQuotaStateProvider(session, async () => quota);
  try {
    await provider.start((value) => {
      snapshot = value;
    });
    await wait_until(() => snapshot?.state === 'rate_limited');
    session.update('working');
    assert.equal(snapshot?.state, 'rate_limited');
    quota = observation('available');
    await provider.poll();
    assert.equal(snapshot?.state, 'working');
    session.update('idle');
    assert.equal(snapshot?.state, 'idle');
    quota = observation('blocked');
    await provider.poll();
    assert.equal(snapshot?.state, 'rate_limited');
    quota = observation('unknown');
    await provider.poll();
    assert.equal(snapshot?.state, 'unknown');
  } finally {
    provider.stop();
  }
});
test('quota failure falls back safely and is isolated from another account provider', async () => {
  let first: StateSnapshot | undefined;
  let second: StateSnapshot | undefined;
  const a = new AccountQuotaStateProvider(new SessionFixture(), async () => {
    throw new Error('PRIVATE');
  });
  const b = new AccountQuotaStateProvider(new SessionFixture(), async () => observation('blocked'));
  try {
    await a.start((value) => {
      first = value;
    });
    await b.start((value) => {
      second = value;
    });
    await wait_until(() => second?.state === 'rate_limited');
    assert.equal(first?.state, 'idle');
    assert.equal(a.quota_diagnostics().reason, 'quota_unavailable');
    assert.ok(!JSON.stringify(a.quota_diagnostics()).includes('PRIVATE'));
  } finally {
    a.stop();
    b.stop();
  }
});
test('a stopped provider ignores a late quota reply and aborts in-flight reads', async () => {
  let resolve: ((quota: QuotaObservation) => void) | undefined;
  let signal: AbortSignal | undefined;
  let changes = 0;
  const provider = new AccountQuotaStateProvider(new SessionFixture(), (current) => {
    signal = current;
    return new Promise((done) => {
      resolve = done;
    });
  });
  await provider.start(() => {
    changes++;
  });
  provider.stop();
  assert.equal(signal?.aborted, true);
  resolve?.(observation('blocked'));
  await new Promise((done) => setTimeout(done, 10));
  assert.equal(changes, 1);
});
test('a missing spend-control field cannot clear a previously confirmed spend block', async () => {
  const session = new SessionFixture();
  let quota: QuotaObservation = {
    ...observation('blocked'),
    reason: 'account_spend_control_reached',
    spend_control_reached: true,
  };
  let snapshot: StateSnapshot | undefined;
  const provider = new AccountQuotaStateProvider(session, async () => quota);
  try {
    await provider.start((value) => {
      snapshot = value;
    });
    await wait_until(() => snapshot?.state === 'rate_limited');
    quota = observation('available');
    await provider.poll();
    assert.equal(snapshot?.state, 'unknown');
    quota = { ...observation('available'), spend_control_reached: false };
    await provider.poll();
    assert.equal(snapshot?.state, 'idle');
  } finally {
    provider.stop();
  }
});
