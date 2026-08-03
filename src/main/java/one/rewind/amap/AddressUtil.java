package one.rewind.amap;

import info.debatty.java.stringsimilarity.Cosine;
import info.debatty.java.stringsimilarity.NGram;
import one.rewind.xforce.geo.POI;
import one.rewind.xforce.json.OM;
import org.apache.commons.lang3.StringUtils;
import org.apache.commons.lang3.tuple.ImmutablePair;
import org.apache.commons.lang3.tuple.Pair;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import java.io.IOException;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeoutException;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

public class AddressUtil {

    public final static Logger logger = LogManager.getLogger(AddressUtil.class.getName());

    /**
     *
     * @param city
     * @param addr
     * @param inquirer
     * @return
     * @throws IOException
     * @throws RateLimitExecutor.QuotaExhaustedException
     * @throws ExecutionException
     * @throws InterruptedException
     * @throws TimeoutException
     */
    public static POI guessBestPOI(String city, String addr, POIInquirer inquirer) throws IOException, RateLimitExecutor.QuotaExhaustedException, ExecutionException, InterruptedException, TimeoutException {

        // 命名捕获组正则匹配，去除单元房间信息，加标准量词，作为搜索词
        String addr_0 = clearAddrCellAndRoomInfo(addr);
        boolean buildingQuantifier = hasBuildingQuantifier(addr_0);
        String addr_1 = addr_0.matches(".+?[0-9一二三四五六七八九十]+$") ? addr_0 + "号楼" : addr_0.matches(".+?[A-Z]$") ? addr_0 + "座" : addr_0;

        List<POI> suggestion = inquirer.query(city, addr_1);
        if (suggestion == null || suggestion.isEmpty()) {
            return POI.NoWhere;
        }

        NGram ngram = new NGram(3);
        Cosine cosine = new Cosine(3);
        info.debatty.java.stringsimilarity.MetricLCS lcs =
                new info.debatty.java.stringsimilarity.MetricLCS();

        POI poi = suggestion.stream()
                .map(p -> {

                    if(addr_1.contains(p.name)) return new ImmutablePair<>(0D, p);

                    String str = lcs.distance(addr_1, p.name) > 0.8 ? p.name + " " + p.address : p.name;

                    var v1 = lcs.distance(addr_1, str);
                    var v2 = ngram.distance(addr_1, str);
                    var v3 = cosine.distance(addr_1, str);
                    logger.info("{}\t{}\t{}\t{}\t{}", addr_1, str, v1, v2, v3);
                    return new ImmutablePair<>(v1 + v2 + v3, p);
                })
                .min(Map.Entry.comparingByKey())
                .map(Pair::getValue)
                .orElse(POI.NoWhere);

        if(poi.isNoWhere()) return poi;

        String buildingNumber = getBuildingNumber(addr_1);

        // 返回结果中存在条目，楼宇数词与搜索词相同，返回搜索结果
        if(poi.name.contains(buildingNumber) || poi.address.contains(buildingNumber)) {
            logger.info("Match building number {}", buildingNumber);
            return poi;
        }
        // 地址楼宇量词替换
        else {

            String mostCommonQuantifier = getMostCommonQuantifier(suggestion.stream().map(p -> p.name).collect(Collectors.toList()));

            if(StringUtils.isNoneBlank(mostCommonQuantifier) && ! buildingQuantifier) {

                String addr_2 = clearAddrCellAndRoomInfo(addr) + mostCommonQuantifier;

                logger.info("Switch building quantifier --> {}", addr_2);

                poi = inquirer.query(city, addr_2).stream()
                        .map(p -> {

                            if(addr_2.contains(p.name)) return new ImmutablePair<>(0D, p);

                            String str = lcs.distance(addr_2, p.name) > 0.8 ? p.name + " " + p.address : p.name;

                            var v1 = lcs.distance(addr_2, str);
                            var v2 = ngram.distance(addr_2, str);
                            var v3 = cosine.distance(addr_2, str);
                            logger.info("{}\t{}\t{}\t{}\t{}", addr_2, str, v1, v2, v3);
                            return new ImmutablePair<>(v1 + v2 + v3, p);

                        })
                        .min(Map.Entry.comparingByKey())
                        .map(Pair::getValue)
                        .orElse(POI.NoWhere);

            }
        }

        // 字符串最优匹配的条目中楼宇数词与搜索词仍不相同
        if(!getBuildingNumber(poi.name).equals(buildingNumber) && StringUtils.isNoneBlank(buildingNumber) && !poi.name.equals("查无此处")) {

            logger.info("Building number no match case {} {}", buildingNumber, poi.name);
            if(hasBuildingQuantifier(poi.address)) {

                String addr_3 = poi.address.replaceAll(getBuildingNumber(poi.address), buildingNumber);

                logger.info("Switch building number --> {}", addr_3);

                poi = inquirer.query(city, addr_3).stream()
                        .map(p -> {

                            if(addr_3.replaceAll("[号楼栋座幢]$", "").contains(p.name.replaceAll("[号楼栋座幢]$", ""))) return new ImmutablePair<>(0D, p);

                            String str = lcs.distance(addr_3, p.name) > 0.8 ? p.name + " " + p.address : p.name;

                            var v1 = lcs.distance(addr_3, str);
                            var v2 = ngram.distance(addr_3, str);
                            var v3 = cosine.distance(addr_3, str);
                            logger.info("{}\t{}\t{}\t{}\t{}", addr_3, str, v1, v2, v3);
                            return new ImmutablePair<>(v1 + v2 + v3, p);
                        })
                        .min(Map.Entry.comparingByKey())
                        .map(Pair::getValue)
                        .orElse(POI.NoWhere);
            }
        }

        return poi;
    }

    /**
     * 清理地址中的单元和门牌号信息
     * @param addr 原始地址
     * @return 清洗结果
     */
    public static String clearAddrCellAndRoomInfo(String addr) {

        String reg = "(?<A>([A-Z]|[A-Z]?[0-9]+|[一二三四五六七八九十]+)(号(增\\d+号)|号楼|楼|栋|座|幢|-)).+?$";

        return addr.replaceAll(reg, "").replaceAll("（.+?）", "") + firstMatch(addr, reg, "A").replaceAll("-$", "");
    }

    /**
     * 获取地址中的楼宇量词
     * @param addr 原始地址
     * @return 楼宇量词
     */
    public static boolean hasBuildingQuantifier(String addr) {
        String reg = ".+?[号楼栋座幢]$";
        return addr.matches(reg);
    }

    /**
     * 获取地址中的楼宇编号
     * @param addr 原始地址
     * @return 楼宇编号
     */
    public static String getBuildingNumber(String addr) {
        String reg = "(?<A>[A-Z]|[0-9]+|[一二三四五六七八九十]+)号?[号楼栋座幢]?$";
        return firstMatch(addr, reg, "A");
    }

    /**
     * 获取第一个匹配结果
     * @param addr 地址
     * @param reg 正则表达式
     * @param group 匹配组名称
     * @return 匹配结果
     */
    public static String firstMatch(String addr, String reg, String group) {
        Pattern p = Pattern.compile(reg);
        Matcher m = p.matcher(addr);
        String no = "";
        while (m.find()) {
            no = m.group(group);
        }
        return no;
    }

    /**
     * 获取地址列表中最常见的楼宇量词
     * @param addr_list 地址列表
     * @return 最常见楼宇量词
     */
    public static String getMostCommonQuantifier(List<String> addr_list) {

        String reg = ".+?(?<A>号?[楼栋座幢])$";
        return addr_list.stream().map(addr -> firstMatch(addr, reg, "A"))
                .filter(StringUtils::isNoneBlank)
                .collect(Collectors.groupingBy(i -> i, Collectors.counting()))
                .entrySet().stream()
                .sorted(Collections.reverseOrder(Map.Entry.comparingByValue()))
                .map(Map.Entry::getKey)
                .findFirst().orElse("");
    }
}
