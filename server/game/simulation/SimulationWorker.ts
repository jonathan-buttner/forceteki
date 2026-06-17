import { createInterface } from 'readline';
import { stdin as input, stdout as output, stderr } from 'process';
import { SimulationEnvironment } from './SimulationEnvironment';

interface WorkerRequest {
    seq: number;
    op: string;
    params?: Record<string, unknown>;
}

const environment = new SimulationEnvironment();

async function handleRequest(request: WorkerRequest): Promise<unknown> {
    switch (request.op) {
        case 'reset':
            return await environment.reset(request.params ?? {});
        case 'step':
            return environment.step(Number(request.params?.action));
        case 'get_state':
            return environment.getState();
        case 'export_checkpoint':
            return environment.exportCheckpoint();
        case 'restore_checkpoint':
            return await environment.restoreCheckpoint(request.params?.checkpoint as any);
        case 'clone_from_checkpoint':
            return await environment.restoreCheckpoint(request.params?.checkpoint as any);
        case 'close':
            environment.close();
            return { closed: true };
        default:
            throw new Error(`Unknown simulation worker op '${request.op}'`);
    }
}

const lines = createInterface({ input, crlfDelay: Infinity });
let requestQueue = Promise.resolve();

lines.on('line', (line) => {
    requestQueue = requestQueue.then(async () => {
        let request: WorkerRequest | null = null;

        try {
            request = JSON.parse(line);
            const result = await handleRequest(request);
            output.write(`${JSON.stringify({ seq: request.seq, ok: true, result })}\n`);
        } catch (error) {
            const seq = typeof request?.seq === 'number' ? request.seq : null;
            const message = error instanceof Error ? error.stack ?? error.message : String(error);
            output.write(`${JSON.stringify({ seq, ok: false, error: message })}\n`);
        }
    });
});

lines.on('close', () => {
    environment.close();
});

process.on('uncaughtException', (error) => {
    stderr.write(`${error.stack ?? error.message}\n`);
    process.exit(1);
});
