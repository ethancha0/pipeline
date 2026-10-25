import type { FormField } from '../adapters/types.js';
import type { LockedAnswers, Profile } from '../profile/schema.js';
import { normalizeText } from '../util/text.js';
import type { Answer, AnswerProvider, Category } from './provider.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const US_STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

const yesNo = (b: boolean) => (b ? 'Yes' : 'No');
const month = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] ?? '';
const year = (ym: string) => ym.slice(0, 4);

/** "+17147470796" → "714-747-0796"; anything else unchanged. */
export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const us = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits.length === 10 ? digits : null;
  return us ? `${us.slice(0, 3)}-${us.slice(3, 6)}-${us.slice(6)}` : phone;
}

interface Rule {
  match: RegExp;
  /** Skip the rule when the label also matches this. */
  unless?: RegExp;
  types?: FormField['type'][];
  category: Category;
  /** Locked categories: value only from the profile; missing → blank + red, never guessed (CLAUDE.md rule 4). */
  locked?: boolean;
  value(p: Profile, l: LockedAnswers, field: FormField): string | null | undefined;
}

// Order matters: the first matching rule wins.
const RULES: Rule[] = [
  // Attestations and consents are the owner's own click, never auto-answered.
  {
    match: /\b(i (acknowledge|confirm|certify|agree|consent|understand|attest)|by checking|consent to|privacy (notice|policy))\b/,
    category: 'general',
    value: () => null,
  },
  // Follow-ups that only apply to an earlier answer ("If you answered Other above, …") stay blank.
  { match: /^if (you (answered|selected|chose)|other|yes|no|so|applicable)\b/, category: 'general', value: () => null },
  { match: /\b(resume|cv|curriculum vitae)\b/, types: ['file'], category: 'general', value: () => '__RESUME__' },
  { match: /cover letter/, category: 'general', value: () => null },

  { match: /\b(preferred|nick|chosen) ?(first )?name\b/, category: 'identity', value: (p) => p.identity.preferred_name ?? p.identity.first_name },
  { match: /\b(first|given) name\b/, category: 'identity', value: (p) => p.identity.first_name },
  { match: /\b(last|family) name\b|\bsurname\b/, category: 'identity', value: (p) => p.identity.last_name },
  { match: /^(full |legal )?name$/, category: 'identity', value: (p) => `${p.identity.first_name} ${p.identity.last_name}` },
  { match: /\be ?mail\b/, category: 'contact', value: (p) => p.identity.email },
  { match: /\b(phone|mobile|cell)\b/, category: 'contact', value: (p) => formatPhone(p.identity.phone) },
  { match: /linkedin/, category: 'links', value: (p) => p.links.linkedin },
  { match: /github/, category: 'links', value: (p) => p.links.github },
  { match: /\b(website|portfolio|personal (site|url|page))\b/, category: 'links', value: (p) => p.links.portfolio ?? p.links.github },

  // EEO (locked). "decline" maps to the form's decline option.
  { match: /transgender/, category: 'eeo', locked: true, value: () => null },
  { match: /\bgender\b|\bsex\b/, category: 'eeo', locked: true, value: (_p, l) => l.eeo.gender },
  { match: /hispanic|latin[oax]/, category: 'eeo', locked: true, value: (_p, l) => l.eeo.hispanic_latino },
  { match: /\brace\b|ethnicit/, category: 'eeo', locked: true, value: (_p, l) => l.eeo.race_ethnicity },
  { match: /veteran/, category: 'eeo', locked: true, value: (_p, l) => l.eeo.veteran },
  { match: /disabilit/, category: 'eeo', locked: true, value: (_p, l) => l.eeo.disability },

  // Work authorization (locked). Sponsorship first: its questions often also say "authorization".
  {
    match: /sponsor|\bvisa\b/,
    category: 'work_auth',
    locked: true,
    value: (_p, l, f) => {
      const label = normalizeText(f.label);
      const future = /\b(future|later|will you)\b/.test(label);
      const now = /\b(now|currently|current|at this time|today)\b/.test(label);
      const w = l.work_auth;
      if (now && !future) return yesNo(w.needs_sponsorship_now);
      if (future && !now) return yesNo(w.needs_sponsorship_future);
      return yesNo(w.needs_sponsorship_now || w.needs_sponsorship_future);
    },
  },
  {
    match: /authori[sz]|legally (able|eligible|permitted|allowed)|eligible to work|right to work|work permit/,
    category: 'work_auth',
    locked: true,
    value: (_p, l) => yesNo(l.work_auth.authorized_us),
  },
  { match: /relocat/, category: 'availability', value: (p) => yesNo(p.availability.willing_to_relocate) },

  // Education. Graduation (end date) is locked.
  { match: /\b(end|graduation|completion)\b.*\bmonth\b/, category: 'graduation', locked: true, value: (_p, l) => month(l.graduation) },
  { match: /\b(end|graduation|completion)\b.*\byear\b|\bclass of\b/, category: 'graduation', locked: true, value: (_p, l) => year(l.graduation) },
  {
    match: /\b(expected )?graduation( date)?\b|expected to graduate|when .*graduat/,
    category: 'graduation',
    locked: true,
    value: (_p, l) => `${month(l.graduation)} ${year(l.graduation)}`,
  },
  { match: /\bstart\b.*\bmonth\b/, category: 'education', value: (p) => month(p.education[0]!.start) },
  { match: /\bstart\b.*\byear\b/, category: 'education', value: (p) => year(p.education[0]!.start) },
  { match: /\b(school|university|college|institution)\b/, category: 'education', value: (p) => p.education[0]!.school },
  { match: /\bdegree\b/, category: 'education', value: (p) => p.education[0]!.degree },
  { match: /\b(discipline|major|field of study|area of study|concentration)\b/, category: 'education', value: (p) => p.education[0]!.major },
  { match: /\bgpa\b|grade point/, category: 'education', value: (p) => p.education[0]!.gpa },

  // Location (locked). Comboboxes get the long form ("Irvine, California, United States") to match geocoder options.
  {
    match: /^(current )?(location|city)\b|\(city\)|where (are you|do you) (currently )?(located|live|based)/,
    category: 'location',
    locked: true,
    value: (_p, l, f) => {
      const { city, state, country } = l.location;
      return f.type === 'combobox' ? `${city}, ${US_STATES[state.toUpperCase()] ?? state}, ${country}` : `${city}, ${state}`;
    },
  },
  { match: /\b(state|province)\b/, unless: /united states/, category: 'location', locked: true, value: (_p, l) => US_STATES[l.location.state.toUpperCase()] ?? l.location.state },
  { match: /\b(zip|postal)\b/, category: 'location', locked: true, value: (_p, l) => l.location.zip },
  { match: /^country\b|country of residence/, category: 'location', locked: true, value: (_p, l) => l.location.country },

  // Current role, from the experience entry that's ongoing (else the newest).
  { match: /current (job )?title|current (role|position)/, category: 'general', value: (p) => currentJob(p)?.title },
  { match: /current (employer|company)/, category: 'general', value: (p) => currentJob(p)?.company },

  { match: /\b(earliest|available).*\bstart\b|\bstart date\b|when can you start/, category: 'availability', value: (p) => p.availability.earliest_start },
  { match: /\b(term|season|semester)\b/, category: 'availability', value: (p) => p.availability.terms[0] },
];

function currentJob(p: Profile) {
  return p.experience.find((e) => e.end === 'present') ?? p.experience[0];
}

const STANDARD_STOPWORDS = new Set(['a', 'an', 'the', 'you', 'your', 'are', 'do', 'did', 'is', 'to', 'of', 'this', 'job', 'posting', 'position', 'role', 'us', 'we', 'our']);
const contentTokens = (s: string) => normalizeText(s).split(' ').filter((w) => w && !STANDARD_STOPWORDS.has(w));

/** Share of the stored question's words that appear in the label (0–1). */
export function tokenOverlap(stored: string, label: string): number {
  const want = contentTokens(stored);
  if (want.length === 0) return 0;
  const have = new Set(contentTokens(label));
  return want.filter((w) => have.has(w)).length / want.length;
}

/**
 * MVP answer provider: profile fields by keyword table, then `standard_answers`
 * by token overlap ≥ 0.8. Locked categories are flagged green, or red when the
 * profile has no value.
 */
export function createProfileProvider(profile: Profile, locked: LockedAnswers, resumePath: string): AnswerProvider {
  return {
    async resolve(field): Promise<Answer> {
      const label = normalizeText(field.label);

      for (const rule of RULES) {
        if (rule.types && !rule.types.includes(field.type)) continue;
        if (!rule.match.test(label) || rule.unless?.test(label)) continue;
        let value = rule.value(profile, locked, field) ?? null;
        if (value === '__RESUME__') value = resumePath;
        if (rule.locked) {
          return value
            ? { value, source: 'locked', flag: 'green', category: rule.category }
            : { value: null, source: 'none', flag: 'red', category: rule.category };
        }
        return { value, source: value ? 'profile' : 'none', category: rule.category };
      }

      let best: { answer: string; locked: boolean; score: number } | null = null;
      for (const a of profile.standard_answers) {
        const score = tokenOverlap(a.question, field.label);
        if (score >= 0.8 && (!best || score > best.score)) best = { answer: a.answer, locked: a.locked ?? false, score };
      }
      if (best) {
        return best.locked
          ? { value: best.answer, source: 'locked', flag: 'green', category: 'general' }
          : { value: best.answer, source: 'profile', category: 'general' };
      }

      return { value: null, source: 'none', category: 'general' };
    },
  };
}

