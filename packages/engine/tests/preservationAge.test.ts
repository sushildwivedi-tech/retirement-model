import { describe, expect, it } from 'vitest';
import { preservationAge } from '../src/rules';
import { loadRuleset } from '../src/loadRuleset';

const bands = loadRuleset('au-2026-07').super.preservationAgeByDateOfBirth.value;

describe('preservation age (ATO table by date of birth)', () => {
  it.each([
    ['1959-12-31', 55],
    ['1960-06-30', 55],
    ['1960-07-01', 56],
    ['1961-06-30', 56],
    ['1961-07-01', 57],
    ['1962-06-30', 57],
    ['1962-07-01', 58],
    ['1963-06-30', 58],
    ['1963-07-01', 59],
    ['1964-06-30', 59],
    ['1964-07-01', 60],
    ['1984-01-01', 60],
    ['2001-05-20', 60],
  ])('%s -> %i', (dob, expected) => {
    expect(preservationAge(dob, bands)).toBe(expected);
  });

  it('the ATO worked example: born 1 October 1964, preservation age 60', () => {
    expect(preservationAge('1964-10-01', bands)).toBe(60);
  });

  it('throws on an unparseable date rather than defaulting', () => {
    expect(() => preservationAge('not-a-date', bands)).toThrow(/unparseable/);
  });
});
