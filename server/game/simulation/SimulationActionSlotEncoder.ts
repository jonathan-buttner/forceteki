import type { SimulationActionSlot, SimulationDecisionSnapshot, SimulationLegalDecision } from './SimulationTypes';

export const simulationNumDistinctActions = 4096;

export class SimulationActionSlotEncoder {
    public encode(snapshot: SimulationDecisionSnapshot): {
        slots: SimulationActionSlot[];
        decisionsByActionId: Map<number, SimulationLegalDecision>;
    } {
        const sortedDecisions = [...snapshot.legalDecisions].sort((a, b) =>
            this.stableDecisionKey(a).localeCompare(this.stableDecisionKey(b))
        );

        if (sortedDecisions.length > simulationNumDistinctActions) {
            const prompt = snapshot.state.players[snapshot.playerId]?.prompt ?? {};
            throw new Error(
                `Simulation legal action overflow: ${sortedDecisions.length} decisions exceeds ` +
                `${simulationNumDistinctActions}. Prompt metadata: ${JSON.stringify(prompt)}`
            );
        }

        const decisionsByActionId = new Map<number, SimulationLegalDecision>();
        const slots = sortedDecisions.map((decision, actionId) => {
            decisionsByActionId.set(actionId, decision);
            return {
                actionId,
                decisionId: decision.id,
                label: decision.label,
            };
        });

        return { slots, decisionsByActionId };
    }

    private stableDecisionKey(decision: SimulationLegalDecision): string {
        return JSON.stringify({
            kind: decision.kind,
            id: decision.id,
            label: decision.label,
            rawDecision: decision.rawDecision,
        });
    }
}
