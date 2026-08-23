import { describe, expect, it } from 'vitest';

import {
  COMMAND_RESULT_UNKNOWN_CODE,
  COMMAND_RESULT_UNKNOWN_HINT,
  buildCommandDispatchFailure,
  buildCommandTimeoutFailure,
  buildExtensionDisconnectFailure,
  commandResultUnknownMessage,
  resolveProfileRoute,
} from './daemon-utils.js';

describe('host command dispatch contracts', () => {
  it('uses a distinct command_result_unknown contract for ambiguous dispatched commands', () => {
    expect(COMMAND_RESULT_UNKNOWN_CODE).toBe('command_result_unknown');
    expect(commandResultUnknownMessage('navigate')).toContain('navigate command was dispatched');
    expect(COMMAND_RESULT_UNKNOWN_HINT).toContain('Inspect the browser/session state');
    expect(COMMAND_RESULT_UNKNOWN_HINT).toContain('Do not blindly retry write commands');
  });

  it('classifies dispatched extension disconnects as command_result_unknown', () => {
    expect(buildExtensionDisconnectFailure({
      contextId: 'work',
      action: 'navigate',
      dispatched: true,
    })).toEqual({
      message: 'Browser connection dropped after the navigate command was dispatched; it may have completed.',
      errorCode: 'command_result_unknown',
      errorHint: COMMAND_RESULT_UNKNOWN_HINT,
      countAsCommandResultUnknown: true,
    });
  });

  it('classifies pre-dispatch extension disconnects as profile_disconnected', () => {
    expect(buildExtensionDisconnectFailure({
      contextId: 'work',
      action: 'navigate',
      dispatched: false,
    })).toMatchObject({
      message: 'Browser profile "work" disconnected before command dispatch',
      errorCode: 'profile_disconnected',
      countAsCommandResultUnknown: false,
    });
  });

  it('classifies native-port dispatch failures as profile_disconnected', () => {
    expect(buildCommandDispatchFailure('work')).toMatchObject({
      message: 'Browser profile "work" disconnected before command dispatch',
      errorCode: 'profile_disconnected',
      countAsCommandResultUnknown: false,
    });
  });

  it('routes a REQUESTED profile strictly — fails loud when offline, even with one live profile', () => {
    expect(resolveProfileRoute({ requestedContextId: 'zvypsyje', connectedContextIds: ['pavmrekj'] })).toMatchObject({
      ok: false,
      errorCode: 'profile_disconnected',
    });
    expect(resolveProfileRoute({ requestedContextId: 'pavmrekj', connectedContextIds: ['pavmrekj'] })).toEqual({
      ok: true,
      contextId: 'pavmrekj',
    });
  });

  it('uses a PREFERRED profile when connected', () => {
    expect(resolveProfileRoute({ preferredContextId: 'zvypsyje', connectedContextIds: ['zvypsyje', 'other'] })).toEqual({
      ok: true,
      contextId: 'zvypsyje',
    });
  });

  it('falls back to the only connected profile when the preferred one is stale', () => {
    expect(resolveProfileRoute({ preferredContextId: 'zvypsyje', connectedContextIds: ['pavmrekj'] })).toEqual({
      ok: true,
      contextId: 'pavmrekj',
      fallbackFrom: 'zvypsyje',
    });
  });

  it('asks the user to choose when the preferred profile is stale and multiple are connected', () => {
    const route = resolveProfileRoute({ preferredContextId: 'zvypsyje', connectedContextIds: ['a', 'b'] });
    expect(route).toMatchObject({ ok: false, errorCode: 'profile_required' });
    if (!route.ok) {
      expect(route.error).toContain('zvypsyje');
      expect(route.errorHint).toContain('opencli profile use');
    }
  });

  it('keeps the legacy no-selection behavior: single auto-use, multiple ask, none error', () => {
    expect(resolveProfileRoute({ connectedContextIds: ['only'] })).toEqual({ ok: true, contextId: 'only' });
    expect(resolveProfileRoute({ connectedContextIds: ['a', 'b'] })).toMatchObject({ ok: false, errorCode: 'profile_required' });
    expect(resolveProfileRoute({ connectedContextIds: [] })).toMatchObject({ ok: false, errorCode: 'extension_not_connected' });
    expect(resolveProfileRoute({ preferredContextId: 'gone', connectedContextIds: [] })).toMatchObject({ ok: false, errorCode: 'extension_not_connected' });
  });

  it('classifies host-side command timeouts as command_result_unknown', () => {
    expect(buildCommandTimeoutFailure('navigate', 120_000)).toEqual({
      message: 'Browser navigate command timed out after 120s; it may still complete in the browser.',
      errorCode: 'command_result_unknown',
      errorHint: COMMAND_RESULT_UNKNOWN_HINT,
      countAsCommandResultUnknown: true,
    });
  });
});
