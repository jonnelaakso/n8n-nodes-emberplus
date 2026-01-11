import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class EmberPlus implements ICredentialType {
	name = 'emberPlusApi';

	displayName = 'Ember+ API';

	documentationUrl = 'https://github.com/Lawo/ember-plus';

	properties: INodeProperties[] = [
		{
			displayName: 'Host',
			name: 'host',
			type: 'string',
			default: '',
			placeholder: '192.168.1.100',
			description: 'The hostname or IP address of the Ember+ device',
		},
		{
			displayName: 'Port',
			name: 'port',
			type: 'number',
			default: 9000,
			description: 'The port number of the Ember+ device',
		},
		{
			displayName: 'Connection Timeout',
			name: 'connectionTimeout',
			type: 'number',
			default: 5000,
			description: 'Connection timeout in milliseconds',
		},
	];
}
