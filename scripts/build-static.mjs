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

await copyFile(resolve(projectDirectory, 'project-shortcuts.js'), resolve(outputDirectory, 'project-shortcuts.js'));
console.log('Built public/index.html and project-shortcuts.js');
