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

export interface NotebooklmNoteDetailRow {
  notebook_id: string;
  id?: string | null;
  title: string;
  content: string;
  url: string;
  source: 'studio-editor';
}
