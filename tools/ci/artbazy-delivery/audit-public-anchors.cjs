// Diagnostic only: inspect anchor-producing expressions in the exact site tree.
// No source text or user data is emitted and no build is performed.
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');

function audit(ts, root) {
  const xml = fs.readFileSync(path.join(root, 'public/sitemap.xml'), 'utf8');
  const routes = new Set([...xml.matchAll(/<loc>https:\/\/artbazy\.ru(\/(?:[a-z0-9-]+\/)*)<\/loc>/g)].map(m => m[1]));
  if (!routes.has('/') || routes.size < 1) throw Error('SITEMAP_NOT_FOUND');
  routes.add('/poisk/');
  const nav = /^\/(?:tools|diagnostiki|slovar|situacii|napravleniya|primery-otchetov)(?:\/|$)/;
  const findings = [];
  let files = 0;
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && /\.[cm]?tsx?$/.test(entry.name) && !/\.gen\.ts$/.test(entry.name)) inspect(file);
    }
  }
  function inspect(file) {
    files++;
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const rel = path.relative(root, file).split(path.sep).join('/');
    function emit(node, kind) {
      findings.push({file:rel,line:source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,kind});
    }
    function value(node, kind) {
      if (!node) return;
      if (ts.isJsxExpression(node)) return value(node.expression, kind);
      if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) return value(node.expression, kind);
      if (ts.isConditionalExpression(node)) {value(node.whenTrue,kind);value(node.whenFalse,kind);return;}
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        const p = node.text.split(/[?#]/,1)[0];
        if (p.startsWith('/') && !p.startsWith('//') && p !== '/' && !p.endsWith('/') && routes.has(p+'/')) emit(node, kind+'_KNOWN_NO_SLASH');
        return;
      }
      if (ts.isTemplateExpression(node)) {
        const first = node.head.text, last = node.templateSpans.at(-1).literal.text;
        if (nav.test(first) && !last.endsWith('/') && !/[?#]/.test(last) && !last.includes('.')) emit(node, kind+'_DYNAMIC_NO_SLASH');
      }
    }
    function visit(node) {
      if (ts.isJsxAttribute(node)) {
        const name = node.name.getText(source);
        if (name==='href'||name==='to') value(node.initializer,'JSX_'+name.toUpperCase());
      } else if (ts.isPropertyAssignment(node)) {
        const name = ts.isIdentifier(node.name)||ts.isStringLiteral(node.name) ? node.name.text : '';
        if (['href','to','url','route'].includes(name)) value(node.initializer,'DATA_'+name.toUpperCase());
      }
      ts.forEachChild(node,visit);
    }
    visit(source);
  }
  walk(path.join(root,'src'));
  for (const name of ['artbazy-module','artbazy-public']) {
    const dir=path.join(root,'runtime',name);
    if (fs.existsSync(dir)) walk(dir);
  }
  findings.sort((a,b)=>a.kind.localeCompare(b.kind)||a.file.localeCompare(b.file)||a.line-b.line);
  return {routes:routes.size,files,findings};
}
module.exports={audit};
if(require.main===module){
  const root=path.resolve(process.argv[2]);
  const ts=createRequire(path.join(root,'package.json'))('typescript');
  const result=audit(ts,root);
  console.log('SOURCE_ANCHOR_ROUTES='+result.routes+' FILES='+result.files);
  const counts={};
  for(const x of result.findings) counts[x.kind]=(counts[x.kind]||0)+1;
  for(const [kind,count] of Object.entries(counts)) console.log('SOURCE_ANCHOR_KIND='+kind+' COUNT='+count);
  const groups=new Map();
  for(const x of result.findings) {
    const key=x.kind+' '+x.file;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(x.line);
  }
  // Print every file/count, highest concentrations first, then exact JSX locations.
  for(const [key,lines] of [...groups].sort((a,b)=>b[1].length-a[1].length||a[0].localeCompare(b[0]))) {
    console.log('SOURCE_ANCHOR_GROUP='+key+' COUNT='+lines.length+' LINES='+lines.slice(0,12).join(','));
  }
  for(const x of result.findings.filter(x=>x.kind.startsWith('JSX_'))) console.log('SOURCE_ANCHOR_DIRECT='+x.file+':'+x.line+' KIND='+x.kind);
  console.log('SOURCE_ANCHOR_TOTAL='+result.findings.length+' GROUPS='+groups.size);
}
