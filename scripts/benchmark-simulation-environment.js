const { performance } = require('perf_hooks');
const { SimulationEnvironment } = require('../build/server/game/simulation/SimulationEnvironment');

const games = Number(process.argv[2] ?? 10);
const maxSteps = Number(process.argv[3] ?? 500);

function chooseRandom(values) {
    return values[Math.floor(Math.random() * values.length)];
}

(async () => {
    let steps = 0;
    let terminalGames = 0;
    const startedAt = performance.now();

    for (let gameIndex = 0; gameIndex < games; gameIndex++) {
        const environment = new SimulationEnvironment();
        let state = await environment.reset({
            seed: `benchmark-${gameIndex}`,
            preselectedFirstPlayerId: gameIndex % 2 === 0 ? 'player-0' : 'player-1',
        });

        for (let step = 0; step < maxSteps && !state.isTerminal; step++) {
            state = environment.step(chooseRandom(state.legalActions));
            steps++;
        }

        if (state.isTerminal) {
            terminalGames++;
        }

        environment.close();
    }

    const elapsedSeconds = (performance.now() - startedAt) / 1000;
    console.log(JSON.stringify({
        games,
        maxSteps,
        steps,
        terminalGames,
        elapsedSeconds,
        envStepsPerSecond: steps / elapsedSeconds,
        terminalGamesPerSecond: terminalGames / elapsedSeconds,
    }, null, 2));
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
