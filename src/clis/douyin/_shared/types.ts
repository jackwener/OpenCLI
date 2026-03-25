export interface Sts2Credentials {
  access_key_id: string;
  secret_access_key: string;
  session_token: string;
  expired_time: number;
}

export interface TosUploadInfo {
  tos_upload_url: string;
  /** Pre-computed Authorization header value returned by ApplyVideoUpload (StoreInfos[0].Auth) */
  auth: string;
  video_id: string;
}

export interface TranscodeResult {
  encode: number;
  duration: number;
  fps: number;
  height: number;
  width: number;
  poster_uri: string;
  poster_url: string;
}

export interface PublishResult {
  aweme_id: string;
  url: string;
  publish_time: number;
}
