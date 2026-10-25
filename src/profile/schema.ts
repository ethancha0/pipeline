import { z } from 'zod';

const yearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'must be YYYY-MM');
const isoDate = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'must be YYYY-MM-DD');
const nonEmpty = z.string().trim().min(1, 'must not be empty');

// A key left blank in YAML (`preferred_name:`) parses as null; treat it like an omitted optional key.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === null ? undefined : v), schema.optional());

export const identitySchema = z.object({
  first_name: nonEmpty,
  last_name: nonEmpty,
  preferred_name: optional(nonEmpty),
  email: z.email(),
  phone: nonEmpty,
  location: z.object({
    city: nonEmpty,
    state: nonEmpty,
    country: nonEmpty,
    zip: optional(z.coerce.string()),
  }),
});

export const linksSchema = z.object({
  linkedin: z.url(),
  github: z.url(),
  portfolio: optional(z.url()),
});

export const educationSchema = z
  .array(
    z.object({
      school: nonEmpty,
      degree: nonEmpty,
      major: nonEmpty,
      start: yearMonth,
      end: yearMonth,
      gpa: optional(z.coerce.string()),
    }),
  )
  .min(1, 'add at least one entry (the first is your current school)');

export const experienceSchema = z
  .array(
    z.object({
      company: nonEmpty,
      title: nonEmpty,
      location: optional(nonEmpty),
      start: yearMonth,
      end: z.union([yearMonth, z.literal('present')], { error: 'must be YYYY-MM or "present"' }),
      summary: nonEmpty,
    }),
  )
  .default([]);

export const workAuthSchema = z.object({
  authorized_us: z.boolean(),
  needs_sponsorship_now: z.boolean(),
  needs_sponsorship_future: z.boolean(),
});

export const availabilitySchema = z.object({
  terms: z.array(nonEmpty).min(1),
  earliest_start: optional(isoDate),
  willing_to_relocate: z.boolean(),
});

/** Each value is the option text to choose, or "decline". */
export const eeoSchema = z.object({
  gender: nonEmpty,
  race_ethnicity: nonEmpty,
  hispanic_latino: nonEmpty,
  veteran: nonEmpty,
  disability: nonEmpty,
});

export const resumeSchema = z.object({ path: optional(nonEmpty) }).default({});

export const workdaySchema = z.object({ email: z.email() });

export const standardAnswersSchema = z
  .array(
    z.object({
      question: nonEmpty,
      answer: z.coerce.string(),
      locked: optional(z.boolean()),
    }),
  )
  .default([]);

export const profileSchema = z.object({
  identity: identitySchema,
  links: linksSchema,
  education: educationSchema,
  experience: experienceSchema,
  work_auth: workAuthSchema,
  availability: availabilitySchema,
  eeo: eeoSchema,
  resume: resumeSchema,
  workday: workdaySchema,
  standard_answers: standardAnswersSchema,
});

export type Profile = z.infer<typeof profileSchema>;

/** Top-level sections in display order (profile:check prints one line per section). */
export const PROFILE_SECTIONS = Object.keys(profileSchema.shape) as (keyof Profile)[];

export const LOCKED_CATEGORIES = ['work_auth', 'graduation', 'location', 'eeo'] as const;
export type LockedCategory = (typeof LOCKED_CATEGORIES)[number];

/** Answers that come only from profile.yaml and are never guessed. */
export interface LockedAnswers {
  work_auth: Profile['work_auth'];
  /** `education[0].end`, YYYY-MM */
  graduation: string;
  location: Profile['identity']['location'];
  eeo: Profile['eeo'];
  /** `standard_answers` entries with `locked: true` */
  standard: { question: string; answer: string }[];
}
