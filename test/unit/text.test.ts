import { describe, expect, it } from 'vitest';
import { bestOption, normalizeText, sameValue, similarity } from '../../src/util/text.js';

describe('normalizeText / sameValue', () => {
  it('drops case, accents, punctuation', () => {
    expect(normalizeText('  Baccalauréat, (B.S.)* ')).toBe('baccalaureat b s');
  });
  it('treats formatting differences as equal', () => {
    expect(sameValue('714-747-0796', '(714) 747-0796')).toBe(true);
    expect(sameValue('Yes', 'No')).toBe(false);
    expect(sameValue(null, '')).toBe(true);
  });
});

describe('similarity', () => {
  it('scores identical 1 and unrelated low', () => {
    expect(similarity('Software Engineer', 'software engineer')).toBe(1);
    expect(similarity('Male', 'Female')).toBeLessThan(0.8);
  });
});

describe('bestOption', () => {
  it.each([
    ['Yes', ['Yes', 'No'], 'Yes'],
    ['No', ['Yes', 'No, I will not require sponsorship'], 'No, I will not require sponsorship'],
    ['United States', ['Afghanistan +93', 'United States +1'], 'United States +1'],
    ['Bachelor of Science', ['Associates', 'Bachelors', 'Baccalauréat', 'Masters'], 'Bachelors'],
    ['University of California, Irvine', ['University of California - Berkeley', 'University of California - Irvine'], 'University of California - Irvine'],
    ['Asian', ['White', 'Asian (Not Hispanic or Latino)', 'Two or More Races'], 'Asian (Not Hispanic or Latino)'],
    ['No, I do not have a disability', ['Yes, I have a disability', 'No, I do not have a disability and have not had one in the past', "I don't wish to answer"], 'No, I do not have a disability and have not had one in the past'],
    ['June', ['January', 'June', 'July'], 'June'],
  ])('%s → %s', (value, options, expected) => {
    expect(bestOption(value, options)).toBe(expected);
  });

  it('does not confuse Male with Female', () => {
    expect(bestOption('Male', ['Female', 'Male', 'Non-binary'])).toBe('Male');
    expect(bestOption('Male', ['Female', 'Non-binary'])).toBeNull();
  });

  it('maps "decline" to the decline option', () => {
    expect(bestOption('decline', ['Yes', 'No', "I don't wish to answer"])).toBe("I don't wish to answer");
    expect(bestOption('decline', ['Male', 'Female', 'Decline To Self Identify'])).toBe('Decline To Self Identify');
    expect(bestOption('decline', ['Yes', 'No'])).toBeNull();
  });

  it('returns null when nothing is close or it is ambiguous', () => {
    expect(bestOption('Online job board', ['LinkedIn', 'Referral', 'Career fair'])).toBeNull();
    expect(bestOption('Engineer', ['Engineer I', 'Engineer II'])).toBe('Engineer I'); // word-boundary prefix wins
    expect(bestOption('', ['Yes'])).toBeNull();
  });
});
