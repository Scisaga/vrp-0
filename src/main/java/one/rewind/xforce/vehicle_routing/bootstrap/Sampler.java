package one.rewind.xforce.vehicle_routing.bootstrap;

import java.util.*;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

public class Sampler {

    /**
     * 随机采样
     * @param distribution 帆布
     * @return 采样结果
     * @param <T> 类型
     */
    public static <T> T sample(LinkedHashMap<T, Double> distribution) {
        Random rand = new Random();
        double v = rand.nextDouble();

        for(T t : distribution.keySet()) {
            v = v - distribution.get(t);
            if(v <= 0) return t;
        }

        return distribution.lastEntry().getKey();
    }

    /**
     * 随机采样N次
     * @param distribution 分布
     * @param n 采样次数
     * @return 采样结果
     * @param <T> 类型
     */
    public static <T> List<T> sample(LinkedHashMap<T, Double> distribution, int n) {

        return IntStream.range(0, n).boxed().map(i -> sample(distribution)).collect(Collectors.toList());
    }

    /**
     * 随机采样N次（平均分布）
     * @param list 待选列表
     * @param n 采样次数
     * @return 采样结果
     * @param <T> 类型
     */
    public static <T> List<T> sample(List<T> list, int n) {

        var list_ = new LinkedList<>(list);
        Collections.shuffle(list_);

        return list_.subList(0, Math.min(n, list.size()));
    }

    /**
     * bound以内自然数随机采样N次
     * @param n 采样次数
     * @param bound 最大值
     * @return 采样结果
     */
    public static List<Integer> sample(int n, int bound) {
        Random rand = new Random();
        return IntStream.range(0, n).boxed().map(i -> rand.nextInt(bound)).collect(Collectors.toList());
    }
}
