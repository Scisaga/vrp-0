package one.rewind.xforce.geo;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import one.rewind.xforce.json.OM;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collections;
import java.util.LinkedList;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * POI仓库 随机生成测试用
 */
public class POIStore {

    public Map<String, POI> poi_map;

    /**
     * 反序列化
     * @param json JSON格式序列化文档
     */
    public POIStore(String json) throws JsonProcessingException {
        poi_map = load(json).stream().collect(Collectors.toMap(POI::getId, Function.identity(), (ov, nv) -> nv));
    }

    /**
     * @param json "data/pois.json"
     * @return POI列表
     */
    private List<POI> load(String json) throws JsonProcessingException {

        try {
            String content = Files.readString(Path.of(json), StandardCharsets.UTF_8);
            return OM.fromJson(
                    content,
                    new TypeReference<List<POI>>(){});
        } catch (IOException e) {
            throw new RuntimeException("Error read POI store from " + json, e);
        }
    }

    /**
     * 从Store中选择N个POI
     * @param n 选择数量
     * @return 选取的POI列表，结果数量可能小于N
     */
    public List<POI> select(int n) {

        return select(n, new LinkedList<>());
    }


    /**
     * 排程特定POI，从Store中选择N个POI
     * @param n 选择数量
     * @param no_select_pois 需要排除的POI列表
     * @return 选取的POI列表，结果数量可能小于N
     */
    public List<POI> select(int n, List<POI> no_select_pois) {

        var no_select_ids = no_select_pois.stream().map(i -> i.id).collect(Collectors.toSet());

        var list = poi_map.entrySet().stream().filter(en -> !no_select_ids.contains(en.getKey())).collect(Collectors.toList());

        Collections.shuffle(list);

        return list.stream()
                .map(Map.Entry::getValue)
                .collect(Collectors.toList())
                .subList(0, Math.min(n, list.size()));
    }

    /**
     * 随机选一个
     * @return POI对象
     */
    public POI select() {
        return select(1).getFirst();
    }

    /**
     * 排除后随机选一个
     * @param no_select_pois 需要排除的POI列表
     * @return POI对象
     */
    public POI select(List<POI> no_select_pois) {
        return select(1, no_select_pois).getFirst();
    }

}
