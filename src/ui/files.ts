/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

/**
 * Files as references, the page's half (REACTOR_UI P6, RU-6).
 *
 * A file never rides inside JSON: the page uploads its bytes to the host
 * first ({@link uploadFile}, the body of one `POST`, its credential in
 * `Authorization`, the conversation in `X-Reactor-Scope`, its name in
 * `X-Reactor-File-Name`), and sends the {@link FileRef} it is answered —
 * pressing an answer with it, or naming it with a message. The host reads the
 * bytes back from the ref, for whoever uploaded them in that conversation
 * only; the ref's `url` is a signed, short-lived path to fetch it from.
 *
 * `reactor.ui.files` is the host's half.
 *
 * @module ui/files
 */

import type { FileRef } from './wire';

/** The headers an upload says its conversation and its file's name in. */
export const UI_FILE_SCOPE_HEADER = 'X-Reactor-Scope';
export const UI_FILE_NAME_HEADER = 'X-Reactor-File-Name';

/** How a host lets a renderer upload a file the person chose: its ref, to press with. */
export type UiUpload = (file: File) => Promise<FileRef>;

/** Where, as whom and for which conversation a file is uploaded. */
export type UploadFileOptions = {
  /** The host's upload route. */
  url: string;
  /** The conversation it belongs to. */
  scope: string;
  /** The page's credential, sent as a bearer token; none on a host that needs none. */
  token?: string;
  fetcher?: typeof fetch;
};

/** An upload the host refused: its status, and its sentence. */
export class UiFileRefused extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'UiFileRefused';
  }
}

/**
 * Upload one file's bytes; the ref the host kept it under.
 *
 * @throws {UiFileRefused} with the host's sentence: too large (413), the
 * credential refused (401), the upload malformed (400).
 */
export async function uploadFile(
  file: Blob & { name: string },
  options: UploadFileOptions,
): Promise<FileRef> {
  const response = await (options.fetcher ?? fetch)(options.url, {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      [UI_FILE_SCOPE_HEADER]: options.scope,
      [UI_FILE_NAME_HEADER]: encodeURIComponent(file.name),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: file,
  });
  if (!response.ok) {
    let detail = '';
    try {
      const said = (await response.json()) as { detail?: unknown };
      detail = typeof said.detail === 'string' ? said.detail : '';
    } catch {
      // No sentence: the status says it.
    }
    throw new UiFileRefused(response.status, detail || `${file.name} was refused (${response.status}).`);
  }
  const ref = (await response.json()) as Partial<FileRef>;
  if (typeof ref.ref !== 'string' || typeof ref.name !== 'string' || typeof ref.media_type !== 'string') {
    throw new UiFileRefused(response.status, `The host kept ${file.name} under no ref.`);
  }
  return ref as FileRef;
}

/** Whether a value is a file's ref, as the host answers one. */
export function isFileRef(value: unknown): value is FileRef {
  const ref = value as Partial<FileRef> | null;
  return (
    typeof ref === 'object' &&
    ref !== null &&
    typeof ref.ref === 'string' &&
    typeof ref.name === 'string' &&
    typeof ref.media_type === 'string'
  );
}
