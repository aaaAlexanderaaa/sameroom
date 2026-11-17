import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// GLTFExporter uses the browser FileReader API; Node already supplies Blob.
class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend?: () => void;
  readAsArrayBuffer(blob: Blob) { void blob.arrayBuffer().then((v) => { this.result = v; this.onloadend?.(); }); }
  readAsDataURL(blob: Blob) { void blob.arrayBuffer().then((v) => { this.result = `data:${blob.type};base64,${Buffer.from(v).toString('base64')}`; this.onloadend?.(); }); }
}
Object.assign(globalThis, { FileReader: NodeFileReader });
const group = new THREE.Group();
group.name = 'Offline ceramic robot fixture';
const ivory = new THREE.MeshStandardMaterial({ color: '#e8dfcc', roughness: 0.32, metalness: 0.1 });
const teal = new THREE.MeshStandardMaterial({ color: '#1d666b', roughness: 0.25, metalness: 0.35 });
const dark = new THREE.MeshStandardMaterial({ color: '#162d38', roughness: 0.2 });
const eye = new THREE.MeshStandardMaterial({ color: '#aafae3', emissive: '#70e3c3', emissiveIntensity: 0.6 });
function part(name: string, dimensions: [number, number, number], position: [number, number, number], material: THREE.Material) {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(...dimensions, 3, 0.1), material);
  mesh.name = name;
  mesh.position.set(...position);
  group.add(mesh);
}
part('Body', [1.05, 1, 0.65], [0, 1.05, 0], ivory);
part('Head', [1.3, 0.85, 0.8], [0, 2.05, 0], ivory);
part('Visor', [1.05, 0.46, 0.12], [0, 2.08, 0.4], dark);
part('Left eye', [0.12, 0.19, 0.08], [-0.27, 2.1, 0.48], eye);
part('Right eye', [0.12, 0.19, 0.08], [0.27, 2.1, 0.48], eye);
part('Chest panel', [0.35, 0.29, 0.1], [0, 1.13, 0.35], teal);
part('Left arm', [0.28, 0.7, 0.36], [-0.72, 1.12, 0], teal);
part('Right arm', [0.28, 0.7, 0.36], [0.72, 1.12, 0], teal);
part('Left foot', [0.38, 0.48, 0.61], [-0.3, 0.28, 0.1], teal);
part('Right foot', [0.38, 0.48, 0.61], [0.3, 0.28, 0.1], teal);
const exported = await new GLTFExporter().parseAsync(group, { binary: true });
if (!(exported instanceof ArrayBuffer)) throw new Error('Expected binary GLB.');
const directory = fileURLToPath(new URL('../public/models/', import.meta.url));
await mkdir(directory, { recursive: true });
await writeFile(directory + 'offline-robot.glb', Buffer.from(exported));
console.log(`Offline fixture written: ${exported.byteLength} bytes. This is not an AI generation.`);
