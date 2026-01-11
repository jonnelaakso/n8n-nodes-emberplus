import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	ICredentialDataDecryptedObject,
	IDataObject,
	GenericValue,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { EmberPlusClient } from './shared/EmberPlusClient';
import { EmberPlusErrorCode, isEmberPlusError, getNodeErrorDescription } from './shared/errors';
import { createLogger } from './shared/logger';
import { validatePath } from './shared/pathUtils';

export class EmberPlus implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Ember+',
		name: 'emberPlus',
		icon: 'file:emberplus.svg',
		group: ['input'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Interact with Ember+ devices',
		defaults: {
			name: 'Ember+',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'emberPlusApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Browse',
						value: 'browse',
						description: 'Browse the Ember+ tree structure',
						action: 'Browse the ember tree structure',
					},
					{
						name: 'Get',
						value: 'get',
						description: 'Get a value from a path',
						action: 'Get a value from a path',
					},
					{
						name: 'Set',
						value: 'set',
						description: 'Set a value at a path',
						action: 'Set a value at a path',
					},
					{
						name: 'Subscribe',
						value: 'subscribe',
						description: 'Subscribe to value changes (returns current value)',
						action: 'Subscribe to value changes',
					},
				],
				default: 'browse',
			},
			{
				displayName: 'Path',
				name: 'path',
				type: 'string',
				default: '',
				placeholder: '0.1.2 or root.device.parameter',
				description: 'The path to the Ember+ node (numeric or identifier-based)',
				displayOptions: {
					show: {
						operation: ['browse', 'get', 'set', 'subscribe'],
					},
					hide: {
						operation: ['browse'],
					},
				},
			},
			{
				displayName: 'Path',
				name: 'path',
				type: 'string',
				default: '',
				placeholder: '0.1.2 or root.device.parameter',
				description:
					'The path to browse from (leave empty for root). Use numeric (0.1.2) or identifier-based paths.',
				displayOptions: {
					show: {
						operation: ['browse'],
					},
				},
			},
			{
				displayName: 'Value',
				name: 'value',
				type: 'string',
				default: '',
				description: 'The value to set',
				displayOptions: {
					show: {
						operation: ['set'],
					},
				},
			},
			{
				displayName: 'Value Type',
				name: 'valueType',
				type: 'options',
				options: [
					{
						name: 'String',
						value: 'string',
					},
					{
						name: 'Number',
						value: 'number',
					},
					{
						name: 'Boolean',
						value: 'boolean',
					},
				],
				default: 'string',
				description: 'The type of value to set',
				displayOptions: {
					show: {
						operation: ['set'],
					},
				},
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const logger = createLogger('Node');

		// Get credentials
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

		logger.info('Starting Ember+ node execution', { host, port, itemCount: items.length });

		const client = new EmberPlusClient(host, port, { timeout, logger });

		try {
			// Connect to device
			const connectResult = await client.connect();

			if (!connectResult.success) {
				const errorCode = connectResult.errorCode;
				let description = 'Check that the Ember+ device is online and accessible.';

				if (errorCode === EmberPlusErrorCode.CONNECTION_TIMEOUT) {
					description = `Connection timed out after ${timeout}ms. Check network connectivity or increase the timeout in credentials.`;
				} else if (errorCode === EmberPlusErrorCode.CONNECTION_FAILED) {
					description = `Could not connect to ${host}:${port}. Verify the host and port are correct and the device is online.`;
				}

				throw new NodeOperationError(
					this.getNode(),
					connectResult.error || 'Failed to connect to Ember+ device',
					{ description },
				);
			}

			// Process each item
			// Store reference to class instance for method calls
			const nodeInstance = this as unknown as EmberPlus;
			
			for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
				try {
					const operation = this.getNodeParameter('operation', itemIndex) as string;
					const path = this.getNodeParameter('path', itemIndex, '') as string;

					logger.debug('Processing item', { itemIndex, operation, path });

					let result: INodeExecutionData;

					switch (operation) {
						case 'browse': {
							result = await nodeInstance.executeBrowse(this, client, path, itemIndex, logger);
							break;
						}

						case 'get': {
							result = await nodeInstance.executeGet(this, client, path, itemIndex, logger);
							break;
						}

						case 'set': {
							result = await nodeInstance.executeSet(this, client, path, itemIndex, logger);
							break;
						}

						case 'subscribe': {
							result = await nodeInstance.executeSubscribe(this, client, path, itemIndex, logger);
							break;
						}

						default:
							throw new NodeOperationError(
								this.getNode(),
								`Unknown operation: ${operation}`,
								{
									itemIndex,
									description: 'Valid operations are: browse, get, set, subscribe',
								},
							);
					}

					returnData.push(result);
				} catch (error) {
					if (this.continueOnFail()) {
						logger.warn('Item failed, continuing', { itemIndex, error: error instanceof Error ? error.message : 'Unknown' });
						returnData.push({
							json: {
								error: error instanceof Error ? error.message : 'Unknown error',
								errorCode: isEmberPlusError(error) ? error.code : undefined,
							},
							pairedItem: itemIndex,
						});
					} else {
						// Re-throw NodeOperationError as-is
						if (error instanceof NodeOperationError) {
							throw error;
						}

						// Wrap other errors
						const message = error instanceof Error ? error.message : 'Unknown error';
						const description = isEmberPlusError(error)
							? getNodeErrorDescription(error)
							: 'An unexpected error occurred';

						throw new NodeOperationError(this.getNode(), message, {
							itemIndex,
							description,
						});
					}
				}
			}
		} finally {
			// Always disconnect
			logger.debug('Disconnecting from device');
			await client.disconnect();
		}

		logger.info('Ember+ node execution completed', { resultCount: returnData.length });
		return [returnData];
	}

	private async executeBrowse(
		executeFunctions: IExecuteFunctions,
		client: EmberPlusClient,
		path: string,
		itemIndex: number,
		logger: ReturnType<typeof createLogger>,
	): Promise<INodeExecutionData> {
		const browseResult = await client.browse(path || undefined);

		if (!browseResult.success) {
			throw this.createPathError(executeFunctions, path || '/', browseResult.error!, browseResult.errorCode, itemIndex);
		}

		logger.debug('Browse completed', { path: path || '/', nodeCount: browseResult.data?.length });

		return {
			json: {
				operation: 'browse',
				path: path || '/',
				nodes: browseResult.data,
			},
			pairedItem: itemIndex,
		};
	}

	private async executeGet(
		executeFunctions: IExecuteFunctions,
		client: EmberPlusClient,
		path: string,
		itemIndex: number,
		logger: ReturnType<typeof createLogger>,
	): Promise<INodeExecutionData> {
		if (!path) {
			throw new NodeOperationError(
				executeFunctions.getNode(),
				'Path is required for get operation',
				{
					itemIndex,
					description: 'Specify a path to the Ember+ node you want to read.',
				},
			);
		}

		// Validate path format
		const pathValidation = validatePath(path);
		if (!pathValidation.valid) {
			throw new NodeOperationError(
				executeFunctions.getNode(),
				`Invalid path format: ${path}`,
				{
					itemIndex,
					description: pathValidation.error || 'Use numeric (0.1.2) or identifier-based (Root.Device.Param) paths.',
				},
			);
		}

		const getResult = await client.get(path);

		if (!getResult.success) {
			throw this.createPathError(executeFunctions, path, getResult.error!, getResult.errorCode, itemIndex);
		}

		logger.debug('Get completed', { path, valueType: typeof getResult.data });

		return {
			json: {
				operation: 'get',
				path,
				value: getResult.data as IDataObject | GenericValue | GenericValue[] | IDataObject[],
			},
			pairedItem: itemIndex,
		};
	}

	private async executeSet(
		executeFunctions: IExecuteFunctions,
		client: EmberPlusClient,
		path: string,
		itemIndex: number,
		logger: ReturnType<typeof createLogger>,
	): Promise<INodeExecutionData> {
		if (!path) {
			throw new NodeOperationError(
				executeFunctions.getNode(),
				'Path is required for set operation',
				{
					itemIndex,
					description: 'Specify a path to the Ember+ parameter you want to set.',
				},
			);
		}

		// Validate path format
		const pathValidation = validatePath(path);
		if (!pathValidation.valid) {
			throw new NodeOperationError(
				executeFunctions.getNode(),
				`Invalid path format: ${path}`,
				{
					itemIndex,
					description: pathValidation.error || 'Use numeric (0.1.2) or identifier-based (Root.Device.Param) paths.',
				},
			);
		}

		const rawValue = executeFunctions.getNodeParameter('value', itemIndex) as string;
		const valueType = executeFunctions.getNodeParameter('valueType', itemIndex) as string;

		// Convert value to correct type
		let typedValue: unknown = rawValue;
		switch (valueType) {
			case 'number': {
				typedValue = Number(rawValue);
				if (isNaN(typedValue as number)) {
					throw new NodeOperationError(
						executeFunctions.getNode(),
						`Invalid number value: "${rawValue}"`,
						{
							itemIndex,
							description: 'The value must be a valid number.',
						},
					);
				}
				break;
			}
			case 'boolean': {
				const lowerValue = rawValue.toLowerCase().trim();
				if (!['true', 'false', '1', '0', 'yes', 'no'].includes(lowerValue)) {
					throw new NodeOperationError(
						executeFunctions.getNode(),
						`Invalid boolean value: "${rawValue}"`,
						{
							itemIndex,
							description: 'Valid boolean values are: true, false, 1, 0, yes, no',
						},
					);
				}
				typedValue = ['true', '1', 'yes'].includes(lowerValue);
				break;
			}
		}

		const setResult = await client.set(path, typedValue);

		if (!setResult.success) {
			throw this.createPathError(executeFunctions, path, setResult.error!, setResult.errorCode, itemIndex);
		}

		logger.debug('Set completed', { path, value: typedValue });

		return {
			json: {
				operation: 'set',
				path,
				value: typedValue as IDataObject | GenericValue | GenericValue[] | IDataObject[],
				success: true,
			},
			pairedItem: itemIndex,
		};
	}

	private async executeSubscribe(
		executeFunctions: IExecuteFunctions,
		client: EmberPlusClient,
		path: string,
		itemIndex: number,
		logger: ReturnType<typeof createLogger>,
	): Promise<INodeExecutionData> {
		if (!path) {
			throw new NodeOperationError(
				executeFunctions.getNode(),
				'Path is required for subscribe operation',
				{
					itemIndex,
					description: 'Specify a path to the Ember+ parameter you want to subscribe to.',
				},
			);
		}

		// Validate path format
		const pathValidation = validatePath(path);
		if (!pathValidation.valid) {
			throw new NodeOperationError(
				executeFunctions.getNode(),
				`Invalid path format: ${path}`,
				{
					itemIndex,
					description: pathValidation.error || 'Use numeric (0.1.2) or identifier-based (Root.Device.Param) paths.',
				},
			);
		}

		// For regular node execution, we get the current value instead of maintaining subscription
		const getForSubscribe = await client.get(path);

		if (!getForSubscribe.success) {
			throw this.createPathError(executeFunctions, path, getForSubscribe.error!, getForSubscribe.errorCode, itemIndex);
		}

		logger.debug('Subscribe (get current) completed', { path });

		return {
			json: {
				operation: 'subscribe',
				path,
				currentValue: getForSubscribe.data as IDataObject | GenericValue | GenericValue[] | IDataObject[],
				subscribed: true,
			},
			pairedItem: itemIndex,
		};
	}

	private createPathError(
		executeFunctions: IExecuteFunctions,
		path: string,
		errorMessage: string,
		errorCode: EmberPlusErrorCode | undefined,
		itemIndex: number,
	): NodeOperationError {
		let description: string;

		switch (errorCode) {
			case EmberPlusErrorCode.PATH_NOT_FOUND:
				description = `The path "${path}" does not exist on the device. Use the Browse operation to discover available paths.`;
				break;
			case EmberPlusErrorCode.INVALID_PATH:
				description = 'Check path format: use numeric (0.1.2) or identifier-based (Root.Device.Param) paths.';
				break;
			case EmberPlusErrorCode.NOT_CONNECTED:
				description = 'Connection to the device was lost. The workflow may need to be restarted.';
				break;
			case EmberPlusErrorCode.CONNECTION_TIMEOUT:
				description = 'The operation timed out. The device may be unresponsive or overloaded.';
				break;
			default:
				description = 'An error occurred while accessing the Ember+ device.';
		}

		return new NodeOperationError(executeFunctions.getNode(), errorMessage, {
			itemIndex,
			description,
		});
	}
}
