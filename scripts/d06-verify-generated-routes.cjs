// Compare the complete executable contract of the generated flat route tree.
// The generator may reorder declarations. It may not add executable logic,
// change a route, add a dynamic/ambiguous path or bind a different route file.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const root = resolve(process.argv[2] || '.');
const ts = createRequire(resolve(root, 'package.json'))('typescript');
const routeFile = 'src/routeTree.gen.ts';
const check = (value, code) => assert.ok(value, 'D06_ROUTE_TREE_' + code);
const ident = n => { check(n && ts.isIdentifier(n), 'IDENTIFIER'); return n.text; };
const string = n => { check(n && ts.isStringLiteral(n), 'STRING'); return n.text; };
const order = entries => [...entries].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0);
function props(node) {
  check(ts.isObjectLiteralExpression(node), 'OBJECT');
  const result = new Map();
  for (const p of node.properties) {
    check(ts.isPropertyAssignment(p) && !p.modifiers?.length, 'PROPERTY');
    const key = ts.isIdentifier(p.name) ? p.name.text : string(p.name);
    check(!result.has(key), 'DUPLICATE_PROPERTY');
    result.set(key,p.initializer);
  }
  return result;
}
function call(node, method, count) {
  check(node && ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression), 'CALL');
  check(node.expression.name.text === method && node.arguments.length === count && !node.questionDotToken && !node.expression.questionDotToken, 'CALL_SHAPE');
  return node;
}
function contract(source) {
  const out = ts.transpileModule(source,{fileName:routeFile,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext,removeComments:true}});
  check(!out.diagnostics?.some(d=>d.category===ts.DiagnosticCategory.Error),'TS_SYNTAX');
  const sf=ts.createSourceFile('route.js',out.outputText,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  check(sf.parseDiagnostics.length===0,'JS_SYNTAX');
  const imports=new Map(), updates=new Map(), paths=new Set();
  let children, tree;
  for(const stmt of sf.statements) {
    if(ts.isImportDeclaration(stmt)) {
      const binding=stmt.importClause?.namedBindings;
      check(stmt.importClause && !stmt.importClause.name && binding && ts.isNamedImports(binding) && binding.elements.length===1 && !stmt.attributes,'IMPORT');
      const item=binding.elements[0], alias=ident(item.name), module=string(stmt.moduleSpecifier);
      check(ident(item.propertyName)==='Route' && /^\.\/routes\/[A-Za-z0-9_.-]+$/.test(module) && !imports.has(alias),'ROUTE_IMPORT');
      imports.set(alias,module); continue;
    }
    check(ts.isVariableStatement(stmt) && (stmt.declarationList.flags & ts.NodeFlags.Const)!==0 && stmt.declarationList.declarations.length===1,'STATEMENT');
    const d=stmt.declarationList.declarations[0], name=ident(d.name), value=d.initializer;
    check(value && !d.exclamationToken,'INITIALIZER');
    if(name==='routeTree') {
      check(!tree && children && stmt.modifiers?.length===1 && stmt.modifiers[0].kind===ts.SyntaxKind.ExportKeyword,'TREE_EXPORT');
      const typed=call(value,'_addFileTypes',0);
      const added=call(typed.expression.expression,'_addFileChildren',1);
      check(ident(added.expression.expression)==='rootRouteImport' && ident(added.arguments[0])==='rootRouteChildren','TREE');
      tree=true; continue;
    }
    check(!stmt.modifiers?.length,'UNEXPECTED_EXPORT');
    if(name==='rootRouteChildren') {
      check(!children && updates.size===47,'CHILDREN_ORDER');
      children=new Map([...props(value)].map(([key,v])=>[key,ident(v)]));
      continue;
    }
    check(!children && !tree,'UPDATE_ORDER');
    const update=call(value,'update',1), alias=ident(update.expression.expression), p=props(update.arguments[0]);
    check(p.size===3 && p.has('id') && p.has('path') && p.has('getParentRoute'),'UPDATE_FIELDS');
    const id=string(p.get('id')), path=string(p.get('path')), parent=p.get('getParentRoute');
    check(ts.isArrowFunction(parent) && parent.parameters.length===0 && !parent.modifiers?.length && ident(parent.body)==='rootRouteImport','PARENT');
    check(id===path && /^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*\/?)?$/.test(path),'STATIC_ROUTE');
    const normalized=path==='/'?'/':path.replace(/\/$/,'');
    check(!paths.has(normalized)&&!updates.has(name),'DUPLICATE_ROUTE');
    paths.add(normalized); updates.set(name,[alias,id,path]);
  }
  check(tree && children && imports.get('rootRouteImport')==='./routes/__root','ROOT');
  check(imports.size===48 && updates.size===47 && children.size===47,'ROUTE_COUNT');
  const used=new Set();
  for(const [name,[alias]] of updates) {
    check(alias!=='rootRouteImport' && imports.has(alias) && !used.has(alias) && children.get(name)===name,'ROUTE_BINDING');
    used.add(alias);
  }
  check(new Set(imports.values()).size===imports.size,'DUPLICATE_IMPORT');
  return { imports:order(imports),updates:order(updates),children:order(children) };
}
try {
  const before=execFileSync('git',['show','HEAD:'+routeFile],{cwd:root,encoding:'utf8'});
  const after=readFileSync(resolve(root,routeFile),'utf8');
  assert.deepEqual(contract(after),contract(before),'D06_ROUTE_TREE_CONTRACT_CHANGED');
  console.log('D06_GENERATED_ROUTE_CONTRACT=PASS');
  console.log('D06_GENERATED_ROUTE_COUNT=47');
} catch(error) {
  const code=String(error?.message || '').split('\n')[0];
  console.error(/^D06_ROUTE_TREE_[A-Z_]+$/.test(code)?code:'D06_ROUTE_TREE_CONTRACT_CHANGED');
  process.exitCode=1;
}
