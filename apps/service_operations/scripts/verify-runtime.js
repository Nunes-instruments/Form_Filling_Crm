const fs = require('fs');
const path = require('path');
const root = process.argv[2] || process.cwd();
const nm = path.join(root, 'node_modules');
const required = ['next','react','react-dom'];
for (const name of required) {
  const pkg = name.startsWith('@') ? path.join(nm, ...name.split('/'), 'package.json') : path.join(nm, name, 'package.json');
  if (!fs.existsSync(pkg)) process.exit(2);
}
process.exit(0);
