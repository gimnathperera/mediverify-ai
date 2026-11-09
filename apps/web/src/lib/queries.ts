import type { DocumentDto, UploadResponse } from '@mediverify/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, ApiRequestError } from './api';

export const qk = {
  me: ['me'] as const,
  config: ['config'] as const,
  references: ['references'] as const,
  documents: ['documents'] as const,
  document: (id: string) => ['document', id] as const,
  job: (id: string) => ['job', id] as const,
  results: (id: string) => ['results', id] as const,
};

export function useMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: async () => {
      try {
        return await api.me();
      } catch (e) {
        if (e instanceof ApiRequestError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

export const useConfig = () =>
  useQuery({ queryKey: qk.config, queryFn: api.config, staleTime: Infinity });
export const useReferences = () => useQuery({ queryKey: qk.references, queryFn: api.references });
export const useDocuments = () => useQuery({ queryKey: qk.documents, queryFn: api.documents });
export const useDocument = (id: string) =>
  useQuery({ queryKey: qk.document(id), queryFn: () => api.document(id) });
export const useJob = (id: string | undefined) =>
  useQuery({ queryKey: qk.job(id ?? ''), queryFn: () => api.job(id!), enabled: Boolean(id) });
export const useResults = (id: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: qk.results(id ?? ''),
    queryFn: () => api.results(id!),
    enabled: Boolean(id) && enabled,
  });

/** Optimistic item shown in the document list while the upload is in flight (never fabricates stages). */
export interface PendingUpload {
  tempId: string;
  filename: string;
  sizeBytes: number;
  progress: number;
  error: string | null;
}

export function useUploadDocument(onProgress: (tempId: string, p: number) => void) {
  const qc = useQueryClient();
  return useMutation<
    UploadResponse,
    ApiRequestError,
    { tempId: string; file: File; referenceId: string }
  >({
    mutationFn: ({ tempId, file, referenceId }) =>
      api.upload(file, referenceId, (p) => onProgress(tempId, p)),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.documents });
    },
  });
}

export function useRetryJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => api.retry(jobId),
    onSuccess: async (_r, _jobId) => {
      await qc.invalidateQueries({ queryKey: qk.documents });
    },
  });
}

export function upsertDocumentInList(list: DocumentDto[] | undefined, doc: DocumentDto) {
  if (!list) return [doc];
  const i = list.findIndex((d) => d.id === doc.id);
  if (i < 0) return [doc, ...list];
  const copy = [...list];
  copy[i] = doc;
  return copy;
}
