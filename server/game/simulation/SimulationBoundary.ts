import type { Game } from '../core/Game';
import type { SimulationDecisionSnapshot } from './SimulationTypes';
import { SimulationActionApplier } from './SimulationActionApplier';
import { SimulationLegalDecisionExporter } from './SimulationLegalDecisionExporter';
import { SimulationStateEncoder } from './SimulationStateEncoder';

export class SimulationBoundary {
    public constructor(
        private readonly stateEncoder = new SimulationStateEncoder(),
        private readonly decisionExporter = new SimulationLegalDecisionExporter(),
        private readonly actionApplier = new SimulationActionApplier()
    ) {}

    public buildNextDecisionSnapshot(game: Game): SimulationDecisionSnapshot {
        const { playerId, legalDecisions } = this.decisionExporter.exportForNextActionablePlayer(game);
        return {
            playerId,
            state: this.stateEncoder.encode(game),
            legalDecisions,
        };
    }

    public applyDecision(game: Game, decision: Parameters<SimulationActionApplier['apply']>[1]): void {
        this.actionApplier.apply(game, decision);
    }
}
