import test from 'node:test';
import assert from 'node:assert/strict';
import { create_versioned_remote_fetch } from '../src/codex/remote_bridge_transport';
import type { RemoteRequest } from '../src/codex/remote_state_provider';
const request: RemoteRequest = {
  version: 1,
  request_id: 'a',
  roots: ['/srv/A'],
  sessions_directory: '',
  stale_minutes: 60,
  pinned_session: undefined,
};
test('current remote bridge requires no installation', async () => {
  let installations = 0;
  const fetch = create_versioned_remote_fetch({
    version: '0.2.1',
    query: async () => ({ bridge_version: '0.2.1' }),
    install: async () => {
      installations++;
    },
  });
  assert.deepEqual(await fetch(request), { bridge_version: '0.2.1' });
  assert.equal(installations, 0);
});
test('bridge without a version is upgraded before accepting a snapshot', async () => {
  let upgraded = false;
  let installations = 0;
  const fetch = create_versioned_remote_fetch({
    version: '0.2.1',
    query: async () => (upgraded ? { bridge_version: '0.2.1' } : {}),
    install: async () => {
      installations++;
      upgraded = true;
    },
  });
  assert.deepEqual(await fetch(request), { bridge_version: '0.2.1' });
  await fetch(request);
  assert.equal(installations, 1);
});
test('an installed update awaiting remote reload is not repeatedly reinstalled', async () => {
  let installations = 0;
  let upgraded = false;
  const fetch = create_versioned_remote_fetch({
    version: '0.2.1',
    query: async () => ({ bridge_version: upgraded ? '0.2.1' : '0.2.0' }),
    install: async () => {
      installations++;
    },
  });
  await assert.rejects(fetch(request), /remote_bridge_reload_required/);
  await assert.rejects(fetch(request), /remote_bridge_reload_required/);
  assert.equal(installations, 1);
  upgraded = true;
  assert.deepEqual(await fetch(request), { bridge_version: '0.2.1' });
});
test('concurrent missing-bridge calls share installation and installation failures back off', async () => {
  let upgraded = false;
  let installations = 0;
  const fetch = create_versioned_remote_fetch({
    version: '0.2.1',
    query: async (input) =>
      upgraded ? { bridge_version: '0.2.1', request_id: input.request_id } : {},
    install: async () => {
      installations++;
      await new Promise((resolve) => setTimeout(resolve, 15));
      upgraded = true;
    },
  });
  const replies = await Promise.all([fetch(request), fetch({ ...request, request_id: 'b' })]);
  assert.equal(installations, 1);
  assert.deepEqual(replies, [
    { bridge_version: '0.2.1', request_id: 'a' },
    { bridge_version: '0.2.1', request_id: 'b' },
  ]);
  let now = 0;
  const offline = create_versioned_remote_fetch({
    version: '0.2.1',
    query: async () => {
      throw new Error('offline');
    },
    install: async () => {
      installations++;
      throw new Error('policy');
    },
    now: () => now,
  });
  await assert.rejects(offline(request), /policy/);
  await assert.rejects(offline(request), /remote_bridge_unavailable/);
  assert.equal(installations, 2);
  now = 60000;
  await assert.rejects(offline(request), /policy/);
  assert.equal(installations, 3);
});
