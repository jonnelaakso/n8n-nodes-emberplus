// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports
import { EmberClient } from 'emberplus-connection';
import {
	EmberPlusError,
	EmberPlusErrorCode,
	createConnectionError,
	createTimeoutError,
	createNotConnectedError,
	createPathNotFoundError,
	createInvalidPathError,
	createOperationError,
	getErrorMessage,
} from './errors';
import { createLogger, EmberPlusLogger } from './logger';
import { validatePath } from './pathUtils';

export interface EmberPlusResult<T = unknown> {
	success: boolean;
	data?: T;
	error?: string;
	errorCode?: EmberPlusErrorCode;
}

export interface EmberNodeInfo {
	path: string;
	identifier?: string;
	description?: string;
	type: 'node' | 'parameter' | 'function' | 'matrix';
	value?: unknown;
	children?: EmberNodeInfo[];
}

export interface EmberPlusClientOptions {
	timeout?: number;
	logger?: EmberPlusLogger;
	autoReconnect?: boolean;
	maxReconnectAttempts?: number;
}

export type SubscriptionCallback = (value: unknown, path: string) => void;

const DEFAULT_TIMEOUT = 5000;
const DEFAULT_OPERATION_TIMEOUT = 10000;

export class EmberPlusClient {
	private client: EmberClient;
	private readonly host: string;
	private readonly port: number;
	private readonly timeout: number;
	private readonly logger: EmberPlusLogger;
	private connected: boolean = false;
	private connecting: boolean = false;
	private subscriptions: Map<string, SubscriptionCallback> = new Map();

	constructor(host: string, port: number, options: EmberPlusClientOptions = {}) {
		this.host = host;
		this.port = port;
		this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
		this.logger = options.logger ?? createLogger('Client');

		this.logger.debug('Creating EmberPlusClient', { host, port, timeout: this.timeout });

		this.client = new EmberClient(host, port);
		this.setupEventHandlers();
	}

	private setupEventHandlers(): void {
		this.client.on('error', (error: Error) => {
			this.logger.error('Connection error', error, { host: this.host, port: this.port });
		});

		this.client.on('disconnected', () => {
			this.connected = false;
			this.connecting = false;
			this.logger.warn('Disconnected from device', { host: this.host, port: this.port });
		});

		this.client.on('connected', () => {
			this.connected = true;
			this.connecting = false;
			this.logger.info('Connected to device', { host: this.host, port: this.port });
		});
	}

	async connect(): Promise<EmberPlusResult<void>> {
		this.logger.operationStart('connect', { host: this.host, port: this.port });

		if (this.connected) {
			this.logger.debug('Already connected');
			return { success: true };
		}

		if (this.connecting) {
			this.logger.warn('Connection already in progress');
			return { success: false, error: 'Connection already in progress' };
		}

		this.connecting = true;

		try {
			const connectPromise = this.client.connect();
			const timeoutPromise = new Promise<never>((_, reject) => {
				// eslint-disable-next-line @n8n/community-nodes/no-restricted-globals
				setTimeout(() => {
					reject(createTimeoutError(this.host, this.port, this.timeout));
				}, this.timeout);
			});

			await Promise.race([connectPromise, timeoutPromise]);
			this.connected = true;
			this.connecting = false;

			this.logger.operationSuccess('connect', { host: this.host, port: this.port });
			return { success: true };
		} catch (error) {
			this.connecting = false;
			this.connected = false;

			if (error instanceof EmberPlusError) {
				this.logger.operationFailed('connect', error);
				return { success: false, error: error.message, errorCode: error.code };
			}

			const connectionError = createConnectionError(
				this.host,
				this.port,
				error instanceof Error ? error : undefined,
			);
			this.logger.operationFailed('connect', connectionError);
			return { success: false, error: connectionError.message, errorCode: connectionError.code };
		}
	}

	async disconnect(): Promise<EmberPlusResult<void>> {
		this.logger.operationStart('disconnect');

		if (!this.connected && !this.connecting) {
			this.logger.debug('Already disconnected');
			return { success: true };
		}

		try {
			await this.client.disconnect();
			this.connected = false;
			this.connecting = false;
			this.subscriptions.clear();

			this.logger.operationSuccess('disconnect');
			return { success: true };
		} catch (error) {
			// Force state reset even on error
			this.connected = false;
			this.connecting = false;
			this.subscriptions.clear();

			this.logger.operationFailed('disconnect', error);
			return {
				success: false,
				error: getErrorMessage(error),
				errorCode: EmberPlusErrorCode.DISCONNECTION_FAILED,
			};
		}
	}

	async browse(pathOrNode?: string): Promise<EmberPlusResult<EmberNodeInfo[]>> {
		const operationPath = pathOrNode || '/';
		this.logger.operationStart('browse', { path: operationPath });

		const connectionCheck = this.ensureConnected();
		if (!connectionCheck.success) {
			return connectionCheck as EmberPlusResult<EmberNodeInfo[]>;
		}

		if (pathOrNode) {
			const pathValidation = this.validatePathInput(pathOrNode);
			if (!pathValidation.success) {
				return pathValidation as EmberPlusResult<EmberNodeInfo[]>;
			}
		}

		try {
			let node;
			if (pathOrNode) {
				node = await this.withTimeout(
					this.client.getElementByPath(pathOrNode),
					DEFAULT_OPERATION_TIMEOUT,
					`browse path "${pathOrNode}"`,
				);
				if (!node) {
					const error = createPathNotFoundError(pathOrNode);
					this.logger.operationFailed('browse', error);
					return { success: false, error: error.message, errorCode: error.code };
				}
			} else {
				node = this.client.tree;
			}

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const req = await this.client.getDirectory(node as any);
			const responsePromise = req.response;
			if (responsePromise) {
				await this.withTimeout(responsePromise, DEFAULT_OPERATION_TIMEOUT, 'getDirectory response');
			}

			const children = this.extractNodeInfo(node);
			this.logger.operationSuccess('browse', { path: operationPath, nodeCount: children.length });
			return { success: true, data: children };
		} catch (error) {
			return this.handleOperationError('browse', pathOrNode || '/', error) as EmberPlusResult<EmberNodeInfo[]>;
		}
	}

	async get(path: string): Promise<EmberPlusResult<unknown>> {
		this.logger.operationStart('get', { path });

		const connectionCheck = this.ensureConnected();
		if (!connectionCheck.success) {
			return connectionCheck;
		}

		const pathValidation = this.validatePathInput(path);
		if (!pathValidation.success) {
			return pathValidation;
		}

		try {
			const node = await this.withTimeout(
				this.client.getElementByPath(path),
				DEFAULT_OPERATION_TIMEOUT,
				`get path "${path}"`,
			);

			if (!node) {
				const error = createPathNotFoundError(path);
				this.logger.operationFailed('get', error);
				return { success: false, error: error.message, errorCode: error.code };
			}

			const contents = node.contents;
			if (contents && 'value' in contents) {
				this.logger.operationSuccess('get', { path, valueType: typeof contents.value });
				return { success: true, data: contents.value };
			}

			const nodeInfo = this.nodeToInfo(node, path);
			this.logger.operationSuccess('get', { path, type: nodeInfo?.type });
			return { success: true, data: nodeInfo };
		} catch (error) {
			return this.handleOperationError('get', path, error);
		}
	}

	async set(path: string, value: unknown): Promise<EmberPlusResult<void>> {
		this.logger.operationStart('set', { path, valueType: typeof value });

		const connectionCheck = this.ensureConnected();
		if (!connectionCheck.success) {
			return connectionCheck as EmberPlusResult<void>;
		}

		const pathValidation = this.validatePathInput(path);
		if (!pathValidation.success) {
			return pathValidation as EmberPlusResult<void>;
		}

		try {
			const node = await this.withTimeout(
				this.client.getElementByPath(path),
				DEFAULT_OPERATION_TIMEOUT,
				`set path "${path}"`,
			);

			if (!node) {
				const error = createPathNotFoundError(path);
				this.logger.operationFailed('set', error);
				return { success: false, error: error.message, errorCode: error.code };
			}

			// Verify node is a parameter (has value)
			const contents = node.contents;
			if (!contents || !('value' in contents)) {
				const error = new EmberPlusError(`Path "${path}" is not a parameter and cannot be set`, {
					code: EmberPlusErrorCode.INVALID_PATH,
					path,
				});
				this.logger.operationFailed('set', error);
				return { success: false, error: error.message, errorCode: error.code };
			}

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const req = await this.client.setValue(node as any, value as any);
			const responsePromise = req.response;
			if (responsePromise) {
				await this.withTimeout(responsePromise, DEFAULT_OPERATION_TIMEOUT, 'setValue response');
			}

			this.logger.operationSuccess('set', { path, value });
			return { success: true };
		} catch (error) {
			return this.handleOperationError('set', path, error) as EmberPlusResult<void>;
		}
	}

	async subscribe(path: string, callback: SubscriptionCallback): Promise<EmberPlusResult<void>> {
		this.logger.operationStart('subscribe', { path });

		const connectionCheck = this.ensureConnected();
		if (!connectionCheck.success) {
			return connectionCheck as EmberPlusResult<void>;
		}

		const pathValidation = this.validatePathInput(path);
		if (!pathValidation.success) {
			return pathValidation as EmberPlusResult<void>;
		}

		try {
			const node = await this.withTimeout(
				this.client.getElementByPath(path),
				DEFAULT_OPERATION_TIMEOUT,
				`subscribe path "${path}"`,
			);

			if (!node) {
				const error = createPathNotFoundError(path);
				this.logger.operationFailed('subscribe', error);
				return { success: false, error: error.message, errorCode: error.code };
			}

			// Store callback for this path
			this.subscriptions.set(path, callback);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			await this.client.subscribe(node as any, (update: unknown) => {
				const cb = this.subscriptions.get(path);
				if (cb) {
					try {
						const value = this.extractValue(update);
						this.logger.debug('Subscription update received', { path, valueType: typeof value });
						cb(value, path);
					} catch (error) {
						this.logger.error('Error in subscription callback', error, { path });
					}
				}
			});

			this.logger.operationSuccess('subscribe', { path });
			return { success: true };
		} catch (error) {
			// Remove callback on failure
			this.subscriptions.delete(path);
			return this.handleOperationError('subscribe', path, error) as EmberPlusResult<void>;
		}
	}

	unsubscribe(path: string): boolean {
		const removed = this.subscriptions.delete(path);
		if (removed) {
			this.logger.debug('Unsubscribed from path', { path });
		}
		return removed;
	}

	isConnected(): boolean {
		return this.connected;
	}

	getConnectionInfo(): { host: string; port: number; connected: boolean } {
		return {
			host: this.host,
			port: this.port,
			connected: this.connected,
		};
	}

	/**
	 * Get the underlying EmberClient for advanced operations
	 */
	getRawClient(): EmberClient {
		return this.client;
	}

	private ensureConnected(): EmberPlusResult<void> {
		if (!this.connected) {
			const error = createNotConnectedError();
			this.logger.warn('Operation attempted while not connected');
			return { success: false, error: error.message, errorCode: error.code };
		}
		return { success: true };
	}

	private validatePathInput(path: string): EmberPlusResult<void> {
		if (!path || path.trim() === '') {
			const error = createInvalidPathError(path, 'Path cannot be empty');
			return { success: false, error: error.message, errorCode: error.code };
		}

		const validation = validatePath(path);
		if (!validation.valid) {
			const error = createInvalidPathError(path, validation.error);
			return { success: false, error: error.message, errorCode: error.code };
		}

		return { success: true };
	}

	private async withTimeout<T>(
		promise: Promise<T>,
		timeoutMs: number,
		operation: string,
	): Promise<T> {
		const timeoutPromise = new Promise<never>((_, reject) => {
			// eslint-disable-next-line @n8n/community-nodes/no-restricted-globals
			setTimeout(() => {
				reject(new EmberPlusError(`Operation timed out: ${operation}`, {
					code: EmberPlusErrorCode.CONNECTION_TIMEOUT,
					operation,
				}));
			}, timeoutMs);
		});

		return Promise.race([promise, timeoutPromise]);
	}

	private handleOperationError(
		operation: string,
		path: string,
		error: unknown,
	): EmberPlusResult<unknown> {
		if (error instanceof EmberPlusError) {
			this.logger.operationFailed(operation, error, { path });
			return { success: false, error: error.message, errorCode: error.code };
		}

		const opError = createOperationError(
			operation,
			path,
			error instanceof Error ? error : undefined,
		);
		this.logger.operationFailed(operation, opError, { path });
		return { success: false, error: opError.message, errorCode: opError.code };
	}

	private extractNodeInfo(node: unknown): EmberNodeInfo[] {
		const results: EmberNodeInfo[] = [];
		const nodeObj = node as { children?: Map<number, unknown> };

		if (nodeObj.children) {
			for (const [, child] of nodeObj.children) {
				const info = this.nodeToInfo(child, '');
				if (info) {
					results.push(info);
				}
			}
		}

		return results;
	}

	private nodeToInfo(node: unknown, path: string): EmberNodeInfo | null {
		const nodeObj = node as {
			contents?: {
				type?: string;
				identifier?: string;
				description?: string;
				value?: unknown;
			};
			numberedPath?: number[];
		};

		if (!nodeObj.contents) {
			return null;
		}

		const contents = nodeObj.contents;
		const nodePath = nodeObj.numberedPath?.join('.') ?? path;

		let type: EmberNodeInfo['type'] = 'node';
		if ('value' in contents) {
			type = 'parameter';
		} else if (contents.type === 'function') {
			type = 'function';
		} else if (contents.type === 'matrix') {
			type = 'matrix';
		}

		return {
			path: nodePath,
			identifier: contents.identifier,
			description: contents.description,
			type,
			value: 'value' in contents ? contents.value : undefined,
		};
	}

	private extractValue(update: unknown): unknown {
		if (update && typeof update === 'object' && 'value' in update) {
			return (update as { value: unknown }).value;
		}
		return update;
	}
}
