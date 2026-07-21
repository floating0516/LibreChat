const fs = require('node:fs');
const path = require('node:path');
const postcss = require('/app/node_modules/postcss');

const assetsDirectory = process.argv[2] ?? '/app/client/dist/assets';
const cssFile = fs
  .readdirSync(assetsDirectory)
  .find((name) => /^index\..*\.css$/.test(name));

if (!cssFile) {
  throw new Error(`Compiled application CSS was not found in ${assetsDirectory}`);
}

const expectations = new Map(
  [
    ['Claude dialog token', ['html[data-interface-style=claude]'], '--surface-dialog', '#f3efe5'],
    ['Claude chat token', ['html[data-interface-style=claude]'], '--surface-chat', '#f7f4ec'],
    [
      'Claude dialog surface',
      ['html[data-interface-style=claude]', '[role=dialog].bg-background'],
      'background',
      'var(--surface-dialog)',
    ],
    [
      'Claude composer surface',
      ['html[data-interface-style=claude]', '.chat-composer-shell', '[data-temporary=true]'],
      'background',
      'var(--surface-chat)',
    ],
    [
      'Claude dark dialog token',
      ['html.dark[data-interface-style=claude]'],
      '--surface-dialog',
      '#24231f',
    ],
    ['ChatGPT chat token', ['html[data-interface-style=chatgpt]'], '--surface-chat', '#fff'],
  ].map(([name, selectorParts, property, value]) => [
    name,
    { selectorParts, property, value },
  ]),
);

const css = fs.readFileSync(path.join(assetsDirectory, cssFile), 'utf8');
const root = postcss.parse(css);

root.walkRules((rule) => {
  const selector = rule.selector.replaceAll("'", '').replaceAll('"', '');
  for (const [name, expectation] of expectations) {
    if (!expectation.selectorParts.every((part) => selector.includes(part))) {
      continue;
    }
    rule.walkDecls(expectation.property, (declaration) => {
      if (declaration.value === expectation.value) {
        expectations.delete(name);
      }
    });
  }
});

if (expectations.size > 0) {
  throw new Error(`Missing compiled appearance rules: ${[...expectations.keys()].join(', ')}`);
}

console.log(`Verified Claude surface colors in ${cssFile}`);
