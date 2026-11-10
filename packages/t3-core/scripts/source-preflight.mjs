import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const REQUIRED_SOURCE_PATHS = [
  'src/modules/base/features/workspace/WorkspaceView.tsx',
  'src/kernel-client/contracts/runtime-1.2.0',
  'src/profiles/definition',
  'src/shell/routing',
];
const BUILTINS = new Set(builtinModules.map((name) => name.replace(/^node:/, '')));

function fileExists(path) { return existsSync(path) && lstatSync(path).isFile(); }
function normalize(path) { return path.split(sep).join('/'); }

// This deliberately narrow lexer locates literal module references without
// executing source. It is not a TypeScript parser, typechecker or bundler.
export function literalModuleReferences(source) {
  const tokens = [];
  const re = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[A-Za-z_$][\w$]*|[^\s]/g;
  for (const match of source.matchAll(re)) {
    const value = match[0];
    if (value.startsWith('//') || value.startsWith('/*')) continue;
    tokens.push({ value, offset: match.index });
  }
  const found = [];
  const add = (token, kind) => {
    if (!token || !/^['"]/.test(token.value)) return;
    // Escaped specifiers need a real parser; never silently accept them.
    const specifier = token.value.slice(1, -1);
    found.push({ specifier, kind, escaped: specifier.includes('\\') });
  };
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i].value;
    if (tokens[i - 1]?.value === '.') continue;
    if (token === 'require' && tokens[i + 1]?.value === '(') add(tokens[i + 2], 'require');
    if (token !== 'import' && token !== 'export') continue;
    if (tokens[i + 1]?.value === '.') continue; // import.meta
    if (token === 'import' && tokens[i + 1]?.value === '(') { add(tokens[i + 2], 'dynamic-literal'); continue; }
    if (token === 'import' && /^['"]/.test(tokens[i + 1]?.value ?? '')) { add(tokens[i + 1], 'side-effect'); continue; }
    // import/export bindings may be multiline and contain braces. A statement
    // boundary or a fresh declaration stops the scan rather than crossing it.
    for (let j = i + 1; j < tokens.length && j < i + 160; j += 1) {
      const value = tokens[j].value;
      if (value === 'from') { add(tokens[j + 1], token); break; }
      if (value === ';' || ['const', 'let', 'function', 'class', 'import', 'export'].includes(value)) break;
    }
  }
  return found;
}

function inventory(root) {
  const files = [];
  const symlinks = [];
  function walk(folder) {
    if (!existsSync(folder)) return;
    if (lstatSync(folder).isSymbolicLink()) { symlinks.push(normalize(relative(root, folder))); return; }
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const path = resolve(folder, entry.name);
      if (entry.isSymbolicLink()) { symlinks.push(normalize(relative(root, path))); continue; }
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && SOURCE_EXTENSIONS.includes(extname(path))) files.push(normalize(relative(root, path)));
    }
  }
  walk(resolve(root, 'src'));
  return { files, symlinks };
}

function resolveLocal(root, file, specifier) {
  const base = resolve(dirname(resolve(root, file)), specifier);
  const rel = relative(root, base);
  if (rel === '..' || rel.startsWith(`..${sep}`)) return { outsideRoot: true };
  const candidates = [base];
  if (!SOURCE_EXTENSIONS.includes(extname(base)) && !['.json', '.css', '.svg'].includes(extname(base))) {
    candidates.push(...SOURCE_EXTENSIONS.map((ext) => base + ext));
    candidates.push(...SOURCE_EXTENSIONS.map((ext) => resolve(base, 'index' + ext)));
  } else if (/\.(?:mjs|cjs|js|jsx)$/.test(base)) {
    const noExt = base.slice(0, -extname(base).length);
    candidates.push(noExt + '.ts', noExt + '.tsx', noExt + '.mts', noExt + '.cts');
  }
  return { resolved: candidates.some(fileExists) };
}

// Deliberately bounded support for literal tsconfig paths. This is not a
// replacement for compiler resolution: inherited/complex configurations stay
// explicit diagnostics. Targets still pass the canonical-root boundary check.
function compilerAliases(root, issues) {
  const name = ['tsconfig.json', 'tsconfig.app.json'].find((path) => fileExists(resolve(root, path)));
  if (!name) return [];
  let config;
  try { config = JSON.parse(readFileSync(resolve(root, name), 'utf8')); }
  catch { issues.push({ code: 'TYPESCRIPT_CONFIG_REQUIRES_COMPILER_REVIEW', path: name }); return []; }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    issues.push({ code: 'TYPESCRIPT_CONFIG_REQUIRES_COMPILER_REVIEW', path: name });
    return [];
  }
  if (config.extends !== undefined) {
    issues.push({ code: 'TYPESCRIPT_EXTENDS_REQUIRES_COMPILER_REVIEW', path: name });
  }
  const paths = config.compilerOptions?.paths;
  if (paths === undefined) return [];
  if (!paths || typeof paths !== 'object' || Array.isArray(paths)) {
    issues.push({ code: 'TYPESCRIPT_PATHS_INVALID', path: name });
    return [];
  }
  const baseUrl = config.compilerOptions?.baseUrl ?? '.';
  if (typeof baseUrl !== 'string') {
    issues.push({ code: 'TYPESCRIPT_PATHS_INVALID', path: name });
    return [];
  }
  const aliases = [];
  for (const [pattern, targets] of Object.entries(paths)) {
    if (!pattern || pattern.split('*').length > 2 || !Array.isArray(targets) || targets.length === 0 ||
        targets.some((target) => typeof target !== 'string' || !target || target.split('*').length > 2)) {
      issues.push({ code: 'TYPESCRIPT_PATHS_INVALID', path: name, pattern });
      continue;
    }
    const star = pattern.indexOf('*');
    aliases.push({ pattern, targets, baseUrl, star, prefix: star < 0 ? pattern : pattern.slice(0, star), suffix: star < 0 ? '' : pattern.slice(star + 1) });
  }
  return aliases.sort((a, b) => Number(a.star >= 0) - Number(b.star >= 0) || b.prefix.length - a.prefix.length);
}

function resolveAlias(root, specifier, aliases) {
  const alias = aliases.find((item) => item.star < 0
    ? item.pattern === specifier
    : specifier.startsWith(item.prefix) && specifier.endsWith(item.suffix) && specifier.length >= item.prefix.length + item.suffix.length);
  if (!alias) return null;
  const matched = alias.star < 0 ? '' : specifier.slice(alias.prefix.length, specifier.length - alias.suffix.length);
  const results = alias.targets.map((target) => resolveLocal(root, 'tsconfig.json', resolve(root, alias.baseUrl, target.replace('*', matched))));
  // Even an unused fallback outside the root is an unreviewed boundary, not a
  // reason to silently accept an apparently resolvable first target.
  return { outsideRoot: results.some((result) => result.outsideRoot), resolved: results.some((result) => result.resolved) };
}

function packageName(specifier) {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
  return specifier.split('/')[0];
}

export function inspectCanonicalSource(rootPath) {
  const root = resolve(rootPath);
  const issues = [];
  let pkg = {};
  try { pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')); }
  catch { issues.push({ code: 'PACKAGE_MANIFEST_MISSING_OR_INVALID', path: 'package.json' }); }
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
    issues.push({ code: 'PACKAGE_MANIFEST_INVALID_SHAPE', path: 'package.json' });
    pkg = {};
  }
  for (const command of ['build', 'typecheck', 'lint']) {
    if (typeof pkg.scripts?.[command] !== 'string' || !pkg.scripts[command].trim()) issues.push({ code: 'BUILD_SCRIPT_MISSING', command });
  }
  if (!['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock'].some((name) => fileExists(resolve(root, name)))) {
    issues.push({ code: 'DEPENDENCY_LOCK_MISSING' });
  }
  if (!['tsconfig.json', 'tsconfig.app.json'].some((name) => fileExists(resolve(root, name)))) issues.push({ code: 'TYPESCRIPT_CONFIG_MISSING' });
  for (const path of REQUIRED_SOURCE_PATHS) {
    if (!resolveLocal(root, 'package.json', './' + path).resolved) issues.push({ code: 'REQUIRED_WORKSPACE_SOURCE_MISSING', path });
  }
  const aliases = compilerAliases(root, issues);
  const { files, symlinks } = inventory(root);
  if (!files.length) issues.push({ code: 'SOURCE_TREE_EMPTY' });
  for (const path of symlinks) issues.push({ code: 'SOURCE_SYMLINK_REQUIRES_REVIEW', path });
  const declared = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})]);
  const digest = createHash('sha256');
  let references = 0;
  for (const file of files) {
    const bytes = readFileSync(resolve(root, file));
    digest.update(file).update('\0').update(bytes).update('\0');
    for (const ref of literalModuleReferences(bytes.toString('utf8'))) {
      references += 1;
      const detail = { file, specifier: ref.specifier };
      if (ref.escaped) { issues.push({ code: 'ESCAPED_MODULE_REFERENCE_REQUIRES_REVIEW', ...detail }); continue; }
      if (ref.specifier.startsWith('.')) {
        const result = resolveLocal(root, file, ref.specifier);
        if (result.outsideRoot) issues.push({ code: 'MODULE_REFERENCE_OUTSIDE_CANONICAL_ROOT', ...detail });
        else if (!result.resolved) issues.push({ code: 'LOCAL_MODULE_MISSING', ...detail });
      } else if (!BUILTINS.has(ref.specifier.replace(/^node:/, ''))) {
        const alias = resolveAlias(root, ref.specifier, aliases);
        if (alias?.outsideRoot) issues.push({ code: 'MODULE_REFERENCE_OUTSIDE_CANONICAL_ROOT', ...detail });
        else if (alias && !alias.resolved) issues.push({ code: 'ALIAS_MODULE_MISSING', ...detail });
        else if (!alias) {
          const name = packageName(ref.specifier);
          if (!declared.has(name)) issues.push({ code: 'PACKAGE_OR_ALIAS_UNDECLARED', package: name, ...detail });
        }
      }
    }
  }
  return {
    schema: 'IWXA_T2_SOURCE_PREFLIGHT_V1',
    scope: 'STATIC_LITERAL_IMPORT_AND_BUILD_INPUT_DIAGNOSTIC',
    sourceFileCount: files.length,
    literalReferenceCount: references,
    sourceDigest: digest.digest('hex'),
    issues,
    issueCount: issues.length,
    status: issues.length ? 'BLOCKED_SOURCE_INCOMPLETE' : 'NO_STATIC_BLOCKERS_FOUND_BUILD_VALIDATION_REQUIRED',
    releaseReady: false,
    limitations: [
      'This is not a parser/compiler, dependency installation, build, browser test or release acceptance.',
      'Computed imports, template interpolation imports, regex literals, aliases and package exports require compiler/bundler validation.',
      'File presence does not establish donor provenance, accepted authority, compatible exports or runtime wiring.',
      'Required Workspace paths come from the retained G4-S1 integration shape; change that shape only with reviewed architecture evidence.',
    ],
  };
}

export function runSourcePreflight(args = [], root = fileURLToPath(new URL('../', import.meta.url))) {
  if (args.some((arg) => arg !== '--report')) throw new Error('usage: node scripts/source-preflight.mjs [--report]');
  const report = inspectCanonicalSource(root);
  return { report, exitCode: !args.includes('--report') && report.issueCount > 0 ? 2 : 0 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { report, exitCode } = runSourcePreflight(process.argv.slice(2));
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = exitCode;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
