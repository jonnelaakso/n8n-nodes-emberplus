# n8n-nodes-emberplus

This is an n8n community node package for interacting with [Ember+](https://github.com/Lawo/ember-plus) devices. Ember+ is a control protocol commonly used in broadcast and professional audio/video equipment, including Lawo audio consoles, routing systems, and other broadcast infrastructure.

This package uses the [sofie-emberplus-connection](https://github.com/Sofie-Automation/sofie-emberplus-connection) library under the hood.

## Features

- **Browse** - Explore the Ember+ device tree structure
- **Get** - Read parameter values from any path
- **Set** - Write values to writable parameters
- **Subscribe** - React to real-time value changes via trigger node
- Support for both numeric (`0.1.2`) and identifier-based (`Root.Device.Param`) paths
- Automatic reconnection on connection loss
- Comprehensive error handling with helpful messages

## Installation

### In n8n (Community Nodes)

1. Go to **Settings** > **Community Nodes**
2. Select **Install**
3. Enter `n8n-nodes-emberplus`
4. Select **Install**

### Manual Installation

```bash
# In your n8n installation directory
npm install n8n-nodes-emberplus
```

### From Source

```bash
git clone https://github.com/jonnelaakso/n8n-nodes-emberplus.git
cd n8n-nodes-emberplus
npm install
npm run build
npm link

# In your n8n directory
npm link n8n-nodes-emberplus
```

## Credential Setup

Before using the Ember+ nodes, configure your credentials:

1. Go to **Credentials** in n8n
2. Click **Add Credential**
3. Search for **Ember+ API**
4. Fill in the connection details:

| Field | Description | Default |
|-------|-------------|---------|
| **Host** | IP address or hostname of the Ember+ device | - |
| **Port** | TCP port of the Ember+ provider | `9000` |
| **Connection Timeout** | Timeout in milliseconds for connection attempts | `5000` |

### Example Configuration

```
Host: 192.168.1.100
Port: 9000
Connection Timeout: 5000
```

## Nodes

### Ember+ Node

The main node for interacting with Ember+ devices. Supports four operations:

#### Browse Operation

Explore the device tree structure to discover available nodes and parameters.

**Parameters:**
- **Path** (optional): Starting path to browse from. Leave empty for root.

**Example Output:**
```json
{
  "operation": "browse",
  "path": "/",
  "nodes": [
    {
      "path": "0",
      "identifier": "Root",
      "description": "Root Node",
      "type": "node"
    },
    {
      "path": "0.0",
      "identifier": "Audio",
      "type": "node"
    }
  ]
}
```

#### Get Operation

Read a value from a specific path.

**Parameters:**
- **Path** (required): The path to read from (e.g., `0.1.2` or `Root.Audio.MainFader`)

**Example Output:**
```json
{
  "operation": "get",
  "path": "0.1.2",
  "value": -12.5
}
```

#### Set Operation

Write a value to a writable parameter.

**Parameters:**
- **Path** (required): The path to write to
- **Value**: The value to set
- **Value Type**: String, Number, or Boolean

**Example Output:**
```json
{
  "operation": "set",
  "path": "0.1.2",
  "value": -6.0,
  "success": true
}
```

#### Subscribe Operation

Get the current value of a parameter (for trigger-based subscriptions, use the Ember+ Trigger node).

**Parameters:**
- **Path** (required): The path to subscribe to

**Example Output:**
```json
{
  "operation": "subscribe",
  "path": "0.1.2",
  "currentValue": -12.5,
  "subscribed": true
}
```

### Ember+ Trigger Node

A trigger node that monitors an Ember+ parameter and fires when the value changes.

**Parameters:**
- **Path** (required): The path to monitor

**Options:**
- **Include Previous Value**: Add the previous value to the output
- **Only On Change**: Only trigger when the value actually changes (default: true)
- **Include Metadata**: Include node identifier and description

**Example Output:**
```json
{
  "path": "0.1.2",
  "value": -6.0,
  "timestamp": "2025-01-11T12:34:56.789Z",
  "previousValue": -12.5,
  "identifier": "MainFader",
  "description": "Main Output Fader"
}
```

## Example Workflows

### 1. Discover Device Structure

Browse the root of an Ember+ device to discover its structure:

```
[Manual Trigger] -> [Ember+: Browse] -> [Set Variable]
```

Configure the Ember+ node:
- **Operation**: Browse
- **Path**: (leave empty for root)

### 2. Read Multiple Parameters

Read several fader values and combine them:

```
[Manual Trigger] -> [Ember+: Get] -> [Ember+: Get] -> [Merge]
                    (path: 0.1.0)    (path: 0.1.1)
```

Or use a Code node to iterate:

```javascript
const paths = ['0.1.0', '0.1.1', '0.1.2', '0.1.3'];
return paths.map(path => ({ json: { path } }));
```

Then connect to an Ember+ Get node with `{{ $json.path }}` as the path.

### 3. Set a Value Based on Condition

Adjust a parameter based on time of day:

```
[Schedule Trigger] -> [If] -> [Ember+: Set]
                              (path: 0.2.0, value: -20)
                       |
                       +----> [Ember+: Set]
                              (path: 0.2.0, value: 0)
```

### 4. React to Value Changes

Trigger a workflow when a parameter changes:

```
[Ember+ Trigger] -> [If: value > threshold] -> [Send Email]
(path: 0.3.1)
```

Configure the trigger:
- **Path**: `0.3.1` (or identifier path)
- **Options**: Include Previous Value = true

### 5. Mirror Values Between Devices

Copy a value from one device to another:

```
[Ember+ Trigger] -> [Ember+: Set]
(Device A)          (Device B, same path)
```

### 6. Batch Parameter Updates

Update multiple parameters from a spreadsheet or database:

```
[Google Sheets Trigger] -> [Ember+: Set]
                           (path: {{ $json.path }})
                           (value: {{ $json.value }})
```

## Path Formats

Ember+ supports two path formats:

### Numeric Paths

Reference nodes by their position in the tree:

```
0           # First root node
0.1         # Second child of first root
0.1.2       # Third child of 0.1
```

### Identifier Paths

Reference nodes by their identifier names:

```
Root
Root.Audio
Root.Audio.MainFader
```

### Tips for Finding Paths

1. Use the **Browse** operation starting from root
2. Navigate deeper by browsing child paths
3. Parameters (leaf nodes with values) show `type: "parameter"`
4. Nodes (containers) show `type: "node"`

## Debugging

Enable debug logging by setting the environment variable:

```bash
EMBER_PLUS_LOG_LEVEL=DEBUG n8n start
```

Log levels: `DEBUG`, `INFO`, `WARN`, `ERROR`, `NONE`

## Error Handling

The node provides detailed error messages for common issues:

| Error | Cause | Solution |
|-------|-------|----------|
| Connection timeout | Device unreachable | Check host/port and network connectivity |
| Path not found | Invalid path | Use Browse to discover valid paths |
| Invalid path format | Malformed path string | Use `0.1.2` or `Root.Child` format |
| Not connected | Connection lost | Check device status, workflow will auto-retry |

### Using Continue On Fail

Enable **Continue On Fail** in the node settings to handle errors gracefully:

```json
{
  "error": "Node not found at path: 0.99.99",
  "errorCode": "PATH_NOT_FOUND"
}
```

## Compatibility

- **n8n**: 1.0.0 or later
- **Node.js**: 18.0.0 or later
- **Ember+ Protocol**: Compatible with Ember+ 1.x providers

### Tested Devices

- Lawo Ruby radio consoles
- Lawo R3lay virtual radio software
- Lawo mc2 series consoles
- Generic Ember+ providers using sofie-emberplus-connection

## Development

```bash
# Install dependencies
npm install

# Start n8n with hot reload
npm run dev

# Build for production
npm run build

# Run linter
npm run lint
npm run lint:fix
```

## Resources

- [Ember+ Protocol Specification](https://github.com/Lawo/ember-plus)
- [sofie-emberplus-connection Library](https://github.com/Sofie-Automation/sofie-emberplus-connection)
- [n8n Community Nodes Documentation](https://docs.n8n.io/integrations/community-nodes/)
- [Lawo Documentation](https://www.lawo.com/support/)

## License

[MIT](LICENSE.md)

## Author

Jonne Laakso (jonne.laakso@gmail.com)

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request
