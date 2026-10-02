import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { catalogs, resolve_language, translate, valid_language } from '../src/i18n';
import { apply_settings_changes, read_config, valid_settings_changes } from '../src/config';
import { parse_server_message } from '../src/ipc/protocol';

test('automatic language accepts French variants and uses English for every other display language', () => {
  for (const locale of ['fr', 'fr-FR', 'fr-CA', 'FR-be'])
    assert.equal(resolve_language('auto', locale), 'fr');
  for (const locale of ['en-US', 'de-DE', 'es', '', 'frank'])
    assert.equal(resolve_language('auto', locale), 'en');
  assert.equal(resolve_language('fr', 'en-US'), 'fr');
  assert.equal(resolve_language('en', 'fr-FR'), 'en');
  for (const value of ['de', '', 1, null]) {
    assert.equal(valid_language(value), false);
    assert.equal(read_config((key) => (key === 'language' ? value : undefined)).language, 'auto');
  }
});

test('every shared interface text has both translations and matching interpolation placeholders', () => {
  assert.deepEqual(Object.keys(catalogs.fr).sort(), Object.keys(catalogs.en).sort());
  for (const [key, english] of Object.entries(catalogs.en)) {
    const french = catalogs.fr[key as keyof typeof catalogs.en];
    assert.ok(english.trim() && french.trim(), key);
    assert.deepEqual(
      french.match(/\{\d+\}/g)?.sort() ?? [],
      english.match(/\{\d+\}/g)?.sort() ?? [],
      key,
    );
  }
  assert.equal(
    translate('en', 'scope.workspace', '[SSH: fixture.example]'),
    'This workspace: [SSH: fixture.example]',
  );
  assert.equal(translate('fr', 'extension.auto_association'), 'Association automatique');
});

test('all command titles, setting descriptions and enum labels have complete French and English manifest resources', () => {
  for (const directory of ['extension', 'remote-extension']) {
    const json = (file: string): Record<string, unknown> =>
      JSON.parse(readFileSync(`${directory}/${file}`, 'utf8')) as Record<string, unknown>;
    const manifest = json('package.json');
    const en = json('package.nls.json');
    const fr = json('package.nls.fr.json');
    assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
    for (const key of Object.keys(en))
      assert.ok(
        typeof en[key] === 'string' && typeof fr[key] === 'string' && en[key] && fr[key],
        key,
      );
    const placeholders = JSON.stringify(manifest).match(/%[^%]+%/g) ?? [];
    assert.ok(placeholders.length > 0);
    for (const placeholder of placeholders)
      assert.ok(en[placeholder.slice(1, -1)] && fr[placeholder.slice(1, -1)], placeholder);
  }
});

test('language and timing changes save together with global language and workspace freshness scopes', async () => {
  const writes: unknown[] = [];
  assert.equal(
    await apply_settings_changes(
      { language: 'en', stale_working_minutes: 617 },
      true,
      () => undefined,
      async (...args) => {
        writes.push(args);
      },
    ),
    true,
  );
  assert.deepEqual(writes, [
    ['language', 'en', 'global'],
    ['stale_working_minutes', 617, 'workspace'],
  ]);
});

test('failed mixed saves restore language and exact numeric overrides and unreadable settings never write', async () => {
  const stored: Record<string, number | string | boolean | undefined> = {
    language: undefined,
    stale_working_minutes: 600,
  };
  let fail = true;
  assert.equal(
    await apply_settings_changes(
      { language: 'en', stale_working_minutes: 617 },
      true,
      (key) => stored[key],
      async (key, value) => {
        if (key === 'stale_working_minutes' && fail) {
          fail = false;
          throw new Error('read-only');
        }
        stored[key] = value;
      },
    ),
    false,
  );
  assert.deepEqual(stored, { language: undefined, stale_working_minutes: 600 });
  let writes = 0;
  assert.equal(
    await apply_settings_changes(
      { language: 'fr' },
      true,
      () => {
        throw new Error('unavailable');
      },
      async () => {
        writes++;
      },
    ),
    false,
  );
  assert.equal(writes, 0);
});

test('IPC language fields are validated and old welcome frames remain compatible', () => {
  const welcome = { version: 1, type: 'welcome', server_pid: 1 };
  assert.equal(parse_server_message(JSON.stringify(welcome))?.type, 'welcome');
  assert.equal(
    parse_server_message(JSON.stringify({ ...welcome, language: 'en' }))?.type,
    'welcome',
  );
  assert.equal(parse_server_message(JSON.stringify({ ...welcome, language: 'de' })), undefined);
  for (const changes of [
    { language: 'de' },
    { language: 1 },
    { language: 'en', bogus: 1 },
    { language: 'fr', exit_grace_seconds: 15 },
  ])
    assert.equal(valid_settings_changes(changes), false);
  assert.equal(
    parse_server_message(
      JSON.stringify({
        version: 1,
        type: 'configure_settings',
        request_id: 'language',
        changes: { language: 'en', stale_working_minutes: 600 },
      }),
    )?.type,
    'configure_settings',
  );
});
