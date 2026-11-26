// Conservative candidate comparison, NOT a semantic equivalence engine.
// All original wordings are retained by callers. Only an explicit review
// may adopt a shared wording when source texts differ. Do not stem arbitrary
// nouns, reorder tokens, strip negation, qualifiers, numbers or units.
const actions=[
 ['проверить','проверьте'],
 ['уточнить','уточните'],
 ['сохранить','сохраните'],
 ['настроить','настройте'],
 ['отрегулировать','отрегулируйте'],
 ['повторить','повторите'],
 ['измерить','измерьте'],
 ['разделить','разделите'],
 ['отделить','отделите'],
 ['указать','укажите'],
 ['зафиксировать','зафиксируйте'],
 ['сопоставить','сопоставьте'],
 ['выделить','выделите'],
 ['учесть','учтите'],
 ['check','verify'],
];
const aliases=new Map(actions.flatMap(([base,...forms])=>[base,...forms].map(word=>[word,base])));
export function practicalWordingKey(value){
 if(typeof value!=='string')throw new TypeError('PRACTICAL_WORDING_TEXT');
 // Keep internal whitespace and punctuation, case of unknown terms, and
 // the exact numbers/operators. A final period after a letter is ordinary
 // sentence punctuation; a period after a number is not normalized.
 const source=value.normalize('NFC').trim().replace(/(\p{L})\.$/u,'$1');
 return source.replace(/[\p{L}\p{M}\p{N}_]+/gu,word=>aliases.get(word.toLocaleLowerCase('ru-RU'))??word);
}
