export const getM3USourceType = (account) => {
  if (!account || account.account_type === 'XC') return 'XC';
  return account.server_url || !account.file_path ? 'M3U_URL' : 'M3U_FILE';
};

export const prepareM3USourceValues = (values, sourceType) => {
  const prepared = { ...values };
  if (sourceType === 'M3U_FILE') {
    prepared.server_url = '';
  } else {
    prepared.file_path = '';
  }
  if (sourceType !== 'XC') {
    prepared.username = '';
    prepared.password = '';
  }
  return prepared;
};

export const validateNewM3UAccount = (
  values,
  file,
  {
    sourceType = values.account_type === 'XC'
      ? 'XC'
      : file
        ? 'M3U_FILE'
        : 'M3U_URL',
    existingAccount,
  } = {}
) => {
  const errors = {};
  if (!values.name?.trim()) errors.name = 'Enter an account name.';
  if (sourceType !== 'M3U_FILE' && values.server_url) {
    try {
      const url = new URL(values.server_url);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    } catch {
      errors.server_url = 'Enter a complete HTTP or HTTPS URL.';
    }
  }
  if (sourceType === 'XC') {
    if (!values.server_url?.trim())
      errors.server_url = 'Enter the provider server URL.';
    if (!values.username?.trim())
      errors.username = 'Enter the provider username.';
    if (!values.password && existingAccount?.account_type !== 'XC')
      errors.password = 'Enter the provider password.';
  } else if (sourceType === 'M3U_FILE') {
    if (
      !file &&
      !(existingAccount?.account_type === 'STD' && existingAccount.file_path)
    )
      errors.file = 'Choose a playlist file.';
  } else if (!values.server_url?.trim()) {
    errors.server_url = 'Enter the playlist URL.';
  }
  return errors;
};
