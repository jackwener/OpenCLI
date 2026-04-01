export const NOTEBOOKLM_SITE = 'notebooklm';
export const NOTEBOOKLM_DOMAIN = 'notebooklm.google.com';
export const NOTEBOOKLM_HOME_URL = 'https://notebooklm.google.com/';

export type NotebooklmPageKind = 'notebook' | 'home' | 'unknown';

export interface NotebooklmPageState {
  url: string;
  title: string;
  hostname: string;
  kind: NotebooklmPageKind;
  notebookId: string;
  loginRequired: boolean;
  notebookCount: number;
}

export interface NotebooklmRow {
  id: string;
  title: string;
  url: string;
  source: 'current-page' | 'home-links' | 'rpc';
  is_owner?: boolean;
  created_at?: string | null;
}

export interface NotebooklmSourceRow {
  id: string;
  notebook_id: string;
  title: string;
  url: string;
  source: 'current-page' | 'rpc';
  type?: string | null;
  type_code?: number | null;
  size?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  status?: 'processing' | 'ready' | 'error' | 'preparing' | 'unknown' | null;
  status_code?: number | null;
}

export interface NotebooklmSourceFulltextRow {
  source_id: string;
  notebook_id: string;
  title: string;
  kind?: string | null;
  content: string;
  char_count: number;
  url?: string | null;
  source: 'rpc';
}

export interface NotebooklmSourceGuideRow {
  source_id: string;
  notebook_id: string;
  title: string;
  type?: string | null;
  summary: string;
  keywords: string[];
  source: 'rpc';
}

export interface NotebooklmSourceDeleteRow {
  notebook_id: string;
  source_id: string;
  deleted: boolean;
  source: 'rpc';
}

export interface NotebooklmSourceFreshnessRow {
  notebook_id: string;
  source_id: string;
  is_fresh: boolean;
  is_stale: boolean;
  source: 'rpc';
}

export interface NotebooklmSourceRefreshRow {
  notebook_id: string;
  source_id: string;
  refreshed: boolean;
  source: 'rpc';
}

export interface NotebooklmAskRow {
  notebook_id: string;
  prompt: string;
  answer: string;
  url: string;
  source: 'query-endpoint';
}

export interface NotebooklmReportDownloadRow {
  notebook_id: string;
  artifact_id: string;
  title: string;
  kind: 'report';
  output_path: string;
  created_at?: string | null;
  url: string;
  source: 'rpc';
}

export interface NotebooklmAudioDownloadRow {
  notebook_id: string;
  artifact_id: string;
  artifact_type: 'audio';
  title: string;
  output_path: string;
  created_at?: string | null;
  url: string;
  download_url: string;
  mime_type?: string | null;
  source: 'rpc+artifact-url';
}

export interface NotebooklmInfographicDownloadRow {
  notebook_id: string;
  artifact_id: string;
  artifact_type: 'infographic';
  title: string;
  output_path: string;
  created_at?: string | null;
  url: string;
  download_url: string;
  source: 'rpc+artifact-url';
}

export interface NotebooklmVideoDownloadRow {
  notebook_id: string;
  artifact_id: string;
  artifact_type: 'video';
  title: string;
  output_path: string;
  created_at?: string | null;
  url: string;
  download_url: string;
  mime_type?: string | null;
  source: 'rpc+artifact-url';
}

export interface NotebooklmDownloadListRow {
  notebook_id: string;
  artifact_id: string;
  artifact_type: 'report' | 'audio' | 'video' | 'infographic' | 'slide_deck';
  status: string;
  title: string;
  created_at: string | null;
  download_variants: string[];
  source: 'rpc+artifact-list';
}

export type NotebooklmInfographicOrientation = 'landscape' | 'portrait' | 'square';
export type NotebooklmInfographicDetail = 'concise' | 'standard' | 'detailed';
export type NotebooklmInfographicStyle =
  | 'auto_select'
  | 'sketch_note'
  | 'professional'
  | 'bento_grid'
  | 'editorial'
  | 'instructional'
  | 'bricks'
  | 'clay'
  | 'anime'
  | 'kawaii'
  | 'scientific';

export type NotebooklmGenerationErrorType =
  | 'daily_limit_reached'
  | 'feature_not_eligible'
  | 'content_insufficient'
  | 'generation_failed_unknown';

export interface NotebooklmGenerateRow {
  notebook_id: string;
  artifact_id: string | null;
  artifact_type: 'report' | 'audio' | 'infographic' | 'slide_deck';
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'unknown';
  created_at?: string | null;
  error_type?: NotebooklmGenerationErrorType | null;
  message?: string | null;
  source: 'rpc+create-artifact' | 'rpc+create-artifact+artifact-list';
}

export type NotebooklmSlideDeckDownloadFormat = 'pdf' | 'pptx';

export interface NotebooklmSlideDeckDownloadRow {
  notebook_id: string;
  artifact_id: string;
  artifact_type: 'slide_deck';
  title: string;
  output_path: string;
  created_at?: string | null;
  url: string;
  download_url: string;
  download_format: NotebooklmSlideDeckDownloadFormat;
  source: 'rpc+artifact-url';
}

export interface NotebooklmNotebookDetailRow extends NotebooklmRow {
  emoji?: string | null;
  source_count?: number | null;
  updated_at?: string | null;
}

export interface NotebooklmHistoryRow {
  thread_id: string;
  notebook_id: string;
  item_count: number;
  preview?: string | null;
  url: string;
  source: 'rpc';
}

export interface NotebooklmNoteRow {
  notebook_id: string;
  id?: string | null;
  title: string;
  created_at?: string | null;
  url: string;
  source: 'studio-list';
}

export interface NotebooklmSummaryRow {
  notebook_id: string;
  title: string;
  summary: string;
  url: string;
  source: 'summary-dom' | 'rpc';
}

export interface NotebooklmSuggestedTopicRow {
  question: string;
  prompt: string;
}

export interface NotebooklmNotebookDescriptionRow {
  notebook_id: string;
  summary: string;
  suggested_topics: NotebooklmSuggestedTopicRow[];
  suggested_topic_count: number;
  url: string;
  source: 'rpc' | 'summary-dom';
}

export interface NotebooklmNoteDetailRow {
  notebook_id: string;
  id?: string | null;
  title: string;
  content: string;
  url: string;
  source: 'studio-editor' | 'rpc';
}

export interface NotebooklmNoteDeleteRow {
  notebook_id: string;
  note_id: string;
  deleted: boolean;
  source: 'rpc';
}

export interface NotebooklmShareUserRow {
  email: string;
  permission: 'owner' | 'editor' | 'viewer' | 'unknown';
  display_name?: string | null;
  avatar_url?: string | null;
}

export interface NotebooklmShareStatusRow {
  notebook_id: string;
  is_public: boolean;
  access: 'restricted' | 'anyone_with_link';
  view_level: 'full' | 'chat_only';
  share_url?: string | null;
  shared_user_count: number;
  shared_users: NotebooklmShareUserRow[];
  source: 'rpc';
}

export interface NotebooklmLanguageRow {
  code: string;
  name: string;
  source: 'static';
}

export interface NotebooklmLanguageStatusRow {
  language: string;
  name?: string | null;
  source: 'rpc';
}
