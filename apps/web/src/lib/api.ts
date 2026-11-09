import type {
  ApiErrorBody,
  CitationDto,
  Credentials,
  DocumentDto,
  ErrorCode,
  JobDto,
  ReferenceDto,
  ResultsDto,
  UploadResponse,
  UserDto,
} from '@mediverify/shared';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK',
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      credentials: 'same-origin',
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body && typeof init.body === 'string'
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiRequestError(
      0,
      'NETWORK',
      'Cannot reach the server. Check your connection and try again.',
    );
  }
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const err = (body as ApiErrorBody | null)?.error;
    throw new ApiRequestError(
      res.status,
      err?.code ?? 'INTERNAL',
      err?.message ?? `Request failed (${res.status})`,
      err?.details,
    );
  }
  return body as T;
}

export interface RuntimeConfig {
  llmProvider: string;
  llmModel: string;
  llmConfigured: boolean;
  fixtureMode: boolean;
  maxUploadBytes: number;
  disclaimer: string;
}

export interface ChunkPreview extends Omit<CitationDto, 'quote' | 'quoteValid'> {
  text: string;
}

export const api = {
  config: () => request<RuntimeConfig>('/config'),
  me: () => request<UserDto>('/auth/me'),
  login: (c: Credentials) =>
    request<UserDto>('/auth/login', { method: 'POST', body: JSON.stringify(c) }),
  signup: (c: Credentials) =>
    request<UserDto>('/auth/signup', { method: 'POST', body: JSON.stringify(c) }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  references: () => request<ReferenceDto[]>('/references'),
  chunk: (referenceId: string, chunkId: string) =>
    request<ChunkPreview>(`/references/${referenceId}/chunks/${chunkId}`),
  documents: () => request<DocumentDto[]>('/documents'),
  document: (id: string) => request<DocumentDto>(`/documents/${id}`),
  job: (id: string) => request<JobDto>(`/jobs/${id}`),
  results: (id: string) => request<ResultsDto>(`/jobs/${id}/results`),
  retry: (id: string) => request<UploadResponse>(`/jobs/${id}/retry`, { method: 'POST' }),

  /** XHR (not fetch) so we can report real upload progress. */
  upload(
    file: File,
    referenceId: string,
    onProgress?: (fraction: number) => void,
  ): Promise<UploadResponse> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/documents');
      xhr.withCredentials = true;
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.(e.loaded / e.total);
      };
      xhr.onerror = () =>
        reject(new ApiRequestError(0, 'NETWORK', 'Upload failed: cannot reach the server.'));
      xhr.onload = () => {
        let body: unknown = null;
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          /* non-JSON */
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body as UploadResponse);
        else {
          const err = (body as ApiErrorBody | null)?.error;
          reject(
            new ApiRequestError(
              xhr.status,
              err?.code ?? 'INTERNAL',
              err?.message ?? `Upload failed (${xhr.status})`,
            ),
          );
        }
      };
      const form = new FormData();
      form.append('referenceId', referenceId);
      form.append('file', file);
      xhr.send(form);
    });
  },
};
