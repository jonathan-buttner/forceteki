import type { ISerializedMessage } from '../Interfaces';
import type { MsgArg } from '../core/chat/GameChat';

export class BoundedSimulationGameChat {
    public readonly messages: ISerializedMessage[] = [];
    public readonly typingState: Record<string, boolean> = {};

    public constructor(private readonly maxMessages = 0) {}

    public addChatMessage(player: { name?: string; username?: string; id?: string }, message: string): void {
        this.addMessage('{0} {1}', player.name ?? player.username ?? player.id ?? 'player', message);
    }

    public addMessage(message: string, ...args: MsgArg[]): void {
        this.pushMessage({ date: new Date(), message: this.formatMessage(message, args) });
    }

    public addAlert(type: string, message: string, ...args: MsgArg[]): void {
        this.pushMessage({ date: new Date(), message: { alert: { type, message: this.formatMessage(message, args) } } });
    }

    public setTypingState(userId: string, isTyping: boolean): void {
        this.typingState[userId] = isTyping;
    }

    private pushMessage(message: ISerializedMessage): void {
        if (this.maxMessages <= 0) {
            return;
        }

        this.messages.push(message);
        if (this.messages.length > this.maxMessages) {
            this.messages.splice(0, this.messages.length - this.maxMessages);
        }
    }

    private formatMessage(format: string, args: MsgArg[]): string {
        return format.replace(/\{(\d+)\}/g, (_match, index) => this.formatArg(args[Number(index)]));
    }

    private formatArg(arg: MsgArg): string {
        if (arg == null) {
            return '';
        }

        if (Array.isArray(arg)) {
            return arg.map((entry) => this.formatArg(entry)).filter(Boolean).join(', ');
        }

        if (typeof arg === 'object') {
            if ('getShortSummary' in arg && typeof arg.getShortSummary === 'function') {
                const summary = arg.getShortSummary();
                return typeof summary === 'string' ? summary : JSON.stringify(summary);
            }
            if ('name' in arg && typeof arg.name === 'string') {
                return arg.name;
            }
            if ('message' in arg) {
                return Array.isArray(arg.message) ? arg.message.join('') : String(arg.message);
            }
            if ('format' in arg && Array.isArray(arg.args)) {
                return this.formatMessage(arg.format, arg.args);
            }
        }

        return String(arg);
    }
}
