import * as crypto from 'node:crypto';
import { CommandExecutionError } from '@jackwener/opencli/errors';

const AUTH_V5_URL = 'https://creator.douyin.com/web/api/media/upload/auth/v5/';
const VOD_UPLOAD_HOST = 'https://vod.bytedanceapi.com/';
const VOD_SPACE_NAME = 'aweme';

function hmacSha256(key, data) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data) {
  const hash = crypto.createHash('sha256');
  if (Buffer.isBuffer(data) || data instanceof Uint8Array) {
    hash.update(data);
  } else {
    hash.update(data ?? '', 'utf8');
  }
  return hash.digest('hex');
}

function nowDatetime() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

function canonicalQuery(url) {
  return [...url.searchParams.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

function computeAws4Headers(url, credentials, options = {}) {
  const parsedUrl = new URL(url);
  const datetime = nowDatetime();
  const date = datetime.slice(0, 8);
  const method = options.method ?? 'GET';
  const body = options.body ?? '';
  const bodyHash = sha256Hex(body);
  const headers = {
    ...(options.headers ?? {}),
    host: parsedUrl.host,
    'x-amz-content-sha256': bodyHash,
    'x-amz-date': datetime,
    'x-amz-security-token': credentials.session_token,
  };
  const sortedHeaderKeys = Object.keys(headers).sort((a, b) => a.localeCompare(b));
  const canonicalHeaders = sortedHeaderKeys
    .map((key) => `${key}:${String(headers[key]).trim()}`)
    .join('\n') + '\n';
  const signedHeaders = sortedHeaderKeys.join(';');
  const canonicalRequest = [
    method,
    parsedUrl.pathname || '/',
    canonicalQuery(parsedUrl),
    canonicalHeaders,
    signedHeaders,
    bodyHash,
  ].join('\n');
  const service = 'vod';
  const region = 'cn-north-1';
  const credentialScope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    datetime,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const kDate = hmacSha256(`AWS4${credentials.secret_access_key}`, date);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  const kSigning = hmacSha256(kService, 'aws4_request');
  const signature = hmacSha256(kSigning, stringToSign).toString('hex');
  return {
    ...headers,
    Authorization: `AWS4-HMAC-SHA256 Credential=${credentials.access_key_id}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

function extractUserIdFromSessionToken(sessionToken) {
  try {
    const raw = sessionToken.startsWith('STS2') ? sessionToken.slice(4) : sessionToken;
    const decoded = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    const policy = JSON.parse(decoded.PolicyString || '{}');
    const condition = policy?.Statement?.[0]?.Condition;
    if (typeof condition === 'string') {
      const parsedCondition = JSON.parse(condition);
      return parsedCondition.UserId || '';
    }
  } catch {
    return '';
  }
  return '';
}

export async function getUploadAuthV5Credentials(page) {
  const result = await page.evaluate(`fetch(${JSON.stringify(AUTH_V5_URL)}, { credentials: 'include' }).then(r => r.json())`);
  if (!result || typeof result !== 'object' || result.status_code !== 0 || !result.auth) {
    throw new CommandExecutionError(`获取抖音上传授权失败: ${JSON.stringify(result)}`);
  }
  let auth;
  try {
    auth = JSON.parse(result.auth);
  } catch (error) {
    throw new CommandExecutionError(`解析抖音上传授权失败: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!auth.AccessKeyID || !auth.SecretAccessKey || !auth.SessionToken) {
    throw new CommandExecutionError('抖音上传授权缺少 AccessKeyID/SecretAccessKey/SessionToken');
  }
  return {
    access_key_id: auth.AccessKeyID,
    secret_access_key: auth.SecretAccessKey,
    session_token: auth.SessionToken,
    user_id: extractUserIdFromSessionToken(auth.SessionToken),
    expired_time: auth.ExpiredTime,
    current_time: auth.CurrentTime,
  };
}

export async function applyVideoUploadInner(fileSize, credentials) {
  const params = new URLSearchParams({
    Action: 'ApplyUploadInner',
    Version: '2020-11-19',
    SpaceName: VOD_SPACE_NAME,
    FileType: 'video',
    IsInner: '1',
    FileSize: String(fileSize),
  });
  const url = `${VOD_UPLOAD_HOST}?${params.toString()}`;
  const res = await fetch(url, { headers: computeAws4Headers(url, credentials), signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new CommandExecutionError(`申请抖音上传地址失败，非 JSON 响应: HTTP ${res.status} ${text.slice(0, 300)}`);
  }
  const error = payload?.ResponseMetadata?.Error;
  if (!res.ok || error) {
    throw new CommandExecutionError(`申请抖音上传地址失败: HTTP ${res.status} ${JSON.stringify(error ?? payload)}`);
  }
  const uploadNode = payload?.Result?.InnerUploadAddress?.UploadNodes?.[0];
  const storeInfo = uploadNode?.StoreInfos?.[0];
  const videoId = payload?.Result?.Vid || uploadNode?.Vid;
  const sessionKey = uploadNode?.SessionKey ?? storeInfo?.SessionKey ?? payload?.Result?.SessionKey;
  if (!uploadNode?.UploadHost || !storeInfo?.StoreUri || !storeInfo?.Auth || !videoId || !sessionKey) {
    throw new CommandExecutionError(`申请抖音上传地址响应缺少必要字段: ${JSON.stringify(payload).slice(0, 500)}`);
  }
  return {
    video_id: videoId,
    tos_upload_url: `https://${uploadNode.UploadHost}/${storeInfo.StoreUri}`,
    auth: storeInfo.Auth,
    session_key: sessionKey,
    upload_header: uploadNode.UploadHeader ?? {},
    user_id: credentials.user_id ?? '',
  };
}


export async function commitVideoUploadInner(uploadInfo, credentials) {
  if (!uploadInfo?.session_key) {
    throw new CommandExecutionError('抖音上传提交缺少 SessionKey');
  }
  const params = new URLSearchParams({
    Action: 'CommitUploadInner',
    Version: '2020-11-19',
    SpaceName: VOD_SPACE_NAME,
  });
  const url = `${VOD_UPLOAD_HOST}?${params.toString()}`;
  const body = JSON.stringify({ SessionKey: uploadInfo.session_key });
  const headers = computeAws4Headers(url, credentials, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json;charset=UTF-8' },
  });
  const res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new CommandExecutionError(`提交抖音上传失败，非 JSON 响应: HTTP ${res.status} ${text.slice(0, 300)}`);
  }
  const error = payload?.ResponseMetadata?.Error;
  if (!res.ok || error) {
    throw new CommandExecutionError(`提交抖音上传失败: HTTP ${res.status} ${JSON.stringify(error ?? payload)}`);
  }
  const result = payload?.Result?.Results?.[0] ?? payload?.Result ?? {};
  const videoId = result.Vid ?? result.VideoId ?? result.VideoID ?? result.vid ?? uploadInfo.video_id;
  if (!videoId) {
    throw new CommandExecutionError(`提交抖音上传响应缺少 video id: ${JSON.stringify(payload).slice(0, 500)}`);
  }
  const meta = result.Meta ?? result.VideoMeta ?? {};
  return {
    video_id: videoId,
    poster_uri: result.PosterUri ?? result.PosterURI ?? result.SnapshotUri ?? result.SnapshotURI ?? '',
    width: Number(meta.Width ?? meta.width ?? 720) || 720,
    height: Number(meta.Height ?? meta.height ?? 1280) || 1280,
    raw: result,
  };
}
