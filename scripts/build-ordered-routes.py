"""Build open transit traces from the user's authoritative, ordered street list.
Real OSM shared nodes join intersections. No poster interpolation or implicit
return-to-start. Unnamed continuations and short junction links are audited.
"""
import json,gzip,math,heapq,unicodedata
from pathlib import Path
from itertools import count
root=Path(__file__).resolve().parents[1]
inputs=json.loads((root/'scripts/ordered-route-input.json').read_text())
ways=json.loads(gzip.decompress((root/'source-data/roads.osm.json.gz').read_bytes()))['elements']
def norm(s):
 s=''.join(c for c in unicodedata.normalize('NFD',s.casefold()) if unicodedata.category(c)!='Mn')
 for prefix in ['avenida ','av. ','av ','calle ','c. ']:
  if s.startswith(prefix):s=s[len(prefix):];break
 return s.strip()
def metric(a,b):return math.hypot((a[0]-b[0])*111000,(a[1]-b[1])*105000)
nodes={};graph={};edges={};road_by_id={}
for way in ways:
 t=way['tags']
 if t.get('highway') in ['path','footway','steps','pedestrian','cycleway','track','construction','proposed'] or t.get('access') in ['private','no']:continue
 ids=way['nodes'];pts=way['geometry'];road_by_id[way['id']]=way
 for n,p in zip(ids,pts):nodes[n]=[p['lat'],p['lon']];graph.setdefault(n,{})
 for a,b in zip(ids,ids[1:]):
  if a==b:continue
  d=metric(nodes[a],nodes[b])
  if not d:continue
  key=frozenset((a,b));edge={'distance':d,'name':t.get('name',''),'way':way['id'],'aliases':{norm(v) for k,v in t.items() if 'name' in k}}
  if key not in edges:edges[key]=edge;graph[a][b]=edge;graph[b][a]=edge
# Explicit reference correction: never replace an unmapped segment with a
# long detour over streets excluded by the user's ordered route.
manual=json.loads((root/'source-data/manual-corrections.json').read_text())
for label,correction in manual.items():
 chain=[]
 for index,point in enumerate(correction['path']):
  nearest=min(nodes,key=lambda n:metric(nodes[n],point))
  if metric(nodes[nearest],point)<1:node=nearest
  else:node=f'{label}-{index}';nodes[node]=point;graph[node]={}
  chain.append(node)
 for a,b in zip(chain,chain[1:]):
  key=frozenset((a,b));edge={'distance':metric(nodes[a],nodes[b]),'name':correction['name'],'way':label,'aliases':{norm(correction['name'])},'approximate':True}
  edges[key]=edge;graph[a][b]=edge;graph[b][a]=edge
# Largest road-connected component avoids dead/private fragments.
unseen=set(graph);largest=set()
while unseen:
 n=unseen.pop();component={n};stack=[n]
 while stack:
  for b in graph[stack.pop()]:
   if b in unseen:unseen.remove(b);component.add(b);stack.append(b)
 if len(component)>len(largest):largest=component
allowed_nodes=largest

def shortest(starts,goals,preferred,approved,hint=None):
 goals=set(goals);queue=[];serial=count();cost={};parent={}
 for a in starts:
  if a not in allowed_nodes:continue
  c=metric(nodes[a],hint)*.15 if hint else 0
  cost[a]=c;heapq.heappush(queue,(c,next(serial),a))
 while queue:
  c,_,a=heapq.heappop(queue)
  if c!=cost[a]:continue
  if a in goals:
   path=[a]
   while path[-1] in parent:path.append(parent[path[-1]])
   return path[::-1]
  for b,e in graph[a].items():
   if b not in allowed_nodes:continue
   key=frozenset((a,b))
   multiplier=1 if key in preferred else 3 if key in approved else 3 if not e['name'] else 20
   candidate=c+e['distance']*multiplier
   if candidate<cost.get(b,float('inf')):
    cost[b]=candidate;parent[b]=a;heapq.heappush(queue,(candidate,next(serial),b))
 raise ValueError('No public-road connection')

def stage_set(step):
 names={norm(n) for n in step.get('match',[])};anchor=step['anchor'];radius=step['radius'];found=set()
 for key,e in edges.items():
  a,b=tuple(key)
  if a not in allowed_nodes or b not in allowed_nodes:continue
  alias_match=bool(e['aliases']&names)
  box=step.get('continuationBox');p=nodes[a];q=nodes[b]
  continuation=box and not e['name'] and box[0]<=p[0]<=box[2] and box[1]<=p[1]<=box[3] and box[0]<=q[0]<=box[2] and box[1]<=q[1]<=box[3]
  if (alias_match and min(metric(p,anchor),metric(q,anchor))<=radius) or continuation:found.add(key)
 members={n for key in found for n in key}
 if 'point' in step:
  candidates=members or allowed_nodes
  n=min(candidates,key=lambda n:metric(nodes[n],step['point']))
  return {'nodes':{n},'edges':found,'point':n}
 assert members,step['name']
 return {'nodes':members,'edges':found}

geo={};metadata={};reports={}
for rid,route in inputs.items():
 stages=[stage_set(s) for s in route['steps']];approved=set().union(*(s['edges'] for s in stages));bridges=[]
 for i,(a,b) in enumerate(zip(stages,stages[1:])):
  hint=route.get('junctionHints',{}).get(str(i)) or [(route['steps'][i]['anchor'][j]+route['steps'][i+1]['anchor'][j])/2 for j in range(2)]
  if 'point' in a:bridge=[a['point']]
  elif 'point' in b:bridge=[b['point']]
  elif shared:=a['nodes']&b['nodes']:bridge=[min(shared,key=lambda n:metric(nodes[n],hint))]
  else:bridge=shortest(a['nodes'],b['nodes'],a['edges']|b['edges'],approved,hint)
  bridges.append(bridge)
 start=min(stages[0]['nodes'],key=lambda n:metric(nodes[n],route['start']))
 final=min(stages[-1]['nodes'],key=lambda n:metric(nodes[n],route['end']))
 path_nodes=[start];marker_indices=[];spans=[];extra={};junction_notes=[]
 for i,stage in enumerate(stages):
  target=bridges[i][0] if i<len(bridges) else final
  leg=shortest([path_nodes[-1]],[target],stage['edges'],approved)
  begin=len(path_nodes)-1;path_nodes.extend(leg[1:]);end=len(path_nodes)-1
  marker_indices.append(begin if i==0 else end if i==len(stages)-1 else begin+(end-begin)//2)
  spans.append({'step':i,'startIndex':begin,'endIndex':end,'name':route['steps'][i]['name']})
  if i<len(bridges):
   bridge=bridges[i]
   if bridge[0]!=path_nodes[-1]:raise ValueError('Unjoined gate')
   path_nodes.extend(bridge[1:])
   if len(bridge)>1:junction_notes.append({'after':route['steps'][i]['name'],'before':route['steps'][i+1]['name'],'meters':round(sum(graph[a][b]['distance'] for a,b in zip(bridge,bridge[1:]))),'via':list(dict.fromkeys(graph[a][b]['name'] or 'Conector sin nombre en OSM' for a,b in zip(bridge,bridge[1:])))})
  for a,b in zip(leg,leg[1:]):
   e=graph[a][b]
   if frozenset((a,b)) not in approved and e['name']:extra[e['name']]=extra.get(e['name'],0)+e['distance']
 path=[nodes[n] for n in path_nodes]
 assert path[0]!=path[-1],route['name']
 assert all(a<=b for a,b in zip(marker_indices,marker_indices[1:]))
 geo[rid]={'ida':{'path':path,'stopIndices':marker_indices,'stages':spans},'vuelta':{'path':path[::-1],'stopIndices':[len(path)-1-i for i in marker_indices[::-1]]}}
 xs=[p[1]*math.cos(math.radians(18.65)) for p in path];ys=[-p[0] for p in path];scale=min(760/(max(xs)-min(xs)),510/(max(ys)-min(ys)))
 screen=lambda i:[round(120+(xs[i]-min(xs))*scale,2),round(120+(ys[i]-min(ys))*scale,2)]
 metadata[rid]={k:route[k] for k in ['name','shortName','color','soft','origin','destination','image','minutes']}
 metadata[rid].update({'id':rid,'subtitle':route['origin']+' → '+route['destination'],'buses':[.1,.31,.68] if rid!='2' else [.15,.63],'points':[screen(i) for i in marker_indices],'pointNames':[s['name'] for s in route['steps']],'pointKinds':[s.get('kind','tramo') for s in route['steps']],'approximatePoints':[i for i,s in enumerate(route['steps']) if s.get('approximate')],'streets':[s['name'] for s in route['steps']],'diagramPath':[screen(i) for i in range(len(path))],'closed':False,'dataVersion':'ordered-20261015','approximateSegments':[[nodes[a],nodes[b]] for a,b in zip(path_nodes,path_nodes[1:]) if graph[a][b].get('approximate')]})
 reports[rid]={'name':route['name'],'sequence':[s['name'] for s in route['steps']],'start':path[0],'final':path[-1],'closed':False,'lengthMeters':round(sum(metric(a,b) for a,b in zip(path,path[1:]))),'vertices':len(path),'junctionConnections':junction_notes,'additionalNamedRoadMeters':{k:round(v) for k,v in extra.items()},'source':'User-specified order, 2026-10-15; OSM names and alt_name; approximate locations for marked landmarks.'}
 print(route['name'],reports[rid]['lengthMeters'],'m',len(path),'vertices','additional:',reports[rid]['additionalNamedRoadMeters'],flush=True)
 for x in junction_notes:print('  connector:',x,flush=True)
(root/'web/routes-geo.mjs').write_text('// Open traces in the exact user-specified street order; geometry © OpenStreetMap contributors.\nexport const GEO_ROUTES = '+json.dumps(geo,ensure_ascii=False,separators=(',',':'))+';\n')
(root/'web/route-metadata.mjs').write_text('// Authoritative order supplied by the user, 2026-10-15.\nexport const ROUTE_METADATA = '+json.dumps(metadata,ensure_ascii=False,separators=(',',':'))+';\n')
(root/'scripts/ordered-route-report.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2)+'\n')
