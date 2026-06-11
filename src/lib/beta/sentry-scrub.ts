// Scrubbing privacy per Sentry (posture art. 9): verso Sentry non deve mai
// partire contenuto utente — niente body delle request, niente messaggi
// chat, niente titoli task. Restano stack trace, route e status code.
import type { Breadcrumb, ErrorEvent } from '@sentry/nextjs';

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    // Il SDK node popola query_string in un campo separato dall'URL: va
    // rimosso esplicitamente, altrimenti la query sopravvive allo strip
    // dell'URL. Anche il referer può contenere URL con query.
    delete event.request.query_string;
    if (event.request.headers) {
      delete event.request.headers['cookie'];
      delete event.request.headers['authorization'];
      delete event.request.headers['referer'];
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

const stripQuery = (v: unknown): string | undefined =>
  typeof v === 'string' ? v.split('?')[0] : undefined;

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.category === 'fetch' || breadcrumb.category === 'xhr') {
    const url = stripQuery(breadcrumb.data?.url);
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
  if (breadcrumb.category === 'navigation') {
    // from/to includono la query string: strippata come per fetch/xhr.
    return {
      ...breadcrumb,
      data: {
        ...(stripQuery(breadcrumb.data?.from) ? { from: stripQuery(breadcrumb.data?.from) } : {}),
        ...(stripQuery(breadcrumb.data?.to) ? { to: stripQuery(breadcrumb.data?.to) } : {}),
      },
    };
  }
  // Allowlist: ogni altra categoria (console, ui.click/ui.input che possono
  // serializzare aria-label/title/valori, ecc.) tiene solo categoria e
  // livello — mai message/data, che potrebbero trasportare contenuto utente.
  return { category: breadcrumb.category, level: breadcrumb.level, type: breadcrumb.type };
}
