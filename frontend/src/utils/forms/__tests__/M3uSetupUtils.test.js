import { describe, expect, it } from 'vitest';
import {
  getM3USourceType,
  prepareM3USourceValues,
  validateNewM3UAccount,
} from '../M3uSetupUtils.js';

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
  it('requires the selected source, not a hidden draft value', () => {
    const file = new File(['#EXTM3U'], 'example.m3u');
    expect(
      validateNewM3UAccount({ ...values, account_type: 'STD' }, null, {
        sourceType: 'M3U_FILE',
      })
    ).toEqual({ file: 'Choose a playlist file.' });
    expect(
      validateNewM3UAccount(
        { ...values, account_type: 'STD', server_url: '' },
        file,
        { sourceType: 'M3U_URL' }
      )
    ).toEqual({ server_url: 'Enter the playlist URL.' });
    expect(
      validateNewM3UAccount({ ...values, server_url: 'invalid' }, file, {
        sourceType: 'M3U_FILE',
      })
    ).toEqual({});
  });
  it('keeps an existing file without requiring another upload', () => {
    expect(
      validateNewM3UAccount({ name: 'File', account_type: 'STD' }, null, {
        sourceType: 'M3U_FILE',
        existingAccount: {
          account_type: 'STD',
          file_path: '/data/example.m3u',
        },
      })
    ).toEqual({});
  });
  it('keeps an existing XC password but requires one when converting to XC', () => {
    expect(
      validateNewM3UAccount({ ...values, password: '' }, null, {
        existingAccount: { account_type: 'XC' },
      })
    ).toEqual({});
    expect(
      validateNewM3UAccount({ ...values, password: '' }, null, {
        existingAccount: { account_type: 'STD' },
      })
    ).toHaveProperty('password');
  });
  it.each([
    [null, 'XC'],
    [{ account_type: 'XC', file_path: '/data/old.m3u' }, 'XC'],
    [
      {
        account_type: 'STD',
        server_url: 'https://example.invalid',
        file_path: '/data/old.m3u',
      },
      'M3U_URL',
    ],
    [{ account_type: 'STD', file_path: '/data/example.m3u' }, 'M3U_FILE'],
    [{ account_type: 'STD' }, 'M3U_URL'],
  ])('selects the currently effective source for %j', (account, type) => {
    expect(getM3USourceType(account)).toBe(type);
  });
  it('clears the inactive source and XC credentials from standard payloads', () => {
    const input = { ...values, account_type: 'STD' };
    expect(prepareM3USourceValues(input, 'M3U_FILE')).toEqual({
      ...input,
      server_url: '',
      username: '',
      password: '',
    });
    expect(prepareM3USourceValues(input, 'M3U_URL')).toEqual({
      ...input,
      file_path: '',
      username: '',
      password: '',
    });
    expect(prepareM3USourceValues(values, 'XC')).toEqual({
      ...values,
      file_path: '',
    });
    expect(input).toEqual({ ...values, account_type: 'STD' });
  });
});
