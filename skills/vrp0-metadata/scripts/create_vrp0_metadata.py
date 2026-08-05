#!/usr/bin/env python3
"""Generate Gateway metadata files for the VRP0 solver."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


def date_time_schema() -> dict:
    return {
        "description": "Local date time formatted as yyyy-MM-dd HH:mm:ss",
        "anyOf": [
            {"type": "string", "pattern": r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$"},
            {"type": "string", "maxLength": 0},
            {"type": "null"},
        ],
    }


def non_negative_number_schema() -> dict:
    return {
        "type": "number",
        "minimum": 0,
    }


def non_negative_integer_schema() -> dict:
    return {
        "type": "integer",
        "minimum": 0,
    }


def local_date_schema() -> dict:
    return {
        "description": "Local date formatted as yyyy-MM-dd",
        "anyOf": [
            {"type": "string", "pattern": r"^\d{4}-\d{2}-\d{2}$"},
            {"type": "null"},
        ],
    }


def loc_schema() -> dict:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "lat": {"type": "number"},
            "lon": {"type": "number"},
        },
    }


def poi_schema() -> dict:
    return {
        "type": "object",
        "required": ["id"],
        "additionalProperties": True,
        "properties": {
            "id": {"type": "string", "minLength": 1, "title": "POI ID"},
            "name": {"type": "string", "title": "POI 名称"},
            "location": {"type": "string", "title": "经纬度字符串"},
            "loc": {"$ref": "#/$defs/loc"},
            "entr_location": {"type": "string", "title": "入口经纬度字符串"},
            "entr_loc": {"$ref": "#/$defs/loc"},
            "address": {"type": "string", "title": "地址"},
            "cityname": {"type": "string", "title": "城市"},
            "adcode": {"type": "string", "title": "区域编码"},
            "adname": {"type": "string", "title": "区域名称"},
        },
    }


def poi_ref_schema() -> dict:
    return {
        "oneOf": [
            {"type": "string", "minLength": 1},
            {"$ref": "#/$defs/poi"},
            {"type": "null"},
        ]
    }


def sku_item_schema() -> dict:
    return {
        "type": "object",
        "required": ["sku"],
        "additionalProperties": False,
        "properties": {
            "sku": {"type": "string", "minLength": 1},
            "value": {**non_negative_number_schema(), "default": 1},
        },
    }


def sku_schema() -> dict:
    non_negative_number = non_negative_number_schema()
    return {
        "type": "object",
        "required": ["id"],
        "additionalProperties": True,
        "properties": {
            "id": {"type": "string", "minLength": 1, "title": "SKU ID"},
            "name": {"type": "string", "title": "SKU 名称"},
            "weight": {**non_negative_number, "title": "重量"},
            "vol": {**non_negative_number, "title": "体积"},
        },
    }


def depo_schema() -> dict:
    return {
        "type": "object",
        "required": ["id"],
        "additionalProperties": True,
        "properties": {
            "id": {"type": "string", "minLength": 1, "title": "仓库 ID"},
            "name": {"type": "string", "title": "仓库名称"},
            "loc": {"$ref": "#/$defs/poiRef"},
        },
    }


def agent_schema() -> dict:
    date_time = date_time_schema()
    non_negative_number = non_negative_number_schema()
    return {
        "type": "object",
        "required": ["id"],
        "additionalProperties": True,
        "properties": {
            "id": {"type": "string", "minLength": 1, "title": "车辆/工程师 ID"},
            "depo_id": {"type": "string", "title": "所属仓库 ID"},
            "name": {"type": "string", "title": "名称"},
            "start_loc": {"$ref": "#/$defs/poiRef"},
            "skills": {
                "type": "array",
                "items": {"type": "string"},
                "title": "服务技能",
            },
            "qualification_levels": {"type": "object", "title": "工程师资质等级"},
            "vehicle_type": {
                "type": "string",
                "enum": ["TRUCK", "CAR", "E_BIKE"],
                "title": "车辆类型",
                "description": "TRUCK（货车）：按货车道路能力规划路线；CAR（汽车）：按普通驾车能力规划路线；E_BIKE（电动自行车）：按骑行能力规划路线。",
            },
            "fuel_type": {
                "type": ["string", "null"],
                "enum": ["GAS_92", "ELEC", None],
                "title": "燃料类型",
                "description": "GAS_92（92 号汽油）：按升/百公里核算燃油消耗；ELEC（电力）：按千瓦时/百公里核算电耗；null（未指定）：不声明能源类型。",
            },
            "weight": {**non_negative_number, "title": "核定载重"},
            "vol": {**non_negative_number, "title": "核定体积"},
            "max_ticket_num": {**non_negative_integer_schema(), "title": "当日最大接单量"},
            "shift_start_time": {**date_time, "title": "班次开始时间"},
            "shift_off_time": {**date_time, "title": "班次结束时间"},
            "tickets": {
                "type": ["array", "null"],
                "items": {"type": "string", "minLength": 1},
                "title": "已分配工单 ID 列表",
            },
        },
    }


def ticket_schema() -> dict:
    date_time = date_time_schema()
    non_negative_number = non_negative_number_schema()
    return {
        "type": "object",
        "required": ["id"],
        "additionalProperties": True,
        "properties": {
            "id": {"type": "string", "minLength": 1, "title": "工单 ID"},
            "depo_id": {"type": "string", "title": "所属仓库 ID"},
            "pinned": {"type": "boolean", "title": "是否固定"},
            "type": {
                "type": "string",
                "enum": ["Delv", "Delv_BH", "Inst"],
                "default": "Delv",
                "title": "工单类型",
                "description": "Delv（配送）：完成后减少车辆在途载荷；Delv_BH（返仓）：完成后增加车辆在途载荷；Inst（安装）：执行安装服务且不改变配送载荷。",
            },
            "status": {
                "type": "string",
                "enum": ["New", "Assigned", "Accepted", "Transit", "Working", "Agent_Done", "Done"],
                "default": "New",
                "title": "工单状态",
                "description": "New（新生成）：尚未指派；Assigned（已指派）：已分配工程师；Accepted（已接受）：工程师已接单；Transit（在途）：正在前往现场；Working（工作中）：正在服务；Agent_Done（工程师完成）：等待客户确认；Done（客户确认）：工单已完成。",
            },
            "loc": {"$ref": "#/$defs/poiRef"},
            "items": {
                "type": "array",
                "title": "SKU 明细",
                "items": {"$ref": "#/$defs/skuItem"},
            },
            "weight": {**non_negative_number, "title": "重量"},
            "vol": {**non_negative_number, "title": "体积"},
            "skills_required": {
                "type": "array",
                "items": {"type": "string"},
                "title": "所需技能",
            },
            "qualification_levels_required": {"type": "object", "title": "所需资质等级"},
            "dep_tickets": {
                "type": "array",
                "items": {"type": "string", "minLength": 1},
                "title": "上级工单 ID 列表",
            },
            "ref_tickets": {
                "type": "array",
                "items": {"type": "string", "minLength": 1},
                "title": "下级工单 ID 列表",
            },
            "relation_tickets": {
                "type": "array",
                "items": {"type": "string", "minLength": 1},
                "title": "关联工单 ID 列表",
            },
            "create_time": {**date_time, "title": "工单创建时间"},
            "min_start_time": {**date_time, "title": "最早上门时间"},
            "max_end_time": {**date_time, "title": "最晚上门时间"},
            "arrival_time": {**date_time, "title": "到达时间"},
            "duration": {
                "type": "string",
                "pattern": r"^P(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)$",
                "title": "服务时长",
                "description": "ISO-8601 duration, e.g. PT30M",
            },
            "agent": {"type": ["string", "null"], "title": "指定车辆/工程师 ID"},
            "original_agent": {"type": ["string", "null"], "title": "原指派车辆/工程师 ID"},
            "previous_ticket": {"type": ["string", "null"], "title": "上一个工单 ID"},
            "next_ticket": {"type": ["string", "null"], "title": "下一个工单 ID"},
        },
    }


def options_schema() -> dict:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "build_transit_matrix": {"type": "boolean", "default": False, "title": "是否构建矩阵"},
            "matrix_mode": {
                "type": "string",
                "enum": ["AMAP", "MANHATTAN"],
                "default": "AMAP",
                "title": "矩阵构建类型",
                "description": "AMAP（道路路由矩阵）：通过地图路由能力计算在途数据；MANHATTAN（曼哈顿估算矩阵）：使用离线曼哈顿距离估算在途数据。",
            },
            "draw_route": {"type": "boolean", "default": False, "title": "是否构建路线"},
            "resource_spec": {"type": "string", "title": "求解资源规格"},
        },
    }


def route_plan_schema() -> dict:
    return {
        "type": "object",
        "required": ["depos", "agents", "tickets"],
        "additionalProperties": True,
        "properties": {
            "skus": {
                "type": "array",
                "items": {"$ref": "#/$defs/sku"},
                "title": "SKU 列表",
            },
            "pois": {
                "type": "array",
                "items": {"$ref": "#/$defs/poi"},
                "title": "地址 POI 列表",
            },
            "depos": {
                "type": "array",
                "items": {"$ref": "#/$defs/depo"},
                "title": "仓库列表",
            },
            "agents": {
                "type": "array",
                "items": {"$ref": "#/$defs/agent"},
                "title": "车辆/工程师列表",
            },
            "tickets": {
                "type": "array",
                "items": {"$ref": "#/$defs/ticket"},
                "title": "工单列表",
            },
            "matrix": {
                "type": "object",
                "title": "迁移矩阵",
                "additionalProperties": True,
            },
            "constraint_configuration": {
                "type": "object",
                "title": "约束配置",
                "additionalProperties": True,
                "description": "Gateway overwrites this with the effective constraint config before calling /scenario.",
            },
            "cost_parameter": {
                "type": "object",
                "title": "成本参数",
                "additionalProperties": True,
            },
            "metrics": {
                "type": ["object", "null"],
                "title": "规划指标",
                "additionalProperties": True,
            },
            "score": {"type": ["string", "null"], "title": "规划评分"},
        },
    }


def request_schema() -> dict:
    date_time = date_time_schema()
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://servforce.local/schemas/vrp0/request-schema.json",
        "title": "VRP0 solve request",
        "type": "object",
        "required": ["name", "planning_date", "start_time", "end_time", "plan"],
        "additionalProperties": True,
        "properties": {
            "id": {"type": ["string", "null"], "title": "场景 ID"},
            "name": {"type": "string", "minLength": 1, "title": "场景名称"},
            "desc": {"type": "string", "title": "场景描述"},
            "planning_date": {**local_date_schema(), "title": "规划日期"},
            "start_time": {**date_time, "title": "规划开始时间"},
            "end_time": {**date_time, "title": "规划结束时间"},
            "plan": {"$ref": "#/$defs/routePlan"},
            "create_time": {**date_time, "title": "场景创建时间"},
            "update_time": {**date_time, "title": "场景更新时间"},
            "poi_build": {"type": "boolean", "title": "POI 是否已构建"},
            "matrix_build": {"type": "boolean", "title": "矩阵是否已构建"},
            "options": options_schema(),
        },
        "$defs": {
            "loc": loc_schema(),
            "poi": poi_schema(),
            "poiRef": poi_ref_schema(),
            "skuItem": sku_item_schema(),
            "sku": sku_schema(),
            "depo": depo_schema(),
            "agent": agent_schema(),
            "ticket": ticket_schema(),
            "routePlan": route_plan_schema(),
        },
    }


def result_summary_schema() -> dict:
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://servforce.local/schemas/vrp0/result-summary-schema.json",
        "title": "VRP0 result summary",
        "type": "object",
        "required": ["result_score", "route_count", "assigned_order_count", "unassigned_order_count"],
        "additionalProperties": True,
        "properties": {
            "result_score": {"type": "string"},
            "route_count": {"type": "integer", "minimum": 0},
            "assigned_order_count": {"type": "integer", "minimum": 0},
            "unassigned_order_count": {"type": "integer", "minimum": 0},
            "total_distance_meters": {"type": "number", "minimum": 0},
            "total_duration_seconds": {"type": "number", "minimum": 0},
        },
    }


def score_rule(title: str, description: str) -> dict:
    return {
        "type": "string",
        "title": title,
        "description": description,
        "pattern": r"^-?\d+hard/-?\d+medium/-?\d+soft$",
    }


def camel_to_snake(value: str) -> str:
    value = re.sub(r"(.)([A-Z][a-z]+)", r"\1_\2", value)
    return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", value).lower()


def score_text(factory: str, amount: str) -> str:
    value = int(amount)
    if factory == "Hard":
        return f"{value}hard/0medium/0soft"
    if factory == "Medium":
        return f"0hard/{value}medium/0soft"
    if factory == "Soft":
        return f"0hard/0medium/{value}soft"
    raise ValueError(f"Unsupported HardMediumSoftLongScore factory: {factory}")


def java_string_literal_text(value: str) -> str:
    parts = re.findall(r'"((?:\\.|[^"\\])*)"', value, flags=re.DOTALL)
    return "".join(part.replace(r"\"", '"') for part in parts)


def constraint_source_path(engine_root: Path) -> Path:
    return engine_root / (
        "src/main/java/one/rewind/xforce/vehicle_routing/solver/"
        "RoutePlanConstraintConfiguration.java"
    )


def extract_engine_constraints(engine_root: Path) -> list[dict]:
    path = constraint_source_path(engine_root)
    if not path.exists():
        return []
    source = path.read_text(encoding="utf-8")
    pattern = re.compile(
        r"@ConstraintWeight\([^)]*\)\s*"
        r"(?:@Schema\((?P<schema>.*?)\)\s*)?"
        r"private\s+HardMediumSoftLongScore\s+(?P<field>\w+)\s*=\s*"
        r"HardMediumSoftLongScore\.of(?P<factory>Hard|Medium|Soft)\((?P<amount>-?\d+)\)\s*;",
        flags=re.DOTALL,
    )
    constraints = []
    for match in pattern.finditer(source):
        schema_text = match.group("schema") or ""
        name_match = re.search(r"name\s*=\s*\"((?:\\.|[^\"\\])*)\"", schema_text, flags=re.DOTALL)
        desc_match = re.search(
            r"description\s*=\s*(?P<value>.*?)(?:,\s*\w+\s*=|\s*$)",
            schema_text,
            flags=re.DOTALL,
        )
        key = camel_to_snake(match.group("field"))
        constraints.append(
            {
                "key": key,
                "default": score_text(match.group("factory"), match.group("amount")),
                "title": java_string_literal_text(name_match.group(0)) if name_match else key,
                "description": java_string_literal_text(desc_match.group("value")) if desc_match else "",
            }
        )
    return constraints


def fallback_constraints() -> list[dict]:
    return [
        {
            "key": "agent_capacity",
            "default": "1hard/0medium/0soft",
            "title": "车辆装载容量限制",
            "description": "agent 装载不能超过其设计上限，相关字段：agent.weight、agent.vol。默认惩罚：1 Hard。",
        },
        {
            "key": "agent_max_ticket",
            "default": "1hard/0medium/0soft",
            "title": "最大接单",
            "description": "agent 最大接单量不应大于设置值，相关字段：agent.max_ticket_num。默认惩罚：1 Hard。",
        },
        {
            "key": "agent_skills_accord_with_ticket_skills",
            "default": "1hard/0medium/0soft",
            "title": "标签匹配",
            "description": "所指派 agent 的标签应包含 ticket 所需标签，相关字段：agent.skills、ticket.skills_required。默认惩罚：1 Hard。",
        },
        {
            "key": "agent_qualification_levels_match_ticket",
            "default": "0hard/100medium/0soft",
            "title": "需求技能等级匹配",
            "description": "agent 等级应满足 ticket 要求等级，相关字段：agent.qualification_levels、ticket.qualification_levels_required。默认惩罚：100 Medium。",
        },
        {
            "key": "ref_ticket_after_dep_ticket",
            "default": "0hard/0medium/0soft",
            "title": "工单时序因果依赖",
            "description": "下一级 ticket 的完成时间必须晚于上级 ticket，相关字段：ticket.dep_tickets、ticket.ref_tickets。默认未启用。",
        },
        {
            "key": "ref_ticket_same_agent_with_dep_ticket",
            "default": "0hard/0medium/0soft",
            "title": "工单工程师依赖",
            "description": "下一级 ticket 与上级 ticket 必须分配给同一 agent，相关字段：ticket.dep_tickets、ticket.ref_tickets、ticket.agent_id。默认未启用。",
        },
        {
            "key": "service_finished_after_max_end_time",
            "default": "0hard/0medium/0soft",
            "title": "工单截止时间",
            "description": "ticket 完成不能晚于最后截止时间，相关字段：ticket.max_end_time。默认未启用。",
        },
        {
            "key": "ticket_start_service_time_match_expected",
            "default": "0hard/0medium/100soft",
            "title": "时间窗约束",
            "description": "ticket 应在客户预期时间上门，相关字段：ticket.min_start_time、ticket.max_end_time。默认惩罚：100 Soft（每分钟）。",
        },
        {
            "key": "ticket_arrival_time_same_date_with_plan_time",
            "default": "1hard/0medium/0soft",
            "title": "当日指派",
            "description": "ticket 必须在当日指派工程师，相关字段：ticket.create_time。默认惩罚：1 Hard。",
        },
        {
            "key": "relation_tickets_same_agent",
            "default": "0hard/50medium/0soft",
            "title": "关联工单相同指派",
            "description": "ticket 与其关联 ticket 尽量派发给相同工程师，相关字段：ticket.relation_tickets。默认惩罚：50 Medium。",
        },
        {
            "key": "minimize_travel_time",
            "default": "0hard/0medium/1soft",
            "title": "最小行驶时间",
            "description": "所有 agent 的总在途时间尽可能小。默认惩罚：1 Soft。",
        },
        {
            "key": "minimize_travel_distance",
            "default": "0hard/0medium/0soft",
            "title": "最小行驶距离",
            "description": "所有 agent 的总在途里程尽可能小。默认未启用。",
        },
        {
            "key": "minimize_agent_fixed_cost",
            "default": "0hard/0medium/20soft",
            "title": "最小固定成本",
            "description": "总固定成本最小。默认惩罚：20 Soft。",
        },
        {
            "key": "same_depo",
            "default": "1hard/0medium/0soft",
            "title": "工单工程师同网点",
            "description": "ticket 只能指派给同网点 agent，相关字段：agent.depo_id、ticket.depo_id。默认惩罚：1 Hard。",
        },
        {
            "key": "balance_agent_loading",
            "default": "0hard/1medium/0soft",
            "title": "工单负载均衡",
            "description": "分配给每个 agent 的 ticket 数应尽量均衡，相关字段：agent.tickets。默认惩罚：1 Medium。",
        },
        {
            "key": "balance_agent_loading_ratio",
            "default": "0hard/0medium/0soft",
            "title": "负载比例均衡",
            "description": "每个 agent 的有效载荷使用比例应尽量均衡。默认未启用。",
        },
        {
            "key": "balance_agent_working_time",
            "default": "0hard/0medium/0soft",
            "title": "工作时长负载均衡",
            "description": "每个 agent 的预期工作时长应尽量均衡。默认未启用。",
        },
        {
            "key": "minimize_ticket_changing",
            "default": "0hard/0medium/1000soft",
            "title": "最小工单变更",
            "description": "尽量不要改派已经分配的工单。默认惩罚：1000 Soft。",
        },
        {
            "key": "agent_is_virtual",
            "default": "0hard/1000medium/0soft",
            "title": "虚拟工程师",
            "description": "超约束优化时使用，用于权衡未指派工单与其他约束违背。默认惩罚：1000 Medium。",
        },
    ]


def constraint_config(max_orders: int, max_vehicles: int) -> dict:
    return constraint_config_from_constraints(fallback_constraints(), max_orders, max_vehicles)


def constraint_config_from_constraints(constraints: list[dict], max_orders: int, max_vehicles: int) -> dict:
    return {
        "defaults": {"name": "default", **{item["key"]: item["default"] for item in constraints}},
        "overridable": {
            item["key"]: score_rule(item["title"], item["description"] or item["key"])
            for item in constraints
        },
        "score_format": {
            "type": "hard_medium_soft_long",
            "pattern": "Nhard/Nmedium/Nsoft",
            "example": "0hard/100medium/0soft",
        },
        "platform_limits": {
            "max_orders": max_orders,
            "max_vehicles": max_vehicles,
        },
    }


def image_version_yaml(
    image_name: str,
    version: str,
    display_name: str,
    description: str,
    max_orders: int,
    max_vehicles: int,
    supported_map_providers: list[str],
) -> str:
    limits = json.dumps(
        {"platform_max_orders": max_orders, "platform_max_vehicles": max_vehicles},
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return "\n".join(
        [
            "image:",
            f"  name: {image_name}",
            f"  version: {version}",
            f"display_name: {display_name}",
            f"description: {description}",
            "supported_map_providers:",
            *[f"  - {provider}" for provider in supported_map_providers],
            "base_credit_cost: 10.0000",
            "duration_credit_per_10s: 2.5000",
            f"limits_json: '{limits}'",
            "request_schema_source:",
            "  type: openapi",
            "  file: docs/openapi.yaml",
            "  operation_id: putScenario",
            "  request_content_type: application/json",
            "",
        ]
    )


def write_text(path: Path, content: str, force: bool) -> None:
    if path.exists() and not force:
        raise SystemExit(f"{path} already exists; pass --force to overwrite")
    path.write_text(content, encoding="utf-8")


def write_json(path: Path, value: dict, force: bool) -> None:
    write_text(path, json.dumps(value, ensure_ascii=False, indent=2) + "\n", force)


def validate_enum_metadata(value: object, path: str = "$") -> None:
    if isinstance(value, list):
        for index, item in enumerate(value):
            validate_enum_metadata(item, f"{path}[{index}]")
        return
    if not isinstance(value, dict):
        return

    enum_values = value.get("enum")
    if isinstance(enum_values, list):
        title = value.get("title")
        description = value.get("description")
        if not isinstance(title, str) or not title.strip():
            raise ValueError(f"{path} enum 缺少中文 title")
        if not isinstance(description, str) or not description.strip():
            raise ValueError(f"{path} enum 缺少中文名称和业务说明")
        missing_values = [
            "null" if item is None else str(item)
            for item in enum_values
            if ("null" if item is None else str(item)) not in description
        ]
        if missing_values:
            raise ValueError(f"{path} enum description 未说明机器值: {', '.join(missing_values)}")

    for key, item in value.items():
        validate_enum_metadata(item, f"{path}.{key}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--image-name",
        required=True,
        help="Gateway Registry image_name exactly as synced, e.g. x-force/vrp-0; do not pass only vrp-0 when Gateway stores x-force/vrp-0",
    )
    parser.add_argument("--version", required=True, help="Image version, e.g. 1.0.0")
    parser.add_argument("--output-dir", default="gateway", help="Metadata output directory")
    parser.add_argument("--display-name", default="VRP0 Solver")
    parser.add_argument("--description", default="Vehicle routing solver metadata for VRP0")
    parser.add_argument("--max-orders", type=int, default=1000)
    parser.add_argument("--max-vehicles", type=int, default=200)
    parser.add_argument(
        "--supported-map-providers",
        nargs="+",
        default=["AMAP", "HERE"],
        metavar="PROVIDER",
        help="Image-level map-provider capabilities. Allowed values: AMAP HERE.",
    )
    parser.add_argument(
        "--engine-root",
        type=Path,
        default=Path.cwd(),
        help="VRP0 engine repository root. Defaults to the current working directory.",
    )
    parser.add_argument(
        "--require-engine-source",
        action="store_true",
        help="Fail if RoutePlanConstraintConfiguration.java cannot be parsed from --engine-root.",
    )
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    supported_map_providers = []
    for provider in args.supported_map_providers:
        normalized = provider.strip().upper()
        if normalized not in {"AMAP", "HERE"}:
            raise SystemExit("--supported-map-providers only accepts AMAP or HERE")
        if normalized not in supported_map_providers:
            supported_map_providers.append(normalized)
    if not supported_map_providers:
        raise SystemExit("--supported-map-providers must not be empty")

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    write_text(
        output_dir / "image-version.yaml",
        image_version_yaml(
            args.image_name,
            args.version,
            args.display_name,
            args.description,
            args.max_orders,
            args.max_vehicles,
            supported_map_providers,
        ),
        args.force,
    )
    constraints = extract_engine_constraints(args.engine_root)
    if not constraints and args.require_engine_source:
        raise SystemExit(f"Unable to parse engine constraints from {constraint_source_path(args.engine_root)}")

    generated_request_schema = request_schema()
    validate_enum_metadata(generated_request_schema)
    write_json(output_dir / "request-schema.json", generated_request_schema, args.force)
    write_json(output_dir / "result-summary-schema.json", result_summary_schema(), args.force)
    write_json(
        output_dir / "constraint-config.yaml",
        constraint_config_from_constraints(constraints or fallback_constraints(), args.max_orders, args.max_vehicles),
        args.force,
    )


if __name__ == "__main__":
    main()
