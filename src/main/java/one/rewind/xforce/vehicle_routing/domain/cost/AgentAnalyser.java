package one.rewind.xforce.vehicle_routing.domain.cost;

import one.rewind.xforce.vehicle_routing.bootstrap.SKUSupplier;
import one.rewind.xforce.vehicle_routing.domain.agent.Agent;
import one.rewind.xforce.vehicle_routing.domain.agent.AgentEachDay;
import one.rewind.xforce.vehicle_routing.domain.ticket.Ticket;
import org.apache.commons.math3.stat.descriptive.moment.StandardDeviation;

import java.text.DecimalFormat;
import java.util.Collection;
import java.util.LinkedList;
import java.util.List;

public class AgentAnalyser {

    private static DecimalFormat df = new DecimalFormat("##.0");

    public record AgentStat(
            String id,
            Agent.VehicleType type,
            double drivingKM,
            double drivingHour,

            double loadRatio,
            long items
    ){
        public String toString() {
            return id + "(" + type + ")\t" + items + "\t" + df.format(drivingKM) + "km\t" + df.format(drivingHour) + "h\t"
                    + df.format(100* (1 - loadRatio)) + "%";
        }
    }

    List<AgentStat> stats = new LinkedList<>();

    public int activeAgentNum;

    public long itemTotalNum;

    public double totalDrivingKM;

    public double totalDrivingHour;

    public double avgDrivingKM;

    public double avgDrivingHour;

    public double stdDrivingKM;

    public double stdDrivingHour;

    public double loadRatio;

    public AgentAnalyser(List<AgentEachDay> agents) {

        for(var a : agents) {

            if(!a.getTickets().isEmpty()) {
                activeAgentNum ++;

                long items = a.getTickets().stream().map(Ticket::getItems).flatMap(Collection::stream)
                        .map(SKUSupplier.Item::value).mapToLong(Long::longValue).sum();
                if(items == 0) items = a.getTickets().size();

                /*Agent.Capacity c = a.getTickets().stream().filter(t -> t.getType() == Ticket.Type.Delv)
                        .map(t -> new Agent.Capacity(t.getWeight(), t.getVol()))
                        .reduce(new Agent.Capacity(0, 0), Agent.Capacity::add);*/

                var stat = new AgentStat(
                        a.getName(),
                        a.getVehicleType(),
                        (double) a.getTotalDrivingDistanceMeters() / 1000,
                        (double) a.getTotalDrivingTimeSeconds() / 3600,
                        0.5 * (a.getTransitVol() / a.getVol() + a.getTransitWeight() / a.getWeight() ),
                        items
                );

                stats.add(stat);

                itemTotalNum += items;
                totalDrivingHour += stat.drivingHour;
                totalDrivingKM += stat.drivingKM;
            }
        }

        avgDrivingHour = totalDrivingHour / activeAgentNum;
        avgDrivingKM = totalDrivingKM / activeAgentNum;

        StandardDeviation sd = new StandardDeviation(false);
        stdDrivingKM = sd.evaluate(stats.stream().map(s -> s.drivingKM).mapToDouble(x -> x).toArray());
        stdDrivingHour = sd.evaluate(stats.stream().map(s -> s.drivingHour).mapToDouble(x -> x).toArray());

        loadRatio = stats.stream().map(s -> s.loadRatio).mapToDouble(x -> x).average().orElse(1);
    }

    public String toString() {

        String output = "";
        for(AgentStat as : stats) {
            output += as.toString() + "\n";
        }

        output += "Active agent num: " + activeAgentNum + ", items: " + itemTotalNum + ", no load ratio: " + df.format(100* (1 - loadRatio)) + "%\n";
        output += "Driving distance total: " + df.format(totalDrivingKM) + "km, avg: " + df.format(avgDrivingKM) + "km, std: " + df.format(stdDrivingKM) + "\n";
        output += "Driving duration total: " + df.format(totalDrivingHour) + "h,  avg: " + df.format(avgDrivingHour) + "h,  std: " + df.format(stdDrivingHour);

        return output;
    }
}
