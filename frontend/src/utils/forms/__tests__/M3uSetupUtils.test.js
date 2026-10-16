import { describe, expect, it } from 'vitest';
import { validateNewM3UAccount } from '../M3uSetupUtils.js';

describe('new M3U connection validation', () => {
  const values = {
    name: 'Example',
    account_type: 'XC',
    server_url: 'https://example.invalid',
    username: 'example',
    password: 'example',
  };
  it('accepts complete XC connection details', () => {
    expect(validateNewM3UAccount(values)).toEqual({});
  });
  it('requires all XC connection fields', () => {
    expect(Object.keys(validateNewM3UAccount({ account_type: 'XC' }))).toEqual(
      expect.arrayContaining(['name', 'server_url', 'username', 'password'])
    );
  });
  it.each(['invalid', 'ftp://example.invalid'])(
    'rejects an invalid URL: %s',
    (server_url) => {
      expect(validateNewM3UAccount({ ...values, server_url })).toHaveProperty(
        'server_url'
      );
    }
  );
  it('accepts a file instead of a URL for standard accounts', () => {
    expect(
      validateNewM3UAccount(
        { name: 'File', account_type: 'STD' },
        new File(['#EXTM3U'], 'example.m3u')
      )
    ).toEqual({});
  });
  it('requires either a URL or a file for standard accounts', () => {
    expect(
      validateNewM3UAccount({ name: 'File', account_type: 'STD' })
    ).toHaveProperty('server_url');
  });
});
