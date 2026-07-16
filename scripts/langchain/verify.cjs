'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function createResponse(annotations, includeAnnotations) {
  const part = { type: 'output_text', text: 'Search complete' };
  if (includeAnnotations) {
    part.annotations = annotations;
  }

  return {
    id: 'resp_test',
    model: 'gpt-test',
    output: [
      {
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [part],
        phase: null,
      },
    ],
  };
}

function verifyConverter(name, convert) {
  const omitted = convert(createResponse(undefined, false));
  assert.deepEqual(omitted.content, [
    { type: 'text', text: 'Search complete', annotations: [] },
  ]);

  const nullable = convert(createResponse(null, true));
  assert.deepEqual(nullable.content, [
    { type: 'text', text: 'Search complete', annotations: [] },
  ]);

  const cited = convert(
    createResponse(
      [
        {
          type: 'url_citation',
          url: 'https://example.com',
          title: 'Example',
          start_index: 0,
          end_index: 6,
        },
      ],
      true,
    ),
  );
  assert.deepEqual(cited.content, [
    {
      type: 'text',
      text: 'Search complete',
      annotations: [
        {
          type: 'citation',
          source: 'url_citation',
          url: 'https://example.com',
          title: 'Example',
          startIndex: 0,
          endIndex: 6,
        },
      ],
    },
  ]);

  process.stdout.write(`Verified ${name} Responses annotations conversion.\n`);
}

async function main() {
  const packageRoot = process.argv[2] ?? '/app/node_modules/@langchain/openai';
  const cjsPath = path.join(packageRoot, 'dist/converters/responses.cjs');
  const esmPath = path.join(packageRoot, 'dist/converters/responses.js');
  const cjs = require(cjsPath);
  const esm = await import(pathToFileURL(esmPath).href);

  verifyConverter('CommonJS', cjs.convertResponsesMessageToAIMessage);
  verifyConverter('ES module', esm.convertResponsesMessageToAIMessage);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
