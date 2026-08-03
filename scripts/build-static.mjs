import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptDirectory, '..');
const outputDirectory = resolve(projectDirectory, 'public');

await mkdir(outputDirectory, { recursive: true });
await copyFile(
  resolve(projectDirectory, 'index.html'),
  resolve(outputDirectory, 'index.html')
);

console.log('Built public/index.html');
