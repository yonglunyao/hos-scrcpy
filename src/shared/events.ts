/**
 * 领域事件系统 — 基于 Node.js EventEmitter
 *
 * 提供轻量级的进程内事件发布/订阅机制，用于解耦模块间通信。
 */

import { EventEmitter } from 'events';

export interface DomainEvent {
  type: string;
  timestamp: Date;
  payload: unknown;
}

export type DomainEventHandler<T = unknown> = (event: DomainEvent & { payload: T }) => void;

export class DomainEventBus extends EventEmitter {
  publish(event: DomainEvent): void {
    this.emit(event.type, event);
  }

  subscribe<T = unknown>(
    eventType: string,
    handler: DomainEventHandler<T>,
  ): () => void {
    this.on(eventType, handler as (...args: unknown[]) => void);
    return () => this.off(eventType, handler as (...args: unknown[]) => void);
  }
}
