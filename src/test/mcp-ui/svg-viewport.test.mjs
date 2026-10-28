import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotFrame,snapshotZoomLimits,constrainSnapshotViewport} from '../../main/mcp-ui/svg-viewport.mjs';
const snapshot={width:1024,height:768};
const bounds={left:180,top:140,right:840,bottom:620};
const inside=view=>{assert.ok(view.x>=-1e-6&&view.y>=-1e-6);assert.ok(view.x+view.width<=1024+1e-6);assert.ok(view.y+view.height<=768+1e-6);};
for(const size of [{width:900,height:600},{width:320,height:320},{width:1600,height:140},{width:180,height:1400}]) {
  test(`complete fit and valid map rectangle at ${size.width}×${size.height}`,()=>{
    const {frame,fit}=snapshotFrame(size,snapshot,bounds);
    assert.ok(frame.x>=0&&frame.y>=0&&frame.width<=size.width&&frame.height<=size.height);
    const view=constrainSnapshotViewport(fit,snapshot,frame,2,1);inside(view);
    assert.ok(view.x<=bounds.left&&view.y<=bounds.top);
    assert.ok(view.x+view.width>=bounds.right&&view.y+view.height>=bounds.bottom);
    assert.ok(Math.abs(view.width/view.height-frame.width/frame.height)<1e-8);
  });
}
for(const density of [1,2])for(const dpr of [1,2]) {
  test(`raster density ${density} and DPR ${dpr} limit actual magnification`,()=>{
    const frame={width:800,height:600};
    const limits=snapshotZoomLimits(snapshot,frame,density,dpr);
    assert.equal(limits.minWidth,800*dpr/(density*2));
    for(const candidate of [{x:-10000,y:-10000,width:1,height:1},{x:10000,y:10000,width:10000,height:10000}]) {
      const view=constrainSnapshotViewport(candidate,snapshot,frame,density,dpr);inside(view);
      assert.ok(view.width>=limits.minWidth&&view.width<=limits.maxWidth);
    }
  });
}
test('oversized host and zero-layout hosts fail safely without illegal views',()=>{
  assert.equal(snapshotFrame({width:0,height:100},snapshot,bounds),null);
  const frame={width:10000,height:7500};
  assert.deepEqual(snapshotZoomLimits(snapshot,frame,1,2),{minWidth:1024,maxWidth:1024});
  inside(constrainSnapshotViewport({x:0,y:0,width:2,height:2},snapshot,frame,1,2));
  assert.equal(constrainSnapshotViewport({x:NaN,y:0,width:2,height:2},snapshot,frame,2),null);
});
