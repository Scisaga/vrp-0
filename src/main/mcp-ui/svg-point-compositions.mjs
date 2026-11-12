const NS='http://www.w3.org/2000/svg';
function svg(tag,attrs={},className){
  const node=document.createElementNS(NS,tag);
  for(const [name,value]of Object.entries(attrs))node.setAttribute(name,String(value));
  if(className)node.classList.add(className);return node;
}
const coordinate=position=>JSON.stringify(position);

/** Separate local hit targets at one exact location, without moving the workorder anchor. */
export class PointCompositions {
  constructor({root,frame,tickets,points}){
    const ordered=[...tickets.values()].sort((a,b)=>a.node.compareDocumentPosition(b.node)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1);
    Object.assign(this,{root,frame,tickets:ordered,points,groups:new Map(),homes:new Map(),offsets:new Map()});
    this.layer=svg('g',{},'snapshot-compositions');root.append(this.layer);
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
        const node=svg('g',{},'snapshot-point-composition'),anchor=svg('g'),symbol=svg('g',{},'snapshot-marker-symbol'),base=svg('rect',{rx:17.5},'snapshot-composition-base');
        symbol.append(base);anchor.append(symbol);node.append(anchor);this.layer.append(node);
        group={node,anchor,base};this.groups.set(key,group);created=true;
      }
      const ticket=entries.tickets[0],width=Math.max(...entries.points.map(entry=>Number(entry.node.querySelector('.snapshot-engineer-hit')?.getAttribute('width'))||32));
      const point=matrix?new DOMPoint(ticket.x,ticket.y).matrixTransform(matrix):null;
      const left=point?point.x-frame.left:Infinity,right=point?frame.right-point.x:Infinity,reach=width+20;
      const side=left<reach&&right>left?1:-1,offset=side*(width/2+18),total=width+38;
      group.node.dataset.side=side<0?'left':'right';
      group.anchor.setAttribute('transform',`translate(${ticket.x} ${ticket.y})`);
      group.base.setAttribute('x',String(side<0?18-total+.5:-17.5));group.base.setAttribute('y','-17.5');
      group.base.setAttribute('width',String(total-1));group.base.setAttribute('height','35');
      const ordered=[group.anchor,...entries.tickets.map(entry=>entry.node),...entries.points.map(entry=>entry.node)];
      for(const node of ordered.slice(1))if(!this.homes.has(node)){
        const home=document.createComment('point home');node.before(home);this.homes.set(node,home);
      }
      for(let index=1;index<ordered.length;index++)if(group.node.children[index]!==ordered[index]){
        const node=ordered[index];movedFocus||=node.contains(focus);
        group.node.insertBefore(node,group.node.children[index]||null);
      }
      for(const entry of entries.points){
        const symbol=entry.node.querySelector('.snapshot-marker-symbol');let shifted=this.offsets.get(entry.node);
        if(!shifted||shifted.parentNode!==symbol){
          shifted=svg('g',{},'snapshot-point-offset');shifted.append(...symbol.childNodes);symbol.append(shifted);
          this.offsets.set(entry.node,shifted);created=true;
        }
        shifted.setAttribute('transform',`translate(${offset} 0)`);
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
