export const validateNewM3UAccount = (values, file) => {
  const errors = {};
  if (!values.name?.trim()) errors.name = 'Enter an account name.';
  if (values.server_url) {
    try {
      const url = new URL(values.server_url);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    } catch {
      errors.server_url = 'Enter a complete HTTP or HTTPS URL.';
    }
  }
  if (values.account_type === 'XC') {
    if (!values.server_url?.trim())
      errors.server_url = 'Enter the provider server URL.';
    if (!values.username?.trim())
      errors.username = 'Enter the provider username.';
    if (!values.password) errors.password = 'Enter the provider password.';
  } else if (!values.server_url?.trim() && !file) {
    errors.server_url = 'Enter a playlist URL or upload a file.';
  }
  return errors;
};
