import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
export default {
 kit: {
  adapter: {
   name: 'static-standalone-map',
   async adapt(builder) {
    builder.rimraf('build');
    builder.writeClient('build');
    await builder.generateFallback('build/index.html');
    const html = await readFile('build/index.html', 'utf8');
    await writeFile('build/index.html', html.replace('</head>', '<style>iframe#nl-badge-frame { display: none !important; }</style></head>'));
    const hashes = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
     .filter(([, source]) => source.trim())
     .map(([, source]) => "'sha256-" + createHash('sha256').update(source.replace(/\r\n?/g, '\n')).digest('base64') + "'");
    await writeFile('build/_headers', "/*\n  Content-Security-Policy: script-src 'self' " + hashes.join(' ') + "\n");
   }
  }
 }
};
