'use strict';

const fs = require('node:fs');
const path = require('node:path');

const expectedVersion = '1.4.5';
const targetFiles = ['dist/converters/responses.cjs', 'dist/converters/responses.js'];
const original = 'annotations: part.annotations.map(convertOpenAIAnnotationToLangChain),';
const replacement =
  'annotations: (part.annotations ?? []).map(convertOpenAIAnnotationToLangChain),';

function countOccurrences(source, value) {
  return source.split(value).length - 1;
}

function patchFile(file) {
  const source = fs.readFileSync(file, 'utf8');
  const occurrences = countOccurrences(source, original);
  if (occurrences !== 1) {
    throw new Error(`Expected one unpatched annotations conversion in ${file}, found ${occurrences}`);
  }

  const temporary = `${file}.librechat-patch`;
  fs.writeFileSync(temporary, source.replace(original, replacement), {
    mode: fs.statSync(file).mode,
  });
  fs.renameSync(temporary, file);
}

function main() {
  const packageRoot = process.argv[2] ?? '/app/node_modules/@langchain/openai';
  const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  if (packageJson.version !== expectedVersion) {
    throw new Error(
      `Expected @langchain/openai ${expectedVersion}, found ${String(packageJson.version)}`,
    );
  }

  for (const target of targetFiles) {
    patchFile(path.join(packageRoot, target));
  }

  process.stdout.write(
    `Patched @langchain/openai ${expectedVersion} Responses annotations handling.\n`,
  );
}

main();
