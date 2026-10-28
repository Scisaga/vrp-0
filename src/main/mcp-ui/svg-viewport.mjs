/** Fixed-snapshot geometry only: no DOM, business state, credentials or network. */
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const EPSILON = 1e-6;

export function fitSnapshotBounds(bounds, frame, snapshot) {
  const aspect = frame.width / frame.height;
  const pad = Math.min(24, frame.width / 10, frame.height / 10);
  const spanX = Math.max(0, bounds.right - bounds.left), spanY = Math.max(0, bounds.bottom - bounds.top);
  const width = Math.max(64, spanX * frame.width / (frame.width - 2 * pad),
    spanY * frame.height / (frame.height - 2 * pad) * aspect);
  return {x:(bounds.left + bounds.right - width) / 2,
    y:(bounds.top + bounds.bottom - width / aspect) / 2, width, height:width / aspect};
}

export function snapshotFrame(size, snapshot, bounds) {
  if (!(size.width > 0 && size.height > 0)) return null;
  let frame = {x:0,y:0,width:size.width,height:size.height};
  let fit = fitSnapshotBounds(bounds, frame, snapshot);
  // Full routes take priority over filling an extreme aspect ratio. Use a real,
  // bounded map rectangle; any surrounding space is page chrome, not grey map.
  if (fit.width > snapshot.width + EPSILON || fit.height > snapshot.height + EPSILON) {
    const aspect = snapshot.width / snapshot.height;
    const width = Math.min(size.width, size.height * aspect), height = width / aspect;
    frame = {x:(size.width-width)/2,y:(size.height-height)/2,width,height};
    fit = fitSnapshotBounds(bounds, frame, snapshot);
    // Labels can reach the picture edge on historical snapshots. Reduce only
    // decorative padding rather than losing actual points or route geometry.
    if (fit.width > snapshot.width || fit.height > snapshot.height) {
      const span = Math.max(bounds.right-bounds.left, (bounds.bottom-bounds.top)*aspect, 64);
      fit = {x:(bounds.left+bounds.right-span)/2,y:(bounds.top+bounds.bottom-span/aspect)/2,width:span,height:span/aspect};
    }
  }
  return {frame,fit};
}

export function snapshotZoomLimits(snapshot, frame, density, devicePixelRatio = 1) {
  const aspect = frame.width / frame.height;
  const maxWidth = Math.min(snapshot.width, snapshot.height * aspect);
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const pixelsPerUnit = Number.isFinite(density) && density > 0 ? density : 1;
  // At most two device pixels per raster pixel. An unavoidable oversized host
  // starts at the widest legal view and cannot magnify further.
  return {minWidth:Math.min(maxWidth, Math.max(EPSILON, frame.width * dpr / (pixelsPerUnit * 2))),maxWidth};
}

export function constrainSnapshotViewport(view, snapshot, frame, density, dpr = 1) {
  if (!view || !['x','y','width','height'].every(key=>Number.isFinite(view[key])) || view.width<=0 || view.height<=0) return null;
  const {minWidth,maxWidth} = snapshotZoomLimits(snapshot, frame, density, dpr);
  const width = clamp(view.width, minWidth, maxWidth), height = width * frame.height / frame.width;
  const x = clamp(view.x + (view.width-width)/2, 0, Math.max(0,snapshot.width-width));
  const y = clamp(view.y + (view.height-height)/2, 0, Math.max(0,snapshot.height-height));
  return {x,y,width,height};
}

export function sameSnapshotViewport(a,b) {
  return Boolean(a && b && ['x','y','width','height'].every(key=>Math.abs(a[key]-b[key])<EPSILON));
}
