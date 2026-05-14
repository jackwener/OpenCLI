import { describe, it, expect } from 'vitest';

const { __test__ } = await import('./memos.js');
var command = __test__.command;

describe('flomo memos', function() {
  it('should register as a valid command', function() {
    expect(command).toBeDefined();
    expect(command.site).toBe('flomo');
    expect(command.name).toBe('memos');
    expect(command.access).toBe('read');
    expect(command.browser).toBe(true);
    expect(command.strategy).toBe('cookie');
  });

  it('should define limit arg with default 20', function() {
    var arg = command.args.find(function(a) { return a.name === 'limit'; });
    expect(arg).toBeDefined();
    expect(arg.type).toBe('int');
    expect(arg.default).toBe(20);
  });

  it('should define since arg for time filter', function() {
    var arg = command.args.find(function(a) { return a.name === 'since'; });
    expect(arg).toBeDefined();
    expect(arg.type).toBe('int');
  });

  it('should define slug arg for pagination', function() {
    var arg = command.args.find(function(a) { return a.name === 'slug'; });
    expect(arg).toBeDefined();
  });

  it('should define output columns', function() {
    expect(command.columns).toContain('content');
    expect(command.columns).toContain('slug');
    expect(command.columns).toContain('tags');
    expect(command.columns).toContain('created_at');
    expect(command.columns).toContain('updated_at');
  });
});
