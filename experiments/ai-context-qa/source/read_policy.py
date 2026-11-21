"""Default current reading; legacy sources require explicit opt-in."""
import json
import re
from pathlib import Path

def policy(root):
    value=json.loads((Path(root)/'knowledge/system/SOURCE_READ_POLICY.json').read_text(encoding="utf-8"))
    if value['schema']!='IWXA_SOURCE_READ_POLICY/1' or value['default']!='CURRENT_ONLY':
        raise ValueError('Explicit current-only source policy required')
    return value

def archived(row, rules):
    # An owning product may store its current qualified release in archive/.
    # Directory quarantine here applies to local IWXA documents, not that release.
    paths=[row.get('path') or '']
    if row.get('locator',{}).get('repository')=='Faust-S/iwxa':
        paths.append(row['locator'].get('path') or '')
    return (row.get('default_read_status') == 'HISTORICAL_ONLY' or
            row['id'] in rules['archived_source_ids'] or
            row.get('scope') in rules['archived_scopes'] or
            row.get('authority_role') in rules['archived_roles'] or
            any(p.startswith(prefix) for p in paths for prefix in rules['archived_path_prefixes']) or
            any(p in rules['archived_paths'] for p in paths) or
            any(re.search(pattern,row.get('title',''),re.IGNORECASE) for pattern in rules['archived_title_patterns']))

def select(rows, rules, include_archived=False):
    return list(rows) if include_archived else [r for r in rows if not archived(r,rules)]
