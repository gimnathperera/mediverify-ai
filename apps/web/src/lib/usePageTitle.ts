import { useEffect } from 'react';

export const APP_NAME = 'MediVerify AI';

/** Sets the browser tab title per route (screen readers announce it on navigation). */
export function usePageTitle(title: string | null | undefined) {
  useEffect(() => {
    document.title = title ? `${title} · ${APP_NAME}` : APP_NAME;
  }, [title]);
}
