// Scrubbing privacy per Sentry (posture art. 9): verso Sentry non deve mai
// partire contenuto utente — niente body delle request, niente messaggi
// chat, niente titoli task. Restano stack trace, route e status code.
import type { Breadcrumb, ErrorEvent } from '@sentry/nextjs';

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    if (event.request.headers) {
      delete event.request.headers['cookie'];
      delete event.request.headers['authorization'];
    }
    if (typeof event.request.url === 'string') {
      event.request.url = event.request.url.split('?')[0];
    }
  }
  if (event.user) {
    event.user = event.user.id ? { id: event.user.id } : undefined;
  }
  delete event.extra;
  return event;
}

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.category === 'console') {
    // I console.* del codebase loggano oggetti che possono contenere
    // contenuto utente: si tengono solo livello e categoria.
    return { ...breadcrumb, message: '[scrubbed]', data: undefined };
  }
  if (breadcrumb.category === 'fetch' || breadcrumb.category === 'xhr') {
    const url =
      typeof breadcrumb.data?.url === 'string'
        ? breadcrumb.data.url.split('?')[0]
        : undefined;
    return {
      ...breadcrumb,
      data: {
        ...(url ? { url } : {}),
        ...(breadcrumb.data?.method ? { method: breadcrumb.data.method } : {}),
        ...(breadcrumb.data?.status_code !== undefined
          ? { status_code: breadcrumb.data.status_code }
          : {}),
      },
    };
  }
  return breadcrumb;
}
