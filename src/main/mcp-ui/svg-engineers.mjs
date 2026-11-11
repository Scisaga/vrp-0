import {colorFor} from './palette.mjs';
import {translate} from './i18n.mjs';

const NS='http://www.w3.org/2000/svg';
const person='M0-1a3 3 0 1 0 0-6 3 3 0 0 0 0 6M-5.5 7V4.8C-5.5 2-3.2.2 0 .2S5.5 2 5.5 4.8V7Z';
function svg(tag,attrs={},className){
  const node=document.createElementNS(NS,tag);
  for(const [key,value]of Object.entries(attrs))node.setAttribute(key,String(value));
  if(className)node.classList.add(className);return node;
}
function html(tag,value,className){
  const node=document.createElement(tag);if(value!==undefined)node.textContent=value;
  if(className)node.className=className;return node;
}
function symbol(node,color){
  const shape=svg('g',{},'snapshot-marker-symbol');
  shape.append(svg('rect',{x:-16,y:-16,width:32,height:32,rx:6},'snapshot-engineer-hit'),
    svg('rect',{x:-10.25,y:-10.25,width:20.5,height:20.5,rx:5.5,fill:color,stroke:'#fff','stroke-width':1.5},'snapshot-engineer-face'),
    svg('path',{d:person,fill:'#fff'},'snapshot-engineer-glyph'));
  node.replaceChildren(shape);node.classList.add('snapshot-engineer');
}

/** Local presentation of already validated engineers; never changes coordinates or fetches data. */
export class EngineerMarkers {
  constructor({frame,svg:root,entries,locale,idPrefix,onSelect}){
    Object.assign(this,{frame,root,entries,locale,onSelect,bindings:[],byNode:new Map(),groups:[],selectedId:null});
    this.name=html('div',undefined,'snapshot-engineer-name');this.name.hidden=true;this.name.id=idPrefix+'engineer-name';this.name.setAttribute('role','tooltip');
    this.popup=html('div',undefined,'snapshot-engineer-popup');this.popup.hidden=true;this.popup.id=idPrefix+'engineer-list';this.popup.setAttribute('role','dialog');
    this.popup.setAttribute('aria-label',translate(locale,'sharedStart'));
    frame.append(this.name,this.popup);
    const origins=new Map();
    for(const entry of entries.values()){
      for(const node of [entry.node,entry.playback]){
        symbol(node,colorFor(entry.agent.id));this.byNode.set(node,entry);
        node.setAttribute('aria-label',`${entry.agent.name||entry.agent.id}${entry.agent.date?' · '+entry.agent.date:''}`);
      }
      const key=JSON.stringify([entry.x,entry.y]);if(!origins.has(key))origins.set(key,[]);origins.get(key).push(entry);
    }
    // Keep moving people above static origin clusters when a replay starts at
    // a shared origin. Never move either marker away from its actual anchor.
    this.layer=svg('g');let replay=entries.values().next().value?.playback;
    while(replay?.parentElement&&replay.parentElement!==root)replay=replay.parentElement;
    root.insertBefore(this.layer,replay||null);
    for(const members of origins.values())if(members.length>1){
      const node=svg('g',{transform:`translate(${members[0].x} ${members[0].y})`,role:'button',tabindex:0,'aria-haspopup':'dialog','aria-controls':this.popup.id,'aria-expanded':'false'},'snapshot-engineer-cluster');
      node.dataset.kind='engineer-cluster';this.layer.append(node);this.groups.push({node,entries:members,members:[],key:''});
    }
    this.bind(root,'pointerover',event=>{
      const node=event.target.closest?.('.snapshot-engineer');if(!this.visible(node))return;
      this.hovered=node;this.dismissed=false;this.renderName();
    });
    this.bind(root,'pointerout',event=>{
      const node=event.target.closest?.('.snapshot-engineer');
      if(node?.contains(event.relatedTarget)||this.name.contains(event.relatedTarget))return;
      this.hovered=null;this.renderName();
    });
    this.bind(root,'focusin',event=>{
      const node=event.target.closest?.('.snapshot-engineer');this.focused=this.visible(node)?node:null;
      if(this.focused)this.dismissed=false;this.renderName();
    });
    this.bind(root,'focusout',()=>{this.focused=null;this.renderName();});
    this.bind(this.name,'pointerleave',()=>{this.hovered=null;this.renderName();});
    const outside=event=>{
      if(this.activeGroup&&!this.popup.contains(event.target)&&!this.activeGroup.node.contains(event.target))this.closePopup();
    };
    this.bind(document,'pointerdown',outside,true);this.bind(document,'focusin',outside);
    this.bind(document,'keydown',event=>{
      if(event.key!=='Escape'||!this.frame.contains(event.target))return;
      if(this.activeGroup){event.preventDefault();event.stopPropagation();this.closePopup(true);}
      else if(!this.name.hidden&&!event.target.closest?.('.snapshot-route')){
        event.preventDefault();event.stopPropagation();this.dismissed=true;this.hideName();
      }
    },true);
    this.bind(this.popup,'keydown',event=>{
      if(event.key==='Tab')return;
      if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
      event.preventDefault();const buttons=[...this.popup.querySelectorAll('.snapshot-engineer-choice')],index=buttons.indexOf(document.activeElement);
      const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:Math.max(0,Math.min(buttons.length-1,index+(event.key==='ArrowDown'?1:-1)));
      buttons[next]?.focus();
    });
    this.bind(document,'scroll',event=>{
      if(this.activeGroup&&!this.popup.contains(event.target))this.closePopup();
    },true);
    this.bind(window,'blur',()=>this.dismiss());
    this.bind(document,'visibilitychange',()=>{if(document.hidden)this.dismiss();else this.renderName();});
  }
  bind(node,type,listener,options){node.addEventListener(type,listener,options);this.bindings.push(()=>node.removeEventListener(type,listener,options));}
  visible(node){
    const entry=this.byNode.get(node);return Boolean(entry?.visible&&(entry.replaying?node===entry.playback:node===entry.node&&!entry.clustered));
  }
  update(scene){
    const markers=new Map(scene.markers.filter(marker=>marker.kind==='agent').map(marker=>[marker.id,marker]));
    const selected=[...markers.values()].find(marker=>marker.selected)?.id||null;
    if(this.selectedId!==selected){this.dismissed=false;this.closePopup();}this.selectedId=selected;
    for(const [id,entry]of this.entries){entry.visible=markers.has(id);entry.selected=Boolean(markers.get(id)?.selected);}
    this.sync();
  }
  sync(){
    for(const entry of this.entries.values())entry.clustered=false;
    for(const group of this.groups){
      const members=group.entries.filter(entry=>entry.visible&&!entry.replaying),key=JSON.stringify(members.map(entry=>entry.agent.id));
      if(this.activeGroup===group&&(key!==group.key||members.length<2))this.closePopup();
      group.node.setAttribute('display',members.length>1?'inline':'none');
      group.node.setAttribute('aria-hidden',String(members.length<2));group.node.setAttribute('tabindex',members.length>1?'0':'-1');
      if(members.length>1){
        for(const entry of members)entry.clustered=true;
        if(group.key!==key){
          const width=34+String(members.length).length*7,shape=svg('g',{},'snapshot-marker-symbol');
          shape.append(svg('rect',{x:-width/2,y:-16,width,height:32,rx:6},'snapshot-engineer-hit'),
            svg('rect',{x:-width/2+.75,y:-13.25,width:width-1.5,height:26.5,rx:6,fill:'#475569',stroke:'#fff','stroke-width':1.5}),
            svg('path',{d:person,transform:`translate(${-width/2+11} 0)`,fill:'#fff'}));
          const count=svg('text',{x:8,y:0,'text-anchor':'middle','dominant-baseline':'central','font-size':11,fill:'#fff'});count.textContent=String(members.length);shape.append(count);group.node.replaceChildren(shape);
          group.node.setAttribute('aria-label',this.groupTitle(members.length));
        }
      }
      group.members=members;group.key=key;
    }
    for(const entry of this.entries.values()){
      for(const [node,visible]of [[entry.node,entry.visible&&!entry.replaying&&!entry.clustered],[entry.playback,entry.visible&&entry.replaying]]){
        node.dataset.selected=String(Boolean(entry.selected&&visible));node.setAttribute('aria-pressed',String(Boolean(entry.selected&&visible)));
        node.setAttribute('aria-hidden',String(!visible));node.setAttribute('tabindex',visible?'0':'-1');
        node.setAttribute('display',visible?'inline':'none');
        if(visible)node.removeAttribute('visibility');else node.setAttribute('visibility','hidden');
      }
    }
    if(!this.visible(this.hovered))this.hovered=null;if(!this.visible(this.focused))this.focused=null;
    this.layout();
  }
  groupTitle(count){return `${translate(this.locale,'sharedStart')} · ${count} ${translate(this.locale,'sharedEngineers')}`;}
  toggleCluster(node){
    const group=this.groups.find(group=>group.node===node);if(!group||group.members.length<2)return;
    if(this.activeGroup===group){this.closePopup(true);return;}
    this.closePopup();this.hideName();this.activeGroup=group;group.node.setAttribute('aria-expanded','true');
    const heading=html('div',undefined,'snapshot-engineer-popup-heading');heading.append(html('span',this.groupTitle(group.members.length)));
    const close=html('button','×');close.type='button';close.setAttribute('aria-label',translate(this.locale,'closeEngineerList'));close.onclick=()=>this.closePopup(true);heading.append(close);
    const list=html('div',undefined,'snapshot-engineer-choices');
    for(const entry of group.members){
      const button=html('button',undefined,'snapshot-engineer-choice');button.type='button';button.dataset.engineerId=entry.agent.id;
      const swatch=html('span',undefined,'swatch');swatch.style.setProperty('--agent-color',colorFor(entry.agent.id));swatch.setAttribute('aria-hidden','true');
      const copy=html('span',undefined,'snapshot-engineer-copy');copy.append(html('span',entry.agent.name||entry.agent.id));
      if(entry.agent.date)copy.append(html('small',entry.agent.date));button.append(swatch,copy);
      button.onclick=()=>{this.closePopup();this.onSelect(entry.agent.id);const target=entry.replaying?entry.playback:entry.node;if(this.visible(target))target.focus({preventScroll:true});};
      list.append(button);
    }
    this.popup.replaceChildren(heading,list);this.popup.hidden=false;this.position(this.popup,group.node,true);
    list.querySelector('button')?.focus({preventScroll:true});
  }
  closePopup(focus=false){
    const group=this.activeGroup;this.activeGroup=null;this.popup.hidden=true;this.popup.replaceChildren();
    if(group){group.node.setAttribute('aria-expanded','false');if(focus&&group.node.getAttribute('display')!=='none')group.node.focus({preventScroll:true});}
  }
  hideName(){this.name.hidden=true;this.nameTarget?.removeAttribute('aria-describedby');this.nameTarget=null;}
  renderName(){
    if(this.dismissed||this.activeGroup){this.hideName();return;}
    const selected=this.entries.get(this.selectedId),node=this.hovered||this.focused||(selected?.visible?(selected.replaying?selected.playback:selected.node):null);
    if(!this.visible(node)){this.hideName();return;}
    const entry=this.byNode.get(node);
    if(this.nameTarget!==node){
      this.hideName();this.nameTarget=node;this.name.textContent=entry.agent.name||entry.agent.id;
      node.setAttribute('aria-describedby',this.name.id);
    }
    this.name.hidden=false;this.position(this.name,node);
  }
  position(overlay,target,popup=false){
    const frame=this.frame.getBoundingClientRect(),box=target.getBoundingClientRect(),bottom=this.frame.querySelector('.snapshot-attribution')?.getBoundingClientRect().height||0;
    if(frame.width<80||frame.height<48){overlay.hidden=true;return;}
    overlay.style.maxWidth=`${Math.max(40,Math.min(popup?300:260,frame.width-(popup?68:16)))}px`;
    overlay.style.maxHeight=`${Math.max(32,Math.min(popup?320:frame.height,frame.height-bottom-16))}px`;
    if(popup)overlay.style.width=overlay.style.maxWidth;
    const width=overlay.offsetWidth,height=overlay.offsetHeight,x=box.left+box.width/2-frame.left,y=box.top+box.height/2-frame.top;
    let left=x+20,top=y-height/2;
    if(left+width>frame.width-8)left=x-width-20;
    left=Math.max(8,Math.min(left,frame.width-width-(popup?52:8)));top=Math.max(8,Math.min(top,frame.height-bottom-height-8));
    const controls=this.frame.querySelector('.snapshot-controls')?.getBoundingClientRect();
    if(controls&&left+width>controls.left-frame.left-4&&top+height>controls.top-frame.top-4)top=Math.max(8,controls.top-frame.top-height-8);
    overlay.style.left=`${left}px`;overlay.style.top=`${top}px`;
  }
  layout(){if(this.activeGroup)this.position(this.popup,this.activeGroup.node,true);this.renderName();}
  dismiss(){this.closePopup();this.hovered=null;this.focused=null;this.hideName();}
  dispose(){
    this.dismiss();for(const remove of this.bindings)remove();this.bindings=[];
    this.layer.remove();this.groups=[];this.byNode.clear();this.name.remove();this.popup.remove();
  }
}
