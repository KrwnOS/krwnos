/**
 * Public surface of the chat UI. Import from here instead of individual
 * component files — lets us swap internals freely.
 */

export { ChatPanel } from "./ChatPanel";
export { ChatSidebar } from "./ChatSidebar";
export { ChatWindow } from "./ChatWindow";
export { DirectiveBadge } from "./DirectiveBadge";
export { MarkdownText } from "./markdown";
export { useChat, groupChannels } from "./useChat";
export type { UseChatReturn, ChatApiError, ChatIdentity } from "./useChat";
