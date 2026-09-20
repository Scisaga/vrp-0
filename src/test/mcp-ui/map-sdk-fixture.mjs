/** Test substitutes only. No actual map provider, credential or external request. */
export const mapSdkFixture = `(() => {
  const stats = window.__mapStats ||= { maps:[], destroyed:0, fits:0, moves:[], lines:[] };
  class MapFixture {
    constructor(container, layer, options) {
      this.container=container;this.options=options || layer;this.center=this.options.center;this.zoom=this.options.zoom;this.objects=[];this.listeners=new Map();
      stats.maps.push(this);container.dataset.mockMap='ready';
      this.canvas=document.createElement('canvas');container.appendChild(this.canvas);this.triggerResize();
      if(!options){
        // Match the real SDK: resizeEnable:false does NOT prevent its sensor.
        const sensor=document.createElement('object');sensor.type='text/html';sensor.data='about:blank';
        sensor.style.cssText='position:absolute;pointer-events:none;width:100%;height:100%;z-index:-1';
        sensor.onload=function(){this.contentDocument.defaultView.addEventListener('resize',()=>{})};
        container.appendChild(sensor);stats.sensorInserted=Boolean(sensor.parentNode);
      }
    }
    add(objects){this.addObjects(objects)}
    addObjects(objects){for(const item of objects){this.objects.push(item);if(item.content){this.container.append(item.content);item.content.style.position='relative';item.content.style.display='inline-flex';item.content.style.margin='4px';}}}
    remove(objects){this.removeObjects(objects)}
    removeObjects(objects){for(const item of objects)item.content?.remove();this.objects=this.objects.filter(item=>!objects.includes(item))}
    getCenter(){return Array.isArray(this.center)?{lng:this.center[0],lat:this.center[1]}:this.center}
    on(type,listener){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(listener);if(type==='complete'&&!window.__disableMapComplete)setTimeout(()=>this.emit('complete'),0)}
    off(type,listener){this.listeners.get(type)?.delete(listener)}emit(type){for(const listener of this.listeners.get(type)||[])listener({type})}
    getZoom(){return this.zoom}setZoom(value){this.zoom=value}setCenter(value){this.center=value}
    setZoomAndCenter(zoom,center){this.zoom=zoom;this.center=center}
    setFitView(){stats.fits++}getViewModel(){return {setLookAtData:()=>{stats.fits++}}}
    triggerResize(){this.size={width:this.container.clientWidth,height:this.container.clientHeight};this.canvas.width=this.size.width;this.canvas.height=this.size.height;this.canvas.style.cssText='position:absolute;pointer-events:none;width:'+this.size.width+'px;height:'+this.size.height+'px'}getViewPort(){return {resize:()=>this.triggerResize()}}
    destroy(){this.dispose()}dispose(){if(this.disposed)return;this.disposed=true;this.removeObjects([...this.objects]);this.canvas.remove();stats.destroyed++;delete this.container.dataset.mockMap}
  }
  class AMapMarker {
    constructor(options){this.position=options.position;this.content=options.content}
    setPosition(value){this.position=value;stats.moves.push({label:this.content?.textContent,position:value})}
  }
  class AMapPolyline {constructor(options){this.options=options;stats.lines.push(options)}}
  class DomIcon {constructor(element,options){this.element=element;this.options=options}}
  class DomMarker {
    constructor(position,options){this.position=position;this.icon=options.icon;this.content=this.icon.element.cloneNode(true);this.icon.options?.onAttach?.(this.content)}
    setGeometry(value){this.position=value;stats.moves.push({label:this.content?.textContent,position:[value.lng,value.lat]})}
  }
  class LineString {constructor(){this.points=[]}pushLatLngAlt(lat,lng){this.points.push([lng,lat])}}
  class HPolyline {constructor(points,options){this.options=options;stats.lines.push({path:points.points,...options})}}
  class Group {constructor(){this.objects=[]}addObject(value){this.objects.push(value)}getBoundingBox(){return this.objects.length?{}:null}dispose(){}}
  class Style {
    static State={ERROR:-1,READY:2};constructor(){this.state=2;this.listeners=new Map()}
    getState(){return this.state}addEventListener(type,listener){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(listener)}
    removeEventListener(type,listener){this.listeners.get(type)?.delete(listener)}emit(type){if(type==='error')this.state=-1;for(const listener of this.listeners.get(type)||[])listener({type})}
  }
  class Platform {constructor(){}createDefaultLayers(){const style=new Style();stats.style=style;return {vector:{normal:{mapnight:{getProvider:()=>({getStyle:()=>style})}}}}}}
  class Disposable {dispose(){}}
  window.AMap={Map:MapFixture,Marker:AMapMarker,Polyline:AMapPolyline};
  window.H={Map:MapFixture,service:{Platform},geo:{LineString},map:{render:{Style},DomIcon,DomMarker,Polyline:HPolyline,Group,Marker:class{constructor(position){this.position=position}}},mapevents:{MapEvents:Disposable,Behavior:Disposable}};
})();`;
