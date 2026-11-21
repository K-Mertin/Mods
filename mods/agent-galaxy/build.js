#!/usr/bin/env node
/*
 * Builds agent-galaxy.js from src/: the page (page.html + page.js) is embedded in the server as one string,
 * so the result is a single file with no dependencies.
 *
 *   node build.js                  writes agent-galaxy.js
 *   node build.js --page out.html  also writes the page on its own (it then plays the built-in examples)
 */
'use strict';
const fs = require('fs'), path = require('path');
const src = f => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');

const page = src('page.html') + '<script>\n' + src('page.js') + '</script>\n</body>\n</html>\n';
const server = src('server.js');
if (!server.includes('__PAGE__')) throw new Error('src/server.js has no __PAGE__ placeholder');
fs.writeFileSync(path.join(__dirname, 'agent-galaxy.js'), server.replace('__PAGE__', () => JSON.stringify(page)));
console.log('wrote agent-galaxy.js');

const i = process.argv.indexOf('--page');
if (i > 0 && process.argv[i + 1]) { fs.writeFileSync(process.argv[i + 1], page); console.log('wrote ' + process.argv[i + 1]); }
