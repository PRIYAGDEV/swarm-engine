import { EventEmitter } from "node:events";
import { SwarmState, ChannelMeta, BoardMessage, BoardMessageControl } from "./state.js";
export type { ChannelMeta, BoardMessage, BoardMessageControl };
export declare const MAIN_CHANNEL = "main";
export declare const ALL_CHANNELS = "*";
export type ChannelControlMessage = BoardMessageControl;
export interface PostMessageOptions {
    text: string;
    from?: string;
    to?: string[];
    channel?: string;
    control?: ChannelControlMessage;
}
export interface ReadBoardOptions {
    since?: number;
    channel?: string;
    limit?: number;
    status?: boolean;
    memberName?: string;
    member?: string;
}
export interface SwarmWaitOptions {
    memberName?: string;
    member?: string;
    since?: number;
    channel?: string;
    mentionsOnly?: boolean;
    mentions_only?: boolean;
    timeoutMs?: number;
}
export interface ParsedMentions {
    raw: string[];
    names: string[];
    channels: string[];
    isAll: boolean;
}
export declare const CHANNEL_NAME_REGEX: RegExp;
export declare const RESERVED_CHANNELS: Set<string>;
export declare function namedToken(lowerText: string, lowerName: string): boolean;
export declare function named(lowerText: string, lowerName: string): boolean;
export declare function channelMentions(text: string): string[];
export declare function parseMentions(text: string): ParsedMentions;
export declare function isMentioned(text: string, memberName: string, memberChannels?: string[], active?: (channel: string) => boolean): boolean;
export declare function effectiveChannels(role: string | undefined, assignedChannels: string[] | undefined, name?: string): string[];
export declare function getMemberChannels(state: SwarmState | undefined, memberName: string, channelFilter?: string): string[];
export declare function seesIn(name: string, channels: string[], msg: BoardMessage, active?: (channel: string) => boolean): boolean;
export declare const countsUnread: (msg: BoardMessage) => boolean;
export declare function getBoardPath(swarmDir?: string): string;
export declare function parseBoardLog(text: string): BoardMessage[];
export declare function readBoardMessages(swarmDir?: string): Promise<BoardMessage[]>;
export declare function recoverBoardLog(swarmDir?: string): Promise<BoardMessage[]>;
export declare class BoardEventBus extends EventEmitter {
    emitPost(swarmDir: string, message: BoardMessage): void;
    onPost(handler: (event: {
        swarmDir: string;
        message: BoardMessage;
    }) => void): () => void;
}
export declare const boardEventBus: BoardEventBus;
export declare function postMessage(stateOrDir: SwarmState | string, swarmDirOrOpts: string | PostMessageOptions, maybeOpts?: PostMessageOptions): Promise<BoardMessage>;
export declare function readBoard(stateOrDir?: SwarmState | string, swarmDirOrOpts?: string | ReadBoardOptions, maybeOpts?: ReadBoardOptions): Promise<{
    messages: BoardMessage[];
    headSeq: number;
    members?: Record<string, any>;
    roster?: Record<string, any>;
    channels?: ChannelMeta[];
}>;
export declare function swarmWait(stateOrDir?: SwarmState | string, swarmDirOrOpts?: string | SwarmWaitOptions, maybeOpts?: SwarmWaitOptions): Promise<{
    messages: BoardMessage[];
    headSeq: number;
    timedOut: boolean;
}>;
