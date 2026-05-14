import { describe, expect, it, vi } from 'vitest';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { getUploadAuthV5Credentials, applyVideoUploadInner } from './vod-upload.js';

describe('douyin vod upload helpers', () => {
  it('parses creator upload auth v5 credentials', async () => {
    const page = { evaluate: async () => ({ status_code: 0, auth: JSON.stringify({ AccessKeyID: 'ak', SecretAccessKey: 'sk', SessionToken: 'token', ExpiredTime: 123, CurrentTime: 100 }) }) };
    await expect(getUploadAuthV5Credentials(page)).resolves.toEqual({ access_key_id: 'ak', secret_access_key: 'sk', session_token: 'token', user_id: '', expired_time: 123, current_time: 100 });
  });

  it('maps ApplyUploadInner response to TOS upload info', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ ResponseMetadata: { RequestId: 'req' }, Result: { InnerUploadAddress: { UploadNodes: [{ Vid: 'video-id', SessionKey: 'session-key', UploadHost: 'tos.example.com', StoreInfos: [{ StoreUri: 'obj/key.mp4', Auth: 'space-auth' }] }] } } }) });
    await expect(applyVideoUploadInner(1234, { access_key_id: 'ak', secret_access_key: 'sk', session_token: 'token' })).resolves.toEqual({ video_id: 'video-id', tos_upload_url: 'https://tos.example.com/obj/key.mp4', auth: 'space-auth', session_key: 'session-key', upload_header: {}, user_id: '' });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('Action=ApplyUploadInner');
    expect(String(url)).toContain('Version=2020-11-19');
    expect(init.headers.Authorization).toContain('AWS4-HMAC-SHA256 Credential=ak/');
    expect(init.headers['x-amz-security-token']).toBe('token');
    fetchSpy.mockRestore();
  });

  it('surfaces VOD API errors with context', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ ResponseMetadata: { Error: { Code: 'AccessDenied', Message: 'denied' } } }) });
    await expect(applyVideoUploadInner(1234, { access_key_id: 'ak', secret_access_key: 'sk', session_token: 'token' })).rejects.toBeInstanceOf(CommandExecutionError);
    fetchSpy.mockRestore();
  });
});
