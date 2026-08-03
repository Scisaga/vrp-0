package one.rewind.xforce.scenarios.scenarios_aux.vrp_20250527;

import io.quarkus.test.junit.QuarkusTest;
import one.rewind.amap.AmapAdapter;
import one.rewind.amap.RateLimitExecutor;
import one.rewind.xforce.geo.POI;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.io.FileInputStream;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeoutException;

/**
 * @author Yang Zhongwei
 * @date 2025/5/27
 * @description
 */
@QuarkusTest
@Tag("external")
public class AddressSearchTest {

    @BeforeAll
    static void requireExternalTestsEnabled() {
        one.rewind.xforce.test.support.ExternalTestSupport.requireExternalTestsEnabled();
    }

    private String path = "scenarios/scenarios_aux/vrp_20250527/";
    private String filename = "地址问题(奥克斯).xlsx";
    private String city = "浙江省";

    /**
     * 地址问题(奥克斯).xlsx 搜索结果
     * <p>
     * Address: 浙江省宁波市北仑区大碶街道瓶壶北苑26栋18号
     * POI: B023E078GD 瓶壶北苑 宁波市北仑区大碶街道西河塘, 121.770143,29.879038
     * Excel原因：地址完全正确
     * 搜索结果：正确
     * <p>
     * Address: 浙江省宁波市余姚市兰江街道余姚市兰江街道郭相桥农贸市场对面的幸福公寓 18067183769
     * POI: BZA1QX009N 街路江路 宁波市余姚市余姚市, 121.083684,30.055275
     * Excel原因：同一区域有两处幸福公寓，返回了错误的一处幸福公寓，为高德地图 AI 处理逻辑的问题
     * 搜索结果：有疑问
     * <p>
     * Address: 浙江省宁波市宁海县桃源街道庐山巷18栋
     * POI: B0IA3PGHK1 桃源街 宁波市鄞州区鄞州区, 121.557250,29.848956
     * 搜索结果：有疑问
     * <p>
     * Address: 浙江省宁波市宁海县桃源街道
     * POI: B023E0Y3SC 宁海县 宁波市宁海县宁海县, 121.429729,29.287929
     * 搜索结果：有疑问
     * <p>
     * Address: 浙江省 宁波市 宁海县 茶院镇   茶苑镇【重单】】
     * POI: B023E076II 宁海县茶院镇中心小学 宁波市宁海县茶院乡茶院村, 121.570107,29.310399
     * Excel原因：搜索切分问题，未切分出两个乡镇
     * 搜索结果：正确，字符串匹配成功生效
     * <p>
     * Address: 浙江省宁波市海曙区石碶街道余姚市千丈坑村
     * POI: B0FFL5FFU6 千丈坑农庄地面停车场 宁波市余姚市南雷村372号千丈坑农庄, 121.217626,29.984249
     * Excel原因：搜索地址不规范，同时出现了“宁波市”和“余姚市”两个市
     * 搜索结果：正确，字符串匹配成功生效
     * <p>
     * Address: 浙江省宁波市余姚市泗门镇浙江宁波市余姚市泗门镇泗门镇夹塘村江西路18号（13858211568）
     * POI: B0I3HC8AIF 余姚市泗门凯佳电器厂 宁波市余姚市泗门镇夹塘村江西路25号, 121.013006,30.183707
     * Excel原因：高德地图召回策略问题，从多个搜索结果中返回了错误结果。高德预计 7 月份修复
     * 搜索结果：近似
     * <p>
     * Address: 浙江省宁波市海曙区集士港镇三江购物
     * POI: B0ID6Z022W 三江购物(葑水港店) 宁波市海曙区古林镇葑水港段梅公路52号76号1层, 121.471240,29.831664
     * Excel原因：同一区域有多处三江购物，返回了错误结果，高德暂时无解决排期，涉及到 AI 大模型调整
     * 正确地址：浙江省宁波市海曙区集士港镇集仕港镇春华路928号集仕港杰迈广场三江购物(集仕港杰迈广场店)
     * 搜索结果：错误，遇到了相同问题
     * <p>
     * Address: 浙江宁波市海曙区古林镇宁波市鄞州区古林镇蜃蛟村蜃蛟8组24号
     * POI: B0G3LUIOQ1 古林镇蜃蛟村文化礼堂 宁波市海曙区宁波市海曙区古林镇蜃蛟村文化礼堂, 121.406775,29.815023
     * 搜索结果：近似
     *
     * @throws Exception
     */
    @Test
    public void addressSearchTest() throws Exception {
        Sheet excelSheet = getExcelSheet(path, filename);

        Map<String, POI> addressAndPoi = new HashMap<>();
        for (int i = 1; i <= excelSheet.getLastRowNum(); i++) {
            String address = excelSheet.getRow(i).getCell(3).getStringCellValue();
            POI poi = this.poi(address);
            addressAndPoi.put(address, poi);
            if (poi.isNoWhere()) {
                System.out.println("NoWhere: " + address);
            }
        }

        System.out.println("-----------------------------------------------------");
        for (Map.Entry<String, POI> addressAndPoiEntry : addressAndPoi.entrySet()) {
            String address = addressAndPoiEntry.getKey();
            POI poi = addressAndPoiEntry.getValue();
            System.out.println("Address: " + address);
            System.out.println("POI: " + poi + ", " + poi.location);
        }
    }

    private Sheet getExcelSheet(String path, String filename) throws IOException {
        // 获取 Excel 文件对象
        FileInputStream file = new FileInputStream(path + filename);
        Workbook workbook = new XSSFWorkbook(file);
        return workbook.getSheetAt(0);
    }

    /**
     * POI search error
     * 浙江省宁波市余姚市兰江街道余姚市兰江街道郭相桥农贸市场对面的幸福公寓 18067183769
     * 浙江省 宁波市 宁海县 茶院镇   茶苑镇【重单】】
     *
     * @param address
     * @return
     */
    private POI poi(String address) {
        try {
            return AmapAdapter.get().query(city, address);
        } catch (IOException |
                 RateLimitExecutor.QuotaExhaustedException |
                 ExecutionException |
                 InterruptedException |
                 TimeoutException e) {
            System.out.println("POI search error: " + e.getMessage() + ". address: " + address);
            return POI.NoWhere;
        }
    }

    @Test
    public void searchTest() throws Exception {
        // 问题1：addr_1 地址被错误的解析为了 浙江省宁波市余姚市兰江街道余姚市兰江街道郭相桥农贸市场对面的幸福公寓 18067183769号楼
        // 问题2：18067183769 手机号被判定为了楼宇信息，导致后续 AddressUtil 112~138 行逻辑执行，导致反而更远离了正确地址
        // 个人认为解决方案：地址处理，正则表达式去除手机号
//        System.out.println("---1: " + AmapAdapter.get().query(city, "浙江省宁波市余姚市兰江街道余姚市兰江街道郭相桥农贸市场对面的幸福公寓 18067183769"));  //BZA1QX009N 街路江路 宁波市余姚市余姚市, 121.083684,30.055275

        // 返回了 20 个 suggestion 最终根据字符串相似度选择了 B0IA3PGHK1 桃源街 宁波市鄞州区鄞州区
        // 但肉眼看上去有更符合的地址：B0HAHZGFZP 天奇图文广告 宁波市宁海县桃源街道庐山巷28弄8号; B0K2UH25E6 庐山巷30弄35号 宁波市宁海县桃源街道庐山巷; B0J101M2X8 驿收发快递驿站(时代东路店) 宁波市宁海县桃源街道庐山巷30弄8号 等等
        // 没用过相似度算法，但是我个人认为是否要用 poi.address 去计算相似度，而不是 poi.name
        // 例如高德返回的 20 个 suggesstion 的首选是 B0HAHZGFZP 天奇图文广告 宁波市宁海县桃源街道庐山巷28弄8号, name 与搜索的 address 毫无关联但是地址却比较接近
//        System.out.println("---2" + AmapAdapter.get().query(city, "浙江省宁波市宁海县桃源街道庐山巷18栋"));

        // 问题同上，返回了 20 个 suggestion 但肉眼看上去有更符合的地址：B023E035VS 桃源街道办事处(竹口路) 宁波市宁海县科二路189号
//        System.out.println("---3" + AmapAdapter.get().query(city, "浙江省宁波市宁海县桃源街道"));


        System.out.println("---4" + AmapAdapter.get().query(city, "浙江省 宁波市 宁海县 茶院镇   茶苑镇【重单】】"));
    }
}
