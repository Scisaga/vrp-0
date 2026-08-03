package one.rewind.xforce.vehicle_routing.domain.cost;

import one.rewind.xforce.vehicle_routing.bootstrap.SKUSupplier;
import one.rewind.xforce.vehicle_routing.domain.ticket.Ticket;

import java.text.DecimalFormat;
import java.time.Duration;
import java.util.List;

import static one.rewind.xforce.vehicle_routing.domain.cost.CostParameter.df;

/**
 *
 */
public class ItemDelayAnalyser {

    public long itemTotalNum;

    public long itemDelayNum;

    public Duration totalDelayDuration = Duration.ZERO;

    public double aveDelayMinutes;

    public ItemDelayAnalyser(List<Ticket> tickets) {

        tickets.forEach(t -> {

            var items = t.getItems().stream().map(SKUSupplier.Item::value).mapToLong(Long::longValue).sum();
            if(items == 0) items = 1;

            itemTotalNum += items;

            if(t.getArrivalTime().isAfter(t.getMaxEndTime())) {
                Duration delay = Duration.between(t.getMaxEndTime(), t.getArrivalTime());
                totalDelayDuration = totalDelayDuration.plus(delay.multipliedBy(items));
                itemDelayNum += items;
            }
        });

        aveDelayMinutes = itemDelayNum == 0 ? 0 : (double) totalDelayDuration.toMinutes() / itemDelayNum;
    }

    public String toString() {
        return "Total items: " + itemTotalNum + ", Delay items: " + itemDelayNum
                + ", Total delay time: " + totalDelayDuration.toHours() + " h, Ave delay time: " + df.format(aveDelayMinutes)+ " m.";
    }
}
