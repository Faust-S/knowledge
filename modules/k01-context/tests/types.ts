import { selectContext, type ContextRequest, type KnowledgeItem, type MemoryPort } from '../index.js';
import { createDocumentObservationPort } from '../adapters/document-source.mjs';
import { createLocalFileObservationPort } from '../adapters/local-file.mjs';
const item: KnowledgeItem = { id: 'a', type: 'delivery', sourceRef: 'doc:a', revision: 'sha256:abc', epistemic: 'observed', estimatedTokens: 5 };
const request: ContextRequest = { taskId: 'task:a', terms: ['delivery'], allowedSources: ['doc:a'], maxTokens: 10 };
const port = createDocumentObservationPort({ sourceRef: 'doc:a', pinnedItems: [{ ...item, linePrefix: 'Delivery:' }], readSnapshot: async () => 'Delivery: ready' });
void selectContext(request, port);
void createLocalFileObservationPort({ filePath: '/tmp/a', sourceRef: 'doc:a', pinnedItems: [{ ...item, linePrefix: 'Delivery:' }] });
function suppliedByHost(memory: MemoryPort): void { void memory.read('a'); }
void suppliedByHost;
