import { getJson, postJson, putJson } from "./api.js";

function result(operation, fallbackCode) {
  return Promise.resolve().then(operation).then((data) => ({ ok: true, data })).catch((error) => ({
    ok: false,
    error: {
      code: error?.errorCode || error?.payload?.error_code || fallbackCode || "internal_error",
      params: error?.errorParams || error?.payload?.error_params || {},
      details: null,
      field_errors: [],
      retryable: Number(error?.status || 0) >= 500
    }
  }));
}

function addressComponents(poi) {
  return { country: "中国", province: poi?.pname || "", city: poi?.cityname || "", district: poi?.adname || "", township: null, street: null, street_number: null, adcode: poi?.adcode || "" };
}

function coordinate(poi, fallback = null) {
  const value = poi?.location || poi?.loc?.location || "";
  const [lng, lat] = String(value).split(",").map(Number);
  if (Number.isFinite(lng) && Number.isFinite(lat)) return { lng, lat, coordinate_system: "gcj02" };
  if (Number.isFinite(fallback?.lng) && Number.isFinite(fallback?.lat)) return { lng: fallback.lng, lat: fallback.lat, coordinate_system: fallback.coordinate_system || "gcj02" };
  return null;
}

function candidate(poi, index = 0) {
  return { candidate_id: poi?.id || `address-${index}`, name: poi?.name || poi?.address || "未命名地址", formatted_address: poi?.address || poi?.name || "", address_components: addressComponents(poi), coordinate: coordinate(poi), confidence: null, message: null };
}

export function engineScenarioActions() {
  return {
    submit_scenario: (input = {}) => result(async () => {
      const options = input.request_payload?.options || {};
      const saveParams = new URLSearchParams();
      if (options.build_transit_matrix) {
        saveParams.set("build", "true");
        saveParams.set("matrix_mode", options.matrix_mode || "MANHATTAN");
      }
      await putJson(`/scenario${saveParams.toString() ? `?${saveParams}` : ""}`, input.request_payload || {});
      const solveParams = new URLSearchParams({ solve_time: input.expected_solve_duration || "PT30S", matrix_mode: options.matrix_mode || "MANHATTAN", build_transit_matrix: String(Boolean(options.build_transit_matrix)), draw_route: String(Boolean(options.draw_route)) });
      const job = await postJson(`/solver_job?${solveParams}`);
      return { job_id: job?.id || job?.job_id || "", status: job?.status || "running", detail_url: "#/solver-job", navigation: { requested: input.submit_behavior?.on_success || "stay", performed: input.submit_behavior?.on_success === "open_result", url: "#/solver-job" }, submitted_at: new Date().toISOString() };
    }, "internal_error"),
    resolve_coordinate_address: (input = {}) => result(async () => {
      const points = Array.isArray(input.points) ? input.points : [];
      if (!points.length) throw new Error("points 不能为空");
      const items = await Promise.all(points.map(async (point) => {
        const lng = Number(point?.lng); const lat = Number(point?.lat);
        if (!point?.point_id || !Number.isFinite(lng) || !Number.isFinite(lat)) return { point_id: point?.point_id || "", status: "invalid_coordinate", formatted_address: null, address_components: null, coordinate: null, confidence: null, message: "坐标必须包含有效的 point_id、lng 和 lat" };
        try {
          const poi = await getJson(`/pois/regeocode?location=${encodeURIComponent(`${lng},${lat}`)}`);
          const resolvedCoordinate = coordinate(poi, point);
          return { point_id: point.point_id, status: resolvedCoordinate ? "resolved" : "not_found", formatted_address: poi?.address || poi?.name || null, address_components: addressComponents(poi), coordinate: resolvedCoordinate, confidence: null, message: resolvedCoordinate ? null : "未找到可用地址" };
        } catch (_error) {
          return { point_id: point.point_id, status: "provider_failed", formatted_address: null, address_components: null, coordinate: { lng, lat, coordinate_system: point.coordinate_system || "gcj02" }, confidence: null, message: "地址解析暂不可用" };
        }
      }));
      const resolvedCount = items.filter((item) => item.status === "resolved").length;
      return { items, resolved_count: resolvedCount, failed_count: items.length - resolvedCount, provider: "host_default", resolved_at: new Date().toISOString() };
    }, "internal_error"),
    search_text_address: (input = {}) => result(async () => {
      const query = input.keyword || input.query || input.text || input.keywords || "";
      const params = new URLSearchParams({ keywords: query });
      if (input.city) params.set("city", input.city);
      const limit = Math.max(1, Math.min(Number(input.limit) || 10, 20));
      const candidates = (await getJson(`/pois/geocode?${params}`)).map(candidate).filter((item) => item.coordinate).slice(0, limit);
      return { candidates, total_count: candidates.length, provider: "host_default", searched_at: new Date().toISOString() };
    }, "internal_error"),
    load_available_agent_windows: () => result(
      () => getJson("/scenario/available_agents"),
      "internal_error"
    ),
    load_scenario_result: (input = {}) => result(async () => {
      const jobId = String(input.job_id || input.jobId || "").trim();
      let job = null;
      try {
        job = await getJson(jobId
          ? `/solver_job/${encodeURIComponent(jobId)}?remove_virtual=true`
          : "/solver_job?remove_virtual=true");
      } catch (error) {
        if (error?.status !== 404) {
          throw error;
        }
      }
      return { task: job, result_state: job ? "ready" : "not_ready", result_summary: null, engine_view: { kind: "vrp0", schema_version: 2, display_model: "vrp0_solver_job", solver_job: job } };
    }, "internal_error")
  };
}
