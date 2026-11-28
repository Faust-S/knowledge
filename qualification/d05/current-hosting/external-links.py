import concurrent.futures
import hashlib
import html.parser
import ipaddress
import json
import pathlib
import socket
import sys
import urllib.error
import urllib.parse
import urllib.request

root=pathlib.Path(sys.argv[1])
urls=set()

class Anchors(html.parser.HTMLParser):
    def handle_starttag(self, tag, attrs):
        if tag != "a":
            return
        href=dict(attrs).get("href") or ""
        if href.startswith(("https://","http://","//")):
            u=urllib.parse.urlsplit("https:"+href if href.startswith("//") else href)
            if u.hostname and u.hostname.lower() not in {"cehovod.ru","www.cehovod.ru"}:
                urls.add(urllib.parse.urlunsplit((u.scheme,u.netloc,u.path,u.query,"")))

for p in root.rglob("*.html"):
    Anchors().feed(p.read_text(encoding="utf-8"))

def safe(url):
    u=urllib.parse.urlsplit(url)
    if u.scheme not in ("http","https") or not u.hostname or u.username or u.password or u.port not in (None,80,443):
        return False
    if u.hostname.lower() in ("localhost","localhost.localdomain"):
        return False
    addresses=socket.getaddrinfo(u.hostname,u.port or (443 if u.scheme=="https" else 80))
    return bool(addresses) and all(ipaddress.ip_address(r[4][0]).is_global for r in addresses)

class Redirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not safe(newurl):
            raise ValueError("redirect not public")
        return super().redirect_request(req,fp,code,msg,headers,newurl)

def probe(url):
    try:
        if not safe(url):
            return {"url":url,"status":"NOT_PUBLIC"}
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),Redirect())
        for method in ("GET",):
            try:
                with opener.open(urllib.request.Request(url,method=method,headers={"User-Agent":"CehoVod-Link-Qualification/1"}),timeout=12) as r:
                    if method=="GET":
                        r.read(1024)
                    return {"url":url,"http":r.status,"status":"PASS"}
            except urllib.error.HTTPError as e:
                if method=="HEAD":
                    continue
                return {"url":url,"http":e.code,"status":"BROKEN" if e.code in (404,410) else "UNCONFIRMED"}
    except (OSError,ValueError,urllib.error.URLError):
        return {"url":url,"status":"UNCONFIRMED"}
    return {"url":url,"status":"UNCONFIRMED"}

assert len(urls)<=1000
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    rows=list(pool.map(probe,sorted(urls)))
counts={k:sum(r["status"]==k for r in rows) for k in ("PASS","BROKEN","UNCONFIRMED","NOT_PUBLIC")}
pathlib.Path(sys.argv[2]).write_text(json.dumps({"count":len(rows),"counts":counts,"links":rows},ensure_ascii=False,indent=2),encoding="utf-8")
for index,row in enumerate(rows):
    print("D05_EXTERNAL_LINK_RESULT "+json.dumps({"index":index,"sha256":hashlib.sha256(row["url"].encode("utf-8")).hexdigest(),"http":row.get("http"),"status":row["status"]},sort_keys=True))
print("D05_EXTERNAL_PUBLIC_LINKS "+json.dumps(counts,sort_keys=True))
# Confirmed missing public destinations and accidental non-public addresses block delivery.
assert len(rows)>0 and counts["PASS"]==len(rows),"D05_EXTERNAL_LINKS_REQUIRE_CORRECTION"
