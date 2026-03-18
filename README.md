# @mnicole-dev/mailjet-mcp-server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server for the [Mailjet](https://www.mailjet.com) Email API (v3/v3.1). Send transactional emails, manage contacts and lists, create templates, track messages, and configure webhooks from any MCP-compatible client.

## Features

**25 tools** covering the core Mailjet API:

### Send Email (1 tool)
| Tool | Description |
|------|-------------|
| `send-email` | Send transactional email via v3.1 API (HTML/text, templates, variables, attachments, tracking) |

### Contacts (5 tools)
| Tool | Description |
|------|-------------|
| `list-contacts` | List contacts with pagination |
| `get-contact` | Get a contact by ID or email |
| `create-contact` | Create a new contact |
| `update-contact` | Update contact properties |
| `manage-contact-lists` | Subscribe/unsubscribe a contact from multiple lists |

### Contact Lists (5 tools)
| Tool | Description |
|------|-------------|
| `list-contact-lists` | List all contact lists |
| `create-contact-list` | Create a new list |
| `update-contact-list` | Update a list |
| `delete-contact-list` | Delete a list |
| `add-contact-to-list` | Add/remove a contact on a list |

### Templates (5 tools)
| Tool | Description |
|------|-------------|
| `list-templates` | List email templates |
| `get-template` | Get template details |
| `create-template` | Create a template |
| `set-template-content` | Set HTML/text content of a template |
| `delete-template` | Delete a template |

### Senders (1 tool)
| Tool | Description |
|------|-------------|
| `list-senders` | List authorized sender addresses |

### Messages & Statistics (4 tools)
| Tool | Description |
|------|-------------|
| `list-messages` | List sent messages with subjects |
| `get-message` | Get message details |
| `get-message-history` | Get delivery event history (sent, opened, clicked, bounced) |
| `get-campaign-statistics` | Get campaign-level statistics |

### Webhooks (3 tools)
| Tool | Description |
|------|-------------|
| `list-webhooks` | List event callback webhooks |
| `create-webhook` | Create a webhook (sent, open, click, bounce, spam, blocked, unsub) |
| `delete-webhook` | Delete a webhook |

### Account (1 tool)
| Tool | Description |
|------|-------------|
| `get-profile` | Get your Mailjet account profile |

## Requirements

- Node.js 18+
- A Mailjet account with API credentials ([get them here](https://app.mailjet.com/account/apikeys))

## Installation

```bash
npm install -g @mnicole-dev/mailjet-mcp-server
```

Or run directly with `npx`:

```bash
npx @mnicole-dev/mailjet-mcp-server
```

## Configuration

Set these environment variables:

```bash
export MJ_APIKEY_PUBLIC=your-api-key
export MJ_APIKEY_PRIVATE=your-secret-key
```

### Claude Code

Add to your `~/.claude.json`:

```json
{
  "mcpServers": {
    "mailjet": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@mnicole-dev/mailjet-mcp-server"],
      "env": {
        "MJ_APIKEY_PUBLIC": "your-api-key",
        "MJ_APIKEY_PRIVATE": "your-secret-key"
      }
    }
  }
}
```

### Claude Desktop

Add to your config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "mailjet": {
      "command": "npx",
      "args": ["-y", "@mnicole-dev/mailjet-mcp-server"],
      "env": {
        "MJ_APIKEY_PUBLIC": "your-api-key",
        "MJ_APIKEY_PRIVATE": "your-secret-key"
      }
    }
  }
}
```

## Examples

### Send a simple email

```
> Send an email from hello@example.com to john@example.com with subject "Meeting tomorrow" and text "Let's meet at 2pm"
```

### Send with a template

```
> Send email using template 12345 to jane@example.com with variables {"name": "Jane", "order_id": "ABC123"}
```

### Manage contacts

```
> Create a contact for max@example.com named "Max" and add them to list 456
```

### Check message delivery

```
> Show me the delivery history for message 789012
```

## How it works

1. The MCP client sends a tool call to the server via stdio
2. The server authenticates with Mailjet using Basic Auth (API key + secret key)
3. Requests are sent to `https://api.mailjet.com` (v3 REST or v3.1 Send API)
4. Responses are formatted as human-readable text and returned

## Development

```bash
git clone https://github.com/mnicole-dev/mailjet-mcp-server.git
cd mailjet-mcp-server
pnpm install
pnpm dev          # Run with tsx (requires MJ_APIKEY_PUBLIC + MJ_APIKEY_PRIVATE)
pnpm build        # Build to dist/
```

## License

MIT
