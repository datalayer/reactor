/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import React, { Suspense, lazy, useEffect, useState } from 'react';

const CmsSiteAgentRuntime = lazy(() => import('./CmsSiteAgentRuntime'));

export type CmsSiteSession = {
  token: string;
  user: { id: string; username: string; name: string };
  memberships: Array<{ site_id: string; role: string }>;
};

type Props = {
  apiUrl: string;
  siteId: string;
  siteName: string;
};

function storedSession(): CmsSiteSession | undefined {
  try {
    return JSON.parse(sessionStorage.getItem('cms-session') ?? 'null') ?? undefined;
  } catch {
    return undefined;
  }
}

/** Load the agent bundle only for a valid member of the published site. */
export default function CmsSiteAgent({ apiUrl, siteId, siteName }: Props) {
  const [session, setSession] = useState<CmsSiteSession>();

  useEffect(() => {
    let cancelled = false;
    const validate = async () => {
      const candidate = storedSession();
      if (!candidate?.token) {
        setSession(undefined);
        return;
      }
      try {
        const response = await fetch(`${apiUrl}/api/cms/session`, {
          headers: { Authorization: `Bearer ${candidate.token}` },
        });
        if (!response.ok) throw new Error('CMS session is no longer valid');
        const identity = (await response.json()) as Omit<CmsSiteSession, 'token'>;
        if (!identity.memberships.some(item => item.site_id === siteId)) {
          throw new Error('CMS session has no access to this site');
        }
        if (!cancelled) setSession({ token: candidate.token, ...identity });
      } catch {
        if (!cancelled) setSession(undefined);
      }
    };
    void validate();
    const refresh = () => void validate();
    window.addEventListener('storage', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('storage', refresh);
    };
  }, [apiUrl, siteId]);

  if (!session) return null;
  return (
    <Suspense fallback={null}>
      <CmsSiteAgentRuntime
        apiUrl={apiUrl}
        siteId={siteId}
        siteName={siteName}
        session={session}
      />
    </Suspense>
  );
}
