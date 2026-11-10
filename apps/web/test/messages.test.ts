import { describe, expect, it } from 'vitest';

import { jobFailureMessage, modelLabel } from '../src/lib/messages';

describe('jobFailureMessage', () => {
  it('explains known pipeline failures in user terms', () => {
    expect(jobFailureMessage('MODEL_QUOTA_EXCEEDED', 'HTTP 429')).toMatch(
      /no remaining API credit/,
    );
    expect(jobFailureMessage('FIXTURE_NOT_FOUND', null)).toMatch(
      /only has model outputs for the bundled sample/,
    );
    expect(jobFailureMessage('PARSE_FAILED', null)).toMatch(/no OCR/);
    expect(jobFailureMessage('MODEL_UNAVAILABLE', 'timeout')).toMatch(/unavailable \(timeout\)/);
  });
  it('falls back to the server message, then to a generic one', () => {
    expect(jobFailureMessage('STAGE_TIMEOUT', 'Stage exceeded 120 s')).toBe('Stage exceeded 120 s');
    expect(jobFailureMessage(null, null)).toMatch(/unknown reason/);
  });
});

describe('modelLabel', () => {
  it('never presents fixture output as a live model', () => {
    expect(modelLabel({ provider: 'fixture', model: 'fixture' })).toBe(
      'Fixture outputs (not a live model)',
    );
    expect(modelLabel({ provider: 'openai', model: 'gpt-5.4-mini' })).toBe('openai · gpt-5.4-mini');
    expect(modelLabel(null)).toBe('Unknown model');
  });
});
