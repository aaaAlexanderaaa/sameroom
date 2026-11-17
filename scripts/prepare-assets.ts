import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
for (const [source, target] of [['draco/gltf', 'draco'], ['basis', 'basis']]) {
  const destination = join(root, 'public/vendor', target);
  await mkdir(destination, { recursive: true });
  await cp(join(root, 'node_modules/three/examples/jsm/libs', source), destination, { recursive: true });
}
console.log('Local GLB decoders prepared.');
