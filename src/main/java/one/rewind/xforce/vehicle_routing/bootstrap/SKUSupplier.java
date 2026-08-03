package one.rewind.xforce.vehicle_routing.bootstrap;

import com.fasterxml.jackson.annotation.JsonIdentityReference;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import io.quarkus.runtime.annotations.RegisterForReflection;
import one.rewind.xforce.geo.POI;
import one.rewind.xforce.vehicle_routing.domain.ticket.SKU;
import one.rewind.xforce.vehicle_routing.domain.ticket.Ticket;
import org.apache.commons.math3.distribution.UniformRealDistribution;
import org.eclipse.microprofile.openapi.annotations.enums.SchemaType;
import org.eclipse.microprofile.openapi.annotations.media.Schema;

import java.io.Serializable;
import java.time.Duration;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.LinkedList;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.function.Supplier;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

import static one.rewind.xforce.vehicle_routing.bootstrap.Sampler.sample;


/**
 * SKU定义
 */
public class SKUSupplier implements Supplier<List<SKUSupplier.Item>> {

    // SKU定义及分布
    static LinkedHashMap<SKU, Double> sku_distribution = new LinkedHashMap<>(Map.of(
            new SKU("sku-1", "SKU-1", 0.25f, 0.05f), 0.25,
            new SKU("sku-2", "SKU-2", 0.5f, 0.15f), 0.25,
            new SKU("sku-3", "SKU-3", 1f, 0.25f), 0.25,
            new SKU("sku-4", "SKU-4", 2f, 0.4f), 0.25
    ));

    // 单笔工单SKU数量定义
    static LinkedHashMap<Integer, Double> ticket_sku_number_distribution = new LinkedHashMap<>(Map.of(
            1, 0.25,
            2, 0.25,
            3, 0.25,
            4, 0.25
    ));

    static UniformRealDistribution weight_ud = new UniformRealDistribution(0.1, 5);

    boolean enable_sku = true;

    public SKUSupplier() {}

    public SKUSupplier(boolean enable_sku) {
        this.enable_sku = enable_sku;
    }

    @Override
    public List<Item> get() {

        Integer sku_num = sample(ticket_sku_number_distribution);
        return IntStream.range(0, sku_num).boxed()
                .map(v -> sample(sku_distribution))
                .collect(Collectors.groupingBy(Function.identity(), Collectors.counting()))
                .entrySet()
                .stream().map(en -> new Item(en.getKey(), en.getValue()))
                .collect(Collectors.toList());
    }

    /**
     *
     * @param items
     * @return
     */
    public static WeightAndVol estimateWeightAndVol(List<Item> items) {

        float weight, vol;

        if(items == null || items.isEmpty()) {
            weight = (float) weight_ud.sample();
            vol = weight * 1.75f;
        }
        else {
            // 计算总重量体积
            weight = items.stream()
                    .map(i -> i.sku.weight * i.value)
                    .reduce(0F, Float::sum);

            vol = items.stream()
                    .map(i -> i.sku.vol * i.value)
                    .reduce(0F, Float::sum);
        }

        return new WeightAndVol(weight, vol);
    }

    /**
     *
     * @param weight
     * @param vol
     */
    public record WeightAndVol(float weight, float vol) {}

    /**
     *
     * @param sku
     * @param value
     */
    @RegisterForReflection(serialization = true)
    public record Item(

            @JsonIdentityReference(alwaysAsId = true)
            @Schema(
                    description = "SKU ID",
                    type = SchemaType.STRING,
                    implementation = String.class,
                    example = "sku-1"
            )
            SKU sku,
            long value
    ) implements Serializable {
    }

}
