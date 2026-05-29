import posthog from 'posthog-js';

const posthogKey = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const posthogHost = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || 'https://us.i.posthog.com';

let isInitialized = false;

export function initPostHog() {
  if (!posthogKey || isInitialized) {
    return;
  }

  posthog.init(posthogKey, {
    api_host: posthogHost,
    capture_pageview: false,
    capture_pageleave: true,
  });

  isInitialized = true;
}

export function captureEvent(name: string, properties?: Record<string, unknown>) {
  if (!posthogKey) {
    return;
  }

  posthog.capture(name, properties);
}

export function identifyUser(userId?: string, email?: string) {
  if (!posthogKey) {
    return;
  }

  posthog.identify(userId, email ? { email } : undefined);
}
