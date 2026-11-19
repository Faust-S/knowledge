"""Convert only genuine native GUI screenshots into reproducible site assets."""
from pathlib import Path
from PIL import Image
from hashlib import sha256
import json,os,base64
root=Path(os.environ['RUNNER_TEMP'])
items=[
("atlas","atlas-01-portfolio.webp",root/"atlas"/"atlas06-connect-visual-atlas09-native-store-cold-open-2.png",(8,0,1016,701),"Портфель и восстановление локального проекта"),
("atlas","atlas-02-works.webp",root/"atlas"/"atlas06-connect-visual-atlas08-two-work-corrections-not-saved-820.png",(8,0,812,642),"Таблица работ и несохранённые изменения"),
("atlas","atlas-03-impact.webp",root/"atlas"/"atlas06-connect-visual-atlas08-cumulative-work-forecast-820.png",(8,0,812,642),"Прогноз влияния изменения длительности"),
("admin","admin-01-atlas-work.webp",root/"admin"/"admin-01-atlas-work.png",None,"Связанный проект Atlas и рабочие объекты"),
("admin","admin-02-assignment-editor.webp",root/"admin"/"admin-02-assignment-editor.png",None,"Редактирование поручения с критериями"),
("admin","admin-03-roles-seats.webp",root/"admin"/"admin-03-roles-seats.png",None,"Сотрудники, роли и планирование агентских мест"),
]
out=Path("qa-software-gallery");out.mkdir(exist_ok=True)
records=[]
for product,name,path,box,subject in items:
 assert path.is_file() and path.stat().st_size>10000,"Native capture missing: "+name
 original=path.read_bytes()
 with Image.open(path) as raw:
  assert raw.width>=700 and raw.height>=550,"Image geometry not native"
  img=raw.convert("RGB")
  if box:
   assert box[2]<=img.width and box[3]<=img.height
   img=img.crop(box)
  target=out/name
  img.save(target,format="WEBP",quality=82,method=6)
  data=target.read_bytes()
  assert len(data)>15000 and img.width>=700 and img.height>=550
  (out/(name+".b64.txt")).write_text(base64.b64encode(data).decode('ascii')+'\n',encoding='ascii')
  records.append(dict(product=product,name=name,subject=subject,
   sourceFile=path.name,sourceSha256=sha256(original).hexdigest(),
   assetSha256=sha256(data).hexdigest(),width=img.width,height=img.height,
   run=44612742339 if product=="atlas" else int(os.environ['GITHUB_RUN_ID']),
   productSha='19ea3d228c585a1c50e749632c2f2df1a71c7c33' if product=="atlas" else '2628c4bc1b20b4393c485d12513f029fdea8b082'))
(out/'manifest.json').write_text(json.dumps(dict(schema="IWXA_REAL_EDITORIAL_SCREENSHOTS/1",records=records,
  operations="Crop real native window bounds; encode as WebP. No simulated program UI."),
  ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print("IWXA_EDITORIAL_GALLERY_SIX_REAL_SCREENS_VERIFIED",len(records))
