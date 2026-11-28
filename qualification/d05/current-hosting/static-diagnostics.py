import re
import sys
import json
from pathlib import Path
gate=sys.argv[1]
log=Path(sys.argv[2]).read_text(encoding="utf-8",errors="replace")
kinds={
    "TIMEOUT":r"TimeoutError|timeout|timed out",
    "HORIZONTAL_OVERFLOW":r"horizontal overflow|header overflows",
    "FOCUS":r"focus escaped|focus did not return",
    "WRONG_PAGE":r"expected.*(?:H1|title)|HTML выглядит как 404",
    "MENU":r"Materials desktop links differ|menu did not close|trigger button not found",
    "GLOSSARY":r"glossary does not contain|glossary-search",
    "ARTICLES":r"articles page does not contain|article contents",
    "HTTP":r"HTTP [45][0-9][0-9]|net::ERR_",
    "NOT_FOUND":r"не существ|несуществующ|not found",
    "HYDRATION":r"hydration mismatch|React root не смонтировался",
    "PAGE_ERROR":r"pageerror|uncaught exception|console.error",
    "TRAILING_SLASH":r"trailing slash",
    "EXTERNAL_ASSET":r"Внешние URL к ассетам|Lovable Cloud",
}
counts={k:len(re.findall(p,log,flags=re.I)) for k,p in kinds.items()}
routes=[]
for path in re.findall(r"(?m)^\s*(?:FAIL|-)\s+(/[a-z0-9/-]{0,150}/?)(?=[:\s])",log):
    if path not in routes:routes.append(path)
print("D05_STATIC_DIAG "+json.dumps({"gate":gate,"classifications":{k:v for k,v in counts.items() if v},"routes":routes[:50]},ensure_ascii=True))
