import type {
	ITriggerFunctions,
	INodeType,
	INodeTypeDescription,
	ITriggerResponse,
	INodeExecutionData,
	ICredentialDataDecryptedObject,
	IDataObject,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { EmberClient } from 'emberplus-connection';
import { createLogger } from './shared/logger';
import { validatePath } from './shared/pathUtils';

export class EmberPlusTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Ember+ Trigger',
		name: 'emberPlusTrigger',
		icon: 'file:emberplus.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["path"]}}',
		description: 'Triggers when an Ember+ parameter value changes',
		defaults: {
			name: 'Ember+ Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'emberPlusApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Path',
				name: 'path',
				type: 'string',
				default: '',
				required: true,
				placeholder: '0.1.2 or Root.Device.Parameter',
				description: 'The path to the Ember+ parameter to subscribe to',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Include Previous Value',
						name: 'includePreviousValue',
						type: 'boolean',
						default: false,
						description: 'Whether to include the previous value in the output',
					},
					{
						displayName: 'Only On Change',
						name: 'onlyOnChange',
						type: 'boolean',
						default: true,
						description: 'Whether to only trigger when the value actually changes',
					},
					{
						displayName: 'Include Metadata',
						name: 'includeMetadata',
						type: 'boolean',
						default: false,
						description: 'Whether to include node metadata (identifier, description) in the output',
					},
				],
			},
		],
	};

	async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
		const logger = createLogger('Trigger');

		// Get and validate credentials
		let credentials: ICredentialDataDecryptedObject;
		try {
			credentials = await this.getCredentials('emberPlusApi');
		} catch (error) {
			throw new NodeOperationError(
				this.getNode(),
				'Failed to get Ember+ credentials. Please check your credential configuration.',
				{ description: 'Ensure the Ember+ credentials are properly configured with host and port.' },
			);
		}

		const host = credentials.host as string;
		const port = credentials.port as number;
		const timeout = (credentials.connectionTimeout as number) || 5000;

		// Validate credentials
		if (!host || typeof host !== 'string' || host.trim() === '') {
			throw new NodeOperationError(
				this.getNode(),
				'Invalid Ember+ host configuration',
				{ description: 'The host field in credentials cannot be empty.' },
			);
		}

		if (!port || typeof port !== 'number' || port <= 0 || port > 65535) {
			throw new NodeOperationError(
				this.getNode(),
				'Invalid Ember+ port configuration',
				{ description: 'The port must be a number between 1 and 65535.' },
			);
		}

		// Get and validate path
		const path = this.getNodeParameter('path') as string;

		if (!path || path.trim() === '') {
			throw new NodeOperationError(
				this.getNode(),
				'Path is required',
				{ description: 'Specify a path to the Ember+ parameter you want to subscribe to.' },
			);
		}

		const pathValidation = validatePath(path);
		if (!pathValidation.valid) {
			throw new NodeOperationError(
				this.getNode(),
				`Invalid path format: ${path}`,
				{ description: pathValidation.error || 'Use numeric (0.1.2) or identifier-based (Root.Device.Param) paths.' },
			);
		}

		const options = this.getNodeParameter('options', {}) as {
			includePreviousValue?: boolean;
			onlyOnChange?: boolean;
			includeMetadata?: boolean;
		};

		const includePreviousValue = options.includePreviousValue ?? false;
		const onlyOnChange = options.onlyOnChange ?? true;
		const includeMetadata = options.includeMetadata ?? false;

		logger.info('Starting Ember+ trigger', { host, port, path });

		const client = new EmberClient(host, port);
		let previousValue: unknown = undefined;
		let isFirstValue = true;
		let nodeMetadata: { identifier?: string; description?: string } | null = null;
		let isConnected = false;
		let reconnectAttempts = 0;
		const maxReconnectAttempts = 5;
		const reconnectDelay = 5000;

		const emitValue = (value: unknown) => {
			try {
				const outputData: Record<string, unknown> = {
					path,
					value,
					timestamp: new Date().toISOString(),
				};

				if (includePreviousValue && !isFirstValue) {
					outputData.previousValue = previousValue;
				}

				if (includeMetadata && nodeMetadata) {
					outputData.identifier = nodeMetadata.identifier;
					outputData.description = nodeMetadata.description;
				}

				const executionData: INodeExecutionData = {
					json: outputData as IDataObject,
				};

				logger.debug('Emitting value', { path, valueType: typeof value });
				this.emit([[executionData]]);
				previousValue = value;
				isFirstValue = false;
			} catch (error) {
				logger.error('Failed to emit value', error, { path });
			}
		};

		const extractValue = (update: unknown): unknown => {
			if (update && typeof update === 'object' && 'value' in update) {
				return (update as { value: unknown }).value;
			}
			return update;
		};

		const setupSubscription = async (): Promise<void> => {
			// Get the node and subscribe
			const node = await client.getElementByPath(path);
			if (!node) {
				throw new NodeOperationError(
					this.getNode(),
					`Node not found at path: ${path}`,
					{ description: 'Use the Browse operation in the Ember+ node to discover available paths.' },
				);
			}

			// Extract metadata if requested
			if (includeMetadata) {
				const contents = (node as { contents?: { identifier?: string; description?: string } }).contents;
				if (contents) {
					nodeMetadata = {
						identifier: contents.identifier,
						description: contents.description,
					};
					logger.debug('Node metadata retrieved', { path, identifier: nodeMetadata.identifier });
				}
			}

			// Get initial value
			const contents = (node as { contents?: { value?: unknown } }).contents;
			if (contents && 'value' in contents) {
				previousValue = contents.value;
				logger.debug('Initial value retrieved', { path, valueType: typeof previousValue });
			}

			// Subscribe to changes
			await client.subscribe(node as any, (update: unknown) => {
				try {
					const newValue = extractValue(update);

					if (onlyOnChange && !isFirstValue) {
						// Compare values - simple comparison for primitives
						if (JSON.stringify(newValue) === JSON.stringify(previousValue)) {
							logger.debug('Value unchanged, skipping emit', { path });
							return;
						}
					}

					emitValue(newValue);
				} catch (error) {
					logger.error('Error processing subscription update', error, { path });
				}
			});

			logger.info('Subscription established', { path });
		};

		const connect = async (): Promise<void> => {
			logger.debug('Connecting to device', { host, port, timeout });

			// Connect with timeout
			const connectPromise = client.connect();
			const timeoutPromise = new Promise<never>((_, reject) => {
				setTimeout(() => {
					reject(new NodeOperationError(
						this.getNode(),
						`Connection to ${host}:${port} timed out after ${timeout}ms`,
						{ description: 'Check network connectivity or increase the timeout in credentials.' },
					));
				}, timeout);
			});

			await Promise.race([connectPromise, timeoutPromise]);
			isConnected = true;
			reconnectAttempts = 0;
			logger.info('Connected to device', { host, port });

			await setupSubscription();
		};

		const attemptReconnect = async (): Promise<void> => {
			if (reconnectAttempts >= maxReconnectAttempts) {
				logger.error('Max reconnect attempts reached', undefined, { attempts: reconnectAttempts });
				return;
			}

			reconnectAttempts++;
			logger.warn('Attempting reconnect', { attempt: reconnectAttempts, maxAttempts: maxReconnectAttempts });

			await new Promise((resolve) => setTimeout(resolve, reconnectDelay));

			try {
				await connect();
			} catch (error) {
				logger.error('Reconnect failed', error, { attempt: reconnectAttempts });
				// Schedule another attempt
				attemptReconnect().catch(() => {
					// Ignore - we're already handling errors
				});
			}
		};

		// Set up event handlers before connecting
		client.on('error', (error: Error) => {
			logger.error('Connection error', error, { host, port });
		});

		client.on('disconnected', () => {
			isConnected = false;
			logger.warn('Disconnected from device', { host, port });

			// Attempt to reconnect
			attemptReconnect().catch((error) => {
				logger.error('Failed to initiate reconnect', error);
			});
		});

		client.on('connected', () => {
			isConnected = true;
			logger.info('Connection event received', { host, port });
		});

		// Initial connection
		try {
			await connect();
		} catch (error) {
			// Clean up on initial connection failure
			try {
				await client.disconnect();
			} catch {
				// Ignore cleanup errors
			}

			if (error instanceof NodeOperationError) {
				throw error;
			}

			throw new NodeOperationError(
				this.getNode(),
				`Failed to connect to Ember+ device at ${host}:${port}`,
				{
					description: error instanceof Error
						? error.message
						: 'Check that the device is online and the credentials are correct.',
				},
			);
		}

		// Handle manual execution - emit current value once
		const manualTriggerFunction = async () => {
			logger.debug('Manual trigger executed', { path });

			if (!isConnected) {
				logger.warn('Cannot execute manual trigger - not connected');
				return;
			}

			try {
				const currentNode = await client.getElementByPath(path);
				if (currentNode) {
					const nodeContents = (currentNode as { contents?: { value?: unknown } }).contents;
					if (nodeContents && 'value' in nodeContents) {
						emitValue(nodeContents.value);
					} else {
						logger.warn('No value available for manual trigger', { path });
					}
				} else {
					logger.warn('Node not found for manual trigger', { path });
				}
			} catch (error) {
				logger.error('Manual trigger failed', error, { path });
			}
		};

		// Cleanup function
		const closeFunction = async () => {
			logger.info('Closing trigger', { path });

			try {
				await client.disconnect();
				isConnected = false;
				logger.debug('Disconnected successfully');
			} catch (error) {
				logger.error('Error during disconnect', error);
				// Force state reset
				isConnected = false;
			}
		};

		return {
			closeFunction,
			manualTriggerFunction,
		};
	}
}
