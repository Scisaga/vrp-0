import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const staticRoot = path.resolve(testDirectory, "..");
const amapPath = path.join(staticRoot, "assets/js/utils/amap.js");

async function loadAmapModule() {
  const result = await build({
    entryPoints: [amapPath],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    write: false
  });
  const module = { exports: {} };
  new Function("module", "exports", result.outputFiles[0].text)(module, module.exports);
  return module.exports;
}

test("地图 SDK 语言由 map_context.locale 映射，并识别 AMap 样式保留所需的重建", async () => {
  const { amapLanguage, applyMapLocale, mapLocaleRequiresRecreation } = await loadAmapModule();
  const calls = [];
  const map = {
    _vrpAppliedMapStyle: "amap://styles/darkblue",
    setLang: (language) => calls.push(`lang:${language}`),
    setMapStyle: (style) => calls.push(`style:${style}`)
  };

  assert.equal(amapLanguage("en-US"), "en");
  assert.equal(amapLanguage("zh-CN"), "zh_cn");
  assert.equal(applyMapLocale(map, { locale: "en-US" }), true);
  assert.deepEqual(calls, ["lang:en", "style:amap://styles/darkblue"]);
  await Promise.resolve();
  assert.deepEqual(calls, ["lang:en", "style:amap://styles/darkblue", "style:amap://styles/darkblue"]);
  assert.equal(applyMapLocale(map, { locale: "en-US" }), false);
  assert.equal(applyMapLocale(map, { locale: "zh-CN" }), true);
  assert.deepEqual(calls, [
    "lang:en", "style:amap://styles/darkblue", "style:amap://styles/darkblue",
    "lang:zh_cn", "style:amap://styles/darkblue"
  ]);
  assert.equal(mapLocaleRequiresRecreation(
    { _vrpMapLocale: "zh-CN" },
    { provider: "amap", locale: "en-US" }
  ), true);
  assert.equal(mapLocaleRequiresRecreation(
    { _vrpMapLocale: "en-US" },
    { provider: "here", locale: "zh-CN" }
  ), false);
});

test("AMap 默认使用原生 darkblue 主题，且主题未变化时不重复刷新瓦片样式", async () => {
  const { ensureMap } = await loadAmapModule();
  const originalWindow = global.window;
  const styleCalls = [];
  const themeClassCalls = [];
  let constructorOptions = null;

  class Map {
    constructor(_container, options) {
      constructorOptions = options;
    }

    setMapStyle(style) {
      styleCalls.push(style);
    }

    on() {}
  }

  const container = {
    dataset: {},
    classList: {
      toggle(name, enabled) {
        themeClassCalls.push([name, enabled]);
      }
    },
    getRootNode() {
      return null;
    }
  };

  global.window = {
    AMap: { Map },
    VrpScenarioGateway: {
      context: {
        map_context: { provider: "amap", locale: "zh-CN" }
      }
    }
  };

  try {
    await ensureMap(container, { zoom: 10 });
    assert.equal(constructorOptions.mapStyle, "amap://styles/darkblue");
    assert.equal(container.dataset.vrpMapTheme, "dark");
    assert.deepEqual(themeClassCalls.at(-1), ["vrp-amap-en-dark-fallback", false]);
    assert.deepEqual(styleCalls, [], "构造时已设置原生深色主题，不应再次调用 setMapStyle");

    await ensureMap(container, { zoom: 10, mapTheme: "dark" });
    assert.deepEqual(styleCalls, [], "相同主题应复用现有地图瓦片");
    assert.equal(container.dataset.vrpMapTheme, "dark");
    assert.deepEqual(themeClassCalls.at(-1), ["vrp-amap-en-dark-fallback", false]);

    await ensureMap(container, { zoom: 10, mapTheme: "light" });
    assert.deepEqual(styleCalls, ["amap://styles/normal"]);
    assert.equal(container.dataset.vrpMapTheme, "light");
    assert.deepEqual(themeClassCalls.at(-1), ["vrp-amap-en-dark-fallback", false]);

    await ensureMap(container, { zoom: 10, mapTheme: "light" });
    assert.deepEqual(styleCalls, ["amap://styles/normal"], "显式浅色主题未变化时也不应重复刷新瓦片");
  } finally {
    global.window = originalWindow;
  }
});

test("缺少回放时间时仍逐段展示后端返回的返仓道路轨迹", async () => {
  const { buildDisplayRoutePolylines } = await loadAmapModule();
  const depot = [116.4669, 39.9148];
  const firstTicket = [116.484, 39.9095];
  const lastTicket = [116.4575, 39.916];
  const returnBend = [116.4575, 39.9134];

  const paths = buildDisplayRoutePolylines({
    start_loc: { location: depot.join(",") },
    tickets: [
      { loc: { location: firstTicket.join(",") }, arrival_time: null, departure_time: null },
      { loc: { location: lastTicket.join(",") }, arrival_time: null, departure_time: null }
    ],
    routes: [
      { polyline: [depot, [116.475, 39.912], firstTicket] },
      { polyline: [firstTicket, [116.47, 39.91], lastTicket] },
      { polyline: [lastTicket, returnBend, [116.4674, 39.9134], depot] }
    ]
  });

  assert.equal(paths.length, 3);
  assert.deepEqual(paths[2], [lastTicket, returnBend, [116.4674, 39.9134], depot]);
  assert.deepEqual(paths[2].at(-1), depot);
});

test("货车降级为普通驾车时保留道路轨迹并提示限制", async () => {
  const { buildDisplayRouteSegments, getAgentRouteNotice } = await loadAmapModule();
  const depot = [116.4669, 39.9148];
  const ticket = [116.484, 39.9095];
  const agent = {
    start_loc: { location: depot.join(",") },
    tickets: [{ loc: { location: ticket.join(",") } }],
    routes: [{
      route_source: "CAR_FALLBACK",
      polyline: [depot, [116.475, 39.912], ticket],
      routing_failures: [{
        vehicle_type: "TRUCK",
        endpoint: "v4/direction/truck",
        code: "10012",
        message: "INSUFFICIENT_PRIVILEGES"
      }]
    }]
  };

  const segments = buildDisplayRouteSegments(agent);
  const notice = getAgentRouteNotice(agent);

  assert.equal(segments.length, 1);
  assert.equal(segments[0].estimated, false);
  assert.equal(segments[0].source, "CAR_FALLBACK");
  assert.equal(notice.kind, "car-fallback");
  assert.equal(notice.key, "map.routeNotice.carFallback");
});

test("真实道路段与估算段同时存在时逐段保留并标记估算段", async () => {
  const { buildDisplayRouteSegments, getAgentRouteNotice } = await loadAmapModule();
  const depot = [116.4669, 39.9148];
  const ticket = [116.484, 39.9095];
  const agent = {
    start_loc: { location: depot.join(",") },
    tickets: [{ loc: { location: ticket.join(",") } }],
    routes: [
      {
        route_source: "AMAP_TRUCK",
        polyline: [depot, [116.475, 39.912], ticket]
      },
      {
        route_source: "ESTIMATED",
        origin: ticket,
        destination: depot,
        polyline: null,
        routing_failures: [{
          vehicle_type: "CAR",
          endpoint: "v5/direction/driving",
          code: "10012",
          message: "INSUFFICIENT_PRIVILEGES"
        }]
      }
    ]
  };

  const segments = buildDisplayRouteSegments(agent);
  const notice = getAgentRouteNotice(agent);

  assert.equal(segments.length, 2);
  assert.equal(segments[0].estimated, false);
  assert.equal(segments[1].estimated, true);
  assert.deepEqual(segments[1].path, [ticket, depot]);
  assert.equal(notice.kind, "estimated");
  assert.equal(notice.key, "map.routeNotice.estimated");
});

test("HERE 道路段沿用统一路线展示和返仓折线", async () => {
  const { buildDisplayRouteSegments } = await loadAmapModule();
  const depot = [13.38886, 52.517037];
  const ticket = [13.397634, 52.518611];
  const segments = buildDisplayRouteSegments({
    start_loc: { location: depot.join(",") },
    tickets: [{ loc: { location: ticket.join(",") } }],
    routes: [
      { route_source: "HERE_DRIVING", polyline: [depot, [13.392, 52.518], ticket] },
      { route_source: "HERE_DRIVING", polyline: [ticket, [13.39, 52.516], depot] }
    ]
  });

  assert.equal(segments.length, 2);
  assert.equal(segments[0].estimated, false);
  assert.equal(segments[0].source, "HERE_DRIVING");
  assert.deepEqual(segments[1].path.at(-1), depot);
});

test("旧任务没有路线来源且缺少折线时显示历史数据提示", async () => {
  const { getAgentRouteNotice } = await loadAmapModule();
  const notice = getAgentRouteNotice({
    routes: [{ polyline: [] }]
  });

  assert.equal(notice.kind, "legacy");
  assert.equal(notice.key, "map.routeNotice.legacy");
});

test("右侧工程师预览适配路线折线与任务标记的完整范围", async () => {
  const { renderAgentPreview } = await loadAmapModule();
  const originalWindow = global.window;
  class InfoWindow {
    close() {}
  }
  class Pixel {}
  class Polyline {
    constructor(options) {
      this.options = options;
    }
  }
  class Marker {
    constructor(options) {
      this.options = options;
    }

    on() {}
  }
  global.window = { AMap: { InfoWindow, Pixel, Polyline, Marker } };

  try {
    let fitOverlays = null;
    const map = {
      clearMap() {},
      add() {},
      getFitZoomAndCenterByOverlays(overlays) {
        fitOverlays = overlays;
        return [12, [116.4, 39.9]];
      },
      setZoomAndCenter() {}
    };
    const depot = [116.4669, 39.9148];
    const ticket = [116.484, 39.9095];

    renderAgentPreview(map, {
      start_loc: { location: depot.join(",") },
      tickets: [{ id: "ticket-1", loc: { location: ticket.join(",") } }],
      routes: [{ polyline: [depot, [116.53, 39.93], ticket] }]
    });

    assert.equal(fitOverlays.length, 3);
    assert.ok(fitOverlays[0] instanceof Polyline);
    assert.equal(fitOverlays.filter((overlay) => overlay instanceof Marker).length, 2);
  } finally {
    global.window = originalWindow;
  }
});

test("右侧工程师预览将同地址工单合并为完整顺序标记", async () => {
  const { buildAgentPreviewMarkerGroups, renderAgentPreview } = await loadAmapModule();
  const originalWindow = global.window;
  const createdMarkers = [];
  class InfoWindow {
    close() {}
  }
  class Pixel {}
  class Polyline {
    constructor(options) {
      this.options = options;
    }
  }
  class Marker {
    constructor(options) {
      this.options = options;
      createdMarkers.push(this);
    }

    on() {}
  }
  global.window = { AMap: { InfoWindow, Pixel, Polyline, Marker } };

  try {
    const sharedLocation = "174.87126,-36.91331";
    const agent = {
      start_loc: { location: "174.89489,-36.93666" },
      tickets: [
        { id: "delivery", loc: { location: sharedLocation, address: "10 Aylesbury St" } },
        { id: "replacement", loc: { location: sharedLocation, address: "10 Aylesbury St" } },
        { id: "inspection", loc: { location: "174.90264,-36.88081", address: "50 Argo Dr" } }
      ],
      routes: []
    };

    const groups = buildAgentPreviewMarkerGroups(agent, "delivery");
    assert.equal(groups.length, 2);
    assert.equal(groups[0].label, "1/2");
    assert.deepEqual(groups[0].ticketIds, ["delivery", "replacement"]);
    assert.equal(groups[0].hovered, true);
    assert.equal(groups[1].label, "3");

    let fitOverlays = null;
    renderAgentPreview({
      clearMap() {},
      add() {},
      getFitZoomAndCenterByOverlays(overlays) {
        fitOverlays = overlays;
        return [12, [174.89, -36.91]];
      },
      setZoomAndCenter() {}
    }, agent, "delivery");

    const ticketMarkers = createdMarkers.filter((marker) => marker.options.label);
    assert.equal(ticketMarkers.length, 2, "同坐标只绘制一个工单标记");
    assert.match(ticketMarkers[0].options.label.content, />1\/2<\/div>/);
    assert.equal(ticketMarkers[0].options.title, undefined, "可点击的序号标记不应重复使用浏览器原生 tooltip");
    assert.equal(fitOverlays.filter((overlay) => overlay instanceof Marker).length, 3);
  } finally {
    global.window = originalWindow;
  }
});

test("一张图默认隐藏工单长 ID，聚焦后只显示当前工程师标签", async () => {
  const { renderSimulation } = await loadAmapModule();
  const originalWindow = global.window;
  const createdMarkers = [];
  const createdPolylines = [];
  class InfoWindow { close() {} }
  class Pixel {}
  class Polyline {
    constructor(options) {
      this.options = options;
      createdPolylines.push(this);
    }
  }
  class CircleMarker {
    constructor(options) { this.options = options; }
    on() {}
  }
  class Marker {
    constructor(options) {
      this.options = options;
      createdMarkers.push(this);
    }
    on() {}
    setPosition(position) { this.options.position = position; }
  }
  global.window = { AMap: { InfoWindow, Pixel, Polyline, CircleMarker, Marker } };

  try {
    const overlays = [];
    const map = {
      add(value) { overlays.push(...(Array.isArray(value) ? value : [value])); },
      remove() {},
      getFitZoomAndCenterByOverlays() { return [11, [116.4, 39.9]]; },
      setZoomAndCenter() {},
      getZoom() { return 11; }
    };
    const container = { _vrpMap: map };
    const firstAgentId = "agent-with-a-very-long-identifier-0001";
    const secondAgentId = "agent-with-a-very-long-identifier-0002";
    const job = {
      id: "map-label-fixture",
      plan: {
        agents: [
          {
            id: firstAgentId,
            start_loc: { location: "116.40,39.90" },
            tickets: [{ id: "ticket-long-identifier-first", loc: { location: "116.41,39.91" }, arrival_time: "2026-07-14 09:00:00" }],
            routes: [{ polyline: [[116.40, 39.90], [116.41, 39.91]] }]
          },
          {
            id: secondAgentId,
            name: "Named technician",
            start_loc: { location: "116.42,39.92" },
            tickets: [{ id: "ticket-long-identifier-second", loc: { location: "116.43,39.93" }, arrival_time: "2026-07-14 09:00:00" }],
            routes: []
          }
        ]
      }
    };

    await renderSimulation(container, job, {}, {}, "2026-07-14 08:30:00", { fitMode: "visible" });
    assert.equal(createdMarkers.some((marker) => marker.options.title), false, "地图标记不应设置浏览器原生 tooltip");
    const firstDynamic = createdMarkers.find((marker) => marker.options.label?.content?.includes(`data-tooltip="${firstAgentId}"`));
    assert.ok(firstDynamic);
    assert.match(firstDynamic.options.label.content, /…/);
    assert.ok(createdMarkers.some((marker) => marker.options.label?.content?.includes('data-tooltip="Named technician"')));

    await renderSimulation(container, job, {}, {}, "2026-07-14 08:30:00", { focusedAgentId: firstAgentId, fitMode: "focused" });
    assert.ok(createdMarkers.some((marker) => marker.options.label?.content?.includes(">ticket-long-identifier-first</div>")));
    assert.equal(createdMarkers.some((marker) => marker.options.label?.content?.includes(">ticket-long-identifier-second</div>")), false);

    const polylineCount = createdPolylines.length;
    const markerCount = createdMarkers.length;
    await renderSimulation(container, job, {}, {}, "2026-07-14 08:35:00", {
      focusedAgentId: firstAgentId,
      fitMode: "preserve",
      refreshOverlays: true
    });
    assert.ok(createdPolylines.length > polylineCount, "播放刷新应重新绘制路线覆盖物");
    assert.ok(createdMarkers.length > markerCount, "播放刷新应重新绘制当前 Marker");
  } finally {
    global.window = originalWindow;
  }
});
