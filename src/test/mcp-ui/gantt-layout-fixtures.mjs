import { message } from './host-fixture.mjs';

/** Synthetic Gantt profiles only; never read tasks or credentials. */
export function ganttLayoutResult(definitions) {
  const result = message('gantt-ready');
  const plan = result._meta.gateway_ui.engine_view.solver_job.plan;
  const original = plan.agents[0], tickets = plan.tickets;
  plan.agents = []; plan.tickets = [];
  for (const [index, definition] of definitions.entries()) {
    const agent = {...structuredClone(original), ...definition,
      id:definition.id || `layout-engineer-${index}`, tickets:[]};
    const date = agent.date || original.date;
    for (const key of ['shift_start_time','shift_off_time','tickets_done_time']) {
      if (agent[key]) agent[key] = agent[key].replace(original.date, date);
    }
    for (const [slot, source] of tickets.entries()) {
      const ticket = {...structuredClone(source),id:`${agent.id}-ticket-${slot}`,agent:agent.id};
      for (const key of ['min_start_time','max_end_time','arrival_time','start_service_time','departure_time']) {
        if (ticket[key]) ticket[key] = ticket[key].replace(original.date, date);
      }
      agent.tickets.push(ticket.id); plan.tickets.push(ticket);
    }
    plan.agents.push(agent);
  }
  return result;
}
