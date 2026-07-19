#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const root = process.env.BRANDING_ROOT || '/app/client/dist';
const assetsDirectory = fs.existsSync(path.join(root, 'assets', 'logo.svg'))
  ? 'assets'
  : path.join('public', 'assets');

const readText = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const assetPath = (filename) => path.join(assetsDirectory, filename);

const requireText = (text, expected, source) => {
  if (!text.includes(expected)) {
    throw new Error(`${source} is missing ${JSON.stringify(expected)}`);
  }
};

const assertPngSize = (relativePath, expectedWidth, expectedHeight) => {
  const file = path.join(root, relativePath);
  const contents = fs.readFileSync(file);
  const signature = contents.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') {
    throw new Error(`${relativePath} is not a PNG file`);
  }
  const width = contents.readUInt32BE(16);
  const height = contents.readUInt32BE(20);
  if (width !== expectedWidth || height !== expectedHeight) {
    throw new Error(
      `${relativePath} is ${width}x${height}, expected ${expectedWidth}x${expectedHeight}`,
    );
  }
};

const html = readText('index.html');
requireText(html, '<title>ToCreate</title>', 'index.html');
requireText(html, 'name="application-name" content="ToCreate"', 'index.html');
requireText(html, 'name="apple-mobile-web-app-title" content="ToCreate"', 'index.html');

const logo = readText(assetPath('logo.svg'));
requireText(logo, '<title id="title">ToCreate</title>', assetPath('logo.svg'));

if (!fs.existsSync(path.join(root, assetPath('grok.svg')))) {
  throw new Error(`${assetPath('grok.svg')} is missing`);
}

if (assetsDirectory === 'assets' && fs.existsSync(path.join(root, 'assets', 'assets'))) {
  throw new Error('client build contains an invalid nested assets/assets directory');
}

const manifestPath = path.join(root, 'manifest.webmanifest');
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.name !== 'ToCreate' || manifest.short_name !== 'ToCreate') {
    throw new Error('manifest.webmanifest does not use the ToCreate name');
  }
} else {
  const viteConfig = readText('vite.config.ts');
  requireText(viteConfig, "name: 'ToCreate'", 'vite.config.ts');
  requireText(viteConfig, "short_name: 'ToCreate'", 'vite.config.ts');
}

[
  [assetPath('favicon-16x16.png'), 16, 16],
  [assetPath('favicon-32x32.png'), 32, 32],
  [assetPath('apple-touch-icon-180x180.png'), 180, 180],
  [assetPath('icon-192x192.png'), 192, 192],
  [assetPath('maskable-icon.png'), 512, 512],
].forEach(([relativePath, width, height]) => assertPngSize(relativePath, width, height));

console.log(`ToCreate branding verified in ${root}`);
