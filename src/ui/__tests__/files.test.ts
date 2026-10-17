/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

/**
 * Files as references, the page's half (REACTOR_UI RU-6): the bytes are the
 * body of one upload, the conversation and the name in headers, the ref what
 * comes back; a refusal is the host's sentence.
 */

import { describe, expect, it, vi } from 'vitest';
import { UI_FILE_NAME_HEADER, UI_FILE_SCOPE_HEADER, UiFileRefused, isFileRef, uploadFile } from '../files';

const file = (text: string, name: string, type: string) => Object.assign(new Blob([text], { type }), { name });

describe('uploadFile', () => {
  it('sends the bytes as the body and answers the ref the host kept', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers[UI_FILE_SCOPE_HEADER]).toBe('thread-1');
      expect(decodeURIComponent(headers[UI_FILE_NAME_HEADER])).toBe('réponse 1.csv');
      expect(headers['Content-Type']).toBe('text/csv');
      expect(headers.Authorization).toBe('Bearer ada');
      expect(await (init?.body as Blob).text()).toBe('a,b\n');
      return new Response(
        JSON.stringify({ ref: 'r-1', name: 'réponse 1.csv', media_type: 'text/csv', size: 4, url: '/files/thread-1/r-1?sig=s' }),
      );
    });
    const ref = await uploadFile(file('a,b\n', 'réponse 1.csv', 'text/csv'), {
      url: 'http://runtime/files',
      scope: 'thread-1',
      token: 'ada',
      fetcher: fetcher as unknown as typeof fetch,
    });
    expect(ref).toEqual({ ref: 'r-1', name: 'réponse 1.csv', media_type: 'text/csv', size: 4, url: '/files/thread-1/r-1?sig=s' });
    expect(isFileRef(ref)).toBe(true);
    expect(isFileRef({ name: 'x', data_url: 'data:,x' })).toBe(false);
    expect(fetcher).toHaveBeenCalledWith('http://runtime/files', expect.objectContaining({ method: 'POST' }));
  });

  it('says the host’s refusal, with its status', async () => {
    const refusing = (async () =>
      new Response(JSON.stringify({ detail: 'big.bin is 30 bytes: a file is at most 16' }), {
        status: 413,
      })) as unknown as typeof fetch;
    await expect(
      uploadFile(file('x'.repeat(30), 'big.bin', ''), { url: '/files', scope: 't', fetcher: refusing }),
    ).rejects.toEqual(new UiFileRefused(413, 'big.bin is 30 bytes: a file is at most 16'));
    const silent = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch;
    await expect(uploadFile(file('x', 'a.txt', 'text/plain'), { url: '/files', scope: 't', fetcher: silent })).rejects.toThrow(
      'a.txt was refused (401).',
    );
    const refless = (async () => new Response(JSON.stringify({ name: 'a.txt' }))) as unknown as typeof fetch;
    await expect(uploadFile(file('x', 'a.txt', 'text/plain'), { url: '/files', scope: 't', fetcher: refless })).rejects.toThrow(
      'The host kept a.txt under no ref.',
    );
  });
});
