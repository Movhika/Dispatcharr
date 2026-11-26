// One alias group per line: "RTL Nitro = Nitro".
export const aliasesToText = (aliases = []) =>
  aliases.map((names) => names.join(' = ')).join('\n');

export const textToAliases = (text) =>
  text
    .split('\n')
    .map((line) =>
      line
        .split('=')
        .map((name) => name.trim())
        .filter(Boolean)
    )
    .filter((names) => names.length >= 2);
