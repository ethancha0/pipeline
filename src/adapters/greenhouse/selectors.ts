// Every Greenhouse selector lives here so a site change is a one-file fix.
// Verified against job-boards.greenhouse.io embed forms (Epic Games, MongoDB, Waymo), 2026-10-24.

/**
 * Greenhouse's own hosted form for a job, by job id alone (it redirects to the
 * right board). Used for every Greenhouse job, including company pages with
 * ?gh_jid= — those often wrap the form in an iframe, a custom form, or a bot check.
 */
// OPEN: OQ6 — embeds on some company pages pass a validityToken; whether submits work without it is unconfirmed.
export const embedUrl = (jobId: string) => `https://boards.greenhouse.io/embed/job_app?token=${encodeURIComponent(jobId)}`;

/** Company pages that embed the board. */
export const IFRAME = '#grnhse_iframe';

export const FORM = 'form#application-form, form#application_form';

/** Controls that aren't questions: react-select's hidden required shims, the phone widget's country search, reCAPTCHA. */
export const EXCLUDE = [
  '[class*="requiredInput"]',
  '.iti__search-input',
  '[aria-hidden="true"]',
  'textarea[name="g-recaptcha-response"]',
  '[id^="g-recaptcha-response"]',
].join(', ');

/** The final submit button — scrolled into view, never clicked. */
export const SUBMIT = 'form#application-form button[type="submit"], form#application_form input[type="submit"], button[type="submit"]';

/** Closed postings redirect to the board with ?error=true. */
export const CLOSED_URL_PARAM = 'error';
