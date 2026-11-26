const NS='http://www.w3.org/2000/svg';
function svg(tag,attrs={},className){
  const node=document.createElementNS(NS,tag);
  for(const [name,value]of Object.entries(attrs))node.setAttribute(name,String(value));
  if(className)node.classList.add(className);return node;
}
const coordinate=position=>JSON.stringify(position);
const HIT_SIZE=32;
const BOX_PADDING=1;
const BOX_HEIGHT=HIT_SIZE+2*BOX_PADDING;
const ANCHOR_GAP=8;
const EDGE_MARGIN=4;
const ROUTE_MARGIN=4;

function coveredLength(segment, left, top, right, bottom){
  if(segment.right<left||segment.left>right||segment.bottom<top||segment.top>bottom)return 0;
  let enter=0,exit=1;
  if(segment.dx){
    const first=(left-segment.x)/segment.dx,last=(right-segment.x)/segment.dx;
    enter=Math.max(enter,Math.min(first,last));exit=Math.min(exit,Math.max(first,last));
  }
  if(segment.dy){
    const first=(top-segment.y)/segment.dy,last=(bottom-segment.y)/segment.dy;
    enter=Math.max(enter,Math.min(first,last));exit=Math.min(exit,Math.max(first,last));
  }
  return Math.max(0,exit-enter)*segment.length;
}

function placeCallout(ticket,width,frame,matrix,routes){
  const point=matrix?new DOMPoint(ticket.x,ticket.y).matrixTransform(matrix):null;
  const unitsPerPixel=matrix?1/(Math.hypot(matrix.a,matrix.b)||1):1;
  const reachX=(width+ANCHOR_GAP+ROUTE_MARGIN)*unitsPerPixel;
  const reachY=(BOX_HEIGHT+ANCHOR_GAP+ROUTE_MARGIN)*unitsPerPixel;
  const nearby=routes.filter(route=>route.right>=ticket.x-reachX&&route.left<=ticket.x+reachX
    &&route.bottom>=ticket.y-reachY&&route.top<=ticket.y+reachY);
  const left=-width-ANCHOR_GAP,right=ANCHOR_GAP,above=-BOX_HEIGHT-ANCHOR_GAP,below=ANCHOR_GAP;
  const candidates=[
    [left,-BOX_HEIGHT/2,'left'],[right,-BOX_HEIGHT/2,'right'],
    [-width/2,above,'above'],[-width/2,below,'below'],
    [left,above,'above-left'],[right,above,'above-right'],
    [left,below,'below-left'],[right,below,'below-right']
  ];
  let best;
  for(const [x,y,side]of candidates){
    const overflow=point?Math.max(0,frame.left+EDGE_MARGIN-point.x-x)
      +Math.max(0,point.x+x+width+EDGE_MARGIN-frame.right)
      +Math.max(0,frame.top+EDGE_MARGIN-point.y-y)
      +Math.max(0,point.y+y+BOX_HEIGHT+EDGE_MARGIN-frame.bottom):0;
    if(best&&overflow>best.overflow)continue;
    const boxLeft=ticket.x+(x-ROUTE_MARGIN)*unitsPerPixel,boxTop=ticket.y+(y-ROUTE_MARGIN)*unitsPerPixel;
    const boxRight=ticket.x+(x+width+ROUTE_MARGIN)*unitsPerPixel;
    const boxBottom=ticket.y+(y+BOX_HEIGHT+ROUTE_MARGIN)*unitsPerPixel;
    const covered=nearby.reduce((sum,route)=>sum+coveredLength(route,boxLeft,boxTop,boxRight,boxBottom),0);
    if(overflow===0&&covered===0)return {x,y,side};
    if(!best||overflow<best.overflow||covered<best.covered)best={x,y,side,overflow,covered};
  }
  return best;
}

/** Keep an exact dot at a shared location and move the interactive symbols next to it. */
export class PointCompositions {
  constructor({root,frame,tickets,points}){
    const ordered=[...tickets.values()].sort((a,b)=>a.node.compareDocumentPosition(b.node)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1);
    Object.assign(this,{root,frame,tickets:ordered,points,routes:[],groups:new Map(),homes:new Map(),offsets:new Map()});
    this.layer=svg('g',{},'snapshot-compositions');root.append(this.layer);
  }
  setRoutes(paths){
    this.routes=[];
    for(const path of paths)for(let index=1;index<path.length;index++){
      const [x,y]=path[index-1],[endX,endY]=path[index];
      const dx=endX-x,dy=endY-y,length=Math.hypot(dx,dy);
      if(length)this.routes.push({x,y,dx,dy,length,left:Math.min(x,endX),right:Math.max(x,endX),
        top:Math.min(y,endY),bottom:Math.max(y,endY)});
    }
  }
  restore(node){
    const home=this.homes.get(node);if(!home)return;
    home.after(node);home.remove();this.homes.delete(node);
    const offset=this.offsets.get(node);
    if(offset?.isConnected)offset.replaceWith(...offset.childNodes);
    this.offsets.delete(node);
  }
  layout(){
    const requested=new Map(),members=new Set(),focus=document.activeElement;
    let created=false,movedFocus=false;
    for(const entry of this.tickets.values())if(entry.node.getAttribute('display')==='inline'){
      const key=coordinate(entry.position);
      if(!requested.has(key))requested.set(key,{tickets:[],points:[]});
      requested.get(key).tickets.push(entry);
    }
    for(const entry of this.points())requested.get(coordinate(entry.position))?.points.push(entry);
    for(const [key,group]of requested){
      if(!group.points.length){requested.delete(key);continue;}
      for(const entry of [...group.tickets,...group.points])members.add(entry.node);
    }
    for(const node of this.homes.keys())if(!members.has(node)){
      movedFocus||=node.contains(focus);this.restore(node);
    }
    const matrix=this.root.getScreenCTM(),frame=this.frame.getBoundingClientRect();
    for(const [key,entries]of requested){
      let group=this.groups.get(key);
      if(!group){
        const node=svg('g',{},'snapshot-point-composition'),anchor=svg('g',{'aria-hidden':true});
        const symbol=svg('g',{},'snapshot-marker-symbol');
        const dot=svg('circle',{r:4},'snapshot-composition-dot');
        const base=svg('rect',{rx:(BOX_HEIGHT-1)/2,height:BOX_HEIGHT-1},'snapshot-composition-base');
        symbol.append(dot,base);anchor.append(symbol);node.append(anchor);this.layer.append(node);
        group={node,anchor,base};this.groups.set(key,group);created=true;
      }
      const ticket=entries.tickets[0],width=Math.max(...entries.points.map(entry=>Number(entry.node.querySelector('.snapshot-engineer-hit')?.getAttribute('width'))||HIT_SIZE));
      const total=width+HIT_SIZE+2*BOX_PADDING,{x,y,side}=placeCallout(ticket,total,frame,matrix,this.routes);
      group.node.dataset.side=side;
      group.anchor.setAttribute('transform',`translate(${ticket.x} ${ticket.y})`);
      group.base.setAttribute('x',String(x+.5));group.base.setAttribute('y',String(y+.5));
      group.base.setAttribute('width',String(total-1));
      const markers=[...entries.tickets,...entries.points];
      const ordered=[group.anchor,...markers.map(entry=>entry.node)];
      for(const node of ordered.slice(1))if(!this.homes.has(node)){
        const home=document.createComment('point home');node.before(home);this.homes.set(node,home);
      }
      for(let index=1;index<ordered.length;index++)if(group.node.children[index]!==ordered[index]){
        const node=ordered[index];movedFocus||=node.contains(focus);
        group.node.insertBefore(node,group.node.children[index]||null);
      }
      for(const entry of markers){
        const isTicket=entry.node.dataset.kind==='ticket';
        const symbol=entry.node.querySelector(isTicket?'.snapshot-ticket-symbol':'.snapshot-marker-symbol');
        let shifted=this.offsets.get(entry.node);
        if(!shifted||shifted.parentNode!==symbol){
          shifted=svg('g',{},'snapshot-point-offset');shifted.append(...symbol.childNodes);symbol.append(shifted);
          this.offsets.set(entry.node,shifted);created=true;
        }
        const offsetX=x+BOX_PADDING+(isTicket?width+HIT_SIZE/2:width/2);
        shifted.setAttribute('transform',`translate(${offsetX} ${y+BOX_HEIGHT/2})`);
      }
    }
    // Nodes that changed composition have been moved before obsolete bases are removed.
    for(const [key,group]of this.groups)if(!requested.has(key)){group.node.remove();this.groups.delete(key);}
    if(created&&this.root.querySelectorAll('*').length>100000)throw Object.assign(new Error('MAP_SNAPSHOT_INVALID_GEOMETRY'),{code:'MAP_SNAPSHOT_INVALID_GEOMETRY'});
    if(movedFocus&&focus?.isConnected&&focus.getAttribute('display')!=='none'&&document.activeElement!==focus)focus.focus({preventScroll:true});
  }
  dispose(){
    for(const node of this.homes.keys())this.restore(node);
    this.groups.clear();this.offsets.clear();this.layer.remove();
  }
}
