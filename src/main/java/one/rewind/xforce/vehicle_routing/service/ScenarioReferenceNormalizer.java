package one.rewind.xforce.vehicle_routing.service;

import one.rewind.xforce.geo.POI;
import one.rewind.xforce.vehicle_routing.db.dto.Scenario;
import one.rewind.xforce.vehicle_routing.domain.RoutePlan;
import one.rewind.xforce.vehicle_routing.domain.agent.AgentEachDay;
import one.rewind.xforce.vehicle_routing.domain.agent.Depo;
import one.rewind.xforce.vehicle_routing.domain.ticket.Ticket;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

public final class ScenarioReferenceNormalizer {

    private ScenarioReferenceNormalizer() {}

    public static Scenario normalize(Scenario scenario) {
        if (scenario == null || scenario.getPlan() == null) {
            return scenario;
        }

        RoutePlan plan = scenario.getPlan();

        LinkedHashMap<String, POI> poiById = new LinkedHashMap<>();
        LinkedHashMap<String, AgentEachDay> agentById = new LinkedHashMap<>();
        LinkedHashMap<String, Ticket> ticketById = new LinkedHashMap<>();

        registerPois(plan, poiById);
        registerAgents(plan, agentById);
        registerTickets(plan, ticketById);

        rewritePlan(plan, poiById, agentById, ticketById);
        return scenario;
    }

    private static void registerPois(RoutePlan plan, Map<String, POI> poiById) {
        for (POI poi : safeList(plan.getPois())) {
            registerPoi(poiById, poi);
        }
        for (Depo depo : safeList(plan.getDepos())) {
            registerPoi(poiById, depo == null ? null : depo.getLoc());
        }
        for (AgentEachDay agent : safeList(plan.getAgents())) {
            registerPoi(poiById, agent == null ? null : agent.getStartLoc());
        }
        for (Ticket ticket : safeList(plan.getTickets())) {
            registerPoi(poiById, ticket == null ? null : ticket.getLoc());
        }
    }

    private static void registerAgents(RoutePlan plan, Map<String, AgentEachDay> agentById) {
        for (AgentEachDay agent : safeList(plan.getAgents())) {
            registerAgent(agentById, agent);
        }
        for (Ticket ticket : safeList(plan.getTickets())) {
            if (ticket == null) {
                continue;
            }
            registerAgent(agentById, ticket.getAgent());
            registerAgent(agentById, ticket.getOriginalAgent());
        }
    }

    private static void registerTickets(RoutePlan plan, Map<String, Ticket> ticketById) {
        for (Ticket ticket : safeList(plan.getTickets())) {
            registerTicket(ticketById, ticket);
        }
        for (AgentEachDay agent : safeList(plan.getAgents())) {
            if (agent == null) {
                continue;
            }
            for (Ticket ticket : safeList(agent.getTickets())) {
                registerTicket(ticketById, ticket);
            }
        }
        for (Ticket ticket : safeList(plan.getTickets())) {
            if (ticket == null) {
                continue;
            }
            for (Ticket dep : safeList(ticket.getDepTickets())) {
                registerTicket(ticketById, dep);
            }
            for (Ticket ref : safeList(ticket.getRefTickets())) {
                registerTicket(ticketById, ref);
            }
            registerTicket(ticketById, ticket.getPreviousTicket());
            registerTicket(ticketById, ticket.getNextTicket());
        }
    }

    private static void rewritePlan(
            RoutePlan plan,
            Map<String, POI> poiById,
            Map<String, AgentEachDay> agentById,
            Map<String, Ticket> ticketById
    ) {
        plan.setPois(orderedCanonicalPois(plan.getPois(), poiById));

        List<Depo> depos = plan.getDepos();
        if (depos != null) {
            for (Depo depo : depos) {
                if (depo != null) {
                    depo.setLoc(canonicalPoi(depo.getLoc(), poiById));
                }
            }
        }

        List<AgentEachDay> agents = orderedCanonicalAgents(plan.getAgents(), agentById);
        for (AgentEachDay agent : agents) {
            agent.setStartLoc(canonicalPoi(agent.getStartLoc(), poiById));
            agent.setTickets(orderedCanonicalTickets(agent.getTickets(), ticketById));
        }
        plan.setAgents(agents);

        List<Ticket> tickets = orderedCanonicalTickets(plan.getTickets(), ticketById);
        for (Ticket ticket : tickets) {
            ticket.setLoc(canonicalPoi(ticket.getLoc(), poiById));
            ticket.setDepTickets(orderedCanonicalTickets(ticket.getDepTickets(), ticketById));
            ticket.setRefTickets(orderedCanonicalTickets(ticket.getRefTickets(), ticketById));
            ticket.setAgent(canonicalAgent(ticket.getAgent(), agentById));
            ticket.setOriginalAgent(canonicalAgent(ticket.getOriginalAgent(), agentById));
            ticket.setPreviousTicket(canonicalTicket(ticket.getPreviousTicket(), ticketById));
            ticket.setNextTicket(canonicalTicket(ticket.getNextTicket(), ticketById));
        }
        plan.setTickets(tickets);
    }

    private static List<POI> orderedCanonicalPois(List<POI> pois, Map<String, POI> poiById) {
        LinkedHashSet<String> seen = new LinkedHashSet<>();
        List<POI> result = new ArrayList<>();

        for (POI poi : safeList(pois)) {
            POI canonical = canonicalPoi(poi, poiById);
            if (canonical == null) {
                continue;
            }
            if (blank(canonical.getId())) {
                result.add(canonical);
                continue;
            }
            if (seen.add(canonical.getId())) {
                result.add(canonical);
            }
        }

        for (Map.Entry<String, POI> entry : poiById.entrySet()) {
            if (seen.add(entry.getKey())) {
                result.add(entry.getValue());
            }
        }
        return result;
    }

    private static void registerPoi(Map<String, POI> poiById, POI candidate) {
        if (candidate == null || blank(candidate.getId())) {
            return;
        }
        POI current = poiById.get(candidate.getId());
        if (current == null) {
            poiById.put(candidate.getId(), candidate);
            return;
        }
        mergePoi(current, candidate);
    }

    private static void registerAgent(Map<String, AgentEachDay> agentById, AgentEachDay candidate) {
        if (candidate == null || blank(candidate.getId())) {
            return;
        }
        AgentEachDay current = agentById.get(candidate.getId());
        if (current == null) {
            agentById.put(candidate.getId(), candidate);
            return;
        }
        mergeAgent(current, candidate);
    }

    private static void registerTicket(Map<String, Ticket> ticketById, Ticket candidate) {
        if (candidate == null || blank(candidate.getId())) {
            return;
        }
        Ticket current = ticketById.get(candidate.getId());
        if (current == null) {
            ticketById.put(candidate.getId(), candidate);
            return;
        }
        mergeTicket(current, candidate);
    }

    private static POI canonicalPoi(POI poi, Map<String, POI> poiById) {
        if (poi == null || blank(poi.getId())) {
            return poi;
        }
        return poiById.getOrDefault(poi.getId(), poi);
    }

    private static AgentEachDay canonicalAgent(AgentEachDay agent, Map<String, AgentEachDay> agentById) {
        if (agent == null || blank(agent.getId())) {
            return agent;
        }
        return agentById.getOrDefault(agent.getId(), agent);
    }

    private static Ticket canonicalTicket(Ticket ticket, Map<String, Ticket> ticketById) {
        if (ticket == null || blank(ticket.getId())) {
            return ticket;
        }
        return ticketById.getOrDefault(ticket.getId(), ticket);
    }

    private static List<AgentEachDay> orderedCanonicalAgents(List<AgentEachDay> agents, Map<String, AgentEachDay> agentById) {
        LinkedHashSet<String> seen = new LinkedHashSet<>();
        List<AgentEachDay> result = new ArrayList<>();

        for (AgentEachDay agent : safeList(agents)) {
            AgentEachDay canonical = canonicalAgent(agent, agentById);
            if (canonical == null) {
                continue;
            }
            if (blank(canonical.getId())) {
                result.add(canonical);
                continue;
            }
            if (seen.add(canonical.getId())) {
                result.add(canonical);
            }
        }

        for (Map.Entry<String, AgentEachDay> entry : agentById.entrySet()) {
            if (seen.add(entry.getKey())) {
                result.add(entry.getValue());
            }
        }
        return result;
    }

    private static List<Ticket> orderedCanonicalTickets(List<Ticket> tickets, Map<String, Ticket> ticketById) {
        LinkedHashSet<String> seen = new LinkedHashSet<>();
        List<Ticket> result = new ArrayList<>();

        for (Ticket ticket : safeList(tickets)) {
            Ticket canonical = canonicalTicket(ticket, ticketById);
            if (canonical == null) {
                continue;
            }
            if (blank(canonical.getId())) {
                result.add(canonical);
                continue;
            }
            if (seen.add(canonical.getId())) {
                result.add(canonical);
            }
        }
        return result;
    }

    private static void mergePoi(POI target, POI source) {
        target.name = preferText(target.name, source.name);
        target.location = preferText(target.location, source.location);
        target.loc = target.loc != null ? target.loc : source.loc;
        target.address = preferText(target.address, source.address);
        target.pcode = preferText(target.pcode, source.pcode);
        target.type = preferText(target.type, source.type);
        target.photos = safeList(target.photos).isEmpty() ? source.photos : target.photos;
        target.gridcode = preferText(target.gridcode, source.gridcode);
        target.typecode = preferText(target.typecode, source.typecode);
        target.citycode = preferText(target.citycode, source.citycode);
        target.adname = preferText(target.adname, source.adname);
        target.entr_location = preferText(target.entr_location, source.entr_location);
        target.entr_loc = target.entr_loc != null ? target.entr_loc : source.entr_loc;
        target.adcode = preferText(target.adcode, source.adcode);
        target.pname = preferText(target.pname, source.pname);
        target.cityname = preferText(target.cityname, source.cityname);
    }

    private static void mergeAgent(AgentEachDay target, AgentEachDay source) {
        target.setName(preferText(target.getName(), source.getName()));
        target.setDepoId(preferText(target.getDepoId(), source.getDepoId()));
        target.setStartLoc(target.getStartLoc() != null ? target.getStartLoc() : source.getStartLoc());
        target.setSkills(safeList(target.getSkills()).isEmpty() ? source.getSkills() : target.getSkills());
        target.setQualificationLevels(safeMap(target.getQualificationLevels()).isEmpty() ? source.getQualificationLevels() : target.getQualificationLevels());
        target.setVehicleType(target.getVehicleType() != null ? target.getVehicleType() : source.getVehicleType());
        target.setFuelType(target.getFuelType() != null ? target.getFuelType() : source.getFuelType());
        target.setFuelConsumption(preferNumber(target.getFuelConsumption(), source.getFuelConsumption()));
        target.setRented(target.isRented() || source.isRented());
        target.setFixCostDaily(preferNumber(target.getFixCostDaily(), source.getFixCostDaily()));
        target.setSize((int) preferNumber(target.getSize(), source.getSize()));
        target.setHeight(preferNumber(target.getHeight(), source.getHeight()));
        target.setWidth(preferNumber(target.getWidth(), source.getWidth()));
        target.setWeight(preferNumber(target.getWeight(), source.getWeight()));
        target.setVol(preferNumber(target.getVol(), source.getVol()));
        target.setDate(target.getDate() != null ? target.getDate() : source.getDate());
        target.setRestrict(target.isRestrict() || source.isRestrict());
        target.setMaxTicketNum((int) preferNumber(target.getMaxTicketNum(), source.getMaxTicketNum()));
        target.setShiftStartTime(target.getShiftStartTime() != null ? target.getShiftStartTime() : source.getShiftStartTime());
        target.setShiftOffTime(target.getShiftOffTime() != null ? target.getShiftOffTime() : source.getShiftOffTime());
        target.setVirtual(target.isVirtual() || source.isVirtual());
        target.setTickets(safeList(target.getTickets()).isEmpty() ? source.getTickets() : target.getTickets());
    }

    private static void mergeTicket(Ticket target, Ticket source) {
        target.setDepoId(preferText(target.getDepoId(), source.getDepoId()));
        target.setPinned(target.isPinned() || source.isPinned());
        target.setType(target.getType() != null ? target.getType() : source.getType());
        target.setQualificationLevelsRequired(safeMap(target.getQualificationLevelsRequired()).isEmpty()
                ? source.getQualificationLevelsRequired()
                : target.getQualificationLevelsRequired());
        target.setStatus(target.getStatus() != null ? target.getStatus() : source.getStatus());
        target.setSkillsRequired(safeList(target.getSkillsRequired()).isEmpty() ? source.getSkillsRequired() : target.getSkillsRequired());
        target.setDepTickets(safeList(target.getDepTickets()).isEmpty() ? source.getDepTickets() : target.getDepTickets());
        target.setRefTickets(safeList(target.getRefTickets()).isEmpty() ? source.getRefTickets() : target.getRefTickets());
        target.setItems(safeList(target.getItems()).isEmpty() ? source.getItems() : target.getItems());
        target.setWeight((float) preferNumber(target.getWeight(), source.getWeight()));
        target.setVol((float) preferNumber(target.getVol(), source.getVol()));
        target.setLoc(target.getLoc() != null ? target.getLoc() : source.getLoc());
        target.setCreateTime(target.getCreateTime() != null ? target.getCreateTime() : source.getCreateTime());
        target.setMinStartTime(target.getMinStartTime() != null ? target.getMinStartTime() : source.getMinStartTime());
        target.setMaxEndTime(target.getMaxEndTime() != null ? target.getMaxEndTime() : source.getMaxEndTime());
        target.setDuration(target.getDuration() != null ? target.getDuration() : source.getDuration());
        target.setAgent(target.getAgent() != null ? target.getAgent() : source.getAgent());
        target.setOriginalAgent(target.getOriginalAgent() != null ? target.getOriginalAgent() : source.getOriginalAgent());
        target.setPreviousTicket(target.getPreviousTicket() != null ? target.getPreviousTicket() : source.getPreviousTicket());
        target.setNextTicket(target.getNextTicket() != null ? target.getNextTicket() : source.getNextTicket());
        target.setArrivalTime(target.getArrivalTime() != null ? target.getArrivalTime() : source.getArrivalTime());
        target.setReassignTime(target.getReassignTime() != null ? target.getReassignTime() : source.getReassignTime());
        target.setCancelTime(target.getCancelTime() != null ? target.getCancelTime() : source.getCancelTime());
    }

    private static double preferNumber(double current, double candidate) {
        return current != 0D ? current : candidate;
    }

    private static String preferText(String current, String candidate) {
        return blank(current) ? candidate : current;
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }

    private static <T> List<T> safeList(List<T> values) {
        return values == null ? List.of() : values;
    }

    private static <K, V> Map<K, V> safeMap(Map<K, V> values) {
        return values == null ? Map.of() : values;
    }
}
